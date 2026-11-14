/**
 * Ring orientation. With one camera, MediaPipe's per-joint depth (and so the
 * finger's tilt toward/away from the camera) is unreliable: in the recorded
 * session it leans ~15° one way and swings ±30° while the hand is held flat.
 * By default ('flat') the ring's axis therefore lies in the image plane along
 * the finger's on-screen direction; 'world' keeps the old tilt for A/B.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RingSolver } from '../src/ring-solver.js';

const { frames } = JSON.parse(readFileSync(fileURLToPath(new URL('../../../fixtures/ringtryon-2026-10-02T04-58-25-193Z-new.json', import.meta.url)), 'utf8'));
const toPoints = (arr) => arr.map(([x, y, z]) => ({ x, y, z }));
const deg = (r) => (r * 180) / Math.PI;

function replay(opts) {
  const solver = new RingSolver(opts);
  const out = [];
  for (const f of frames) {
    const o = solver.solve({
      timeMs: f.t, sourceWidth: f.sw, sourceHeight: f.sh, displaySize: { width: f.dw, height: f.dh }, mirror: f.mirror,
      handResult: f.hand && f.hand.landmarks.length
        ? { landmarks: f.hand.landmarks.map(toPoints), worldLandmarks: f.hand.worldLandmarks.map(toPoints), handedness: f.hand.handedness }
        : null,
      measure: f.measurement ? () => f.measurement : undefined,
    });
    if (o.pose && o.pose.valid && !o.pose.stale) out.push(o);
  }
  return out;
}

/** Angle of the ring axis out of the image plane, in degrees. */
const tiltOf = (o) => deg(Math.asin(Math.min(1, Math.abs(o.pose.yAxis.z))));

describe('ring orientation', () => {
  it('flat (default): axis lies in the image plane, pointing where the finger points on screen', () => {
    const flat = replay();
    const world = replay({ tiltMode: 'world' });
    expect(flat.length).toBeGreaterThan(50);
    expect(world.length).toBe(flat.length);
    flat.forEach((o, i) => {
      const a = o.pose.yAxis;
      expect(Math.abs(a.z)).toBeLessThan(1e-9);
      // Same on-screen direction as the tilted axis (both come from MCP->PIP on screen).
      const b = world[i].pose.yAxis;
      const nb = Math.hypot(b.x, b.y);
      expect(a.x * (b.x / nb) + a.y * (b.y / nb)).toBeGreaterThan(0.99999);
    });
  });

  it('flat keeps the stone facing the camera (no sideways lean)', () => {
    for (const o of replay()) expect(o.pose.zAxis.z).toBeGreaterThan(0.75);
  });

  it("'world' still applies the 3D tilt, clamped to ±35° (comparison mode)", () => {
    const tilts = replay({ tiltMode: 'world' }).map(tiltOf);
    expect(Math.max(...tilts)).toBeGreaterThan(10); // it really does tilt in this session
    for (const t of tilts) expect(t).toBeLessThanOrEqual(35.0001);
  });

  it('flat is steadier frame to frame than world', () => {
    const turn = (out) => {
      const d = out.slice(1).map((o, i) => {
        const a = out[i].pose.yAxis, b = o.pose.yAxis;
        return deg(Math.acos(Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)));
      }).sort((x, y) => x - y);
      return d[d.length >> 1];
    };
    const flat = turn(replay());
    const world = turn(replay({ tiltMode: 'world' }));
    console.log(`median frame-to-frame axis change: flat ${flat.toFixed(2)}°, world ${world.toFixed(2)}°`);
    expect(flat).toBeLessThan(world);
  });
});
