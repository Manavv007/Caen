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

/** canvas -> {renderer, envTexture}: one WebGL context + environment map per canvas. */
const sharedRenderers = new WeakMap();

/**
 * The overlay renderer for a canvas plus its RoomEnvironment reflection map,
 * created once and reused by every scene drawn on that canvas. A camera
 * switch rebuilds the pipeline and scene; with this it keeps the WebGL
 * context, compiled programs and the PMREM map instead of creating them
 * again (the PMREM blur passes are the slowest part of scene init on phones).
 *
 * @param {{THREE: typeof import('three'), RoomEnvironment: Function}} runtime - from loadThreeRuntime()
 * @param {HTMLCanvasElement} canvas
 * @returns {{renderer: import('three').WebGLRenderer, envTexture: import('three').Texture}}
 */
export function acquireOverlayRenderer({ THREE, RoomEnvironment }, canvas) {
  let shared = sharedRenderers.get(canvas);
  if (!shared) {
    const renderer = createOverlayRenderer(THREE, canvas);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const envTexture = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose();
    if (typeof room.dispose === 'function') room.dispose();
    shared = { renderer, envTexture };
    sharedRenderers.set(canvas, shared);
  } else {
    shared.renderer.setPixelRatio(overlayPixelRatio()); // the quality tier may have changed meanwhile
  }
  return shared;
}

/**
 * Called by a scene's dispose() instead of renderer.dispose(): the renderer
 * stays alive for the next scene on the same canvas. Clears the canvas so
 * the last jewellery frame doesn't linger while the next scene loads.
 * @param {import('three').WebGLRenderer} renderer
 */
export function releaseOverlayRenderer(renderer) {
  if (!renderer) return;
  renderer.setRenderTarget(null);
  renderer.clear();
}

/**
 * Render on demand: remembers the numbers that determine the last rendered
 * image (camera, canvas size, lighting, object transforms) and says whether
 * a new frame differs from it by more than `epsilon`. Compared against the
 * last *rendered* state, so slow drift still triggers a render once it adds up.
 *
 * Skipping is safe with preserveDrawingBuffer off: a WebGL canvas that is not
 * drawn to keeps showing its last presented frame. (Only the film grain's
 * animation pauses while nothing moves.)
 */
export class RenderGate {
  /** @param {number} [epsilon] - world units; 1e-4 is ~0.1 px on a phone screen */
  constructor(epsilon = 1e-4) {
    this.epsilon = epsilon;
    this.rendered = 0;
    this.skipped = 0;
    this._last = null;
  }

  /**
   * @param {number[]} state
   * @returns {boolean} true if the frame must be rendered
   */
  shouldRender(state) {
    const last = this._last;
    let changed = !last || last.length !== state.length;
    for (let i = 0; !changed && i < state.length; i++) {
      // NaN never equals itself: treat it as changed.
      if (!(Math.abs(state[i] - last[i]) <= this.epsilon)) changed = true;
    }
    if (changed) {
      this._last = state.slice();
      this.rendered++;
    } else {
      this.skipped++;
    }
    return changed;
  }

  /** Forces the next frame to render. */
  invalidate() {
    this._last = null;
  }
}

/**
 * Appends what an Object3D contributes to the image: visibility, and if
 * visible its position, rotation and scale.
 * @param {number[]} out
 * @param {import('three').Object3D} obj
 */
export function pushObjectState(out, obj) {
  out.push(obj.visible ? 1 : 0);
  if (!obj.visible) return out;
  const p = obj.position;
  const q = obj.quaternion;
  const s = obj.scale;
  out.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z);
  return out;
}

/**
 * State shared by every overlay scene: drawing-buffer size, camera, and the
 * lighting set by setLighting().
 */
export function baseRenderState(renderer, camera, scene, keyLight, fillLight, grainUniforms) {
  const c = renderer.domElement;
  return [
    c.width, c.height,
    camera.fov, camera.aspect, camera.position.z,
    renderer.toneMappingExposure, scene.environmentIntensity,
    keyLight.color.r, keyLight.color.g, keyLight.color.b,
    fillLight.color.r, fillLight.color.g, fillLight.color.b,
    grainUniforms.uGrain.value,
  ];
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
