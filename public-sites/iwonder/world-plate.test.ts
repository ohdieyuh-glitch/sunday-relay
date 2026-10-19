import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BRAIN, BUILD_VOXEL, buildTerrainBuffers, generateColumns, GRID_Y, JULIUS_CORE, juliusTierSlots, planBrainRecord,
  planStructures, PLATE_RADIUS, PLATEAU_TOP, PRESENCES, SIGNAL_LINKS, TOWER_CROWN_TOP, undersideAbove,
} from './world-plate';

describe('the persistent world', () => {
  it('is the same world on every visit', () => {
    expect(generateColumns()).toEqual(generateColumns());
    expect(planStructures()).toEqual(planStructures());
  });

  it('floats: every column has ground above zero and an underside below it', () => {
    const columns = generateColumns();
    expect(columns.length).toBeGreaterThan(Math.PI * (PLATE_RADIUS - 1) ** 2 * 0.9);
    for (const column of columns) {
      expect(column.top).toBeGreaterThan(0);
      expect(column.bottom).toBeLessThan(0);
      expect(Math.hypot(column.x, column.z)).toBeLessThanOrEqual(PLATE_RADIUS + 1);
    }
  });

  it('keeps the plateau level, because that is where things are built', () => {
    for (const column of generateColumns().filter((c) => Math.hypot(c.x, c.z) < 4.2)) {
      expect(column.top).toBe(PLATEAU_TOP);
    }
  });

  it('builds structures in order, on the plateau, with part of the tower already standing', () => {
    const { voxels, alreadyBuilt, structureStarts } = planStructures();
    expect(structureStarts).toEqual([...structureStarts].sort((a, b) => a - b));
    expect(alreadyBuilt).toBeGreaterThan(0);
    expect(alreadyBuilt).toBeLessThan(structureStarts[1]);
    voxels.forEach((voxel, i) => {
      expect(voxel.y).toBeGreaterThan(PLATEAU_TOP);
      const expected = structureStarts.filter((start) => start <= i).length - 1;
      expect(voxel.structure).toBe(expected);
    });
    const keys = new Set(voxels.map((v) => `${v.x},${v.y},${v.z}`));
    expect(keys.size).toBe(voxels.length);
  });

  it('only links presences that exist', () => {
    for (const [from, to] of SIGNAL_LINKS) {
      expect(PRESENCES[from]).toBeDefined();
      expect(PRESENCES[to]).toBeDefined();
      expect(from).not.toBe(to);
    }
  });
});

/** Measured at 0.142 when this landed; the ceiling leaves room for terrain tuning, not for a regression back to full columns. */
const RATIO_CEILING = 0.2;

describe('the terrain mesh', () => {
  it('rasterises far less wall than full columns would, and every column keeps a top and an underside', () => {
    const columns = generateColumns();
    const { positions, normals, colors, quads } = buildTerrainBuffers(columns);
    expect(positions.length).toBe(quads * 6 * 3);
    expect(normals.length).toBe(positions.length);
    expect(colors.length).toBe(positions.length);
    expect(quads).toBeGreaterThanOrEqual(columns.length * 2);

    // AREA is what costs fill rate, not face count: the stepped underside keeps
    // many small faces, but the tall hidden interior walls are gone.
    let area = 0;
    for (let q = 0; q < quads; q += 1) {
      const i = q * 18;
      const e1 = [positions[i + 3] - positions[i], positions[i + 4] - positions[i + 1], positions[i + 5] - positions[i + 2]];
      const e2 = [positions[i + 6] - positions[i], positions[i + 7] - positions[i + 1], positions[i + 8] - positions[i + 2]];
      const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      area += Math.hypot(cross[0], cross[1], cross[2]); // two triangles of equal area = the quad
    }
    const naive = columns.reduce((sum, c) => sum + 2 + 4 * (c.top - c.bottom), 0);
    expect(area / naive).toBeLessThan(RATIO_CEILING);
  });

  it('winds every face toward its normal', () => {
    const { positions, normals, quads } = buildTerrainBuffers(generateColumns());
    for (let q = 0; q < quads; q += 1) {
      const i = q * 18;
      const a = positions.subarray(i, i + 3);
      const b = positions.subarray(i + 3, i + 6);
      const c = positions.subarray(i + 6, i + 9);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const dot = cross[0] * normals[i] + cross[1] * normals[i + 1] + cross[2] * normals[i + 2];
      expect(dot).toBeGreaterThan(0);
    }
  });
});

describe('Julius above the crown', () => {
  it('holds three tier slots beneath its core, clear of the tower', () => {
    const slots = juliusTierSlots();
    expect(slots).toHaveLength(3);
    const towerHalfDiagonal = Math.SQRT2 * BUILD_VOXEL * 2;
    for (const [x, y, z] of slots) {
      expect(y).toBeGreaterThan(TOWER_CROWN_TOP + 1);
      expect(y).toBeLessThan(JULIUS_CORE[1]);
      expect(Math.hypot(x - JULIUS_CORE[0], z - JULIUS_CORE[2])).toBeGreaterThan(towerHalfDiagonal + 0.5);
    }
    // Three distinct directions, a third of a turn apart.
    const angles = slots.map(([x, , z]) => Math.atan2(x - JULIUS_CORE[0], z - JULIUS_CORE[2]));
    for (let i = 0; i < 3; i += 1) {
      const turn = (((angles[(i + 1) % 3] - angles[i]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      expect(Math.min(turn, 2 * Math.PI - turn)).toBeCloseTo((2 * Math.PI) / 3, 5);
    }
  });

  it('is where the signals converge', () => {
    const julius = PRESENCES.findIndex((presence) => presence.kind === 'julius');
    expect(PRESENCES[julius].position).toEqual(JULIUS_CORE);
    expect(SIGNAL_LINKS.filter(([from, to]) => from === julius || to === julius).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Project Brain beneath the world', () => {
  const record = planBrainRecord();

  it('keeps one plate per entry of the record shown on the page', () => {
    const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
    expect(record).toHaveLength(BRAIN.entries);
    expect(html.match(/class="iw-record-type"/g)).toHaveLength(BRAIN.entries);
    expect(BRAIN.alreadyWritten).toBeGreaterThan(0);
    expect(BRAIN.alreadyWritten).toBeLessThan(BRAIN.entries);
  });

  it('stacks oldest at the bottom, between the grid and the island, on the tower axis', () => {
    record.forEach((plate, i) => {
      if (i > 0) expect(plate.y - record[i - 1].y).toBeCloseTo(BRAIN.thickness + BRAIN.gap, 6);
      for (const mark of plate.marks) {
        expect(mark).toBeGreaterThan(0);
        expect(0.12 + mark).toBeLessThan(1);
      }
    });
    expect(record[0].y - BRAIN.thickness / 2).toBeGreaterThan(GRID_Y);
    const underside = undersideAbove(BRAIN.x, BRAIN.z);
    expect(underside).toBeLessThan(0);
    expect(underside - (record[record.length - 1].y + BRAIN.thickness / 2)).toBeGreaterThan(2);
    expect(planBrainRecord()).toEqual(record);
  });
});
