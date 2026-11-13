/**
 * hand-facing.js
 *
 * Works out which side of the hand faces the camera, and the direction
 * the back of the hand (dorsal side) points. The dorsal direction orients
 * the ring so a stone/head sits on the back of the finger and turns away
 * from the camera when the palm is shown.
 *
 * Method: n = (indexMCP - wrist) × (pinkyMCP - wrist) in raw image space
 * (x right, y down, z away from camera — right-handed, not mirrored). For
 * a given real hand (left/right), anatomy fixes which side n points to,
 * so: dorsal = n × DORSAL_SIGN[hand]. Only n's sign along z decides
 * palm/back, and that comes from the 2D layout (no noisy depth needed).
 *
 * Handedness: MediaPipe's docs say its labels assume a mirrored (selfie)
 * input. Measured with tasks-vision 1.0.1 on real, UNMIRRORED photos (the
 * kind of frame we feed it — the live view is only mirrored by CSS), the
 * label already names the real hand: back of a left hand -> "Left" (0.97),
 * right palm -> "Right" (0.92). So no swap.
 */

/**
 * dorsal = n * DORSAL_SIGN[realHand]. Verified on real photos with
 * MediaPipe: right palm -> palm facing; back of left hand -> back facing.
 */
export const DORSAL_SIGN = { Right: -1, Left: 1 };

/** Real hand from MediaPipe's label on an UNMIRRORED input (see note above). */
export function realHandFromLabel(label) {
  return label === 'Left' || label === 'Right' ? label : null;
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/**
 * @param {Array<{x,y,z}>} landmarks - raw normalized landmarks (21)
 * @param {'Left'|'Right'} realHand
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @returns {{backFacing:boolean, confidence:number, dorsalRaw:{x,y,z}}|null}
 *   dorsalRaw: unit vector in raw pixel-space axes (x right, y down, z away)
 *   confidence: |dorsal.z| — 1 = hand flat to camera, 0 = edge-on
 */
export function computeHandFacing(landmarks, realHand, sourceWidth, sourceHeight) {
  if (!landmarks || landmarks.length < 21 || !DORSAL_SIGN[realHand]) return null;
  // Pixel-space so x and y share a scale; MediaPipe z uses roughly x's scale.
  const P = (lm) => ({ x: lm.x * sourceWidth, y: lm.y * sourceHeight, z: (lm.z || 0) * sourceWidth });
  const w = P(landmarks[0]);
  const n = cross(sub(P(landmarks[5]), w), sub(P(landmarks[17]), w));
  const s = DORSAL_SIGN[realHand];
  const d = { x: n.x * s, y: n.y * s, z: n.z * s };
  const len = Math.hypot(d.x, d.y, d.z);
  if (len < 1e-9) return null;
  const dorsalRaw = { x: d.x / len, y: d.y / len, z: d.z / len };
  // z points away from the camera: dorsal pointing toward the camera (z < 0) = back of hand visible.
  return { backFacing: dorsalRaw.z < 0, confidence: Math.abs(dorsalRaw.z), dorsalRaw };
}

/**
 * Smooths handedness (MediaPipe's label can flicker for a frame or two)
 * and adds hysteresis to palm/back so the stone doesn't flip while the
 * hand is edge-on.
 */
export class HandFacingTracker {
  constructor({ switchConfidence = 0.3, handednessSmoothing = 0.15 } = {}) {
    this.switchConfidence = switchConfidence;
    this.handednessSmoothing = handednessSmoothing;
    this.reset();
  }

  reset() {
    this._pRight = null; // smoothed probability the real hand is a right hand
    this._backFacing = null;
  }

  /**
   * @param {Array} landmarks - raw normalized
   * @param {{categoryName:string, score:number}|null} handedness - MediaPipe's top category
   */
  update(landmarks, handedness, sourceWidth, sourceHeight) {
    const real = handedness ? realHandFromLabel(handedness.categoryName) : null;
    if (real) {
      const score = Number.isFinite(handedness.score) ? handedness.score : 1;
      const pRightNow = real === 'Right' ? score : 1 - score;
      this._pRight = this._pRight === null
        ? pRightNow
        : this._pRight + (pRightNow - this._pRight) * this.handednessSmoothing;
    }
    if (this._pRight === null) return null;
    const hand = this._pRight >= 0.5 ? 'Right' : 'Left';

    const f = computeHandFacing(landmarks, hand, sourceWidth, sourceHeight);
    if (!f) return null;
    if (this._backFacing === null || (f.backFacing !== this._backFacing && f.confidence >= this.switchConfidence)) {
      this._backFacing = f.backFacing;
    }
    // Keep the dorsal vector consistent with the (hysteresis) facing state.
    let dorsalRaw = f.dorsalRaw;
    if ((dorsalRaw.z < 0) !== this._backFacing) {
      dorsalRaw = { x: dorsalRaw.x, y: dorsalRaw.y, z: -dorsalRaw.z };
    }
    return { hand, backFacing: this._backFacing, confidence: f.confidence, dorsalRaw };
  }
}
