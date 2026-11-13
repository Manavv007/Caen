/**
 * ring-anchor.js
 *
 * Turns (smoothed) MediaPipe hand landmarks into a ring pose in the world
 * space of three-scene.js (see view-mapping.js for the mapping).
 *
 * Pose conventions (consumed by three-scene.js):
 *   - yAxis: along the finger (MCP -> PIP); the ring's hole axis.
 *   - zAxis: toward the back of the hand (dorsal), made orthogonal to y.
 *     A ring head/stone authored on the model's +Z sits on the back of the
 *     finger. Without a dorsal estimate, falls back to the knuckle-line normal.
 *   - xAxis: y × z (right-handed).
 *   - fingerWidth: the finger's on-screen width. Measured from the skin mask
 *     when available (finger-measure.js), else estimated from knuckle spacing.
 */

export const LM = {
  WRIST: 0,
  INDEX_MCP: 5,
  MIDDLE_MCP: 9,
  RING_MCP: 13,
  RING_PIP: 14,
  PINKY_MCP: 17,
};

export const RING_KEYPOINT_NAMES = ['wrist', 'ringMcp', 'ringPip', 'middleMcp', 'pinkyMcp', 'indexMcp'];

/**
 * Where along the proximal phalanx the ring sits: 0 = knuckle (MCP),
 * 1 = middle joint (PIP). MediaPipe's MCP point is the joint centre,
 * below the visible finger webbing; 0.35 rendered too low in live testing.
 */
export const RING_POSITION_ALONG_FINGER = 0.5;

/**
 * Finger width relative to neighbouring-knuckle spacing — the fallback
 * estimate when the skin mask can't measure the finger.
 */
export const FINGER_WIDTH_FROM_KNUCKLE_SPACING = 0.85;

/**
 * @param {Array<{x:number,y:number,z:number}>|null} landmarks - 21 landmarks (any space)
 */
export function extractRingKeypoints(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return null;
  const kp = {
    wrist: landmarks[LM.WRIST],
    ringMcp: landmarks[LM.RING_MCP],
    ringPip: landmarks[LM.RING_PIP],
    middleMcp: landmarks[LM.MIDDLE_MCP],
    pinkyMcp: landmarks[LM.PINKY_MCP],
    indexMcp: landmarks[LM.INDEX_MCP],
  };
  for (const name of RING_KEYPOINT_NAMES) {
    const p = kp[name];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }
  return kp;
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: (a.z || 0) + (b.z || 0) });
const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: (a.z || 0) * s });
const dot = (a, b) => a.x * b.x + a.y * b.y + (a.z || 0) * (b.z || 0);
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const length = (a) => Math.sqrt(dot(a, a));
const normalize = (a) => {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : null;
};

/** Knuckle-spacing finger width estimate (world units). */
export function estimateFingerWidthFromKnuckles(wp) {
  const spacing = (length(sub(wp.ringMcp, wp.middleMcp)) + length(sub(wp.pinkyMcp, wp.ringMcp))) / 2;
  return spacing * FINGER_WIDTH_FROM_KNUCKLE_SPACING;
}

/**
 * @typedef {Object} RingPose
 * @property {boolean} valid
 * @property {{x,y,z}} position - world-space ring centre
 * @property {{x,y,z}} xAxis
 * @property {{x,y,z}} yAxis - along the finger
 * @property {{x,y,z}} zAxis - toward the back of the hand when known
 * @property {number} fingerWidth - world units
 * @property {number} fingerLength - world units, MCP->PIP
 */

/**
 * Max tilt of the ring's axis toward/away from the camera. Beyond this the
 * depth estimate is unreliable and an over-tilted ring shows its top rim
 * ("crown sitting on the finger").
 */
export const MAX_FINGER_TILT_DEG = 35;

/**
 * Ring axis from the finger's on-screen direction plus a separate tilt.
 * The on-screen direction is precise; per-joint depth from the image is
 * noisy, so the tilt comes from MediaPipe's world (3D) hand model instead
 * and is clamped to ±MAX_FINGER_TILT_DEG.
 *
 * @param {{x,y}} screenDir - world-space x/y direction of MCP->PIP (any length)
 * @param {number} tiltSin - sin(tilt) in camera terms; + = pointing away from the camera
 * @returns {{x,y,z}|null} unit vector in scene space (+z toward the camera)
 */
export function fingerAxisFromScreenAndTilt(screenDir, tiltSin) {
  const len = Math.hypot(screenDir.x, screenDir.y);
  if (!(len > 1e-9)) return null;
  const maxSin = Math.sin((MAX_FINGER_TILT_DEG * Math.PI) / 180);
  const s = Math.min(Math.max(Number.isFinite(tiltSin) ? tiltSin : 0, -maxSin), maxSin);
  const c = Math.sqrt(1 - s * s);
  // Scene +z points toward the camera; "away from the camera" is -z.
  return { x: (screenDir.x / len) * c, y: (screenDir.y / len) * c, z: -s };
}

/**
 * @param {Object|null} wp - keypoints in WORLD space (extractRingKeypoints output)
 * @param {Object} [opts]
 * @param {number} [opts.fingerWidth] - finger width (world); defaults to knuckle estimate
 * @param {{x,y,z}} [opts.dorsal] - world direction of the back of the hand
 * @param {{x,y,z}} [opts.positionOffset] - world offset added to the ring centre (lateral centring)
 * @param {{x,y,z}} [opts.fingerAxis] - unit ring axis (see fingerAxisFromScreenAndTilt);
 *   defaults to the MCP->PIP direction from the keypoints
 * @returns {RingPose}
 */
export function computeRingPose(wp, opts = {}) {
  const invalid = { valid: false };
  if (!wp) return invalid;

  const along = sub(wp.ringPip, wp.ringMcp);
  const fingerLength = length(along);
  const yAxis = opts.fingerAxis ? normalize(opts.fingerAxis) : normalize(along);
  if (!yAxis || !(fingerLength > 1e-9)) return invalid;

  const orthToY = (v) => (v ? normalize(sub(v, scale(yAxis, dot(v, yAxis)))) : null);

  let zAxis = opts.dorsal ? orthToY(opts.dorsal) : null;
  if (!zAxis) {
    // Fallback: normal of the knuckle line (sign arbitrary but stable).
    let across = sub(wp.pinkyMcp, wp.middleMcp);
    if (length(across) < 1e-6) across = sub(wp.pinkyMcp, wp.indexMcp);
    const xGuess = orthToY(across);
    zAxis = xGuess ? cross(xGuess, yAxis) : null;
    if (!zAxis) {
      const helper = Math.abs(yAxis.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
      zAxis = orthToY(helper);
    }
  }
  const xAxis = cross(yAxis, zAxis); // unit: y ⟂ z, both unit

  const estimated = estimateFingerWidthFromKnuckles(wp);
  const fingerWidth = opts.fingerWidth > 0 ? opts.fingerWidth : estimated;
  if (!(fingerWidth > 1e-6)) return invalid;

  let position = add(wp.ringMcp, scale(along, RING_POSITION_ALONG_FINGER));
  if (opts.positionOffset) position = add(position, opts.positionOffset);

  return { valid: true, position, xAxis, yAxis, zAxis, fingerWidth, fingerLength };
}

/**
 * Holds the last valid pose through brief tracking dropouts, then releases.
 */
export class RingPoseHold {
  constructor(maxMissedFrames = 8) {
    this.maxMissedFrames = maxMissedFrames;
    this._last = null;
    this._missed = 0;
  }

  update(pose) {
    if (pose && pose.valid) {
      this._last = pose;
      this._missed = 0;
      return { ...pose, stale: false };
    }
    this._missed += 1;
    if (this._last && this._missed <= this.maxMissedFrames) {
      return { ...this._last, stale: true };
    }
    this._last = null;
    return { valid: false, stale: false };
  }

  reset() {
    this._last = null;
    this._missed = 0;
  }
}
