/**
 * earring-model.js
 *
 * Loads an earring glTF and turns it into a predictable object for the
 * face try-on:
 *   - origin = the attachment point (top of the hook, where it goes
 *     through the earlobe)
 *   - hangs along -Y, total height = 1 unit (Phase 3 scales it to the
 *     product's real length relative to the face)
 *   - mirrored copy for the other ear
 *
 * Model fixes applied at load time (the source file is left untouched):
 *   - KHR_materials_pbrSpecularGlossiness (common in Sketchfab exports) was
 *     dropped by three.js; when it is marked "required" GLTFLoader refuses
 *     the file. It is converted to metallic-roughness first.
 *   - Lights and cameras inside the file are removed: the try-on scene
 *     provides its own lighting from the camera image.
 */

const SPEC_GLOSS = 'KHR_materials_pbrSpecularGlossiness';

/** Mirror-perfect metal shows environment-map seams; keep a little roughness. */
const MIN_ROUGHNESS = 0.08;

/**
 * Converts specular-glossiness materials to metallic-roughness in a glTF
 * JSON object (returns a modified deep copy).
 *
 * Approximation: a material with a (near-)black diffuse colour and a
 * coloured specular is a metal whose colour is the specular colour
 * (the standard look of gold/silver in spec-gloss). Otherwise it's a
 * dielectric with the diffuse colour. Roughness = 1 - glossiness.
 * Textures in the extension are carried over where they map directly.
 */
export function convertSpecGlossJson(json) {
  const out = JSON.parse(JSON.stringify(json));
  for (const m of out.materials || []) {
    const sg = m.extensions && m.extensions[SPEC_GLOSS];
    if (!sg) continue;
    const diffuse = sg.diffuseFactor || [1, 1, 1, 1];
    const spec = sg.specularFactor || [1, 1, 1];
    const gloss = sg.glossinessFactor === undefined ? 1 : sg.glossinessFactor;
    const diffuseLum = 0.2126 * diffuse[0] + 0.7152 * diffuse[1] + 0.0722 * diffuse[2];
    const specMax = Math.max(...spec);
    const isMetal = !sg.diffuseTexture && diffuseLum < 0.04 && specMax > 0.25;
    const pbr = {
      baseColorFactor: isMetal ? [spec[0], spec[1], spec[2], diffuse[3]] : diffuse.slice(0, 4),
      metallicFactor: isMetal ? 1 : 0,
      roughnessFactor: Math.max(1 - gloss, MIN_ROUGHNESS),
    };
    if (sg.diffuseTexture) pbr.baseColorTexture = sg.diffuseTexture;
    m.pbrMetallicRoughness = pbr;
    delete m.extensions[SPEC_GLOSS];
    if (!Object.keys(m.extensions).length) delete m.extensions;
  }
  const drop = (list) => (list || []).filter((e) => e !== SPEC_GLOSS);
  if (out.extensionsUsed) out.extensionsUsed = drop(out.extensionsUsed);
  if (out.extensionsRequired) {
    out.extensionsRequired = drop(out.extensionsRequired);
    if (!out.extensionsRequired.length) delete out.extensionsRequired;
  }
  return out;
}

/**
 * Geometry summary of an earring, from its vertices in model space
 * (glTF convention: +Y up, so the earring hangs toward -Y).
 * @param {{x:number,y:number,z:number}[]} pts
 * @returns {{top:{x,y,z}, height:number, width:number, depth:number}}
 *   top: the attachment point = highest vertex (top of the hook).
 */
export function analyzeEarring(pts) {
  let top = pts[0];
  const mn = { x: Infinity, y: Infinity, z: Infinity };
  const mx = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of pts) {
    if (p.y > top.y) top = p;
    for (const k of ['x', 'y', 'z']) {
      if (p[k] < mn[k]) mn[k] = p[k];
      if (p[k] > mx[k]) mx[k] = p[k];
    }
  }
  return {
    top: { x: top.x, y: top.y, z: top.z },
    height: mx.y - mn.y,
    width: mx.x - mn.x,
    depth: mx.z - mn.z,
  };
}

/**
 * Loads and normalizes an earring model.
 * @param {typeof import('three')} THREE
 * @param {Function} GLTFLoader - three/addons GLTFLoader class
 * @param {string} url - .gltf (JSON) or .glb
 * @returns {Promise<{object: import('three').Group, width:number, depth:number}>}
 *   object: attachment point at the origin, hanging along -Y, height 1.
 *   width/depth: relative to the height.
 */
export async function loadEarringModel(THREE, GLTFLoader, url) {
  const loader = new GLTFLoader();
  let gltf;
  if (/\.gltf(\?|$)/i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Earring model ${url}: HTTP ${res.status}`);
    const json = convertSpecGlossJson(await res.json());
    const base = new URL('.', new URL(url, window.location.href)).href;
    gltf = await loader.parseAsync(JSON.stringify(json), base);
  } else {
    gltf = await loader.loadAsync(url);
  }
  const model = gltf.scene;

  const strip = [];
  model.traverse((o) => {
    if (o.isLight || o.isCamera) strip.push(o);
  });
  strip.forEach((o) => o.removeFromParent());

  model.updateMatrixWorld(true);
  const pts = [];
  const v = new THREE.Vector3();
  model.traverse((o) => {
    const pos = o.isMesh && o.geometry && o.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      pts.push({ x: v.x, y: v.y, z: v.z });
    }
  });
  if (!pts.length) throw new Error(`Earring model ${url}: no geometry`);
  const info = analyzeEarring(pts);

  const offset = new THREE.Group(); // attachment point -> origin
  offset.position.set(-info.top.x, -info.top.y, -info.top.z);
  offset.add(model);
  const object = new THREE.Group(); // height -> 1
  object.scale.setScalar(1 / info.height);
  object.add(offset);
  object.name = 'earring';

  return { object, width: info.width / info.height, depth: info.depth / info.height };
}

/**
 * Copy for the other ear: mirrored left-right (three.js flips the face
 * winding automatically for a negative scale, so lighting stays correct).
 * Geometry and materials are shared, not duplicated.
 */
export function cloneMirroredEarring(object) {
  const pivot = new (object.constructor)();
  const copy = object.clone(true);
  pivot.add(copy);
  pivot.scale.set(-1, 1, 1);
  pivot.name = 'earring-mirrored';
  return pivot;
}
