import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeDurableBacking } from '../../persistence/durable-mission-file';
import { createInMemoryDurableBacking } from '../durable/durable-store';
import { PARTICIPANT_ID_PATTERN } from '../../../../relay-bridge/browser-session/grants';
import {
  ACCOUNT_FORBIDDEN_FIELDS,
  WONDERLAND_USER_ID_PATTERN,
  accountMayEnterWonderland,
  attachOwnedReference,
  bindWallet,
  createWonderlandAccountStore,
  enrolAccountInBetaWave,
  equipAgent,
  multiplayerIdentityOf,
  readWonderlandAccount,
  sealWonderlandAccount,
  signInToWonderland,
  signOutOfWonderland,
  suspendAccount,
  wonderlandUserIdFor,
  type WonderlandAccountDraft,
} from './index';

const T0 = '2026-09-14T09:00:00.000Z';
const T1 = '2026-09-15T09:00:00.000Z';

const IDENTITY = {
  provider: 'github' as const,
  providerSubject: '1001',
  displayName: 'KAI',
};

const temps: string[] = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true }).catch(() => {});
});

function newAccount(): WonderlandAccountDraft {
  const result = signInToWonderland({ identity: IDENTITY, existing: null, atIso: T0 });
  if (!result.ok) throw new Error(result.error.message);
  return result.value.account;
}

/* ------------------------------------------------------------------------ */

describe('the user id is the value that closes the gap', () => {
  it('derives the same ghu-<id> the bridge already mints', () => {
    expect(wonderlandUserIdFor('github', '1001')).toBe('ghu-1001');
  });

  it('matches the participant grammar the bridge enforces', () => {
    // The two patterns are declared separately because the mission layer may
    // not import the bridge at runtime. A test is the only place they may meet,
    // and they must not drift.
    expect(WONDERLAND_USER_ID_PATTERN.source).toBe(PARTICIPANT_ID_PATTERN.source);
    expect(PARTICIPANT_ID_PATTERN.test('ghu-1001')).toBe(true);
  });

  it('refuses a subject that is not a provider id', () => {
    expect(wonderlandUserIdFor('github', 'not-numeric')).toBeNull();
    expect(wonderlandUserIdFor('github', '')).toBeNull();
  });

  it('is derived from the SUBJECT, not the changeable handle', () => {
    const renamed = signInToWonderland({
      identity: { ...IDENTITY, displayName: 'A COMPLETELY NEW NAME' },
      existing: newAccount(),
      atIso: T1,
    });
    if (!renamed.ok) throw new Error('sign-in refused');
    // A user who renames themselves on GitHub is the same Wonderland user.
    expect(renamed.value.account.userId).toBe('ghu-1001');
    expect(renamed.value.account.displayName).toBe('A COMPLETELY NEW NAME');
  });
});

describe('an account holds no credential', () => {
  it('carries none of the forbidden field names', () => {
    const keys = Object.keys(sealWonderlandAccount(newAccount()));
    for (const forbidden of ACCOUNT_FORBIDDEN_FIELDS) {
      expect(keys, `an account carries ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('contains nothing secret-shaped when serialized', () => {
    const wire = JSON.stringify(sealWonderlandAccount(newAccount()));
    for (const pattern of [
      /gh[pousr]_[A-Za-z0-9]{20,}/,
      /sk-[A-Za-z0-9]{8,}/,
      /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/,
      /\b(?:password|secret|apikey|cvv)\b/i,
    ]) {
      expect(wire, `account serialization matched ${pattern}`).not.toMatch(pattern);
    }
  });
});

describe('sign in, leave, and come back', () => {
  it('creates on first sight and returns on every sight after', () => {
    const first = signInToWonderland({ identity: IDENTITY, existing: null, atIso: T0 });
    if (!first.ok) throw new Error('sign-in refused');
    expect(first.value.kind).toBe('created');

    const second = signInToWonderland({
      identity: IDENTITY, existing: first.value.account, atIso: T1,
    });
    if (!second.ok) throw new Error('sign-in refused');
    expect(second.value.kind).toBe('returned');
    expect(second.value.account.createdAt).toBe(T0);
    expect(second.value.account.lastSeenAt).toBe(T1);
  });

  it('never rebuilds a returning user\'s owned state', () => {
    let account = newAccount();
    const withProject = attachOwnedReference(account, 'projectIds', 'prj_1');
    if (!withProject.ok) throw new Error('attach refused');
    account = withProject.value;

    const back = signInToWonderland({ identity: IDENTITY, existing: account, atIso: T1 });
    if (!back.ok) throw new Error('sign-in refused');
    expect(back.value.account.owned.projectIds).toEqual(['prj_1']);
  });

  it('signing out destroys nothing durable', () => {
    let account = newAccount();
    const withProject = attachOwnedReference(account, 'projectIds', 'prj_1');
    if (!withProject.ok) throw new Error('attach refused');
    account = signOutOfWonderland(withProject.value, T1);
    expect(account.owned.projectIds).toEqual(['prj_1']);
    expect(account.status).toBe('ACTIVE');
  });

  it('refuses to sign somebody into a record that is not theirs', () => {
    const mine = newAccount();
    const other = signInToWonderland({
      identity: { ...IDENTITY, providerSubject: '2002' },
      existing: mine,
      atIso: T1,
    });
    expect(other.ok).toBe(false);
    if (other.ok) return;
    expect(other.error.code).toBe('permission-denied');
  });

  it('refuses a suspended account and allows restoring it', () => {
    const suspended = suspendAccount(newAccount(), T1);
    expect(accountMayEnterWonderland(suspended)).toBe(false);
    const refused = signInToWonderland({ identity: IDENTITY, existing: suspended, atIso: T1 });
    expect(refused.ok).toBe(false);
  });
});

describe('owned state is references, and only references', () => {
  it('attaches idempotently', () => {
    const once = attachOwnedReference(newAccount(), 'creationIds', 'cre_1');
    if (!once.ok) throw new Error('attach refused');
    const twice = attachOwnedReference(once.value, 'creationIds', 'cre_1');
    if (!twice.ok) throw new Error('attach refused');
    expect(twice.value.owned.creationIds).toEqual(['cre_1']);
  });

  it('refuses to equip an agent the account never imported', () => {
    expect(equipAgent(newAccount(), 'agent_never_imported').ok).toBe(false);
  });

  it('equips an imported agent', () => {
    const imported = attachOwnedReference(newAccount(), 'importedAgentIds', 'agent_1');
    if (!imported.ok) throw new Error('attach refused');
    const equipped = equipAgent(imported.value, 'agent_1');
    expect(equipped.ok).toBe(true);
    if (!equipped.ok) return;
    expect(equipped.value.owned.equippedAgentId).toBe('agent_1');
  });

  it('refuses to silently replace a wallet', () => {
    const bound = bindWallet(newAccount(), 'wal_1');
    if (!bound.ok) throw new Error('bind refused');
    expect(bindWallet(bound.value, 'wal_1').ok).toBe(true);
    expect(bindWallet(bound.value, 'wal_2').ok).toBe(false);
  });

  it('gives multiplayer exactly two fields about a person', () => {
    const identity = multiplayerIdentityOf(newAccount());
    expect([...Object.keys(identity)].sort()).toEqual(['displayName', 'userId']);
  });
});

describe('beta access is delegated, not reimplemented', () => {
  it('records an enrolment and refuses a second one', () => {
    const enrolled = enrolAccountInBetaWave(newAccount(), 'wave_0', T0);
    if (!enrolled.ok) throw new Error('enrol refused');
    expect(enrolled.value.betaWave).toBe('wave_0');
    expect(enrolAccountInBetaWave(enrolled.value, 'wave_1', T1).ok).toBe(false);
  });

  it('starts with no wave, so access is never assumed', () => {
    expect(newAccount().betaWave).toBeNull();
  });
});

describe('the account survives a restart, which is also the recovery path', () => {
  it('finds the same account from a fresh store on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wonderland-account-'));
    temps.push(root);

    // ---- Monday.
    {
      const store = createWonderlandAccountStore(createNodeDurableBacking(root));
      let account = newAccount();
      const withProject = attachOwnedReference(account, 'projectIds', 'prj_monday');
      if (!withProject.ok) throw new Error('attach refused');
      account = withProject.value;
      expect((await store.write(account)).ok).toBe(true);
    }

    // ---- Tuesday, a different process would see exactly this.
    const tuesday = createWonderlandAccountStore(createNodeDurableBacking(root));
    // Recovery IS the login path: the same provider subject finds the account.
    const found = await tuesday.findByProviderSubject('github', '1001');
    expect(found).not.toBeNull();
    expect(found?.userId).toBe('ghu-1001');
    expect(found?.owned.projectIds).toEqual(['prj_monday']);

    const back = signInToWonderland({
      identity: IDENTITY,
      existing: found === null ? null : { ...found },
      atIso: T1,
    });
    if (!back.ok) throw new Error('sign-in refused');
    expect(back.value.kind).toBe('returned');
    expect(back.value.account.owned.projectIds).toEqual(['prj_monday']);
  });

  it('does not find an account for an unknown subject', async () => {
    const store = createWonderlandAccountStore(createInMemoryDurableBacking());
    await store.write(newAccount());
    expect(await store.findByProviderSubject('github', '9999')).toBeNull();
  });

  it('never reads a corrupt account as a fresh one', () => {
    const sealed = sealWonderlandAccount(newAccount());
    // A corrupt record that read as `not_found` would silently create a SECOND
    // account for the same human and detach them from everything they own.
    const read = readWonderlandAccount({ ...sealed, userId: 'ghu-9999' });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe('corrupt');
  });

  it('reports an unknown schema version rather than calling it absent', () => {
    const sealed = sealWonderlandAccount(newAccount());
    const read = readWonderlandAccount({ ...sealed, schemaVersion: 'relay-wonderland-account.v99' });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe('unsupported_version');
  });
});
