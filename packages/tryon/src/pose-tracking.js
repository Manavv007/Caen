/**
 * pose-tracking.js
 *
 * Wraps MediaPipe's PoseLandmarker for necklace try-on. Same structure as
 * face-tracking.js: lazy-loaded model, GPU with CPU fallback, and a
 * detect-only-on-new-video-frame loop.
 *
 * Returns 33 body landmarks (0–32), including:
 *   11, 12: left and right shoulders
 *   23, 24: left and right hips
 *   0: nose (for reference, though face tracking already has this)
 *
 * MediaPipe Pose is optimized for full-body tracking, but works with
 * upper-body-only frames (webcam shots). Shoulders and hips provide a
 * stable torso frame that doesn't move with head rotation.
 */

import { loadVisionModule, createTaskWithFallback } from './mediapipe-vision.js';
import { mediapipeModelUrl } from './asset-urls.js';

/**
 * Key pose landmarks (MediaPipe Pose indices).
 * All coordinates are normalized [0, 1] × [0, 1] in the image.
 * "Left" and "right" are the person's own sides.
 */
export const POSE_LANDMARKS = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
};

let poseLandmarkerInstance = null;
let poseLandmarkerDelegate = null;
let loadingPromise = null;

/** Lazily loads the PoseLandmarker (safe to call repeatedly). */
export async function loadPoseLandmarker() {
  if (poseLandmarkerInstance) return poseLandmarkerInstance;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const { PoseLandmarker } = await loadVisionModule();
    const { task, delegate } = await createTaskWithFallback(PoseLandmarker, {
      baseOptions: { modelAssetPath: mediapipeModelUrl('pose') },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
    poseLandmarkerInstance = task;
    poseLandmarkerDelegate = delegate;
    return task;
  })().catch((err) => {
    loadingPromise = null; // allow a retry
    throw err;
  });
  return loadingPromise;
}

/** 'GPU' | 'CPU' | null */
export function getPoseLandmarkerDelegate() {
  return poseLandmarkerDelegate;
}

export function detectPoseForVideoFrame(videoEl, timestampMs) {
  if (!poseLandmarkerInstance) throw new Error('PoseLandmarker not loaded — call loadPoseLandmarker() first.');
  return poseLandmarkerInstance.detectForVideo(videoEl, timestampMs);
}

export function disposePoseLandmarker() {
  if (poseLandmarkerInstance) {
    poseLandmarkerInstance.close();
    poseLandmarkerInstance = null;
  }
  poseLandmarkerDelegate = null;
  loadingPromise = null;
}

/**
 * Torso orientation from shoulder landmarks.
 * Returns a right-handed basis for the torso/chest plane:
 *   side: person's right shoulder → left shoulder (normalized)
 *   up:   perpendicular to side in the vertical plane
 *   forward: side × up (points toward the camera when facing it)
 *
 * @param {{x,y,z}} leftShoulder - world-space landmark
 * @param {{x,y,z}} rightShoulder - world-space landmark
 * @returns {{side, up, forward, width:number}|null}
 */
export function computeTorsoFrame(leftShoulder, rightShoulder) {
  if (!leftShoulder || !rightShoulder) return null;
  // Work in the image plane only: MediaPipe pose depth (z) is far too
  // noisy to build axes from. The frame captures the shoulder ROLL; the
  // torso faces the camera (+z), which is what a webcam try-on shows.
  let dx = rightShoulder.x - leftShoulder.x;
  let dy = rightShoulder.y - leftShoulder.y;
  // Always point "side" toward screen-right (+x). This makes the result
  // independent of which shoulder is which and of camera mirroring, so
  // the basis stays right-handed with forward = +z toward the viewer.
  if (dx < 0) { dx = -dx; dy = -dy; }
  const width = Math.hypot(dx, dy);
  if (width < 1e-6) return null;
  const side = { x: dx / width, y: dy / width, z: 0 };
  const up = { x: -side.y, y: side.x, z: 0 }; // side rotated +90° in the screen plane
  const forward = { x: 0, y: 0, z: 1 };       // side × up
  return { side, up, forward, width };
}
