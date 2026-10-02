/**
 * hand-metric.js
 *
 * Gives the ring a size that does NOT change when the hand turns.
 *
 * MediaPipe returns each hand twice: `landmarks` (normalized image
 * coordinates) and `worldLandmarks` (metres, origin at the hand centre).
 * Measured on real tasks-vision 1.0.1 output (14 rotated / foreshortened
 * photo variants): worldLandmarks x/y are aligned with the image axes
 * (x right, y down) and z points away from the camera, same as image z.
 *
 * So a least-squares scale + translation that maps world (x, y) onto the
 * image points gives "image pixels per metre" for the hand. When the hand
 * rotates in 3D, MediaPipe rotates the world points too, so the fit keeps
 * tracking distance-to-camera instead of how foreshortened the hand looks.
 * On the real photos this held within 0.91–1.05 across rotations and
 * squashes, where the old knuckle-spacing size swung 0.60–1.02.
 *
 * Fitting all 21 points (rather than only the rigid palm) proved most
 * stable; the fit's residual is a useful "is this frame trustworthy" signal.
 *
 * Pure functions; no DOM, no Three.js.
 */

/**
 * @param {Array<{x:number,y:number}>} landmarks - normalized image coords (21)
 * @param {Array<{x:number,y:number,z:number}>} worldLandmarks - metres (21)
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @returns {{pxPerMeter:number, residualMm:number, knuckleSpanMm:number}|null}
 *   pxPerMeter: source-image pixels per metre at the hand's distance
 *   residualMm: RMS fit error in millimetres (lower = more trustworthy)
 *   knuckleSpanMm: 3D index-to-pinky knuckle distance (plausibility check)
 */
export function computeHandMetric(landmarks, worldLandmarks, sourceWidth, sourceHeight) {
  if (!landmarks || !worldLandmarks || landmarks.length < 21 || worldLandmarks.length < 21) return null;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return null;
  const n = 21;
  let mpx = 0, mpy = 0, mqx = 0, mqy = 0;
  for (let i = 0; i < n; i++) {
    const w = worldLandmarks[i];
    const l = landmarks[i];
    if (!w || !l || !Number.isFinite(w.x) || !Number.isFinite(w.y) || !Number.isFinite(l.x) || !Number.isFinite(l.y)) return null;
    mpx += w.x; mpy += w.y;
    mqx += l.x * sourceWidth; mqy += l.y * sourceHeight;
  }
  mpx /= n; mpy /= n; mqx /= n; mqy /= n;

  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const px = worldLandmarks[i].x - mpx;
    const py = worldLandmarks[i].y - mpy;
    num += px * (landmarks[i].x * sourceWidth - mqx) + py * (landmarks[i].y * sourceHeight - mqy);
    den += px * px + py * py;
  }
  if (!(den > 1e-12) || !(num > 0)) return null;
  const s = num / den;

  let err = 0;
  for (let i = 0; i < n; i++) {
    const ex = s * (worldLandmarks[i].x - mpx) - (landmarks[i].x * sourceWidth - mqx);
    const ey = s * (worldLandmarks[i].y - mpy) - (landmarks[i].y * sourceHeight - mqy);
    err += ex * ex + ey * ey;
  }
  const residualMm = (Math.sqrt(err / n) / s) * 1000;
  const k5 = worldLandmarks[5];
  const k17 = worldLandmarks[17];
  const knuckleSpanMm = Math.hypot(k5.x - k17.x, k5.y - k17.y, (k5.z || 0) - (k17.z || 0)) * 1000;
  return { pxPerMeter: s, residualMm, knuckleSpanMm };
}

/**
 * Whether MediaPipe's 3D hand is believable enough to size from.
 * Adult index-to-pinky knuckle spans are roughly 60–90 mm. Measured on
 * real output: a good fit read 49–65 mm; a broken close-up read 13–33 mm
 * while its fit residual (8–10 mm) still looked acceptable — so the span
 * is the stronger signal.
 */
export const PLAUSIBLE_KNUCKLE_SPAN_MM = [42, 120];
export const MAX_TRUSTED_RESIDUAL_MM = 12;

export function isHandMetricTrusted(metric) {
  return !!metric &&
    metric.residualMm <= MAX_TRUSTED_RESIDUAL_MM &&
    metric.knuckleSpanMm >= PLAUSIBLE_KNUCKLE_SPAN_MM[0] &&
    metric.knuckleSpanMm <= PLAUSIBLE_KNUCKLE_SPAN_MM[1];
}

/**
 * Tilt of the ring finger's base segment (MCP 13 -> PIP 14) toward or away
 * from the camera, from world landmarks. Positive = the finger points away
 * from the camera. Image-space z for single joints is far noisier than the
 * world model, whose finger is constrained by a full 3D hand shape.
 *
 * @returns {number|null} sin(tilt), in [-1, 1]
 */
export function computeFingerTiltSin(worldLandmarks) {
  if (!worldLandmarks || worldLandmarks.length < 21) return null;
  const a = worldLandmarks[13];
  const b = worldLandmarks[14];
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 1e-6)) return null;
  return dz / len;
}

/**
 * Ring-finger width estimate in metres from the world hand's knuckle
 * spacing — used when the skin mask never gets a clean measurement.
 * World distances don't change with hand rotation (unlike screen spacing).
 */
export function estimateFingerWidthMeters(worldLandmarks, ratio = 0.85) {
  if (!worldLandmarks || worldLandmarks.length < 21) return null;
  const d = (i, j) => {
    const a = worldLandmarks[i], b = worldLandmarks[j];
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  };
  const spacing = (d(13, 9) + d(17, 13)) / 2;
  return spacing > 0 ? spacing * ratio : null;
}
