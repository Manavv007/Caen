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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, rendererOptions.maxPixelRatio));
  return renderer;
}
