import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { WonderlandLffBoard } from '../mission/wonderland/wonderland-lff';
import { createWonderlandLffFileStore } from './wonderland-lff-file-store';

const NOW = '2026-10-23T16:00:00.000Z';
const roots: string[] = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'relay-lff-'));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function ids(): () => string {
  let n = 0;
  return () => `lff_${++n}`;
}

const post = {
  category: 'teams',
  title: 'Need a team',
  body: 'Sunday build.',
  displayName: 'Ada',
  contactMethod: 'in_world_message',
  contactValue: 'ada-tower',
  lifetimeHours: 1,
};

describe('Looking for Feed file store', () => {
  it('AC-15 a restarted file store still has listings and requests, and expiry still holds', () => {
    const dir = root();
    const first = new WonderlandLffBoard(ids(), createWonderlandLffFileStore({ root: dir }));
    const created = first.create('ada', post, NOW);
    if (!created.ok) throw new Error(created.code);
    const asked = first.createRequest('bao', created.value.listingId, { message: 'I can play.', displayName: 'Bao' }, NOW);
    if (!asked.ok) throw new Error(asked.code);
    const kept = first.create('ada', { ...post, category: 'builders', title: 'Need builders', lifetimeHours: 24 }, NOW);
    if (!kept.ok) throw new Error(kept.code);
    const withdrawn = first.close('ada', kept.value.listingId, {}, NOW);
    if (!withdrawn.ok) throw new Error(withdrawn.code);

    const second = new WonderlandLffBoard(() => 'not-used', createWonderlandLffFileStore({ root: dir }));
    const seen = second.get('cam', created.value.listingId, NOW);
    if (!seen.ok) throw new Error(seen.code);
    expect(seen.value).toMatchObject({ title: 'Need a team', authorId: 'ada', status: 'open', contactValue: 'ada-tower' });
    const requests = second.listRequests('ada', NOW);
    if (!requests.ok) throw new Error(requests.code);
    expect(requests.value.requests.map((row) => row.requestId)).toEqual([asked.value.requestId]);
    const authorWithdrawn = second.get('ada', kept.value.listingId, NOW);
    if (!authorWithdrawn.ok) throw new Error(authorWithdrawn.code);
    expect(authorWithdrawn.value.status).toBe('withdrawn');

    const expired = second.list('cam', undefined, created.value.expiresAt);
    if (!expired.ok) throw new Error(expired.code);
    expect(expired.value.listings).toEqual([]);
    const marked = second.get('ada', created.value.listingId, created.value.expiresAt);
    if (!marked.ok) throw new Error(marked.code);
    expect(marked.value.status).toBe('expired');

    const third = new WonderlandLffBoard(() => 'not-used', createWonderlandLffFileStore({ root: dir }));
    const still = third.get('ada', created.value.listingId, NOW);
    if (!still.ok) throw new Error(still.code);
    expect(still.value.status).toBe('expired');
    const feed = third.list('bao', 'teams', NOW);
    if (!feed.ok) throw new Error(feed.code);
    expect(feed.value.listings).toEqual([]);
    const stillAsked = third.listRequests('bao', NOW);
    if (!stillAsked.ok) throw new Error(stillAsked.code);
    expect(stillAsked.value.requests).toHaveLength(1);
  });

  it('AC-15 a corrupt snapshot is not loaded as an empty board', () => {
    const dir = root();
    const folder = join(dir, 'wonderland-lff');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'board.json'), '{not json', 'utf8');
    writeFileSync(join(folder, 'board.previous.json'), '{also bad', 'utf8');
    const board = new WonderlandLffBoard(ids(), createWonderlandLffFileStore({ root: dir }));
    const created = board.create('ada', post, NOW);
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.code).toBe('store_corrupt');
    expect(readFileSync(join(folder, 'board.json'), 'utf8')).toBe('{not json');
  });
});
