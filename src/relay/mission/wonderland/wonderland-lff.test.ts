import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  LFF_CATEGORIES,
  LFF_CATEGORY_LABELS,
  LFF_LIMITS,
  LFF_SCHEMA_V1,
  WonderlandLffBoard,
  type LffCategory,
  type LffResult,
} from './wonderland-lff';

const NOW = '2026-10-23T16:00:00.000Z';
const HOUR = 60 * 60 * 1000;

function board(ids: () => string = sequentialIds()): WonderlandLffBoard {
  return new WonderlandLffBoard(ids);
}

function sequentialIds(): () => string {
  let n = 0;
  return () => `lff_${++n}`;
}

function take<T>(result: LffResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.value;
}

function code(result: LffResult<unknown>): string {
  return result.ok ? 'ok' : result.code;
}

const postBody = (category: LffCategory, extra: Record<string, unknown> = {}) => ({
  category,
  title: `Need ${category}`,
  body: `A ${category} note for the feed.`,
  displayName: 'Ada',
  contactMethod: 'in_world_message',
  contactValue: 'ada-tower',
  ...extra,
});

describe('Looking for Feed, proposed contract', () => {
  it('AC-1 the five categories are closed and labeled', () => {
    expect([...LFF_CATEGORIES]).toEqual(['teams', 'builders', 'ai_engineers', 'designers', 'competitors']);
    expect(LFF_CATEGORY_LABELS).toEqual({
      teams: 'Looking for Teams',
      builders: 'Looking for Builders',
      ai_engineers: 'Looking for AI Engineers',
      designers: 'Looking for Designers',
      competitors: 'Looking for Competitors',
    });
    const feed = board();
    expect(code(feed.create('ada', postBody('teams', { category: 'scouts' }), NOW))).toBe('invalid_category');
    expect(code(feed.create('ada', postBody('teams', { category: '' }), NOW))).toBe('invalid_category');
    expect(take(feed.list('ada', undefined, NOW)).listings).toEqual([]);
  });

  it('AC-2 create stores an open listing posted by the caller', () => {
    const feed = board();
    const created = take(feed.create('ada', postBody('builders', { authorId: 'ada' }), NOW));
    expect(created).toMatchObject({
      schemaVersion: LFF_SCHEMA_V1,
      listingId: 'lff_1',
      category: 'builders',
      categoryLabel: 'Looking for Builders',
      title: 'Need builders',
      authorId: 'ada',
      authorDisplayName: 'Ada',
      contactMethod: 'in_world_message',
      contactLabel: 'In-world message',
      contactValue: 'ada-tower',
      status: 'open',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(created.expiresAt).toBe('2026-10-26T16:00:00.000Z');
    expect(take(feed.get('bao', created.listingId, NOW)).authorId).toBe('ada');
  });

  it('AC-3 each of the five category filters returns only that category', () => {
    const feed = board();
    const posters = ['ada', 'bao', 'cam', 'dee', 'elo'] as const;
    LFF_CATEGORIES.forEach((category, index) => {
      take(feed.create(posters[index], postBody(category, { displayName: posters[index] }), NOW));
    });
    const all = take(feed.list('zed', undefined, NOW));
    expect(all.category).toBeNull();
    expect(all.listings.map((row) => row.category)).toEqual([...LFF_CATEGORIES]);
    for (const category of LFF_CATEGORIES) {
      const filtered = take(feed.list('zed', category, NOW));
      expect(filtered.category).toBe(category);
      expect(filtered.listings).toHaveLength(1);
      expect(filtered.listings[0]?.category).toBe(category);
      expect(filtered.listings[0]?.categoryLabel).toBe(LFF_CATEGORY_LABELS[category]);
    }
  });

  it('AC-3 an unknown category is rejected, not an empty feed', () => {
    const feed = board();
    take(feed.create('ada', postBody('teams'), NOW));
    const rejected = feed.list('bao', 'scouts', NOW);
    expect(code(rejected)).toBe('invalid_category');
    expect(take(feed.list('bao', undefined, NOW)).listings).toHaveLength(1);
  });

  it('AC-4 a listing view names who posted and how to connect', () => {
    const created = take(board().create('ada', postBody('designers', {
      displayName: 'Ada Lovelace',
      contactMethod: 'party_invite',
      contactValue: 'party-lff',
    }), NOW));
    expect(created.authorId).toBe('ada');
    expect(created.authorDisplayName).toBe('Ada Lovelace');
    expect(created.contactMethod).toBe('party_invite');
    expect(created.contactLabel).toBe('Party invite');
    expect(created.contactValue).toBe('party-lff');
    expect(Object.keys(created)).not.toEqual(expect.arrayContaining(['privateServer', 'gve', 'serverId']));
  });

  it('AC-5 the author can update an open listing', () => {
    const feed = board();
    const created = take(feed.create('ada', postBody('teams'), NOW));
    const updated = take(feed.edit('ada', created.listingId, {
      title: '  Renamed  ',
      body: 'Bring a builder.',
      displayName: 'Ada L',
      category: 'builders',
      contactMethod: 'profile',
      contactValue: 'ada',
      lifetimeHours: 1,
    }, NOW));
    expect(updated.title).toBe('Renamed');
    expect(updated.body).toBe('Bring a builder.');
    expect(updated.authorDisplayName).toBe('Ada L');
    expect(updated.category).toBe('builders');
    expect(updated.contactMethod).toBe('profile');
    expect(updated.contactValue).toBe('ada');
    expect(updated.expiresAt).toBe('2026-10-23T17:00:00.000Z');
    expect(updated.authorId).toBe('ada');
  });

  it('AC-5 another player cannot update, withdraw, or delete an open listing', () => {
    const feed = board();
    const created = take(feed.create('ada', postBody('teams'), NOW));
    expect(code(feed.edit('bao', created.listingId, { title: 'Stolen' }, NOW))).toBe('not_author');
    expect(code(feed.close('bao', created.listingId, {}, NOW))).toBe('not_author');
    expect(code(feed.delete('bao', created.listingId, {}, NOW))).toBe('not_author');
    expect(take(feed.get('bao', created.listingId, NOW)).title).toBe('Need teams');
  });

  it('AC-6 withdraw removes the listing from every open feed', () => {
    const feed = board();
    const created = take(feed.create('ada', postBody('competitors'), NOW));
    take(feed.create('bao', postBody('teams', { displayName: 'Bao' }), NOW));
    const withdrawn = take(feed.close('ada', created.listingId, {}, NOW));
    expect(withdrawn.status).toBe('withdrawn');
    expect(take(feed.list('ada', undefined, NOW)).listings.map((row) => row.authorId)).toEqual(['bao']);
    expect(take(feed.list('bao', undefined, NOW)).listings.map((row) => row.authorId)).toEqual(['bao']);
  });

  it('AC-6 the author can still read a withdrawn listing and other players cannot', () => {
    const feed = board();
    const created = take(feed.create('ada', postBody('teams'), NOW));
    take(feed.close('ada', created.listingId, {}, NOW));
    expect(take(feed.get('ada', created.listingId, NOW)).status).toBe('withdrawn');
    expect(code(feed.get('bao', created.listingId, NOW))).toBe('not_found');
    expect(code(feed.edit('ada', created.listingId, { title: 'Again' }, NOW))).toBe('not_open');
  });

  it('AC-6 delete removes the listing for the author as well', () => {
    const feed = board();
    const created = take(feed.create('ada', postBody('teams'), NOW));
    expect(take(feed.delete('ada', created.listingId, {}, NOW))).toEqual({
      schemaVersion: LFF_SCHEMA_V1,
      listingId: created.listingId,
      deleted: true,
    });
    expect(code(feed.get('ada', created.listingId, NOW))).toBe('not_found');
    expect(take(feed.list('bao', undefined, NOW)).listings).toEqual([]);
  });

  it('AC-7 at expiresAt the listing leaves the open feed marked expired', () => {
    const feed = board();
    const created = take(feed.create('ada', postBody('ai_engineers', { lifetimeHours: 1 }), NOW));
    const atExpiry = created.expiresAt;
    expect(take(feed.list('bao', undefined, atExpiry)).listings).toEqual([]);
    const expired = take(feed.get('ada', created.listingId, atExpiry));
    expect(expired.status).toBe('expired');
    expect(expired.status).not.toBe('withdrawn');
    expect(code(feed.get('bao', created.listingId, atExpiry))).toBe('not_found');
  });

  it('AC-7 a moment before expiresAt the listing is still open', () => {
    const feed = board();
    const created = take(feed.create('ada', postBody('teams', { lifetimeHours: 1 }), NOW));
    const justBefore = new Date(Date.parse(created.expiresAt) - 1).toISOString();
    expect(take(feed.get('bao', created.listingId, justBefore)).status).toBe('open');
    expect(take(feed.list('bao', 'teams', justBefore)).listings).toHaveLength(1);
  });

  it('AC-8 per-player and per-category caps are enforced', () => {
    const feed = board();
    take(feed.create('ada', postBody('teams'), NOW));
    expect(code(feed.create('ada', postBody('teams', { title: 'Second team' }), NOW))).toBe('category_cap');
    take(feed.create('ada', postBody('builders'), NOW));
    take(feed.create('ada', postBody('designers'), NOW));
    expect(code(feed.create('ada', postBody('competitors'), NOW))).toBe('listing_cap');
    expect(take(feed.list('bao', undefined, NOW)).listings).toHaveLength(3);
  });

  it('AC-8 an expired listing frees the player\'s open-listing cap', () => {
    const feed = board();
    const first = take(feed.create('ada', postBody('teams', { lifetimeHours: 1 }), NOW));
    take(feed.create('ada', postBody('builders', { lifetimeHours: 24 }), NOW));
    take(feed.create('ada', postBody('designers', { lifetimeHours: 24 }), NOW));
    const again = take(feed.create('ada', postBody('teams', { title: 'After expiry' }), first.expiresAt));
    expect(again.status).toBe('open');
    expect(again.category).toBe('teams');
  });

  it('AC-8 text length, blank text, and control characters are refused', () => {
    const feed = board();
    expect(code(feed.create('ada', postBody('teams', { title: 'x'.repeat(LFF_LIMITS.titleMax) }), NOW))).toBe('ok');
    expect(code(feed.create('bao', postBody('teams', { title: 'x'.repeat(LFF_LIMITS.titleMax + 1), displayName: 'Bao' }), NOW))).toBe('invalid_text');
    expect(code(feed.create('bao', postBody('teams', { body: 'y'.repeat(LFF_LIMITS.bodyMax + 1), displayName: 'Bao' }), NOW))).toBe('invalid_text');
    expect(code(feed.create('bao', postBody('teams', { displayName: 'n'.repeat(LFF_LIMITS.displayNameMax + 1) }), NOW))).toBe('invalid_text');
    expect(code(feed.create('bao', postBody('teams', { contactValue: 'c'.repeat(LFF_LIMITS.contactValueMax + 1), displayName: 'Bao' }), NOW))).toBe('invalid_text');
    expect(code(feed.create('bao', postBody('teams', { title: '   ', displayName: 'Bao' }), NOW))).toBe('invalid_text');
    const named = take(feed.create('cam', postBody('builders', { title: '  Trimmed  ', displayName: 'Cam' }), NOW));
    expect(named.title).toBe('Trimmed');
    expect(code(feed.create('dee', postBody('designers', { title: '名前', displayName: 'Dee' }), NOW))).toBe('ok');
    for (const point of [0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x7f, 0x2028, 0x2029]) {
      const control = String.fromCodePoint(point);
      expect(code(feed.create('elo', postBody('competitors', { title: `Go${control}od`, displayName: 'Elo' }), NOW))).toBe('invalid_text');
      expect(code(feed.create('elo', postBody('competitors', { body: `Tail${control}`, displayName: 'Elo' }), NOW))).toBe('invalid_text');
    }
  });

  it('AC-8 lifetime defaults to 72 hours and rejects out-of-range values', () => {
    const feed = board();
    const created = take(feed.create('ada', postBody('teams'), NOW));
    expect(Date.parse(created.expiresAt) - Date.parse(NOW)).toBe(LFF_LIMITS.defaultLifetimeHours * HOUR);
    expect(code(feed.create('bao', postBody('teams', { lifetimeHours: 0, displayName: 'Bao' }), NOW))).toBe('invalid_lifetime');
    expect(code(feed.create('bao', postBody('teams', { lifetimeHours: 169, displayName: 'Bao' }), NOW))).toBe('invalid_lifetime');
    expect(code(feed.create('bao', postBody('teams', { lifetimeHours: 1.5, displayName: 'Bao' }), NOW))).toBe('invalid_lifetime');
    expect(take(feed.create('bao', postBody('teams', { lifetimeHours: 168, displayName: 'Bao' }), NOW)).expiresAt).toBe('2026-10-30T16:00:00.000Z');
  });

  it('AC-8 a body that names a different actor is refused', () => {
    const feed = board();
    expect(code(feed.create('ada', postBody('teams', { authorId: 'bao' }), NOW))).toBe('actor_mismatch');
    const created = take(feed.create('ada', postBody('teams'), NOW));
    expect(code(feed.close('ada', created.listingId, { posterId: 'bao' }, NOW))).toBe('actor_mismatch');
    expect(take(feed.get('bao', created.listingId, NOW)).status).toBe('open');
  });

  it('AC-8 an unexpected field is refused', () => {
    expect(code(board().create('ada', postBody('teams', { note: 'hidden' }), NOW))).toBe('invalid_body');
  });

  it('AC-8 nowIso must be a real UTC timestamp', () => {
    const feed = board();
    expect(code(feed.create('ada', postBody('teams'), 'yesterday'))).toBe('invalid_time');
    expect(code(feed.create('ada', postBody('teams'), '2026-02-31T00:00:00.000Z'))).toBe('invalid_time');
    expect(code(feed.list('ada', undefined, '2026-10-23T16:00:00Z'))).toBe('ok');
  });

  it('AC-8 a profile contact must be the caller', () => {
    const feed = board();
    expect(code(feed.create('ada', postBody('teams', { contactMethod: 'profile', contactValue: 'bao' }), NOW))).toBe('invalid_contact');
    expect(take(feed.create('ada', postBody('teams', { contactMethod: 'profile', contactValue: 'ada' }), NOW)).contactValue).toBe('ada');
  });

  it('AC-8 the id generator cannot store an unsafe id', () => {
    expect(code(board(() => 'bad/id').create('ada', postBody('teams'), NOW))).toBe('invalid_id');
    const stuck = board(() => 'lff_same');
    expect(take(stuck.create('ada', postBody('teams'), NOW)).listingId).toBe('lff_same');
    expect(code(stuck.create('bao', postBody('builders', { displayName: 'Bao' }), NOW))).toBe('invalid_id');
  });

  it('AC-9 another player sees a new listing and stops seeing it when it is withdrawn', () => {
    const feed = board();
    const created = take(feed.create('ada', postBody('ai_engineers'), NOW));
    expect(take(feed.list('bao', 'ai_engineers', NOW)).listings.map((row) => row.listingId)).toEqual([created.listingId]);
    take(feed.close('ada', created.listingId, {}, NOW));
    expect(take(feed.list('bao', 'ai_engineers', NOW)).listings).toEqual([]);
    expect(take(feed.list('ada', undefined, NOW)).listings).toEqual([]);
  });

  it('AC-9 another player stops seeing a listing when it expires', () => {
    const feed = board();
    const kept = take(feed.create('bao', postBody('teams', { displayName: 'Bao', lifetimeHours: 24 }), NOW));
    const created = take(feed.create('ada', postBody('designers', { lifetimeHours: 1 }), NOW));
    expect(take(feed.list('cam', undefined, created.expiresAt)).listings.map((row) => row.listingId)).toEqual([kept.listingId]);
  });

  it('AC-11 a request can be accepted, declined, or withdrawn, and a third player does not see it', () => {
    const feed = board();
    const listing = take(feed.create('ada', postBody('builders'), NOW));
    const fromBao = take(feed.createRequest('bao', listing.listingId, { message: 'I can build this.', displayName: 'Bao' }, NOW));
    const fromCam = take(feed.createRequest('cam', listing.listingId, { message: 'I can too.', displayName: 'Cam' }, NOW));
    expect(code(feed.createRequest('ada', listing.listingId, { message: 'Mine', displayName: 'Ada' }, NOW))).toBe('cannot_request_own');
    expect(take(feed.listRequests('dee', NOW)).requests).toEqual([]);
    expect(code(feed.listPostRequests('dee', listing.listingId, NOW))).toBe('not_involved');
    expect(take(feed.listPostRequests('bao', listing.listingId, NOW)).requests.map((row) => row.requestId)).toEqual([fromBao.requestId]);
    expect(take(feed.listPostRequests('ada', listing.listingId, NOW)).requests).toHaveLength(2);
    const accepted = take(feed.acceptRequest('ada', fromBao.requestId, {}, NOW));
    expect(accepted.status).toBe('accepted');
    expect(accepted.contactValue).toBe('ada-tower');
    expect(code(feed.acceptRequest('bao', fromBao.requestId, {}, NOW))).toBe('not_author');
    expect(code(feed.acceptRequest('bao', fromCam.requestId, {}, NOW))).toBe('not_found');
    expect(code(feed.acceptRequest('elo', fromCam.requestId, {}, NOW))).toBe('not_found');
    const declined = take(feed.declineRequest('ada', fromCam.requestId, {}, NOW));
    expect(declined.status).toBe('declined');
    const again = take(feed.createRequest('cam', listing.listingId, { message: 'Once more.', displayName: 'Cam' }, NOW));
    expect(take(feed.withdrawRequest('cam', again.requestId, {}, NOW)).status).toBe('withdrawn');
    expect(code(feed.withdrawRequest('ada', again.requestId, {}, NOW))).toBe('not_requester');
    expect(code(feed.acceptRequest('ada', fromBao.requestId, {}, NOW))).toBe('request_not_open');
  });

  it('AC-11 accepting a request does not add a private server or GVE field', () => {
    const feed = board();
    const listing = take(feed.create('ada', postBody('competitors'), NOW));
    const request = take(feed.createRequest('bao', listing.listingId, { message: 'Ready.', displayName: 'Bao' }, NOW));
    const accepted = take(feed.acceptRequest('ada', request.requestId, {}, NOW));
    expect(Object.keys(accepted)).not.toEqual(expect.arrayContaining(['privateServer', 'privateServerId', 'gve', 'gveId']));
    expect(accepted).not.toHaveProperty('privateServer');
    expect(accepted).not.toHaveProperty('gve');
  });

  it('AC-11 request caps and a second open request are refused', () => {
    const feed = board();
    const listings = Array.from({ length: LFF_LIMITS.maxOpenRequestsPerPlayer + 1 }, (_, index) => {
      const author = `p${index}`;
      return take(feed.create(author, postBody('teams', { displayName: author }), NOW)).listingId;
    });
    for (let index = 0; index < LFF_LIMITS.maxOpenRequestsPerPlayer; index += 1) {
      take(feed.createRequest('bao', listings[index]!, { message: `Request ${index}`, displayName: 'Bao' }, NOW));
    }
    expect(code(feed.createRequest('bao', listings[LFF_LIMITS.maxOpenRequestsPerPlayer]!, { message: 'One more', displayName: 'Bao' }, NOW))).toBe('request_cap');
    expect(code(feed.createRequest('bao', listings[0]!, { message: 'Again', displayName: 'Bao' }, NOW))).toBe('request_exists');
  });

  it('AC-12 a private server or GVE field is refused', () => {
    const feed = board();
    for (const key of ['privateServer', 'privateServerId', 'gve', 'gveId', 'serverKind', 'serverId']) {
      expect(code(feed.create('ada', postBody('teams', { [key]: 'hidden' }), NOW))).toBe('out_of_scope');
    }
    expect(take(feed.list('bao', undefined, NOW)).listings).toEqual([]);
  });

  it('AC-14 the domain module does not define a readiness score', () => {
    const source = readFileSync(new URL('./wonderland-lff.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/readiness/i);
    expect(source).not.toMatch(/scorecard/i);
  });

  it('AC-14 the contract doc is marked PROPOSED and claims no readiness change', () => {
    const doc = readFileSync(new URL('../../../../docs/relay/WONDERLAND_LFF.md', import.meta.url), 'utf8');
    expect(doc.startsWith('# Wonderland Looking for Feed')).toBe(true);
    expect(doc).toContain('PROPOSED, pending acceptance');
    expect(doc).toContain('no readiness change');
    expect(doc).not.toMatch(/\b\d{1,3}%/);
  });
});
