/**
 * necklace-tryon-pipeline.js
 *
 * Per-frame processing for necklace try-on:
 * MediaPipe face result ─► NecklaceSolver (placement, pure) ─► NecklaceScene
 * (3D render), plus lighting from the camera image and a debug overlay
 * (?debug=1): face outline, the estimated neck base (green), and the
 * necklace anchor position (blue).
 *
 * Same structure as face-tryon-pipeline.js so the two can share
 * the FaceTrackingSession loop and SessionRecorder.
 */

import { createVisibleMapper, createViewMapper } from './view-mapping.js';
import { POSE_LANDMARKS } from './pose-tracking.js';
import { syncCanvasSize, clearCanvas, drawHandLandmarks } from './landmark-debug-draw.js';
import { FACE_OVAL_CONNECTIONS, headAnglesFromMatrix } from './face-tracking.js';
import { NecklaceSolver } from './necklace-solver.js';
import { NecklaceScene } from './necklace-scene.js';
import { LightingEstimator } from './lighting-estimator.js';

export class NecklaceTryOnPipeline {
  /**
   * @param {Object} opts
   * @param {HTMLCanvasElement} opts.overlayCanvas - WebGL layer
   * @param {HTMLCanvasElement|null} [opts.debugCanvas]
   * @param {string} opts.modelUrl - necklace model
   * @param {number} [opts.lengthMm] - real necklace length
   * @param {number} [opts.neckDown] - fraction of face width W to place neck base below midpoint
   * @param {boolean} [opts.cutBackside=true] - cut the back loop of the chain
   * @param {number} [opts.cutZ=-0.02] - normalized Z cutoff for cutting backside
   */
  constructor({ overlayCanvas, debugCanvas = null, modelUrl, lengthMm, neckDown, neckX, cutBackside = true, cutZ = -0.02 }) {
    this.debugCanvas = debugCanvas;
    this.debugCtx = debugCanvas ? debugCanvas.getContext('2d') : null;
    this.modelUrl = modelUrl;
    this.cutBackside = cutBackside;
    this.cutZ = cutZ;
    this.scene = new NecklaceScene(overlayCanvas);
    this.solver = new NecklaceSolver({ lengthMm, neckDown, neckX });
    this.lighting = new LightingEstimator();
    this.recording = null;
  }

  async init() {
    await this.scene.init();
    await this.scene.loadNecklaceModel(this.modelUrl, {
      cutBackside: this.cutBackside,
      cutZ: this.cutZ,
    });
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
   * One frame: all used landmarks (4 decimals), the head-pose matrix,
   * and what the live solver decided.
   */
  _record(f, lm, matrix, s) {
    const r = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
    const pt = (p) => [r(p.x, 4), r(p.y, 4), r(p.z, 4)];
    const live = s.tracked
      ? {
        mode: s.mode,
        faceWidth: r(s.faceWidth, 5),
        forward: s.frame ? pt(s.frame.forward) : null,
        necklace: {
          pos: pt(s.necklace.position),
          vis: r(s.necklace.visibility, 3),
          scale: r(s.necklace.scale, 5),
        },
      }
      : null;
    this.recording.push({
      t: r(f.timestampMs, 1), sw: f.sourceWidth, sh: f.sourceHeight,
      dw: r(f.displaySize.width, 1), dh: r(f.displaySize.height, 1), mirror: f.mirror,
      face: lm ? { landmarks: lm.map(pt), matrix: matrix ? Array.from(matrix.data || matrix).map((v) => r(v, 5)) : null } : null,
      // Pose shoulders/hips (x, y, visibility) so placement can be replayed offline.
      pose: (() => {
        const pl = f.poseResult && f.poseResult.landmarks && f.poseResult.landmarks[0];
        if (!pl) return null;
        return [11, 12, 23, 24].map((i) => (pl[i] ? [r(pl[i].x, 4), r(pl[i].y, 4), r(pl[i].visibility, 3)] : null));
      })(),
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
   * @param {Object|null} [f.poseResult] - PoseLandmarkerResult
   */
  processFrame(f) {
    const lm = f.faceResult && f.faceResult.faceLandmarks && f.faceResult.faceLandmarks[0];
    const matrix = f.faceResult && f.faceResult.facialTransformationMatrixes && f.faceResult.facialTransformationMatrixes[0];
    const poseLm = f.poseResult && f.poseResult.landmarks && f.poseResult.landmarks[0];
    
    const s = this.solver.solve({
      timeMs: f.timestampMs,
      sourceWidth: f.sourceWidth,
      sourceHeight: f.sourceHeight,
      displaySize: f.displaySize,
      mirror: f.mirror,
      landmarks: lm || null,
      poseLandmarks: poseLm || null,
      matrix: matrix || null,
    });

    const videoAspect = f.sourceWidth > 0 && f.sourceHeight > 0 ? f.sourceWidth / f.sourceHeight : s.crop.containerAspect;
    this.scene.resize(s.crop, videoAspect);
    if (f.source) this.scene.setLighting(this.lighting.update(f.source));
    this.scene.render(s);
    this._drawDebug(lm, poseLm, s, f.mirror);
    if (this.recording) this._record(f, lm, matrix, s);

    if (!s.tracked) return { faceDetected: false, poseDetected: false, trackingMode: null };
    const angles = lm ? headAnglesFromMatrix(matrix) : null;
    const worldPerSourcePx = s.crop.containerAspect / (s.crop.cropWidth * f.sourceWidth);
    return {
      // faceDetected stays true while the necklace is tracked from the body alone
      // (the page uses it for the status text), so the UI doesn't flip to "show your face".
      faceDetected: true,
      faceVisible: s.faceDetected,
      poseDetected: s.poseDetected || false,
      trackingMode: s.mode,
      held: !!s.held,
      yawDeg: angles ? angles.yaw : null,
      pitchDeg: angles ? angles.pitch : null,
      rollDeg: angles ? angles.roll : null,
      faceWidthPx: s.faceWidth / worldPerSourcePx,
      necklaceScale: s.necklace.scale,
      necklaceVisibility: s.necklace.visibility,
      landmarkCount: lm ? lm.length : 0,
      poseLandmarkCount: poseLm ? poseLm.length : 0,
      forward: s.frame ? s.frame.forward : null,
    };
  }

  _drawDebug(lm, poseLm, s, mirror) {
    if (!this.debugCtx) return;
    syncCanvasSize(this.debugCanvas);
    clearCanvas(this.debugCtx, this.debugCanvas);
    if (!s.tracked) return;
    const toVisible = createVisibleMapper(s.crop, mirror);

    // Face oval.
    if (lm && s.faceDetected) {
      drawHandLandmarks(this.debugCtx, this.debugCanvas, lm, FACE_OVAL_CONNECTIONS, {
        mapToVisible: toVisible,
        dotRadius: 0,
        lineColor: 'rgba(197, 160, 89, 0.7)',
      });
    }

    const aspect = s.crop.containerAspect;
    const toScreen = (p) => ({
      x: (p.x / aspect + 0.5) * this.debugCanvas.width,
      y: (0.5 - p.y) * this.debugCanvas.height,
    });
    const ctx = this.debugCtx;

    // Tracking mode label (both / face / pose), dimmed while a lost frame is held.
    ctx.fillStyle = s.held ? '#FFB020' : '#FFFFFF';
    ctx.font = '14px monospace';
    ctx.fillText(`mode: ${s.mode}${s.held ? ' (held)' : ''}`, 12, 22);

    // Pose shoulders (cyan line) if available.
    if (poseLm && s.poseDetected) {
      const toWorld = createViewMapper(s.crop, mirror);
      const leftS = toWorld(poseLm[POSE_LANDMARKS.leftShoulder]);
      const rightS = toWorld(poseLm[POSE_LANDMARKS.rightShoulder]);
      const p1 = toScreen(leftS);
      const p2 = toScreen(rightS);
      ctx.strokeStyle = '#00FFFF';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      // Shoulder dots.
      for (const p of [p1, p2]) {
        ctx.fillStyle = '#00FFFF';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Neck base point (green).
    if (s.necklace && s.necklace.position) {
      const p = toScreen(s.necklace.position);
      ctx.fillStyle = '#3CFF6A';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3CFF6A';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Face midpoint (small gold dot).
    if (s.frame && s.frame.mid) {
      const p = toScreen(s.frame.mid);
      ctx.fillStyle = '#C5A059';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  dispose() {
    if (this.debugCtx) clearCanvas(this.debugCtx, this.debugCanvas);
    this.scene.dispose();
  }
}
