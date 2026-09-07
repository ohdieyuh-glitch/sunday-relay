/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';

import {
  admitToWonderland,
  refuseWonderlandAdmission,
} from '../../mission/wonderland/wonderland-entry';
import type { WonderlandEntry } from '../../mission/wonderland/wonderland-entry';
import type { WonderlandReadiness } from '../relay-experience/wonderland-handoff';
import type { joinWonderland } from './join-wonderland';
import { useWonderlandEntry } from './useWonderlandEntry';
import type { WonderlandEntryController } from './useWonderlandEntry';

/**
 * THE BUTTON'S STATE.
 *
 * Rendered through a real component rather than called directly, because the
 * two things worth proving are both about React: that a second click in the
 * same frame cannot post twice, and that the label never sits on a state the
 * entry has already left.
 */

const NOW = '2026-09-07T10:00:00.000Z';

let controller: WonderlandEntryController;

function Harness(props: {
  readonly readiness: WonderlandReadiness;
  readonly join: typeof joinWonderland;
}): JSX.Element {
  controller = useWonderlandEntry({
    readiness: props.readiness,
    projectId: 'project-1',
    playerId: 'player-1',
    join: props.join,
    now: () => NOW,
    newCommandId: () => 'cmd-1',
  });
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'label' }, controller.label),
    createElement('span', { 'data-testid': 'headline' }, controller.headline),
    createElement('span', { 'data-testid': 'detail' }, controller.detail ?? ''),
  );
}

const label = (): string => screen.getByTestId('label').textContent ?? '';
const headline = (): string => screen.getByTestId('headline').textContent ?? '';
const detail = (): string => screen.getByTestId('detail').textContent ?? '';

/** A join that admits, after a turn a test can control. */
function deferredJoin(): {
  join: typeof joinWonderland;
  calls: number;
  resolve: (entry: WonderlandEntry) => void;
} {
  const state = { calls: 0, resolve: (_: WonderlandEntry) => {} };
  const join = ((input: { entry: WonderlandEntry }) => {
    state.calls += 1;
    return new Promise<WonderlandEntry>((res) => {
      state.resolve = res;
      void input;
    });
  }) as unknown as typeof joinWonderland;
  return {
    join,
    get calls() {
      return state.calls;
    },
    resolve: (entry: WonderlandEntry) => state.resolve(entry),
  };
}

const admitting = (): typeof joinWonderland =>
  (async (input: { entry: WonderlandEntry }) =>
    admitToWonderland(input.entry, { sessionId: 'session-1', atIso: NOW })) as unknown as typeof joinWonderland;

afterEach(() => {
  cleanup();
});

describe('what the strip says before anything is attempted', () => {
  it('shows the readiness, not a refusal the bridge never made', () => {
    // A build with no bridge configured has not been REFUSED, it was never
    // asked. `ENTRY REFUSED` here would put words in the bridge's mouth.
    render(
      createElement(Harness, {
        readiness: { kind: 'unreachable', reason: 'No Relay Bridge is configured for this build.' },
        join: admitting(),
      }),
    );
    expect(label()).toBe('READY · ENTRANCE UNREACHABLE');
    expect(controller.attempted).toBe(false);
    expect(controller.canEnter).toBe(false);
  });

  it('offers the entrance only when the gate says ready', () => {
    render(createElement(Harness, { readiness: { kind: 'ready' }, join: admitting() }));
    expect(controller.canEnter).toBe(true);
    expect(label()).toBe('READY');
    expect(headline()).toBe('NOT ENTERED');
  });

  it('does not offer it before the agent is activated', () => {
    render(createElement(Harness, { readiness: { kind: 'agent_not_active' }, join: admitting() }));
    expect(controller.canEnter).toBe(false);
  });
});

describe('asking to enter', () => {
  it('says ENTERING while the request is in flight, and claims nothing', async () => {
    const deferred = deferredJoin();
    render(createElement(Harness, { readiness: { kind: 'ready' }, join: deferred.join }));

    await act(async () => {
      controller.enter();
    });
    expect(label()).toBe('ENTERING');
    expect(controller.inside).toBe(false);
    expect(controller.entry.sessionId).toBeNull();

    await act(async () => {
      deferred.resolve(
        admitToWonderland(controller.entry, { sessionId: 'session-1', atIso: NOW }),
      );
    });
    expect(label()).toBe('ADMITTED · NOTHING CAN SHOW IT');
  });

  it('posts once even when clicked twice in the same frame', async () => {
    // React batches; two clicks would both read `not_requested` and both post,
    // and a second join is a second presence in the world.
    const deferred = deferredJoin();
    render(createElement(Harness, { readiness: { kind: 'ready' }, join: deferred.join }));

    await act(async () => {
      controller.enter();
      controller.enter();
      controller.enter();
    });
    expect(deferred.calls).toBe(1);
  });

  it('will not ask again once admitted', async () => {
    const deferred = deferredJoin();
    render(createElement(Harness, { readiness: { kind: 'ready' }, join: deferred.join }));
    await act(async () => {
      controller.enter();
    });
    await act(async () => {
      deferred.resolve(
        admitToWonderland(controller.entry, { sessionId: 'session-1', atIso: NOW }),
      );
    });
    expect(controller.canEnter).toBe(false);
    await act(async () => {
      controller.enter();
    });
    expect(deferred.calls).toBe(1);
  });

  it('never reports arrival, because this build ships no renderer', async () => {
    render(createElement(Harness, { readiness: { kind: 'ready' }, join: admitting() }));
    await act(async () => {
      controller.enter();
    });
    expect(controller.entry.admission).toBe('admitted');
    expect(controller.inside).toBe(false);
    expect(headline()).toBe('ADMITTED · NOTHING CAN SHOW IT');
    expect(detail()).toContain('No renderer in this build');
  });
});

describe('when it does not work', () => {
  it('shows the bridge`s own refusal and allows a retry', async () => {
    const join = (async (input: { entry: WonderlandEntry }) =>
      refuseWonderlandAdmission(input.entry, {
        reason: 'This Relay session is not allowed into that world.',
      })) as unknown as typeof joinWonderland;
    render(createElement(Harness, { readiness: { kind: 'ready' }, join }));

    await act(async () => {
      controller.enter();
    });
    expect(label()).toBe('ENTRY REFUSED');
    expect(detail()).toBe('This Relay session is not allowed into that world.');
    // A refusal is retryable. A dead end would be the worse answer.
    expect(controller.canEnter).toBe(true);
  });

  it('never strands the button on ENTERING when the call itself breaks', async () => {
    // `joinWonderland` folds its own failures, so a throw here means something
    // unexpected — and the one outcome with no way back is a stuck spinner.
    const throwing = (async () => {
      throw new Error('boom');
    }) as unknown as typeof joinWonderland;
    render(createElement(Harness, { readiness: { kind: 'ready' }, join: throwing }));

    await act(async () => {
      controller.enter();
    });
    expect(label()).not.toBe('ENTERING');
    expect(label()).toBe('ENTRY REFUSED');
    expect(detail()).toContain('failed unexpectedly');
    expect(controller.canEnter).toBe(true);
  });

  it('lets a retry through after a failed attempt', async () => {
    const deferred = deferredJoin();
    render(createElement(Harness, { readiness: { kind: 'ready' }, join: deferred.join }));
    await act(async () => {
      controller.enter();
    });
    await act(async () => {
      deferred.resolve(
        refuseWonderlandAdmission(controller.entry, { reason: 'The bridge is unreachable.' }),
      );
    });
    await act(async () => {
      controller.enter();
    });
    expect(deferred.calls).toBe(2);
  });
});
