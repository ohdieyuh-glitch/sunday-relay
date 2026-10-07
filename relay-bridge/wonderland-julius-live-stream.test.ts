import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_JULIUS_PAGE_LIMIT,
  handleWonderlandJuliusRoute,
  type WonderlandJuliusReader,
  type WonderlandJuliusRouteDeps,
} from './wonderland-julius-routes';
import type { BrowserSessionStore } from './browser-session/grants';
import type { WonderlandLedgerRow } from '../src/relay/mission/wonderland/wonderland-ledger-adapter';
import { WONDERLAND_UNAVAILABLE_MESSAGE } from '../src/relay/mission/wonderland/wonderland-authorization';

/**
 * THE JULIUS WORLD TAIL IS LIVE -- BY PAGES.
 *
 * On the branch this file proved a server-sent stream that polled the ledger
 * after connect (until 2026-09-27 it froze at connect time while a heartbeat
 * made the silence look healthy). Main serves the tail as pages only
 * (`mode=page`, row 12): the client -- whose HTTP module has no first-class SSE
 * -- reads the page after its cursor, applies it, and reads again. So the same
 * properties are pinned on the form main serves:
 *
 *   a row appended after the world's last read reaches its next read;
 *   each row exactly once, however many reads find nothing new;
 *   a backlog longer than one page drains page by page;
 *   a read that fails is VISIBLE (503), never an empty page that looks current;
 *   and nothing reads between requests -- no server-side poll, no timer.
 *
 * Plus the one a held stream could not give: membership is asked again on every
 * page, so a world stops reading the moment its player stops being a member.
 */

const PROJECT = 'project-alpha';
const RUN = 'run-1';
const AT = '2026-09-27T12:00:00.000Z';

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
    payload: { runId: RUN, to: sequence % 2 === 0 ? 'REVIEWING' : 'EXECUTING' },
  },
});

/** A ledger the test can append to, or break, between the world's reads. */
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

function deps(reader: WonderlandJuliusReader, member: () => boolean = () => true): WonderlandJuliusRouteDeps {
  return {
    sessions: {
      verifySession: () => ({ ok: true, participantId: 'player-1', sessionId: 's-1', scope: 'browser_control' }),
    } as unknown as BrowserSessionStore,
    world: {
      read: async (work) => work({
        reader,
        membership: { lookup: async ({ playerId, projectId }) => (member() ? { playerId, projectId, role: 'OWNER' } : null) },
        results: { result: async () => null },
      }),
    },
  };
}

const request = (cursor: number, mode: string | null = 'page') => ({
  method: 'GET',
  path: '/wonderland/julius/events',
  url: `/wonderland/julius/events?projectId=${PROJECT}&runId=${RUN}&cursor=${cursor}${mode === null ? '' : `&mode=${mode}`}`,
  authorization: 'Relay-Session tok',
  origin: 'https://sunday-relay.vercel.app',
  now: Date.UTC(2026, 8, 27),
});

/** One page as the world reads it: the sequences delivered and the position the page ended at. */
async function readPage(reader: WonderlandJuliusReader, cursor: number, member?: () => boolean) {
  const answer = await handleWonderlandJuliusRoute(request(cursor), deps(reader, member));
  const data = (answer?.body as { data?: { deliveries: Array<{ envelope: { sequence: number } }>; nextCursor: number } }).data;
  return {
    status: answer?.status,
    ids: data?.deliveries.map((delivery) => delivery.envelope.sequence) ?? [],
    next: data?.nextCursor ?? cursor,
  };
}

describe('the Julius world tail is live, by pages', () => {
  it('delivers a row appended AFTER the world last read -- the frozen-stream regression, in page form', async () => {
    const book = ledger([row(1)]);
    const first = await readPage(book.reader, 0);
    expect(first.ids).toEqual([1]);

    book.append(row(2));
    const second = await readPage(book.reader, first.next);
    expect(second.ids, 'a row written after the last read never reached the world').toEqual([2]);
  });

  it('sends each row exactly once, however many reads find nothing new', async () => {
    const book = ledger([row(1)]);
    const seen: number[] = [];
    let cursor = 0;
    for (let read = 0; read < 6; read += 1) {
      if (read === 3) book.append(row(2));
      const page = await readPage(book.reader, cursor);
      seen.push(...page.ids);
      cursor = page.next;
    }
    expect(book.state.reads).toBe(6);
    expect(seen).toEqual([1, 2]);
  });

  it('drains a backlog longer than one page instead of stopping after the first', async () => {
    const total = WONDERLAND_JULIUS_PAGE_LIMIT + 3;
    const book = ledger(Array.from({ length: total }, (_, i) => row(i + 1)));
    const first = await readPage(book.reader, 0);
    // The first answer is exactly one page; the remainder follows from its cursor.
    expect(first.ids.length).toBe(WONDERLAND_JULIUS_PAGE_LIMIT);
    const rest = await readPage(book.reader, first.next);
    const ids = [...first.ids, ...rest.ids];
    expect(ids.length).toBe(total);
    expect(ids[ids.length - 1]).toBe(total);
    expect(new Set(ids).size, 'no row may be sent twice while draining').toBe(total);
  });

  it('a read that fails is a 503 the world can see, never an empty page that looks current', async () => {
    const book = ledger([row(1)]);
    expect((await readPage(book.reader, 0)).status).toBe(200);
    book.state.broken = true;
    const failed = await handleWonderlandJuliusRoute(request(1), deps(book.reader));
    expect(failed).toEqual({ status: 503, body: { error: WONDERLAND_UNAVAILABLE_MESSAGE } });
  });

  it('nothing reads between requests: no poll, no timer, no stream left behind', async () => {
    const book = ledger([row(1)]);
    await readPage(book.reader, 0);
    const readsAfterAnswer = book.state.reads;
    book.append(row(2));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(book.state.reads).toBe(readsAfterAnswer);
  });

  it('asks membership again on EVERY page: a world stops reading the moment its player is removed', async () => {
    const book = ledger([row(1), row(2)]);
    let member = true;
    const first = await readPage(book.reader, 0, () => member);
    expect(first.ids).toEqual([1, 2]);
    member = false;
    const after = await readPage(book.reader, 0, () => member);
    expect(after.status).toBe(404);
    expect(after.ids).toEqual([]);
  });
});

describe('mode=page -- the only form served', () => {
  it('answers a JSON page: deliveries and the ledger position the page ended at', async () => {
    const book = ledger([row(1), row(2)]);
    const result = await handleWonderlandJuliusRoute(request(0), deps(book.reader));
    expect(result?.status).toBe(200);
    const page = (result?.body as { data: { deliveries: unknown[]; nextCursor: number } }).data;
    expect(page.deliveries).toHaveLength(2);
    expect(page.nextCursor).toBe(2);
  });

  it('refuses the stream form (no mode, or any other mode) without reading anything', async () => {
    const book = ledger([row(1), row(2)]);
    for (const mode of [null, 'stream', 'sse', 'PAGE']) {
      const result = await handleWonderlandJuliusRoute(request(0, mode), deps(book.reader));
      expect(result?.status, String(mode)).toBe(400);
    }
    expect(book.state.reads).toBe(0);
  });
});
