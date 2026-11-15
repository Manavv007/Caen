/**
 * Nose ring orientation: the hoop passes through the nostril wall (plane
 * roughly edge-on to the camera), not a flat "O" facing the viewer.
 */
import { describe, expect, it } from 'vitest';
import { noseRingAxes } from '../src/nose-ring-solver.js';

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

    it(`${sideName}: ring plane is near edge-on, normal points out of the nose`, () => {
      const [, y, z] = noseRingAxes(frame, sideName);
      const out = sideName === 'left' ? 1 : -1;
      expect(z.x * out).toBeGreaterThan(0.9); // normal mostly sideways, outward
      expect(z.z).toBeGreaterThan(0.2); // tilted a little toward the camera
      const gap = { x: -y.x, y: -y.y, z: -y.z };
      expect(gap.y).toBeGreaterThan(0.5); // gap points up, into the nostril...
      expect(gap.z).toBeLessThan(-0.3); // ...and toward the back of the nose
    });
  }

  it('tilt 0 / roll 0 gives an exactly edge-on ring with the gap straight up', () => {
    const [, y, z] = noseRingAxes(frame, 'left', 0, 0);
    expect(z.x).toBeCloseTo(1, 6);
    expect(-y.y).toBeCloseTo(1, 6);
  });
});
