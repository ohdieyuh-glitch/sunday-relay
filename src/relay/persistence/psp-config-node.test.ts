import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createPspConfigStore, type SavedPsp } from './psp-config-node';
import { defaultMissionConfig } from '../mission/mission-config';

/**
 * SAVED PSP PROFILES — durable, participant-owned, and never crossing owners.
 * The store round-trips, survives a restart, isolates each owner's list, and
 * refuses a corrupt or hand-tampered file (a config that no longer validates is
 * not loadable). Remove the owner check and "one owner never sees another's" fails.
 */

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) { try { rmSync(r, { recursive: true, force: true }); } catch { /* best effort */ } } });
function root(): string { const r = mkdtempSync(join(tmpdir(), 'relay-psp-')); roots.push(r); return r; }

const psp = (owner: string, pspId: string, name: string, over: Partial<SavedPsp> = {}): SavedPsp => ({
  pspId, name, ownerParticipant: owner,
  config: { ...defaultMissionConfig(), mode: 'autonomous', limits: { ...defaultMissionConfig().limits, spendUsd: 2 } },
  updatedAt: '2026-08-12T12:00:00.000Z',
  ...over,
});

describe('a saved PSP round-trips and survives a restart', () => {
  it('is read back by a brand-new store over the same root', () => {
    const r = root();
    createPspConfigStore({ root: r }).save(psp('ghu-42', 'default', 'My Default'));
    const loaded = createPspConfigStore({ root: r }).load('ghu-42', 'default');
    expect(loaded?.name).toBe('My Default');
    expect(loaded?.config.mode).toBe('autonomous');
    expect(loaded?.config.limits.spendUsd).toBe(2);
  });

  it('lists only the owner’s PSPs, sorted by name', () => {
    const r = root(); const store = createPspConfigStore({ root: r });
    store.save(psp('ghu-42', 'b', 'Beta'));
    store.save(psp('ghu-42', 'a', 'Alpha'));
    store.save(psp('ghu-99', 'x', 'Someone Else'));
    expect(store.list('ghu-42').map((p) => p.name)).toEqual(['Alpha', 'Beta']);
    expect(store.list('ghu-99').map((p) => p.name)).toEqual(['Someone Else']);
  });
});

describe('one participant never sees or loads another participant’s PSP', () => {
  it('load refuses across owners', () => {
    const r = root(); const store = createPspConfigStore({ root: r });
    store.save(psp('ghu-42', 'secret', 'Alice private'));
    expect(store.load('ghu-99', 'secret')).toBeNull();
    expect(store.list('ghu-99')).toEqual([]);
  });
});

describe('absent is empty; corrupt/tampered is refused; never a crash', () => {
  it('returns null/empty for an unknown owner or id', () => {
    const store = createPspConfigStore({ root: root() });
    expect(store.load('ghu-42', 'nope')).toBeNull();
    expect(store.list('ghu-42')).toEqual([]);
  });

  it('skips a file whose config no longer validates (a tampered limit)', () => {
    const r = root();
    const dir = join(r, 'psp-configs', encodeURIComponent('ghu-42'));
    mkdirSync(dir, { recursive: true });
    // A negative spend limit is not a valid config — the store must refuse to load it.
    writeFileSync(join(dir, 'tampered.json'), JSON.stringify({
      pspId: 'tampered', name: 'x', ownerParticipant: 'ghu-42', updatedAt: '2026-08-12T00:00:00.000Z',
      config: { limits: { spendUsd: -100 } },
    }));
    expect(createPspConfigStore({ root: r }).load('ghu-42', 'tampered')).toBeNull();
    expect(createPspConfigStore({ root: r }).list('ghu-42')).toEqual([]);
  });

  it('refuses an invalid owner/id shape rather than escaping the root', () => {
    const store = createPspConfigStore({ root: root() });
    expect(store.load('../escape', 'x')).toBeNull();
    expect(store.load('ghu-42', '../escape')).toBeNull();
  });
});
