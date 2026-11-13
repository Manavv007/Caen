#!/usr/bin/env node
/**
 * Compresses the source jewellery models (assets-src/models/<name>/scene.gltf)
 * into small, content-hashed .glb files for the web app:
 *
 *   apps/web/public/models/<name>.<hash>.glb
 *   apps/web/src/data/models.json            { "<name>": "/models/<name>.<hash>.glb", ... }
 *
 * Steps per model (geometry layout is kept: no join/flatten/instancing, so
 * the try-on code that measures bores/outlines sees the same meshes):
 *   1. spec-gloss -> metal-rough material conversion (same function the
 *      runtime used on .gltf files, see earring-model.js)
 *   2. dedup + prune unused data, weld duplicate vertices
 *   3. textures resized to <= 1024 px and re-encoded as WebP
 *   4. vertex quantization + EXT_meshopt_compression (meshopt() does both)
 *
 * Fails if any model is over its size budget. Run with `npm run models`
 * after adding or changing a source model; the outputs are committed.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

import { convertSpecGlossJson } from '../packages/tryon/src/earring-model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src/models');
const OUT = path.join(ROOT, 'apps/web/public/models');
const MANIFEST = path.join(ROOT, 'apps/web/src/data/models.json');

/** Size budget per shipped model, in bytes. Models not listed are not shipped. */
const MODELS = {
  the_ring_1_carat: 300_000,
  // Faceted crystals are flat-shaded triangle soup (~109k unique vertices):
  // simplification can't merge them without smoothing the facets.
  golden_ball_crystal_diamond_drop_earrings: 650_000,
  gold_necklace__chain: 600_000,
  pointy_nose_ring: 300_000,
  // one_ring: CC-BY-NC licence, dev-only — never shipped.
};

const TEXTURE_MAX = 1024;

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

async function readSource(dir) {
  const gltfPath = path.join(dir, 'scene.gltf');
  const json = convertSpecGlossJson(JSON.parse(await readFile(gltfPath, 'utf8')));
  const resources = {};
  for (const item of [...(json.buffers || []), ...(json.images || [])]) {
    if (item.uri && !item.uri.startsWith('data:')) {
      resources[item.uri] = new Uint8Array(await readFile(path.join(dir, decodeURIComponent(item.uri))));
    }
  }
  return io.readJSON({ json, resources });
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

async function dirSize(dir) {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile() && e.name !== 'license.txt') total += (await readFile(path.join(e.parentPath, e.name))).length;
  }
  return total;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await mkdir(path.dirname(MANIFEST), { recursive: true });

const manifest = {};
const failures = [];
for (const [name, budget] of Object.entries(MODELS)) {
  const dir = path.join(SRC, name);
  const doc = await readSource(dir);
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE_MAX, TEXTURE_MAX], quality: 90 }),
    // 'high' = quantization + lossy attribute filters (8-bit octahedral
    // normals). Verified visually against the source models.
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const glb = await io.writeBinary(doc);
  const hash = createHash('sha256').update(glb).digest('hex').slice(0, 10);
  const file = `${name}.${hash}.glb`;
  await writeFile(path.join(OUT, file), glb);
  manifest[name] = `/models/${file}`;

  const before = await dirSize(dir);
  const ok = glb.length <= budget;
  console.log(`${ok ? 'ok  ' : 'OVER'} ${name}: ${kb(before)} -> ${kb(glb.length)} (budget ${kb(budget)})`);
  if (!ok) failures.push(name);
}

await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${path.relative(ROOT, MANIFEST)}`);
if (failures.length) {
  console.error(`Over budget: ${failures.join(', ')}`);
  process.exit(1);
}
