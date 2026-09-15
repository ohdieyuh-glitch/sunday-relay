import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  createJuliusBrainAccessService,
  GITHUB_ACTIONS_OIDC_ISSUER,
  verifyJuliusBrainOidcToken,
  type JuliusBrainAccessPolicy,
  type JuliusBrainAuditEvent,
  type JuliusBrainJwk,
  type JuliusBrainStateModeGrant,
} from './julius-brain-access';
import { paidRunArchive } from './julius-brain-archive-fixtures';
import { importJuliusPaidRunArchive } from './julius-brain-archive-import';
import { juliusPrincipal, type JuliusBrainDraft } from './julius-brain-contracts';
import { createJuliusProjectBrainService } from './julius-brain-service';
import { juliusBrainStateModePolicyHash, type JuliusBrainStateModePolicy } from './julius-brain-state-modes';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities } from './julius-brain-store';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWKS: { keys: JuliusBrainJwk[] } = { keys: [{ ...(publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string }), kid: 'github-1', alg: 'RS256', use: 'sig' }] };
const POLICY: JuliusBrainAccessPolicy = {
  audience: 'julius-project-brain', repositoryId: '1100220033', repositoryOwnerId: '4400550066',
  workflowRef: 'ohdieyuh-glitch/sunday-relay/.github/workflows/julius-first-live-mission.yml@refs/heads/main', ref: 'refs/heads/main',
  allowedEvents: ['workflow_dispatch'], environments: { 'julius-paid': 'production', 'julius-dev': 'development' }, sessionTtlMs: 3 * 60 * 60 * 1000,
};
const START = Date.parse('2026-09-15T12:00:00.000Z') / 1000;
const MISSION = 'mission:julius-live-4';
const PROJECT = 'prj-julius-live-4';
const BRAIN = 'brain:prj-julius-live-4';
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

let jtiCounter = 0;
function token(overrides: Record<string, unknown> = {}, header: Record<string, unknown> = { alg: 'RS256', kid: 'github-1', typ: 'JWT' }): string {
  jtiCounter += 1;
  const payload = {
    iss: GITHUB_ACTIONS_OIDC_ISSUER, aud: POLICY.audience, iat: START, nbf: START, exp: START + 300, jti: `jti-${jtiCounter}`,
    repository_id: POLICY.repositoryId, repository_owner_id: POLICY.repositoryOwnerId, repository: 'ohdieyuh-glitch/sunday-relay',
    workflow_ref: POLICY.workflowRef, ref: POLICY.ref, event_name: 'workflow_dispatch', environment: 'julius-paid', run_id: '35000000000', run_attempt: '1',
    ...overrides,
  };
  const signingInput = `${b64(header)}.${b64(payload)}`;
  return `${signingInput}.${sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')}`;
}

const fresh = (runId = 'workflow:35000000000/1'): JuliusBrainStateModePolicy => ({ mode: 'FRESH', missionId: MISSION, runId });

function service(environment: 'production' | 'development' = 'production', grants: JuliusBrainStateModeGrant[] = []) {
  let now = START * 1000;
  const audit: JuliusBrainAuditEvent[] = [];
  const access = createJuliusBrainAccessService({
    brainId: BRAIN, environment, policy: POLICY, jwks: () => JWKS, grants: () => grants,
    clock: { now: () => new Date(now).toISOString() }, audit: (event) => audit.push(event),
  });
  return { access, audit, advance: (ms: number) => { now += ms; } };
}

describe('the controlled Brain service access contract', () => {
  it('verifies a GitHub Actions OIDC token: signature, algorithm, issuer, audience, time, and every pinned claim', () => {
    const verified = (value: string, nowSeconds = START) => verifyJuliusBrainOidcToken({ token: value, jwks: JWKS, policy: POLICY, nowSeconds });
    expect(verified(token())).toMatchObject({ ok: true, claims: { runId: '35000000000', runAttempt: 1, environment: 'julius-paid' } });

    const refused = (value: string, nowSeconds = START) => { const result = verified(value, nowSeconds); return result.ok ? 'accepted' : `${result.reasonCode}:${result.detail}`; };
    expect(refused(token({}, { alg: 'none', kid: 'github-1' }))).toBe('token_algorithm_refused:alg none');
    expect(refused(token({}, { alg: 'HS256', kid: 'github-1' }))).toBe('token_algorithm_refused:alg HS256');
    expect(refused(token({}, { alg: 'RS256', kid: 'github-2' }))).toBe('token_key_unknown:kid github-2');
    const [header, , signature] = token().split('.');
    expect(refused(`${header}.${b64({ iss: GITHUB_ACTIONS_OIDC_ISSUER, run_id: '1' })}.${signature}`)).toBe('token_signature_invalid:signature does not verify');
    expect(refused('not.a-token')).toBe('token_malformed:not a JWS compact token');
    expect(refused(token({ iss: 'https://evil.example.org' }))).toBe('token_issuer_refused:https://evil.example.org');
    expect(refused(token({ aud: 'some-other-service' }))).toBe('token_audience_refused:some-other-service');
    expect(refused(token(), START + 3_600)).toMatch(/^token_expired/);
    expect(refused(token({ nbf: START + 600, iat: START + 600, exp: START + 900 }))).toMatch(/^token_not_yet_valid/);
    expect(refused(token({ iat: START - 3_600, nbf: START - 3_600, exp: START + 300 }))).toMatch(/^token_too_old/);
    expect(refused(token({ repository_id: '999' }))).toBe('token_claim_refused:repository_id');
    expect(refused(token({ repository_owner_id: '999' }))).toBe('token_claim_refused:repository_owner_id');
    expect(refused(token({ workflow_ref: 'ohdieyuh-glitch/sunday-relay/.github/workflows/julius-first-live-mission.yml@refs/heads/feature' }))).toBe('token_claim_refused:workflow_ref');
    expect(refused(token({ ref: 'refs/heads/feature' }))).toBe('token_claim_refused:ref');
    expect(refused(token({ event_name: 'pull_request_target' }))).toBe('token_claim_refused:event_name');
    expect(refused(token({ event_name: 'push' }))).toBe('token_claim_refused:event_name');
    expect(refused(token({ environment: 'anything-else' }))).toBe('token_claim_refused:environment');
    expect(refused(token({ run_id: 'run:julius-live-4' }))).toBe('token_claim_refused:run_id');
    expect(refused(token({ run_attempt: '0' }))).toBe('token_claim_refused:run_attempt');
  });

  it('issues a session bound to the verified attempt; replay, other environments, foreign runs and unauthorised modes are refused', () => {
    const grantPolicy: JuliusBrainStateModePolicy = { mode: 'LEARNING', missionId: MISSION, runId: 'workflow:35000000001/1', learnFrom: { runIds: ['workflow:34739303313/1'], kinds: ['FINDING'], requireVerified: false } };
    const { access, audit } = service('production', [{ brainRunId: 'workflow:35000000001/1', missionId: MISSION, policyHash: juliusBrainStateModePolicyHash(grantPolicy) }]);
    const value = token();
    const issued = access.issueSession({ token: value, projectId: PROJECT, missionId: MISSION, stateMode: fresh() });
    if (!issued.ok) throw new Error(issued.detail);
    expect(issued.session).toMatchObject({ brainRunId: 'workflow:35000000000/1', environment: 'production', principal: { kind: 'JULIUS', id: 'julius:workflow:35000000000/1' }, expiresAt: '2026-09-15T15:00:00.000Z' });

    const reason = (input: Parameters<typeof access.issueSession>[0]) => { const result = access.issueSession(input); return result.ok ? 'issued' : result.reasonCode; };
    expect(reason({ token: value, projectId: PROJECT, missionId: MISSION, stateMode: fresh() })).toBe('token_replayed');
    expect(reason({ token: token({ environment: 'julius-dev' }), projectId: PROJECT, missionId: MISSION, stateMode: fresh() })).toBe('environment_mismatch');
    // The client cannot name the run: a policy for any run but the token's is refused.
    expect(reason({ token: token(), projectId: PROJECT, missionId: MISSION, stateMode: fresh('workflow:34739303313/1') })).toBe('state_mode_not_for_this_run');
    // Prior state needs an operator grant for exactly this run, mission and policy.
    expect(reason({ token: token({ run_id: '35000000002' }), projectId: PROJECT, missionId: MISSION, stateMode: { ...grantPolicy, runId: 'workflow:35000000002/1' } })).toBe('state_mode_not_authorized');
    expect(reason({ token: token({ run_id: '35000000001' }), projectId: PROJECT, missionId: MISSION, stateMode: grantPolicy })).toBe('issued');
    // Once an attempt registered FRESH, no later token for it may change the mode, the mission or the project.
    expect(reason({ token: token(), projectId: PROJECT, missionId: MISSION, stateMode: { ...grantPolicy, runId: 'workflow:35000000000/1' } })).toBe('state_mode_not_authorized');
    const { access: granted } = service('production', [{ brainRunId: 'workflow:35000000000/1', missionId: MISSION, policyHash: juliusBrainStateModePolicyHash({ ...grantPolicy, runId: 'workflow:35000000000/1' }) }]);
    expect(granted.issueSession({ token: token(), projectId: PROJECT, missionId: MISSION, stateMode: fresh() }).ok).toBe(true);
    const switched = granted.issueSession({ token: token(), projectId: PROJECT, missionId: MISSION, stateMode: { ...grantPolicy, runId: 'workflow:35000000000/1' } });
    expect(switched.ok ? 'issued' : switched.reasonCode).toBe('run_registration_mismatch');
    expect(reason({ token: token(), projectId: 'prj-other', missionId: MISSION, stateMode: fresh() })).toBe('run_registration_mismatch');

    // Audited, without a single token.
    expect(audit.map((event) => `${event.action}:${event.reasonCode ?? ''}`)).toEqual([
      'SESSION_ISSUED:', 'SESSION_REFUSED:token_replayed', 'SESSION_REFUSED:environment_mismatch', 'SESSION_REFUSED:state_mode_not_for_this_run',
      'SESSION_REFUSED:state_mode_not_authorized', 'SESSION_ISSUED:', 'SESSION_REFUSED:state_mode_not_authorized', 'SESSION_REFUSED:run_registration_mismatch',
    ]);
    expect(JSON.stringify(audit)).not.toContain(value.split('.')[2]!);
    expect(JSON.stringify(audit)).not.toContain(issued.sessionToken);
  });

  it('a faulty client cannot read another run, switch its mode, write protected or foreign records, reuse an expired session, or cross environments', () => {
    const { access, audit, advance } = service('production');
    const issued = access.issueSession({ token: token(), projectId: PROJECT, missionId: MISSION, stateMode: fresh() });
    if (!issued.ok) throw new Error(issued.detail);
    const session = issued.sessionToken;
    const draft = (patch: Partial<JuliusBrainDraft>): JuliusBrainDraft => ({
      kind: 'EVIDENCE', op: 'CREATE', entityId: null, expectedVersion: 0, body: {}, links: [], scope: { missionId: MISSION, runId: 'workflow:35000000000/1', taskId: null },
      retention: 'DURABLE', confidence: null, sensitivity: 'INTERNAL', provenance: { source: 'run_observed', provider: null, model: null, tool: null, commit: null, externalRef: null, executionId: null },
      idempotencyKey: 'k', occurredAt: null, ...patch,
    });
    const call = (value: Parameters<typeof access.authorize>[0]['call'], sessionToken = session) => { const result = access.authorize({ sessionToken, call: value }); return result.ok ? 'allowed' : result.reasonCode; };

    expect(call({ type: 'READ_CONTEXT' })).toBe('allowed');
    expect(call({ type: 'READ_CONTEXT', runId: 'workflow:34739303313/1' })).toBe('other_run');
    expect(call({ type: 'READ_CONTEXT', missionId: 'mission:other' })).toBe('other_mission');
    expect(call({ type: 'READ_CONTEXT', stateMode: { mode: 'LEARNING', missionId: MISSION, runId: 'workflow:35000000000/1', learnFrom: { runIds: null, kinds: ['FINDING'], requireVerified: false } } })).toBe('state_mode_is_bound');
    expect(call({ type: 'WRITE', drafts: [draft({})] })).toBe('allowed');
    expect(call({ type: 'WRITE', drafts: [draft({ kind: 'MISSION' })] })).toBe('kind_not_permitted');
    expect(call({ type: 'WRITE', drafts: [draft({ kind: 'CHECKPOINT' })] })).toBe('kind_not_permitted');
    expect(call({ type: 'WRITE', drafts: [draft({}), draft({ scope: { missionId: MISSION, runId: 'workflow:34739303313/1', taskId: null } })] })).toBe('mutation_out_of_scope');
    // Mission authority is run-less; a run session cannot write it, whatever the kind.
    expect(call({ type: 'WRITE', drafts: [draft({ kind: 'CONSTRAINT', scope: { missionId: MISSION, runId: null, taskId: null } })] })).toBe('mutation_out_of_scope');
    expect(call({ type: 'SEAL', runId: 'workflow:34739303313/1' })).toBe('other_run');
    expect(call({ type: 'RAW_STORE', operation: 'SELECT * FROM julius_brain.records' })).toBe('raw_store_not_exposed');
    expect(call({ type: 'READ_CONTEXT' }, 'a-guessed-session-token')).toBe('session_unknown');

    // A development session is not a production session.
    const dev = service('development');
    const devIssued = dev.access.issueSession({ token: token({ environment: 'julius-dev' }), projectId: PROJECT, missionId: MISSION, stateMode: fresh() });
    if (!devIssued.ok) throw new Error(devIssued.detail);
    expect(call({ type: 'READ_CONTEXT' }, devIssued.sessionToken)).toBe('session_unknown');

    // Expiry is the session's; nothing the client sends extends it.
    advance(POLICY.sessionTtlMs);
    expect(call({ type: 'READ_CONTEXT' })).toBe('session_expired');
    expect(audit.filter((event) => event.action === 'CALL_REFUSED').map((event) => event.reasonCode)).toEqual([
      'other_run', 'other_mission', 'state_mode_is_bound', 'kind_not_permitted', 'kind_not_permitted', 'mutation_out_of_scope', 'mutation_out_of_scope',
      'other_run', 'raw_store_not_exposed', 'session_unknown', 'session_unknown', 'session_expired',
    ]);
    expect(JSON.stringify(audit)).not.toContain(session);
  });

  it('retrieval is selected by the service under the bound mode: a FRESH session never sees the archived attempt', async () => {
    const store = createJuliusBrainMemoryStore();
    const brains = createJuliusProjectBrainService({ store, clock: { now: () => '2026-09-15T12:00:00.000Z' } });
    await brains.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: juliusPrincipal('JULIUS', 'julius') });
    const content = { put: async (bytes: Uint8Array) => { const hex = createHash('sha256').update(bytes).digest('hex'); return { contentHash: `sha256:${hex}`, byteSize: bytes.byteLength, storageRef: `cas://sha256/${hex}` }; } };
    expect((await importJuliusPaidRunArchive({ store, brainId: BRAIN, projectId: PROJECT, archive: paidRunArchive(), content, recordedAt: '2026-09-15T12:00:00.000Z' })).outcome).toBe('IMPORTED');
    const julius = (await brains.open({ brainId: BRAIN, projectId: PROJECT, principal: juliusPrincipal('JULIUS', 'julius') }))!;
    await julius.create('OBJECTIVE', { statement: 'Implement the trust core', successMeasure: null }, { key: 'objective', scope: { missionId: MISSION } });
    const { access } = service('production');
    const issued = access.issueSession({ token: token(), projectId: PROJECT, missionId: MISSION, stateMode: fresh() });
    if (!issued.ok) throw new Error(issued.detail);
    const view = access.context(issued.session, await readAllJuliusBrainEntities(store, BRAIN, PROJECT), { role: 'CODING_AGENT', budgetCharacters: 50_000 })!;
    expect(view.items.map((item) => item.text).join('\n')).toContain('Implement the trust core');
    expect(view.items.some((item) => item.entityId.startsWith('archive:'))).toBe(false);
  });
});
