/**
 * necklace-model.js
 *
 * Loads a necklace/chain model and normalizes it for the try-on:
 *
 *   - Orientation: glTF convention, +Y up, +Z = the wearer's front.
 *     Necklace models are usually modelled already draped (lying on a
 *     body), so the lowest point is the front drop. If that lowest point
 *     is behind the ring centre, the model is turned 180° about Y.
 *   - Origin: the centre of the neck ring, at the height of its top edge
 *     (where the chain passes over the back of the neck).
 *   - Size: neck ring width (x extent) = 1. The solver scales this to
 *     the wearer's neck, so the file's own units don't matter.
 *
 * Pure analysis (analyzeNecklace) has no three.js dependency so it can be
 * tested in Node.
 */

/** Fraction of the height, from the top, counted as the "ring top". */
const RING_TOP_FRACTION = 0.1;

/**
 * @param {{x:number,y:number,z:number}[]} pts - vertices, +Y up
 * @returns {{
 *   ringCenter:{x,y,z}, width:number, height:number, depth:number,
 *   tip:{x,y,z}, flipped:boolean, ringFrontZ:number, ringBackZ:number
 * }} all in the input units. `flipped`: the front drop is at -Z, so the
 *   model must turn 180° about Y. ringFrontZ/BackZ: z extent of the top
 *   part of the ring (front / back of the neck), before flipping.
 */
export function analyzeNecklace(pts) {
  const mn = { x: Infinity, y: Infinity, z: Infinity };
  const mx = { x: -Infinity, y: -Infinity, z: -Infinity };
  let tip = pts[0];
  for (const p of pts) {
    if (p.y < tip.y) tip = p;
    for (const k of ['x', 'y', 'z']) {
      if (p[k] < mn[k]) mn[k] = p[k];
      if (p[k] > mx[k]) mx[k] = p[k];
    }
  }
  const height = mx.y - mn.y;
  const yTop = mx.y - RING_TOP_FRACTION * height;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const p of pts) {
    if (p.y < yTop) continue;
    if (p.z < zMin) zMin = p.z;
    if (p.z > zMax) zMax = p.z;
  }
  const ringCenter = { x: (mn.x + mx.x) / 2, y: mx.y, z: (zMin + zMax) / 2 };
  return {
    ringCenter,
    width: mx.x - mn.x,
    height,
    depth: mx.z - mn.z,
    tip: { x: tip.x, y: tip.y, z: tip.z },
    flipped: tip.z < ringCenter.z,
    ringFrontZ: zMax,
    ringBackZ: zMin,
  };
}

/**
 * Loads and normalizes a necklace model.
 * @param {typeof import('three')} THREE
 * @param {Function} GLTFLoader - three/addons GLTFLoader class
 * @param {string} url - .gltf or .glb
 * @returns {Promise<{object: import('three').Group, info: Object}>}
 *   object: origin at the ring centre (top edge), +Z front, ring width 1.
 *   info (ring-width units, after normalization):
 *     height  - top of ring to lowest point
 *     depth   - front-to-back extent
 *     tip     - lowest point (front drop), {x, y, z}
 *     ringFrontZ / ringBackZ - where the ring top passes the front / back of the neck
 */
export async function loadNecklaceModel(THREE, GLTFLoader, url) {
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
  });
  if (!pts.length) throw new Error(`Necklace model ${url}: no geometry`);
  const a = analyzeNecklace(pts);

  const offset = new THREE.Group(); // ring centre -> origin
  offset.position.set(-a.ringCenter.x, -a.ringCenter.y, -a.ringCenter.z);
  offset.add(model);
  const turn = new THREE.Group(); // front drop -> +Z
  if (a.flipped) turn.rotation.y = Math.PI;
  turn.add(offset);
  const object = new THREE.Group(); // ring width -> 1
  object.scale.setScalar(1 / a.width);
  object.add(turn);
  object.name = 'necklace';

  const s = 1 / a.width;
  const zSign = a.flipped ? -1 : 1;
  const zRel = (z) => (z - a.ringCenter.z) * zSign * s;
  const info = {
    height: a.height * s,
    depth: a.depth * s,
    tip: { x: (a.tip.x - a.ringCenter.x) * zSign * s, y: (a.tip.y - a.ringCenter.y) * s, z: zRel(a.tip.z) },
    ringFrontZ: a.flipped ? zRel(a.ringBackZ) : zRel(a.ringFrontZ),
    ringBackZ: a.flipped ? zRel(a.ringFrontZ) : zRel(a.ringBackZ),
  };
  return { object, info };
}
