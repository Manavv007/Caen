/**
 * After the ring size locks, its on-screen size must follow the hand's
 * distance from the camera (closer = bigger), while ignoring posture wobble
 * and one-frame tracking glitches.
 *
 * Starts from the first locked frame of a recorded session, then feeds
 * synthetic frames of the same hand scaled about the wrist, which is what a
 * hand moving toward / away from the camera looks like on screen.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RingSolver } from '../src/ring-solver.js';

const { frames } = JSON.parse(readFileSync(fileURLToPath(new URL('../../../fixtures/ringtryon-2026-10-02T04-58-25-193Z-new.json', import.meta.url)), 'utf8'));
const toPoints = (arr) => arr.map(([x, y, z]) => ({ x, y, z }));
const FRAME_MS = 33.3;

/** Replays the recording until the size locks; returns the solver and the locked frame. */
function lockedSolver() {
  const solver = new RingSolver();
  for (const f of frames) {
    const out = solver.solve({
      timeMs: f.t, sourceWidth: f.sw, sourceHeight: f.sh, displaySize: { width: f.dw, height: f.dh }, mirror: f.mirror,
      handResult: f.hand && f.hand.landmarks.length
        ? { landmarks: f.hand.landmarks.map(toPoints), worldLandmarks: f.hand.worldLandmarks.map(toPoints), handedness: f.hand.handedness }
        : null,
      measure: f.measurement ? () => f.measurement : undefined,
    });
    if (out.sizing && out.sizing.state === 'locked' && out.diag) return { solver, f, lockedWidth: out.diag.fingerWidthPx };
  }
  throw new Error('recording never locked');
}

/** Feeds `scales` (one per frame) of the locked hand; returns the on-screen ring widths. */
function feed({ solver, f }, scales) {
  const lm = toPoints(f.hand.landmarks[0]);
  const wrist = lm[0];
  let t = f.t;
  return scales.map((k) => {
    t += FRAME_MS;
    const scaled = lm.map((p) => ({ x: wrist.x + (p.x - wrist.x) * k, y: wrist.y + (p.y - wrist.y) * k, z: p.z * k }));
    const out = solver.solve({
      timeMs: t, sourceWidth: f.sw, sourceHeight: f.sh, displaySize: { width: f.dw, height: f.dh }, mirror: f.mirror,
      handResult: { landmarks: [scaled], worldLandmarks: f.hand.worldLandmarks.map(toPoints), handedness: f.hand.handedness },
    });
    return out.diag.fingerWidthPx;
  });
}

const hold = (k, n = 30) => Array(n).fill(k); // 1 s at 30 fps

describe('ring size vs hand distance (after the size lock)', () => {
  it.each([0.5, 0.6, 1.5, 2, 2.5])('follows the hand to %sx its on-screen size within half a second', (k) => {
    const s = lockedSolver();
    const widths = feed(s, hold(k));
    const near = (w, pct) => expect(Math.abs(w / s.lockedWidth / k - 1)).toBeLessThan(pct / 100);
    near(widths[14], 5); // within 5% after ~0.5 s
    near(widths.at(-1), 1); // within 1% after 1 s
  });

  it('grows gradually, not in one jump, as the hand approaches', () => {
    const s = lockedSolver();
    const approach = Array.from({ length: 30 }, (_, i) => 1 + (i + 1) / 30); // 1x -> 2x over 1 s
    const widths = feed(s, [...approach, ...hold(2, 15)]).map((w) => w / s.lockedWidth);
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1] - 1e-9);
    expect(widths.at(-1)).toBeCloseTo(2, 1);
  });

  it('damps posture wobble at a steady distance (±4% in, at most half of that out)', () => {
    const s = lockedSolver();
    const wobble = Array.from({ length: 60 }, (_, i) => 1 + 0.04 * Math.sin(i / 3));
    const widths = feed(s, wobble);
    for (const w of widths) expect(Math.abs(w / s.lockedWidth - 1)).toBeLessThan(0.02);
  });

  it('ignores a single-frame tracking glitch', () => {
    const s = lockedSolver();
    const widths = feed(s, [...hold(1, 10), 3, ...hold(1, 10)]);
    for (const w of widths) expect(Math.abs(w / s.lockedWidth - 1)).toBeLessThan(0.005);
  });

  it('settles back to the locked size when the hand returns', () => {
    const s = lockedSolver();
    const widths = feed(s, [...hold(1.8), ...hold(1)]);
    expect(widths[29] / s.lockedWidth).toBeCloseTo(1.8, 1);
    expect(widths.at(-1) / s.lockedWidth).toBeCloseTo(1, 1);
  });
});
