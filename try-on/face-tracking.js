/**
 * face-tracking.js
 *
 * Wraps MediaPipe's FaceLandmarker for the earring (and later necklace)
 * try-on. Same structure as hand-tracking.js: lazy-loaded model, GPU with
 * CPU fallback via the shared mediapipe-vision.js loader, and a
 * detect-only-on-new-video-frame loop.
 *
 * Besides the 478 face landmarks it requests the facial transformation
 * matrix: MediaPipe's estimate of the head's 3D pose, used for head turn
 * (yaw) so the earring on the far side of the head can be hidden.
 */

import { loadVisionModule, createTaskWithFallback } from './mediapipe-vision.js';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';

/** Face outline (MediaPipe face-mesh "face oval"), in drawing order. */
export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
export const FACE_OVAL_CONNECTIONS = FACE_OVAL.map((v, i) => [v, FACE_OVAL[(i + 1) % FACE_OVAL.length]]);

/**
 * Landmarks nearest the ears. The face mesh has no earlobe point; Phase 3
 * estimates the lobe from these. "Left"/"right" are the person's own
 * sides (MediaPipe's indices are defined on the subject's face).
 *   cheekEdge: outermost face point at ear level (just in front of the tragus)
 *   jawUpper:  face outline below it, toward the jaw angle (around lobe height)
 */
export const EAR_LANDMARKS = {
  right: { cheekEdge: 234, below: 93, jawUpper: 132 },
  left: { cheekEdge: 454, below: 323, jawUpper: 361 },
};

let faceLandmarkerInstance = null;
let faceLandmarkerDelegate = null;
let loadingPromise = null;

/** Lazily loads the FaceLandmarker (safe to call repeatedly). */
export async function loadFaceLandmarker() {
  if (faceLandmarkerInstance) return faceLandmarkerInstance;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const { FaceLandmarker } = await loadVisionModule();
    const { task, delegate } = await createTaskWithFallback(FaceLandmarker, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
    });
    faceLandmarkerInstance = task;
    faceLandmarkerDelegate = delegate;
    return task;
  })().catch((err) => {
    loadingPromise = null; // allow a retry
    throw err;
  });
  return loadingPromise;
}

/** 'GPU' | 'CPU' | null */
export function getFaceLandmarkerDelegate() {
  return faceLandmarkerDelegate;
}

export function detectFaceForVideoFrame(videoEl, timestampMs) {
  if (!faceLandmarkerInstance) throw new Error('FaceLandmarker not loaded — call loadFaceLandmarker() first.');
  return faceLandmarkerInstance.detectForVideo(videoEl, timestampMs);
}

export function disposeFaceLandmarker() {
  if (faceLandmarkerInstance) {
    faceLandmarkerInstance.close();
    faceLandmarkerInstance = null;
  }
  faceLandmarkerDelegate = null;
  loadingPromise = null;
}

/**
 * Head yaw / pitch / roll in degrees from MediaPipe's facial
 * transformation matrix (4x4, column-major, rotation part = head
 * orientation in the camera's frame, raw/unmirrored).
 *   yaw:   + = the person turned toward THEIR left (raw image: face points right)
 *   pitch: + = looking down
 *   roll:  + = head tilted toward their right shoulder (raw image: clockwise)
 * Signs are verified against real frames in the Phase 2 test; Phase 3
 * only relies on yaw's sign to decide which ear is hidden.
 *
 * @param {{data:number[]}|number[]} matrix
 * @returns {{yaw:number, pitch:number, roll:number}|null}
 */
export function headAnglesFromMatrix(matrix) {
  const m = matrix && (matrix.data || matrix);
  if (!m || m.length < 16) return null;
  // Columns: X axis (m0,m1,m2), Y axis (m4,m5,m6), Z axis = face forward (m8,m9,m10).
  const deg = 180 / Math.PI;
  const yaw = Math.atan2(m[8], m[10]) * deg;
  const pitch = Math.asin(Math.max(-1, Math.min(1, -m[9]))) * deg;
  const roll = Math.atan2(m[1], m[5]) * deg;
  return { yaw, pitch, roll };
}

/** Detect-on-new-frame loop (same pattern as HandTrackingSession). */
export class FaceTrackingSession {
  constructor(videoEl, onResult) {
    this.videoEl = videoEl;
    this.onResult = onResult;
    this.lastVideoTime = -1;
    this._running = false;
    this._rafId = null;
  }

  start() {
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      if (this.videoEl.readyState >= 2 && this.videoEl.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.videoEl.currentTime;
        this.onResult(detectFaceForVideoFrame(this.videoEl, performance.now()));
      }
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }
}
