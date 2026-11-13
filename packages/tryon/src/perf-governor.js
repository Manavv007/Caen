/**
 * perf-governor.js
 *
 * Adaptive render quality. Each tier caps the WebGL overlay's pixel ratio,
 * the cheapest big lever on fill-rate-bound phone GPUs; placement and sizing
 * are untouched.
 *
 * - Starting tier from coarse device hints (memory / CPU cores).
 * - Steps DOWN when the tracking result rate stays below `minFps` for
 *   `windowMs`; never steps back up within a session (avoids oscillating
 *   between tiers, which looks worse than a steady lower resolution).
 */
export const QUALITY_TIERS = [
  { name: 'high', maxPixelRatio: 1.5 },
  { name: 'mid', maxPixelRatio: 1.0 },
  { name: 'low', maxPixelRatio: 0.75 },
];

/** Starting tier index from device hints (absent hints = assume capable). */
export function initialTierIndex(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  const memory = nav.deviceMemory; // GB, Chromium only
  const cores = nav.hardwareConcurrency;
  if ((memory && memory <= 2) || (cores && cores <= 2)) return 2;
  if ((memory && memory <= 4) || (cores && cores <= 4)) return 1;
  return 0;
}

export class PerfGovernor {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.startTier]
   * @param {number} [opts.minFps=20]
   * @param {number} [opts.windowMs=2000]
   * @param {number} [opts.graceMs=3000] - ignore the first seconds (model warm-up, shader compile)
   * @param {(tier: {name:string, maxPixelRatio:number}, index:number) => void} [opts.onChange]
   */
  constructor({ startTier = initialTierIndex(), minFps = 20, windowMs = 2000, graceMs = 3000, onChange = () => {} } = {}) {
    this.index = startTier;
    this.minFps = minFps;
    this.windowMs = windowMs;
    this.graceMs = graceMs;
    this.onChange = onChange;
    this._start = null;
    this._slowSince = null;
  }

  get tier() {
    return QUALITY_TIERS[this.index];
  }

  /**
   * Call once per tracking result.
   * @param {number} nowMs
   * @param {number} fps - current results per second
   */
  update(nowMs, fps) {
    if (this._start === null) this._start = nowMs;
    if (nowMs - this._start < this.graceMs || !(fps > 0)) return;
    if (fps >= this.minFps) {
      this._slowSince = null;
      return;
    }
    if (this._slowSince === null) this._slowSince = nowMs;
    if (nowMs - this._slowSince >= this.windowMs && this.index < QUALITY_TIERS.length - 1) {
      this.index++;
      this._slowSince = null;
      this.onChange(this.tier, this.index);
    }
  }
}
