/**
 * face-tryon-pipeline.js
 *
 * Per-frame processing for face try-on (earrings; necklaces later):
 * MediaPipe face result ─► EarringSolver (placement, pure) ─► EarringScene
 * (3D render), plus lighting from the camera image and a debug overlay
 * (?debug=1): face outline, the landmarks in front of each ear, and the
 * estimated earlobe points (green).
 */

import { createVisibleMapper } from './view-mapping.js';
import { syncCanvasSize, clearCanvas, drawHandLandmarks } from './landmark-debug-draw.js';
import { FACE_OVAL_CONNECTIONS, EAR_LANDMARKS, headAnglesFromMatrix } from './face-tracking.js';
import { EarringSolver } from './earring-solver.js';
import { EarringScene } from './earring-scene.js';
import { LightingEstimator } from './lighting-estimator.js';

export class FaceTryOnPipeline {
  /**
   * @param {Object} opts
   * @param {HTMLCanvasElement} opts.overlayCanvas - WebGL layer
   * @param {HTMLCanvasElement|null} [opts.debugCanvas]
   * @param {string} opts.modelUrl - earring model
   * @param {number} [opts.lengthMm] - real earring length (attachment point to bottom)
   */
  constructor({ overlayCanvas, debugCanvas = null, modelUrl, lengthMm }) {
    this.debugCanvas = debugCanvas;
    this.debugCtx = debugCanvas ? debugCanvas.getContext('2d') : null;
    this.modelUrl = modelUrl;
    this.scene = new EarringScene(overlayCanvas);
    this.solver = new EarringSolver({ lengthMm });
    this.lighting = new LightingEstimator();
    this.recording = null; // array of frame records while recording
  }

  async init() {
    await this.scene.init();
    await this.scene.loadEarringModel(this.modelUrl);
  }

  reset() {
    this.solver.reset();
    this.lighting.reset();
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
   * One frame: all 478 landmarks (4 decimals, ~3 MB per 10 s) so later
   * replays can tune anything, the head-pose matrix, and what the live
   * solver decided.
   */
  _record(f, lm, matrix, s) {
    const r = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
    const pt = (p) => [r(p.x, 4), r(p.y, 4), r(p.z, 4)];
    const live = s.faceDetected
      ? {
        faceWidth: r(s.faceWidth, 5),
        forward: pt(s.frame.forward),
        right: { pos: pt(s.earrings.right.position), vis: r(s.earrings.right.visibility, 3) },
        left: { pos: pt(s.earrings.left.position), vis: r(s.earrings.left.visibility, 3) },
        length: r(s.earrings.right.length, 5),
      }
      : null;
    this.recording.push({
      t: r(f.timestampMs, 1), sw: f.sourceWidth, sh: f.sourceHeight,
      dw: r(f.displaySize.width, 1), dh: r(f.displaySize.height, 1), mirror: f.mirror,
      face: lm ? { landmarks: lm.map(pt), matrix: matrix ? Array.from(matrix.data || matrix).map((v) => r(v, 5)) : null } : null,
      live,
    });
  }

  /**
   * @param {Object} f
   * @param {CanvasImageSource} f.source - the video the landmarks came from
   * @param {number} f.sourceWidth
   * @param {number} f.sourceHeight
   * @param {{width:number,height:number}} f.displaySize
   * @param {boolean} f.mirror
   * @param {number} f.timestampMs
   * @param {Object|null} f.faceResult - FaceLandmarkerResult
   */
  processFrame(f) {
    const lm = f.faceResult && f.faceResult.faceLandmarks && f.faceResult.faceLandmarks[0];
    const matrix = f.faceResult && f.faceResult.facialTransformationMatrixes && f.faceResult.facialTransformationMatrixes[0];
    const s = this.solver.solve({
      timeMs: f.timestampMs,
      sourceWidth: f.sourceWidth,
      sourceHeight: f.sourceHeight,
      displaySize: f.displaySize,
      mirror: f.mirror,
      landmarks: lm || null,
    });

    const videoAspect = f.sourceWidth > 0 && f.sourceHeight > 0 ? f.sourceWidth / f.sourceHeight : s.crop.containerAspect;
    this.scene.resize(s.crop, videoAspect);
    if (f.source) this.scene.setLighting(this.lighting.update(f.source));
    this.scene.render(s);
    this._drawDebug(lm, s, f.mirror);
    if (this.recording) this._record(f, lm, matrix, s);

    if (!s.faceDetected) return { faceDetected: false };
    const angles = headAnglesFromMatrix(matrix);
    const worldPerSourcePx = s.crop.containerAspect / (s.crop.cropWidth * f.sourceWidth);
    return {
      faceDetected: true,
      yawDeg: angles ? angles.yaw : null,
      pitchDeg: angles ? angles.pitch : null,
      rollDeg: angles ? angles.roll : null,
      faceWidthPx: s.faceWidth / worldPerSourcePx,
      earringLengthPx: s.earrings.right.length / worldPerSourcePx,
      landmarkCount: lm.length,
      // world-space numbers for automated checks
      lobes: { right: s.earrings.right.position, left: s.earrings.left.position },
      forward: s.frame.forward,
    };
  }

  _drawDebug(lm, s, mirror) {
    if (!this.debugCtx) return;
    syncCanvasSize(this.debugCanvas);
    clearCanvas(this.debugCtx, this.debugCanvas);
    if (!lm || !s.faceDetected) return;
    const toVisible = createVisibleMapper(s.crop, mirror);
    drawHandLandmarks(this.debugCtx, this.debugCanvas, lm, FACE_OVAL_CONNECTIONS, {
      mapToVisible: toVisible,
      dotRadius: 0,
      lineColor: 'rgba(197, 160, 89, 0.7)',
    });
    for (const [side, ids] of Object.entries(EAR_LANDMARKS)) {
      drawHandLandmarks(this.debugCtx, this.debugCanvas, Object.values(ids).map((i) => lm[i]), [[0, 1], [1, 2]], {
        mapToVisible: toVisible,
        dotRadius: 4,
        dotColor: side === 'right' ? '#3BA7FF' : '#FF5A5A',
        lineColor: 'rgba(255,255,255,0.6)',
      });
    }
    // Estimated earlobes (world -> visible: x / aspect + 0.5, 0.5 - y).
    const aspect = s.crop.containerAspect;
    const lobes = ['right', 'left'].map((k) => s.earrings[k].position);
    drawHandLandmarks(this.debugCtx, this.debugCanvas, lobes, [], {
      mapToVisible: (p) => ({ x: p.x / aspect + 0.5, y: 0.5 - p.y }),
      dotRadius: 6,
      dotColor: '#3CFF6A',
    });
  }

  dispose() {
    if (this.debugCtx) clearCanvas(this.debugCtx, this.debugCanvas);
    this.scene.dispose();
  }
}
