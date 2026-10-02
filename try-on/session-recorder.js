/**
 * session-recorder.js  (debug tool, shown only with ?debug=1)
 *
 * Records ~10 s of a live try-on session as two downloads:
 *   1. ringtryon-<time>.json — every frame's MediaPipe output (landmarks,
 *      world landmarks, handedness), the skin-mask measurement, and what
 *      the live solver decided. This can be replayed offline through
 *      RingSolver to measure size/tilt stability numerically.
 *   2. ringtryon-<time>.webm — the camera feed with the ring composited
 *      (mirrored like the screen), to see what the numbers correspond to.
 *
 * Nothing is uploaded anywhere; files are saved locally via a download.
 */

/** Picks a MediaRecorder mime type the browser supports. */
function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export class SessionRecorder {
  /**
   * @param {Object} opts
   * @param {HTMLVideoElement} opts.videoEl
   * @param {HTMLCanvasElement} opts.overlayCanvas - WebGL ring layer (preserveDrawingBuffer: true)
   * @param {() => boolean} opts.isMirrored
   * @param {{startRecording:Function, stopRecording:Function}} opts.pipeline
   */
  constructor({ videoEl, overlayCanvas, isMirrored, pipeline }) {
    this.videoEl = videoEl;
    this.overlayCanvas = overlayCanvas;
    this.isMirrored = isMirrored;
    this.pipeline = pipeline;
    this.active = false;
  }

  /**
   * Records for `durationMs`, then downloads both files.
   * @param {number} [durationMs=10000]
   * @param {(remainingMs:number) => void} [onTick]
   * @returns {Promise<{frames:number, videoSaved:boolean}>}
   */
  async record(durationMs = 10000, onTick = () => {}) {
    if (this.active) throw new Error('Already recording');
    this.active = true;

    // Composite canvas: camera + ring layer, at the camera's resolution.
    const vw = this.videoEl.videoWidth || 1280;
    const vh = this.videoEl.videoHeight || 720;
    const scale = Math.min(1, 960 / Math.max(vw, vh)); // keep the file small
    const comp = document.createElement('canvas');
    comp.width = Math.round(vw * scale);
    comp.height = Math.round(vh * scale);
    const ctx = comp.getContext('2d');

    const mime = pickMimeType();
    let recorder = null;
    const chunks = [];
    if (mime !== null && typeof comp.captureStream === 'function') {
      try {
        recorder = new MediaRecorder(comp.captureStream(30), mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : undefined);
        recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      } catch (err) {
        recorder = null; // JSON still records; video is a bonus
      }
    }

    // The overlay canvas covers the displayed (object-cover cropped)
    // area; draw it over the matching crop of the camera frame.
    const drawFrame = () => {
      const mirror = this.isMirrored();
      ctx.save();
      if (mirror) {
        ctx.translate(comp.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(this.videoEl, 0, 0, comp.width, comp.height);
      ctx.restore();
      const rect = this.overlayCanvas.getBoundingClientRect();
      const containerAspect = rect.width / rect.height;
      const videoAspect = vw / vh;
      let dx = 0, dy = 0, dw = comp.width, dh = comp.height;
      if (videoAspect > containerAspect) {
        dw = comp.height * containerAspect; // visible slice is narrower than the frame
        dx = (comp.width - dw) / 2;
      } else {
        dh = comp.width / containerAspect;
        dy = (comp.height - dh) / 2;
      }
      ctx.drawImage(this.overlayCanvas, dx, dy, dw, dh);
    };

    const start = performance.now();
    this.pipeline.startRecording();
    if (recorder) recorder.start(500);

    await new Promise((resolve) => {
      const tick = () => {
        const elapsed = performance.now() - start;
        drawFrame();
        onTick(Math.max(0, durationMs - elapsed));
        if (elapsed >= durationMs) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const frames = this.pipeline.stopRecording();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const meta = {
      app: 'caen-ring-tryon',
      version: 1,
      recordedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      durationMs,
      frameCount: frames.length,
    };
    download(new Blob([JSON.stringify({ meta, frames })], { type: 'application/json' }), `ringtryon-${stamp}.json`);

    let videoSaved = false;
    if (recorder) {
      await new Promise((resolve) => {
        recorder.onstop = resolve;
        recorder.stop();
      });
      if (chunks.length) {
        const ext = (recorder.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
        download(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }), `ringtryon-${stamp}.${ext}`);
        videoSaved = true;
      }
    }

    this.active = false;
    return { frames: frames.length, videoSaved };
  }
}
