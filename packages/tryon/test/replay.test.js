/**
 * Offline replay of recorded try-on sessions (fixtures/*.json, made with the
 * ?debug=1 recorder) through the DOM-free solvers.
 *
 * Purpose: lock the current placement/sizing decisions while the tracking
 * and render plumbing around them is refactored for performance. The
 * per-frame output is snapshotted; an intentional solver change updates the
 * snapshot with `npx vitest run -u` (review the diff!).
 *
 * The recordings predate later solver tuning, so their "live" fields are not
 * an oracle for today's code — only coarse behaviour is asserted against them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { RingSolver } from '../src/ring-solver.js';
import { EarringSolver } from '../src/earring-solver.js';

const fixture = (name) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url)), 'utf8'));

const toPoints = (arr) => arr.map(([x, y, z]) => ({ x, y, z }));
const r = (v, d = 4) => (Number.isFinite(v) ? Number(v.toFixed(d)) : v ?? null);
const rp = (p) => (p ? [r(p.x), r(p.y), r(p.z)] : null);
const frameInput = (f) => ({
  timeMs: f.t,
  sourceWidth: f.sw,
  sourceHeight: f.sh,
  displaySize: { width: f.dw, height: f.dh },
  mirror: f.mirror,
});

describe('ring solver replay', () => {
  const { frames } = fixture('ringtryon-2026-10-02T04-58-25-193Z-new.json');
  const solver = new RingSolver();
  const results = frames.map((f) => ({
    f,
    out: solver.solve({
      ...frameInput(f),
      handResult: f.hand && f.hand.landmarks.length
        ? {
          landmarks: f.hand.landmarks.map(toPoints),
          worldLandmarks: f.hand.worldLandmarks.map(toPoints),
          handedness: f.hand.handedness,
        }
        : null,
      // Feed back exactly the skin measurements taken live, on the same frames.
      measure: f.measurement ? () => f.measurement : undefined,
    }),
  }));

  it('matches the snapshot', () => {
    expect(results.map(({ out }) => ({
      sizing: out.sizing && out.sizing.state,
      visible: !!(out.pose && out.pose.valid),
      widthPx: out.diag ? r(out.diag.fingerWidthPx, 2) : null,
      position: out.pose && out.pose.valid ? rp(out.pose.position) : null,
    }))).toMatchSnapshot();
  });

  it('detects the hand whenever landmarks are present', () => {
    for (const { f, out } of results) expect(out.handDetected).toBe(!!(f.hand && f.hand.landmarks.length));
  });

  it('locks the ring size and shows the ring', () => {
    expect(results.some(({ out }) => out.sizing && out.sizing.state === 'locked')).toBe(true);
    expect(results.filter(({ out }) => out.pose && out.pose.valid).length).toBeGreaterThan(frames.length / 2);
  });
});

describe('earring solver replay', () => {
  const { frames } = fixture('ear-ring-tryon.json');
  const solver = new EarringSolver();
  const results = frames.map((f) => ({
    f,
    s: solver.solve({ ...frameInput(f), landmarks: f.face ? toPoints(f.face.landmarks) : null }),
  }));

  it('matches the snapshot', () => {
    expect(results.map(({ s }) => (s.faceDetected
      ? {
        faceWidth: r(s.faceWidth, 5),
        left: { pos: rp(s.earrings.left.position), vis: r(s.earrings.left.visibility, 3) },
        right: { pos: rp(s.earrings.right.position), vis: r(s.earrings.right.visibility, 3) },
      }
      : null))).toMatchSnapshot();
  });

  it('detects the face on the same frames as live, with earrings near the recorded ones', () => {
    for (const { f, s } of results) {
      expect(s.faceDetected).toBe(!!f.live);
      if (!f.live) continue;
      for (const side of ['left', 'right']) {
        const p = s.earrings[side].position;
        const [x, y] = f.live[side].pos;
        // Within 15% of the face width of where the (older) live solver put it.
        expect(Math.hypot(p.x - x, p.y - y) / f.live.faceWidth).toBeLessThan(0.15);
      }
    }
  });
});
