/**
 * necklace-scene.js
 *
 * Transparent Three.js overlay for necklaces. Same world space, camera and
 * lighting setup as earring-scene.js: the z = 0 plane spans exactly
 * the visible video, perspective matched to a webcam, reflections and
 * exposure driven by lighting-estimator.js.
 *
 *   necklace anchor    positioned at the neck base, oriented by necklace-solver.js,
 *                      uniform scale = neck width (model ring width is 1)
 *   neckOccluder       depth-only cylinder: hides the back of the chain behind the neck
 *   chestOccluder      depth-only box: hides the pendant behind the chest
 */

import { loadThreeRuntime, createOverlayRenderer, syncRendererSize } from './three-runtime.js';
import { computeCameraFrame, injectGrain } from './three-scene.js';
import { loadNecklaceModel } from './necklace-model.js';

let THREE = null;
let GLTFLoader = null;
let RoomEnvironment = null;

async function loadThree() {
  if (THREE) return;
  ({ THREE, GLTFLoader, RoomEnvironment } = await loadThreeRuntime());
}

export class NecklaceScene {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.necklaceAnchor = null;
    this._materials = [];
    this._grainUniforms = { uGrain: { value: 0.015 }, uGrainTime: { value: 0 } };
    this._baseExposure = 1.0;
    this.modelLoaded = false;
  }

  async init() {
    await loadThree();

    this.renderer = createOverlayRenderer(THREE, this.canvas);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this._baseExposure;

    this.scene = new THREE.Scene();

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this._envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this._envTexture;
    pmrem.dispose();

    // Key light from above-front + soft fill.
    this.keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.keyLight.position.set(0.3, 1, 0.8);
    this.scene.add(this.keyLight);
    this.fillLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
    this.scene.add(this.fillLight);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
    this.camera.position.set(0, 0, 1.4);

    // Necklace anchor group.
    this.necklaceAnchor = new THREE.Group();
    this.necklaceAnchor.visible = false;
    this.scene.add(this.necklaceAnchor);

    // Neck depth occluder (cylinder: radius 1, height 2 along Y).
    const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.neckOccluder = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 2, 32, 1, false),
      depthOnly
    );
    this.neckOccluder.renderOrder = -1;
    this.neckOccluder.visible = false;
    this.scene.add(this.neckOccluder);

    // Chest depth occluder (unit box).
    this.chestOccluder = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      depthOnly.clone()
    );
    this.chestOccluder.renderOrder = -1;
    this.chestOccluder.visible = false;
    this.scene.add(this.chestOccluder);

    this._m = new THREE.Matrix4();
    this._v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  }

  async loadNecklaceModel(url, opts = {}) {
    const { object, info } = await loadNecklaceModel(THREE, GLTFLoader, url, opts);
    this.modelInfo = info;

    // Separate materials for opacity control (visibility fading on head turn).
    // Set transparent permanently so a fade never forces a shader recompile.
    this._materials = [];
    object.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = [].concat(o.material).map((m) => {
        const c = m.clone();
        c.transparent = true;
        c.depthWrite = true;
        injectGrain(c, this._grainUniforms);
        this._materials.push(c);
        return c;
      });
      o.material = Array.isArray(o.material) ? mats : mats[0];
    });

    this.necklaceAnchor.add(object);
    this.modelLoaded = true;
  }

  resize(crop, videoAspect) {
    syncRendererSize(this.renderer, this.canvas);
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
    if (Array.isArray(scale)) obj.scale.set(scale[0], scale[1], scale[2]);
    else obj.scale.setScalar(scale);
  }

  /** @param {Object} s - output of NecklaceSolver.solve() */
  render(s) {
    this._grainUniforms.uGrainTime.value = (performance.now() / 1000) % 1000;
    const show = !!(s && s.tracked && s.necklace && this.modelLoaded);
    const vis = show ? (s.necklace.visibility === undefined ? 1 : s.necklace.visibility) : 0;

    this.necklaceAnchor.visible = vis > 0.01;
    if (this.necklaceAnchor.visible) {
      this._placeOriented(this.necklaceAnchor, s.necklace.position, s.necklace.axes, s.necklace.scale);
      for (const m of this._materials) m.opacity = vis;
    }

    this.neckOccluder.visible = show;
    this.chestOccluder.visible = show;
    if (show) {
      // Cylinder geometry is radius 1, height 2 along Y -> radii[1] = half length.
      this._placeOriented(this.neckOccluder, s.neckOccluder.center, s.neckOccluder.axes, s.neckOccluder.radii);
      // Box geometry is unit cube -> scale = half-extents on each axis.
      this._placeOriented(this.chestOccluder, s.chestOccluder.center, s.chestOccluder.axes, s.chestOccluder.radii);
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.necklaceAnchor) {
      this.necklaceAnchor.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          for (const m of [].concat(o.material)) m.dispose();
        }
      });
    }
    if (this.neckOccluder) {
      this.neckOccluder.geometry.dispose();
      this.neckOccluder.material.dispose();
    }
    if (this.chestOccluder) {
      this.chestOccluder.geometry.dispose();
      this.chestOccluder.material.dispose();
    }
    if (this._envTexture) this._envTexture.dispose();
    if (this.renderer) this.renderer.dispose();
  }
}
