/**
 * lighting-estimator.js
 *
 * Makes the 3D ring match the camera image instead of looking studio-lit.
 *
 * Every few frames we downsample the live video into a tiny canvas and
 * measure:
 *   - average linear luminance -> how bright the ring should be rendered
 *   - average colour (gray-world white balance) -> the colour of the light
 *     (warm tungsten room -> warm ring highlights)
 *   - pixel-to-pixel noise in dark images is higher, so grain is scaled
 *     inversely with brightness
 *
 * We deliberately measure the WHOLE frame, not the skin around the hand:
 * skin colour and tone would otherwise be mistaken for the light colour
 * or brightness. And we measure the image as displayed (after the camera's
 * own auto-exposure/white balance), because the ring must match the
 * picture the user sees, not the physical room.
 *
 * analyzePixels() and lightingFromAnalysis() are pure so they can be
 * unit-tested in Node; LightingEstimator is the thin DOM wrapper.
 */

/** Linear luminance of an 18% grey card — the "normal exposure" reference. */
export const REFERENCE_LUMINANCE = 0.18;

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

// 256-entry lookup so per-pixel conversion is a table read, not a pow().
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) SRGB_TO_LINEAR[i] = srgbToLinear(i);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {Uint8ClampedArray|Uint8Array} data - RGBA pixels
 * @returns {{luminance:number, color:{r:number,g:number,b:number}}}
 *   luminance: mean linear luminance [0,1]; color: mean linear RGB [0,1]
 */
export function analyzePixels(data) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    r += SRGB_TO_LINEAR[data[i]];
    g += SRGB_TO_LINEAR[data[i + 1]];
    b += SRGB_TO_LINEAR[data[i + 2]];
    n++;
  }
  if (n === 0) return { luminance: REFERENCE_LUMINANCE, color: { r: 1, g: 1, b: 1 } };
  r /= n;
  g /= n;
  b /= n;
  return { luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b, color: { r, g, b } };
}

/**
 * Maps a frame analysis to renderer parameters.
 *
 * @param {{luminance:number, color:{r:number,g:number,b:number}}} analysis
 * @returns {{exposure:number, envIntensity:number, tint:{r:number,g:number,b:number}, grain:number}}
 */
export function lightingFromAnalysis(analysis) {
  const lum = Math.max(analysis.luminance, 1e-4);
  const ratio = lum / REFERENCE_LUMINANCE;

  // Sub-linear response (^0.6): follow the scene's brightness without
  // crushing the ring to black in a very dark frame, where a real metal
  // highlight would still catch some light.
  const exposure = clamp(Math.pow(ratio, 0.6), 0.3, 1.4);
  const envIntensity = clamp(Math.pow(ratio, 0.5), 0.35, 1.3);

  // Gray-world white balance: a neutral scene averages to grey, so the
  // average colour's deviation from grey approximates the light colour.
  // Blend halfway toward white so strongly coloured walls/clothes don't
  // over-tint the metal.
  const { r, g, b } = analysis.color;
  const maxC = Math.max(r, g, b, 1e-6);
  const TINT_STRENGTH = 0.5;
  const tint = {
    r: 1 - TINT_STRENGTH + TINT_STRENGTH * (r / maxC),
    g: 1 - TINT_STRENGTH + TINT_STRENGTH * (g / maxC),
    b: 1 - TINT_STRENGTH + TINT_STRENGTH * (b / maxC),
  };

  // Webcams boost gain in dim scenes, which adds visible sensor noise;
  // match it so the ring isn't the only noise-free thing in the frame.
  const grain = clamp(0.012 + (REFERENCE_LUMINANCE - lum) * 0.12, 0.008, 0.04);

  return { exposure, envIntensity, tint, grain };
}

/** Exponential smoothing between two parameter sets (avoids flicker when the camera's auto-exposure hunts). */
export function blendLighting(prev, next, alpha) {
  if (!prev) return next;
  const mix = (a, b) => a + (b - a) * alpha;
  return {
    exposure: mix(prev.exposure, next.exposure),
    envIntensity: mix(prev.envIntensity, next.envIntensity),
    tint: { r: mix(prev.tint.r, next.tint.r), g: mix(prev.tint.g, next.tint.g), b: mix(prev.tint.b, next.tint.b) },
    grain: mix(prev.grain, next.grain),
  };
}

/**
 * Samples the live <video> periodically and exposes smoothed lighting params.
 */
export class LightingEstimator {
  /**
   * @param {Object} [options]
   * @param {number} [options.sampleEveryNFrames=6] - ~5 samples/s at 30fps; cheap on mid-range phones
   * @param {number} [options.smoothing=0.2] - blend factor per sample
   */
  constructor(options = {}) {
    this.sampleEveryNFrames = options.sampleEveryNFrames ?? 6;
    this.smoothing = options.smoothing ?? 0.2;
    this._frame = 0;
    this._params = null;
    this._canvas = document.createElement('canvas');
    this._canvas.width = 32;
    this._canvas.height = 18;
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * Call once per processed frame. Returns the current smoothed params
   * (or null until the first sample).
   * @param {HTMLVideoElement} videoEl
   */
  update(videoEl) {
    const due = this._frame % this.sampleEveryNFrames === 0;
    this._frame++;
    if (!due || !this._ctx || videoEl.readyState < 2) return this._params;

    try {
      this._ctx.drawImage(videoEl, 0, 0, this._canvas.width, this._canvas.height);
      const { data } = this._ctx.getImageData(0, 0, this._canvas.width, this._canvas.height);
      const next = lightingFromAnalysis(analyzePixels(data));
      this._params = blendLighting(this._params, next, this._params ? this.smoothing : 1);
    } catch (err) {
      // Reading pixels can fail on some browsers mid camera-switch; keep
      // the last estimate rather than breaking the render loop.
    }
    return this._params;
  }

  reset() {
    this._frame = 0;
    this._params = null;
  }
}
