/**
 * ring-solver.js
 *
 * Everything that decides WHERE the ring goes and HOW BIG it is, per frame,
 * with no DOM / WebGL / MediaPipe dependency. The live pipeline feeds it
 * MediaPipe results + optional skin-mask measurements; the same class
 * replays a recorded session offline, so live behaviour and offline
 * measurements come from identical code.
 *
 *   landmarks ─► One-Euro smoothing ─► world mapping (crop + mirror)
 *   worldLandmarks ─► hand-metric: px/metre scale, finger tilt, width estimate
 *   skin-mask width (optional) ─┐
 *                               ├─► RingSizer: sizing phase -> locked metric width
 *   facing / tilt / speed ──────┘
 *   locked width × hand-distance change (rigid on-screen lengths, dead band,
 *     clamp, rate limit) ─► on-screen finger width
 *   screen direction + clamped world tilt ─► ring axis
 *   palm/back ─► which way the ring's top faces
 */

import {
  extractRingKeypoints,
  computeRingPose,
  estimateFingerWidthFromKnuckles,
  fingerAxisFromScreenAndTilt,
  RingPoseHold,
  RING_POSITION_ALONG_FINGER,
} from './ring-anchor.js';
import { Vector3OneEuroFilter, OneEuroFilter } from './one-euro-filter.js';
import { computeCoverCrop, createViewMapper } from './view-mapping.js';
import { HandFacingTracker } from './hand-facing.js';
import { computeHandMetric, computeFingerTiltSin, isHandMetricTrusted } from './hand-metric.js';
import { RingSizer } from './ring-sizer.js';

/**
 * Other fingers/thumb as occluder bones: [from, to, widthFactor, trimStart].
 * widthFactor: that finger's width relative to the ring finger.
 * The ring finger's own bones above the PIP joint are included so a curled
 * fingertip (fist seen from the palm side) can cover the band.
 */
export const OCCLUDER_BONES = [
  [1, 2, 1.1], [2, 3, 1.0], [3, 4, 0.9], // thumb
  [5, 6, 1.0], [6, 7, 0.9], [7, 8, 0.8], // index
  [9, 10, 1.05], [10, 11, 0.95], [11, 12, 0.85], // middle
  [17, 18, 0.85], [18, 19, 0.8], [19, 20, 0.7], // pinky
  [14, 15, 0.92, 0.35], [15, 16, 0.8], // ring finger beyond PIP; 4th value trims the PIP end
];

/** Occluders are slightly thinner than the finger so they only hide what's clearly covered. */
const OCCLUDER_RADIUS_SHRINK = 0.92;

/** Lateral centring correction is clamped to ± this fraction of finger width. */
const MAX_CENTER_OFFSET_RATIO = 0.2;

const LANDMARK_FILTER = { minCutoff: 1.5, beta: 8.0, dCutoff: 1.0 };
/** The hand scale only changes with distance; smooth it firmly. */
const SCALE_FILTER = { minCutoff: 0.6, beta: 0.002, dCutoff: 1.0 };
/** Tilt is the noisiest input; smooth it more than position. */
const TILT_FILTER = { minCutoff: 0.5, beta: 0.3, dCutoff: 1.0 };

/** Rigid hand lengths (landmark pairs) used as the distance cue after lock:
 *  the palm triangle plus the four proximal finger bones. */
const SIZE_LENGTHS = [[0, 5], [0, 17], [5, 17], [5, 6], [9, 10], [13, 14], [17, 18]];
/** Distance changes smaller than this are treated as posture wobble and
 *  ignored. 12% covers the wobble measured in two real sessions (fist,
 *  hand hanging down, fingers together) with the hand at a steady distance. */
const SIZE_DEADBAND = 0.12;
/** After the dead band, the ring may shrink/grow at most this much vs the lock. */
const SIZE_MIN_SCALE = 0.85;
const SIZE_MAX_SCALE = 1.2;
/** Fastest allowed size change, as a fraction of the locked size per second. */
const SIZE_MAX_RATE_PER_S = 0.1;
/** Frames in the median window that rejects one-frame tracking glitches. */
const SIZE_SPIKE_WINDOW = 5;

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export class RingSolver {
  /** @param {Object} [opts] - { sizer: RingSizer options } */
  constructor(opts = {}) {
    this.sizer = new RingSizer(opts.sizer);
    this.poseHold = new RingPoseHold();
    this.facing = new HandFacingTracker();
    this.landmarkFilters = Array.from({ length: 21 }, () => new Vector3OneEuroFilter(LANDMARK_FILTER));
    this.scaleFilter = new OneEuroFilter(SCALE_FILTER);
    this.screenScaleFilter = new OneEuroFilter(SCALE_FILTER);
    this.tiltFilter = new OneEuroFilter(TILT_FILTER);
    this.offsetFilter = new OneEuroFilter({ minCutoff: 0.8, beta: 0.5 });
    this._offsetRatio = 0;
    this._prevCenter = null;
    this._lastPxPerMeter = null;
    this._sizeRef = null;
  }

  /** Full reset, including the size lock (Resize button). */
  reset() {
    this.sizer.reset();
    this._sizeRef = null;
    this.resetTracking();
  }

  /** Reset smoothing state only (hand left the frame); keeps the size lock. */
  resetTracking() {
    this.landmarkFilters.forEach((f) => f.reset());
    this.scaleFilter.reset();
    this.screenScaleFilter.reset();
    this.tiltFilter.reset();
    this.offsetFilter.reset();
    this.poseHold.reset();
    this.facing.reset();
    this._offsetRatio = 0;
    this._prevCenter = null;
    this._lastPxPerMeter = null;
  }

  /**
   * How often (in frames) skin segmentation is worth running: every few
   * frames while sizing, rarely once locked (only lateral centring still
   * uses it), which removes most of the segmentation cost after ~2 s.
   */
  get measureEveryNFrames() {
    return this.sizer.locked ? 15 : 2;
  }

  /**
   * @param {Object} f
   * @param {number} f.timeMs
   * @param {number} f.sourceWidth
   * @param {number} f.sourceHeight
   * @param {{width:number,height:number}} f.displaySize
   * @param {boolean} f.mirror
   * @param {Object|null} f.handResult - {landmarks, worldLandmarks, handedness}
   * @param {(req:{landmarks, mcpPx, pipPx, ringT, expectedWidthPx}) => Object|null} [f.measure]
   *   optional: returns a finger-measure.js result for this frame (skin mask),
   *   or null to skip. Called with smoothed landmarks.
   * @param {boolean} [f.measurementPending] - true while the skin model is still loading
   * @returns {Object} frame output: pose, segments, crop, sizing info, diagnostics
   */
  solve(f) {
    const crop = computeCoverCrop(f.displaySize.width, f.displaySize.height, f.sourceWidth, f.sourceHeight);
    const toWorld = createViewMapper(crop, f.mirror);
    const raw = f.handResult && f.handResult.landmarks && f.handResult.landmarks[0];
    const world = f.handResult && f.handResult.worldLandmarks && f.handResult.worldLandmarks[0];
    const handedness = f.handResult && f.handResult.handedness && f.handResult.handedness[0] && f.handResult.handedness[0][0];
    const out = { crop, handDetected: !!raw, pose: { valid: false }, segments: [] };

    if (!raw || raw.length < 21) {
      this.resetTracking();
      this.sizer.update({ timeMs: f.timeMs, handPresent: false });
      if (!this.sizer.locked) this._sizeRef = null;
      out.pose = this.poseHold.update({ valid: false });
      out.sizing = this._sizingInfo();
      return out;
    }

    const t = f.timeMs / 1000;
    const lm = raw.map((p, i) => this.landmarkFilters[i].filter(p, t));
    const worldLm = lm.map(toWorld);
    const wp = extractRingKeypoints(worldLm);
    if (!wp) {
      out.pose = this.poseHold.update({ valid: false });
      out.sizing = this._sizingInfo();
      return out;
    }
    out.smoothedLandmarks = lm;

    // World units per source pixel (object-cover keeps x/y isotropic).
    const worldPerPx = crop.containerAspect / (crop.cropWidth * f.sourceWidth);
    const knuckleWidthWorld = estimateFingerWidthFromKnuckles(wp);
    const mcpPx = { x: lm[13].x * f.sourceWidth, y: lm[13].y * f.sourceHeight };
    const pipPx = { x: lm[14].x * f.sourceWidth, y: lm[14].y * f.sourceHeight };

    // --- Hand scales. ---
    // world: px per metre from fitting MediaPipe's 3D hand (rotation-invariant
    //   when believable). Untrusted frames keep the last trusted value so a
    //   single broken 3D estimate can't resize the ring.
    // screen: on-screen knuckle-spacing finger width (px), always available.
    const metric = world ? computeHandMetric(raw, world, f.sourceWidth, f.sourceHeight) : null;
    const worldTrusted = isHandMetricTrusted(metric);
    let worldScale = this._lastPxPerMeter;
    if (worldTrusted) {
      worldScale = this.scaleFilter.filter(metric.pxPerMeter, t);
      this._lastPxPerMeter = worldScale;
    }
    const screenScalePx = knuckleWidthWorld / worldPerPx;
    const screenScale = this.screenScaleFilter.filter(screenScalePx, t);
    const tiltRaw = world ? computeFingerTiltSin(world) : null;
    const tiltSin = tiltRaw === null ? 0 : this.tiltFilter.filter(tiltRaw, t);

    // --- Palm vs back. ---
    const facing = this.facing.update(lm, handedness, f.sourceWidth, f.sourceHeight);

    // --- Hand speed (for the sizing gate), in finger widths per second. ---
    // From RAW landmarks: the One-Euro filter is still converging during
    // the first frames, and its settling would otherwise read as motion.
    const rawMid = {
      x: ((raw[13].x + raw[14].x) / 2) * f.sourceWidth,
      y: ((raw[13].y + raw[14].y) / 2) * f.sourceHeight,
    };
    const center = { ...rawMid, t };
    let speed = Infinity;
    if (this._prevCenter && t > this._prevCenter.t) {
      const d = Math.hypot(center.x - this._prevCenter.x, center.y - this._prevCenter.y);
      speed = d / (t - this._prevCenter.t) / Math.max(knuckleWidthWorld / worldPerPx, 1);
    }
    this._prevCenter = center;

    // --- Size: sizing phase, then locked metric width. ---
    // Measure the real finger (skin mask) if the caller can. The search is
    // centred on the independent knuckle-spacing estimate, never on the
    // locked width: centring on the lock would let a bad lock reject every
    // later (correct) measurement.
    const prelimWidthPx = knuckleWidthWorld / worldPerPx;
    let m = null;
    if (typeof f.measure === 'function') {
      try {
        m = f.measure({ landmarks: lm, mcpPx, pipPx, ringT: RING_POSITION_ALONG_FINGER, expectedWidthPx: prelimWidthPx }) || null;
      } catch (err) {
        m = null;
      }
    }
    out.measurement = m;
    const sizing = this.sizer.update({
      timeMs: f.timeMs,
      handPresent: true,
      // The 3D hand's scale is not used for size: replaying a real session
      // showed it drifting ~25% under tilt even when it looked plausible,
      // then collapsing (knuckle span 8–40 mm) and freezing the ring 37%
      // too big. Size comes from on-screen hand lengths instead.
      worldScale: null,
      screenScale,
      measuredWidthPx: m && m.valid ? m.widthPx : null,
      twoSided: !!(m && m.valid && m.twoSided),
      facingConfidence: facing ? facing.confidence : 0,
      fingerTiltSin: tiltRaw === null ? 1 : tiltRaw,
      speedWidthsPerSec: speed,
      screenEstimateWidthPx: screenScalePx,
      measurementPending: !!f.measurementPending,
    });
    const lockedPx = this.sizer.widthPx(null, screenScale);
    if (!lockedPx) this._sizeRef = null;
    const fingerWidthPx = lockedPx ? this._sizeAfterLock(lm, f.sourceWidth, f.sourceHeight, lockedPx, t) : null;
    // Before locking show the knuckle estimate (the ring is hidden then anyway).
    const fingerWidth = fingerWidthPx ? fingerWidthPx * worldPerPx : knuckleWidthWorld;

    // --- Lateral centring from two-sided measurements. ---
    if (m && m.valid && m.twoSided) {
      const off = Math.min(Math.max(m.centerOffsetPx / m.widthPx, -MAX_CENTER_OFFSET_RATIO), MAX_CENTER_OFFSET_RATIO);
      this._offsetRatio = this.offsetFilter.filter(off, t);
    } else if (m) {
      this._offsetRatio *= 0.85; // drift back to the joint line while unmeasured
    }
    let positionOffset = null;
    const fdx = pipPx.x - mcpPx.x;
    const fdy = pipPx.y - mcpPx.y;
    const flen = Math.hypot(fdx, fdy);
    if (flen > 1e-6 && this._offsetRatio !== 0) {
      const px = -fdy / flen;
      const py = fdx / flen;
      const k = this._offsetRatio * fingerWidth;
      positionOffset = { x: (f.mirror ? -px : px) * k, y: -py * k, z: 0 };
    }

    // --- Orientation: precise screen direction + clamped world tilt. ---
    const fingerAxis = fingerAxisFromScreenAndTilt(
      { x: wp.ringPip.x - wp.ringMcp.x, y: wp.ringPip.y - wp.ringMcp.y },
      tiltSin
    );
    let dorsal = null;
    if (facing) {
      const d = facing.dorsalRaw;
      dorsal = { x: f.mirror ? -d.x : d.x, y: -d.y, z: -d.z };
    }

    const pose = computeRingPose(wp, { fingerWidth, dorsal, positionOffset, fingerAxis });

    // While sizing, the ring stays hidden: its size isn't settled yet, and
    // a ring that visibly resizes in the first seconds is exactly the
    // instability being fixed. The UI shows a sizing prompt instead.
    const showRing = pose.valid && this.sizer.locked;

    // --- Other fingers as occluders, depth relative to the ring. ---
    if (showRing) {
      const ringZ = wp.ringMcp.z + (wp.ringPip.z - wp.ringMcp.z) * RING_POSITION_ALONG_FINGER;
      const rel = (p) => ({ x: p.x, y: p.y, z: p.z - ringZ });
      for (const [i, j, factor, trimStart = 0] of OCCLUDER_BONES) {
        const a = worldLm[i];
        const b = worldLm[j];
        const start = trimStart
          ? { x: a.x + (b.x - a.x) * trimStart, y: a.y + (b.y - a.y) * trimStart, z: a.z + (b.z - a.z) * trimStart }
          : a;
        out.segments.push({ a: rel(start), b: rel(b), radius: (fingerWidth * factor * OCCLUDER_RADIUS_SHRINK) / 2 });
      }
    }

    out.pose = showRing ? this.poseHold.update(pose) : { valid: false };
    out.rawPose = pose;
    out.sizing = this._sizingInfo(sizing);
    out.diag = {
      hand: facing ? facing.hand : null,
      backFacing: facing ? facing.backFacing : null,
      facingConfidence: facing ? facing.confidence : null,
      worldScale,
      worldTrusted,
      knuckleSpanMm: metric ? metric.knuckleSpanMm : null,
      residualMm: metric ? metric.residualMm : null,
      tiltDeg: (Math.asin(Math.min(Math.max(tiltSin, -1), 1)) * 180) / Math.PI,
      fingerWidthPx: fingerWidth / worldPerPx,
      sizeScale: this._sizeRef ? this._sizeRef.scale : null,
      knuckleWidthPx: knuckleWidthWorld / worldPerPx,
      measuredWidthPx: m && m.valid ? m.widthPx : null,
      twoSided: !!(m && m.valid && m.twoSided),
      speedWidthsPerSec: Number.isFinite(speed) ? speed : null,
    };
    out.mcpPx = mcpPx;
    out.pipPx = pipPx;
    out.expectedWidthPx = fingerWidth / worldPerPx;
    return out;
  }

  /**
   * On-screen finger width after the lock. The ring's real size is fixed at
   * lock time; afterwards only the hand's distance from the camera may
   * change its on-screen size.
   *
   * Distance cue: several rigid on-screen hand lengths in different
   * directions, each relative to its value at lock (see comments in the
   * body for how they are combined). Then:
   *  - a dead band ignores the ±SIZE_DEADBAND wobble that posture changes
   *    cause, so in normal use the ring size simply stays put;
   *  - the result is clamped and rate-limited so no tracking glitch can
   *    resize the ring quickly or by much.
   */
  _sizeAfterLock(lm, sw, sh, lockedPx, t) {
    const lens = SIZE_LENGTHS.map(([i, j]) => Math.hypot((lm[i].x - lm[j].x) * sw, (lm[i].y - lm[j].y) * sh));
    if (!this._sizeRef) {
      this._sizeRef = { widthPx: lockedPx, lens, scale: 1, t, recent: [] };
      return lockedPx;
    }
    const ref = this._sizeRef;
    const ratios = lens.map((v, k) => (ref.lens[k] > 1e-6 ? v / ref.lens[k] : 0));
    const sorted = ratios.filter((v) => v > 0).sort((a, b) => b - a);
    if (sorted.length < 2) return ref.widthPx * ref.scale;
    // Turning the hand only shortens on-screen lengths, so the longest
    // (relative) lengths are the truest distance cue. The second-largest is
    // used, so one length that happened to be foreshortened AT LOCK (and
    // now reads long) can't drive the size on its own.
    const est = sorted[1];
    ref.recent.push(est);
    if (ref.recent.length > SIZE_SPIKE_WINDOW) ref.recent.shift();
    // Median over the last few frames rejects one-frame tracking glitches.
    const r = median(ref.recent);
    const dev = r - 1;
    let target = 1 + Math.sign(dev) * Math.max(0, Math.abs(dev) - SIZE_DEADBAND);
    target = Math.min(Math.max(target, SIZE_MIN_SCALE), SIZE_MAX_SCALE);
    const dt = Math.min(Math.max(t - ref.t, 0), 0.25);
    const maxStep = SIZE_MAX_RATE_PER_S * dt;
    ref.scale += Math.min(Math.max(target - ref.scale, -maxStep), maxStep);
    ref.t = t;
    return ref.widthPx * ref.scale;
  }

  _sizingInfo(s) {
    return {
      state: this.sizer.state,
      progress: this.sizer.progress,
      locked: this.sizer.locked,
      lockSource: this.sizer.lockSource,
      scaleMode: this.sizer.scaleMode,
      lockedRatio: this.sizer.lockedRatio,
      lastRejectReason: this.sizer.lastRejectReason,
      accepted: !!(s && s.accepted),
    };
  }
}
