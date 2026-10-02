/**
 * earring-solver.js
 *
 * Decides where each earring hangs, per frame, with no DOM / WebGL /
 * MediaPipe dependency (like ring-solver.js, so it can be replayed and
 * tested in Node).
 *
 *   face landmarks ─► One-Euro smoothing (only the points used)
 *                  ─► world space (view-mapping.js: crop + mirror, y up, +z = toward viewer)
 *                  ─► face frame: side axis, up axis, forward axis, face width W
 *                  ─► earlobe per side = point in front of the ear + offsets in face units
 *                  ─► earring: hangs straight down (gravity), turned with the head
 *                  ─► far earring hidden when its lobe goes inside the face outline
 *                     (plus a turn-angle backstop and head + neck depth occluders)
 *
 * All offsets are fractions of W (distance between the face's outer edges
 * at ear level, landmarks 234/454; ~14 cm on an adult), so the placement
 * scales with distance and face size automatically.
 */

import { Vector3OneEuroFilter, OneEuroFilter } from './one-euro-filter.js';
import { computeCoverCrop, createViewMapper } from './view-mapping.js';
import { EAR_LANDMARKS, FACE_OVAL } from './face-tracking.js';
import { computeCameraFrame } from './three-scene.js';

/** Real distance between landmarks 234 and 454 on an average adult face. */
export const FACE_WIDTH_MM = 140;

/** Default earring length (attachment point to bottom) when the catalog has none. */
export const DEFAULT_EARRING_LENGTH_MM = 48;

/**
 * Earlobe attachment point relative to the face-edge landmark in front of
 * the ear (234 / 454), in units of W along the face frame axes:
 *   out: further to that side; down: toward the chin; back: away from the face.
 * Tuned on real frames: frontal (Phase 3) and the user's head-turn
 * Fitted (least squares) to 12 earlobe piercing points marked by hand in
 * the user's recording (head turns −49°…+40°), with the perspective
 * correction below: error 8.5% W rms -> 2.5% W (~3.5 mm). The previous
 * hand-tuned value (out 0.06, down 0.155, back 0.16) sat behind, outside
 * and above the lobe.
 */
export const LOBE_OFFSET = { out: 0.015, down: 0.205, back: 0.09 };

/**
 * Head and neck as ellipsoid / cylinder occluders, in units of W, in the
 * face frame relative to the midpoint between 234 and 454.
 * The head is slightly narrower than the lobe distance so the near-side
 * earring is never clipped; it only hides the far-side one when the
 * head turns.
 */
export const HEAD_OCCLUDER = { back: 0.55, up: 0.12, radiusSide: 0.47, radiusUp: 0.68, radiusFront: 0.62 };
export const NECK_OCCLUDER = { back: 0.5, top: -0.35, length: 1.6, radiusSide: 0.33, radiusFront: 0.36 };

const LANDMARK_FILTER = { minCutoff: 1.2, beta: 6.0, dCutoff: 1.0 };
const SIZE_FILTER = { minCutoff: 0.4, beta: 0.002, dCutoff: 1.0 };
/** Landmarks used: ear-area points, forehead (10), chin (152), nose tip (1), face outline. */
const USED = [...new Set([...Object.values(EAR_LANDMARKS.right), ...Object.values(EAR_LANDMARKS.left), 10, 152, 1, ...FACE_OVAL])];

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const len = (a) => Math.hypot(a.x, a.y, a.z);
const norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? mul(a, 1 / l) : { x: 0, y: 0, z: 0 };
};

/**
 * Face frame from world-space landmarks.
 * @returns {{mid, side, up, forward, width:number}} side points from the
 *   person's right ear toward their left ear; forward points out of the face.
 */
export function computeFaceFrame(w) {
  const R = w[EAR_LANDMARKS.right.cheekEdge];
  const L = w[EAR_LANDMARKS.left.cheekEdge];
  const mid = mul(add(R, L), 0.5);
  const sideRaw = sub(L, R);
  const width = len(sideRaw);
  const side = norm(sideRaw);
  const upRaw = sub(w[10], w[152]);
  const up = norm(sub(upRaw, mul(side, dot(upRaw, side))));
  let forward = norm(cross(up, side));
  // The nose is in front of the ear line: use it to pick the sign, so the
  // frame is right whether or not the image is mirrored.
  if (dot(forward, sub(w[1], mid)) < 0) forward = mul(forward, -1);
  return { mid, side, up, forward, width };
}

/** Earlobe attachment point for one side ('right' | 'left') in world space. */
export function estimateLobe(w, frame, sideName, offset = LOBE_OFFSET) {
  const edge = w[EAR_LANDMARKS[sideName].cheekEdge];
  const out = sideName === 'left' ? frame.side : mul(frame.side, -1);
  const W = frame.width;
  return add(edge, add(mul(out, offset.out * W), add(mul(frame.up, -offset.down * W), mul(frame.forward, -offset.back * W))));
}

/**
 * Landmark x/y are true image positions, but the offsets above are added
 * at the cheek landmark's depth. The lobe is deeper (further from the
 * camera), so it really appears pulled toward the image centre by
 * 1 / (1 + depth / focal). Matters most up close: with the face filling
 * the screen, the lobe shows up visibly higher and closer to the face.
 * @param {{x,y,z}} lobe - world space (image centre at x = y = 0, +z toward camera)
 * @param {{x,y,z}} edge - the cheek landmark the offset was added to
 * @param {number} focal - camera distance to the z = 0 plane, world units
 */
export function applyLobePerspective(lobe, edge, focal) {
  const k = 1 / (1 - (lobe.z - edge.z) / focal);
  return { x: lobe.x * k, y: lobe.y * k, z: lobe.z };
}

/**
 * Earring orientation: hangs straight down regardless of head tilt, and
 * turns with the head about the vertical. Model convention
 * (earring-model.js): +Y up (hangs to -Y), the hook's plane is the model's
 * XY plane with its free end toward +X, which goes BEHIND the earlobe.
 * @returns {{x,y,z}[]} model X, Y, Z axes in world space
 */
export function earringAxes(frame) {
  const back = { x: -frame.forward.x, y: 0, z: -frame.forward.z };
  const xAxis = len(back) > 1e-6 ? norm(back) : { x: 0, y: 0, z: -1 };
  const yAxis = { x: 0, y: 1, z: 0 };
  return [xAxis, yAxis, cross(xAxis, yAxis)];
}

/**
 * Far-side earring hiding, two rules (the earring shows at the lower value).
 * Measured on both user recordings (~600 ear samples) with the fitted lobe:
 * lobe-to-face-outline distance is +0.02 W (median) facing the camera,
 * −0.013 W at 10–20° turned away, −0.026 W at 20–30°, < −0.04 W beyond;
 * the near ear is always ≥ +0.04 W outside.
 *
 * 1. Turn angle (main rule): the far earring fades out between
 *    FADE_START_DEG and FADE_END_DEG of that ear turning away. In the
 *    first recording the far earring was visibly drawn on the cheek from
 *    ~25° of turn.
 * 2. Silhouette (backup, e.g. odd face shapes): hidden once the lobe is
 *    clearly inside the face outline. Loose thresholds, because the lobe
 *    sits close to the jaw outline even when facing the camera.
 *
 * The head/neck occluders alone don't hide it reliably: the real ear sits
 * outside any head shape narrow enough not to clip the near-side earring.
 */
export const SIL_SHOW_W = -0.01;
export const SIL_HIDE_W = -0.04;
export const FADE_START_DEG = 15;
export const FADE_END_DEG = 28;

const smoothstep = (a, b, x) => {
  const k = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return k * k * (3 - 2 * k);
};

/** Signed 2D distance (x, y only) from p to a closed polygon: + outside, − inside. */
export function signedDistance2D(p, poly) {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const l2 = abx * abx + aby * aby;
    const k = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - k * abx, p.y - a.y - k * aby));
  }
  return inside ? -best : best;
}

/** Silhouette rule: visibility from where the lobe is relative to the face outline. */
export function silhouetteVisibility(lobe, outline, W) {
  return smoothstep(SIL_HIDE_W, SIL_SHOW_W, signedDistance2D(lobe, outline) / W);
}

/**
 * Turn-angle rule: 1 = visible, 0 = hidden, for one ear, from how far
 * that side of the head has turned away from the camera (camera looks
 * along -z).
 */
export function earVisibility(frame, sideName) {
  const out = sideName === 'left' ? frame.side : mul(frame.side, -1);
  const h = Math.hypot(out.x, out.z);
  if (h < 1e-6) return 1;
  const facing = out.z / h; // sin of the turn: + toward the camera, - away
  return smoothstep(-Math.sin((FADE_END_DEG * Math.PI) / 180), -Math.sin((FADE_START_DEG * Math.PI) / 180), facing);
}

export class EarringSolver {
  /** @param {{lengthMm?:number}} [opts] */
  constructor(opts = {}) {
    this.lengthMm = opts.lengthMm || DEFAULT_EARRING_LENGTH_MM;
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
   * @returns {Object} {crop, faceDetected, frame, earrings: {right,left}, head, neck}
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

    const axes = earringAxes(frame);
    const length = (this.lengthMm / FACE_WIDTH_MM) * W;
    const outline = FACE_OVAL.map((i) => w[i]);
    const focal = computeCameraFrame(crop.containerAspect, f.sourceWidth / f.sourceHeight, crop.cropHeight).distance;
    out.earrings = {};
    for (const side of ['right', 'left']) {
      const lobe = applyLobePerspective(estimateLobe(w, frame, side), w[EAR_LANDMARKS[side].cheekEdge], focal);
      out.earrings[side] = {
        position: rel(lobe),
        axes,
        length,
        visibility: Math.min(earVisibility(frame, side), silhouetteVisibility(lobe, outline, W)),
      };
    }

    const H = HEAD_OCCLUDER;
    // Occluders are symmetric, so only a valid rotation matters: use a
    // right-handed basis (forward may point either way along side × up).
    const occAxes = [frame.side, frame.up, cross(frame.side, frame.up)];
    out.head = {
      center: rel(add(frame.mid, add(mul(frame.forward, -H.back * W), mul(frame.up, H.up * W)))),
      axes: occAxes,
      radii: [H.radiusSide * W, H.radiusUp * W, H.radiusFront * W],
    };
    const N = NECK_OCCLUDER;
    out.neck = {
      // centre of the neck cylinder, axis along the head's up vector
      center: rel(add(frame.mid, add(mul(frame.forward, -N.back * W), mul(frame.up, (N.top - N.length / 2) * W)))),
      axes: occAxes,
      radii: [N.radiusSide * W, (N.length / 2) * W, N.radiusFront * W],
    };
    out.frame = { ...frame, mid: rel(frame.mid) };
    out.faceDetected = true;
    out.faceWidth = W;
    return out;
  }
}
