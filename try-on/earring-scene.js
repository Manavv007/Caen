/**
 * earring-scene.js
 *
 * Transparent Three.js overlay for earrings. Same world space, camera and
 * lighting setup as three-scene.js (ring): the z = 0 plane spans exactly
 * the visible video, perspective matched to a webcam, reflections and
 * exposure driven by lighting-estimator.js.
 *
 *   earring.right / earring.left   anchor at the earlobe, axes from earring-solver.js,
 *                                  uniform scale = earring length (model height is 1)
 *   head, neck                     depth-only ellipsoid / cylinder: hide the
 *                                  far earring when the head turns
 */

import { computeCameraFrame, injectGrain } from './three-scene.js';
import { loadEarringModel, cloneMirroredEarring } from './earring-model.js';

let THREE = null;
let GLTFLoader = null;
let RoomEnvironment = null;

async function loadThree() {
  if (THREE) return;
  THREE = await import('three');
  ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
  ({ RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js'));
}

export class EarringScene {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.anchors = {};
    this._grainUniforms = { uGrain: { value: 0.015 }, uGrainTime: { value: 0 } };
    this._baseExposure = 1.0;
    this.modelLoaded = false;
  }

  async init() {
    await loadThree();
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

    for (const side of ['right', 'left']) {
      const a = new THREE.Group();
      a.visible = false;
      this.scene.add(a);
      this.anchors[side] = a;
    }

    const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.head = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), depthOnly);
    this.neck = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2, 32, 1, false), depthOnly);
    for (const m of [this.head, this.neck]) {
      m.renderOrder = -1;
      m.visible = false;
      this.scene.add(m);
    }
    this._m = new THREE.Matrix4();
    this._v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  }

  async loadEarringModel(url) {
    const { object } = await loadEarringModel(THREE, GLTFLoader, url);
    const mirrored = cloneMirroredEarring(object);
    // Separate materials per earring so each can fade on its own when the
    // head turns. Kept "transparent" permanently (opacity 1 normally) so a
    // fade never forces a shader recompile; depthWrite stays on.
    this._materials = { right: [], left: [] };
    for (const [side, root] of [['right', object], ['left', mirrored]]) {
      root.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const mats = [].concat(o.material).map((m) => {
          const c = m.clone();
          c.transparent = true;
          c.depthWrite = true;
          injectGrain(c, this._grainUniforms);
          this._materials[side].push(c);
          return c;
        });
        o.material = Array.isArray(o.material) ? mats : mats[0];
      });
    }
    // The person's right ear gets the model as-is, the left one the mirror.
    this.anchors.right.add(object);
    this.anchors.left.add(mirrored);
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
    if (Array.isArray(scale)) obj.scale.set(scale[0], scale[1], scale[2]);
    else obj.scale.setScalar(scale);
  }

  /** @param {Object} s - output of EarringSolver.solve() */
  render(s) {
    this._grainUniforms.uGrainTime.value = (performance.now() / 1000) % 1000;
    const show = !!(s && s.faceDetected && this.modelLoaded);
    for (const side of ['right', 'left']) {
      const a = this.anchors[side];
      const e = show ? s.earrings[side] : null;
      const vis = e ? (e.visibility === undefined ? 1 : e.visibility) : 0;
      a.visible = vis > 0.01;
      if (a.visible) {
        this._placeOriented(a, e.position, e.axes, e.length);
        for (const m of this._materials[side]) m.opacity = vis;
      }
    }
    this.head.visible = show;
    this.neck.visible = show;
    if (show) {
      this._placeOriented(this.head, s.head.center, s.head.axes, s.head.radii);
      // Cylinder geometry is radius 1, height 2 along Y -> radii[1] = half length.
      this._placeOriented(this.neck, s.neck.center, s.neck.axes, s.neck.radii);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const a of Object.values(this.anchors)) {
      a.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          for (const m of [].concat(o.material)) m.dispose();
        }
      });
    }
    if (this.head) {
      this.head.geometry.dispose();
      this.neck.geometry.dispose();
      this.head.material.dispose();
    }
    if (this._envTexture) this._envTexture.dispose();
    if (this.renderer) this.renderer.dispose();
  }
}
