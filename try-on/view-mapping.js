/**
 * view-mapping.js
 *
 * Pure functions (no DOM / no Three.js) that map MediaPipe landmarks —
 * normalized [0,1] in the RAW camera frame — into:
 *   1. "visible" space: normalized [0,1] of what is actually on screen,
 *      after CSS `object-fit: cover` crops the video and after the
 *      front-camera mirror flip.
 *   2. "world" space: the orthographic Three.js frustum used by
 *      three-scene.js (y up, height 1.0, width = container aspect).
 *
 * Keeping this pure means the exact same mapping drives both the debug
 * skeleton and the 3D ring, and it can be unit-tested in Node.
 */

/**
 * Computes which centered slice of the raw video frame is visible when
 * the <video> uses object-fit: cover inside a container.
 *
 * @returns {{cropWidth:number, cropHeight:number, containerAspect:number}}
 *   cropWidth/cropHeight: visible fraction of the raw frame on each axis (0..1]
 */
export function computeCoverCrop(containerWidth, containerHeight, videoWidth, videoHeight) {
  const containerAspect =
    containerWidth > 0 && containerHeight > 0 ? containerWidth / containerHeight : 1;
  const videoAspect =
    videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : containerAspect;

  if (videoAspect > containerAspect) {
    // Video is relatively wider -> left/right edges are cropped.
    return { cropWidth: containerAspect / videoAspect, cropHeight: 1, containerAspect };
  }
  // Video is relatively taller -> top/bottom edges are cropped.
  return { cropWidth: 1, cropHeight: videoAspect / containerAspect, containerAspect };
}

/**
 * Returns a function mapping a raw landmark to visible-screen normalized
 * coordinates ([0,1] across the on-screen video area).
 */
export function createVisibleMapper(crop, mirror) {
  const x0 = (1 - crop.cropWidth) / 2;
  const y0 = (1 - crop.cropHeight) / 2;
  return (lm) => {
    let x = (lm.x - x0) / crop.cropWidth;
    const y = (lm.y - y0) / crop.cropHeight;
    if (mirror) x = 1 - x;
    return { x, y };
  };
}

/**
 * Returns a function mapping a raw landmark to orthographic world space.
 * The mapping is isotropic (1 camera pixel = same world distance on x
 * and y), and MediaPipe's z (relative depth, same scale as x, smaller =
 * closer to camera) is mapped so +z points toward the viewer.
 */
export function createViewMapper(crop, mirror) {
  const toVisible = createVisibleMapper(crop, mirror);
  const halfWidth = 0.5 * crop.containerAspect;
  const worldPerRawX = (2 * halfWidth) / crop.cropWidth;
  return (lm) => {
    const v = toVisible(lm);
    return {
      x: (v.x - 0.5) * 2 * halfWidth,
      y: -(v.y - 0.5),
      z: -(lm.z || 0) * worldPerRawX,
    };
  };
}
