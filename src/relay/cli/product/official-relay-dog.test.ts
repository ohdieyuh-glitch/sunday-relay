import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { CliCaps, DogStateVM } from './contracts';
import { DOG_STATES, MOVING_DOG_STATES } from './contracts';
import {
  OFFICIAL_DOG_COLUMNS,
  OFFICIAL_DOG_ROWS,
  OFFICIAL_DOG_SCALE,
  canonicalStateName,
  footerDog,
  headerLogo,
  headerLogoWidth,
  officialDogRows,
} from './dog';
import {
  OFFICIAL_RELAY_DOG_ASPECT,
  OFFICIAL_RELAY_DOG_HEIGHT,
  OFFICIAL_RELAY_DOG_PALETTE,
  OFFICIAL_RELAY_DOG_POSES,
  OFFICIAL_RELAY_DOG_POSE_NAMES,
  OFFICIAL_RELAY_DOG_TERMINAL_TONE,
  OFFICIAL_RELAY_DOG_WIDTH,
} from './official-relay-dog-sprite';
import {
  OFFICIAL_RELAY_DOG_ACTIVITIES,
  OFFICIAL_RELAY_DOG_STATE_PRESENTATION,
  officialRelayDogViewForState,
  projectOfficialRelayDogActivity,
} from './official-relay-dog-states';
import {
  OFFICIAL_RELAY_DOG_ASSET_CHECKSUMS,
  OFFICIAL_RELAY_DOG_ASSET_NAMES,
  RETIRED_SIDE_PROFILE_DOG_MARKERS,
} from './official-relay-dog-parity';
import { renderHeader } from './renderer';
import { visibleLength } from './layout';

/**
 * OFFICIAL RELAY DOG — CLI parity suite.
 *
 * Proves the terminal draws the ONE official Relay Dog: the shared sprite is
 * byte-identical to the website's copy (checksums), the retired side-profile
 * dog is gone from every code path including the reduced-capability fallback,
 * the proportions are never stretched, and every state means on the terminal
 * exactly what it means on the website.
 */

const productDir = join(process.cwd(), 'src', 'relay', 'cli', 'product');

function caps(overrides: Partial<CliCaps> = {}): CliCaps {
  return {
    tty: true, color: true, unicode: true, width: 130,
    reducedMotion: false, plain: false, json: false, ...overrides,
  };
}

const strip = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

/* ------------------------- canonical asset ---------------------------- */

describe('official Relay Dog — canonical shared asset', () => {
  it('the CLI copy of every shared module matches the cross-surface checksum', () => {
    for (const name of OFFICIAL_RELAY_DOG_ASSET_NAMES) {
      const bytes = readFileSync(join(productDir, name));
      const digest = createHash('sha256').update(bytes).digest('hex');
      expect(digest, `${name} diverged from the shared official Relay Dog asset`)
        .toBe(OFFICIAL_RELAY_DOG_ASSET_CHECKSUMS[name]);
    }
  });

  it('the sprite is the 18x14 front-facing voxel dog with visor and amber eyes', () => {
    for (const pose of OFFICIAL_RELAY_DOG_POSE_NAMES) {
      const grid = OFFICIAL_RELAY_DOG_POSES[pose];
      expect(grid.length, `${pose} height`).toBe(OFFICIAL_RELAY_DOG_HEIGHT);
      for (const row of grid) {
        expect(row.length, `${pose} row width`).toBe(OFFICIAL_RELAY_DOG_WIDTH);
        expect(/^[.wsdyc]+$/.test(row), `${pose} row legend`).toBe(true);
      }
    }
    // The dark visor band exists, and the amber eyes sit INSIDE it.
    const head = OFFICIAL_RELAY_DOG_POSES.standing;
    expect(head[3]).toContain('dddddd');
    expect(head[4]).toMatch(/d[y]{2}d[y]{2}/);
    // Two upright ears above the skull.
    expect(head[0]).toContain('ww..ww');
    // Cream/bone body, dark charcoal visor, amber eye.
    expect(OFFICIAL_RELAY_DOG_PALETTE.w).toBe('#ece9e2');
    expect(OFFICIAL_RELAY_DOG_PALETTE.d).toBe('#23262e');
    expect(OFFICIAL_RELAY_DOG_PALETTE.y).toBe('#f2c14e');
  });

  it('carries no element of the reference screenshot around the dog', () => {
    const source = readFileSync(join(productDir, 'official-relay-dog-sprite.ts'), 'utf8');
    for (const foreign of ['Hermes', 'APPROVED', 'Approved', 'REVIEWER', 'data:image', 'base64']) {
      expect(source, `sprite imported "${foreign}" from the screenshot`).not.toContain(foreign);
    }
  });
});

/* --------------------------- retired dog ------------------------------ */

describe('the retired side-profile dog is gone', () => {
  it('no product source defines the old side-facing grids or ASCII dog', () => {
    const dogSource = readFileSync(join(productDir, 'dog.ts'), 'utf8');
    for (const marker of RETIRED_SIDE_PROFILE_DOG_MARKERS) {
      expect(dogSource.includes(`const ${marker}`), `dog.ts still defines ${marker}`).toBe(false);
    }
    // The retired ASCII silhouette cannot be produced by any capability path.
    for (const c of [caps(), caps({ color: false }), caps({ unicode: false }),
      caps({ color: false, unicode: false }), caps({ width: 62 }), caps({ tty: false })]) {
      const raw = headerLogo(c).join('\n');
      expect(raw).not.toContain('/o \\___');
      expect(raw).not.toContain('\\______\\');
      expect(strip(raw)).not.toContain('||   ||');
    }
  });

  it('exactly one dog renders in a header — no duplicate mascot', () => {
    // The amber eyes appear ONLY inside the visor band, so counting the eye
    // color is an exact census of how many official dogs were drawn.
    const eye = `38;5;${OFFICIAL_RELAY_DOG_TERMINAL_TONE.y}`;
    const count = (text: string): number => text.split(eye).length - 1;
    const eyesInOneDog = count(headerLogo(caps()).join('\n'));
    expect(eyesInOneDog).toBeGreaterThan(0);
    for (const demo of [false, true]) {
      const header = renderHeader({ caps: caps(), route: 'RLY / 001', workforce: null, demo });
      expect(count(header.join('\n')), `demo=${demo}: more than one dog drawn`).toBe(eyesInOneDog);
    }
  });
});

/* --------------------------- proportions ------------------------------ */

describe('official Relay Dog — proportions and sharpness', () => {
  it('uses ONE uniform scale factor on both axes (never stretched)', () => {
    expect(OFFICIAL_DOG_SCALE).toBe(1);
    // Half-block folding: 18 columns wide, 14/2 = 7 rows tall. One sprite pixel
    // is one column by half a cell — square on a normal 1:2 terminal cell, so
    // the rendered aspect equals the sprite's aspect.
    expect(OFFICIAL_DOG_COLUMNS).toBe(OFFICIAL_RELAY_DOG_WIDTH * OFFICIAL_DOG_SCALE);
    expect(OFFICIAL_DOG_ROWS).toBe((OFFICIAL_RELAY_DOG_HEIGHT * OFFICIAL_DOG_SCALE) / 2);
    expect(OFFICIAL_DOG_COLUMNS / (OFFICIAL_DOG_ROWS * 2)).toBeCloseTo(OFFICIAL_RELAY_DOG_ASPECT, 10);
  });

  it('every pose renders at identical proportions in every capability mode', () => {
    for (const pose of OFFICIAL_RELAY_DOG_POSE_NAMES) {
      for (const c of [caps(), caps({ color: false, unicode: false })]) {
        const rows = officialDogRows(pose, c);
        expect(rows.length, `${pose} rows`).toBe(OFFICIAL_DOG_ROWS);
        for (const row of rows) {
          expect(visibleLength(row), `${pose} row width`).toBeLessThanOrEqual(OFFICIAL_DOG_COLUMNS);
        }
      }
    }
  });

  it('stays inside the header and never overlaps the wordmark at any width', () => {
    for (const width of [200, 130, 100, 90, 79, 62, 55, 40]) {
      const c = caps({ width });
      // demo:false isolates the dog — the OFFLINE DEMO disclosure banner is a
      // fixed-length pre-existing line with its own width behavior.
      const header = renderHeader({ caps: c, route: 'RLY / 001', workforce: null, demo: false });
      for (const line of header) {
        expect(visibleLength(line), `header line @ ${width}`).toBeLessThanOrEqual(width);
      }
      // Desktop and mobile both keep the dog inside its reserved column.
      const reserved = headerLogoWidth(c);
      if (reserved > 0) {
        for (const row of headerLogo(c)) {
          expect(visibleLength(row), `logo row @ ${width}`).toBeLessThanOrEqual(reserved);
        }
      }
    }
  });

  it('paints hard pixel edges only — half-blocks, no smoothing glyphs', () => {
    const raw = headerLogo(caps()).join('');
    expect(raw).toContain('▀');
    // Shading/gradient glyphs would blur the voxel edges.
    for (const soft of ['░', '▒', '▓', '·', '∙']) expect(raw).not.toContain(soft);
  });

  it('keeps the sprite transparent — empty pixels are never painted', () => {
    // The top-left corner of every pose is empty and must stay unpainted.
    for (const pose of OFFICIAL_RELAY_DOG_POSE_NAMES) {
      const rows = officialDogRows(pose, caps());
      expect(rows[0].startsWith(' ')).toBe(true);
    }
  });
});

/* ---------------------------- state parity ---------------------------- */

describe('official Relay Dog — state parity with the website', () => {
  it('every CLI state maps to a canonical activity and pose', () => {
    for (const state of DOG_STATES) {
      const canonical = canonicalStateName(state);
      expect(OFFICIAL_RELAY_DOG_STATE_PRESENTATION[
        canonical as keyof typeof OFFICIAL_RELAY_DOG_STATE_PRESENTATION
      ], `${state} has no canonical presentation`).toBeDefined();
      const activity = projectOfficialRelayDogActivity(canonical);
      expect(OFFICIAL_RELAY_DOG_ACTIVITIES).toContain(activity);
    }
  });

  it('IMPLEMENTING is the coding pose (paws forward on the keys)', () => {
    const dog = footerDog({ state: 'IMPLEMENTING', tick: 1, caps: caps() });
    expect(dog.activity).toBe('implementing');
    expect(dog.pose).toBe('coding');
    expect(dog.motion).toBe('code_progression');
    expect(dog.label).toContain('IMPLEMENTING');
    // The scratch alternates frame to frame; the dog does not cross the track.
    const a = footerDog({ state: 'IMPLEMENTING', tick: 0, caps: caps() });
    const b = footerDog({ state: 'IMPLEMENTING', tick: 1, caps: caps() });
    expect(a.track).not.toBe(b.track);
    expect(a.moving).toBe(false);
    expect(b.moving).toBe(false);
  });

  it('WAITING FOR USER jumps for attention and always says so in text', () => {
    const a = footerDog({ state: 'WAITING FOR USER', tick: 0, caps: caps() });
    const b = footerDog({ state: 'WAITING FOR USER', tick: 1, caps: caps() });
    expect(a.motion).toBe('attention_jump');
    expect(a.attention).toBe(true);
    expect(a.track).not.toBe(b.track);           // the hop
    expect(a.label).toContain('WAITING FOR USER');
    // Urgency survives reduced motion, no color, and no Unicode.
    const reduced = footerDog({
      state: 'WAITING FOR USER', tick: 3,
      caps: caps({ reducedMotion: true, color: false, unicode: false }),
    });
    expect(reduced.attention).toBe(true);
    expect(reduced.track).toContain('!');
    expect(reduced.label).toContain('WAITING FOR USER');
  });

  it('IDLE patrols; THINKING stops the patrol', () => {
    expect(footerDog({ state: 'WANDERING', tick: 2, caps: caps() }).motion).toBe('patrol');
    expect(footerDog({ state: 'WANDERING', tick: 2, caps: caps() }).moving).toBe(true);
    const thinking = footerDog({ state: 'TROTTING', tick: 2, caps: caps() });
    expect(thinking.activity).toBe('thinking');
    expect(thinking.motion).toBe('still');
    expect(thinking.moving).toBe(false);
    expect(MOVING_DOG_STATES).toContain('WANDERING');
    expect(MOVING_DOG_STATES).not.toContain('TROTTING');
  });

  it('RESEARCHING is unchanged; REVIEWING now snoozes', () => {
    // RESEARCHING must be untouched by the operational-animation change.
    const research = footerDog({ state: 'RESEARCHING', tick: 1, caps: caps() });
    expect(research.activity).toBe('researching');
    expect(research.motion).toBe('scan');
    expect(research.pose).toBe('sitting');
    // REVIEWING sleeps — and still never reads as an approval.
    const review = footerDog({ state: 'REVIEWING', tick: 1, caps: caps() });
    expect(review.activity).toBe('reviewing');
    expect(review.pose).toBe('sleeping');
    expect(review.motion).toBe('sleep');
    expect(review.moving).toBe(false);
    expect(review.label).toContain('REVIEWING');
    expect(review.label).not.toContain('APPROVED');
    expect(review.label).not.toContain('VERIFIED');
  });

  it('handoff, verification, complete and stopped-safely are preserved; repair digs', () => {
    const expected: Array<[DogStateVM, string, string]> = [
      ['CARRYING HANDOFF', 'handoff', 'carrying'],
      ['VERIFYING', 'verifying', 'standing'],
      ['REPAIRING', 'repairing', 'digging'],
      ['COMPLETE', 'complete', 'sitting'],
      ['STOPPED SAFELY', 'complete', 'lying'],
    ];
    for (const [state, activity, pose] of expected) {
      const dog = footerDog({ state, tick: 1, caps: caps() });
      expect(dog.activity, state).toBe(activity);
      expect(dog.pose, state).toBe(pose);
    }
  });

  it('reduced motion, non-TTY and plain modes render the static frame', () => {
    for (const c of [caps({ reducedMotion: true }), caps({ tty: false }), caps({ plain: true, reducedMotion: true })]) {
      for (const state of DOG_STATES) {
        const a = footerDog({ state, tick: 0, caps: c });
        const b = footerDog({ state, tick: 7, caps: c });
        expect(a.track, `${state} animated under reduced motion`).toBe(b.track);
        expect(a.moving).toBe(false);
      }
    }
  });

  it('the state label is the same word the website shows', () => {
    for (const state of DOG_STATES) {
      const view = officialRelayDogViewForState(canonicalStateName(state));
      const presentation = OFFICIAL_RELAY_DOG_STATE_PRESENTATION[
        canonicalStateName(state) as keyof typeof OFFICIAL_RELAY_DOG_STATE_PRESENTATION
      ];
      expect(view.label).toBe(presentation.label);
      expect(footerDog({ state, tick: 0, caps: caps() }).label).toBe(`RELAY DOG · ${presentation.label}`);
    }
  });

  it('the track never overruns its width for any state or tick', () => {
    for (const trackWidth of [18, 8, 6]) {
      for (const state of DOG_STATES) {
        for (let tick = 0; tick < 40; tick += 1) {
          const dog = footerDog({ state, tick, caps: caps(), trackWidth });
          expect(visibleLength(dog.track), `${state} @ tick ${tick}/${trackWidth}`)
            .toBeLessThanOrEqual(Math.max(trackWidth, dog.track.trimEnd().length));
          expect(dog.track.trimEnd().length).toBeLessThanOrEqual(trackWidth + 1);
        }
      }
    }
  });
});
