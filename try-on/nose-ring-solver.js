/**
 * nose-ring-solver.js
 *
 * Decides where the nose ring sits, per frame, with no DOM / WebGL /
 * MediaPipe dependency (like earring-solver.js, so it can be replayed and
 * tested in Node).
 *
 *   face landmarks ─► One-Euro smoothing (only the points used)
 *                  ─► world space (view-mapping.js: crop + mirror, y up, +z = toward viewer)
 *                  ─► face frame: side axis, up axis, forward axis, face width W
 *                  ─► piercing point = the nostril-wing landmark + small offsets (in W)
 *                  ─► ring centre = a little below the piercing, so the gap of the
 *                     horseshoe (the ball/cone ends) reaches the piercing
 *                  ─► ring plane = the face's frontal plane, turned slightly outward;
 *                     it moves rigidly with the head (it is attached to the nose)
 *                  ─► hidden when the head turns the nostril away behind the nose bridge
 *
 * All offsets are fractions of W (distance between the face's outer edges at
 * ear level, landmarks 234/454; ~14 cm on an adult), so the placement
 * scales with distance and face size automatically.
 */

import { Vector3OneEuroFilter, OneEuroFilter } from './one-euro-filter.js';
import { computeCoverCrop, createViewMapper } from './view-mapping.js';
import { EAR_LANDMARKS, FACE_OVAL } from './face-tracking.js';
import { computeFaceFrame } from './earring-solver.js';

/** Real distance between landmarks 234 and 454 on an average adult face. */
export const FACE_WIDTH_MM = 140;

/** Default outer diameter of the ring when the catalog has none. */
export const DEFAULT_NOSE_RING_DIAMETER_MM = 10;

/**
 * Face-mesh landmarks on each nostril wing (the person's own sides; the
 * mesh is left/right symmetric: 64 ↔ 294, 129 ↔ 358).
 *   wing:  outer-lower part of the wing, where nostril studs/rings are pierced
 *   outer: the widest point of the wing (used for the debug view)
 */
export const NOSTRIL_LANDMARKS = {
  left: { wing: 294, outer: 358 },
  right: { wing: 64, outer: 129 },
};

/**
 * Piercing point relative to the wing landmark, in units of W along the face
 * frame axes: out = further from the nose centre, down = toward the chin,
 * forward = out of the face (the ring sits just in front of the skin).
 * First estimate from anatomy (the face mesh has no point for the piercing);
 * to be refined on the user's recordings.
 */
export const PIERCE_OFFSET = { out: -0.035, down: 0.004, forward: 0.02 };

/**
 * Where the ring's centre sits relative to the piercing, as a fraction of the
 * ring's diameter, straight down. The horseshoe is mounted gap-up (the ends
 * point up into the nostril); its ends reach 0.48 diameters above its centre,
 * so 0.2 puts the ends ~0.3 diameters above the piercing (inside the nostril)
 * and the arc ~0.7 diameters below it, hugging the rim of the wing.
 */
export const RING_CENTER_DROP = 0.2;

/** The ring's plane turns this far from the frontal plane toward the outside (degrees). */
export const RING_TILT_DEG = 20;

/**
 * The ring's gap (the end that goes into the nostril) is turned from "straight
 * up" toward the centre of the nose by this much (degrees), as on a real
 * hoop: the entry sits at the upper inner side of the ring, the rest of the
 * circle swings down and out around the wing.
 */
export const RING_ROLL_DEG = 40;

/**
 * Hiding: the nostril goes behind the nose bridge when the head turns away
 * from its side. The ring fades out between these turn angles of that side
 * of the head away from the camera.
 */
export const FADE_START_DEG = 20;
export const FADE_END_DEG = 36;

const LANDMARK_FILTER = { minCutoff: 1.0, beta: 4.0, dCutoff: 1.0 };
const SIZE_FILTER = { minCutoff: 0.4, beta: 0.002, dCutoff: 1.0 };

/** Landmarks used: both ears' cheek edge, forehead (10), chin (152), nose tip (1), both nostril wings. */
const USED = [...new Set([
  EAR_LANDMARKS.right.cheekEdge, EAR_LANDMARKS.left.cheekEdge, 10, 152, 1,
  ...Object.values(NOSTRIL_LANDMARKS.left), ...Object.values(NOSTRIL_LANDMARKS.right),
])];

/** Landmark ids to draw in the debug overlay. */
export const DEBUG_LANDMARKS = { ...NOSTRIL_LANDMARKS, face: FACE_OVAL };

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const len = (a) => Math.hypot(a.x, a.y, a.z);
const norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? mul(a, 1 / l) : { x: 0, y: 0, z: 0 };
};

const smoothstep = (a, b, x) => {
  const k = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return k * k * (3 - 2 * k);
};

/** Unit vector pointing away from the nose centre on the given side of the face. */
export function outwardAxis(frame, sideName) {
  return sideName === 'left' ? frame.side : mul(frame.side, -1);
}

/** Piercing point (world space) for one side. */
export function estimatePiercing(w, frame, sideName, offset = PIERCE_OFFSET) {
  const wing = w[NOSTRIL_LANDMARKS[sideName].wing];
  const W = frame.width;
  const out = outwardAxis(frame, sideName);
  return add(wing, add(mul(out, offset.out * W), add(mul(frame.up, -offset.down * W), mul(frame.forward, offset.forward * W))));
}

/**
 * Ring orientation. Model convention (nose-ring-model.js): the ring lies in
 * the XY plane, its gap on -Y. Here -Y is mapped to the face's "up" (gap up,
 * ends into the nostril) and Z (the ring's normal) to the face's forward,
 * turned `tiltDeg` toward the outside of the nose. `rollDeg` spins it about
 * its normal so the gap turns from "up" toward the nose centre (positive
 * values; the sign is mirrored for the other nostril; 180 = gap down).
 * @returns {{x,y,z}[]} model X, Y, Z axes in world space (right-handed)
 */
export function noseRingAxes(frame, sideName, tiltDeg = RING_TILT_DEG, rollDeg = RING_ROLL_DEG) {
  const out = outwardAxis(frame, sideName);
  const tilt = (tiltDeg * Math.PI) / 180;
  const z = norm(add(mul(frame.forward, Math.cos(tilt)), mul(out, Math.sin(tilt))));
  // Remove any component of "up" along the normal so Y stays in the ring's plane.
  const upRaw = mul(frame.up, -1);
  const y0 = norm(sub(upRaw, mul(z, upRaw.x * z.x + upRaw.y * z.y + upRaw.z * z.z)));
  const x0 = cross(y0, z);
  if (!rollDeg) return [x0, y0, z];
  const r = ((sideName === 'left' ? -rollDeg : rollDeg) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [add(mul(x0, c), mul(y0, s)), add(mul(y0, c), mul(x0, -s)), z];
}

/**
 * Turn-angle rule: 1 = visible, 0 = hidden, for the ring on one side, from how
 * far that side of the head has turned away from the camera (camera looks
 * along -z).
 */
export function noseRingVisibility(frame, sideName, startDeg = FADE_START_DEG, endDeg = FADE_END_DEG) {
  const out = outwardAxis(frame, sideName);
  const h = Math.hypot(out.x, out.z);
  if (h < 1e-6) return 1;
  const facing = out.z / h; // sin of the turn: + toward the camera, - away
  return smoothstep(-Math.sin((endDeg * Math.PI) / 180), -Math.sin((startDeg * Math.PI) / 180), facing);
}

export class NoseRingSolver {
  /**
   * @param {{diameterMm?:number, side?:'left'|'right', tiltDeg?:number, rollDeg?:number,
   *          offset?:{out:number,down:number,forward:number}, drop?:number}} [opts]
   */
  constructor(opts = {}) {
    this.diameterMm = opts.diameterMm || DEFAULT_NOSE_RING_DIAMETER_MM;
    this.side = opts.side === 'right' ? 'right' : 'left';
    this.tiltDeg = Number.isFinite(opts.tiltDeg) ? opts.tiltDeg : RING_TILT_DEG;
    this.rollDeg = Number.isFinite(opts.rollDeg) ? opts.rollDeg : RING_ROLL_DEG;
    this.offset = { ...PIERCE_OFFSET, ...(opts.offset || {}) };
    this.drop = Number.isFinite(opts.drop) ? opts.drop : RING_CENTER_DROP;
    this.filters = new Map(USED.map((i) => [i, new Vector3OneEuroFilter(LANDMARK_FILTER)]));
    this.widthFilter = new OneEuroFilter(SIZE_FILTER);
  }

  reset() {
    this.filters.forEach((f) => f.reset());
    this.widthFilter.reset();
  }

  /**
   * @param {Object} f
   * @param {number} f.timeMs
   * @param {number} f.sourceWidth
   * @param {number} f.sourceHeight
   * @param {{width:number,height:number}} f.displaySize
   * @param {boolean} f.mirror
   * @param {Array<{x,y,z}>|null} f.landmarks - one face, normalized raw-frame coords
   * @returns {Object} {crop, faceDetected, frame, ring:{position,axes,scale,visibility}, piercing, faceWidth}
   *   positions are world space; z relative to the face midpoint (+ = toward viewer).
   */
  solve(f) {
    const crop = computeCoverCrop(f.displaySize.width, f.displaySize.height, f.sourceWidth, f.sourceHeight);
    const out = { crop, faceDetected: false };
    const lm = f.landmarks;
    if (!lm || lm.length < 455) {
      this.reset();
      return out;
    }
    const t = f.timeMs / 1000;
    const toWorld = createViewMapper(crop, f.mirror);
    const w = [];
    for (const i of USED) w[i] = toWorld(this.filters.get(i).filter(lm[i], t));

    const frame = computeFaceFrame(w);
    frame.width = this.widthFilter.filter(frame.width, t);
    const W = frame.width;
    const z0 = frame.mid.z;
    const rel = (p) => ({ x: p.x, y: p.y, z: p.z - z0 });

    const diameter = (this.diameterMm / FACE_WIDTH_MM) * W;
    const pierce = estimatePiercing(w, frame, this.side, this.offset);
    const axes = noseRingAxes(frame, this.side, this.tiltDeg, this.rollDeg);
    // The ring hangs from the piercing along the ring's own "gap" direction (-Y of the model).
    const center = add(pierce, mul(axes[1], this.drop * diameter));

    out.ring = {
      position: rel(center),
      axes,
      scale: diameter,
      visibility: noseRingVisibility(frame, this.side),
    };
    out.piercing = rel(pierce);
    out.side = this.side;
    out.frame = { ...frame, mid: rel(frame.mid) };
    out.faceDetected = true;
    out.faceWidth = W;
    return out;
  }
}
