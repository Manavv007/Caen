/**
 * Nose ring orientation and placement: a hoop facing the camera (turned a
 * little outward) whose gap points into the nostril, hung so that the
 * visible arc starts at the piercing and wraps out and down around the wing.
 */
import { describe, expect, it } from 'vitest';
import { noseRingAxes, noseRingCenter } from '../src/nose-ring-solver.js';

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
// Face looking straight at the camera: side = face's left, forward = toward camera.
const frame = { side: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, forward: { x: 0, y: 0, z: 1 }, width: 1 };

describe('noseRingAxes', () => {
  for (const sideName of ['left', 'right']) {
    it(`${sideName}: right-handed orthonormal basis`, () => {
      const [x, y, z] = noseRingAxes(frame, sideName);
      for (const v of [x, y, z]) expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 6);
      expect(dot(x, y)).toBeCloseTo(0, 6);
      expect(dot(y, z)).toBeCloseTo(0, 6);
      const c = cross(x, y);
      expect(dot(c, z)).toBeCloseTo(1, 6);
    });

    it(`${sideName}: faces the camera, turned outward; gap toward the nose centre and up`, () => {
      const [, y, z] = noseRingAxes(frame, sideName);
      const out = sideName === 'left' ? 1 : -1;
      expect(z.z).toBeGreaterThan(0.6); // mostly toward the camera
      expect(z.x * out).toBeGreaterThan(0.3); // turned outward
      const gap = { x: -y.x, y: -y.y, z: -y.z };
      expect(gap.x * out).toBeLessThan(-0.2); // toward the nose centre...
      expect(gap.y).toBeGreaterThan(0.5); // ...and up, into the nostril
    });

    it(`${sideName}: the piercing is the upper end of the visible arc`, () => {
      const axes = noseRingAxes(frame, sideName);
      const pierce = { x: 0, y: 0, z: 0 };
      const c = noseRingCenter(pierce, axes, frame, 1);
      const rel = { x: pierce.x - c.x, y: pierce.y - c.y, z: pierce.z - c.z };
      expect(Math.hypot(rel.x, rel.y, rel.z)).toBeCloseTo(0.46, 6); // on the ring
      expect(dot(rel, axes[1])).toBeCloseTo(0, 6); // on the cut line (gap side hidden)
      expect(rel.y).toBeGreaterThan(0); // centre below the piercing
    });
  }

  it('tilt 0 / roll 0: flat to the camera, gap straight toward the nose centre', () => {
    const [, y, z] = noseRingAxes(frame, 'left', 0, 0);
    expect(z.z).toBeCloseTo(1, 6);
    expect(-y.x).toBeCloseTo(-1, 6);
  });
});
