/**
 * mediapipe-vision.js
 *
 * Single place that loads @mediapipe/tasks-vision (pinned version) and its
 * WASM fileset, shared by hand tracking and skin segmentation so the WASM
 * runtime is fetched once.
 */

// Pinned, not "@latest". Re-verify the jsdelivr URL resolves before bumping
// (jsdelivr does not mirror every published npm version/tag).
export const TASKS_VISION_VERSION = '1.0.1';
const BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/vision_bundle.mjs`;
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;

let modulePromise = null;
let filesetPromise = null;

/** @returns {Promise<typeof import('@mediapipe/tasks-vision')>} */
export function loadVisionModule() {
  if (!modulePromise) {
    modulePromise = import(BUNDLE_URL).catch((err) => {
      modulePromise = null; // allow a retry instead of caching the failure forever
      throw err;
    });
  }
  return modulePromise;
}

export function loadVisionFileset() {
  if (!filesetPromise) {
    filesetPromise = loadVisionModule()
      .then(({ FilesetResolver }) => FilesetResolver.forVisionTasks(WASM_BASE_URL))
      .catch((err) => {
        filesetPromise = null;
        throw err;
      });
  }
  return filesetPromise;
}

/**
 * Creates a MediaPipe task, preferring the GPU delegate and falling back to
 * CPU when GPU init fails (no WebGL2, blocklisted driver, some iOS versions).
 *
 * @param {{createFromOptions: Function}} TaskClass - e.g. HandLandmarker
 * @param {Object} options - task options; baseOptions.delegate is overridden
 * @returns {Promise<{task: any, delegate: 'GPU'|'CPU'}>}
 */
export async function createTaskWithFallback(TaskClass, options) {
  const fileset = await loadVisionFileset();
  let gpuError = null;
  for (const delegate of ['GPU', 'CPU']) {
    try {
      const task = await TaskClass.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate },
      });
      return { task, delegate };
    } catch (err) {
      if (delegate === 'GPU') {
        gpuError = err;
        continue;
      }
      err.message = `${err.message} (GPU init also failed: ${gpuError && gpuError.message})`;
      throw err;
    }
  }
  throw new Error('unreachable');
}
