/**
 * landmark-debug-draw.js
 *
 * Draws MediaPipe landmark results onto a <canvas> overlaid on the
 * camera feed. This is debug/visualization tooling for Task 3 — actual
 * jewelry rendering (Three.js) replaces/augments this in later tasks.
 *
 * Handles the mirrored-camera coordinate flip: MediaPipe always returns
 * landmarks in the coordinate space of the raw (unmirrored) video frame,
 * but the front camera's <video> element is displayed mirrored via CSS
 * (transform: scaleX(-1)) so it feels natural to the user. The overlay
 * canvas must apply the same mirror so dots land on the visible hand,
 * not its unmirrored mirror image.
 */

/**
 * Resizes the canvas backing store to match its displayed CSS size and
 * the video's intrinsic resolution, accounting for device pixel ratio
 * so drawing stays crisp on high-DPI screens.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLVideoElement} videoEl
 */
export function syncCanvasSize(canvas, videoEl) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

/**
 * Clears the canvas. Call once per frame before drawing new results.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 */
export function clearCanvas(ctx, canvas) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * Draws one hand's landmarks + skeleton connections onto the canvas.
 * Landmarks are in normalized [0,1] coordinates as returned by MediaPipe.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{x:number,y:number,z:number}>} landmarks
 * @param {Array<[number,number]>} connections
 * @param {Object} [options]
 * @param {boolean} [options.mirror=true] - flip X to match a mirrored (front-camera) video element
 * @param {string} [options.dotColor='#C5A059']
 * @param {string} [options.lineColor='rgba(197, 160, 89, 0.6)']
 * @param {number} [options.dotRadius=4]
 */
export function drawHandLandmarks(ctx, canvas, landmarks, connections, options = {}) {
  const {
    mirror = true,
    mapToVisible = null, // optional (lm) => {x,y} in visible [0,1] space, e.g. from view-mapping.js (handles object-cover crop)
    dotColor = '#C5A059',
    lineColor = 'rgba(197, 160, 89, 0.6)',
    dotRadius = 4,
  } = options;

  const toCanvasCoords = (lm) => {
    if (mapToVisible) {
      const v = mapToVisible(lm);
      return { x: v.x * canvas.width, y: v.y * canvas.height };
    }
    const nx = mirror ? 1 - lm.x : lm.x;
    return { x: nx * canvas.width, y: lm.y * canvas.height };
  };

  // Skeleton lines first, so dots render on top.
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = Math.max(2, canvas.width * 0.0025);
  for (const [startIdx, endIdx] of connections) {
    const a = landmarks[startIdx];
    const b = landmarks[endIdx];
    if (!a || !b) continue;
    const pa = toCanvasCoords(a);
    const pb = toCanvasCoords(b);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  // Landmark dots.
  ctx.fillStyle = dotColor;
  for (const lm of landmarks) {
    const p = toCanvasCoords(lm);
    ctx.beginPath();
    ctx.arc(p.x, p.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Convenience: draws all detected hands from a HandLandmarkerResult.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {import('@mediapipe/tasks-vision').HandLandmarkerResult|null} result
 * @param {Array<[number,number]>} connections
 * @param {Object} [options]
 */
export function drawAllHands(ctx, canvas, result, connections, options = {}) {
  clearCanvas(ctx, canvas);
  if (!result || !result.landmarks) return;
  for (const handLandmarks of result.landmarks) {
    drawHandLandmarks(ctx, canvas, handLandmarks, connections, options);
  }
}
