/**
 * vision-worker.js  (module Web Worker)
 *
 * Runs the MediaPipe landmarkers off the main thread so detection and the
 * three.js render no longer take turns on one thread. Reuses the same
 * tracker modules (same models and options) as the main-thread path.
 *
 * Protocol (one request at a time; vision-client.js enforces it):
 *   → {type:'init', id, kinds:['hand'|'face'|'pose', ...]}
 *   ← {type:'ready', id, delegates:{hand:'GPU', ...}} | {type:'error', id, message}
 *   → {type:'detect', id, frame: ImageBitmap (transferred), timestampMs, kinds}
 *   ← {type:'result', id, results:{hand?, face?, pose?}, ms}
 *   → {type:'dispose'}
 */
import { loadHandLandmarker, detectHandsForVideoFrame, getHandLandmarkerDelegate, disposeHandLandmarker } from './hand-tracking.js';
import { loadFaceLandmarker, detectFaceForVideoFrame, getFaceLandmarkerDelegate, disposeFaceLandmarker } from './face-tracking.js';
import { loadPoseLandmarker, detectPoseForVideoFrame, getPoseLandmarkerDelegate, disposePoseLandmarker } from './pose-tracking.js';

const TASKS = {
  hand: { load: loadHandLandmarker, detect: detectHandsForVideoFrame, delegate: getHandLandmarkerDelegate, dispose: disposeHandLandmarker },
  face: { load: loadFaceLandmarker, detect: detectFaceForVideoFrame, delegate: getFaceLandmarkerDelegate, dispose: disposeFaceLandmarker },
  pose: { load: loadPoseLandmarker, detect: detectPoseForVideoFrame, delegate: getPoseLandmarkerDelegate, dispose: disposePoseLandmarker },
};

const errorMessage = (err) => String((err && err.message) || err);

self.onmessage = async ({ data }) => {
  const { type, id } = data;
  if (type === 'init') {
    try {
      const delegates = {};
      for (const kind of data.kinds) {
        await TASKS[kind].load();
        delegates[kind] = TASKS[kind].delegate();
      }
      self.postMessage({ type: 'ready', id, delegates });
    } catch (err) {
      self.postMessage({ type: 'error', id, message: errorMessage(err) });
    }
  } else if (type === 'detect') {
    const { frame, timestampMs, kinds } = data;
    const t0 = performance.now();
    try {
      const results = {};
      for (const kind of kinds) results[kind] = TASKS[kind].detect(frame, timestampMs);
      self.postMessage({ type: 'result', id, results, ms: performance.now() - t0 });
    } catch (err) {
      self.postMessage({ type: 'error', id, message: errorMessage(err) });
    } finally {
      frame.close();
    }
  } else if (type === 'dispose') {
    for (const t of Object.values(TASKS)) t.dispose();
    self.close();
  }
};
