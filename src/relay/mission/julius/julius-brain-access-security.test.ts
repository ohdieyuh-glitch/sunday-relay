import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  createJuliusBrainAccessMemoryState,
  createJuliusBrainAccessService,
  verifyJuliusBrainAuditChain,
  type JuliusBrainAccessStatePort,
  type JuliusBrainAuditEvent,
  type JuliusBrainServiceCall,
  type JuliusBrainStateModeGrant,
} from './julius-brain-access';
import { createAccessFixtureIssuer } from './julius-brain-access-fixtures';
import { paidRunArchive } from './julius-brain-archive-fixtures';
import { importJuliusPaidRunArchive } from './julius-brain-archive-import';
import { juliusPrincipal, type JuliusBrainDraft } from './julius-brain-contracts';
import { createJuliusProjectBrainService } from './julius-brain-service';
import { juliusBrainStateModePolicyHash, pinJuliusBrainRegressionBaseline, type JuliusBrainStateModePolicy } from './julius-brain-state-modes';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities } from './julius-brain-store';

/**
 * THE BRAIN SERVICE UNDER ATTACK, ONE THREAT AT A TIME.
 *
 * Every refusal writes an audited decision and nothing else; a restart is a new
 * service over the same durable state. The real-PostgreSQL state port is proven
 * in scripts/julius-brain-access-postgres.test.ts.
 */

const START = Date.parse('2026-09-15T12:00:00.000Z') / 1000;
const ISSUER = createAccessFixtureIssuer(START);
const MISSION = 'mission:julius-live-4';
const PROJECT = 'prj-julius-live-4';
const BRAIN = 'brain:prj-julius-live-4';
const RUN = 'workflow:35000000000/1';
const PRIOR = 'workflow:34739303313/1';
const JULIUS = juliusPrincipal('JULIUS', 'julius');

const fresh = (runId = RUN, missionId = MISSION): JuliusBrainStateModePolicy => ({ mode: 'FRESH', missionId, runId });
const continuation = (runId = RUN): JuliusBrainStateModePolicy => ({ mode: 'CONTINUATION', missionId: MISSION, runId, resumes: [PRIOR] });
const learning = (runId = RUN): JuliusBrainStateModePolicy => ({ mode: 'LEARNING', missionId: MISSION, runId, learnFrom: { runIds: [PRIOR], kinds: ['FINDING'], requireVerified: false } });
const regression = (runId = RUN): JuliusBrainStateModePolicy => ({ mode: 'REGRESSION', missionId: MISSION, runId, baseline: { runId: PRIOR, entityCount: 1, throughSequence: 1, snapshotHash: `sha256:${'0'.repeat(64)}` } });
const grantFor = (policy: JuliusBrainStateModePolicy): JuliusBrainStateModeGrant => ({ brainRunId: policy.runId, missionId: policy.missionId, policyHash: juliusBrainStateModePolicyHash(policy) });

function harness(options: { environment?: 'production' | 'development'; grants?: JuliusBrainStateModeGrant[]; state?: JuliusBrainAccessStatePort & { audit?: JuliusBrainAuditEvent[] } } = {}) {
  const environment = options.environment ?? 'production';
  const state = options.state ?? createJuliusBrainAccessMemoryState();
  const grants = options.grants ?? [];
  let now = START * 1000;
  const clock = { now: () => new Date(now).toISOString() };
  const build = (env = environment) => createJuliusBrainAccessService({ brainId: BRAIN, environment: env, binding: { databaseEnvironment: env }, policy: ISSUER.policy, keys: ISSUER.keys, grants: () => grants, clock, state });
  let access = build();
  const h = {
    state, grants,
    get access() { return access; },
    /** A new service process over the same durable state. */
    restart: () => { access = build(); },
    advance: (ms: number) => { now += ms; },
    issue: async (token: string, stateMode: JuliusBrainStateModePolicy = fresh(), input: { projectId?: string; missionId?: string } = {}) =>
      access.issueSession({ token, projectId: input.projectId ?? PROJECT, missionId: input.missionId ?? stateMode.missionId, stateMode }),
    reason: async (token: string, stateMode: JuliusBrainStateModePolicy = fresh(), input: { projectId?: string; missionId?: string } = {}) => {
      const result = await h.issue(token, stateMode, input);
      return result.ok ? 'issued' : result.reasonCode;
    },
    session: async (token: string = ISSUER.mint(), stateMode: JuliusBrainStateModePolicy = fresh()) => {
      const result = await h.issue(token, stateMode);
      if (!result.ok) throw new Error(`${result.reasonCode}: ${result.detail}`);
      return result;
    },
    call: async (sessionToken: string, call: JuliusBrainServiceCall, facts?: Parameters<typeof access.authorize>[0]['facts']) => {
      const result = await access.authorize({ sessionToken, call, facts });
      return result.ok ? 'allowed' : result.reasonCode;
    },
  };
  return h;
}

const draft = (patch: Partial<JuliusBrainDraft> = {}): JuliusBrainDraft => ({
  kind: 'EVIDENCE', op: 'CREATE', entityId: null, expectedVersion: 0, body: {}, links: [], scope: { missionId: MISSION, runId: RUN, taskId: null },
  retention: 'DURABLE', confidence: null, sensitivity: 'INTERNAL', provenance: { source: 'run_observed', provider: null, model: null, tool: null, commit: null, externalRef: null, executionId: null },
  idempotencyKey: 'k', occurredAt: null, ...patch,
});

describe('Brain service security', () => {
  it('wrong repository, owner, workflow, ref, event or environment: no session, no registration, an audited refusal', async () => {
    const h = harness();
    const wrong: [Record<string, unknown>, string][] = [
      [{ repository_id: '1100220034' }, 'token_claim_refused'],
      [{ repository_owner_id: '4400550067' }, 'token_claim_refused'],
      [{ workflow_ref: 'ohdieyuh-glitch/sunday-relay/.github/workflows/some-other-workflow.yml@refs/heads/main' }, 'token_claim_refused'],
      [{ workflow_ref: 'someone-else/sunday-relay/.github/workflows/julius-first-live-mission.yml@refs/heads/main' }, 'token_claim_refused'],
      [{ ref: 'refs/heads/attacker' }, 'token_claim_refused'],
      [{ event_name: 'pull_request' }, 'token_claim_refused'],
      [{ environment: 'julius-unprotected' }, 'token_claim_refused'],
      [{ environment: 'julius-dev' }, 'environment_mismatch'],
    ];
    for (const [claims, reason] of wrong) expect(await h.reason(ISSUER.mint(claims)), JSON.stringify(claims)).toBe(reason);
    // None of them registered the attempt: it may still register FRESH.
    expect(await h.reason(ISSUER.mint())).toBe('issued');
    expect(h.state.audit!.map((event) => event.action)).toEqual([...wrong.map(() => 'SESSION_REFUSED'), 'SESSION_ISSUED']);
  });

  it('wrong attempt: a policy, read, write or seal for another attempt of the same workflow run is refused; attempts register independently', async () => {
    const h = harness();
    const attempt1 = await h.session();
    expect(await h.reason(ISSUER.mint({ run_attempt: '2' }), fresh(RUN))).toBe('state_mode_not_for_this_run');
    const ATTEMPT_2 = 'workflow:35000000000/2';
    expect(await h.call(attempt1.sessionToken, { type: 'READ_CONTEXT', runId: ATTEMPT_2 })).toBe('other_run');
    expect(await h.call(attempt1.sessionToken, { type: 'WRITE', drafts: [draft({ scope: { missionId: MISSION, runId: ATTEMPT_2, taskId: null } })] })).toBe('mutation_out_of_scope');
    expect(await h.call(attempt1.sessionToken, { type: 'SEAL', runId: ATTEMPT_2 })).toBe('other_run');
    // Attempt 2 is its own registration, with its own mode.
    const attempt2 = await h.session(ISSUER.mint({ run_attempt: '2' }), fresh(ATTEMPT_2));
    expect(attempt2.session.brainRunId).toBe(ATTEMPT_2);
    expect(await h.call(attempt2.sessionToken, { type: 'SEAL', runId: RUN })).toBe('other_run');
  });

  it('replayed, expired and future-issued tokens are refused; a spent token stays spent across a restart and after a refusal', async () => {
    const h = harness();
    const token = ISSUER.mint();
    expect(await h.reason(token)).toBe('issued');
    expect(await h.reason(token)).toBe('token_replayed');
    h.restart();
    expect(await h.reason(token)).toBe('token_replayed');

    // A token refused for its mode is spent all the same: it cannot come back with a humbler request.
    const spent = ISSUER.mint({ run_id: '35000000003' });
    expect(await h.reason(spent, learning('workflow:35000000003/1'))).toBe('state_mode_not_authorized');
    expect(await h.reason(spent, fresh('workflow:35000000003/1'))).toBe('token_replayed');

    expect(await h.reason(ISSUER.mint({ iat: START - 400, nbf: START - 400, exp: START - 100 }))).toBe('token_expired');
    expect(await h.reason(ISSUER.mint({ iat: START + 120, nbf: START + 120, exp: START + 420 }))).toBe('token_not_yet_valid');
    expect(await h.reason(ISSUER.mint({ iat: START - 1_000, nbf: START - 1_000, exp: START + 300 }))).toBe('token_too_old');
    // Within the clock-skew allowance, an honest clock difference is not an attack.
    expect(await h.reason(ISSUER.mint({ run_id: '35000000004', iat: START + 30, nbf: START + 30, exp: START + 330 }), fresh('workflow:35000000004/1'))).toBe('issued');
  });

  it('state-mode escalation FRESH → CONTINUATION, LEARNING or REGRESSION: refused without a grant, refused with one once registered, refused per call, and still refused after a restart', async () => {
    const h = harness();
    const bound = await h.session();
    for (const policy of [continuation(), learning(), regression()]) {
      expect(await h.reason(ISSUER.mint(), policy), policy.mode).toBe('state_mode_not_authorized');
      expect(await h.call(bound.sessionToken, { type: 'READ_CONTEXT', stateMode: policy }), policy.mode).toBe('state_mode_is_bound');
    }
    // An operator grant that arrives after the attempt registered FRESH does not re-open the mode.
    h.grants.push(grantFor(continuation()), grantFor(learning()), grantFor(regression()));
    for (const policy of [continuation(), learning(), regression()]) expect(await h.reason(ISSUER.mint(), policy), policy.mode).toBe('run_registration_mismatch');
    h.restart();
    for (const policy of [continuation(), learning(), regression()]) expect(await h.reason(ISSUER.mint(), policy), policy.mode).toBe('run_registration_mismatch');
    expect(await h.reason(ISSUER.mint())).toBe('issued');

    // A grant authorises exactly its run, mission and policy: not a neighbour, not a variation.
    const other = 'workflow:35000000005/1';
    h.grants.push(grantFor(learning(other)));
    const token = () => ISSUER.mint({ run_id: '35000000005' });
    const variant = (learnFrom: { runIds: string[] | null; kinds: ('FINDING' | 'DECISION')[] }): JuliusBrainStateModePolicy => ({ mode: 'LEARNING', missionId: MISSION, runId: other, learnFrom: { ...learnFrom, requireVerified: false } });
    expect(await h.reason(token(), variant({ runIds: null, kinds: ['FINDING'] }))).toBe('state_mode_not_authorized');
    expect(await h.reason(token(), variant({ runIds: [PRIOR], kinds: ['FINDING', 'DECISION'] }))).toBe('state_mode_not_authorized');
    expect(await h.reason(ISSUER.mint({ run_id: '35000000006' }), learning('workflow:35000000006/1'))).toBe('state_mode_not_authorized');
    expect(await h.reason(token(), learning(other))).toBe('issued');
  });

  it('cross-mission access: another mission is neither read, written, registered nor retrieved', async () => {
    const store = createJuliusBrainMemoryStore();
    const brains = createJuliusProjectBrainService({ store, clock: { now: () => '2026-09-15T12:00:00.000Z' } });
    await brains.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
    const julius = (await brains.open({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS }))!;
    await julius.create('CONSTRAINT', { statement: 'Mission B: never touch the billing ledger', status: 'ACTIVE' }, { key: 'b-constraint', scope: { missionId: 'mission:b' } });
    await julius.create('CONSTRAINT', { statement: 'Mission A: edit only the trust core', status: 'ACTIVE' }, { key: 'a-constraint', scope: { missionId: MISSION } });

    const h = harness();
    const a = await h.session();
    expect(await h.call(a.sessionToken, { type: 'READ_CONTEXT', missionId: 'mission:b' })).toBe('other_mission');
    expect(await h.call(a.sessionToken, { type: 'WRITE', drafts: [draft({ scope: { missionId: 'mission:b', runId: RUN, taskId: null } })] })).toBe('mutation_out_of_scope');
    expect(await h.reason(ISSUER.mint(), fresh(RUN, 'mission:b'))).toBe('run_registration_mismatch');
    expect(await h.reason(ISSUER.mint(), fresh(RUN, MISSION), { missionId: 'mission:b' })).toBe('state_mode_not_for_this_run');
    const view = h.access.context(a.session, await readAllJuliusBrainEntities(store, BRAIN, PROJECT), { role: 'CODING_AGENT', budgetCharacters: 50_000 })!;
    expect(view.items.map((item) => item.text).join('\n')).toContain('Mission A');
    expect(view.items.map((item) => item.text).join('\n')).not.toContain('Mission B');
  });

  it('foreign artifact access: only an artifact the bound mode admits is readable', async () => {
    const store = createJuliusBrainMemoryStore();
    const brains = createJuliusProjectBrainService({ store, clock: { now: () => '2026-09-15T12:00:00.000Z' } });
    await brains.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
    const content = { put: async (bytes: Uint8Array) => { const hex = createHash('sha256').update(bytes).digest('hex'); return { contentHash: `sha256:${hex}`, byteSize: bytes.byteLength, storageRef: `cas://sha256/${hex}` }; } };
    expect((await importJuliusPaidRunArchive({ store, brainId: BRAIN, projectId: PROJECT, archive: paidRunArchive(), content, recordedAt: '2026-09-15T12:00:00.000Z' })).outcome).toBe('IMPORTED');
    const julius = (await brains.open({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS }))!;
    const artifact = (hash: string) => ({ artifactClass: 'REPORT', name: 'report.md', contentType: 'text/markdown', byteSize: 10, contentHash: `sha256:${hash.repeat(64)}`, storageRef: `cas://sha256/${hash.repeat(64)}`, commit: null });
    await julius.create('ARTIFACT', artifact('a'), { key: 'mine', scope: { missionId: MISSION, runId: RUN } });
    await julius.create('ARTIFACT', artifact('b'), { key: 'other-mission', scope: { missionId: 'mission:b', runId: 'workflow:35000000009/1' } });
    const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
    const prior = paidRunArchive().artifacts[0]!.contentHash;
    const read = (contentHash: string) => ({ type: 'READ_ARTIFACT' as const, contentHash });

    const h = harness({ grants: [grantFor(continuation()), grantFor(learning('workflow:35000000000/2')), grantFor({ ...regression('workflow:35000000000/3'), baseline: pinJuliusBrainRegressionBaseline(entities, PRIOR) } as JuliusBrainStateModePolicy)] });
    const freshSession = await h.session();
    expect(await h.call(freshSession.sessionToken, read(`sha256:${'a'.repeat(64)}`), { entities })).toBe('allowed');
    expect(await h.call(freshSession.sessionToken, read(prior), { entities })).toBe('artifact_not_admitted');
    expect(await h.call(freshSession.sessionToken, read(`sha256:${'b'.repeat(64)}`), { entities })).toBe('artifact_not_admitted');
    expect(await h.call(freshSession.sessionToken, read(`sha256:${'c'.repeat(64)}`), { entities })).toBe('artifact_not_admitted');
    // Without the service's own resolution, nothing is readable.
    expect(await h.call(freshSession.sessionToken, read(`sha256:${'a'.repeat(64)}`))).toBe('artifact_not_admitted');

    // A mode that names the prior run may read its artifact — CONTINUATION and REGRESSION's baseline — and LEARNING of findings only may not.
    const h2 = harness({ grants: h.grants });
    const resumed = await h2.session(ISSUER.mint(), continuation());
    expect(await h2.call(resumed.sessionToken, read(prior), { entities })).toBe('allowed');
    const learned = await h2.session(ISSUER.mint({ run_attempt: '2' }), learning('workflow:35000000000/2'));
    expect(await h2.call(learned.sessionToken, read(prior), { entities })).toBe('artifact_not_admitted');
    const compared = await h2.session(ISSUER.mint({ run_attempt: '3' }), { ...regression('workflow:35000000000/3'), baseline: pinJuliusBrainRegressionBaseline(entities, PRIOR) } as JuliusBrainStateModePolicy);
    expect(await h2.call(compared.sessionToken, read(prior), { entities })).toBe('allowed');
    expect(await h2.call(compared.sessionToken, read(`sha256:${'b'.repeat(64)}`), { entities })).toBe('artifact_not_admitted');
  });

  it('protected and run-less mutation: authority kinds, foreign or unresolved targets, run-less and mission-less drafts are refused', async () => {
    const h = harness();
    const { sessionToken } = await h.session();
    const write = (drafts: JuliusBrainDraft[], targets?: Map<string, { runId: string | null; missionId: string | null }>) => h.call(sessionToken, { type: 'WRITE', drafts }, { targets });
    for (const kind of ['MISSION', 'MISSION_STATE', 'CHECKPOINT', 'PYTHON_EXECUTION'] as const) expect(await write([draft({ kind })]), kind).toBe('kind_not_permitted');
    expect(await write([draft({ kind: 'CONSTRAINT', scope: { missionId: MISSION, runId: null, taskId: null } })])).toBe('mutation_out_of_scope');
    expect(await write([draft({ scope: { missionId: null, runId: RUN, taskId: null } })])).toBe('mutation_out_of_scope');
    // A revision or retirement scoped to this run may still target another run's entity: the service's resolution decides.
    const foreign = `legacy:${PRIOR}:seed:constraint`;
    const mine = 'evidence:mine';
    const targets = new Map([[foreign, { runId: PRIOR, missionId: MISSION }], [mine, { runId: RUN, missionId: MISSION }], ['authority:objective', { runId: null, missionId: MISSION }]]);
    expect(await write([draft({ op: 'REVISE', entityId: foreign, expectedVersion: 1 })], targets)).toBe('mutation_out_of_scope');
    expect(await write([draft({ op: 'RETIRE', entityId: foreign, expectedVersion: 1 })], targets)).toBe('mutation_out_of_scope');
    expect(await write([draft({ kind: 'OBJECTIVE', op: 'REVISE', entityId: 'authority:objective', expectedVersion: 1 })], targets)).toBe('mutation_out_of_scope');
    expect(await write([draft({ op: 'REVISE', entityId: 'evidence:unresolved', expectedVersion: 1 })], targets)).toBe('mutation_target_unresolved');
    expect(await write([draft({ op: 'REVISE', entityId: mine, expectedVersion: 1 })])).toBe('mutation_target_unresolved');
    expect(await write([draft({ op: 'REVISE', entityId: mine, expectedVersion: 1 })], targets)).toBe('allowed');
    expect(await h.call(sessionToken, { type: 'RAW_STORE', operation: 'UPDATE julius_brain.records SET record = null' })).toBe('raw_store_not_exposed');
  });

  it('audit tampering is detected: an edited, removed, inserted or reordered decision; a truncated tail against an anchor; and an unwritable audit refuses', async () => {
    const h = harness();
    const { sessionToken } = await h.session();
    await h.call(sessionToken, { type: 'READ_CONTEXT' });
    await h.call(sessionToken, { type: 'RAW_STORE', operation: 'DROP' });
    await h.reason(ISSUER.mint({ environment: 'julius-dev' }));
    await h.call(sessionToken, { type: 'SEAL', runId: RUN });
    const audit = await h.state.readAudit();
    expect(audit.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(verifyJuliusBrainAuditChain(audit)).toEqual({ ok: true, problems: [] });
    const anchor = { sequence: 5, hash: audit[4]!.hash };

    // A refusal rewritten as an allowance.
    expect(verifyJuliusBrainAuditChain(audit.map((event) => (event.sequence === 3 ? { ...event, action: 'CALL_ALLOWED' as const, reasonCode: null } : event)))).toEqual({ ok: false, problems: ['event 3: its content does not match its hash'] });
    // A decision removed from the middle.
    expect(verifyJuliusBrainAuditChain(audit.filter((event) => event.sequence !== 3)).problems).toEqual(['event 4: out of sequence (expected 3)']);
    // Reordered.
    expect(verifyJuliusBrainAuditChain([audit[0]!, audit[2]!, audit[1]!, audit[3]!, audit[4]!]).ok).toBe(false);
    // A forged event inserted with a recomputed hash but the wrong predecessor.
    const forged = { ...audit[2]!, sequence: 3, previousHash: audit[0]!.hash };
    expect(verifyJuliusBrainAuditChain([audit[0]!, audit[1]!, forged, ...audit.slice(3)]).ok).toBe(false);
    // The newest decisions removed: invisible to the chain alone, caught by the anchor.
    expect(verifyJuliusBrainAuditChain(audit.slice(0, 3)).ok).toBe(true);
    expect(verifyJuliusBrainAuditChain(audit.slice(0, 3), anchor)).toEqual({ ok: false, problems: ['the anchored event 5 is missing'] });
    // No token, token id or session token anywhere in it.
    expect(JSON.stringify(audit)).not.toContain(sessionToken);
    expect(JSON.stringify(audit)).not.toMatch(/jti-|eyJ/);

    // An audit that cannot be written is a refusal, not a silent decision: no session token is handed out, no call is allowed.
    const broken = createJuliusBrainAccessMemoryState();
    const failing: JuliusBrainAccessStatePort = { ...broken, appendAudit: async () => { throw new Error('audit_unavailable'); } };
    const blind = harness({ state: failing });
    await expect(blind.issue(ISSUER.mint())).rejects.toThrow('audit_unavailable');
    const working = harness({ state: broken });
    const issued = await working.session();
    const failingAfter: JuliusBrainAccessStatePort = { ...broken, appendAudit: async () => { throw new Error('audit_unavailable'); } };
    const later = harness({ state: failingAfter });
    await expect(later.access.authorize({ sessionToken: issued.sessionToken, call: { type: 'READ_CONTEXT' } })).rejects.toThrow('audit_unavailable');
  });

  it('session reuse after expiry: every call refused, across a restart; a new token opens a new session under the same bound mode', async () => {
    const h = harness();
    const old = await h.session();
    h.advance(3 * 60 * 60 * 1000);
    for (const call of [{ type: 'READ_CONTEXT' }, { type: 'WRITE', drafts: [draft()] }, { type: 'SEAL', runId: RUN }, { type: 'READ_ARTIFACT', contentHash: `sha256:${'a'.repeat(64)}` }] as JuliusBrainServiceCall[]) {
      expect(await h.call(old.sessionToken, call), call.type).toBe('session_expired');
    }
    h.restart();
    expect(await h.call(old.sessionToken, { type: 'READ_CONTEXT' })).toBe('session_expired');
    const iat = START + 3 * 60 * 60;
    const renewed = await h.session(ISSUER.mint({ iat, nbf: iat, exp: iat + 300 }));
    expect(renewed.session).toMatchObject({ brainRunId: RUN, policyHash: old.session.policyHash });
    expect(renewed.session.sessionId).not.toBe(old.session.sessionId);
    expect(await h.call(renewed.sessionToken, { type: 'READ_CONTEXT' })).toBe('allowed');
    expect(await h.call(old.sessionToken, { type: 'READ_CONTEXT' })).toBe('session_expired');
  });

  it('a production service with a development binding does not start; development tokens, sessions and registrations do not reach production', async () => {
    const state = createJuliusBrainAccessMemoryState();
    const construct = (environment: 'production' | 'development', databaseEnvironment: 'production' | 'development' | 'test') => () => createJuliusBrainAccessService({
      brainId: BRAIN, environment, binding: { databaseEnvironment }, policy: ISSUER.policy, keys: ISSUER.keys, grants: () => [], clock: { now: () => new Date(START * 1000).toISOString() }, state,
    });
    expect(construct('production', 'development')).toThrow('julius_brain_access_binding_mismatch: a production service bound to a development Brain database');
    expect(construct('production', 'test')).toThrow('julius_brain_access_binding_mismatch');
    expect(construct('development', 'production')).toThrow('julius_brain_access_binding_mismatch');

    // Development and production services misconfigured onto one shared access state still keep apart.
    const dev = harness({ environment: 'development', state });
    const prod = harness({ environment: 'production', state });
    expect(await prod.reason(ISSUER.mint({ environment: 'julius-dev' }))).toBe('environment_mismatch');
    const devSession = await dev.session(ISSUER.mint({ environment: 'julius-dev' }));
    expect(await prod.call(devSession.sessionToken, { type: 'READ_CONTEXT' })).toBe('environment_mismatch');
    expect(await prod.reason(ISSUER.mint())).toBe('run_registration_mismatch');
  });
});
