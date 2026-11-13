#!/usr/bin/env node
/**
 * Self-hosts everything MediaPipe needs at runtime, so try-on never depends
 * on jsDelivr / Google Cloud Storage and can be cached as immutable:
 *
 *   apps/web/public/mediapipe/<tasks-vision version>/wasm/*   (copied from node_modules)
 *   apps/web/public/mediapipe/models/<name>-v<n>.<ext>        (downloaded once, sha256-checked)
 *
 * Runs automatically before `dev` and `build` (predev/prebuild). Files that
 * already exist with the right hash are skipped, so it is cheap to re-run.
 * The output folder is gitignored.
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'apps/web/public/mediapipe');
const require = createRequire(path.join(ROOT, 'packages/tryon/package.json'));

// Keep in sync with packages/tryon/src/asset-urls.js.
// Pinned "/1/" paths (identical bytes to ".../latest/" as of 2026-11).
const GCS = 'https://storage.googleapis.com/mediapipe-models';
export const MODELS = [
  {
    file: 'hand_landmarker-v1.task',
    url: `${GCS}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
    sha256: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1',
  },
  {
    file: 'face_landmarker-v1.task',
    url: `${GCS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  },
  {
    file: 'pose_landmarker_lite-v1.task',
    url: `${GCS}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
    sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  },
  {
    file: 'selfie_multiclass_256x256-v1.tflite',
    url: `${GCS}/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite`,
    sha256: 'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0',
  },
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyWasm() {
  // The package's exports map hides package.json; resolve a file it does export.
  const pkgDir = path.dirname(require.resolve('@mediapipe/tasks-vision/vision_bundle.js'));
  const pkgJson = path.join(pkgDir, 'package.json');
  const { version } = JSON.parse(await readFile(pkgJson, 'utf8'));
  const dest = path.join(OUT, version, 'wasm');
  await mkdir(dest, { recursive: true });
  for (const f of await readdir(path.join(pkgDir, 'wasm'))) {
    const src = path.join(pkgDir, 'wasm', f);
    const dst = path.join(dest, f);
    if (await exists(dst) && (await stat(dst)).size === (await stat(src)).size) continue;
    await copyFile(src, dst);
  }
  console.log(`[mediapipe] wasm ${version} -> ${path.relative(ROOT, dest)}`);
}

async function fetchModels() {
  const dest = path.join(OUT, 'models');
  await mkdir(dest, { recursive: true });
  for (const m of MODELS) {
    const dst = path.join(dest, m.file);
    if (await exists(dst) && sha256(await readFile(dst)) === m.sha256) continue;
    process.stdout.write(`[mediapipe] downloading ${m.file} … `);
    const res = await fetch(m.url);
    if (!res.ok) throw new Error(`${m.url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = sha256(buf);
    if (got !== m.sha256) throw new Error(`${m.file}: sha256 mismatch (got ${got})`);
    await writeFile(dst, buf);
    console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
  }
  console.log(`[mediapipe] models ok -> ${path.relative(ROOT, dest)}`);
}

await copyWasm();
await fetchModels();
