/**
 * nose-ring-pipeline.js
 *
 * Per-frame processing for nose-ring try-on:
 * MediaPipe face result ─► NoseRingSolver (placement, pure) ─► NoseRingScene
 * (3D render), plus lighting from the camera image and a debug overlay
 * (?debug=1): face outline, the nostril-wing landmarks (blue = the ring's
 * side), and the estimated piercing point (green).
 *
 * Same structure as face-tryon-pipeline.js so the page can share the
 * TrackingLoop (frame-scheduler.js) and the SessionRecorder.
 */

import { createVisibleMapper } from './view-mapping.js';
import { syncCanvasSize, clearCanvas, drawHandLandmarks } from './landmark-debug-draw.js';
import { FACE_OVAL_CONNECTIONS, headAnglesFromMatrix } from './face-tracking.js';
import { NoseRingSolver, NOSTRIL_LANDMARKS } from './nose-ring-solver.js';
import { NoseRingScene } from './nose-ring-scene.js';
import { LightingEstimator } from './lighting-estimator.js';
import { PoseSmoother } from './render-smoothing.js';

export class NoseRingTryOnPipeline {
  /**
   * @param {Object} opts
   * @param {HTMLCanvasElement} opts.overlayCanvas - WebGL layer
   * @param {HTMLCanvasElement|null} [opts.debugCanvas]
   * @param {string} opts.modelUrl - nose ring model
   * @param {number} [opts.diameterMm] - real outer diameter of the ring
   * @param {'left'|'right'} [opts.side] - which nostril (the person's own side)
   * @param {number} [opts.tiltDeg] - ring plane turned outward by this much
   * @param {number} [opts.rollDeg] - gap turned toward the nose centre by this much (0 = straight up)
   * @param {{out?:number,down?:number,forward?:number}} [opts.offset] - piercing offset, in face widths
   * @param {number} [opts.drop] - ring centre below the piercing, in ring diameters
   * @param {number} [opts.cutHidden] - ring height (diameters from centre, negative toward the gap; -1 = nothing) hidden below
   */
  constructor({ overlayCanvas, debugCanvas = null, modelUrl, diameterMm, side, tiltDeg, rollDeg, offset, drop, cutHidden, smooth = false }) {
    this.debugCanvas = debugCanvas;
    this.debugCtx = debugCanvas ? debugCanvas.getContext('2d') : null;
    this.modelUrl = modelUrl;
    this.scene = new NoseRingScene(overlayCanvas, { cutHidden });
    this.solver = new NoseRingSolver({ diameterMm, side, tiltDeg, rollDeg, offset, drop });
    this.lighting = new LightingEstimator();
    // smooth: render from renderFrame() on rAF, extrapolating between detections.
    this.smoother = smooth ? new PoseSmoother({
      getPoints: (s) => (s.faceDetected ? [s.ring.position] : null),
      withPoints: (s, [ring]) => ({ ...s, ring: { ...s.ring, position: ring } }),
    }) : null;
    this.recording = null; // array of frame records while recording
  }

  async init() {
    await this.scene.init();
    await this.scene.loadNoseRingModel(this.modelUrl);
  }

  reset() {
    this.solver.reset();
    this.lighting.reset();
    if (this.smoother) this.smoother.reset();
  }

  /** Smooth mode only: draws the latest placement, extrapolated to `nowMs` (call on rAF). */
  renderFrame(nowMs) {
    const s = this.smoother && this.smoother.at(nowMs);
    if (s) this.scene.render(s);
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
   * One frame: all 478 landmarks (4 decimals) so later replays can tune
   * anything, the head-pose matrix, and what the live solver decided.
   */
  _record(f, lm, matrix, s) {
    const r = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
    const pt = (p) => [r(p.x, 4), r(p.y, 4), r(p.z, 4)];
    const live = s.faceDetected
      ? {
        faceWidth: r(s.faceWidth, 5),
        forward: pt(s.frame.forward),
        side: s.side,
        ring: { pos: pt(s.ring.position), vis: r(s.ring.visibility, 3), scale: r(s.ring.scale, 5) },
        piercing: pt(s.piercing),
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
    if (this.smoother) this.smoother.push(s, f.timestampMs, performance.now());
    else this.scene.render(s);
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
      ringDiameterPx: s.ring.scale / worldPerSourcePx,
      ringVisibility: s.ring.visibility,
      side: s.side,
      landmarkCount: lm.length,
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
    // Both nostril wings (small), the chosen side in blue.
    for (const [side, ids] of Object.entries(NOSTRIL_LANDMARKS)) {
      drawHandLandmarks(this.debugCtx, this.debugCanvas, Object.values(ids).map((i) => lm[i]), [], {
        mapToVisible: toVisible,
        dotRadius: side === s.side ? 3 : 2,
        dotColor: side === s.side ? '#3BA7FF' : 'rgba(255,255,255,0.5)',
      });
    }
    // Estimated piercing (world -> visible: x / aspect + 0.5, 0.5 - y).
    const aspect = s.crop.containerAspect;
    drawHandLandmarks(this.debugCtx, this.debugCanvas, [s.piercing], [], {
      mapToVisible: (p) => ({ x: p.x / aspect + 0.5, y: 0.5 - p.y }),
      dotRadius: 4,
      dotColor: '#3CFF6A',
    });
  }

  dispose() {
    if (this.debugCtx) clearCanvas(this.debugCtx, this.debugCanvas);
    this.scene.dispose();
  }
}
