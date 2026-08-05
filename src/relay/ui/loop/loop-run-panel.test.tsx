/** @vitest-environment jsdom */
import { afterEach, describe, expect, it as baseIt, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, createElement } from 'react';

import {
  RelayLoopRunPanel, RelayLoopRunSurface, projectLoopRunView,
  type RelayLoopRunFetch, type RelayLoopRunPort, type RelayLoopRunStore,
} from './index';
import type { LoopStatusProjection } from '../../mission';

/**
 * THE RUN PANEL, MOUNTED AND DRIVEN.
 *
 * `loop-run-view.test.ts` proves the PROJECTION. That is a different claim
 * from this file's: a projection can be complete, correct and fully tested
 * while nothing renders it — which is exactly what was true of
 * `loop-run-view.ts` for three commits after the runtime landed.
 *
 * The three properties asserted here are the ones a background-job surface
 * gets wrong, in the order they cost the most:
 *
 *   1. it animates only when the SERVER says work is happening;
 *   2. it restores by ASKING, never from a cached projection;
 *   3. it draws no control it cannot actually operate.
 *
 * These run in jsdom on a shared 2-core box; every case gets a wide budget so a
 * slow machine reports a slow machine rather than a failing rule.
 */

const it = (name: string, fn: () => void | Promise<void>) => baseIt(name, fn, 120000);
afterEach(cleanup);

const RUN_ID = 'lpr_00000000000000000001';
const LOOP_ID = 'lpe_00000000000000000001';

function status(overrides: Partial<LoopStatusProjection> = {}): LoopStatusProjection {
  return {
    runId: RUN_ID,
    loopId: LOOP_ID,
    state: 'running',
    stateClass: 'active',
    succeeded: false,
    finished: false,
    identity: null,
    usage: {
      iterationsStarted: 2,
      maxIterations: 10,
      knownSpendMicros: null,
      maxSpendMicros: null,
      spendUnknown: true,
      currency: null,
      tokensUsed: null,
      maxTotalTokens: null,
      tokensUnknown: true,
      providerCallsUsed: 3,
      maxProviderCalls: null,
    },
    blocker: null,
    latestFailure: null,
    ...overrides,
  } as LoopStatusProjection;
}

const okPort = (value: LoopStatusProjection): RelayLoopRunPort => ({
  status: vi.fn(async (): Promise<RelayLoopRunFetch> => ({ ok: true, status: value })),
});

function memoryStore(initial: unknown = null): RelayLoopRunStore & { value: unknown } {
  const store = {
    value: initial,
    read: () => store.value,
    write: (point: unknown) => { store.value = point; },
  };
  return store as RelayLoopRunStore & { value: unknown };
}

/* ------------------------------------------------------------- animation */

describe('the panel animates only for work the server reported', () => {
  const activityOf = (state: Partial<LoopStatusProjection>) => {
    render(createElement(RelayLoopRunPanel, {
      view: projectLoopRunView({ status: status(state) }),
      sync: 'idle' as const,
      syncMessage: null,
    }));
    return document.querySelector('[data-loop-activity]')?.getAttribute('data-loop-activity');
  };

  it('an ACTIVE run animates', () => {
    expect(activityOf({ stateClass: 'active' })).toBe('working');
    expect(document.querySelector('.rlr-pulse.is-animating')).toBeTruthy();
  });

  it('a WAITING run does NOT animate — it is making no progress', () => {
    // The spinner that keeps spinning is how a product lies about a stuck job.
    cleanup();
    expect(activityOf({ stateClass: 'waiting', state: 'waiting_approval' })).toBe('waiting');
    expect(document.querySelector('.rlr-pulse.is-animating')).toBeNull();
  });

  it('a FINISHED run does not animate either', () => {
    cleanup();
    // `successful_terminal` is the projection's word; `finished` is the
    // ACTIVITY the view derives from it. Asserting the state class as if it
    // were the activity tested nothing about the mapping.
    expect(activityOf({
      stateClass: 'successful_terminal', state: 'completed', finished: true, succeeded: true,
    })).toBe('finished');
    expect(document.querySelector('.rlr-pulse.is-animating')).toBeNull();
  });

  it('NO run at all renders an explanation, never an idle-looking run', () => {
    render(createElement(RelayLoopRunPanel, {
      view: projectLoopRunView({ status: null }),
      sync: 'idle' as const,
      syncMessage: null,
    }));
    expect(document.querySelector('.rlr-pulse.is-animating')).toBeNull();
    expect(screen.getByText(/Draft a Loop and confirm it to start a run/)).toBeTruthy();
  });
});

/* ----------------------------------------------------------- truthfulness */

describe('unknown stays Unknown', () => {
  it('renders Unknown for unreported spend and tokens, never a zero', () => {
    render(createElement(RelayLoopRunPanel, {
      view: projectLoopRunView({ status: status() }),
      sync: 'idle' as const,
      syncMessage: null,
    }));
    const html = document.body.innerHTML;
    expect(html).toContain('Unknown');
    // The one thing that must never appear for an unreported cost.
    expect(html).not.toContain('$0.00');
    expect(html).not.toContain('0.0000');
  });

  it('a transport failure is not drawn as a run failure', () => {
    render(createElement(RelayLoopRunPanel, {
      view: projectLoopRunView({ status: null, emptyReason: 'Relay could not read this run.' }),
      sync: 'unreachable' as const,
      syncMessage: 'The Relay Bridge could not be reached.',
    }));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('could not be reached');
    expect(alert.textContent).toContain('says nothing about the run itself');
    // No FAILURE tag: nothing failed except the question.
    expect(document.querySelector('.rlr-failure')).toBeNull();
  });
});

/* --------------------------------------------------------- dead controls */

describe('no control is drawn that cannot act', () => {
  it('renders no button at all when the host supplies no handler', () => {
    render(createElement(RelayLoopRunPanel, {
      view: projectLoopRunView({ status: status() }),
      sync: 'idle' as const,
      syncMessage: null,
    }));
    // A `Stop` that silently does nothing tells a user a run was stopped
    // while it is still spending.
    expect([...document.querySelectorAll('button')].map((b) => b.textContent)).toEqual([]);
  });

  it('renders them, with their reasons, when a handler IS supplied', () => {
    const onControl = vi.fn();
    render(createElement(RelayLoopRunPanel, {
      view: projectLoopRunView({ status: status() }),
      sync: 'idle' as const,
      syncMessage: null,
      onControl,
    }));
    fireEvent.click(screen.getByRole('button', { name: /^stop$/i }));
    expect(onControl).toHaveBeenCalledWith('stop');
  });

  it('a finished run offers no enabled control, and says why', () => {
    render(createElement(RelayLoopRunPanel, {
      view: projectLoopRunView({
        status: status({
          state: 'completed', stateClass: 'successful_terminal', finished: true, succeeded: true,
        }),
      }),
      sync: 'idle' as const,
      syncMessage: null,
      onControl: vi.fn(),
    }));
    for (const button of document.querySelectorAll('button')) {
      if (/refresh|close/i.test(button.textContent ?? '')) continue;
      expect(button.hasAttribute('disabled'), button.textContent ?? '').toBe(true);
    }
    expect(document.body.innerHTML).toContain('takes no further actions');
  });
});

/* ------------------------------------------------------------ restoration */

describe('restoration is a read, not a cache', () => {
  it('asks the server for the stored run id and renders what came back', async () => {
    const port = okPort(status());
    const store = memoryStore({ runId: RUN_ID, loopId: LOOP_ID });
    render(createElement(RelayLoopRunSurface, { port, store }));

    await waitFor(() => expect(port.status).toHaveBeenCalledWith(RUN_ID));
    await waitFor(() => {
      expect(document.querySelector('[data-loop-activity]')?.getAttribute('data-loop-activity'))
        .toBe('working');
    });
  });

  it('stores ONLY the run id and loop id — never the projection', async () => {
    const port = okPort(status());
    const store = memoryStore({ runId: RUN_ID, loopId: LOOP_ID });
    render(createElement(RelayLoopRunSurface, { port, store }));
    await waitFor(() => expect(port.status).toHaveBeenCalled());
    await waitFor(() => expect(Object.keys(store.value as object).sort()).toEqual(['loopId', 'runId']));
  });

  it('a malformed stored point is discarded, and nothing is fetched or drawn', async () => {
    const port = okPort(status());
    const store = memoryStore({ runId: 'not-a-run-id', loopId: LOOP_ID });
    render(createElement(RelayLoopRunSurface, { port, store }));
    await waitFor(() => expect(screen.getByText(/Draft a Loop and confirm it/)).toBeTruthy());
    expect(port.status).not.toHaveBeenCalled();
    expect(store.value).toBeNull();
  });

  it('a run the server can no longer answer for is NOT drawn from memory', async () => {
    // The whole point of refusing a cache: a finished or vanished run must not
    // keep rendering as whatever it last was.
    const port: RelayLoopRunPort = {
      status: vi.fn(async (): Promise<RelayLoopRunFetch> => ({
        ok: false, message: 'The Relay Bridge has no such Loop run.',
      })),
    };
    const store = memoryStore({ runId: RUN_ID, loopId: LOOP_ID });
    render(createElement(RelayLoopRunSurface, { port, store }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('no such Loop run'));
    expect(document.querySelector('[data-loop-activity]')?.getAttribute('data-loop-activity'))
      .toBe('none');
    expect(document.body.innerHTML).not.toContain(RUN_ID);
  });

  it('an explicit run id wins over whatever was stored', async () => {
    const other = 'lpr_00000000000000000002';
    const port = okPort(status({ runId: other }));
    const store = memoryStore({ runId: RUN_ID, loopId: LOOP_ID });
    render(createElement(RelayLoopRunSurface, { port, store, runId: other }));
    await waitFor(() => expect(port.status).toHaveBeenCalledWith(other));
  });

  it('THE LATEST REQUEST WINS — a slow earlier read cannot repaint a newer one', async () => {
    /*
     * The race the first version lost. Two overlapping reads and the SLOWER
     * one decided what the screen said, so a refresh issued before a Stop could
     * answer after it and repaint a stopped run as running, pulse animating.
     * That is rule 1 broken by the surface built to hold it.
     */
    const finished = status({
      runId: RUN_ID, state: 'completed', stateClass: 'successful_terminal',
      finished: true, succeeded: true,
    });
    const running = status({ runId: RUN_ID });
    let releaseSlow: (v: RelayLoopRunFetch) => void = () => {};
    const calls: string[] = [];
    const port: RelayLoopRunPort = {
      status: vi.fn(async (): Promise<RelayLoopRunFetch> => {
        calls.push('status');
        if (calls.length === 1) {
          // The FIRST read is the slow one, and it answers stale.
          return new Promise<RelayLoopRunFetch>((resolve) => { releaseSlow = resolve; });
        }
        return { ok: true, status: finished };
      }),
    };
    const store = memoryStore({ runId: RUN_ID, loopId: LOOP_ID });
    const { rerender } = render(createElement(RelayLoopRunSurface, { port, store }));
    await waitFor(() => expect(calls.length).toBe(1));

    // A second read supersedes it and answers first.
    rerender(createElement(RelayLoopRunSurface, { port, store, runId: RUN_ID }));
    await waitFor(() => expect(calls.length).toBe(2));
    await waitFor(() => {
      expect(document.querySelector('[data-loop-activity]')?.getAttribute('data-loop-activity'))
        .toBe('finished');
    });

    // Now the stale read lands. It must be dropped, not drawn.
    releaseSlow({ ok: true, status: running });
    await new Promise((r) => { setTimeout(r, 20); });
    expect(
      document.querySelector('[data-loop-activity]')?.getAttribute('data-loop-activity'),
      'a superseded read must not repaint a finished run as running',
    ).toBe('finished');
  });

  it('Refresh is not offered while a control is in flight', () => {
    // The same race by another door: Refresh stayed enabled during `acting`,
    // so a user could start a read that outlived the Stop it raced.
    const view = projectLoopRunView({ status: status() });
    render(createElement(RelayLoopRunPanel, {
      view, sync: 'acting' as const, syncMessage: null,
      onRefresh: vi.fn(), onControl: vi.fn(),
    }));
    const refresh = screen.getByRole('button', { name: /^refresh$/i });
    expect(refresh.hasAttribute('disabled')).toBe(true);
  });

  it('a REFUSED control still says so after the re-read', async () => {
    /*
     * The message was set and then immediately wiped: the re-read cleared it on
     * entry. A user pressed Stop, the bridge refused, and the screen said
     * nothing at all — which is the precise defect this file's header claims to
     * prevent.
     */
    const port: RelayLoopRunPort = {
      status: vi.fn(async (): Promise<RelayLoopRunFetch> => ({ ok: true, status: status() })),
      control: vi.fn(async (): Promise<RelayLoopRunFetch> => ({
        ok: false, message: 'The Relay Bridge rejected the credential.',
      })),
    };
    const store = memoryStore({ runId: RUN_ID, loopId: LOOP_ID });
    render(createElement(RelayLoopRunSurface, { port, store }));

    await waitFor(() => expect(screen.getByRole('button', { name: /^stop$/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^stop$/i }));

    await waitFor(() => expect(port.control).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('rejected the credential');
    });
  });

  it('a REFUSED control does not claim Relay could not ask', async () => {
    /*
     * The fix for the wiped message left a false sentence in its place: sync
     * became `unreachable`, so the alert said "Relay could not ask" while the
     * panel showed fresh server data from the re-read that had just succeeded.
     * Relay DID ask. On this branch's own standard that is the surface lying
     * about what happened.
     */
    const port: RelayLoopRunPort = {
      status: vi.fn(async (): Promise<RelayLoopRunFetch> => ({ ok: true, status: status() })),
      control: vi.fn(async (): Promise<RelayLoopRunFetch> => ({
        ok: false, message: 'The Relay Bridge rejected the credential.',
      })),
    };
    const store = memoryStore({ runId: RUN_ID, loopId: LOOP_ID });
    render(createElement(RelayLoopRunSurface, { port, store }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^stop$/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^stop$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('rejected the credential');
    });
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert, 'the server answered, so this must not say Relay could not ask')
      .not.toContain('could not ask');
    expect(alert).toContain('what the server reports now');
    expect(document.querySelector('[data-loop-sync]')?.getAttribute('data-loop-sync'))
      .toBe('refused');
  });

  it('the request guard survives StrictMode double-mounting', async () => {
    /*
     * `src/relay/main.tsx` renders under `<StrictMode>`, which double-invokes
     * effects in development. Cleanup used to REWIND the ticket to -1, so the
     * second pass restarted at 1 and collided with a first-pass request still
     * in flight — the orphan then landed, was accepted, and repainted a
     * finished run as running. The guard defeated by its own cleanup.
     */
    const finished = status({
      state: 'completed', stateClass: 'successful_terminal', finished: true, succeeded: true,
    });
    const orphan = status({ runId: 'lpr_00000000000000000009' });
    const results: RelayLoopRunFetch[] = [];
    let releaseFirst: (v: RelayLoopRunFetch) => void = () => {};
    const port: RelayLoopRunPort = {
      status: vi.fn(async (): Promise<RelayLoopRunFetch> => {
        results.push({ ok: true, status: finished });
        if (results.length === 1) {
          return new Promise<RelayLoopRunFetch>((resolve) => { releaseFirst = resolve; });
        }
        return { ok: true, status: finished };
      }),
    };
    const store = memoryStore({ runId: RUN_ID, loopId: LOOP_ID });
    render(createElement(StrictMode, null,
      createElement(RelayLoopRunSurface, { port, store })));

    await waitFor(() => expect(results.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => {
      expect(document.querySelector('[data-loop-activity]')?.getAttribute('data-loop-activity'))
        .toBe('finished');
    });

    /*
     * A THIRD READ, AND THIS LINE IS WHY THE TEST BITES.
     *
     * Without it the sequence passed against the BUGGY code too: with the
     * ticket rewound to -1, pass two takes ticket 0 while the orphan holds 1,
     * and nothing ever restores the counter to 1 — so the orphan was dropped
     * by accident rather than by the guard. Clicking Refresh advances the
     * buggy counter back to exactly 1, which is the collision. A regression
     * test that cannot fail on the code it was written for is not one.
     */
    fireEvent.click(screen.getByRole('button', { name: /^refresh$/i }));
    await waitFor(() => expect(results.length).toBeGreaterThanOrEqual(3));

    // The orphaned first-pass read lands last, carrying a DIFFERENT run.
    releaseFirst({ ok: true, status: orphan });
    // WAIT FOR THE ORPHAN TO BE HANDLED, not for a fixed 30ms. A settle window
    // can expire before the response lands on a loaded box, and the assertion
    // then passes because nothing happened yet — vacuously, which is the same
    // failure mode as the two tests this commit series already had to fix.
    await waitFor(() => {
      expect((port.status as ReturnType<typeof vi.fn>).mock.results.length)
        .toBeGreaterThanOrEqual(3);
    });
    await Promise.resolve();
    expect(
      document.querySelector('[data-loop-activity]')?.getAttribute('data-loop-activity'),
      'an orphaned first-pass read must not repaint a finished run',
    ).toBe('finished');
    expect((store.value as { runId?: string } | null)?.runId).not.toBe(orphan.runId);
  });

  it('a run the server says does NOT EXIST is forgotten; one it cannot reach is kept', async () => {
    // Otherwise a dead id is re-requested on every future mount forever — and
    // the doc said it was cleared, which was simply untrue.
    const gone: RelayLoopRunPort = {
      status: vi.fn(async (): Promise<RelayLoopRunFetch> => ({
        ok: false, kind: 'not_found', message: 'The Relay Bridge has no such Loop run.',
      })),
    };
    const goneStore = memoryStore({ runId: RUN_ID, loopId: LOOP_ID });
    render(createElement(RelayLoopRunSurface, { port: gone, store: goneStore }));
    await waitFor(() => expect(goneStore.value).toBeNull());

    cleanup();
    const unreachable: RelayLoopRunPort = {
      status: vi.fn(async (): Promise<RelayLoopRunFetch> => ({
        ok: false, kind: 'unreachable', message: 'The Relay Bridge could not be reached.',
      })),
    };
    const keptStore = memoryStore({ runId: RUN_ID, loopId: LOOP_ID });
    render(createElement(RelayLoopRunSurface, { port: unreachable, store: keptStore }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(keptStore.value, 'an unreachable bridge says nothing about the run').not.toBeNull();
  });

  it('a store that THROWS does not take the tree down', async () => {
    // `localStorage` throws under blocked storage and over quota. A surface
    // that crashes because it could not remember an id is worse than one that
    // forgets it.
    const hostile: RelayLoopRunStore = {
      read: () => { throw new Error('storage is blocked'); },
      write: () => { throw new Error('quota exceeded'); },
    };
    const port = okPort(status());
    render(createElement(RelayLoopRunSurface, { port, store: hostile }));
    await waitFor(() => expect(screen.getByText(/Draft a Loop and confirm it/)).toBeTruthy());
  });

  it('a response that lands after unmount writes nothing', async () => {
    let release: (v: RelayLoopRunFetch) => void = () => {};
    const port: RelayLoopRunPort = {
      status: vi.fn(async () => new Promise<RelayLoopRunFetch>((r) => { release = r; })),
    };
    const store = memoryStore({ runId: RUN_ID, loopId: LOOP_ID });
    const { unmount } = render(createElement(RelayLoopRunSurface, { port, store }));
    await waitFor(() => expect(port.status).toHaveBeenCalled());
    unmount();
    const before = store.value;
    release({ ok: true, status: status() });
    await new Promise((r) => { setTimeout(r, 20); });
    expect(store.value, 'a late response must not write after unmount').toBe(before);
  });

  it('re-reads the run after a control instead of announcing the outcome', async () => {
    // "Stopped" is announced only after the server says stopped. A control that
    // failed must not leave the surface claiming it succeeded.
    const running = status();
    const port: RelayLoopRunPort = {
      status: vi.fn(async (): Promise<RelayLoopRunFetch> => ({ ok: true, status: running })),
      control: vi.fn(async (): Promise<RelayLoopRunFetch> => ({
        ok: false, message: 'The Relay Bridge rejected the credential.',
      })),
    };
    const store = memoryStore({ runId: RUN_ID, loopId: LOOP_ID });
    render(createElement(RelayLoopRunSurface, { port, store }));

    await waitFor(() => expect(screen.getByRole('button', { name: /^stop$/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^stop$/i }));

    await waitFor(() => expect(port.control).toHaveBeenCalled());
    // Re-read, not assumed: the status port is called a second time.
    await waitFor(() => expect((port.status as ReturnType<typeof vi.fn>).mock.calls.length)
      .toBeGreaterThan(1));
    expect(document.body.innerHTML).not.toContain('Stopped');
  });
});
