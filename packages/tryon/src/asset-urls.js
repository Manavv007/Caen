/**
 * asset-urls.js
 *
 * Same-origin URLs for every runtime asset try-on fetches. The files are put
 * in place by scripts/fetch-mediapipe.mjs (MediaPipe) and
 * scripts/build-models.mjs (jewellery GLBs); names are versioned so the CDN
 * can cache them as immutable.
 *
 * The host app may move them (e.g. to a separate assets domain) with
 * setAssetBase() before any try-on module loads a model.
 */

// Keep in sync with packages/tryon/package.json and scripts/fetch-mediapipe.mjs.
export const TASKS_VISION_VERSION = '1.0.1';

let base = '/';

/** @param {string} url - base URL ending in '/', e.g. 'https://assets.example.com/' */
export function setAssetBase(url) {
  base = url.endsWith('/') ? url : `${url}/`;
}

export const assetUrl = (p) => `${base}${p.replace(/^\//, '')}`;

export const mediapipeWasmUrl = () => assetUrl(`mediapipe/${TASKS_VISION_VERSION}/wasm`);

export const MEDIAPIPE_MODELS = {
  hand: 'mediapipe/models/hand_landmarker-v1.task',
  face: 'mediapipe/models/face_landmarker-v1.task',
  pose: 'mediapipe/models/pose_landmarker_lite-v1.task',
  skin: 'mediapipe/models/selfie_multiclass_256x256-v1.tflite',
};

/** @param {keyof typeof MEDIAPIPE_MODELS} name */
export const mediapipeModelUrl = (name) => assetUrl(MEDIAPIPE_MODELS[name]);
