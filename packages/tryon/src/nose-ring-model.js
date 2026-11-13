/**
 * nose-ring-model.js
 *
 * Loads a nose ring glTF and turns it into a predictable object for the
 * face try-on:
 *   - origin = the centre of the ring's circle
 *   - the ring lies in the model's XY plane (thickness along Z)
 *   - outer diameter = 1 unit (nose-ring-solver.js scales it to the product's
 *     real diameter relative to the face)
 *   - the gap of the horseshoe is on -Y in the source file (see
 *     analyzeNoseRing); the solver decides which way it points on the face
 *
 * Model fixes applied at load time (the source file is left untouched):
 *   - a perfectly smooth mirror (roughness 0) reflects the environment map
 *     with visible seams; a little roughness is added.
 *   - lights and cameras inside the file are removed: the try-on scene
 *     provides its own lighting from the camera image.
 */

/** Mirror-perfect metal shows environment-map seams; keep a little roughness. */
const MIN_ROUGHNESS = 0.12;

/**
 * Geometry summary of a ring from its vertices in model space (glTF
 * convention: +Y up).
 *
 * The ring may be a closed hoop or a horseshoe with a gap: the circle's
 * centre is taken from the bounding box, with the circle's top touching the
 * top of the box (the gap, if any, is at the bottom, where ball/cone ends
 * stick out beyond the circle but never above it).
 *
 * @param {{x:number,y:number,z:number}[]} pts
 * @returns {{center:{x,y,z}, diameter:number, depth:number, minY:number}}
 *   diameter: outer diameter (x extent); depth: extent along Z; minY: lowest
 *   point relative to the centre, in units of the diameter (the gap ends).
 */
export function analyzeNoseRing(pts) {
  const mn = { x: Infinity, y: Infinity, z: Infinity };
  const mx = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of pts) {
    for (const k of ['x', 'y', 'z']) {
      if (p[k] < mn[k]) mn[k] = p[k];
      if (p[k] > mx[k]) mx[k] = p[k];
    }
  }
  const diameter = mx.x - mn.x;
  const center = { x: (mn.x + mx.x) / 2, y: mx.y - diameter / 2, z: (mn.z + mx.z) / 2 };
  return { center, diameter, depth: mx.z - mn.z, minY: (mn.y - center.y) / diameter };
}

/**
 * Loads and normalizes a nose ring model.
 * @param {typeof import('three')} THREE
 * @param {Function} GLTFLoader - three/addons GLTFLoader class
 * @param {string} url - .gltf (JSON) or .glb
 * @returns {Promise<{object: import('three').Group, depth:number, minY:number}>}
 *   object: ring centre at the origin, outer diameter 1. depth is relative to
 *   the diameter, minY is the lowest point relative to the centre (also in
 *   diameters).
 */
export async function loadNoseRingModel(THREE, GLTFLoader, url) {
  const gltf = await new GLTFLoader().loadAsync(url);
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
    // A little roughness on every material (see MIN_ROUGHNESS).
    for (const m of [].concat(o.material)) {
      if (m && m.roughness !== undefined && m.roughness < MIN_ROUGHNESS) m.roughness = MIN_ROUGHNESS;
    }
  });
  if (!pts.length) throw new Error(`Nose ring model ${url}: no geometry`);
  const info = analyzeNoseRing(pts);

  const offset = new THREE.Group(); // ring centre -> origin
  offset.position.set(-info.center.x, -info.center.y, -info.center.z);
  offset.add(model);
  const object = new THREE.Group(); // diameter -> 1
  object.scale.setScalar(1 / info.diameter);
  object.add(offset);
  object.name = 'nose-ring';

  return { object, depth: info.depth / info.diameter, minY: info.minY };
}
