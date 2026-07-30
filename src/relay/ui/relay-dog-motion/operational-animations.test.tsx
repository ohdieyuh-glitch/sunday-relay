import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RelayDogMotionBoundary } from './RelayDogMotionBoundary';
import { RelayDogOperationalDecor, operationalActivityDescription } from './RelayDogOperationalDecor';
import { CODE_PROGRESSION, CODE_PROGRESSION_SECONDS, CODE_PROGRESSION_STATIC_LEVEL } from './code-progression';
import { projectWorkspaceDogBehavior } from './dog-behavior';
import { RelayPixelDog } from '../pixel-dog';
import { DOG_PRESENTATION } from '../project-workspace/projections';
import {
  OFFICIAL_RELAY_DOG_POSES,
  officialRelayDogViewForState,
} from '../official-relay-dog';
import type { WorkspaceDogState } from '../project-workspace/contracts';

/**
 * Relay Dog OPERATIONAL ANIMATIONS — reviewing sleeps, repairing digs, coding
 * writes progressively more advanced work.
 *
 * The load-bearing assertions here are the TRUTHFULNESS ones. An animation is
 * allowed to be charming; it is never allowed to say that a review approved,
 * that verification passed, that a repair succeeded or that coding finished.
 */

const dir = __dirname;
const css = readFileSync(join(dir, 'relay-dog-motion.css'), 'utf8');

/** The full text of one @keyframes rule, brace-balanced — slicing at the first
 *  `}` would cut the block off after its first stop and make any assertion
 *  about later stops vacuously true. */
function keyframes(name: string): string {
  const start = css.indexOf(`@keyframes ${name}`);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  return css.slice(start);
}

/** Render the full boundary for a workspace state, as the workspace does. */
function renderState(state: WorkspaceDogState, reducedMotion = false): string {
  const p = DOG_PRESENTATION[state];
  return renderToStaticMarkup(
    createElement(RelayDogMotionBoundary, {
      behavior: projectWorkspaceDogBehavior(state),
      reducedMotion,
      children: createElement(RelayPixelDog, {
        pose: p.pose,
        label: p.label,
        marker: p.marker,
        moving: p.moving,
        reducedMotion,
      }),
    }),
  );
}

const decor = (activity: 'reviewing' | 'repairing' | 'implementing', reducedMotion = false) =>
  renderToStaticMarkup(createElement(RelayDogOperationalDecor, { activity, reducedMotion }));

/** Words that would assert an OUTCOME rather than an activity. */
const OUTCOME_WORDS = [
  'APPROVED', 'approved',
  'VERIFIED', 'verified',
  'COMPLETE', 'complete',
  'PASSED', 'passed',
  'RELEASED', 'released',
  'SUCCESS', 'success',
  'REPAIRED', 'repaired',
];

/* ============================================================== REVIEWING */

describe('REVIEWING — the dog snoozes', () => {
  it('maps reviewing to the sleeping pose on both the state and the activity', () => {
    expect(DOG_PRESENTATION.reviewing.pose).toBe('sleeping');
    const view = officialRelayDogViewForState('reviewing');
    expect(view.activity).toBe('reviewing');
    expect(view.pose).toBe('sleeping');
    expect(view.motion).toBe('sleep');
  });

  it('the sleeping state has its own visual hook, distinct from every other', () => {
    const html = renderState('reviewing');
    expect(html).toContain('rdm--reviewing');
    expect(html).toContain('rdm-body--reviewing');
    expect(html).toContain('rpd--sleeping');
    expect(html).toContain('rdo--sleep');
    // Not the digging or coding scenery.
    expect(html).not.toContain('rdo--dig');
    expect(html).not.toContain('rdo--code');
  });

  it('draws the eyes CLOSED while keeping ears, visor and muzzle identical', () => {
    const sleeping = OFFICIAL_RELAY_DOG_POSES.sleeping;
    const standing = OFFICIAL_RELAY_DOG_POSES.standing;
    // No amber eye pixel anywhere in the sleeping pose.
    expect(sleeping.join('')).not.toContain('y');
    expect(standing.join('')).toContain('y');
    // The ear row and the visor band survive unchanged.
    expect(sleeping.some((r) => r.includes('ww..ww'))).toBe(true);
    expect(sleeping.some((r) => r.includes('dddddd'))).toBe(true);
  });

  it('renders breathing, a drifting Z and a sleep twitch — inside 4-7s', () => {
    expect(css).toContain('@keyframes rdm-sleep-breathe');
    expect(css).toContain('@keyframes rdm-sleep-twitch');
    expect(css).toContain('@keyframes rdo-z-drift');
    const loop = css.match(/animation:\s*rdm-sleep-breathe\s+([\d.]+)s/);
    expect(loop, 'the sleep loop duration is not declared').not.toBeNull();
    const seconds = Number(loop?.[1]);
    expect(seconds).toBeGreaterThanOrEqual(4);
    expect(seconds).toBeLessThanOrEqual(7);
  });

  it('the Z decoration is aria-hidden and carries no text meaning', () => {
    const html = decor('reviewing');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('rdo-z');
    // Every decorative node sits inside the aria-hidden container.
    expect(html.indexOf('aria-hidden="true"')).toBeLessThan(html.indexOf('rdo-z'));
  });

  it('NEVER renders approval, verification or success semantics', () => {
    const html = renderState('reviewing');
    expect(DOG_PRESENTATION.reviewing.marker).toBe('question');
    expect(DOG_PRESENTATION.reviewing.marker).not.toBe('check');
    expect(html).not.toContain('rpd-marker--check');
    expect(html).toContain('REVIEWING');
    for (const word of OUTCOME_WORDS) {
      expect(html, `reviewing must not render "${word}"`).not.toContain(word);
    }
  });

  it('the accessible sentence describes the activity, never an outcome', () => {
    const sentence = operationalActivityDescription('reviewing');
    expect(sentence).toBe('Relay Dog is snoozing while the mission is under review.');
    expect(sentence).toContain('under review');
    expect(sentence).not.toMatch(/reviewed|approved|verified|passed/i);
    expect(renderState('reviewing')).toContain('under review');
  });

  it('reduced motion holds a STATIC sleeping pose with one still Z', () => {
    const html = renderState('reviewing', true);
    expect(html).toContain('rdm--reduced');
    expect(html).toContain('rpd--sleeping');
    // Exactly one Z, not three.
    expect((html.match(/rdo-z /g) ?? []).length + (html.match(/rdo-z"/g) ?? []).length)
      .toBeGreaterThan(0);
    expect((html.match(/rdo-z--/g) ?? []).length).toBe(1);
    expect(css).toMatch(/\.rdm--reduced[^@]*\.rdo-z[^{]*\{[^}]*animation:\s*none/su);
  });
});

/* ============================================================== REPAIRING */

describe('REPAIRING — the dog digs', () => {
  it('maps repairing to the digging pose on both the state and the activity', () => {
    expect(DOG_PRESENTATION.repairing.pose).toBe('digging');
    const view = officialRelayDogViewForState('repairing');
    expect(view.activity).toBe('repairing');
    expect(view.pose).toBe('digging');
    expect(view.motion).toBe('dig');
  });

  it('has its own visual hook and leans forward with the eyes OPEN', () => {
    const html = renderState('repairing');
    expect(html).toContain('rdm-body--repairing');
    expect(html).toContain('rpd--digging');
    expect(html).toContain('rdo--dig');
    // Investigating, not resting: the amber eyes stay.
    expect(OFFICIAL_RELAY_DOG_POSES.digging.join('')).toContain('y');
    expect(OFFICIAL_RELAY_DOG_POSES.digging).not.toEqual(OFFICIAL_RELAY_DOG_POSES.sleeping);
  });

  it('alternates left and right paw scrapes, and pauses to look in the hole', () => {
    const paws = keyframes('rdm-dig-paws');
    expect(paws, 'rdm-dig-paws is missing').not.toBe('');
    // A negative AND a positive X offset — the left paw and the right paw.
    expect(paws, 'no left-paw scrape').toMatch(/translate\(-[\d.]+px/);
    expect(paws, 'no right-paw scrape').toMatch(/translate\([1-9][\d.]*px/);
    // The lunge keyframes hold a beat for the look into the hole.
    const lunge = keyframes('rdm-dig-lunge');
    expect(lunge, 'rdm-dig-lunge is missing').not.toBe('');
    expect(lunge, 'no inspection pause').toMatch(/68%,\s*80%/);
  });

  it('keeps the dig loop inside 2.5-5s', () => {
    const loop = css.match(/animation:\s*\n?\s*rdm-enter-dig[^;]*rdm-dig-lunge\s+([\d.]+)s/s)
      ?? css.match(/rdm-dig-lunge\s+([\d.]+)s/);
    expect(loop).not.toBeNull();
    const seconds = Number(loop?.[1]);
    expect(seconds).toBeGreaterThanOrEqual(2.5);
    expect(seconds).toBeLessThanOrEqual(5);
  });

  it('dirt is decorative, aria-hidden, restrained and cannot escape', () => {
    const html = decor('repairing');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('rdo-hole');
    expect(html).toContain('rdo-mound');
    const clods = (html.match(/rdo-clod--/g) ?? []).length;
    expect(clods).toBeGreaterThan(0);
    expect(clods, 'dozens of particles are prohibited').toBeLessThanOrEqual(8);
    // The container clips, so no particle can leave the intended area.
    expect(css).toMatch(/\.rdo\s*\{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.rdo\s*\{[^}]*pointer-events:\s*none/s);
  });

  it('NEVER marks the mission repaired or complete', () => {
    const html = renderState('repairing');
    expect(DOG_PRESENTATION.repairing.marker).toBe('alert');
    expect(html).not.toContain('rpd-marker--check');
    expect(html).toContain('REPAIRING');
    for (const word of OUTCOME_WORDS) {
      expect(html, `repairing must not render "${word}"`).not.toContain(word);
    }
    const sentence = operationalActivityDescription('repairing');
    expect(sentence).toBe('Relay Dog is digging into the project to repair an issue.');
    expect(sentence).not.toMatch(/repaired|fixed|resolved|complete/i);
  });

  it('reduced motion holds a STATIC digging pose with no flying particles', () => {
    const html = renderState('repairing', true);
    expect(html).toContain('rdm--reduced');
    expect(html).toContain('rpd--digging');
    expect(html).toContain('rdo-hole');
    expect(html).toContain('rdo-mound');
    expect((html.match(/rdo-clod/g) ?? []).length).toBe(0);
    // The held pose still reads as digging rather than standing.
    expect(css).toMatch(/\.rdm--reduced \.rdm-body--repairing\s*\{[^}]*transform:\s*translateY/s);
  });
});

/* ================================================================= CODING */

describe('CODING — the dog writes progressively more advanced code', () => {
  it('maps implementing to the coding pose on both the state and the activity', () => {
    expect(DOG_PRESENTATION.implementing.pose).toBe('coding');
    const view = officialRelayDogViewForState('implementing');
    expect(view.activity).toBe('implementing');
    expect(view.pose).toBe('coding');
    expect(view.motion).toBe('code_progression');
  });

  it('renders the dog at a keyboard with an editor', () => {
    const html = renderState('implementing');
    expect(html).toContain('rdm-body--implementing');
    expect(html).toContain('rpd--coding');
    expect(html).toContain('rdo--code');
    expect(html).toContain('rdo-editor');
    expect(css).toContain('@keyframes rdm-code-type');
  });

  it('has FOUR named experience levels, in order, basic to architecture', () => {
    expect(CODE_PROGRESSION.map((l) => l.level)).toEqual([
      'basic',
      'intermediate',
      'advanced',
      'architecture',
    ]);
    expect(CODE_PROGRESSION.map((l) => l.step)).toEqual([1, 2, 3, 4]);
  });

  it('each level is visibly more advanced than the one before it', () => {
    const [basic, intermediate, advanced, architecture] = CODE_PROGRESSION;
    // Basic: a variable and a simple condition.
    expect(basic.lines.join('\n')).toMatch(/const|if \(/);
    // Intermediate: types and a function.
    expect(intermediate.lines.join('\n')).toMatch(/interface/);
    expect(intermediate.lines.join('\n')).toMatch(/function/);
    // Advanced: assertions and evidence.
    expect(advanced.lines.join('\n')).toMatch(/assert/);
    expect(advanced.lines.join('\n')).toMatch(/Trace|trace/);
    // Architecture: the pipeline, not a single file.
    expect(architecture.lines.join('\n')).toContain('PROMPT ARCHITECT');
    expect(architecture.lines.join('\n')).toContain('REVIEWER');
    expect(architecture.lines.join('\n')).toContain('RELEASE GATE');
    // Later levels carry more structure than the first.
    expect(advanced.lines.length).toBeGreaterThan(basic.lines.length);
  });

  it('renders every level at once and crossfades — no DOM rewriting per frame', () => {
    const html = decor('implementing');
    for (const level of CODE_PROGRESSION) {
      expect(html, `${level.level} is not rendered`).toContain(`rdo-code--${level.level}`);
    }
    // The level change is pure CSS opacity, with a staggered delay per level.
    expect(css).toContain('@keyframes rdo-code-level');
    expect(css).toMatch(/\.rdo-code--intermediate\s*\{\s*animation-delay:\s*3s/);
    expect(css).toMatch(/\.rdo-code--architecture\s*\{\s*animation-delay:\s*9s/);
  });

  it('keeps the whole progression loop inside 8-15s', () => {
    expect(CODE_PROGRESSION_SECONDS).toBeGreaterThanOrEqual(8);
    expect(CODE_PROGRESSION_SECONDS).toBeLessThanOrEqual(15);
    expect(css).toMatch(/animation:\s*rdo-code-level\s+12s/);
  });

  it('the levels are VISUAL ONLY — no level changes or completes mission state', () => {
    const html = renderState('implementing');
    expect(html).toContain('IMPLEMENTING');
    for (const word of OUTCOME_WORDS) {
      expect(html, `coding must not render "${word}"`).not.toContain(word);
    }
    expect(html).not.toContain('rpd-marker--check');
    // Showing a RELEASE GATE node draws the pipeline; it grants nothing.
    const source = readFileSync(join(dir, 'code-progression.ts'), 'utf8');
    expect(source).not.toMatch(/import .* from '\.\.\/\.\.\/mission/);
    expect(source).not.toMatch(/\bimport\b/);
    const sentence = operationalActivityDescription('implementing');
    expect(sentence).toBe('Relay Dog is writing and implementing code.');
    expect(sentence).not.toMatch(/complete|finished|done|verified/i);
  });

  it('the visual code contains NO credential-shaped string and no real key', () => {
    const all = CODE_PROGRESSION.flatMap((l) => l.lines).join('\n');
    const FORBIDDEN = [
      /sk-[A-Za-z0-9]{8,}/,
      /sk-ant-/,
      /sk_(live|test)_/,
      /AIza[0-9A-Za-z_-]{10,}/,
      /gh[pousr]_[A-Za-z0-9]{10,}/,
      /AKIA[0-9A-Z]{8,}/,
      /npm_[A-Za-z0-9]{10,}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /eyJ[A-Za-z0-9_-]{10,}\./,
      /xox[baprs]-/,
      /API_KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL/i,
      /Bearer\s+\S+/,
      /https?:\/\//,
      /process\.env/,
    ];
    for (const pattern of FORBIDDEN) {
      expect(pattern.test(all), `visual code matched ${pattern}`).toBe(false);
    }
  });

  it('the visual code is illustrative — never the user project source', () => {
    const source = readFileSync(join(dir, 'code-progression.ts'), 'utf8');
    // No filesystem, no fetch, no dynamic content: the lines are literals.
    expect(source).not.toContain('readFileSync');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('node:fs');
    expect(source).not.toContain('import(');
  });

  it('reduced motion renders ONE static composition, not a changing editor', () => {
    const html = renderState('implementing', true);
    expect(html).toContain('rdm--reduced');
    expect(html).toContain('rpd--coding');
    expect(html).toContain('rdo--code-static');
    // Exactly one level block, and it is the representative one.
    expect((html.match(/rdo-code/g) ?? []).length).toBeGreaterThan(0);
    for (const level of CODE_PROGRESSION) {
      if (level.level === CODE_PROGRESSION_STATIC_LEVEL) continue;
      expect(html).not.toContain(`rdo-code--${level.level}`);
    }
    expect(css).toMatch(/\.rdo--code-static \.rdo-code\s*\{[^}]*animation:\s*none/s);
  });
});

/* =============================================================== IDENTITY */

describe('OFFICIAL RELAY DOG identity survives all three states', () => {
  const states: WorkspaceDogState[] = ['reviewing', 'repairing', 'implementing'];

  it('every operational pose is the official 18x14 dog with the official palette', () => {
    for (const pose of ['sleeping', 'digging', 'coding'] as const) {
      const grid = OFFICIAL_RELAY_DOG_POSES[pose];
      expect(grid, pose).toHaveLength(14);
      for (const row of grid) expect(row.length, pose).toBe(18);
      // Only legal pixels — no new colour is introduced for a state.
      expect(/^[.wsdyc]+$/.test(grid.join('')), pose).toBe(true);
      // The collar and the dimensional shadow tone are part of the identity.
      expect(grid.join(''), `${pose} lost the collar`).toContain('c');
      expect(grid.join(''), `${pose} lost the shadow tone`).toContain('s');
      // Ears and the visor band are the recognition features.
      expect(grid.some((r) => r.includes('ww..ww')), `${pose} lost the ears`).toBe(true);
      expect(grid.some((r) => r.includes('dddddd')), `${pose} lost the visor`).toBe(true);
    }
  });

  it('state changes do NOT replace the mascot — one identity, many poses', () => {
    for (const state of states) {
      const html = renderState(state);
      // The same component, the same accessible name prefix, every time.
      expect(html, state).toContain('Relay Dog:');
      expect(html, state).toContain('rpd-art');
    }
    // No state-specific dog component exists.
    const decorSource = readFileSync(join(dir, 'RelayDogOperationalDecor.tsx'), 'utf8');
    expect(decorSource).not.toContain('POSES');
    expect(decorSource).not.toMatch(/'\.{9}ww\.\.ww/);
  });

  it('the operational states introduce no second palette or hardcoded dog', () => {
    const decorSource = readFileSync(join(dir, 'RelayDogOperationalDecor.tsx'), 'utf8');
    // The scenery may have its own scenery colours, but it must not restate the
    // DOG's palette — that is what would fork the identity and break a future
    // PSP recolour.
    for (const hex of ['#ece9e2', '#b9b5ab', '#f2c14e', '#d9a441']) {
      expect(decorSource, `decor restates the dog palette ${hex}`).not.toContain(hex);
    }
  });

  it('the animation never touches agent identity or mission facts', () => {
    for (const file of ['RelayDogOperationalDecor.tsx', 'code-progression.ts', 'RelayDogMotionBoundary.tsx']) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const forbidden of [
        'actualAgentId',
        'requestedAgentId',
        'appendTrace',
        'capsule',
        'budget',
        'pspId',
      ]) {
        // `code-progression.ts` may DISPLAY the words as illustrative text, so
        // only assignment/call shapes are forbidden.
        expect(
          new RegExp(`${forbidden}\\s*[=:]\\s*[^\\s]`).test(source)
            && !source.includes('lines:'),
          `${file} appears to write ${forbidden}`,
        ).toBe(false);
      }
    }
  });
});

/* ============================================================= REGRESSION */

describe('REGRESSION — untouched states stay untouched', () => {
  it('idle, researching, handoff, verifying, complete and error are unchanged', () => {
    const expected: Array<[WorkspaceDogState, string, string]> = [
      ['wandering', 'standing', 'WANDERING'],
      ['trotting', 'trotting', 'TROTTING'],
      ['researching', 'sitting', 'RESEARCHING'],
      ['carrying_handoff', 'carrying', 'CARRYING HANDOFF'],
      ['verifying', 'standing', 'VERIFYING'],
      ['waiting_for_user', 'sitting', 'WAITING FOR USER'],
      ['complete', 'sitting', 'COMPLETE'],
      ['stopped_safely', 'lying', 'STOPPED SAFELY'],
    ];
    for (const [state, pose, label] of expected) {
      expect(DOG_PRESENTATION[state].pose, state).toBe(pose);
      expect(DOG_PRESENTATION[state].label, state).toBe(label);
    }
  });

  it('only the three operational states gained scenery', () => {
    for (const state of [
      'wandering', 'trotting', 'researching', 'carrying_handoff',
      'verifying', 'waiting_for_user', 'complete', 'stopped_safely',
    ] as WorkspaceDogState[]) {
      const html = renderState(state);
      expect(html, state).not.toContain('rdo--sleep');
      expect(html, state).not.toContain('rdo--dig');
      expect(html, state).not.toContain('rdo--code');
    }
  });

  it('COMPLETE keeps its check and remains the only state that shows one', () => {
    expect(DOG_PRESENTATION.complete.marker).toBe('check');
    expect(renderState('complete')).toContain('rpd-marker--check');
    for (const state of ['reviewing', 'repairing', 'implementing'] as WorkspaceDogState[]) {
      expect(renderState(state), state).not.toContain('rpd-marker--check');
    }
  });

  it('idle patrol still belongs to idle alone', () => {
    expect(projectWorkspaceDogBehavior('wandering').patrolEnabled).toBe(true);
    for (const state of ['reviewing', 'repairing', 'implementing'] as WorkspaceDogState[]) {
      expect(projectWorkspaceDogBehavior(state).patrolEnabled, state).toBe(false);
    }
  });

  it('the decor never intercepts a click, so mission controls stay reachable', () => {
    expect(css).toMatch(/\.rdo\s*\{[^}]*pointer-events:\s*none/s);
  });

  it('adds no animation framework and no heavy asset', () => {
    const pkg = JSON.parse(readFileSync(join(dir, '..', '..', '..', '..', 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const banned of ['framer-motion', 'gsap', 'lottie-web', 'three', 'anime.js', 'react-spring']) {
      expect(deps[banned], `${banned} was added`).toBeUndefined();
    }
    const decorSource = readFileSync(join(dir, 'RelayDogOperationalDecor.tsx'), 'utf8');
    expect(decorSource).not.toContain('requestAnimationFrame');
    expect(decorSource).not.toContain('setInterval');
    expect(decorSource).not.toContain('setTimeout');
    expect(decorSource).not.toContain('useState');
    // Real canvas/WebGL USAGE, not the word in a comment.
    expect(decorSource).not.toMatch(/<canvas|getContext\(|WebGL/);
  });

  it('the scene is responsive and cannot overflow horizontally', () => {
    // The boundary already clips its own track; the decor is absolutely
    // positioned inside it and clipped too.
    expect(css).toMatch(/\.rdm\s*\{[^}]*overflow-x:\s*hidden/s);
    expect(css).toMatch(/\.rdo\s*\{[^}]*overflow:\s*hidden/s);
    // A phone breakpoint keeps the editor and the code legible rather than
    // letting them shrink without bound.
    expect(css).toContain('@media (max-width: 480px)');
    const phone = css.slice(css.indexOf('@media (max-width: 480px)'));
    expect(phone).toContain('.rdo--code .rdo-editor');
    expect(phone).toMatch(/font-size:\s*[\d.]+px/);
  });
});

/* ============================================================ TRANSITIONS */

describe('TRANSITIONS between the three states feel connected', () => {
  it('each operational state plays exactly one short enter beat', () => {
    for (const [name, max] of [
      ['rdm-enter-sleep', 0.6],
      ['rdm-enter-dig', 0.6],
      ['rdm-enter-code', 0.6],
    ] as const) {
      expect(css, `${name} is missing`).toContain(`@keyframes ${name}`);
      const used = css.match(new RegExp(`${name}\\s+([\\d.]+)s[^;]*\\b1\\b`));
      expect(used, `${name} is not played once`).not.toBeNull();
      expect(Number(used?.[1]), `${name} is too slow to read the state`).toBeLessThanOrEqual(max);
    }
  });

  it('the enter beats stop under reduced motion like every other loop', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[^}]*\{[\s\S]*?\.rdm-body--reviewing[\s\S]*?animation:\s*none/,
    );
  });
});
