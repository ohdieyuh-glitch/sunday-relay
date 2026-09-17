import { describe, expect, it } from 'vitest';
import { mapScroll, poseTracks, sampleBySection, samplePose } from './scroll-rig';

describe('mapScroll — arrive, hold, depart', () => {
  // Section 0 arrives at 0 and departs at 400; section 1 arrives at 1000 and
  // departs at 1500; section 2 arrives at 2000 and is last.
  const arrive = [0, 1000, 2000];
  const depart = [400, 1500, Number.POSITIVE_INFINITY];

  it('holds a section exactly while it is being read', () => {
    expect(mapScroll(0, arrive, depart)).toBe(0);
    expect(mapScroll(400, arrive, depart)).toBe(0);
    expect(mapScroll(1000, arrive, depart)).toBe(1);
    expect(mapScroll(1499, arrive, depart)).toBe(1);
  });

  it('moves continuously between departure and the next arrival', () => {
    expect(mapScroll(700, arrive, depart)).toBeCloseTo(0.5);
    expect(mapScroll(1750, arrive, depart)).toBeCloseTo(1.5);
  });

  it('holds the last section past its arrival', () => {
    expect(mapScroll(2000, arrive, depart)).toBe(2);
    expect(mapScroll(99999, arrive, depart)).toBe(2);
  });

  it('never departs before it arrives, even for a section shorter than the viewport', () => {
    expect(mapScroll(1000, [0, 1000], [-50, Number.POSITIVE_INFINITY])).toBe(1);
    expect(mapScroll(500, [0, 1000], [-50, Number.POSITIVE_INFINITY])).toBeCloseTo(0.5);
  });

  it('is monotonic', () => {
    let last = -1;
    for (let y = 0; y <= 2600; y += 25) {
      const value = mapScroll(y, arrive, depart);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });
});

describe('pose sampling', () => {
  const tracks = poseTracks([
    { position: [0, 0, 10], target: [0, 0, 0], fov: 30, stage: 1 },
    { position: [10, 0, 10], target: [5, 0, 0], fov: 40, stage: 0.2 },
  ]);

  it('lands exactly on each section pose', () => {
    expect(samplePose(tracks, 0)).toEqual({ position: [0, 0, 10], target: [0, 0, 0], fov: 30, stage: 1 });
    expect(samplePose(tracks, 1)).toEqual({ position: [10, 0, 10], target: [5, 0, 0], fov: 40, stage: 0.2 });
  });

  it('eases between them and holds past the ends', () => {
    expect(samplePose(tracks, 0.5).position[0]).toBeCloseTo(5);
    expect(samplePose(tracks, 5).fov).toBe(40);
    expect(sampleBySection([0, 1, 0], 1)).toBe(1);
  });
});
