/**
 * frame-scheduler.js
 *
 * Single tracking loop for every try-on category (replaces one rAF loop per
 * landmarker). Runs detection once per *new camera frame*, never more than
 * one at a time: if detection is still busy when the camera delivers the next
 * frame, that frame is dropped rather than queued, so results never lag
 * further and further behind the camera.
 *
 * Uses requestVideoFrameCallback where available (fires exactly once per
 * decoded frame), else requestAnimationFrame + currentTime polling.
 */
export class TrackingLoop {
  /**
   * @param {HTMLVideoElement} video
   * @param {Object} opts
   * @param {(video: HTMLVideoElement, timestampMs: number, frameIndex: number) => Promise<any>} opts.detect
   * @param {(results: any, timestampMs: number) => void} opts.onResult
   * @param {(err: Error) => void} [opts.onError]
   */
  constructor(video, { detect, onResult, onError = (err) => console.error(err) }) {
    this.video = video;
    this.detect = detect;
    this.onResult = onResult;
    this.onError = onError;
    this.running = false;
    this.frameIndex = 0;
    this.droppedFrames = 0;
    this._busy = false;
    this._lastVideoTime = -1;
    this._handle = null;
    this._useVfc = typeof video.requestVideoFrameCallback === 'function';
    this._tick = this._tick.bind(this);
    // Results per second over a ~1 s window, for the debug panel / quality governor.
    this.resultsPerSecond = 0;
    this._rateWindowStart = 0;
    this._rateCount = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._schedule();
  }

  stop() {
    this.running = false;
    if (this._handle === null) return;
    if (this._useVfc) this.video.cancelVideoFrameCallback(this._handle);
    else cancelAnimationFrame(this._handle);
    this._handle = null;
  }

  _schedule() {
    if (!this.running) return;
    this._handle = this._useVfc ? this.video.requestVideoFrameCallback(this._tick) : requestAnimationFrame(this._tick);
  }

  _tick() {
    this._handle = null;
    this._schedule();
    const v = this.video;
    if (v.readyState < 2) return;
    if (!this._useVfc) {
      if (v.currentTime === this._lastVideoTime) return; // no new frame yet
      this._lastVideoTime = v.currentTime;
    }
    if (this._busy) {
      this.droppedFrames++;
      return;
    }
    this._run();
  }

  async _run() {
    this._busy = true;
    const timestampMs = performance.now();
    const index = this.frameIndex++;
    try {
      const results = await this.detect(this.video, timestampMs, index);
      if (this.running) {
        this.onResult(results, timestampMs);
        this._countResult();
      }
    } catch (err) {
      if (this.running) this.onError(err);
    } finally {
      this._busy = false;
    }
  }

  _countResult() {
    const now = performance.now();
    if (!this._rateWindowStart) this._rateWindowStart = now;
    this._rateCount++;
    const elapsed = now - this._rateWindowStart;
    if (elapsed >= 1000) {
      this.resultsPerSecond = (this._rateCount * 1000) / elapsed;
      this._rateCount = 0;
      this._rateWindowStart = now;
    }
  }
}
