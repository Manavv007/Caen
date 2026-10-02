/**
 * skin-segmentation.js
 *
 * Runs MediaPipe's multiclass selfie segmenter (background / hair /
 * body-skin / face-skin / clothes / others) on a square crop around the
 * hand and returns a per-pixel skin confidence map. finger-measure.js uses
 * it to find the ring finger's real edges, so the ring can be sized and
 * centred on the actual finger instead of a guess from knuckle spacing.
 *
 * Why a crop: the model runs at 256x256. On a full 1280x720 frame a finger
 * would be ~10 mask pixels wide; cropped to the hand it's ~30, which makes
 * the edge measurement roughly 3x more precise for the same cost.
 *
 * The ~16 MB model loads lazily, and the ring still works (falling back
 * to the knuckle-spacing estimate) if it fails to load.
 */

import { loadVisionModule, createTaskWithFallback } from './mediapipe-vision.js';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

/** Crop resolution fed to the model (its native input size). */
export const SEGMENTATION_SIZE = 256;

/**
 * Picks which output masks count as "skin". Body skin is the hand; face
 * skin is included because the selfie model sometimes labels a hand held
 * close to the camera as face skin. A face directly next to the finger then
 * reads as skin too, but finger-measure.js handles a missing edge on one side.
 *
 * @param {string[]} labels - from ImageSegmenter.getLabels()
 * @returns {number[]} mask indices to sum
 */
export function pickSkinMaskIndices(labels) {
  const norm = (labels || []).map((l) => String(l).toLowerCase().replace(/[^a-z]/g, ''));
  const body = norm.indexOf('bodyskin');
  const face = norm.indexOf('faceskin');
  const picked = [body, face].filter((i) => i >= 0);
  return picked.length ? picked : [2, 3]; // documented order of selfie_multiclass_256x256
}

/**
 * Square region of the source frame (in source pixels) around the hand.
 *
 * @param {Array<{x:number,y:number}>} landmarks - normalized [0,1]
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @param {number} [padding=0.25] - fraction of the hand's bounding box added on each side
 * @returns {{x:number, y:number, size:number}|null}
 */
export function computeHandRoi(landmarks, sourceWidth, sourceHeight, padding = 0.25) {
  if (!landmarks || !landmarks.length || !(sourceWidth > 0) || !(sourceHeight > 0)) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const lm of landmarks) {
    const px = lm.x * sourceWidth;
    const py = lm.y * sourceHeight;
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  }
  const side = Math.max(maxX - minX, maxY - minY) * (1 + 2 * padding);
  const size = Math.min(Math.max(side, 64), Math.max(sourceWidth, sourceHeight));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Keep the square inside the frame where possible (parts outside read as non-skin).
  const x = Math.min(Math.max(cx - size / 2, 0), Math.max(sourceWidth - size, 0));
  const y = Math.min(Math.max(cy - size / 2, 0), Math.max(sourceHeight - size, 0));
  return { x, y, size };
}

export class SkinSegmenter {
  constructor() {
    this._task = null;
    this._skinIndices = [2, 3];
    this.delegate = null;
    this._canvas = document.createElement('canvas');
    this._canvas.width = SEGMENTATION_SIZE;
    this._canvas.height = SEGMENTATION_SIZE;
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: false });
  }

  async load() {
    if (this._task) return;
    const { ImageSegmenter } = await loadVisionModule();
    const { task, delegate } = await createTaskWithFallback(ImageSegmenter, {
      baseOptions: { modelAssetPath: MODEL_URL },
      // IMAGE mode: every call is an independent crop at a different place,
      // so VIDEO mode's frame-to-frame assumptions don't apply.
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    this._task = task;
    this.delegate = delegate;
    this._skinIndices = pickSkinMaskIndices(task.getLabels ? task.getLabels() : []);
  }

  get ready() {
    return !!this._task;
  }

  /**
   * @param {CanvasImageSource} source - video element, image or canvas
   * @param {{x:number,y:number,size:number}} roi - in source pixels
   * @returns {{data: Float32Array, width:number, height:number, roi:{x:number,y:number,size:number}}|null}
   *   skin confidence [0,1]; data is a copy, safe to keep
   */
  segment(source, roi) {
    if (!this._task || !roi) return null;
    const S = SEGMENTATION_SIZE;
    this._ctx.clearRect(0, 0, S, S);
    this._ctx.drawImage(source, roi.x, roi.y, roi.size, roi.size, 0, 0, S, S);

    let out = null;
    this._task.segment(this._canvas, (result) => {
      const masks = result && result.confidenceMasks;
      if (!masks || !masks.length) return;
      const first = masks[this._skinIndices[0]] || masks[0];
      const width = first.width;
      const height = first.height;
      const data = new Float32Array(width * height);
      for (const idx of this._skinIndices) {
        const m = masks[idx];
        if (!m) continue;
        const arr = m.getAsFloat32Array(); // only valid inside this callback
        for (let i = 0; i < data.length; i++) data[i] += arr[i];
      }
      for (let i = 0; i < data.length; i++) if (data[i] > 1) data[i] = 1;
      out = { data, width, height, roi: { ...roi } };
    });
    return out;
  }

  dispose() {
    if (this._task) {
      this._task.close();
      this._task = null;
    }
  }
}
