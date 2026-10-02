/**
 * hand-tracking.js
 *
 * Wraps MediaPipe's HandLandmarker (via @mediapipe/tasks-vision, loaded
 * from CDN as an ES module) for the rings try-on pipeline. Responsible
 * for: loading the WASM runtime + model, running detection against a
 * live <video> element frame-by-frame, and returning the raw landmark
 * results. Drawing/anchoring logic lives in separate modules (Task 3's
 * debug visualization here; ring anchoring comes in Task 4).
 *
 * All heavy assets (WASM binaries, the .task model file, ~10MB total)
 * are lazy-loaded only when this module is imported — i.e. only once
 * the user opens the try-on view, not on every page load.
 */

import { loadVisionModule, createTaskWithFallback } from './mediapipe-vision.js';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

/**
 * 21 hand landmark connections, used for debug/skeleton drawing.
 * Indices follow MediaPipe's standard hand landmark topology:
 * https://developers.google.com/mediapipe/solutions/vision/hand_landmarker
 */
export const HAND_CONNECTIONS = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index finger
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle finger
  [0, 9], [9, 10], [10, 11], [11, 12],
  // Ring finger
  [0, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm base
  [5, 9], [9, 13], [13, 17],
];

/** Named landmark indices relevant to ring placement (used in Task 4). */
export const RING_FINGER_LANDMARKS = {
  WRIST: 0,
  RING_MCP: 13, // knuckle at base of ring finger
  RING_PIP: 14, // middle joint of ring finger — typical ring-wearing position
  RING_DIP: 15,
  RING_TIP: 16,
};

let handLandmarkerInstance = null;
let handLandmarkerDelegate = null;
let loadingPromise = null;

/**
 * Lazily loads and initializes the MediaPipe HandLandmarker.
 * Safe to call multiple times — subsequent calls reuse the same instance/
 * in-flight load rather than re-downloading the model.
 *
 * @returns {Promise<import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs').HandLandmarker>}
 */
export async function loadHandLandmarker() {
  if (handLandmarkerInstance) {
    return handLandmarkerInstance;
  }
  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    const { HandLandmarker } = await loadVisionModule();
    const { task, delegate } = await createTaskWithFallback(HandLandmarker, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: 'VIDEO',
      numHands: 1, // one ring at a time — matches the single-product try-on flow
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    handLandmarkerInstance = task;
    handLandmarkerDelegate = delegate;
    return handLandmarkerInstance;
  })().catch((err) => {
    loadingPromise = null; // allow "Try again" to re-attempt the download
    throw err;
  });

  return loadingPromise;
}

/** 'GPU' | 'CPU' | null — which delegate the hand model ended up on (for debug/telemetry). */
export function getHandLandmarkerDelegate() {
  return handLandmarkerDelegate;
}

/**
 * Runs hand detection against the current frame of a playing <video>
 * element. Must be called with a monotonically increasing timestamp
 * (e.g. performance.now()) and only when the video has advanced to a
 * new frame — see the detection loop pattern in HandTrackingSession below.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {number} timestampMs
 * @returns {import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs').HandLandmarkerResult|null}
 */
export function detectHandsForVideoFrame(videoEl, timestampMs) {
  if (!handLandmarkerInstance) {
    throw new Error('HandLandmarker not loaded — call loadHandLandmarker() first.');
  }
  return handLandmarkerInstance.detectForVideo(videoEl, timestampMs);
}

/**
 * Releases the underlying MediaPipe task and its WASM/GPU resources.
 * Call this when leaving the try-on view to free memory, especially
 * important on mid-range mobile devices.
 */
export function disposeHandLandmarker() {
  if (handLandmarkerInstance) {
    handLandmarkerInstance.close();
    handLandmarkerInstance = null;
  }
  handLandmarkerDelegate = null;
  loadingPromise = null;
}

/**
 * A small stateful helper that runs the detect-on-new-frame loop pattern
 * MediaPipe recommends for video: only re-run detection when the video's
 * currentTime has actually advanced, avoiding duplicate work if the
 * render loop runs faster than the video decodes new frames.
 */
export class HandTrackingSession {
  /**
   * @param {HTMLVideoElement} videoEl
   * @param {(result: any) => void} onResult - called with each new detection result
   */
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
        const result = detectHandsForVideoFrame(this.videoEl, performance.now());
        this.onResult(result);
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
