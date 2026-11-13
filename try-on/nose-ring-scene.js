/**
 * nose-ring-scene.js
 *
 * Transparent Three.js overlay for the nose ring. Same world space, camera
 * and lighting setup as earring-scene.js / three-scene.js: the z = 0 plane
 * spans exactly the visible video, perspective matched to a webcam,
 * reflections and exposure driven by lighting-estimator.js.
 *
 *   ring   anchor at the ring's centre, axes from nose-ring-solver.js,
 *          uniform scale = ring diameter (model diameter is 1)
 */

import { computeCameraFrame, injectGrain } from './three-scene.js';
import { loadNoseRingModel } from './nose-ring-model.js';

let THREE = null;
let GLTFLoader = null;
let RoomEnvironment = null;

/** Ring height (diameters from the centre; the gap is on -Y) below which the ring is fully hidden. */
export const DEFAULT_CUT_HIDDEN = -0.30;
/** Width of the fade-in above that (diameters). */
const CUT_SOFTNESS = 0.07;

async function loadThree() {
  if (THREE) return;
  THREE = await import('three');
  ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
  ({ RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js'));
}

/**
 * Fades the ring out below a height in its own (normalised) frame, so the
 * open end of the horseshoe, the two cones and the tube next to them, looks
 * as if it goes into the nostril instead of ending in view.
 *
 * Chained after injectGrain's onBeforeCompile. In ring space the centre is the
 * origin, the outer diameter is 1 and the model's gap is on -Y, so the part
 * to hide is y < uCut.x (fully hidden) … y > uCut.y (fully shown).
 */
function injectCut(material, uniforms) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uRingInv = uniforms.uRingInv;
    shader.uniforms.uCut = uniforms.uCut;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform mat4 uRingInv;\nvarying vec3 vRingPos;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRingPos = (uRingInv * modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec2 uCut;\nvarying vec3 vRingPos;\nvoid main() {')
      .replace('#include <alphamap_fragment>', [
        '#include <alphamap_fragment>',
        'diffuseColor.a *= smoothstep(uCut.x, uCut.y, vRingPos.y);',
        'if (diffuseColor.a < 0.004) discard;',
      ].join('\n'));
  };
  material.customProgramCacheKey = () => 'nose-ring-grain-cut';
  material.needsUpdate = true;
}

export class NoseRingScene {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{cutHidden?:number, cutShown?:number}} [opts] cut band, in ring diameters
   *   from the ring's centre (negative = toward the gap). cutHidden = -1 disables the cut.
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this._grainUniforms = { uGrain: { value: 0.015 }, uGrainTime: { value: 0 } };
    this._cutUniforms = {
      uRingInv: { value: null },
      uCut: { value: null },
    };
    this._baseExposure = 1.0;
    this._materials = [];
    this.modelLoaded = false;
    this._cutOpts = opts;
  }

  async init() {
    await loadThree();
    this._cutUniforms.uRingInv.value = new THREE.Matrix4();
    const hidden = Number.isFinite(this._cutOpts.cutHidden) ? this._cutOpts.cutHidden : DEFAULT_CUT_HIDDEN;
    const shown = Number.isFinite(this._cutOpts.cutShown) ? this._cutOpts.cutShown : hidden + CUT_SOFTNESS;
    this._cutUniforms.uCut.value = new THREE.Vector2(hidden, shown);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this._baseExposure;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this._envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this._envTexture;
    pmrem.dispose();
    this.keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.keyLight.position.set(0.3, 1, 0.8);
    this.scene.add(this.keyLight);
    this.fillLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
    this.scene.add(this.fillLight);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
    this.camera.position.set(0, 0, 1.4);

    this.anchor = new THREE.Group();
    this.anchor.visible = false;
    this.scene.add(this.anchor);

    this._m = new THREE.Matrix4();
    this._v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  }

  async loadNoseRingModel(url) {
    const { object } = await loadNoseRingModel(THREE, GLTFLoader, url);
    // Own materials so the ring can fade when the head turns. Kept
    // "transparent" permanently (opacity 1 normally) so a fade never forces a
    // shader recompile; depthWrite stays on.
    this._materials = [];
    object.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = [].concat(o.material).map((m) => {
        const c = m.clone();
        c.transparent = true;
        c.depthWrite = true;
        injectGrain(c, this._grainUniforms);
        injectCut(c, this._cutUniforms);
        this._materials.push(c);
        return c;
      });
      o.material = Array.isArray(o.material) ? mats : mats[0];
    });
    this.anchor.add(object);
    this.modelLoaded = true;
  }

  resize(crop, videoAspect) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.renderer.getPixelRatio();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) this.renderer.setSize(w, h, false);
    const { fovDeg, distance } = computeCameraFrame(crop.containerAspect, videoAspect, crop.cropHeight);
    const cam = this.camera;
    if (cam.aspect !== crop.containerAspect || cam.fov !== fovDeg || cam.position.z !== distance) {
      cam.aspect = crop.containerAspect;
      cam.fov = fovDeg;
      cam.position.set(0, 0, distance);
      cam.near = distance * 0.1;
      cam.far = distance * 10;
      cam.updateProjectionMatrix();
    }
  }

  setLighting(params) {
    if (!params || !this.renderer) return;
    this.renderer.toneMappingExposure = this._baseExposure * params.exposure;
    this.scene.environmentIntensity = params.envIntensity;
    this.keyLight.color.setRGB(params.tint.r, params.tint.g, params.tint.b);
    this.fillLight.color.setRGB(params.tint.r, params.tint.g, params.tint.b);
    this._grainUniforms.uGrain.value = params.grain;
  }

  /**
   * A point meant to appear at screen-plane (x, y) but at depth z must be
   * scaled by (d - z) / d so the perspective camera still projects it to (x, y).
   */
  _place(out, p) {
    const d = this.camera.position.z;
    const k = (d - p.z) / d;
    return out.set(p.x * k, p.y * k, p.z);
  }

  _placeOriented(obj, p, axes, scale) {
    const [x, y, z] = this._v;
    x.set(axes[0].x, axes[0].y, axes[0].z);
    y.set(axes[1].x, axes[1].y, axes[1].z);
    z.set(axes[2].x, axes[2].y, axes[2].z);
    this._m.makeBasis(x, y, z);
    obj.quaternion.setFromRotationMatrix(this._m);
    this._place(obj.position, p);
    obj.scale.setScalar(scale);
  }

  /** @param {Object} s - output of NoseRingSolver.solve() */
  render(s) {
    this._grainUniforms.uGrainTime.value = (performance.now() / 1000) % 1000;
    const show = !!(s && s.faceDetected && this.modelLoaded);
    const vis = show ? (s.ring.visibility === undefined ? 1 : s.ring.visibility) : 0;
    this.anchor.visible = vis > 0.01;
    if (this.anchor.visible) {
      this._placeOriented(this.anchor, s.ring.position, s.ring.axes, s.ring.scale);
      // World -> ring space for the cut (anchor space = ring centre, diameter 1).
      this.anchor.updateMatrixWorld(true);
      this._cutUniforms.uRingInv.value.copy(this.anchor.matrixWorld).invert();
      for (const m of this._materials) m.opacity = vis;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.anchor) {
      this.anchor.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          for (const m of [].concat(o.material)) m.dispose();
        }
      });
    }
    if (this._envTexture) this._envTexture.dispose();
    if (this.renderer) this.renderer.dispose();
  }
}
