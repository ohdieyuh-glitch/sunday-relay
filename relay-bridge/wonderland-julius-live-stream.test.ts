import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_JULIUS_PAGE_LIMIT,
  handleWonderlandJuliusRoute,
  type WonderlandJuliusReader,
  type WonderlandJuliusRouteDeps,
} from './wonderland-julius-routes';
import type { BrowserSessionStore } from './browser-session/grants';
import type { WonderlandLedgerRow } from '../src/relay/mission/wonderland/wonderland-ledger-adapter';

/**
 * THE JULIUS WORLD STREAM IS LIVE.
 *
 * Until 2026-09-27 /wonderland/julius/events wrote the backlog once and then
 * nothing but heartbeats: nothing fed it after connect, so a world holding it
 * open froze at connect time while the heartbeat made the silence look healthy.
 * The first test below is the one that fails on that code -- a row appended
 * AFTER the client connected must reach the client. The rest pin down what
 * "live" has to mean so it cannot quietly regress: exactly once, the whole of a
 * long backlog, a failed read ending the stream rather than heartbeating over
 * it, and a closed client costing nothing.
 */

const PROJECT = 'project-alpha';
const RUN = 'run-1';
const AT = '2026-09-27T12:00:00.000Z';
const POLL_MS = 15;
const settle = (ms = POLL_MS * 6) => new Promise((resolve) => setTimeout(resolve, ms));

const row = (sequence: number): WonderlandLedgerRow => ({
  eventId: `event-${sequence}`,
  streamId: RUN,
  projectId: PROJECT,
  sequence,
  eventType: 'julius.run.transitioned',
  occurredAt: AT,
  payload: {
    schemaVersion: 'relay-julius-event.v1',
    eventId: `event-${sequence}`,
    streamId: RUN,
    projectId: PROJECT,
    occurredAt: AT,
    payload: { runId: RUN, to: 'EXECUTING' },
  },
});

/** A ledger the test can append to, or break, after the client has connected. */
function ledger(initial: readonly WonderlandLedgerRow[]) {
  const rows = [...initial];
  const state = { reads: 0, broken: false };
  const reader: WonderlandJuliusReader = {
    hydrate: async () => null,
    events: async (input) => {
      state.reads += 1;
      if (state.broken) throw new Error('the database went away');
      return {
        rows: rows.filter((r) => r.sequence > input.afterSequence).slice(0, input.limit),
        revision: 1,
      };
    },
  };
  return { reader, state, append: (r: WonderlandLedgerRow) => rows.push(r) };
}

/** A ServerResponse stand-in that records what the stream wrote. */
function stream() {
  const written: string[] = [];
  const closers: Array<() => void> = [];
  const response = {
    writableEnded: false,
    headWritten: false,
    writeHead() { this.headWritten = true; return this; },
    write(chunk: string) { written.push(chunk); return true; },
    end() { this.writableEnded = true; },
    once(event: string, fn: () => void) { if (event === 'close') closers.push(fn); return this; },
  };
  const ids = () => written.flatMap((w) => [...w.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1])));
  return { response, written, ids, disconnect: () => closers.forEach((fn) => fn()) };
}

function deps(reader: WonderlandJuliusReader, response: unknown): WonderlandJuliusRouteDeps {
  return {
    sessions: {
      verifySession: () => ({ ok: true, participantId: 'player-1', sessionId: 's-1', scope: 'browser_control' }),
    } as unknown as BrowserSessionStore,
    membership: { lookup: async ({ playerId, projectId }) => ({ playerId, projectId, role: 'OWNER' }) },
    reader,
    response: response as WonderlandJuliusRouteDeps['response'],
    heartbeatMs: 60_000,
    pollMs: POLL_MS,
  };
}

const request = (query = '') => ({
  method: 'GET',
  path: '/wonderland/julius/events',
  url: `/wonderland/julius/events?projectId=${PROJECT}&runId=${RUN}&cursor=0${query}`,
  authorization: 'Relay-Session tok',
  origin: 'https://sunday-relay.vercel.app',
  now: Date.UTC(2026, 8, 27),
});

describe('the Julius world stream is live', () => {
  it('delivers a row appended AFTER the client connected -- the frozen-stream regression', async () => {
    const book = ledger([row(1)]);
    const out = stream();
    await handleWonderlandJuliusRoute(request(), deps(book.reader, out.response));
    expect(out.ids()).toEqual([1]);

    book.append(row(2));
    await settle();
    expect(out.ids(), 'a row written after connect never reached the client').toEqual([1, 2]);
    out.disconnect();
  });

  it('sends each row exactly once, however many reads find nothing new', async () => {
    const book = ledger([row(1)]);
    const out = stream();
    await handleWonderlandJuliusRoute(request(), deps(book.reader, out.response));
    book.append(row(2));
    await settle(POLL_MS * 12);
    expect(book.state.reads, 'the stream should have read several times').toBeGreaterThan(4);
    expect(out.ids()).toEqual([1, 2]);
    out.disconnect();
  });

  it('drains a backlog longer than one page instead of stopping after the first', async () => {
    const total = WONDERLAND_JULIUS_PAGE_LIMIT + 3;
    const book = ledger(Array.from({ length: total }, (_, i) => row(i + 1)));
    const out = stream();
    await handleWonderlandJuliusRoute(request(), deps(book.reader, out.response));
    // The first write is exactly one page; the remainder must follow.
    expect(out.ids().length).toBe(WONDERLAND_JULIUS_PAGE_LIMIT);
    await settle();
    const ids = out.ids();
    expect(ids.length).toBe(total);
    expect(ids[ids.length - 1]).toBe(total);
    expect(new Set(ids).size, 'no row may be sent twice while draining').toBe(total);
    out.disconnect();
  });

  it('a read that fails ENDS the stream, rather than heartbeating over a dead reader', async () => {
    const book = ledger([row(1)]);
    const out = stream();
    await handleWonderlandJuliusRoute(request(), deps(book.reader, out.response));
    expect(out.response.writableEnded).toBe(false);
    book.state.broken = true;
    await settle();
    expect(out.response.writableEnded, 'the stream kept going over a reader that cannot answer').toBe(true);
  });

  it('a disconnected client stops the reads', async () => {
    const book = ledger([row(1)]);
    const out = stream();
    await handleWonderlandJuliusRoute(request(), deps(book.reader, out.response));
    out.disconnect();
    const readsAtClose = book.state.reads;
    book.append(row(2));
    await settle();
    expect(book.state.reads).toBe(readsAtClose);
    expect(out.ids()).toEqual([1]);
  });
});

describe('mode=page -- one page, for a client that cannot hold a stream open', () => {
  it('answers a JSON page even when a stream could be opened, and opens none', async () => {
    const book = ledger([row(1), row(2)]);
    const out = stream();
    const result = await handleWonderlandJuliusRoute(request('&mode=page'), deps(book.reader, out.response));
    expect(out.response.headWritten, 'page mode must not open a stream').toBe(false);
    expect(result?.status).toBe(200);
    const page = (result?.body as { data: { deliveries: unknown[]; nextCursor: number } }).data;
    expect(page.deliveries).toHaveLength(2);
    expect(page.nextCursor).toBe(2);
  });

  it('serves exactly what the stream would send first', async () => {
    const pageBook = ledger([row(1), row(2)]);
    const pageResult = await handleWonderlandJuliusRoute(request('&mode=page'), deps(pageBook.reader, stream().response));
    const streamBook = ledger([row(1), row(2)]);
    const out = stream();
    await handleWonderlandJuliusRoute(request(), deps(streamBook.reader, out.response));
    const streamed = out.written
      .filter((w) => w.startsWith('id: '))
      .map((w) => JSON.parse(w.slice(w.indexOf('data: ') + 6)));
    expect((pageResult?.body as { data: { deliveries: unknown[] } }).data.deliveries).toEqual(streamed);
    out.disconnect();
  });
});
