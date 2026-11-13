/**
 * necklace-solver.js
 *
 * Decides where the necklace sits and how big it is, per frame, with no
 * DOM / WebGL / MediaPipe dependency (like earring-solver.js, so it can
 * be replayed and tested in Node).
 *
 *   face landmarks ─► One-Euro smoothing (only the points used)
 *                  ─► world space (view-mapping.js: crop + mirror, y up, +z = toward viewer)
 *                  ─► face frame: side axis, up axis, forward axis, face width W
 *                  ─► neck base = face midpoint offset downward + slightly forward
 *                  ─► necklace: X follows head yaw (horizontal), Y ≈ gravity, Z = X × Y
 *                  ─► visibility fades when head turns past ~35–50°
 *                  ─► neck cylinder + chest box depth occluders
 *
 * All offsets are fractions of W (distance between the face's outer edges
 * at ear level, landmarks 234/454; ~14 cm on an adult), so the placement
 * scales with distance and face size automatically.
 */

import { Vector3OneEuroFilter, OneEuroFilter } from './one-euro-filter.js';
import { computeCoverCrop, createViewMapper } from './view-mapping.js';
import { EAR_LANDMARKS, FACE_OVAL, headAnglesFromMatrix } from './face-tracking.js';
import { POSE_LANDMARKS, computeTorsoFrame } from './pose-tracking.js';
import { computeCameraFrame } from './three-scene.js';
import { computeFaceFrame } from './earring-solver.js';

// ─── Anatomical constants (fractions of face width W ≈ 140 mm) ───────

/** Real distance between landmarks 234 and 454 on an average adult face. */
export const FACE_WIDTH_MM = 140;

/** Default necklace circumference (18-inch standard princess chain). */
export const DEFAULT_NECKLACE_LENGTH_MM = 450;

/**
 * How far below face midpoint the chain starts (fraction of W).
 * Chin is ~0.71 * W below midpoint.
 * 0.85 * W sits mid-neck (~20 mm below chin), matching standard 18"-20" chains.
 */
export const NECK_BASE_DOWN = 0.80;

/** The neck base depth offset relative to face midpoint plane. */
export const NECK_BASE_FORWARD = 0.02;

/** Neck width relative to face width W (wider U-shape drape). */
export const NECK_WIDTH_RATIO = 0.82;

/** How far the necklace pendant hangs in front of the chest plane. */
export const DRAPE_DEPTH = 0.03;

/** Head turn angle (degrees) at which necklace starts fading. */
export const NECKLACE_FADE_START_DEG = 45;

/** Head turn angle (degrees) at which necklace is fully hidden. */
export const NECKLACE_FADE_END_DEG = 65;

// ─── Neck depth occluder constants ───────────────────────────────────

/** Neck cylinder: side radius relative to W. */
const NECK_OCC_RADIUS_SIDE = 0.32;

/** Neck cylinder: front radius relative to W. */
const NECK_OCC_RADIUS_FRONT = 0.28;

/** Neck cylinder: how far behind the face midpoint (back offset, fraction of W). */
const NECK_OCC_BACK = 0.15;

// ─── Chest occluder constants ────────────────────────────────────────

/** Chest box: half-width relative to W. */
const CHEST_OCC_HALF_WIDTH = 0.60;

/** Chest box: half-height relative to W. */
const CHEST_OCC_HALF_HEIGHT = 0.25;

/** Chest box: half-depth relative to W. */
const CHEST_OCC_HALF_DEPTH = 0.12;

// ─── Pose constants ──────────────────────────────────────────────────

/** Fallback lift (fraction of shoulder width) when no face width is known. */
export const POSE_NECK_LIFT = 0.20;

/** How much of the shoulder-line tilt the neck-base lift follows (0 = straight up, 1 = fully perpendicular to the shoulders). */
export const LIFT_ROLL_FOLLOW = 0.3;

/**
 * Where the chain's top ends sit, in face widths BELOW the chin (the chain
 * rests at the base of the neck, a little under the jaw line).
 */
export const NECK_BASE_BELOW_CHIN = 0.15;

/**
 * Starting guess for the chin's height above the shoulder-joint line (face
 * widths), used until the solver has measured the real value for this person.
 * (Measured ≈0.6 on a real webcam session; varies with posture/framing.)
 */
export const CHIN_ABOVE_SHOULDERS_SEED = 0.6;

/** Valid range for the measured chin-above-shoulders value (face widths). */
const CHIN_ABOVE_SHOULDERS_RANGE = [0.3, 1.3];

/** Time constant (s) of the slow calibration of chin-above-shoulders. */
const CALIBRATION_TAU_S = 3;

/** Only calibrate while the face looks roughly at the camera (forward.z ≥ this). */
const CALIBRATION_MIN_FACING = 0.93;

/**
 * Sanity band for the anchor relative to the chin (fractions of face width,
 * measured downward from the chin): the neck base can't be above the chin or
 * more than this far below it, whatever the pose model says.
 */
const ANCHOR_BELOW_CHIN_MIN = 0.02;
const ANCHOR_BELOW_CHIN_MAX = 0.45;

/** Ignore pose shoulders below this MediaPipe visibility score. */
const POSE_MIN_VISIBILITY = 0.5;

/** Shoulders move slowly relative to the head; smooth harder than the face. */
const SHOULDER_FILTER = { minCutoff: 0.8, beta: 1.5, dCutoff: 1.0 };

// ─── Filter config ───────────────────────────────────────────────────

const LANDMARK_FILTER = { minCutoff: 1.2, beta: 6.0, dCutoff: 1.0 };
const SIZE_FILTER = { minCutoff: 0.4, beta: 0.005, dCutoff: 1.0 };
const ANCHOR_FILTER = { minCutoff: 1.0, beta: 2.5, dCutoff: 1.0 };

/** Landmarks used: ear-area points, forehead (10), chin (152), nose tip (1), face outline. */
const USED = [...new Set([
  ...Object.values(EAR_LANDMARKS.right),
  ...Object.values(EAR_LANDMARKS.left),
  10, 152, 1,
  ...FACE_OVAL,
])];

// ─── Vector helpers ──────────────────────────────────────────────────

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const len = (a) => Math.hypot(a.x, a.y, a.z);
const norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? mul(a, 1 / l) : { x: 0, y: 0, z: 0 };
};

const smoothstep = (a, b, x) => {
  const k = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return k * k * (3 - 2 * k);
};

// ─── Exported geometry functions ─────────────────────────────────────

/**
 * Estimates the necklace anchor point from body pose landmarks (shoulders).
 * Falls back to face-based estimation if pose is unavailable.
 *
 * @param {Object} torsoFrame - from computeTorsoFrame (pose landmarks)
 * @param {Object} [faceFrame] - from computeFaceFrame (fallback if no pose)
 * @param {number} [neckDown=NECK_BASE_DOWN] - only used in face-only fallback
 * @returns {{x,y,z}} world-space anchor point
 */
export function estimateNeckBase(torsoFrame, faceFrame = null, neckDown = NECK_BASE_DOWN, lift_ = null) {
  if (torsoFrame && torsoFrame.shoulderMid) {
    // Pose-based: anchor at the midpoint between shoulders, slightly below and forward.
    // The shoulder landmarks are at the shoulder joints; the base of the neck
    // is well ABOVE that line, along the torso "up". The caller supplies the
    // lift (in world units), calibrated per person; fall back to a shoulder-
    // width fraction if it doesn't.
    const lift = Number.isFinite(lift_) ? lift_ : POSE_NECK_LIFT * torsoFrame.width;
    // Lift mostly straight up: the shoulder line's tilt exaggerates the real
    // tilt of the neck (measured: following it fully put the anchor ~0.04
    // face widths too far toward the head's side). Follow only part of it.
    const tilt = Math.atan2(torsoFrame.up.x, torsoFrame.up.y) * LIFT_ROLL_FOLLOW;
    return {
      x: torsoFrame.shoulderMid.x + Math.sin(tilt) * lift,
      y: torsoFrame.shoulderMid.y + Math.cos(tilt) * lift,
      z: 0,
    };
  }
  // Face-only fallback (old method).
  if (faceFrame) {
    const W = faceFrame.width;
    const spineX = faceFrame.mid.x - 0.21 * faceFrame.forward.x * W;
    return {
      x: spineX,
      y: faceFrame.mid.y - neckDown * W,
      z: 0.03 * W,
    };
  }
  return { x: 0, y: 0, z: 0 };
}

/**
 * Necklace model axes in world space.
 * With pose tracking: follows the torso orientation (shoulders).
 * Without pose: locked to camera/gravity (old behavior).
 *
 * @param {Object|null} torsoFrame - from computeTorsoFrame
 * @returns {{x,y,z}[]} [xAxis, yAxis, zAxis]
 */
export function necklaceAxes(torsoFrame = null) {
  if (torsoFrame) {
    // Follow torso: side (right→left), up (perpendicular to side), forward (side × up).
    return [torsoFrame.side, torsoFrame.up, torsoFrame.forward];
  }
  // Fallback: locked to world/camera space.
  return [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ];
}

/**
 * Necklace visibility from head turn angle.
 * Fades out only when the head turns far away past profile.
 *
 * @param {Object} frame - from computeFaceFrame
 * @returns {number} 0–1
 */
export function necklaceVisibility(frame) {
  const fwdLen = Math.hypot(frame.forward.x, frame.forward.z);
  if (fwdLen < 1e-6) return 1;
  const facing = frame.forward.z / fwdLen; // + = toward camera
  return smoothstep(
    Math.cos((NECKLACE_FADE_END_DEG * Math.PI) / 180),
    Math.cos((NECKLACE_FADE_START_DEG * Math.PI) / 180),
    facing
  );
}

// ─── Robustness constants ────────────────────────────────────────────

/** Neither face nor shoulders tracked: keep the last placement this long (s)… */
const LOST_HOLD_S = 0.3;
/** …then fade it out over this long (s). */
const LOST_FADE_S = 0.5;

/** Time constant (s) for learning the pose-vs-face anchor difference. */
const FACE_TO_POSE_TAU_S = 1.5;

/** Time constant (s) of the smoothed visibility. */
const VISIBILITY_TAU_S = 0.08;

/** Starting guess for shoulder width / face width until measured (≈2.4–2.7 for adults). */
export const SHOULDER_TO_FACE_SEED = 2.5;

/** Plausible shoulder width / face width: outside this the pose is treated as a glitch. */
const SHOULDER_TO_FACE_RANGE = [1.4, 4.5];

/** Shoulders closer than this to the frame edge (raw 0–1 coords) are not trusted. */
const SHOULDER_EDGE_MARGIN = 0.02;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// ─── NecklaceSolver class ────────────────────────────────────

/**
 * Tracking modes (chosen per frame):
 *   'both'  face + shoulders: shoulders give the position/roll, face gives size.
 *   'face'  shoulders missing/cut off/unreliable (camera close): neck base is
 *           placed under the chin, gravity-aligned, corrected by the offset
 *           learned while both were visible (so the switch doesn't jump).
 *   'pose'  face missing/hidden: shoulders alone, size from shoulder width via
 *           the shoulder/face ratio measured earlier.
 * With neither, the last placement is held briefly then faded out.
 */
export class NecklaceSolver {
  /** @param {{lengthMm?:number, neckDown?:number, neckWidthRatio?:number}} [opts] */
  constructor(opts = {}) {
    this.lengthMm = opts.lengthMm || DEFAULT_NECKLACE_LENGTH_MM;
    this.neckDown = opts.neckDown !== undefined ? opts.neckDown : NECK_BASE_DOWN;
    this.neckWidthRatio = opts.neckWidthRatio || NECK_WIDTH_RATIO;
    /** Manual sideways nudge of the anchor, in face widths (+ = screen right). */
    this.neckX = Number.isFinite(opts.neckX) ? opts.neckX : 0;
    this.filters = new Map(USED.map((i) => [i, new Vector3OneEuroFilter(LANDMARK_FILTER)]));
    this.widthFilter = new OneEuroFilter(SIZE_FILTER);
    this.anchorFilter = new Vector3OneEuroFilter(ANCHOR_FILTER);
    this.shoulderFilters = [new Vector3OneEuroFilter(SHOULDER_FILTER), new Vector3OneEuroFilter(SHOULDER_FILTER)];
    this.resetCalibration();
    this.resetTracking();
  }

  /** Per-person measurements (kept across short tracking losses). */
  resetCalibration() {
    this.chinAboveShoulders = null; // chin height above the shoulder line, in face widths
    this.shoulderToFace = null;     // shoulder width / face width
    this.calibT = null;
  }

  /** Per-frame tracking state (filters, mode, hold buffer). */
  resetTracking() {
    this.filters.forEach((f) => f.reset());
    this.shoulderFilters.forEach((s) => s.reset());
    this.widthFilter.reset();
    this.anchorFilter.reset();
    this.mode = null;
    this.faceToPose = null; // learned offset (pose anchor − face anchor), world units
    this.vis = null;
    this._last = null;
    this._lastT = null;
    this._solveT = null;
  }

  reset() {
    this.resetCalibration();
    this.resetTracking();
  }

  /** Nothing tracked this frame: hold the last placement briefly, then fade and drop it. */
  _holdOrNone(out, t) {
    const last = this._last;
    if (!last || t - this._lastT > LOST_HOLD_S + LOST_FADE_S) {
      if (last) this.resetTracking();
      return out;
    }
    const k = 1 - smoothstep(LOST_HOLD_S, LOST_HOLD_S + LOST_FADE_S, t - this._lastT);
    return {
      ...last,
      crop: out.crop,
      faceDetected: false,
      poseDetected: false,
      held: true,
      necklace: { ...last.necklace, visibility: last.necklace.visibility * k },
    };
  }

  /**
   * @param {Object} f
   * @param {number} f.timeMs
   * @param {number} f.sourceWidth
   * @param {number} f.sourceHeight
   * @param {{width:number,height:number}} f.displaySize
   * @param {boolean} f.mirror
   * @param {Array<{x,y,z}>|null} f.landmarks - one face, normalized raw-frame coords
   * @param {Array<{x,y,z}>|null} [f.poseLandmarks] - body pose landmarks (33 points)
   * @param {Float32Array|Array|null} [f.matrix] - 4x4 facial transformation matrix
   * @returns {Object} `tracked` is true when a necklace placement exists (maybe held)
   */
  solve(f) {
    const crop = computeCoverCrop(f.displaySize.width, f.displaySize.height, f.sourceWidth, f.sourceHeight);
    const out = { crop, tracked: false, faceDetected: false, poseDetected: false, mode: null };
    const t = f.timeMs / 1000;
    const dt = this._solveT === null ? 1 / 30 : clamp(t - this._solveT, 0.001, 0.25);
    this._solveT = t;
    const toWorld = createViewMapper(crop, f.mirror);

    // ── Face ──────────────────────────────────────────────────────────
    const lm = f.landmarks;
    const faceOk = !!(lm && lm.length >= 455);
    let w = null;
    let frame = null;
    if (faceOk) {
      w = [];
      for (const i of USED) w[i] = toWorld(this.filters.get(i).filter(lm[i], t));
      frame = computeFaceFrame(w);
    } else {
      this.filters.forEach((flt) => flt.reset());
    }

    // ── Shoulders (pose) ──────────────────────────────────────────────
    const poseLm = f.poseLandmarks;
    const lS = poseLm && poseLm[POSE_LANDMARKS.leftShoulder];
    const rS = poseLm && poseLm[POSE_LANDMARKS.rightShoulder];
    const visOk = (p) => p && (p.visibility === undefined || p.visibility >= POSE_MIN_VISIBILITY);
    const inFrame = (p) => p.x > SHOULDER_EDGE_MARGIN && p.x < 1 - SHOULDER_EDGE_MARGIN &&
      p.y > SHOULDER_EDGE_MARGIN && p.y < 1 - SHOULDER_EDGE_MARGIN;
    let torsoFrame = null;
    if (visOk(lS) && visOk(rS) && inFrame(lS) && inFrame(rS)) {
      // Smooth the shoulders, and drop z (too noisy to be useful).
      const leftS = toWorld(this.shoulderFilters[0].filter(lS, t));
      const rightS = toWorld(this.shoulderFilters[1].filter(rS, t));
      leftS.z = 0;
      rightS.z = 0;
      torsoFrame = computeTorsoFrame(leftS, rightS);
      if (torsoFrame) {
        torsoFrame.shoulderMid = { x: (leftS.x + rightS.x) / 2, y: (leftS.y + rightS.y) / 2, z: 0 };
        // With a face present, a shoulder width wildly off the face width is a pose glitch.
        if (faceOk) {
          const ratio = torsoFrame.width / frame.width;
          if (ratio < SHOULDER_TO_FACE_RANGE[0] || ratio > SHOULDER_TO_FACE_RANGE[1]) torsoFrame = null;
        }
      }
    }
    if (!torsoFrame) this.shoulderFilters.forEach((s) => s.reset());

    if (!faceOk && !torsoFrame) return this._holdOrNone(out, t);

    // ── Calibration (only with a clean, frontal view of both) ─────────
    if (faceOk && torsoFrame && frame.forward.z >= CALIBRATION_MIN_FACING) {
      const up = torsoFrame.up;
      const c = w[152];
      const chinAbove = ((c.x - torsoFrame.shoulderMid.x) * up.x + (c.y - torsoFrame.shoulderMid.y) * up.y) / frame.width;
      const s2f = torsoFrame.width / frame.width;
      if (Number.isFinite(chinAbove) && Number.isFinite(s2f)) {
        const vC = clamp(chinAbove, CHIN_ABOVE_SHOULDERS_RANGE[0], CHIN_ABOVE_SHOULDERS_RANGE[1]);
        const vS = clamp(s2f, SHOULDER_TO_FACE_RANGE[0], SHOULDER_TO_FACE_RANGE[1]);
        if (this.chinAboveShoulders === null) {
          this.chinAboveShoulders = vC;
          this.shoulderToFace = vS;
        } else {
          const a = 1 - Math.exp(-Math.min(Math.max(t - (this.calibT ?? t), 0), 0.25) / CALIBRATION_TAU_S);
          this.chinAboveShoulders += (vC - this.chinAboveShoulders) * a;
          this.shoulderToFace += (vS - this.shoulderToFace) * a;
        }
        this.calibT = t;
      }
    }
    const chinAboveRatio = this.chinAboveShoulders ?? CHIN_ABOVE_SHOULDERS_SEED;
    const shoulderToFace = this.shoulderToFace ?? SHOULDER_TO_FACE_SEED;

    // ── Size reference (face widths) ──────────────────────────────────
    // Face width when the face is tracked; otherwise inferred from shoulder width.
    const rawW = faceOk ? frame.width : torsoFrame.width / shoulderToFace;
    const stableW = this.widthFilter.filter(rawW, t);

    // ── Anchor ────────────────────────────────────────────────────────
    const mode = torsoFrame ? (faceOk ? 'both' : 'pose') : 'face';

    // Face-only anchor: under the chin, on the neck's centre line (the face
    // forward vector tells which way the head is turned). Head-coupled, so it's
    // only the fallback when the shoulders are unavailable.
    const faceAnchor = faceOk
      ? {
        x: frame.mid.x - 0.21 * frame.forward.x * stableW,
        y: w[152].y - NECK_BASE_BELOW_CHIN * stableW,
      }
      : null;

    let rawPos = null;
    if (torsoFrame) {
      const lift = (chinAboveRatio - NECK_BASE_BELOW_CHIN) * stableW;
      rawPos = estimateNeckBase(torsoFrame, null, this.neckDown, lift);
      if (faceOk) {
        // Keep the neck base within a plausible band under the chin.
        const chinY = w[152].y;
        rawPos.y = Math.min(chinY - ANCHOR_BELOW_CHIN_MIN * stableW,
          Math.max(chinY - ANCHOR_BELOW_CHIN_MAX * stableW, rawPos.y));
        // Learn how the two anchors differ (frontal view only, slowly), so that
        // dropping the shoulders later doesn't make the necklace jump.
        if (frame.forward.z >= CALIBRATION_MIN_FACING) {
          const d = { x: rawPos.x - faceAnchor.x, y: rawPos.y - faceAnchor.y };
          if (this.faceToPose === null) this.faceToPose = d;
          else {
            const a = 1 - Math.exp(-dt / FACE_TO_POSE_TAU_S);
            this.faceToPose = {
              x: this.faceToPose.x + (d.x - this.faceToPose.x) * a,
              y: this.faceToPose.y + (d.y - this.faceToPose.y) * a,
            };
          }
        }
      }
    } else {
      // Shoulders cut off / unreliable: face anchor, corrected by the learned offset.
      const d = this.faceToPose || { x: 0, y: 0 };
      rawPos = { x: faceAnchor.x + d.x, y: faceAnchor.y + d.y };
    }
    // Depth: fixed offset from the image plane (as the occluders were tuned
    // for), never from the noisy pose z.
    rawPos.z = NECK_BASE_FORWARD * stableW + 0.01;
    rawPos.x += this.neckX * stableW; // manual nudge (?neckX=…)
    const smoothed = this.anchorFilter.filter(rawPos, t);
    this.mode = mode;

    // ── Orientation / size / visibility ───────────────────────────────
    const axes = necklaceAxes(torsoFrame);
    const neckWidth = stableW * this.neckWidthRatio;
    const visTarget = faceOk ? necklaceVisibility(frame) : 1;
    this.vis = this.vis === null ? visTarget : this.vis + (visTarget - this.vis) * (1 - Math.exp(-dt / VISIBILITY_TAU_S));

    out.necklace = { position: smoothed, axes, scale: neckWidth, visibility: this.vis };

    // ─── Depth occluders (aligned with torso if pose available, else world) ───
    const occAxes = axes;

    // Neck cylinder: centered on the neck column above the anchor.
    out.neckOccluder = {
      center: { x: smoothed.x, y: smoothed.y + 0.15 * stableW, z: smoothed.z - NECK_OCC_BACK * stableW },
      axes: occAxes,
      radii: [NECK_OCC_RADIUS_SIDE * stableW, 0.22 * stableW, NECK_OCC_RADIUS_FRONT * stableW],
    };

    // Chest box: below the neck base inside the torso.
    out.chestOccluder = {
      center: { x: smoothed.x, y: smoothed.y - CHEST_OCC_HALF_HEIGHT * stableW, z: smoothed.z - CHEST_OCC_HALF_DEPTH * stableW },
      axes: occAxes,
      radii: [CHEST_OCC_HALF_WIDTH * stableW, CHEST_OCC_HALF_HEIGHT * stableW, CHEST_OCC_HALF_DEPTH * stableW],
    };

    out.frame = faceOk ? { ...frame, mid: { x: frame.mid.x, y: frame.mid.y, z: 0 } } : null;
    out.tracked = true;
    out.faceDetected = faceOk;
    out.poseDetected = !!torsoFrame;
    out.mode = mode;
    out.faceWidth = stableW;
    out.torsoFrame = torsoFrame;
    this._last = out;
    this._lastT = t;
    return out;
  }
}
