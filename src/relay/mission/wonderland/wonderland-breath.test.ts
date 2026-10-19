import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { WONDERLAND_BREATH, wonderlandBreathAt } from './index';

/**
 * THE DOG BREATHES, AND THE BREATH SAYS NOTHING.
 *
 * The founder asked for the Relay Dogs to move "like it's breathing in and out".
 * The risk in granting that is not visual — it is that a continuous motion on a
 * surface whose entire thesis is truthfulness becomes a status channel by
 * accident. A viewer watching a fast breath cannot tell whether it means "Relay
 * is working" or "the animation is simply fast", and a channel nobody can read
 * correctly is worse than no channel.
 *
 * So these tests hold two things: that it looks like breathing, and that it
 * cannot possibly mean anything.
 */

const PERIOD = WONDERLAND_BREATH.periodSeconds;

describe('the breath carries no information, structurally', () => {
  it('takes elapsed seconds and nothing else', () => {
    // ONE parameter. A state argument could not be passed to this function even
    // by a caller who wanted to — which is the guarantee. A comment promising it
    // would not be.
    expect(wonderlandBreathAt).toHaveLength(1);
  });

  it('has no state, mission, loop or activity word in its own source', () => {
    /**
     * The function body is read and checked, because the next author to "improve"
     * this will reach for the mission state, and the reason not to is subtle
     * enough to be lost. If this assertion ever has to be relaxed, the breath has
     * become a second status channel and the identity documents have to change
     * first.
     */
    const source = readFileSync('src/relay/mission/wonderland/wonderland-contracts.ts', 'utf8');
    const start = source.indexOf('export function wonderlandBreathAt');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('\n}', start));
    for (const forbidden of ['mission', 'loop', 'activity', 'status', 'verdict', 'token', 'busy', 'random']) {
      expect(body.toLowerCase(), `the breath reads \`${forbidden}\``).not.toContain(forbidden);
    }
  });

  it('is identical at the same instant however the world is doing', () => {
    // Called twice with the same time, nothing else in scope can change it.
    expect(wonderlandBreathAt(1.234)).toEqual(wonderlandBreathAt(1.234));
  });
});

describe('the breath looks like breathing', () => {
  it('rests at zero and at every whole cycle', () => {
    for (const t of [0, PERIOD, PERIOD * 2, PERIOD * 100]) {
      const breath = wonderlandBreathAt(t);
      expect(breath.phase, `t=${t}`).toBeCloseTo(0, 6);
      expect(breath.uniformScale, `t=${t}`).toBeCloseTo(1, 6);
    }
  });

  it('peaks at the half cycle', () => {
    const peak = wonderlandBreathAt(PERIOD / 2);
    expect(peak.phase).toBeCloseTo(1, 6);
    expect(peak.uniformScale).toBeCloseTo(1 + WONDERLAND_BREATH.scaleAmplitude, 6);
  });

  it('NEVER shrinks the Dog below its own size', () => {
    /**
     * `(1 - cos)/2`, not a raw sine. A sine would put the Dog below 1.0 for half
     * of every cycle, which reads as deflating rather than breathing — and on a
     * voxel figure a sub-1.0 scale is visible as the silhouette losing a row.
     */
    for (let i = 0; i <= 400; i += 1) {
      const breath = wonderlandBreathAt((PERIOD * i) / 100);
      expect(breath.uniformScale, `sample ${i}`).toBeGreaterThanOrEqual(1);
      expect(breath.phase, `sample ${i}`).toBeLessThanOrEqual(1);
    }
  });

  it('rises monotonically through the inhale and falls through the exhale', () => {
    // Otherwise it is a flutter, not a breath.
    let previous = -1;
    for (let i = 0; i <= 50; i += 1) {
      const value = wonderlandBreathAt((PERIOD / 2) * (i / 50)).phase;
      expect(value, `inhale sample ${i}`).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    previous = 2;
    for (let i = 0; i <= 50; i += 1) {
      const value = wonderlandBreathAt(PERIOD / 2 + (PERIOD / 2) * (i / 50)).phase;
      expect(value, `exhale sample ${i}`).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('stays subtle — a swell, not a pulse', () => {
    // 1.5%: enough to read as alive at a glance, little enough that nobody reads
    // it as an effect. A larger amplitude on an 18x14 voxel grid moves whole
    // rows.
    expect(WONDERLAND_BREATH.scaleAmplitude).toBeLessThanOrEqual(0.03);
    expect(WONDERLAND_BREATH.scaleAmplitude).toBeGreaterThan(0);
    // A resting rate. Under two seconds is panting.
    expect(WONDERLAND_BREATH.periodSeconds).toBeGreaterThanOrEqual(2);
  });

  it('rests rather than throwing on a clock that is not a clock', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const breath = wonderlandBreathAt(bad);
      // A renderer handed a bad clock shows a still Dog, not a crashed world.
      expect(breath.uniformScale, String(bad)).toBe(1);
      expect(Number.isFinite(breath.phase), String(bad)).toBe(true);
    }
  });

  it('does not drift out of phase over a long session', () => {
    // A whole cycle an hour in must still be a rest, or a Dog left running
    // overnight breathes visibly off-beat from one just spawned.
    const anHourOfCycles = Math.floor(3600 / PERIOD);
    expect(wonderlandBreathAt(PERIOD * anHourOfCycles).phase).toBeCloseTo(0, 4);
  });
});

describe('the C++ Dog breathes at the same rate as the sprite', () => {
  const header = () => readFileSync('wonderland/Source/Wonderland/WonderlandDogAnimation.h', 'utf8');

  const initializerOf = (name: string): number => {
    // The VALUE, not the shape. A shape check would pass a header declaring a
    // one-second period, and the two surfaces would breathe differently.
    const match = new RegExp(`${name}\\s*=\\s*(-?[0-9.]+)f?;`).exec(header());
    expect(match, `${name} has no numeric initializer in the C++ header`).not.toBeNull();
    return Number((match as RegExpExecArray)[1]);
  };

  it('mirrors every breath constant', () => {
    expect(initializerOf('WonderlandBreathPeriodSeconds')).toBe(WONDERLAND_BREATH.periodSeconds);
    expect(initializerOf('WonderlandBreathScaleAmplitude')).toBe(WONDERLAND_BREATH.scaleAmplitude);
    // And no field exists that nothing can apply.
    expect(WONDERLAND_BREATH).not.toHaveProperty('riseGridUnits');
    expect(header()).not.toContain('RiseGridUnits');
  });

  it('takes one parameter on the C++ side too', () => {
    // A state argument added on either side is drift, and this is the only place
    // the two signatures are compared.
    expect(header()).toContain('WonderlandBreathAt(float ElapsedSeconds)');
  });

  it('keeps the header claim about clip selection true', () => {
    /**
     * The header used to say the module has "no elapsed-time input". Adding the
     * breath made that false, and a false claim in a comment is this
     * repository's most frequent defect. The claim is now scoped to CLIP
     * SELECTION, and this asserts the scoping survives.
     */
    const text = header();
    expect(text).toContain('CLIP SELECTION');
    expect(text).not.toMatch(/There is no\s+\/\/ elapsed-time input/);
    expect(text).toContain('carries no information');
  });

  it('is APPLIED by the pawn, not merely computed', () => {
    /**
     * A breath nothing reads is a number in a getter. The pawn's Tick multiplies
     * the swell INTO the identity scale rather than replacing it — writing the
     * breath alone would make every Dog snap to 1.0 and lose whatever scale the
     * level gave it.
     *
     * And the tick had to be turned on: the constructor deliberately set
     * `bCanEverTick = false` with the reason "a tick here would be the first
     * place a timer started pretending to be an activity". That concern is now
     * answered by construction, and this asserts the Tick does only the one
     * thing.
     */
    const pawn = readFileSync('wonderland/Source/Wonderland/WonderlandDogPawn.cpp', 'utf8');
    expect(pawn).toContain('PrimaryActorTick.bCanEverTick = true;');
    expect(pawn).toContain('Proportions.UniformScale * Swell');
    // The Tick must not learn anything from Relay. `ApplyWorldState` is push.
    const tickStart = pawn.indexOf('void AWonderlandDogPawn::Tick');
    expect(tickStart).toBeGreaterThan(-1);
    /**
     * COMMENTS STRIPPED FIRST, following `remote-transport.test.ts`: this asserts
     * about CODE, and prose that merely discusses `ApplyWorldState` in order to
     * explain why the Tick does not call it is not a call. The first version of
     * this assertion failed on its own explanatory comment, which is the same
     * mistake in miniature — reading text and calling it behaviour.
     */
    const tickBody = pawn
      .slice(tickStart, pawn.indexOf('\n}', tickStart))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const forbidden of ['ObservedAgent', 'ObservedLoops', 'bSnapshotApplied', 'ApplyWorldState']) {
      expect(tickBody, `the Tick reads ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('rests the C++ breath at rest, by reading its own curve', () => {
    // The `(1 - cos)/2` choice is the one thing that could silently differ
    // between the two implementations, so the C++ source is checked for it
    // rather than assumed. It cannot be executed here — no Unreal toolchain
    // exists in this environment — and that limitation is recorded in
    // docs/relay/WONDERLAND.md.
    const cpp = readFileSync('wonderland/Source/Wonderland/WonderlandDogAnimation.cpp', 'utf8');
    expect(cpp).toContain('(1.0f - FMath::Cos(2.0f * PI * WithinCycle)) * 0.5f');
    expect(cpp).toContain('FMath::IsFinite(ElapsedSeconds)');
  });
});
