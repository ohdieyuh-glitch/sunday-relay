import { describe, expect, it } from 'vitest';

import {
  admitToWonderland,
  beginWonderlandEntry,
  claimWonderlandPresenting,
  offerWonderlandRenderer,
  refuseWonderlandAdmission,
  requestWonderlandAdmission,
} from './wonderland-entry';
import type { WonderlandEntry } from './wonderland-entry';
import {
  WONDERLAND_WORLD_SESSION_FIELDS,
  bindWonderlandWorldSession,
  wonderlandSessionIsPixelStreamed,
  wonderlandStreamRequest,
  wonderlandWorldSessionGrant,
} from './wonderland-world-session';

const PROJECT = 'project-alpha';
const PLAYER = 'player-1';
const RUN = 'run-1';
const AT = '2026-09-08T00:00:00.000Z';

/** An entry walked all the way to presenting, the way the door really works. */
const presenting = (): WonderlandEntry => {
  const begun = beginWonderlandEntry({ projectId: PROJECT, playerId: PLAYER });
  const requested = requestWonderlandAdmission(begun);
  const admitted = admitToWonderland(requested, { sessionId: 'bridge-session-9', atIso: AT });
  const offered = offerWonderlandRenderer(admitted, {
    rendererId: 'unreal-pixel-stream',
    kind: 'unreal_pixel_stream',
    description: 'The Unreal world, pixel-streamed.',
  });
  return claimWonderlandPresenting(offered, { rendererId: 'unreal-pixel-stream', atIso: AT });
};

const bind = (over: Partial<Parameters<typeof bindWonderlandWorldSession>[0]> = {}) =>
  bindWonderlandWorldSession({ entry: presenting(), runId: RUN, boundAtIso: AT, ...over });

/* ------------------------------------------------------------ the binding */

describe('a world is scoped to what somebody was actually admitted to', () => {
  it('binds a presenting entry to the run it will follow', () => {
    const bound = bind();
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(bound.session.projectId).toBe(PROJECT);
    expect(bound.session.playerId).toBe(PLAYER);
    expect(bound.session.sessionId).toBe('bridge-session-9');
    expect(bound.session.runId).toBe(RUN);
    expect(bound.session.rendererKind).toBe('unreal_pixel_stream');
  });

  it('takes the session id from the Bridge and never invents one', () => {
    const bound = bind();
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    // Every identifier came from somewhere that already owned it.
    expect(bound.session.sessionId).toBe(presenting().sessionId);
  });

  it('leaves the Julius instance null when the caller does not know it', () => {
    // A cursor LEARNS it from the first envelope. One that insisted on being
    // told up front would refuse the very envelope that would have told it.
    const bound = bind();
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(bound.session.juliusInstanceId).toBeNull();

    const known = bind({ juliusInstanceId: 'julius-1' });
    expect(known.ok).toBe(true);
    if (!known.ok) return;
    expect(known.session.juliusInstanceId).toBe('julius-1');
  });

  it('names every field it carries', () => {
    const bound = bind();
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(Object.keys(bound.session).sort()).toEqual([...WONDERLAND_WORLD_SESSION_FIELDS].sort());
  });
});

/* ----------------------------------------------------------- the refusals */

describe('nothing is scoped to a door that did not open', () => {
  it('refuses an entry nobody admitted', () => {
    const begun = beginWonderlandEntry({ projectId: PROJECT, playerId: PLAYER });
    const refused = bindWonderlandWorldSession({ entry: begun, runId: RUN, boundAtIso: AT });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.refusal).toBe('not_admitted');
    expect(refused.reason.length).toBeGreaterThan(10);
  });

  it('refuses an entry the Bridge turned away', () => {
    const requested = requestWonderlandAdmission(
      beginWonderlandEntry({ projectId: PROJECT, playerId: PLAYER }),
    );
    const denied = refuseWonderlandAdmission(requested, { reason: 'no seat' });
    const bound = bindWonderlandWorldSession({ entry: denied, runId: RUN, boundAtIso: AT });
    expect(bound.ok).toBe(false);
    if (bound.ok) return;
    expect(bound.refusal).toBe('not_admitted');
  });

  it('refuses an admitted entry that is not presenting yet', () => {
    // Admitted means a person MAY enter. Presenting means something is
    // actually drawing. A stream scoped to the first delivers envelopes to a
    // world that does not exist, and makes "is anybody watching" unanswerable.
    const admitted = admitToWonderland(
      requestWonderlandAdmission(beginWonderlandEntry({ projectId: PROJECT, playerId: PLAYER })),
      { sessionId: 'bridge-session-9', atIso: AT },
    );
    const bound = bindWonderlandWorldSession({ entry: admitted, runId: RUN, boundAtIso: AT });
    expect(bound.ok).toBe(false);
    if (bound.ok) return;
    expect(bound.refusal).toBe('not_presenting');
  });

  it('refuses an entry whose renderer was OFFERED but has not claimed', () => {
    // Isolated deliberately. The admitted-without-a-renderer case is caught by
    // the later renderer check too, so it leaves the presenting check looking
    // alive while doing nothing. Only an entry that HAS a renderer kind and is
    // still not presenting can see it: a renderer has offered to draw and has
    // not yet said it is drawing.
    const offered = offerWonderlandRenderer(
      admitToWonderland(
        requestWonderlandAdmission(beginWonderlandEntry({ projectId: PROJECT, playerId: PLAYER })),
        { sessionId: 'bridge-session-9', atIso: AT },
      ),
      {
        rendererId: 'unreal-pixel-stream',
        kind: 'unreal_pixel_stream',
        description: 'The Unreal world, pixel-streamed.',
      },
    );
    expect(offered.rendererKind).not.toBeNull();

    const bound = bindWonderlandWorldSession({ entry: offered, runId: RUN, boundAtIso: AT });
    expect(bound.ok).toBe(false);
    if (bound.ok) return;
    expect(bound.refusal).toBe('not_presenting');
  });

  it('refuses a nameless run, because a world follows one', () => {
    for (const runId of ['', '   ']) {
      const bound = bind({ runId });
      expect(bound.ok).toBe(false);
      if (bound.ok) return;
      expect(bound.refusal).toBe('no_run');
    }
  });

  it('refuses a run belonging to another project when the caller can check', () => {
    const bound = bind({ runProjectId: 'project-beta' });
    expect(bound.ok).toBe(false);
    if (bound.ok) return;
    expect(bound.refusal).toBe('foreign_run');
  });

  it('does not force a caller that cannot check to invent an answer', () => {
    expect(bind({ runProjectId: null }).ok).toBe(true);
    expect(bind({ runProjectId: '' }).ok).toBe(true);
    expect(bind({ runProjectId: PROJECT }).ok).toBe(true);
  });
});

/* -------------------------------------------------------------- the grant */

describe('the grant a stream may use comes from the binding and nowhere else', () => {
  it('scopes exactly the project and run that were bound', () => {
    const bound = bind();
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(wonderlandWorldSessionGrant(bound.session)).toEqual({
      projectId: PROJECT,
      runId: RUN,
    });
  });

  it('builds the stream query without knowing where the Bridge lives', () => {
    const bound = bind();
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(wonderlandStreamRequest(bound.session, 42)).toEqual({
      projectId: PROJECT,
      runId: RUN,
      cursor: 42,
    });
    // No path, no host, no scheme: a route's shape is not the domain's business.
    expect(Object.keys(wonderlandStreamRequest(bound.session, 0))).toEqual([
      'projectId',
      'runId',
      'cursor',
    ]);
  });

  it('asks from the beginning when handed a cursor that is not a position', () => {
    // The safe direction: ordering refuses what the world already holds, so
    // the cost is bandwidth rather than a wrong picture.
    const bound = bind();
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    for (const cursor of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(wonderlandStreamRequest(bound.session, cursor).cursor).toBe(0);
    }
  });

  it('says whether a real Unreal client is on the other end', () => {
    const bound = bind();
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(wonderlandSessionIsPixelStreamed(bound.session)).toBe(true);
    expect(
      wonderlandSessionIsPixelStreamed({ ...bound.session, rendererKind: 'embedded_scene' }),
    ).toBe(false);
  });

  it('cannot produce a grant for a project the entry never opened', () => {
    // The whole point of the type: a grant made anywhere else would be a
    // second place where a project and a run are put together, and the two
    // would eventually disagree.
    const bound = bind();
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(wonderlandWorldSessionGrant(bound.session).projectId).toBe(presenting().projectId);
  });
});
