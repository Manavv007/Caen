/**
 * mediapipe-vision.js
 *
 * Single place that loads @mediapipe/tasks-vision (pinned version) and its
 * WASM fileset, shared by hand tracking and skin segmentation so the WASM
 * runtime is fetched once.
 */

// Bundled from npm (pinned in package.json) and lazy-loaded as its own
// chunk; the wasm fileset is self-hosted (see asset-urls.js).
import { mediapipeWasmUrl } from './asset-urls.js';

export { TASKS_VISION_VERSION } from './asset-urls.js';

/** True inside a (module) Web Worker, where MediaPipe must load its wasm glue as an ES module. */
const IN_WORKER = typeof WorkerGlobalScope !== 'undefined' && typeof document === 'undefined';

let modulePromise = null;
let filesetPromise = null;

/** @returns {Promise<typeof import('@mediapipe/tasks-vision')>} */
export function loadVisionModule() {
  if (!modulePromise) {
    modulePromise = import('@mediapipe/tasks-vision').catch((err) => {
      modulePromise = null; // allow a retry instead of caching the failure forever
      throw err;
    });
  }
  return modulePromise;
}

export function loadVisionFileset() {
  if (!filesetPromise) {
    filesetPromise = loadVisionModule()
      .then(({ FilesetResolver }) => FilesetResolver.forVisionTasks(mediapipeWasmUrl(), IN_WORKER))
      .catch((err) => {
        filesetPromise = null;
        throw err;
      });
  }
  return filesetPromise;
}

/** Full URLs of the wasm glue + binary this context loaded (for the asset cache). */
export async function visionWasmUrls() {
  const fileset = await loadVisionFileset();
  return [fileset.wasmLoaderPath, fileset.wasmBinaryPath].filter(Boolean);
}

/**
 * In module mode MediaPipe import()s its wasm glue, reads the
 * `self.ModuleFactory` global it sets, then clears that global. A second
 * task (or a GPU->CPU retry) re-imports the same URL, which the module cache
 * serves without re-running it, so the global stays unset ("ModuleFactory not
 * set."). The glue's default export is that factory: put it back first.
 */
async function restoreModuleFactory(fileset) {
  if (self.ModuleFactory) return;
  const glue = await import(/* @vite-ignore */ fileset.wasmLoaderPath);
  self.ModuleFactory = glue.default;
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
      if (IN_WORKER) await restoreModuleFactory(fileset);
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
