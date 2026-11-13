/**
 * three-runtime.js
 *
 * One place that lazy-loads three.js (bundled from npm, pinned) for every
 * try-on scene, and one renderer factory so all categories share the same
 * performance settings.
 *
 * - GLTFLoader comes pre-wired with the Meshopt decoder, so the compressed
 *   .glb files from scripts/build-models.mjs load (plain .gltf still works).
 * - preserveDrawingBuffer is off by default: keeping the buffer forces an
 *   extra copy every frame on mobile GPUs. The ?debug=1 session recorder,
 *   which reads the WebGL canvas back, turns it on via setRendererOptions().
 */

let runtimePromise = null;

const rendererOptions = {
  preserveDrawingBuffer: false,
  maxPixelRatio: 1.5,
};

/** @param {{preserveDrawingBuffer?: boolean, maxPixelRatio?: number}} opts */
export function setRendererOptions(opts) {
  Object.assign(rendererOptions, opts);
}

/**
 * @returns {Promise<{THREE: typeof import('three'), GLTFLoader: Function, RoomEnvironment: Function}>}
 */
export function loadThreeRuntime() {
  if (!runtimePromise) {
    runtimePromise = Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/environments/RoomEnvironment.js'),
      import('three/addons/libs/meshopt_decoder.module.js'),
    ]).then(([THREE, gltf, env, meshopt]) => {
      class GLTFLoader extends gltf.GLTFLoader {
        constructor(manager) {
          super(manager);
          this.setMeshoptDecoder(meshopt.MeshoptDecoder);
        }
      }
      return { THREE, GLTFLoader, RoomEnvironment: env.RoomEnvironment };
    }).catch((err) => {
      runtimePromise = null;
      throw err;
    });
  }
  return runtimePromise;
}

/** Pixel ratio for the current device under the configured cap. */
export function overlayPixelRatio() {
  return Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, rendererOptions.maxPixelRatio);
}

/**
 * @param {typeof import('three')} THREE
 * @param {HTMLCanvasElement} canvas
 * @returns {import('three').WebGLRenderer}
 */
export function createOverlayRenderer(THREE, canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: rendererOptions.preserveDrawingBuffer,
  });
  // Capped: higher densities render the jewellery noticeably sharper than
  // the (usually soft, upscaled) webcam image and cost fill-rate.
  renderer.setPixelRatio(overlayPixelRatio());
  return renderer;
}

/**
 * Matches the drawing buffer to the canvas's on-screen size at the
 * renderer's pixel ratio, touching it only when it actually changed
 * (assigning canvas.width reallocates the WebGL drawing buffer).
 *
 * Note: renderer.setSize() takes CSS pixels and applies the pixel ratio
 * itself. (The scenes used to pass device pixels, which squared the ratio
 * — 2.25x per side at a 1.5 cap — and reallocated the buffer every frame.)
 *
 * @param {import('three').WebGLRenderer} renderer
 * @param {HTMLCanvasElement} canvas
 */
export function syncRendererSize(renderer, canvas) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const dpr = renderer.getPixelRatio();
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    renderer.setSize(w, h, false);
  }
}

/**
 * Applies a new pixel-ratio cap to a live renderer (quality tiers).
 * @param {import('three').WebGLRenderer} renderer
 * @param {number} maxPixelRatio
 */
export function setOverlayPixelRatio(renderer, maxPixelRatio) {
  rendererOptions.maxPixelRatio = maxPixelRatio;
  if (renderer) renderer.setPixelRatio(overlayPixelRatio());
}
