import * as THREE from 'three';

/**
 * THE PERSISTENT WORLD — the i.Wonder hero object, as pure geometry data.
 *
 * A floating voxel island: terraced ground on top, a stepped inverted cone
 * beneath, a plateau at the centre where things are being built. It is the
 * company thesis drawn as an object — creation happening in a place that
 * stays. One axis runs through it: Julius and its three tiers above the
 * tower's crown, the work in the middle, and Project Brain — the record that
 * work leaves behind — accumulating beneath the world.
 *
 * Everything here is DETERMINISTIC. The island is generated from a fixed
 * hash, so every visitor, every reload and every screenshot sees the same
 * world. A random world would be a different page on every visit.
 */

export const PLATE_RADIUS = 15;
export const PLATEAU_TOP = 1;

/** Voxel size of the things being built — half a terrain cell, for scale contrast. */
export const BUILD_VOXEL = 0.5;

export type Column = {
  readonly x: number;
  readonly z: number;
  readonly top: number;
  readonly bottom: number;
  readonly shade: number;
};

export type BuildVoxel = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Which structure it belongs to; structures unlock in order. */
  readonly structure: number;
};

function hash(x: number, z: number, salt: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise(x: number, z: number, salt: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, salt);
  const b = hash(ix + 1, iz, salt);
  const c = hash(ix, iz + 1, salt);
  const d = hash(ix + 1, iz + 1, salt);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The island's columns. Pure; asserted by `world-plate.test.ts`. */
export function generateColumns(radius = PLATE_RADIUS): Column[] {
  const columns: Column[] = [];
  const reach = radius + 2;
  for (let ix = -reach; ix <= reach; ix += 1) {
    for (let iz = -reach; iz <= reach; iz += 1) {
      const d = Math.hypot(ix, iz);
      // A ragged rim: a perfect disc reads as a coaster, not as land.
      const ragged = (hash(ix, iz, 1) - 0.5) * 1.8;
      if (d > radius + ragged) continue;

      const edge = clamp01((radius - d) / 5.5);
      const n = valueNoise(ix * 0.16, iz * 0.16, 3) * 0.68 + valueNoise(ix * 0.37 + 5, iz * 0.37 - 3, 7) * 0.32;
      // A ridge rises along the far side, so the plateau reads as a valley
      // held by higher ground rather than a flat stage.
      const ridge = clamp01((-iz - ix * 0.35) / radius) * 2.4;
      let height = (n * 1.7 + ridge) * Math.pow(edge, 0.7);
      // The plateau is where the building happens; keep it level.
      const plateau = clamp01((d - 4.2) / 2.2);
      height *= plateau;
      // Terraces in half-cell steps: the voxel register, not a heightmap.
      let top = PLATEAU_TOP + Math.round(height * 2) / 2;
      if (edge < 0.12) top -= 0.5;

      // The underside: a stepped, ragged inverted cone — a floating island.
      const inner = 1 - clamp01(d / (radius + 1));
      const bottom = -(0.9 + Math.pow(inner, 1.5) * 12.5 + hash(ix, iz, 2) * 2.4 * inner);

      columns.push({ x: ix, z: iz, top, bottom, shade: 0.8 + hash(ix, iz, 4) * 0.08 });
    }
  }
  return columns;
}

/**
 * THE TERRAIN AS ONE MESH OF VISIBLE FACES ONLY.
 *
 * Drawn as 700 instanced full-height boxes, the island was the most expensive
 * thing on either site by a wide margin: every column's four walls were
 * rasterised and shaded even where a neighbour hid them completely, in no
 * useful depth order. Skipping that single draw call quintupled the frame rate
 * under software rendering.
 *
 * So each column now contributes its top, its underside, and only the parts of
 * each wall that stick out past the neighbour on that side — above the
 * neighbour's top (a terrace step) or below its bottom (the stepped overhang).
 * A wall with no neighbour is the rim and is emitted whole. The silhouette is
 * identical; the hidden interior simply no longer exists.
 */
export type TerrainBuffers = {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly quads: number;
};

type V3 = readonly [number, number, number];

export function buildTerrainBuffers(columns: readonly Column[]): TerrainBuffers {
  const byCell = new Map<string, Column>();
  for (const column of columns) byCell.set(`${column.x},${column.z}`, column);

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  let quads = 0;

  // Emit a quad with counter-clockwise winding as seen from the side `normal`
  // points to, whatever order the corners were listed in.
  const quad = (a: V3, b: V3, c: V3, d: V3, normal: V3, shade: number) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const facing = cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2];
    const corners = facing >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    for (const corner of corners) {
      positions.push(corner[0], corner[1], corner[2]);
      normals.push(normal[0], normal[1], normal[2]);
      colors.push(shade, shade, shade);
    }
    quads += 1;
  };

  const SIDES: ReadonlyArray<{ dx: number; dz: number }> = [
    { dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 },
  ];

  for (const c of columns) {
    const x0 = c.x - 0.5;
    const x1 = c.x + 0.5;
    const z0 = c.z - 0.5;
    const z1 = c.z + 0.5;
    quad([x0, c.top, z0], [x1, c.top, z0], [x1, c.top, z1], [x0, c.top, z1], [0, 1, 0], c.shade);
    quad([x0, c.bottom, z0], [x1, c.bottom, z0], [x1, c.bottom, z1], [x0, c.bottom, z1], [0, -1, 0], c.shade);

    for (const { dx, dz } of SIDES) {
      const neighbour = byCell.get(`${c.x + dx},${c.z + dz}`);
      const spans: Array<readonly [number, number]> = [];
      if (!neighbour) {
        spans.push([c.bottom, c.top]);
      } else {
        if (c.top > neighbour.top) spans.push([Math.max(c.bottom, neighbour.top), c.top]);
        if (c.bottom < neighbour.bottom) spans.push([c.bottom, Math.min(c.top, neighbour.bottom)]);
      }
      for (const [y0, y1] of spans) {
        if (y1 - y0 <= 1e-6) continue;
        if (dx !== 0) {
          const x = dx > 0 ? x1 : x0;
          quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], [dx, 0, 0], c.shade);
        } else {
          const z = dz > 0 ? z1 : z0;
          quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, dz], c.shade);
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    quads,
  };
}

/**
 * THE STRUCTURES. A tower whose lower half already stands, a gate that follows
 * it, and a pavilion that is built only when the visitor reaches Julius. Order
 * inside each structure is layer by layer, walking the perimeter — it reads as
 * something being made, not as boxes appearing.
 */
export function planStructures(): { voxels: BuildVoxel[]; alreadyBuilt: number; structureStarts: number[] } {
  const voxels: BuildVoxel[] = [];
  const structureStarts: number[] = [];
  const V = BUILD_VOXEL;
  const base = PLATEAU_TOP + V / 2;

  // 0 — the tower: a hollow 4×4 perimeter, 22 layers, windows, a crenellated crown.
  structureStarts.push(voxels.length);
  const towerX = -1.75;
  const towerZ = -1.25;
  const perimeter: Array<[number, number]> = [
    [0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [0, 3], [0, 2], [0, 1],
  ];
  for (let layer = 0; layer < 22; layer += 1) {
    perimeter.forEach(([cx, cz], i) => {
      const middleOfSide = (cx === 1 || cx === 2) && (cz === 0 || cz === 3)
        || (cz === 1 || cz === 2) && (cx === 0 || cx === 3);
      if (layer % 5 === 3 && middleOfSide && i % 2 === 0) return;
      if (layer >= 20) {
        const corner = (cx === 0 || cx === 3) && (cz === 0 || cz === 3);
        if (layer === 21 && !corner) return;
      }
      voxels.push({
        x: towerX + (cx - 1.5) * V,
        y: base + layer * V,
        z: towerZ + (cz - 1.5) * V,
        structure: 0,
      });
    });
  }
  const alreadyBuilt = voxels.findIndex((v) => v.y >= base + 11 * V);

  // 1 — the gate: two pillars and a lintel, across the plateau from the tower.
  structureStarts.push(voxels.length);
  const gateZ = 2.25;
  for (let layer = 0; layer < 7; layer += 1) {
    for (const px of [1.25, 3.75]) {
      for (const dx of [0, 1]) {
        voxels.push({ x: px + (dx - 0.5) * V, y: base + layer * V, z: gateZ, structure: 1 });
      }
    }
  }
  for (let i = 0; i < 6; i += 1) {
    voxels.push({ x: 1.25 + i * V, y: base + 7 * V, z: gateZ, structure: 1 });
  }

  // 2 — the pavilion: walls with a doorway, a roof, a ridge. Built on arrival at Julius.
  structureStarts.push(voxels.length);
  const pavilionX = -3.4;
  const pavilionZ = 2.1;
  const W = 4;
  const D = 3;
  for (let layer = 0; layer < 6; layer += 1) {
    for (let cz = 0; cz < D; cz += 1) {
      for (let cx = 0; cx < W; cx += 1) {
        const wall = cx === 0 || cx === W - 1 || cz === 0 || cz === D - 1;
        const doorway = cx === W - 1 && cz === 1 && layer < 2;
        const include = layer < 4 ? wall && !doorway : layer === 4 ? true : cz === 1;
        if (!include) continue;
        voxels.push({
          x: pavilionX + (cx - (W - 1) / 2) * V,
          y: base + layer * V,
          z: pavilionZ + (cz - (D - 1) / 2) * V,
          structure: 2,
        });
      }
    }
  }

  return { voxels, alreadyBuilt, structureStarts };
}

/**
 * JULIUS, ABOVE THE TOWER'S CROWN — one governing core and, beneath it, three
 * permanent tier slots on a ring: Prompt Architect, Coding Agent, Independent
 * Reviewer. The slots are fixed positions in the world; what fills them may
 * change, which the scene shows by letting a slot's light go out and return
 * while its ring stays.
 */
export const JULIUS_CORE: readonly [number, number, number] = Object.freeze([-1.75, 15.1, -1.25]);
export const JULIUS_TIER_RING = Object.freeze({ y: 13.25, radius: 2.3 });
/** Clear of the crown's top face: the slots must never sit inside the tower. */
export const TOWER_CROWN_TOP = PLATEAU_TOP + BUILD_VOXEL * 22;

export function juliusTierSlots(): Array<readonly [number, number, number]> {
  return [0, 1, 2].map((i) => {
    // Spread evenly left, centre and right as seen from the Julius shot (the
    // scene holds this orientation while the world turns beneath it).
    const angle = (-98 + i * 120) * (Math.PI / 180);
    return [
      JULIUS_CORE[0] + Math.sin(angle) * JULIUS_TIER_RING.radius,
      JULIUS_TIER_RING.y,
      JULIUS_CORE[2] + Math.cos(angle) * JULIUS_TIER_RING.radius,
    ] as const;
  });
}

/**
 * PROJECT BRAIN, BENEATH THE WORLD — Julius's durable record as a stack of
 * plates on the same axis as the tower. Oldest at the bottom; each new record
 * lands on top, and nothing is ever removed. Part of the history is already
 * there on arrival, because a project's memory predates the visitor.
 */
export const GRID_Y = -26;
export const BRAIN = Object.freeze({
  x: -1.75,
  z: -1.25,
  /** Plate edge length, thickness and the gap between plates, in world units. */
  size: 4.5,
  thickness: 0.3,
  gap: 0.24,
  baseY: -23.2,
  /** One plate per entry of the illustrative record on the page. */
  entries: 9,
  alreadyWritten: 5,
});

export type BrainPlate = {
  /** Centre height of the plate. */
  readonly y: number;
  /** A short inscribed mark per side, as a fraction of the plate edge: the record's content, abstracted. */
  readonly marks: readonly [number, number, number, number];
};

export function planBrainRecord(): BrainPlate[] {
  const step = BRAIN.thickness + BRAIN.gap;
  return Array.from({ length: BRAIN.entries }, (_, i) => {
    const mark = (side: number) => 0.22 + hash(i, side, 9) * 0.46;
    return { y: BRAIN.baseY + i * step + BRAIN.thickness / 2, marks: [mark(0), mark(1), mark(2), mark(3)] };
  });
}

/** Where the island's underside is on the brain's axis: the top of the spine that carries records down. */
export function undersideAbove(x: number, z: number, columns: readonly Column[] = generateColumns()): number {
  const column = columns.find((c) => c.x === Math.round(x) && c.z === Math.round(z));
  return column ? column.bottom : 0;
}

/** Deterministic hovering presences: people are cream, agents are lavender, Julius is the governing core. */
export type Presence = {
  readonly position: readonly [number, number, number];
  readonly kind: 'person' | 'agent' | 'julius';
  readonly phase: number;
};

export const PRESENCES: readonly Presence[] = Object.freeze([
  { position: [3.6, 3.4, 0.2], kind: 'person', phase: 0.3 },
  { position: [-6.2, 4.6, 3.4], kind: 'person', phase: 2.1 },
  { position: [6.4, 5.2, -4.6], kind: 'person', phase: 4.0 },
  // Signals from people and agents converge on Julius.
  { position: JULIUS_CORE, kind: 'julius', phase: 1.2 },
  { position: [-7.4, 8.4, -5.2], kind: 'agent', phase: 3.3 },
  { position: [2.4, 9.6, 3.6], kind: 'agent', phase: 5.1 },
  { position: [8.2, 7.4, 3.2], kind: 'agent', phase: 0.9 },
]);

/** Signals between presences — collaboration drawn as light. [from, to] indices. */
export const SIGNAL_LINKS: ReadonlyArray<readonly [number, number]> = Object.freeze([
  [0, 3], [3, 4], [5, 6], [1, 5], [6, 2], [4, 1],
]);

export function arcBetween(a: readonly [number, number, number], b: readonly [number, number, number]): THREE.QuadraticBezierCurve3 {
  const start = new THREE.Vector3(a[0], a[1], a[2]);
  const end = new THREE.Vector3(b[0], b[1], b[2]);
  const mid = start.clone().lerp(end, 0.5);
  mid.y += 2.2 + start.distanceTo(end) * 0.22;
  return new THREE.QuadraticBezierCurve3(start, mid, end);
}
