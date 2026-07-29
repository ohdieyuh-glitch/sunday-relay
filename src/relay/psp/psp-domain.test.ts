import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PSP_AGENT_ID_FIXTURE_VERSION,
  PSP_AGENT_ID_MASK_CHARACTER,
  PSP_AGENT_ID_PRODUCTION_VERSIONS,
  PSP_AGENT_ID_SECRET_LENGTH,
  composePspAgentId,
  containsPspAgentId,
  isValidPspAgentIdFormat,
  maskPspAgentId,
  normalizePspAgentId,
  parsePspAgentId,
  pspAgentIdFingerprint,
  pspAgentIdMatchesVerifier,
  pspAgentIdVerifier,
  redactPspAgentIds,
} from './psp-agent-id';
import { pspConstantTimeEqual, pspSha256Hex } from './psp-crypto';
import {
  PSP_AGENT_IMPORT_ERROR_CODES,
  pspImportError,
  type PSPAgentImportErrorCode,
} from './psp-errors';
import {
  evaluateEntitlement,
  issueEntitlement,
  safeEntitlementView,
  transferEntitlement,
} from './psp-entitlement';
import {
  PSP_MAX_FAILED_ATTEMPTS,
  completePspAgentImport,
  confirmPspAgentImport,
  initialPspImportState,
  createUnavailableEntitlementService,
  isRateLimited,
  phaseForError,
  recordFailedAttempt,
  submitPspAgentId,
  validatePspAgentImport,
  type PSPWorkspaceContext,
} from './psp-import';
import {
  FIXTURE_HOLDER_USER_ID,
  FIXTURE_NOW,
  FIXTURE_OTHER_USER_ID,
  FIXTURE_UNKNOWN_CREDENTIAL,
  FIXTURE_WORKSPACE_ID,
  createFixtureEntitlementService,
  fixturePspAgentId,
  fixtureScenario,
} from './psp-fixtures';
import {
  buildPspTraceEvent,
  pspImportCompletedEvent,
  pspImportRejectedEvent,
} from './psp-trace';
import { PSP_DOMAIN_CHECKSUMS, PSP_DOMAIN_MODULE_NAMES } from './psp-parity';

/**
 * PSP AGENT ID — shared domain suite.
 *
 * Everything here is synthetic: version-0 development fixtures, deterministic
 * clocks and deterministic ids. No purchase, no trade, no payment provider and
 * no network call exists in this domain, so none can occur here.
 */

const dir = join(process.cwd(), 'src', 'relay', 'psp');

function workspace(overrides: Partial<PSPWorkspaceContext> = {}): PSPWorkspaceContext {
  return {
    workspaceId: FIXTURE_WORKSPACE_ID,
    userId: FIXTURE_HOLDER_USER_ID,
    importAllowed: true,
    relayVersion: '0.5.0',
    grantablePermissions: ['workspace.read', 'workspace.write', 'mission.run', 'mission.review'],
    installedPspIds: [],
    ...overrides,
  };
}

/* ----------------------------- shared domain ---------------------------- */

describe('PSP domain — shared byte-identical modules', () => {
  it('every module matches the cross-surface checksum', () => {
    for (const name of PSP_DOMAIN_MODULE_NAMES) {
      const digest = createHash('sha256').update(readFileSync(join(dir, name))).digest('hex');
      expect(digest, `${name} diverged from the shared PSP domain`)
        .toBe(PSP_DOMAIN_CHECKSUMS[name]);
    }
  });

  it('the domain is browser-safe: no node builtins, no framework, no network', () => {
    for (const name of PSP_DOMAIN_MODULE_NAMES) {
      const source = readFileSync(join(dir, name), 'utf8');
      expect(/from\s+['"]node:/.test(source), `${name} imports a node builtin`).toBe(false);
      expect(/from\s+['"]react/.test(source), `${name} imports React`).toBe(false);
      expect(/\bfetch\s*\(|XMLHttpRequest|axios/.test(source), `${name} makes a network call`)
        .toBe(false);
      expect(/Math\.random|Date\.now\(\)|new Date\(\)/.test(source), `${name} is non-deterministic`)
        .toBe(false);
    }
  });

  it('no production module imports the development fixtures', () => {
    for (const name of PSP_DOMAIN_MODULE_NAMES) {
      if (name === 'psp-fixtures.ts') continue;
      const source = readFileSync(join(dir, name), 'utf8');
      expect(/from\s+['"]\.\/psp-fixtures/.test(source), `${name} imports fixtures`).toBe(false);
    }
  });
});

/* -------------------------------- format -------------------------------- */

describe('PSP Agent ID — format', () => {
  const valid = fixturePspAgentId('RY0001', 'A');

  it('accepts a valid synthetic PSP Agent ID', () => {
    expect(isValidPspAgentIdFormat(valid)).toBe(true);
    const parsed = parsePspAgentId(valid);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.pspAgentId).toBe('RY0001');
    expect(parsed.value.secret).toHaveLength(PSP_AGENT_ID_SECRET_LENGTH);
    expect(parsed.value.isFixture).toBe(true);
  });

  it('rejects an empty ID', () => {
    expect(parsePspAgentId('')).toEqual({ ok: false, reason: 'empty' });
    expect(parsePspAgentId('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects malformed, short, wrong-prefix and bad-checksum IDs', () => {
    expect(parsePspAgentId('not-an-id')).toEqual({ ok: false, reason: 'malformed' });
    expect(parsePspAgentId('PSP-AGENT-1-RLY001-TOOSHORT-ABCD')) // relay-boundary:allow-fixture — malformed-by-design PSP id, asserts rejection
      .toEqual({ ok: false, reason: 'malformed' });
    expect(parsePspAgentId(valid.replace(/.$/, '9')).ok).toBe(false);
    const tampered = parsePspAgentId(valid.slice(0, -4) + 'ZZZZ');
    expect(tampered).toEqual({ ok: false, reason: 'bad_checksum' });
    // An unknown format version is refused rather than guessed at.
    expect(parsePspAgentId(valid.replace('AGENT-0', 'AGENT-7')))
      .toEqual({ ok: false, reason: 'unknown_version' });
  });

  it('normalizes case, whitespace and look-alike characters without mutating input', () => {
    const messy = `  ${valid.toLowerCase().replace(/(.{10})/, '$1 ')}  `;
    const before = messy;
    expect(isValidPspAgentIdFormat(messy)).toBe(true);
    expect(messy).toBe(before); // validation never mutates its input
    expect(normalizePspAgentId('psp-agent-0-rly0Ol-x')).toBe('PSP-AGENT-0-R1Y001-X');
  });

  it('composes deterministically and round-trips', () => {
    const built = composePspAgentId({
      credentialVersion: '1', pspAgentId: 'RY8K2Z', secret: 'A'.repeat(26),
    });
    expect(isValidPspAgentIdFormat(built)).toBe(true);
    expect(parsePspAgentId(built).ok && parsePspAgentId(built)).toBeTruthy();
    expect(composePspAgentId({
      credentialVersion: '1', pspAgentId: 'RY8K2Z', secret: 'A'.repeat(26),
    })).toBe(built);
  });
});

/* ------------------------------- security ------------------------------- */

describe('PSP Agent ID — credential security', () => {
  const valid = fixturePspAgentId('RY0001', 'A');

  it('masks the secret and never the public identity', () => {
    const masked = maskPspAgentId(valid);
    expect(masked).toContain('PSP-AGENT-0-RY0001');
    expect(masked).toContain(PSP_AGENT_ID_MASK_CHARACTER);
    const parsed = parsePspAgentId(valid);
    if (!parsed.ok) throw new Error('fixture invalid');
    expect(masked).not.toContain(parsed.value.secret);
    expect(masked).not.toContain(parsed.value.checksum);
    // An unparseable value still masks — it never echoes back what was typed.
    expect(maskPspAgentId('garbage-typed-by-a-user')).not.toContain('garbage');
  });

  it('fingerprints stably and non-reversibly', () => {
    const a = pspAgentIdFingerprint(valid);
    expect(a).toBe(pspAgentIdFingerprint(valid));
    expect(a).toBe(pspAgentIdFingerprint(valid.toLowerCase()));
    expect(a).not.toBe(pspAgentIdFingerprint(fixturePspAgentId('RY0002', 'B')));
    const parsed = parsePspAgentId(valid);
    if (!parsed.ok) throw new Error('fixture invalid');
    expect(a).not.toContain(parsed.value.secret);
    expect(a.startsWith('pspfp_')).toBe(true);
  });

  it('verifies through a salted digest compared in constant time', () => {
    const salt = 'salt-a';
    const verifier = pspAgentIdVerifier(valid, salt);
    expect(pspAgentIdMatchesVerifier(valid, salt, verifier)).toBe(true);
    expect(pspAgentIdMatchesVerifier(valid, 'salt-b', verifier)).toBe(false);
    expect(pspAgentIdMatchesVerifier(fixturePspAgentId('RY0002', 'B'), salt, verifier)).toBe(false);
    // Salt separation: the same credential under two salts yields two verifiers.
    expect(verifier).not.toBe(pspAgentIdVerifier(valid, 'salt-b'));
    expect(verifier).not.toContain('DEVFXTR');
    // Constant-time compare is length-safe and value-correct.
    expect(pspConstantTimeEqual('abc', 'abc')).toBe(true);
    expect(pspConstantTimeEqual('abc', 'abd')).toBe(false);
    expect(pspConstantTimeEqual('abc', 'abcd')).toBe(false);
  });

  it('implements SHA-256 correctly (FIPS 180-4 known answers)', () => {
    expect(pspSha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(pspSha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('redacts credential-shaped text anywhere it appears', () => {
    const leaked = `error while importing ${valid} into workspace`;
    expect(containsPspAgentId(leaked)).toBe(true);
    const safe = redactPspAgentIds(leaked);
    expect(containsPspAgentId(safe)).toBe(false);
    expect(safe).toContain('[REDACTED]');
    expect(safe).not.toContain('DEVFXTR');
  });

  it('errors never carry the credential and only carry a public identifier', () => {
    for (const code of PSP_AGENT_IMPORT_ERROR_CODES) {
      const error = pspImportError(code, 'RY0001');
      expect(error.code).toBe(code);
      expect(error.message.length).toBeGreaterThan(0);
      expect(containsPspAgentId(JSON.stringify(error))).toBe(false);
      expect(error.pspAgentId).toBe('RY0001');
    }
    // A credential passed where a public id belongs is DROPPED, not echoed.
    const abused = pspImportError('PSP_AGENT_ID_INVALID', valid);
    expect(abused.pspAgentId).toBeUndefined();
    expect(containsPspAgentId(JSON.stringify(abused))).toBe(false);
  });
});

/* ------------------------------ entitlement ----------------------------- */

describe('PSP entitlement', () => {
  it('issuing stores a fingerprint and a verifier — never the credential', () => {
    const credential = fixturePspAgentId('RY0001', 'A');
    const issued = issueEntitlement({
      entitlementId: 'ent-1', pspId: 'psp-atlas', pspVersionId: 'psp-atlas@2.1.0',
      acquisitionType: 'purchase', credential, issuedToUserId: 'user-1',
      issuedAt: FIXTURE_NOW, salt: 'salt-1',
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const serialized = JSON.stringify(issued.value);
    expect(containsPspAgentId(serialized)).toBe(false);
    expect(serialized).not.toContain('DEVFXTR');
    expect(issued.value.entitlement.credentialFingerprint.startsWith('pspfp_')).toBe(true);
    expect(issued.value.entitlement).not.toHaveProperty('credential');
    expect(issued.value.entitlement).not.toHaveProperty('secret');
  });

  it('rejects expired, revoked, disputed, transferred and already-redeemed', () => {
    const cases: Array<[string, PSPAgentImportErrorCode]> = [
      ['expired', 'PSP_AGENT_ID_EXPIRED'],
      ['revoked', 'PSP_AGENT_ID_REVOKED'],
      ['disputed', 'PSP_AGENT_ID_DISPUTED'],
      ['transferred', 'PSP_AGENT_ID_TRANSFERRED'],
      ['already_redeemed', 'PSP_AGENT_ID_ALREADY_REDEEMED'],
    ];
    for (const [key, code] of cases) {
      const scenario = fixtureScenario(key);
      const result = evaluateEntitlement({
        entitlement: scenario.entitlement, actorUserId: FIXTURE_HOLDER_USER_ID,
        now: FIXTURE_NOW, productionMode: false,
      });
      expect(result.ok, key).toBe(false);
      if (!result.ok) expect(result.error.code, key).toBe(code);
    }
  });

  it('rejects an entitlement held by someone else', () => {
    const scenario = fixtureScenario('not_owned');
    const result = evaluateEntitlement({
      entitlement: scenario.entitlement, actorUserId: FIXTURE_HOLDER_USER_ID,
      now: FIXTURE_NOW, productionMode: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PSP_AGENT_ENTITLEMENT_NOT_OWNED');
  });

  it('a fixture credential is never valid in production mode', () => {
    const scenario = fixtureScenario('purchased');
    expect(scenario.entitlement.credentialVersion).toBe(PSP_AGENT_ID_FIXTURE_VERSION);
    expect(PSP_AGENT_ID_PRODUCTION_VERSIONS).not.toContain(PSP_AGENT_ID_FIXTURE_VERSION);
    const result = evaluateEntitlement({
      entitlement: scenario.entitlement, actorUserId: FIXTURE_HOLDER_USER_ID,
      now: FIXTURE_NOW, productionMode: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PSP_AGENT_ID_INVALID');
  });

  it('transfer rotates the credential: old holder loses authority, new holder gains it', () => {
    const scenario = fixtureScenario('purchased');
    const newCredential = fixturePspAgentId('RY0001', 'Z');
    expect(newCredential).not.toBe(scenario.credential);

    const transferred = transferEntitlement({
      entitlement: scenario.entitlement,
      credentialRecord: scenario.credentialRecord,
      toUserId: FIXTURE_OTHER_USER_ID,
      now: FIXTURE_NOW,
      newEntitlementId: 'ent-next',
      newCredential,
      newSalt: 'salt-next',
      tradeTransactionId: 'trade-1',
      acquisitionType: 'trade',
    });
    expect(transferred.ok).toBe(true);
    if (!transferred.ok) return;
    const { previous, next } = transferred.value;

    // Old entitlement is inert and its secret retired.
    expect(previous.entitlement.status).toBe('transferred');
    expect(previous.credentialRecord.retiredAt).toBe(FIXTURE_NOW);
    expect(previous.entitlement.supersededByEntitlementId).toBe('ent-next');
    const old = evaluateEntitlement({
      entitlement: previous.entitlement, actorUserId: FIXTURE_HOLDER_USER_ID,
      now: FIXTURE_NOW, productionMode: false,
    });
    expect(old.ok).toBe(false);
    if (!old.ok) expect(old.error.code).toBe('PSP_AGENT_ID_TRANSFERRED');

    // New holder may import; the secret genuinely rotated.
    expect(next.entitlement.currentHolderUserId).toBe(FIXTURE_OTHER_USER_ID);
    expect(next.credentialRecord.verifier).not.toBe(previous.credentialRecord.verifier);
    expect(next.entitlement.credentialFingerprint)
      .not.toBe(previous.entitlement.credentialFingerprint);
    // The PUBLIC product identity is stable across the transfer.
    expect(next.entitlement.pspAgentId).toBe(previous.entitlement.pspAgentId);
    const now = evaluateEntitlement({
      entitlement: next.entitlement, actorUserId: FIXTURE_OTHER_USER_ID,
      now: FIXTURE_NOW, productionMode: false,
    });
    expect(now.ok).toBe(true);
    expect(containsPspAgentId(JSON.stringify(transferred.value))).toBe(false);
  });

  it('the safe view masks the credential and keeps the public identity', () => {
    const scenario = fixtureScenario('purchased');
    const view = safeEntitlementView(scenario.entitlement);
    expect(view.maskedAgentId).toContain(PSP_AGENT_ID_MASK_CHARACTER);
    expect(view.pspAgentId).toBe('RY0001');
    expect(containsPspAgentId(JSON.stringify(view))).toBe(false);
  });
});

/* -------------------------------- import -------------------------------- */

describe('PSP import — validation and preview', () => {
  it('purchase, trade, creator grant and admin grant may all import', () => {
    for (const key of ['purchased', 'traded', 'creator_grant', 'admin_grant']) {
      const scenario = fixtureScenario(key);
      const service = createFixtureEntitlementService();
      const result = validatePspAgentImport({
        credential: scenario.credential, workspace: workspace(), service, now: FIXTURE_NOW,
      });
      expect(result.ok, key).toBe(true);
      if (!result.ok) continue;
      expect(result.value.acquisitionType).toBe(scenario.entitlement.acquisitionType);
      expect(result.value.confirmationRequired).toBe(true);
      expect(result.value.redemptionEffect).toBe('redeem_one_time');
    }
  });

  it('the preview is safe: masked id, product facts, no credential', () => {
    const scenario = fixtureScenario('purchased');
    const service = createFixtureEntitlementService();
    const result = validatePspAgentImport({
      credential: scenario.credential, workspace: workspace(), service, now: FIXTURE_NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preview = result.value;
    expect(preview.name).toBe('Atlas Delivery Squad');
    expect(preview.creator).toBe('Sunday Labs');
    expect(preview.agentRoles.length).toBeGreaterThan(0);
    expect(preview.supportedModels.length).toBeGreaterThan(0);
    expect(preview.requiredPermissions.length).toBeGreaterThan(0);
    expect(preview.relayDogColorway).toBe('official-cream');
    expect(preview.maskedAgentId).toContain(PSP_AGENT_ID_MASK_CHARACTER);
    expect(containsPspAgentId(JSON.stringify(preview))).toBe(false);
    expect(JSON.stringify(preview)).not.toContain('DEVFXTR');
  });

  it('an unknown credential is rejected without revealing anything', () => {
    const service = createFixtureEntitlementService();
    const result = validatePspAgentImport({
      credential: FIXTURE_UNKNOWN_CREDENTIAL, workspace: workspace(), service, now: FIXTURE_NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PSP_AGENT_ENTITLEMENT_NOT_FOUND');
  });

  it('an incompatible PSP version is rejected', () => {
    const scenario = fixtureScenario('incompatible');
    const service = createFixtureEntitlementService();
    const result = validatePspAgentImport({
      credential: scenario.credential, workspace: workspace(), service, now: FIXTURE_NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PSP_AGENT_VERSION_INCOMPATIBLE');
      expect(phaseForError(result.error.code)).toBe('incompatible');
    }
  });

  it('workspace permission and duplicate import are enforced', () => {
    const scenario = fixtureScenario('purchased');
    const service = createFixtureEntitlementService();
    const denied = validatePspAgentImport({
      credential: scenario.credential, workspace: workspace({ importAllowed: false }),
      service, now: FIXTURE_NOW,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('WORKSPACE_IMPORT_NOT_ALLOWED');

    const duplicate = validatePspAgentImport({
      credential: scenario.credential,
      workspace: workspace({ installedPspIds: ['psp-atlas'] }), service, now: FIXTURE_NOW,
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.code).toBe('PSP_AGENT_ALREADY_IMPORTED');
  });

  it('an unavailable entitlement service never fabricates success', () => {
    const scenario = fixtureScenario('purchased');
    const service = createFixtureEntitlementService({ unavailable: true });
    const result = validatePspAgentImport({
      credential: scenario.credential, workspace: workspace(), service, now: FIXTURE_NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PSP_AGENT_IMPORT_SERVICE_UNAVAILABLE');
      expect(phaseForError(result.error.code)).toBe('service_unavailable');
    }
    // And the completion path refuses too — nothing is imported.
    const completed = completePspAgentImport({
      credential: scenario.credential, workspace: workspace(), service,
      now: FIXTURE_NOW, confirmed: true, importId: 'imp-1',
    });
    expect(completed.ok).toBe(false);
  });

  it('the production boundary refuses every credential until a backend exists', () => {
    const service = createUnavailableEntitlementService();
    expect(service.production).toBe(true);
    const scenario = fixtureScenario('purchased');
    const result = validatePspAgentImport({
      credential: scenario.credential, workspace: workspace(), service, now: FIXTURE_NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PSP_AGENT_IMPORT_SERVICE_UNAVAILABLE');
  });

  it('repeated invalid attempts are rate limited', () => {
    let window = { actorUserId: 'user-1', failedAt: [] as string[] };
    for (let i = 0; i < PSP_MAX_FAILED_ATTEMPTS; i += 1) {
      expect(isRateLimited(window, FIXTURE_NOW)).toBe(false);
      window = recordFailedAttempt(window, FIXTURE_NOW);
    }
    expect(isRateLimited(window, FIXTURE_NOW)).toBe(true);
    // The window expires.
    expect(isRateLimited(window, '2026-07-28T13:00:00.000Z')).toBe(false);
  });
});

describe('PSP import — confirmation and completion', () => {
  it('requires confirmation before anything is imported', () => {
    const scenario = fixtureScenario('purchased');
    const service = createFixtureEntitlementService();
    const result = completePspAgentImport({
      credential: scenario.credential, workspace: workspace(), service,
      now: FIXTURE_NOW, confirmed: false, importId: 'imp-1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PSP_AGENT_IMPORT_CONFIRMATION_REQUIRED');
      expect(phaseForError(result.error.code)).toBe('confirmation_required');
    }
    expect(service.imported).toHaveLength(0);
  });

  it('a confirmed import produces a secret-free record and redeems once', () => {
    const scenario = fixtureScenario('purchased');
    const service = createFixtureEntitlementService();
    const result = completePspAgentImport({
      credential: scenario.credential, workspace: workspace(), service,
      now: FIXTURE_NOW, confirmed: true, importId: 'imp-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const record = result.value;
    expect(record.status).toBe('active');
    expect(record.source).toBe('purchase');
    expect(record.displayName).toBe('Atlas Delivery Squad');
    expect(record.agentRoleSummary.length).toBeGreaterThan(0);
    expect(record.workspaceId).toBe(FIXTURE_WORKSPACE_ID);
    expect(containsPspAgentId(JSON.stringify(record))).toBe(false);
    expect(JSON.stringify(record)).not.toContain('DEVFXTR');
    expect(Object.keys(record)).not.toContain('credential');

    // One-time redemption: the same ID cannot be redeemed again.
    const replay = completePspAgentImport({
      credential: scenario.credential, workspace: workspace({ userId: FIXTURE_HOLDER_USER_ID }),
      service, now: FIXTURE_NOW, confirmed: true, importId: 'imp-2',
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error.code).toBe('PSP_AGENT_ID_ALREADY_REDEEMED');
    expect(service.imported).toHaveLength(1);
  });

  it('the flow state never holds a credential, in any phase', () => {
    const scenario = fixtureScenario('purchased');
    const service = createFixtureEntitlementService();
    let state = initialPspImportState(FIXTURE_HOLDER_USER_ID);
    expect(state.phase).toBe('empty');

    state = submitPspAgentId(state, {
      credential: scenario.credential, workspace: workspace(), service, now: FIXTURE_NOW,
    });
    expect(state.phase).toBe('valid');
    expect(state.preview).not.toBeNull();
    expect(containsPspAgentId(JSON.stringify(state))).toBe(false);

    state = confirmPspAgentImport(state, {
      credential: scenario.credential, workspace: workspace(), service,
      now: FIXTURE_NOW, importId: 'imp-1', confirmed: true,
    });
    expect(state.phase).toBe('imported');
    expect(state.record?.displayName).toBe('Atlas Delivery Squad');
    expect(containsPspAgentId(JSON.stringify(state))).toBe(false);
    expect(JSON.stringify(state)).not.toContain('DEVFXTR');
  });

  it('every failure phase is reachable and reported safely', () => {
    const expected: Array<[string, string]> = [
      ['expired', 'expired'],
      ['revoked', 'revoked'],
      ['already_redeemed', 'already_redeemed'],
      ['transferred', 'transferred'],
      ['disputed', 'disputed'],
      ['incompatible', 'incompatible'],
      ['not_owned', 'invalid'],
    ];
    for (const [key, phase] of expected) {
      const scenario = fixtureScenario(key);
      const service = createFixtureEntitlementService();
      const state = submitPspAgentId(initialPspImportState(FIXTURE_HOLDER_USER_ID), {
        credential: scenario.credential, workspace: workspace(), service, now: FIXTURE_NOW,
      });
      expect(state.phase, key).toBe(phase);
      expect(state.record).toBeNull();
      expect(state.message, key).toBeTruthy();
      expect(containsPspAgentId(JSON.stringify(state)), key).toBe(false);
    }
  });
});

/* --------------------------------- trace -------------------------------- */

describe('PSP trace adapter', () => {
  it('emits safe metadata only', () => {
    const event = pspImportCompletedEvent({
      at: FIXTURE_NOW, pspAgentId: 'RY0001', pspId: 'psp-atlas',
      pspVersionId: 'psp-atlas@2.1.0', entitlementFingerprint: 'pspfp_abc',
      workspaceId: FIXTURE_WORKSPACE_ID, actorId: FIXTURE_HOLDER_USER_ID,
      transactionReference: 'txn-fixture-0001',
    });
    expect(event).not.toBeNull();
    expect(event!.metadata.pspAgentId).toBe('RY0001');
    expect(event!.metadata.importResult).toBe('imported');
    expect(containsPspAgentId(JSON.stringify(event))).toBe(false);
  });

  it('refuses to build an event that would carry a credential or a secret key', () => {
    const credential = fixturePspAgentId('RY0001', 'A');
    expect(buildPspTraceEvent({
      kind: 'psp_agent_import_requested', at: FIXTURE_NOW,
      metadata: { pspAgentId: credential },
    })).toBeNull();
    expect(buildPspTraceEvent({
      kind: 'psp_agent_import_requested', at: FIXTURE_NOW,
      metadata: { credentialRaw: credential },
    })).toBeNull();
    expect(buildPspTraceEvent({
      kind: 'psp_agent_import_requested', at: FIXTURE_NOW,
      metadata: { apiKey: 'sk-abcdefgh' },
    })).toBeNull();
    // Unknown-but-safe keys are dropped, not carried.
    const event = buildPspTraceEvent({
      kind: 'psp_agent_import_requested', at: FIXTURE_NOW,
      metadata: { pspAgentId: 'RY0001', somethingElse: 'x' },
    });
    expect(event!.metadata).toEqual({ pspAgentId: 'RY0001' });
  });

  it('a rejection event records the code but never the attempted credential', () => {
    const event = pspImportRejectedEvent({
      at: FIXTURE_NOW, code: 'PSP_AGENT_ID_REVOKED', pspAgentId: 'RY0007',
      workspaceId: FIXTURE_WORKSPACE_ID, actorId: FIXTURE_HOLDER_USER_ID,
    });
    expect(event!.metadata.errorCode).toBe('PSP_AGENT_ID_REVOKED');
    expect(containsPspAgentId(JSON.stringify(event))).toBe(false);
  });
});
