import { describe, expect, it } from 'vitest';
import { TrackingLoop } from '../src/frame-scheduler.js';
import { PerfGovernor, QUALITY_TIERS, initialTierIndex } from '../src/perf-governor.js';

/** Minimal <video> stand-in that delivers frames when the test says so. */
function fakeVideo() {
  let cb = null;
  return {
    readyState: 4,
    requestVideoFrameCallback(fn) { cb = fn; return 1; },
    cancelVideoFrameCallback() { cb = null; },
    deliverFrame() { const fn = cb; cb = null; if (fn) fn(); },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('TrackingLoop', () => {
  it('runs one detection per frame and drops frames while busy instead of queueing', async () => {
    const video = fakeVideo();
    const pending = [];
    const results = [];
    const loop = new TrackingLoop(video, {
      detect: () => new Promise((resolve) => pending.push(resolve)),
      onResult: (r) => results.push(r),
    });
    loop.start();

    video.deliverFrame(); // starts detection #0
    video.deliverFrame(); // busy -> dropped
    video.deliverFrame(); // busy -> dropped
    expect(pending.length).toBe(1);
    expect(loop.droppedFrames).toBe(2);

    pending[0]('a');
    await flush();
    expect(results).toEqual(['a']);

    video.deliverFrame(); // free again -> detection #1
    expect(pending.length).toBe(2);
    pending[1]('b');
    await flush();
    expect(results).toEqual(['a', 'b']);
    loop.stop();
  });

  it('discards a result that arrives after stop()', async () => {
    const video = fakeVideo();
    let resolve;
    const results = [];
    const loop = new TrackingLoop(video, {
      detect: () => new Promise((r) => { resolve = r; }),
      onResult: (r) => results.push(r),
    });
    loop.start();
    video.deliverFrame();
    loop.stop();
    resolve('late');
    await flush();
    expect(results).toEqual([]);
  });

  it('reports detection errors and keeps running', async () => {
    const video = fakeVideo();
    const errors = [];
    let calls = 0;
    const loop = new TrackingLoop(video, {
      detect: async () => { calls++; throw new Error('boom'); },
      onResult: () => {},
      onError: (e) => errors.push(e.message),
    });
    loop.start();
    video.deliverFrame();
    await flush();
    video.deliverFrame();
    await flush();
    expect(calls).toBe(2);
    expect(errors).toEqual(['boom', 'boom']);
    loop.stop();
  });
});

describe('PerfGovernor', () => {
  it('picks a starting tier from device hints', () => {
    expect(initialTierIndex({ deviceMemory: 8, hardwareConcurrency: 8 })).toBe(0);
    expect(initialTierIndex({ deviceMemory: 4, hardwareConcurrency: 8 })).toBe(1);
    expect(initialTierIndex({ deviceMemory: 2, hardwareConcurrency: 8 })).toBe(2);
    expect(initialTierIndex({})).toBe(0);
  });

  it('steps down after a sustained slow window, never up, and ignores the warm-up', () => {
    const changes = [];
    const g = new PerfGovernor({ startTier: 0, minFps: 20, windowMs: 2000, graceMs: 3000, onChange: (t) => changes.push(t.name) });
    for (let t = 0; t <= 2900; t += 100) g.update(t, 5); // warm-up: ignored
    expect(changes).toEqual([]);
    for (let t = 3000; t <= 4900; t += 100) g.update(t, 15); // 1.9 s slow
    expect(changes).toEqual([]);
    g.update(5000, 15); // 2 s slow -> step down
    expect(changes).toEqual(['mid']);
    for (let t = 5100; t <= 20000; t += 100) g.update(t, 30); // fast again: stays
    expect(g.tier.name).toBe('mid');
    for (let t = 20100; t <= 30000; t += 100) g.update(t, 10);
    expect(changes).toEqual(['mid', 'low']);
    expect(g.index).toBe(QUALITY_TIERS.length - 1); // floor
  });

  it('a brief dip does not step down', () => {
    const changes = [];
    const g = new PerfGovernor({ startTier: 0, graceMs: 0, onChange: (t) => changes.push(t.name) });
    for (let t = 0; t < 1500; t += 100) g.update(t, 10);
    g.update(1500, 25); // recovered before 2 s
    for (let t = 1600; t < 3000; t += 100) g.update(t, 10);
    expect(changes).toEqual([]);
  });
});
