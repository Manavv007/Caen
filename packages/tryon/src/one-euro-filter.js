/**
 * one-euro-filter.js
 *
 * The One Euro Filter (Casiez, Roussel, Vogel 2012) — a standard
 * low-jitter, low-lag smoothing filter widely used for real-time
 * hand/face tracking. It adapts its cutoff frequency to signal speed:
 * slow, steady movement gets heavy smoothing (kills jitter), fast
 * movement gets light smoothing (kills lag/rubber-banding).
 *
 * Reference: https://cristal.univ-lille.fr/~casiez/1euro/
 *
 * We use this instead of a naive fixed-weight exponential moving
 * average because a fixed weight is always a tradeoff between "too
 * jittery when still" and "too laggy when moving" — One Euro avoids
 * that tradeoff by adapting per-frame.
 */

function smoothingFactor(te, cutoff) {
  const r = 2 * Math.PI * cutoff * te;
  return r / (r + 1);
}

function exponentialSmoothing(a, x, xPrev) {
  return a * x + (1 - a) * xPrev;
}

/**
 * A single-value (scalar) One Euro Filter. For multi-dimensional data
 * (e.g. a 3D point), use one instance per dimension — see Vector3OneEuroFilter.
 */
export class OneEuroFilter {
  /**
   * @param {Object} [options]
   * @param {number} [options.minCutoff=1.0] - lower = more smoothing when signal is slow/still
   * @param {number} [options.beta=0.0] - higher = less lag during fast movement, but more jitter when still
   * @param {number} [options.dCutoff=1.0] - cutoff for the derivative filter, rarely needs tuning
   */
  constructor(options = {}) {
    this.minCutoff = options.minCutoff ?? 1.0;
    this.beta = options.beta ?? 0.0;
    this.dCutoff = options.dCutoff ?? 1.0;

    this._xPrev = null;
    this._dxPrev = 0;
    this._tPrev = null;
  }

  /**
   * @param {number} x - the new raw value
   * @param {number} t - current timestamp in seconds
   * @returns {number} the filtered value
   */
  filter(x, t) {
    if (this._tPrev === null) {
      this._xPrev = x;
      this._dxPrev = 0;
      this._tPrev = t;
      return x;
    }

    const te = Math.max(t - this._tPrev, 1e-6); // avoid divide-by-zero on duplicate timestamps

    // Estimate the derivative (rate of change) and smooth it.
    const dx = (x - this._xPrev) / te;
    const aD = smoothingFactor(te, this.dCutoff);
    const dxHat = exponentialSmoothing(aD, dx, this._dxPrev);

    // Adapt the cutoff based on how fast the signal is moving.
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = smoothingFactor(te, cutoff);
    const xHat = exponentialSmoothing(a, x, this._xPrev);

    this._xPrev = xHat;
    this._dxPrev = dxHat;
    this._tPrev = t;

    return xHat;
  }

  reset() {
    this._xPrev = null;
    this._dxPrev = 0;
    this._tPrev = null;
  }
}

/**
 * Convenience wrapper: independently filters x/y/z components of a 3D
 * point. Using independent per-axis filters (rather than filtering
 * distance/magnitude) is the standard approach for landmark smoothing.
 */
export class Vector3OneEuroFilter {
  constructor(options = {}) {
    this.fx = new OneEuroFilter(options);
    this.fy = new OneEuroFilter(options);
    this.fz = new OneEuroFilter(options);
  }

  /**
   * @param {{x:number,y:number,z:number}} point
   * @param {number} t - timestamp in seconds
   * @returns {{x:number,y:number,z:number}}
   */
  filter(point, t) {
    return {
      x: this.fx.filter(point.x, t),
      y: this.fy.filter(point.y, t),
      z: this.fz.filter(point.z, t),
    };
  }

  reset() {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }
}
