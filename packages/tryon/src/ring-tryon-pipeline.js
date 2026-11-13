/**
 * ring-tryon-pipeline.js
 *
 * Browser side of the ring try-on: wires MediaPipe results, the skin
 * segmenter and lighting estimate into RingSolver (all placement/sizing
 * decisions live there, DOM-free), then renders with RingScene and draws
 * the debug overlay. Also captures per-frame inputs for the debug
 * recorder so a session can be replayed offline through RingSolver.
 */

import { HAND_CONNECTIONS } from './hand-tracking.js';
import { syncCanvasSize, drawAllHands } from './landmark-debug-draw.js';
import { RingScene } from './three-scene.js';
import { createVisibleMapper } from './view-mapping.js';
import { LightingEstimator } from './lighting-estimator.js';
import { SkinSegmenter, computeHandRoi } from './skin-segmentation.js';
import { measureFingerWidth } from './finger-measure.js';
import { RingSolver } from './ring-solver.js';

const round = (v, d = 5) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);
const packPoints = (pts) => pts.map((p) => [round(p.x), round(p.y), round(p.z || 0)]);

export class RingTryOnPipeline {
  /**
   * @param {Object} opts
   * @param {HTMLCanvasElement} opts.overlayCanvas - WebGL ring layer
   * @param {HTMLCanvasElement|null} [opts.debugCanvas] - 2D skeleton/measurement layer
   * @param {string} opts.modelUrl
   * @param {boolean} [opts.segmentation=true]
   */
  constructor({ overlayCanvas, debugCanvas = null, modelUrl, segmentation = true }) {
    this.overlayCanvas = overlayCanvas;
    this.debugCanvas = debugCanvas;
    this.debugCtx = debugCanvas ? debugCanvas.getContext('2d') : null;
    this.modelUrl = modelUrl;

    this.scene = new RingScene(overlayCanvas);
    this.lighting = new LightingEstimator();
    this.solver = new RingSolver();

    this.segmenter = segmentation ? new SkinSegmenter() : null;
    this.segmentationStatus = segmentation ? 'loading' : 'disabled';
    this.segmentationError = null;

    this._frame = 0;
    this._last = null;
    this._lastRoi = null;
    this._lastMeasurement = null;
    this.recording = null; // array of frame records while recording
  }

  /** Loads the scene + ring model (required). The skin model loads in parallel, in the background. */
  async init() {
    if (this.segmenter) {
      // Started first so its ~16 MB download overlaps the ring scene setup.
      this.segmenterReady = this.segmenter.load().then(
        () => { this.segmentationStatus = `ready (${this.segmenter.delegate})`; },
        (err) => {
          // Non-fatal: sizing falls back to the hand-size estimate.
          this.segmentationStatus = 'unavailable';
          this.segmentationError = String(err && err.message || err);
        }
      );
    }
    await this.scene.init();
    await this.scene.loadRingModel(this.modelUrl);
  }

  /** Full reset including the size lock (Resize button). */
  reset() {
    this.solver.reset();
    this.lighting.reset();
    this._frame = 0;
    this._lastRoi = null;
    this._lastMeasurement = null;
  }

  get sizing() {
    return this._last ? this._last.sizing : null;
  }

  startRecording() {
    this.recording = [];
  }

  /** @returns {Array} recorded frames */
  stopRecording() {
    const r = this.recording || [];
    this.recording = null;
    return r;
  }

  /**
   * @param {Object} f
   * @param {CanvasImageSource} f.source - the video (or image) the landmarks came from
   * @param {number} f.sourceWidth
   * @param {number} f.sourceHeight
   * @param {{width:number,height:number}} f.displaySize - on-screen size of the video area
   * @param {Object|null} f.handResult - MediaPipe HandLandmarkerResult
   * @param {boolean} f.mirror
   * @param {number} f.timestampMs
   * @param {boolean} [f.forceSegmentation]
   */
  processFrame({ source, sourceWidth, sourceHeight, displaySize, handResult, mirror, timestampMs, forceSegmentation = false }) {
    const due = forceSegmentation || this._frame % this.solver.measureEveryNFrames === 0;
    this._frame++;
    const canSegment = due && this.segmenter && this.segmenter.ready;

    const measure = canSegment
      ? (req) => {
        const roi = computeHandRoi(req.landmarks, sourceWidth, sourceHeight);
        let mask = null;
        try {
          mask = this.segmenter.segment(source, roi);
        } catch (err) {
          this.segmentationError = String(err && err.message || err);
        }
        const m = measureFingerWidth(mask, req);
        this._lastRoi = roi;
        this._lastMeasurement = m;
        return m;
      }
      : null;

    const out = this.solver.solve({
      timeMs: timestampMs, sourceWidth, sourceHeight, displaySize, mirror, handResult, measure,
      measurementPending: this.segmentationStatus === 'loading',
    });
    this._last = out;

    const videoAspect = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : out.crop.containerAspect;
    this.scene.resize(out.crop, videoAspect);
    this.scene.setLighting(this.lighting.update(source));
    this.scene.render(out.pose, out.segments);
    this._drawDebug(handResult, out.crop, mirror, sourceWidth, sourceHeight);

    if (this.recording) this._record({ timestampMs, sourceWidth, sourceHeight, displaySize, mirror, handResult, out });

    return {
      handDetected: out.handDetected,
      sizing: out.sizing,
      pose: out.pose,
      ...(out.diag || {}),
    };
  }

  _record({ timestampMs, sourceWidth, sourceHeight, displaySize, mirror, handResult, out }) {
    const hr = handResult && handResult.landmarks && handResult.landmarks[0]
      ? {
        landmarks: [packPoints(handResult.landmarks[0])],
        worldLandmarks: handResult.worldLandmarks && handResult.worldLandmarks[0] ? [packPoints(handResult.worldLandmarks[0])] : [],
        handedness: handResult.handedness && handResult.handedness[0] && handResult.handedness[0][0]
          ? [[{ categoryName: handResult.handedness[0][0].categoryName, score: round(handResult.handedness[0][0].score, 3) }]]
          : [],
      }
      : null;
    const m = out.measurement;
    this.recording.push({
      t: round(timestampMs, 1), sw: sourceWidth, sh: sourceHeight,
      dw: round(displaySize.width, 1), dh: round(displaySize.height, 1), mirror,
      hand: hr,
      measurement: m ? { valid: m.valid, widthPx: round(m.widthPx, 2), centerOffsetPx: round(m.centerOffsetPx, 2), twoSided: !!m.twoSided } : null,
      live: {
        sizing: out.sizing && out.sizing.state,
        visible: !!(out.pose && out.pose.valid),
        widthPx: out.diag ? round(out.diag.fingerWidthPx, 2) : null,
        knuckleWidthPx: out.diag ? round(out.diag.knuckleWidthPx, 2) : null,
        tiltDeg: out.diag ? round(out.diag.tiltDeg, 1) : null,
        backFacing: out.diag ? out.diag.backFacing : null,
      },
    });
  }

  _drawDebug(handResult, crop, mirror, sw, sh) {
    if (!this.debugCtx) return;
    const ctx = this.debugCtx;
    const canvas = this.debugCanvas;
    syncCanvasSize(canvas);
    const toVisible = createVisibleMapper(crop, mirror);
    drawAllHands(ctx, canvas, handResult, HAND_CONNECTIONS, { mapToVisible: toVisible });
    if (!handResult || !handResult.landmarks || !handResult.landmarks.length) return;
    const toCanvas = (px, py) => {
      const v = toVisible({ x: px / sw, y: py / sh });
      return { x: v.x * canvas.width, y: v.y * canvas.height };
    };
    if (this._lastRoi) {
      const r = this._lastRoi;
      const a = toCanvas(r.x, r.y);
      const b = toCanvas(r.x + r.size, r.y + r.size);
      ctx.strokeStyle = 'rgba(80, 200, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }
    if (this._lastMeasurement) {
      ctx.fillStyle = this._lastMeasurement.valid ? '#4fd1ff' : '#ff5a5a';
      for (const e of this._lastMeasurement.edges) {
        const p = toCanvas(e.x, e.y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  dispose() {
    this.scene.dispose();
    if (this.segmenter) this.segmenter.dispose();
  }
}
