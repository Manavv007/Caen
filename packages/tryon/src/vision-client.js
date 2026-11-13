/**
 * vision-client.js
 *
 * One interface over the MediaPipe landmarkers, wherever they run:
 *   - 'worker': in vision-worker.js, off the main thread (preferred)
 *   - 'main':   on the main thread, as before (fallback when module workers,
 *               OffscreenCanvas or the worker's WebGL/wasm are unavailable)
 *
 *   const vision = await createVisionClient(['face', 'pose']);
 *   const { results, frame } = await vision.detect(videoEl, performance.now(), ['face']);
 *   // results.face is a FaceLandmarkerResult, exactly as on the main thread.
 *   // frame: with {keepFrame: true} in worker mode, an ImageBitmap of the exact
 *   // frame the landmarks came from (caller must close() it); otherwise null,
 *   // and the <video> itself still shows that frame (main-thread detection is
 *   // synchronous).
 */
import { loadHandLandmarker, detectHandsForVideoFrame, getHandLandmarkerDelegate, disposeHandLandmarker } from './hand-tracking.js';
import { loadFaceLandmarker, detectFaceForVideoFrame, getFaceLandmarkerDelegate, disposeFaceLandmarker } from './face-tracking.js';
import { loadPoseLandmarker, detectPoseForVideoFrame, getPoseLandmarkerDelegate, disposePoseLandmarker } from './pose-tracking.js';
import { visionWasmUrls } from './mediapipe-vision.js';

const MAIN_TASKS = {
  hand: { load: loadHandLandmarker, detect: detectHandsForVideoFrame, delegate: getHandLandmarkerDelegate, dispose: disposeHandLandmarker },
  face: { load: loadFaceLandmarker, detect: detectFaceForVideoFrame, delegate: getFaceLandmarkerDelegate, dispose: disposeFaceLandmarker },
  pose: { load: loadPoseLandmarker, detect: detectPoseForVideoFrame, delegate: getPoseLandmarkerDelegate, dispose: disposePoseLandmarker },
};

/** Worker init covers wasm + model download on a slow connection; past this we fall back. */
const WORKER_INIT_TIMEOUT_MS = 60000;

function workerSupported() {
  return typeof Worker !== 'undefined'
    && typeof OffscreenCanvas !== 'undefined'
    && typeof createImageBitmap === 'function';
}

class MainThreadVision {
  constructor(kinds) {
    this.mode = 'main';
    this.kinds = kinds;
    this.delegates = {};
    this.wasmUrls = []; // MediaPipe wasm files this client loaded (asset cache warm-up)
    this.fallbackReason = null;
  }

  async init() {
    for (const kind of this.kinds) {
      await MAIN_TASKS[kind].load();
      this.delegates[kind] = MAIN_TASKS[kind].delegate();
    }
    this.wasmUrls = await visionWasmUrls().catch(() => []);
    return this;
  }

  async detect(video, timestampMs, kinds = this.kinds) {
    const results = {};
    for (const kind of kinds) results[kind] = MAIN_TASKS[kind].detect(video, timestampMs);
    return { results, frame: null };
  }

  dispose() {
    for (const kind of this.kinds) MAIN_TASKS[kind].dispose();
  }
}

class WorkerVision {
  constructor(kinds) {
    this.mode = 'worker';
    this.kinds = kinds;
    this.delegates = {};
    this.wasmUrls = [];
    this.lastWorkerMs = null; // detection time inside the worker, for the debug panel
    this._nextId = 1;
    this._pending = new Map();
    this._worker = new Worker(new URL('./vision-worker.js', import.meta.url), { type: 'module' });
    this._worker.onmessage = ({ data }) => {
      const p = this._pending.get(data.id);
      if (!p) return;
      this._pending.delete(data.id);
      if (data.type === 'error') p.reject(new Error(data.message));
      else p.resolve(data);
    };
    this._worker.onerror = (e) => {
      const err = new Error(`vision worker: ${(e && e.message) || 'failed to start'}`);
      this._pending.forEach((p) => p.reject(err));
      this._pending.clear();
    };
  }

  _request(msg, transfer = []) {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this._worker.postMessage({ ...msg, id }, transfer);
    });
  }

  async init() {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('vision worker init timed out')), WORKER_INIT_TIMEOUT_MS);
    });
    try {
      const { delegates, wasmUrls } = await Promise.race([this._request({ type: 'init', kinds: this.kinds }), timeout]);
      this.delegates = delegates;
      this.wasmUrls = wasmUrls || [];
    } finally {
      clearTimeout(timer);
    }
    return this;
  }

  async detect(video, timestampMs, kinds = this.kinds, { keepFrame = false } = {}) {
    const sent = await createImageBitmap(video);
    // A second handle on the same frame for main-thread pixel work (skin
    // measurement must see the frame the landmarks came from, not a newer one).
    const kept = keepFrame ? await createImageBitmap(sent) : null;
    try {
      const { results, ms } = await this._request({ type: 'detect', frame: sent, timestampMs, kinds }, [sent]);
      this.lastWorkerMs = ms;
      return { results, frame: kept };
    } catch (err) {
      if (kept) kept.close();
      throw err;
    }
  }

  dispose() {
    this._worker.postMessage({ type: 'dispose' });
    this._pending.clear();
  }

  terminate() {
    this._worker.terminate();
    this._pending.clear();
  }
}

/**
 * @param {Array<'hand'|'face'|'pose'>} kinds - landmarkers to load
 * @param {{prefer?: 'worker'|'main'}} [opts] - 'main' forces the main-thread path (A/B testing)
 * @returns {Promise<MainThreadVision|WorkerVision>}
 */
export async function createVisionClient(kinds, { prefer = 'worker' } = {}) {
  let fallbackReason = prefer === 'main' ? 'forced' : null;
  if (prefer !== 'main') {
    if (!workerSupported()) {
      fallbackReason = 'unsupported';
    } else {
      const vision = new WorkerVision(kinds);
      try {
        return await vision.init();
      } catch (err) {
        vision.terminate();
        fallbackReason = String((err && err.message) || err);
      }
    }
  }
  const vision = new MainThreadVision(kinds);
  vision.fallbackReason = fallbackReason;
  return vision.init();
}
