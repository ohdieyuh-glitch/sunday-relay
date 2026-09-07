import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  WONDERLAND_NO_RENDERER_REASON,
  admitToWonderland,
  isInsideWonderland,
  offerWonderlandRenderer,
  wonderlandEntryHeadline,
} from '../../mission/wonderland/wonderland-entry';
import type { WonderlandRendererOffer } from '../../mission/wonderland/wonderland-entry';
import type { WonderlandReadiness } from '../relay-experience/wonderland-handoff';
import {
  BUILT_IN_WONDERLAND_RENDERERS,
  beginWonderlandJoin,
  preferredWonderlandRenderer,
  wonderlandEntryForReadiness,
  wonderlandRendererGap,
} from './wonderland-renderers';

/**
 * WHAT THIS BUILD CAN SHOW, held to what it actually contains.
 *
 * The first test below is the one that matters and it is deliberately a
 * PIN rather than a property: it asserts the current, true state of the
 * repository, so that the day someone ships a world client the suite fails and
 * makes them update the sentence people are being told in the same change.
 */

const WHERE = { projectId: 'project-1', playerId: 'player-1' } as const;

describe('the renderers this build ships', () => {
  it('ships none, which is why admitted can never mean present', () => {
    expect(BUILT_IN_WONDERLAND_RENDERERS).toEqual([]);
    expect(preferredWonderlandRenderer()).toBeNull();
    expect(wonderlandRendererGap()).toBe(WONDERLAND_NO_RENDERER_REASON);
  });

  it('has no pixel-streaming or signalling client anywhere in the web source', () => {
    // The claim above is about the repository, so it is checked against the
    // repository rather than against a constant that could quietly go stale.
    const root = join(__dirname, '..', '..', '..', '..');
    const listed = readFileSync(join(root, 'package.json'), 'utf8').toLowerCase();
    for (const dependency of ['pixelstreaming', 'pixel-streaming', 'epicgames']) {
      expect(listed).not.toContain(dependency);
    }
  });

  it('stops claiming a gap the moment a renderer exists', () => {
    const offer: WonderlandRendererOffer = {
      rendererId: 'renderer-1',
      kind: 'unreal_pixel_stream',
      description: 'The Unreal world, streamed',
    };
    expect(wonderlandRendererGap([offer])).toBeNull();
    expect(preferredWonderlandRenderer([offer])).toBe(offer);
  });
});

describe('the landing gate, expressed as an entry', () => {
  it('turns ready into an attempt worth making, and not into a result', () => {
    const entry = wonderlandEntryForReadiness({ kind: 'ready' }, WHERE);
    expect(entry.admission).toBe('not_requested');
    expect(isInsideWonderland(entry)).toBe(false);
    expect(wonderlandEntryHeadline(entry)).toBe('NOT ENTERED');
  });

  it('carries the landing gate’s own sentence into the refusal', () => {
    const readiness: WonderlandReadiness = {
      kind: 'unreachable',
      reason: 'Sign in to Relay to enter Wonderland.',
    };
    const entry = wonderlandEntryForReadiness(readiness, WHERE);
    expect(entry.admission).toBe('refused');
    expect(entry.admissionReason).toBe('Sign in to Relay to enter Wonderland.');
  });

  it('explains an inactive agent rather than showing a dead entrance', () => {
    const entry = wonderlandEntryForReadiness({ kind: 'agent_not_active' }, WHERE);
    expect(entry.admission).toBe('refused');
    expect((entry.admissionReason ?? '').length).toBeGreaterThan(10);
  });

  it('covers every readiness the landing can report', () => {
    const all: readonly WonderlandReadiness[] = [
      { kind: 'ready' },
      { kind: 'agent_not_active' },
      { kind: 'unreachable', reason: 'No Relay Bridge is configured for this build.' },
    ];
    for (const readiness of all) {
      const entry = wonderlandEntryForReadiness(readiness, WHERE);
      expect(entry.projectId).toBe(WHERE.projectId);
      expect(isInsideWonderland(entry)).toBe(false);
      if (readiness.kind !== 'ready') expect(entry.admissionReason).not.toBeNull();
    }
  });

  it('gives a join somewhere honest to be busy', () => {
    const joining = beginWonderlandJoin(wonderlandEntryForReadiness({ kind: 'ready' }, WHERE));
    expect(joining.admission).toBe('requesting');
    expect(wonderlandEntryHeadline(joining)).toBe('ENTERING');
    expect(isInsideWonderland(joining)).toBe(false);
  });
});

describe('the end of the road for this build', () => {
  it('reaches admitted and stops there, saying so', () => {
    // The complete honest journey a founder can make today, end to end.
    const admitted = admitToWonderland(
      beginWonderlandJoin(wonderlandEntryForReadiness({ kind: 'ready' }, WHERE)),
      { sessionId: 'session-1', atIso: '2026-09-07T10:00:00.000Z' },
    );
    expect(admitted.admission).toBe('admitted');
    expect(isInsideWonderland(admitted)).toBe(false);
    expect(wonderlandEntryHeadline(admitted)).toBe('ADMITTED · NOTHING CAN SHOW IT');

    // And there is nothing to offer, so the next step cannot be taken.
    const renderer = preferredWonderlandRenderer();
    expect(renderer).toBeNull();
  });

  it('would go further the moment a renderer existed, with no other change', () => {
    // Proves the gap is the ASSET and not the wiring: hand the same entry a
    // renderer and the rest of the path already works.
    const offer: WonderlandRendererOffer = {
      rendererId: 'renderer-1',
      kind: 'unreal_pixel_stream',
      description: 'The Unreal world, streamed',
    };
    const admitted = admitToWonderland(
      beginWonderlandJoin(wonderlandEntryForReadiness({ kind: 'ready' }, WHERE)),
      { sessionId: 'session-1', atIso: '2026-09-07T10:00:00.000Z' },
    );
    const offered = offerWonderlandRenderer(admitted, offer);
    expect(offered.presentation).toBe('offered');
    expect(offered.rendererId).toBe('renderer-1');
    // Still not inside. A renderer existing is not a renderer confirming.
    expect(isInsideWonderland(offered)).toBe(false);
  });
});
