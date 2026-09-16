import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  createJuliusBrainAccessMemoryState,
  createJuliusBrainAccessService,
  GITHUB_ACTIONS_OIDC_ISSUER,
  readJuliusBrainTokenHeader,
  type JuliusBrainJwk,
} from './julius-brain-access';
import { ACCESS_FIXTURE_POLICY } from './julius-brain-access-fixtures';
import { classifyJuliusBrainFailure, JuliusBrainAccessError } from './julius-brain-failure-model';
import { createJuliusBrainOidcKeyStore } from './julius-brain-oidc-keys';
import type { JuliusBrainStateModePolicy } from './julius-brain-state-modes';

/**
 * THE ISSUER'S KEYS, ROTATED UNDER US. No network: the transport is injected and
 * time is a number this test moves.
 */

const URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';
const START = Date.parse('2026-09-15T12:00:00.000Z');
const MISSION = 'mission:julius-live-4';
const PROJECT = 'prj-julius-live-4';
const RUN = 'workflow:35000000000/1';
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A signing key and the JWKS entry that verifies it. */
function keyPair(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk: JuliusBrainJwk = { ...(publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string }), kid, alg: 'RS256', use: 'sig' };
  const mint = (overrides: Record<string, unknown> = {}, header: Record<string, unknown> = { alg: 'RS256', kid, typ: 'JWT' }) => {
    const seconds = Math.floor(START / 1000);
    const payload = {
      iss: GITHUB_ACTIONS_OIDC_ISSUER, aud: ACCESS_FIXTURE_POLICY.audience, iat: seconds, nbf: seconds, exp: seconds + 300, jti: `jti-${kid}-${Math.random().toString(36).slice(2)}`,
      repository_id: ACCESS_FIXTURE_POLICY.repositoryId, repository_owner_id: ACCESS_FIXTURE_POLICY.repositoryOwnerId,
      workflow_ref: ACCESS_FIXTURE_POLICY.workflowRef, ref: ACCESS_FIXTURE_POLICY.ref, event_name: 'workflow_dispatch', environment: 'julius-paid', run_id: '35000000000', run_attempt: '1',
      ...overrides,
    };
    const signingInput = `${b64(header)}.${b64(payload)}`;
    return `${signingInput}.${sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')}`;
  };
  return { jwk, mint };
}

function world(options: { cacheTtlMs?: number; staleLimitMs?: number; minRefreshIntervalMs?: number } = {}) {
  let now = START;
  const fetched: string[] = [];
  let answer: { status: number; body: string } | Error = { status: 200, body: JSON.stringify({ keys: [] }) };
  const store = createJuliusBrainOidcKeyStore({
    issuers: { [GITHUB_ACTIONS_OIDC_ISSUER]: URL },
    fetch: async (url) => { fetched.push(url); if (answer instanceof Error) throw answer; return answer; },
    clock: { now: () => new Date(now).toISOString() },
    cacheTtlMs: options.cacheTtlMs ?? 10 * 60 * 1000,
    staleLimitMs: options.staleLimitMs ?? 6 * 60 * 60 * 1000,
    minRefreshIntervalMs: options.minRefreshIntervalMs ?? 30 * 1000,
  });
  return {
    store, fetched,
    advance: (ms: number) => { now += ms; },
    publish: (keys: readonly unknown[]) => { answer = { status: 200, body: JSON.stringify({ keys }) }; },
    serve: (value: { status: number; body: string } | Error) => { answer = value; },
    resolve: (kid: string) => store.resolve(GITHUB_ACTIONS_OIDC_ISSUER, kid),
  };
}

describe('the issuer key store', () => {
  it('a cached key serves without fetching again until the cache expires', async () => {
    const one = keyPair('k1');
    const w = world({ cacheTtlMs: 60_000 });
    w.publish([one.jwk]);
    expect(await w.resolve('k1')).toMatchObject({ ok: true, refreshed: true, servedStale: false });
    expect(await w.resolve('k1')).toMatchObject({ ok: true, refreshed: false });
    expect(w.fetched).toHaveLength(1);
    w.advance(60_000);
    expect(await w.resolve('k1')).toMatchObject({ ok: true, refreshed: true });
    expect(w.fetched).toHaveLength(2);
  });

  it('a key that rotates between calls: the new one verifies, the withdrawn one no longer does', async () => {
    const before = keyPair('k1');
    const after = keyPair('k2');
    const w = world({ cacheTtlMs: 60_000, minRefreshIntervalMs: 0 });
    w.publish([before.jwk]);
    expect((await w.resolve('k1')).ok).toBe(true);
    w.publish([after.jwk]);
    // The new id is unknown to the cache, so it refreshes; the old id is then gone for good.
    expect(await w.resolve('k2')).toMatchObject({ ok: true, refreshed: true });
    expect(await w.resolve('k1')).toMatchObject({ ok: false, reasonCode: 'key_unknown' });
  });

  it('an unknown key id refreshes once, and a flood of forged ids cannot drive fetches', async () => {
    const one = keyPair('k1');
    const w = world({ cacheTtlMs: 600_000, minRefreshIntervalMs: 30_000 });
    w.publish([one.jwk]);
    expect((await w.resolve('k1')).ok).toBe(true);
    expect(w.fetched).toHaveLength(1);
    // First unknown id: one refresh. It still does not appear, so it is refused.
    w.advance(30_000);
    expect(await w.resolve('forged')).toMatchObject({ ok: false, reasonCode: 'key_unknown' });
    expect(w.fetched).toHaveLength(2);
    for (let i = 0; i < 50; i += 1) expect((await w.resolve(`forged-${i}`)).ok).toBe(false);
    expect(w.fetched).toHaveLength(2);
    // Past the floor, one more fetch is allowed.
    w.advance(30_000);
    expect((await w.resolve('forged')).ok).toBe(false);
    expect(w.fetched).toHaveLength(3);
  });

  it('a refresh that answers without the key refuses it, and keeps serving the keys it did answer with', async () => {
    const one = keyPair('k1');
    const two = keyPair('k2');
    const w = world({ cacheTtlMs: 60_000, minRefreshIntervalMs: 0 });
    w.publish([one.jwk, two.jwk]);
    expect((await w.resolve('k1')).ok).toBe(true);
    w.publish([two.jwk]);
    expect(await w.resolve('k3')).toMatchObject({ ok: false, reasonCode: 'key_unknown' });
    expect((await w.resolve('k2')).ok).toBe(true);
    expect(await w.resolve('k1')).toMatchObject({ ok: false, reasonCode: 'key_unknown' });
  });

  it('when the issuer cannot be reached: cached keys serve for a bounded time, then everything is refused', async () => {
    const one = keyPair('k1');
    const w = world({ cacheTtlMs: 60_000, staleLimitMs: 3 * 60_000, minRefreshIntervalMs: 0 });
    w.publish([one.jwk]);
    expect((await w.resolve('k1')).ok).toBe(true);
    w.serve(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    // Inside the stale limit the cached key still verifies, and says it is stale.
    w.advance(2 * 60_000);
    expect(await w.resolve('k1')).toMatchObject({ ok: true, servedStale: true, refreshed: false });
    // Past it, nothing verifies: a key withdrawn while we were blind must not keep working.
    w.advance(2 * 60_000);
    expect(await w.resolve('k1')).toMatchObject({ ok: false, reasonCode: 'jwks_stale_beyond_limit' });
    // A store that never fetched anything refuses too.
    const cold = world();
    cold.serve(new Error('connect ECONNREFUSED'));
    expect(await cold.resolve('k1')).toMatchObject({ ok: false, reasonCode: 'jwks_unavailable' });
    expect(classifyJuliusBrainFailure(new JuliusBrainAccessError('issuer_keys_unavailable', 'x'))).toMatchObject({ failureClass: 'OIDC_UNAVAILABLE', retryable: true });
  });

  it('algorithm substitution: a symmetric or non-RS256 key published under a key id is never reachable', async () => {
    const one = keyPair('k1');
    const w = world({ minRefreshIntervalMs: 0 });
    w.publish([
      { kty: 'oct', kid: 'k1', k: 'c2VjcmV0', alg: 'HS256' },
      { kty: 'RSA', kid: 'hs', n: one.jwk.n, e: one.jwk.e, alg: 'HS256' },
      { kty: 'EC', kid: 'ec', crv: 'P-256', x: 'a', y: 'b' },
      { kty: 'RSA', kid: 'enc', n: one.jwk.n, e: one.jwk.e, use: 'enc' },
      one.jwk,
    ]);
    expect(await w.resolve('k1')).toMatchObject({ ok: true, key: { kty: 'RSA', alg: 'RS256' } });
    expect((await w.resolve('k1') as { key: JuliusBrainJwk }).key.n).toBe(one.jwk.n);
    for (const kid of ['hs', 'ec', 'enc']) expect(await w.resolve(kid), kid).toMatchObject({ ok: false, reasonCode: 'key_unknown' });
    // And a token that asks for another algorithm never reaches a key at all.
    expect(readJuliusBrainTokenHeader(one.mint({}, { alg: 'HS256', kid: 'k1' }))).toMatchObject({ ok: false, reasonCode: 'token_algorithm_refused' });
    expect(readJuliusBrainTokenHeader(one.mint({}, { alg: 'none', kid: 'k1' }))).toMatchObject({ ok: false, reasonCode: 'token_algorithm_refused' });
  });

  it('a malformed key set is refused and does not replace what was already known', async () => {
    const one = keyPair('k1');
    const w = world({ cacheTtlMs: 60_000, minRefreshIntervalMs: 0 });
    w.publish([one.jwk]);
    expect((await w.resolve('k1')).ok).toBe(true);
    for (const bad of [{ status: 200, body: 'not json' }, { status: 200, body: '{"keys":"soon"}' }, { status: 500, body: '{}' }, { status: 200, body: `{"keys":[],"pad":"${'x'.repeat(300_000)}"}` }]) {
      w.serve(bad);
      w.advance(60_000);
      expect((await w.resolve('k1')).ok, bad.body.slice(0, 20)).toBe(true); // the previous keys still stand
    }
    expect(w.store.status()[0]).toMatchObject({ issuer: GITHUB_ACTIONS_OIDC_ISSUER, kids: ['k1'], lastFailure: expect.stringMatching(/jwks_(malformed|unavailable)/) });
    // An answer that is a key set with nothing in it does replace them: every key may have been withdrawn.
    w.publish([]);
    w.advance(60_000);
    expect(await w.resolve('k1')).toMatchObject({ ok: false, reasonCode: 'key_unknown' });
  });

  it('two different keys under one id resolve to neither; an identical duplicate is not an ambiguity', async () => {
    const one = keyPair('k1');
    const impostor = keyPair('k1');
    const w = world({ minRefreshIntervalMs: 0 });
    w.publish([one.jwk, impostor.jwk]);
    expect(await w.resolve('k1')).toMatchObject({ ok: false, reasonCode: 'key_ambiguous' });
    expect(w.store.status()[0]).toMatchObject({ ambiguousKids: ['k1'], kids: [] });
    w.publish([one.jwk, { ...one.jwk }]);
    w.advance(10 * 60_000);
    expect((await w.resolve('k1')).ok).toBe(true);
  });

  it('an issuer with no configured key set is unknown, whatever a token claims', async () => {
    const w = world();
    expect(await w.store.resolve('https://evil.example.org', 'k1')).toEqual({ ok: false, reasonCode: 'issuer_unknown', detail: 'no keys are configured for https://evil.example.org' });
    expect(w.fetched).toEqual([]);
  });

  it('through the service: rotation is followed, an unknown id is refused, a replay stays refused across a restart, and no token reaches the audit', async () => {
    const before = keyPair('k1');
    const after = keyPair('k2');
    const w = world({ cacheTtlMs: 60_000, minRefreshIntervalMs: 0 });
    w.publish([before.jwk]);
    const state = createJuliusBrainAccessMemoryState();
    const fresh: JuliusBrainStateModePolicy = { mode: 'FRESH', missionId: MISSION, runId: RUN };
    const service = () => createJuliusBrainAccessService({
      brainId: 'brain:prj-julius-live-4', environment: 'production', binding: { databaseEnvironment: 'production' }, policy: ACCESS_FIXTURE_POLICY,
      keys: w.store, grants: () => [], clock: { now: () => new Date(START).toISOString() }, state,
    });
    const issue = async (token: string) => { const result = await service().issueSession({ token, projectId: PROJECT, missionId: MISSION, stateMode: fresh }); return result.ok ? 'issued' : result.reasonCode; };

    const first = before.mint();
    expect(await issue(first)).toBe('issued');
    // Rotation: tokens from the new key are accepted, tokens from the withdrawn key are not.
    w.publish([after.jwk]);
    const rotated = after.mint();
    expect(await issue(rotated)).toBe('issued');
    expect(await issue(before.mint())).toBe('token_key_unknown');
    expect(await issue(after.mint({}, { alg: 'RS256', kid: 'k9' }))).toBe('token_key_unknown');
    // The issuer goes away entirely, past the stale limit: identity is unavailable, not assumed.
    const blind = world({ cacheTtlMs: 0, staleLimitMs: 0 });
    blind.serve(new Error('connect ECONNREFUSED'));
    const blindService = createJuliusBrainAccessService({
      brainId: 'brain:prj-julius-live-4', environment: 'production', binding: { databaseEnvironment: 'production' }, policy: ACCESS_FIXTURE_POLICY,
      keys: blind.store, grants: () => [], clock: { now: () => new Date(START).toISOString() }, state: createJuliusBrainAccessMemoryState(),
    });
    const unavailable = await blindService.issueSession({ token: after.mint(), projectId: PROJECT, missionId: MISSION, stateMode: fresh });
    expect(unavailable).toMatchObject({ ok: false, reasonCode: 'issuer_keys_unavailable' });
    // A token whose key was withdrawn is refused for that, before anything else is considered.
    expect(await issue(first)).toBe('token_key_unknown');
    // A restart does not forget a spent token: each `service()` call above is a new service process over the same state.
    expect(await issue(rotated)).toBe('token_replayed');
    const audit = await state.readAudit();
    expect(JSON.stringify(audit)).not.toContain(first.split('.')[2]!);
    expect(JSON.stringify(audit)).not.toMatch(/jti-k/);
  });
});
