/**
 * ring-sizer.js
 *
 * Locks the ring's size during the first seconds, then keeps it fixed.
 *
 * "Fixed" means fixed relative to the hand's distance from the camera,
 * not fixed in screen pixels: the lock stores
 *     lockedRatio = finger width (px) / hand scale (px per unit)
 * and afterwards  on-screen width = lockedRatio × current hand scale.
 * The ring still grows/shrinks as the hand moves toward/away from the
 * camera, but not when the hand rotates.
 *
 * Two hand scales are tracked, and one is chosen per session at lock time:
 *   - 'world': image pixels per metre from fitting MediaPipe's 3D hand to
 *     the image (hand-metric.js). Rotation-invariant — but only when the
 *     3D hand is believable. Measured on real output: a palm photo gave a
 *     realistic 3D hand (knuckle span 49–65 mm) and cut size swings from
 *     40% to 9%; a top-down close-up gave an impossible one (13–33 mm)
 *     and the 3D scale was no better than the screen one.
 *   - 'screen': on-screen knuckle spacing (the previous behaviour). Used
 *     when the 3D hand wasn't trustworthy for most sizing frames.
 *
 * Only good frames count toward the lock: finger measured on BOTH sides,
 * hand fairly flat to the camera, finger not pointing toward/away from the
 * camera, hand nearly still. The robust mean of the samples becomes the lock.
 * Without clean measurements before the timeout it locks to a knuckle-
 * spacing estimate taken while the hand was flat.
 *
 * Pure state machine; no DOM.
 */

export const SIZER_DEFAULTS = {
  samplesNeeded: 15,
  timeoutMs: 4000,
  /** |dorsal·camera| at least this: hand within ~45° of flat to the camera. */
  minFacingConfidence: 0.7,
  /**
   * |sin(finger tilt)| at most this: finger within ~35° of the image plane
   * (matches the orientation clamp). MediaPipe's 3D tilt carries a bias of
   * up to ~30° on some hands (measured: a flat hand reading 18–31°), so a
   * tighter gate never passed for those users.
   */
  maxFingerTiltSin: 0.57,
  /** Hand speed below this (finger widths per second). */
  maxSpeedWidthsPerSec: 1.5,
  /** Samples further than this from the median are discarded. */
  outlierFraction: 0.15,
  /** Use the 3D ('world') scale if it was trusted on at least this fraction of sizing frames. */
  minWorldTrustedFraction: 0.6,
  /** Hand absent this long -> forget the lock (could be a different person). */
  resetAfterAbsentMs: 3000,
  /** Longest the sizer waits for the skin model to finish loading before falling back. */
  maxWaitForMeasurementMs: 12000,
  /**
   * The timeout also needs this many processed hand frames, so a slow
   * device still gets a fair number of chances to measure first.
   */
  minFramesBeforeTimeout: 30,
  /** Sizing always finishes within this long (after the skin model is ready). */
  hardTimeoutMs: 10000,
};

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Robust centre: median, then mean of samples within ±outlierFraction of it. */
export function robustWidth(samples, outlierFraction) {
  if (!samples.length) return null;
  const m = median(samples);
  const kept = samples.filter((s) => Math.abs(s - m) <= m * outlierFraction);
  return kept.length ? kept.reduce((a, b) => a + b, 0) / kept.length : m;
}

export class RingSizer {
  constructor(options = {}) {
    this.opts = { ...SIZER_DEFAULTS, ...options };
    this.reset();
  }

  /** Start a fresh sizing pass (Resize button, or a new hand). */
  reset() {
    this.state = 'idle'; // idle -> sizing -> locked
    this.samples = []; // [{world: ratio|null, screen: ratio}]
    this.lockedRatio = null;
    this.scaleMode = null; // 'world' | 'screen'
    this.lockSource = null; // 'measured' | 'estimated'
    this.lastRejectReason = null;
    this._sizingStart = null;
    this._firstSeen = null;
    this._lastSeen = null;
    this._framesSeen = 0;
    this._worldTrustedFrames = 0;
    this._estimates = [];
  }

  get locked() {
    return this.state === 'locked';
  }

  /** 0..1 progress for the sizing UI. */
  get progress() {
    if (this.state === 'locked') return 1;
    return Math.min(this.samples.length / this.opts.samplesNeeded, 1);
  }

  /**
   * Feed one frame.
   *
   * @param {Object} f
   * @param {number} f.timeMs
   * @param {boolean} f.handPresent
   * @param {number|null} [f.worldScale] - px per metre from a TRUSTED 3D hand fit this frame, else null
   * @param {number} [f.screenScale] - on-screen hand scale (px per nominal unit), always available
   * @param {number|null} [f.measuredWidthPx] - skin-mask finger width this frame
   * @param {boolean} [f.twoSided]
   * @param {number} [f.facingConfidence] - |dorsal z|, 1 = flat to camera
   * @param {number} [f.fingerTiltSin]
   * @param {number} [f.speedWidthsPerSec]
   * @param {number} [f.screenEstimateWidthPx] - knuckle-spacing finger width estimate (px)
   * @param {boolean} [f.measurementPending] - skin model still loading
   * @returns {{state:string, progress:number, accepted:boolean}}
   */
  update(f) {
    const o = this.opts;
    if (!f.handPresent) {
      if (this._lastSeen !== null && f.timeMs - this._lastSeen > o.resetAfterAbsentMs && this.state !== 'idle') {
        this.reset();
      }
      return { state: this.state, progress: this.progress, accepted: false };
    }
    this._lastSeen = f.timeMs;
    if (this.state === 'locked') return { state: this.state, progress: 1, accepted: false };

    if (this.state === 'idle') {
      this.state = 'sizing';
      this._sizingStart = f.timeMs;
    }
    if (this._firstSeen === null) this._firstSeen = f.timeMs;
    // While the skin model is still downloading, real measurements are
    // impossible; don't let the timeout run out on an estimate yet. A hard
    // cap stops a failed/slow download from blocking forever.
    if (f.measurementPending && f.timeMs - this._firstSeen < o.maxWaitForMeasurementMs) {
      this._sizingStart = f.timeMs;
      this._framesSeen = 0;
    }
    this._framesSeen++;
    const worldOk = f.worldScale > 0;
    if (worldOk) this._worldTrustedFrames++;

    const flatEnough = f.facingConfidence >= o.minFacingConfidence && Math.abs(f.fingerTiltSin) <= o.maxFingerTiltSin;
    if (flatEnough && f.screenEstimateWidthPx > 0 && f.screenScale > 0) {
      this._estimates.push({
        world: worldOk ? f.screenEstimateWidthPx / f.worldScale : null,
        screen: f.screenEstimateWidthPx / f.screenScale,
      });
    }

    const reason = this._rejectReason(f);
    this.lastRejectReason = reason;
    let accepted = false;
    if (!reason) {
      this.samples.push({
        world: worldOk ? f.measuredWidthPx / f.worldScale : null,
        screen: f.measuredWidthPx / f.screenScale,
      });
      accepted = true;
    }

    const elapsed = f.timeMs - this._sizingStart;
    if (this.samples.length >= o.samplesNeeded) {
      this._lock(this.samples, 'measured');
    } else if (elapsed >= o.timeoutMs && (this._framesSeen >= o.minFramesBeforeTimeout || elapsed >= o.hardTimeoutMs)) {
      // Prefer whatever real measurements we got (≥5) over the estimate.
      if (this.samples.length >= 5) this._lock(this.samples, 'measured');
      else if (this._estimates.length) this._lock(this._estimates, 'estimated');
      else if (f.screenEstimateWidthPx > 0 && f.screenScale > 0) {
        this._lock([{ world: worldOk ? f.screenEstimateWidthPx / f.worldScale : null, screen: f.screenEstimateWidthPx / f.screenScale }], 'estimated');
      }
    }
    return { state: this.state, progress: this.progress, accepted };
  }

  _rejectReason(f) {
    const o = this.opts;
    if (!(f.screenScale > 0)) return 'no-scale';
    if (!(f.measuredWidthPx > 0)) return 'finger-not-measured';
    if (!f.twoSided) return 'fingers-touching';
    if (!(f.facingConfidence >= o.minFacingConfidence)) return 'hand-not-flat';
    if (!(Math.abs(f.fingerTiltSin) <= o.maxFingerTiltSin)) return 'finger-tilted';
    if (!(f.speedWidthsPerSec <= o.maxSpeedWidthsPerSec)) return 'moving';
    return null;
  }

  _lock(entries, source) {
    const o = this.opts;
    const worldVals = entries.map((e) => e.world).filter((v) => v > 0);
    const useWorld =
      this._worldTrustedFrames / Math.max(this._framesSeen, 1) >= o.minWorldTrustedFraction &&
      worldVals.length >= Math.ceil(entries.length / 2);
    const vals = useWorld ? worldVals : entries.map((e) => e.screen).filter((v) => v > 0);
    const ratio = robustWidth(vals, o.outlierFraction);
    if (!(ratio > 0)) return;
    this.lockedRatio = ratio;
    this.scaleMode = useWorld ? 'world' : 'screen';
    this.lockSource = source;
    this.state = 'locked';
  }

  /**
   * Current on-screen finger width in source pixels, or null if not locked.
   * @param {number|null} worldScale - latest trusted (or held) 3D scale
   * @param {number} screenScale
   */
  widthPx(worldScale, screenScale) {
    if (!this.locked) return null;
    const s = this.scaleMode === 'world' ? worldScale : screenScale;
    return s > 0 ? this.lockedRatio * s : null;
  }
}
