/**
 * finger-measure.js
 *
 * Measures the ring finger's real on-screen width (and where its centre
 * line actually is) from a skin confidence mask, by walking outward from
 * the landmark centre line, perpendicular to the finger, until the skin
 * confidence drops below 0.5 on each side.
 *
 * Pure functions, all coordinates in SOURCE PIXELS (raw camera frame,
 * unmirrored), so it can be unit-tested with synthetic masks.
 *
 * Fingers held together are the hard case: there is often no background
 * gap between the ring finger and its neighbours, so one or both edges are
 * never found. A one-sided measurement (2 × the side that was found) is
 * used when needed; with no edge found, the caller falls back to its
 * knuckle-spacing estimate.
 */

const SKIN_THRESHOLD = 0.5;

/** Bilinear sample of the mask at a source-pixel position; 0 outside the crop. */
export function sampleMask(mask, px, py) {
  const { data, width, height, roi } = mask;
  const mx = ((px - roi.x) / roi.size) * width - 0.5;
  const my = ((py - roi.y) / roi.size) * height - 0.5;
  if (mx < 0 || my < 0 || mx > width - 1 || my > height - 1) return 0;
  const x0 = Math.floor(mx);
  const y0 = Math.floor(my);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = mx - x0;
  const fy = my - y0;
  const a = data[y0 * width + x0];
  const b = data[y0 * width + x1];
  const c = data[y1 * width + x0];
  const d = data[y1 * width + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/**
 * Distance from `start` along unit vector `dir` to the first skin->non-skin
 * crossing, with linear interpolation between samples. null if none within maxDist.
 */
function findEdge(mask, start, dir, maxDist, step) {
  let prevD = 0;
  let prevV = sampleMask(mask, start.x, start.y);
  for (let d = step; d <= maxDist + 1e-9; d += step) {
    const v = sampleMask(mask, start.x + dir.x * d, start.y + dir.y * d);
    if (v < SKIN_THRESHOLD) {
      const t = prevV - v > 1e-6 ? (prevV - SKIN_THRESHOLD) / (prevV - v) : 0;
      return prevD + t * (d - prevD);
    }
    prevD = d;
    prevV = v;
  }
  return null;
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * @param {{data:Float32Array,width:number,height:number,roi:{x,y,size}}} mask
 * @param {Object} p
 * @param {{x:number,y:number}} p.mcpPx - ring-finger MCP, source pixels
 * @param {{x:number,y:number}} p.pipPx - ring-finger PIP, source pixels
 * @param {number} p.ringT - ring position along MCP->PIP (0..1)
 * @param {number} p.expectedWidthPx - prior estimate (knuckle spacing), bounds the search
 * @returns {{valid:boolean, widthPx?:number, centerOffsetPx?:number, twoSided?:boolean,
 *            perpPx?:{x:number,y:number}, edges:Array<{x:number,y:number}>}}
 *   centerOffsetPx: signed shift of the true finger centre from the landmark
 *   line, along perpPx (only from two-sided lines)
 */
export function measureFingerWidth(mask, { mcpPx, pipPx, ringT, expectedWidthPx }) {
  const edges = [];
  const fail = { valid: false, edges };
  if (!mask || !(expectedWidthPx > 0)) return fail;

  const dx = pipPx.x - mcpPx.x;
  const dy = pipPx.y - mcpPx.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return fail;
  const dir = { x: dx / len, y: dy / len };
  const perp = { x: -dir.y, y: dir.x };
  const neg = { x: -perp.x, y: -perp.y };

  const pxPerMaskPx = mask.roi.size / mask.width;
  const step = Math.max(pxPerMaskPx * 0.5, 0.5);
  // Half-width search window: up to 1.2× the expected FULL width from the
  // centre line. The knuckle-spacing prior can under-estimate by ~25%
  // (measured live: 30.8 px expected vs 38.5 px real), so a tighter window
  // stopped before the true edge and the line was discarded.
  const maxDist = expectedWidthPx * 1.2;

  const two = [];
  const offsets = [];
  const one = [];
  // Three lines across the finger around the ring position; the median
  // rejects one line hitting a crease, shadow or a neighbouring fingertip.
  for (const dt of [-0.1, 0, 0.1]) {
    const t = Math.min(Math.max(ringT + dt, 0.05), 0.95);
    const c = { x: mcpPx.x + dx * t, y: mcpPx.y + dy * t };
    if (sampleMask(mask, c.x, c.y) < 0.6) continue; // centre not confidently on skin
    const a = findEdge(mask, c, perp, maxDist, step);
    const b = findEdge(mask, c, neg, maxDist, step);
    if (a !== null) edges.push({ x: c.x + perp.x * a, y: c.y + perp.y * a });
    if (b !== null) edges.push({ x: c.x + neg.x * b, y: c.y + neg.y * b });
    if (a !== null && b !== null) {
      two.push(a + b);
      offsets.push((a - b) / 2);
    } else if (a !== null || b !== null) {
      one.push(2 * (a !== null ? a : b));
    }
  }

  const plausible = (w) => w >= expectedWidthPx * 0.55 && w <= expectedWidthPx * 1.6;
  const twoOk = two.filter(plausible);
  if (twoOk.length) {
    return {
      valid: true,
      widthPx: median(twoOk),
      centerOffsetPx: median(offsets),
      twoSided: true,
      perpPx: perp,
      edges,
    };
  }
  const oneOk = one.filter(plausible);
  if (oneOk.length) {
    return { valid: true, widthPx: median(oneOk), centerOffsetPx: 0, twoSided: false, perpPx: perp, edges };
  }
  return fail;
}
