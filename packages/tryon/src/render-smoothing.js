/**
 * render-smoothing.js
 *
 * Smooth motion between detections. Tracking on a budget phone delivers
 * 12–20 results/s while the screen refreshes at 60 Hz; drawing only when a
 * result arrives makes the jewellery move in visible steps.
 *
 * With smoothing on, the page renders on requestAnimationFrame and each
 * pipeline asks a PoseSmoother for the pose "now": the last solver output,
 * with its positions moved ahead along the velocity between the last two
 * solver outputs (which are already One-Euro filtered). The lead is at most
 * one detection interval, then the pose holds until the next result.
 *
 * Why lead by the time since the result *arrived*: the next result is
 * captured one interval after this one and arrives with about the same
 * latency, so at that moment the extrapolated pose has advanced by exactly
 * one step, and switching to the real result causes no jump at constant
 * velocity.
 *
 * Only positions are extrapolated (not rotation or size), and nothing here
 * feeds back into the solvers: placement and sizing are unchanged; this only
 * decides what is drawn between two results.
 */

/** Velocity from results further apart than this is too stale to extrapolate. */
export const MAX_DETECTION_INTERVAL_MS = 150;

/**
 * A point that moved more than this (world units; the screen is 1 unit tall)
 * between two results is a tracking jump, not motion: don't extrapolate it.
 */
export const MAX_STEP_WORLD = 0.15;

/**
 * @param {{captureMs:number, arrivalMs:number}|null} prev
 * @param {{captureMs:number, arrivalMs:number}|null} latest
 * @param {number} nowMs
 * @returns {number} fraction of the last step to add, 0..1
 */
export function extrapolationLead(prev, latest, nowMs, maxIntervalMs = MAX_DETECTION_INTERVAL_MS) {
  if (!prev || !latest) return 0;
  const interval = latest.captureMs - prev.captureMs;
  if (!(interval > 0) || interval > maxIntervalMs) return 0;
  const k = (nowMs - latest.arrivalMs) / interval;
  return k > 0 ? Math.min(k, 1) : 0;
}

/**
 * @param {Array<{x:number,y:number,z:number}>} p0 - previous positions
 * @param {Array<{x:number,y:number,z:number}>} p1 - latest positions
 * @param {number} k - lead from extrapolationLead()
 * @returns {Array<{x:number,y:number,z:number}>|null} null = don't extrapolate
 */
export function extrapolatePoints(p0, p1, k, maxStep = MAX_STEP_WORLD) {
  if (!p0 || !p1 || p0.length !== p1.length || !(k > 0)) return null;
  const out = new Array(p1.length);
  for (let i = 0; i < p1.length; i++) {
    const a = p0[i];
    const b = p1[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    if (!(Math.hypot(dx, dy, dz) <= maxStep)) return null;
    out[i] = { x: b.x + dx * k, y: b.y + dy * k, z: b.z + dz * k };
  }
  return out;
}

const copyPoint = (p) => ({ x: p.x, y: p.y, z: p.z || 0 });

export class PoseSmoother {
  /**
   * @param {Object} opts
   * @param {(out:any) => Array<{x,y,z}>|null} opts.getPoints - positions to
   *   extrapolate, in a fixed order; null when nothing is shown
   * @param {(out:any, points:Array<{x,y,z}>) => any} opts.withPoints - a copy of
   *   `out` with those positions replaced (must not mutate `out`)
   */
  constructor({ getPoints, withPoints }) {
    this.getPoints = getPoints;
    this.withPoints = withPoints;
    this.reset();
  }

  reset() {
    this._latest = null;
    this._prev = null;
  }

  /**
   * @param {any} out - solver output for one detection
   * @param {number} captureMs - when the frame was captured (the detection timestamp)
   * @param {number} arrivalMs - when the result was processed (performance.now())
   */
  push(out, captureMs, arrivalMs) {
    const pts = this.getPoints(out);
    this._prev = this._latest;
    // Values are copied: a solver may hand back the same object on a held frame.
    this._latest = { out, captureMs, arrivalMs, points: pts ? pts.map(copyPoint) : null };
  }

  /** @returns {any} the output to draw at `nowMs` (the latest one if there is nothing to extrapolate) */
  at(nowMs) {
    const l = this._latest;
    if (!l) return null;
    const p = this._prev;
    const k = extrapolationLead(p, l, nowMs);
    const pts = k > 0 && p ? extrapolatePoints(p.points, l.points, k) : null;
    return pts ? this.withPoints(l.out, pts) : l.out;
  }
}
