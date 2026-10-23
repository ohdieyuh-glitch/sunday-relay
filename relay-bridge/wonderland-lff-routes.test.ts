import { describe, expect, it } from 'vitest';

import { WonderlandLffBoard } from '../src/relay/mission/wonderland/wonderland-lff';
import { handleLffHttp, LFF_ROUTE_TEMPLATES, type LffHttpResponse } from './wonderland-lff-routes';

const NOW = '2026-10-23T16:00:00.000Z';

function board(): WonderlandLffBoard {
  let n = 0;
  return new WonderlandLffBoard(() => `lff_${++n}`);
}

function call(
  feed: WonderlandLffBoard,
  method: string,
  path: string,
  actorId: string,
  body?: unknown,
  query?: Record<string, string | undefined>,
  nowIso = NOW,
): LffHttpResponse {
  return handleLffHttp(feed, { method, path, actorId, body, query, nowIso });
}

const post = {
  category: 'teams',
  title: 'Need a team',
  body: 'Sunday build.',
  displayName: 'Ada',
  contactMethod: 'in_world_message',
  contactValue: 'ada-tower',
};

describe('Looking for Feed routes', () => {
  it('AC-10 every documented LFF path is served', () => {
    expect(LFF_ROUTE_TEMPLATES).toEqual([
      { method: 'GET', template: '/lff/posts' },
      { method: 'POST', template: '/lff/posts' },
      { method: 'GET', template: '/lff/requests' },
      { method: 'GET', template: '/lff/posts/:id' },
      { method: 'POST', template: '/lff/posts/:id/edit' },
      { method: 'POST', template: '/lff/posts/:id/close' },
      { method: 'POST', template: '/lff/posts/:id/delete' },
      { method: 'GET', template: '/lff/posts/:id/requests' },
      { method: 'POST', template: '/lff/posts/:id/requests' },
      { method: 'POST', template: '/lff/requests/:id/withdraw' },
      { method: 'POST', template: '/lff/requests/:id/accept' },
      { method: 'POST', template: '/lff/requests/:id/decline' },
    ]);
    const feed = board();
    for (const route of LFF_ROUTE_TEMPLATES) {
      const path = route.template.replace(':id', 'abc');
      const response = call(feed, route.method, path, 'ada', {});
      if (!response.body.ok) {
        expect(response.body.error.code).not.toBe('no_such_route');
      }
      expect(response.status).not.toBe(405);
    }
  });

  it('AC-10 the social prefix and a hostile path', () => {
    const feed = board();
    const prefixed = call(feed, 'GET', '/wonderland/social/lff/posts', 'ada');
    expect(prefixed.status).toBe(200);
    expect(prefixed.body.ok).toBe(true);
    expect(call(feed, 'GET', '/lff/posts/%2e%2e/secret', 'ada').status).toBe(400);
    expect(call(feed, 'PUT', '/lff/posts', 'ada').status).toBe(405);
    expect(call(feed, 'GET', '/lff/missing', 'ada').body).toMatchObject({ ok: false, error: { code: 'no_such_route' } });
  });

  it('AC-3 a category query on the route filters the feed', () => {
    const feed = board();
    call(feed, 'POST', '/lff/posts', 'ada', post);
    call(feed, 'POST', '/lff/posts', 'bao', { ...post, category: 'builders', displayName: 'Bao' });
    const teams = call(feed, 'GET', '/wonderland/social/lff/posts', 'cam', undefined, { category: 'teams' });
    expect(teams.status).toBe(200);
    if (!teams.body.ok) throw new Error('expected the teams feed');
    const result = teams.body.result as { category: string; listings: { category: string }[] };
    expect(result.category).toBe('teams');
    expect(result.listings.map((row) => row.category)).toEqual(['teams']);
    expect(call(feed, 'GET', '/lff/posts', 'cam', undefined, { category: '' }).status).toBe(400);
  });

  it('AC-9 a second caller sees a listing through the route and loses it after close', () => {
    const feed = board();
    const created = call(feed, 'POST', '/lff/posts', 'ada', post);
    expect(created.status).toBe(201);
    if (!created.body.ok) throw new Error('create failed');
    const listingId = (created.body.result as { listingId: string }).listingId;
    const seen = call(feed, 'GET', '/lff/posts', 'bao', undefined, { category: 'teams' });
    if (!seen.body.ok) throw new Error('list failed');
    expect((seen.body.result as { listings: { listingId: string; authorDisplayName: string; contactValue: string }[] }).listings).toEqual([
      expect.objectContaining({ listingId, authorDisplayName: 'Ada', contactValue: 'ada-tower' }),
    ]);
    const edited = call(feed, 'POST', `/lff/posts/${listingId}/edit`, 'ada', { title: 'Renamed team' });
    expect(edited.status).toBe(200);
    expect(call(feed, 'POST', `/lff/posts/${listingId}/close`, 'bao', {}).status).toBe(403);
    expect(call(feed, 'POST', `/lff/posts/${listingId}/close`, 'ada', {}).status).toBe(200);
    const after = call(feed, 'GET', '/lff/posts', 'bao');
    if (!after.body.ok) throw new Error('list failed');
    expect((after.body.result as { listings: unknown[] }).listings).toEqual([]);
    expect(call(feed, 'GET', `/lff/posts/${listingId}`, 'ada').body).toMatchObject({ ok: true, result: { status: 'withdrawn' } });
    expect(call(feed, 'GET', `/lff/posts/${listingId}`, 'bao').status).toBe(404);
  });

  it('AC-10 create, update, withdraw, delete, expiry, and requests round-trip', () => {
    const feed = board();
    const created = call(feed, 'POST', '/lff/posts', 'ada', { ...post, lifetimeHours: 1 });
    if (!created.body.ok) throw new Error('create failed');
    const listingId = (created.body.result as { listingId: string; expiresAt: string }).listingId;
    const expiresAt = (created.body.result as { expiresAt: string }).expiresAt;
    const asked = call(feed, 'POST', `/lff/posts/${listingId}/requests`, 'bao', { message: 'Counting me in.', displayName: 'Bao' });
    expect(asked.status).toBe(201);
    if (!asked.body.ok) throw new Error('request failed');
    const requestId = (asked.body.result as { requestId: string }).requestId;
    expect(call(feed, 'GET', `/lff/posts/${listingId}/requests`, 'dee').status).toBe(403);
    expect(call(feed, 'POST', `/lff/requests/${requestId}/accept`, 'ada', {}).body).toMatchObject({ ok: true, result: { status: 'accepted' } });
    expect(call(feed, 'GET', '/lff/requests', 'cam').body).toMatchObject({ ok: true, result: { requests: [] } });
    const expired = call(feed, 'GET', '/lff/posts', 'bao', undefined, undefined, expiresAt);
    if (!expired.body.ok) throw new Error('expired list failed');
    expect((expired.body.result as { listings: unknown[] }).listings).toEqual([]);
    const second = call(feed, 'POST', '/lff/posts', 'ada', post, undefined, expiresAt);
    if (!second.body.ok) throw new Error('second create failed');
    const secondId = (second.body.result as { listingId: string }).listingId;
    expect(call(feed, 'POST', `/lff/posts/${secondId}/delete`, 'ada', {}, undefined, expiresAt).body).toMatchObject({
      ok: true,
      result: { deleted: true, listingId: secondId },
    });
    expect(call(feed, 'GET', `/lff/posts/${secondId}`, 'ada', undefined, undefined, expiresAt).status).toBe(404);
  });

  it('AC-10 a mismatched actor is refused on the route', () => {
    const response = call(board(), 'POST', '/lff/posts', 'ada', { ...post, authorId: 'bao' });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ ok: false, error: { code: 'actor_mismatch' } });
  });
});
