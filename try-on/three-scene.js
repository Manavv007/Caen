/**
 * three-scene.js
 *
 * Transparent Three.js overlay that renders the ring on top of the
 * camera feed, driven by a RingPose (see ring-anchor.js) expressed in
 * this scene's world space (see view-mapping.js): the z = 0 plane spans
 * x in [-aspect/2, aspect/2], y in [-0.5, 0.5], exactly the visible video.
 *
 * Scene graph:
 *   anchor              position + orientation from the hand pose
 *   ├─ sizer            uniform scale = ring outer diameter (world units)
 *   │  └─ normalizer    scale 1/maxDim -> unit-diameter ring
 *   │     └─ orient     bore centred on +Y, stone/head (if any) turned to +Z
 *   │        └─ align   hole axis -> +Y
 *   │           └─ gltf.scene
 *   └─ occluder         depth-only cylinder = the finger, radius just under
 *                       the bore, so the back of the band disappears right
 *                       where the band meets the finger's outline
 *   (scene root) hand occluders: instanced depth-only capsules for the other
 *                fingers/thumb, so fingers in front of the ring hide it
 *
 * Sizing: the model's bore is measured at load and the ring is scaled so
 * the bore is RING_BORE_TO_FINGER_WIDTH × the finger's on-screen width.
 *
 * Realism: perspective camera matched to a webcam's field of view,
 * exposure / light colour / reflections driven by lighting-estimator.js,
 * film grain + slight softness. (The contact shadow was removed: it read
 * as a dark halo around the band rather than as a shadow on the skin.)
 */

let THREE = null;
let GLTFLoader = null;
let RoomEnvironment = null;

async function loadThree() {
  if (THREE) return THREE;
  THREE = await import('three');
  ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
  ({ RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js'));
  return THREE;
}

/**
 * Ring bore (inner) diameter relative to the finger's on-screen width.
 * 1.0 = the band sits exactly on the finger's outline. (Was 1.04 while
 * the width estimate was unreliable; the size lock now provides a stable,
 * measured width.)
 */
export const RING_BORE_TO_FINGER_WIDTH = 1.0;

/** Bore/outer diameter ratio used when a model's bore can't be measured. */
const DEFAULT_INNER_RATIO = 0.87;

/**
 * Finger occluder radius relative to the bore radius. Just under 1 so the
 * occluder never cuts into the band's inner surface, yet the band's back
 * half is hidden right up to the finger's outline (no visible gap).
 */
const OCCLUDER_TO_BORE = 0.98;

/**
 * Other fingers are pushed back by this much (× finger width) before
 * occluding, so noisy depth estimates don't let a finger lying beside the
 * ring finger nibble the band; only fingers clearly in front hide it.
 */
const HAND_OCCLUDER_DEPTH_BIAS = 0.15;

/** Max number of capsule segments for other fingers (see ring-tryon-pipeline.js). */
const MAX_HAND_OCCLUDER_SEGMENTS = 20;

/**
 * Approximate horizontal field of view of the raw camera stream. Laptop
 * webcams are typically ~60-70°, phone front cameras ~65-75°. Only used to
 * add a realistic amount of perspective; exact calibration isn't possible
 * from the browser.
 */
export const WEBCAM_HORIZONTAL_FOV_DEG = 65;

/**
 * Perspective camera placement such that the z = 0 plane covers exactly
 * the visible video area (so landmark mapping stays identical to the
 * orthographic version), with a field of view matching what the user
 * actually sees after the object-cover crop.
 *
 * @param {number} containerAspect - displayed width / height
 * @param {number} videoAspect - raw stream width / height
 * @param {number} cropHeight - visible fraction of the raw frame height (view-mapping.js)
 * @param {number} [rawHorizontalFovDeg]
 * @returns {{fovDeg:number, distance:number}}
 */
export function computeCameraFrame(containerAspect, videoAspect, cropHeight, rawHorizontalFovDeg = WEBCAM_HORIZONTAL_FOV_DEG) {
  const halfH = (rawHorizontalFovDeg * Math.PI) / 360;
  const rawHalfV = Math.atan(Math.tan(halfH) / (videoAspect || 1));
  const visibleHalfV = Math.atan(Math.tan(rawHalfV) * (cropHeight || 1));
  // Visible height at z = 0 must be 1.0 world unit: 2 * d * tan(halfV) = 1.
  const distance = 0.5 / Math.tan(visibleHalfV);
  return { fovDeg: (visibleHalfV * 360) / Math.PI, distance };
}

/**
 * Adds per-pixel film grain to a built-in material's final output colour.
 * `uniforms` is shared across materials so one update affects all of them.
 *
 * @param {import('three').Material} material
 * @param {{uGrain:{value:number}, uGrainTime:{value:number}}} uniforms
 */
export function injectGrain(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrain = uniforms.uGrain;
    shader.uniforms.uGrainTime = uniforms.uGrainTime;
    shader.fragmentShader =
      'uniform float uGrain;\nuniform float uGrainTime;\n' +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        [
          '#include <dithering_fragment>',
          'float grainNoise = fract(sin(dot(gl_FragCoord.xy + uGrainTime * 61.7, vec2(12.9898, 78.233))) * 43758.5453);',
          'gl_FragColor.rgb += (grainNoise - 0.5) * uGrain;',
        ].join('\n')
      );
  };
  material.customProgramCacheKey = () => 'ring-grain';
  material.needsUpdate = true;
}

export class RingScene {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.anchor = null;
    this.sizer = null;
    this.normalizer = null;
    this.occluder = null;
    this.keyLight = null;
    this.fillLight = null;
    this.ringModel = null;
    this.bandWidth = 0.25; // band width as a fraction of outer diameter; set from the model
    this.innerRatio = DEFAULT_INNER_RATIO; // bore / outer diameter; set from the model
    this._envTexture = null;
    this._basis = null;
    this._axes = null;
    this._grainUniforms = { uGrain: { value: 0.015 }, uGrainTime: { value: 0 } };
    this._baseExposure = 1.0;
  }

  async init() {
    await loadThree();

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      // Lets the 10 s debug recorder read the composited ring layer.
      preserveDrawingBuffer: true,
    });
    // Capped at 1.5: higher densities render the ring noticeably sharper
    // than the (usually soft, upscaled) webcam image and cost fill-rate.
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

    // Key light from above-front (typical ceiling/window light) + soft fill.
    // Colours/intensities are overwritten by setLighting() from the camera image.
    this.keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.keyLight.position.set(0.3, 1, 0.8);
    this.scene.add(this.keyLight);
    this.fillLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
    this.scene.add(this.fillLight);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
    this.camera.position.set(0, 0, 1.4);
    this.camera.lookAt(0, 0, 0);

    this.anchor = new THREE.Group();
    this.anchor.visible = false;
    this.scene.add(this.anchor);

    this.sizer = new THREE.Group();
    this.anchor.add(this.sizer);
    this.normalizer = new THREE.Group();
    this.sizer.add(this.normalizer);

    this.occluder = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 48, 1, true), // unit radius/height along Y
      new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })
    );
    this.occluder.renderOrder = -1;
    this.anchor.add(this.occluder);

    // Other fingers + thumb as depth-only capsules (cylinder per bone +
    // sphere per joint), so a finger passing in front hides the ring.
    const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
    this._handCylinders = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 16, 1, true), depthOnly, MAX_HAND_OCCLUDER_SEGMENTS
    );
    this._handSpheres = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 16, 12), depthOnly, MAX_HAND_OCCLUDER_SEGMENTS * 2
    );
    for (const m of [this._handCylinders, this._handSpheres]) {
      m.renderOrder = -1;
      m.count = 0;
      m.frustumCulled = false;
      this.scene.add(m);
    }
    this._tmp = {
      m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(),
      a: new THREE.Vector3(), b: new THREE.Vector3(), mid: new THREE.Vector3(),
      dir: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0),
    };

    this._basis = new THREE.Matrix4();
    this._axes = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() };
  }

  async loadRingModel(url) {
    if (!GLTFLoader) throw new Error('RingScene.init() must be called before loadRingModel().');

    if (this.ringModel) {
      this.normalizer.clear();
      disposeObject3D(this.ringModel);
      this.ringModel = null;
    }

    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;

    const { orient, unitScale, bandWidth, innerRatio } = normalizeRingModel(THREE, model);
    this.normalizer.scale.setScalar(unitScale);
    this.normalizer.add(orient);
    this.bandWidth = bandWidth;
    this.innerRatio = innerRatio;

    model.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          // glTF alphaMode BLEND turns depth writes off, so the band's back
          // could draw over its front. Keep the transparency (stones) but
          // write depth, so the ring occludes itself correctly.
          if (m.transparent) m.depthWrite = true;
          injectGrain(m, this._grainUniforms);
        }
      }
    });

    this.ringModel = model;
  }

  /**
   * @param {{containerAspect:number, cropHeight:number}} crop - from view-mapping.js computeCoverCrop()
   * @param {number} videoAspect - raw stream width / height
   */
  resize(crop, videoAspect) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.renderer.getPixelRatio();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.renderer.setSize(w, h, false);
    }

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

  /**
   * Applies lighting params from lighting-estimator.js. Safe to call with
   * null (keeps current values).
   */
  setLighting(params) {
    if (!params || !this.renderer) return;
    const { exposure, envIntensity, tint, grain } = params;
    this.renderer.toneMappingExposure = this._baseExposure * exposure;
    this.scene.environmentIntensity = envIntensity;
    this.keyLight.color.setRGB(tint.r, tint.g, tint.b);
    this.fillLight.color.setRGB(tint.r, tint.g, tint.b);
    this._grainUniforms.uGrain.value = grain;
  }

  /**
   * @param {import('./ring-anchor.js').RingPose} pose - world-space pose
   * @param {Array<{a:{x,y,z}, b:{x,y,z}, radius:number}>} [handSegments] - other
   *   fingers as capsules in world space; z is depth relative to the ring
   *   (+ = closer to the camera)
   */
  render(pose, handSegments = []) {
    this._grainUniforms.uGrainTime.value = (performance.now() / 1000) % 1000;

    if (!pose || !pose.valid || !this.ringModel) {
      this.anchor.visible = false;
      this._handCylinders.count = 0;
      this._handSpheres.count = 0;
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.anchor.visible = true;
    // z is pinned to the reference plane: MediaPipe's per-point depth is
    // only relative and noisy, and under a perspective camera any z offset
    // would shift the ring's on-screen position away from the finger.
    // Depth still shapes the orientation (the axes below).
    this.anchor.position.set(pose.position.x, pose.position.y, 0);

    const { x, y, z } = this._axes;
    x.set(pose.xAxis.x, pose.xAxis.y, pose.xAxis.z);
    y.set(pose.yAxis.x, pose.yAxis.y, pose.yAxis.z);
    z.set(pose.zAxis.x, pose.zAxis.y, pose.zAxis.z);
    this._basis.makeBasis(x, y, z);
    this.anchor.quaternion.setFromRotationMatrix(this._basis);

    const fw = pose.fingerWidth;
    const diameter = computeRingOuterDiameter(fw, this.innerRatio);
    this.sizer.scale.setScalar(diameter);

    const occR = computeOccluderRadius(fw, this.innerRatio);
    const occLen = Math.max(pose.fingerLength * 1.6, fw * 2);
    this.occluder.scale.set(occR, occLen, occR);

    this._updateHandOccluders(handSegments, fw);

    this.renderer.render(this.scene, this.camera);
  }

  _updateHandOccluders(segments, fingerWidth) {
    const t = this._tmp;
    const d = this.camera.position.z;
    const bias = fingerWidth * HAND_OCCLUDER_DEPTH_BIAS;
    // A point drawn at screen-plane (x, y) but at depth z must be scaled by
    // (d - z) / d so the perspective camera still projects it onto (x, y).
    const place = (out, p) => {
      const zr = (p.z || 0) - bias;
      const k = (d - zr) / d;
      return out.set(p.x * k, p.y * k, zr);
    };

    let ci = 0;
    let si = 0;
    for (const seg of segments.slice(0, MAX_HAND_OCCLUDER_SEGMENTS)) {
      if (!(seg.radius > 0)) continue;
      place(t.a, seg.a);
      place(t.b, seg.b);
      t.dir.subVectors(t.b, t.a);
      const len = t.dir.length();
      if (len > 1e-6) {
        t.mid.addVectors(t.a, t.b).multiplyScalar(0.5);
        t.q.setFromUnitVectors(t.up, t.dir.multiplyScalar(1 / len));
        t.s.set(seg.radius, len, seg.radius);
        t.m.compose(t.mid, t.q, t.s);
        this._handCylinders.setMatrixAt(ci++, t.m);
      }
      t.q.identity();
      t.s.setScalar(seg.radius);
      for (const p of [t.a, t.b]) {
        t.m.compose(p, t.q, t.s);
        this._handSpheres.setMatrixAt(si++, t.m);
      }
    }
    this._handCylinders.count = ci;
    this._handSpheres.count = si;
    this._handCylinders.instanceMatrix.needsUpdate = true;
    this._handSpheres.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    if (this.ringModel) disposeObject3D(this.ringModel);
    if (this.occluder) {
      this.occluder.geometry.dispose();
      this.occluder.material.dispose();
    }
    if (this._handCylinders) {
      this._handCylinders.geometry.dispose();
      this._handSpheres.geometry.dispose();
      this._handCylinders.material.dispose(); // shared with spheres
      this._handCylinders.dispose();
      this._handSpheres.dispose();
    }
    if (this._envTexture) this._envTexture.dispose();
    if (this.renderer) this.renderer.dispose();
  }
}

const clampInnerRatio = (innerRatio) => Math.min(Math.max(innerRatio || DEFAULT_INNER_RATIO, 0.5), 0.98);

/**
 * Outer diameter that makes the model's bore RING_BORE_TO_FINGER_WIDTH × the
 * finger width, i.e. a snug fit regardless of how thick the band is.
 */
export function computeRingOuterDiameter(fingerWidth, innerRatio) {
  return (fingerWidth * RING_BORE_TO_FINGER_WIDTH) / clampInnerRatio(innerRatio);
}

/** Finger occluder radius: just inside the ring's bore (see OCCLUDER_TO_BORE). */
export function computeOccluderRadius(fingerWidth, innerRatio) {
  const boreRadius = (computeRingOuterDiameter(fingerWidth, innerRatio) * clampInnerRatio(innerRatio)) / 2;
  return boreRadius * OCCLUDER_TO_BORE;
}

/**
 * Wraps a loaded model so that, inside the returned `orient` group scaled
 * by `unitScale`, the ring is centred at the origin, its hole axis (the
 * thinnest bounding-box dimension of a band) points along +Y, and its
 * outer diameter is 1 unit. The centring offset lives inside the scaled
 * group so it scales with the geometry (the earlier bug scaled the model
 * but not its offset, pushing the ring far from the hand).
 *
 * @param {typeof import('three')} THREE_
 * @param {import('three').Object3D} model
 * @returns {{orient: import('three').Group, unitScale: number, bandWidth: number, innerRatio: number}}
 *   bandWidth: band width along the hole axis / outer diameter
 *   innerRatio: bore diameter / outer diameter (closest vertex to the hole axis)
 */
export function normalizeRingModel(THREE_, model) {
  // align: hole axis -> +Y. orient: centre the bore on the axis and turn the
  // head (stone/setting), if any, to +Z = the top of the finger.
  const align = new THREE_.Group();
  align.add(model);
  align.updateMatrixWorld(true);
  const size0 = new THREE_.Box3().setFromObject(align).getSize(new THREE_.Vector3());
  if (size0.x <= size0.y && size0.x <= size0.z) {
    align.rotation.set(0, 0, Math.PI / 2); // hole axis X -> Y
  } else if (size0.z <= size0.x && size0.z <= size0.y) {
    align.rotation.set(Math.PI / 2, 0, 0); // hole axis Z -> Y
  }
  const orient = new THREE_.Group();
  orient.add(align);
  orient.updateMatrixWorld(true);

  const box = new THREE_.Box3().setFromObject(orient);
  const finalSize = box.getSize(new THREE_.Vector3());
  const maxDim = Math.max(finalSize.x, finalSize.y, finalSize.z) || 1;

  const pts = [];
  const v = new THREE_.Vector3();
  orient.traverse((obj) => {
    const pos = obj.isMesh && obj.geometry && obj.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
      pts.push({ x: v.x, z: v.z });
    }
  });
  const cs = analyzeRingCrossSection(pts, {
    x: (box.min.x + box.max.x) / 2,
    z: (box.min.z + box.max.z) / 2,
  });

  // orient = T * Ry: rotate the head to +Z about the bore centre, then put
  // the bore centre on the Y axis and the band's mid-height at y = 0.
  const yaw = cs.headAngle === null ? 0 : -cs.headAngle;
  orient.rotation.set(0, yaw, 0);
  const c = new THREE_.Vector3(cs.cx, 0, cs.cz).applyAxisAngle(new THREE_.Vector3(0, 1, 0), yaw);
  orient.position.set(-c.x, -(box.min.y + box.max.y) / 2, -c.z);
  orient.updateMatrixWorld(true);

  const innerRatio = cs.boreRadius > 0 ? Math.min((2 * cs.boreRadius) / maxDim, 0.98) : DEFAULT_INNER_RATIO;
  return {
    orient,
    unitScale: 1 / maxDim,
    bandWidth: finalSize.y / maxDim,
    innerRatio,
    hasHead: cs.headAngle !== null,
  };
}

/** A ring has a head (stone/setting) if its furthest point from the bore
 *  centre is this much further out than the band's typical outer radius. */
const HEAD_RATIO = 1.12;

/**
 * Finds the bore in a ring's cross-section (vertices projected onto the
 * plane perpendicular to the hole axis, as {x, z}).
 *
 * Bore centre = centre of the largest circle containing no vertex. The
 * bounding-box centre is NOT used: a solitaire's stone shifts the box
 * centre off the hole, which would place the ring off-centre on the finger
 * and under-measure the bore (the ring would then be drawn too big).
 *
 * @returns {{cx:number, cz:number, boreRadius:number, headAngle:number|null}}
 *   headAngle: atan2(x, z) of the head direction (0 = +Z), or null for a
 *   plain band.
 */
export function analyzeRingCrossSection(pts, start) {
  if (!pts.length) return { cx: start.x, cz: start.z, boreRadius: 0, headAngle: null };
  const minR = (cx, cz) => {
    let m = Infinity;
    for (const p of pts) {
      const d = (p.x - cx) * (p.x - cx) + (p.z - cz) * (p.z - cz);
      if (d < m) m = d;
    }
    return Math.sqrt(m);
  };
  let span = 0;
  for (const p of pts) span = Math.max(span, Math.hypot(p.x - start.x, p.z - start.z));
  let cx = start.x;
  let cz = start.z;
  let best = minR(cx, cz);
  // Pattern search (the empty-circle radius is unimodal near the hole).
  for (let step = span * 0.1; step > span * 1e-4; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const r = minR(cx + dx * step, cz + dz * step);
        if (r > best) {
          best = r;
          cx += dx * step;
          cz += dz * step;
          improved = true;
        }
      }
    }
  }
  const radial = pts.map((p) => Math.hypot(p.x - cx, p.z - cz)).sort((a, b) => a - b);
  const median = radial[Math.floor(radial.length / 2)];
  let far = null;
  let farR = -1;
  for (const p of pts) {
    const r = Math.hypot(p.x - cx, p.z - cz);
    if (r > farR) {
      farR = r;
      far = p;
    }
  }
  const headAngle = farR > median * HEAD_RATIO ? Math.atan2(far.x - cx, far.z - cz) : null;
  return { cx, cz, boreRadius: best, headAngle };
}

function disposeObject3D(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        for (const key of Object.keys(mat)) {
          const v = mat[key];
          if (v && v.isTexture) v.dispose();
        }
        mat.dispose();
      }
    }
  });
}
