import { describe, expect, it } from 'vitest';

import { createJuliusBrainAccessMemoryState, createJuliusBrainAccessService, type JuliusBrainAccessStatePort } from './julius-brain-access';
import { createAccessFixtureIssuer } from './julius-brain-access-fixtures';
import {
  classifyJuliusBrainFailure,
  decideJuliusBrainFailure,
  JULIUS_BRAIN_FAILURE_CLASSES,
  JuliusBrainAccessError,
  JuliusBrainOidcUnavailableError,
  JuliusBrainServiceUnavailableError,
  type JuliusBrainPhase,
} from './julius-brain-failure-model';
import { createJuliusBrainSessionClient, type JuliusBrainAccessPort } from './julius-brain-session-client';
import { JULIUS_BRAIN_STATE_MODES, type JuliusBrainStateModePolicy } from './julius-brain-state-modes';

const START = Date.parse('2026-09-15T12:00:00.000Z') / 1000;
const ISSUER = createAccessFixtureIssuer(START);
const MISSION = 'mission:julius-live-4';
const PROJECT = 'prj-julius-live-4';
const RUN = 'workflow:35000000000/1';
const coded = (code: string, message = 'failed') => Object.assign(new Error(message), { code });

describe('the Project Brain failure model', () => {
  it('classifies every named failure from the error, with whether the operation may have applied', () => {
    const cases: [unknown, string, 'NOT_APPLIED' | 'UNKNOWN', boolean][] = [
      [new JuliusBrainServiceUnavailableError(503), 'SERVICE_UNAVAILABLE', 'NOT_APPLIED', true],
      [new JuliusBrainServiceUnavailableError(504), 'SERVICE_UNAVAILABLE', 'UNKNOWN', true],
      [new JuliusBrainServiceUnavailableError(null, 'socket hang up'), 'SERVICE_UNAVAILABLE', 'UNKNOWN', true],
      [coded('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5442'), 'DATABASE_UNAVAILABLE', 'NOT_APPLIED', true],
      [coded('ENOTFOUND'), 'DATABASE_UNAVAILABLE', 'NOT_APPLIED', true],
      [coded('57P03', 'the database system is starting up'), 'DATABASE_UNAVAILABLE', 'NOT_APPLIED', true],
      [new Error('timeout exceeded when trying to connect'), 'DATABASE_UNAVAILABLE', 'NOT_APPLIED', true],
      [coded('25006', 'cannot execute INSERT in a read-only transaction'), 'DATABASE_READ_ONLY', 'NOT_APPLIED', true],
      [coded('DEPTH_ZERO_SELF_SIGNED_CERT', 'self-signed certificate'), 'TLS_VALIDATION_FAILED', 'NOT_APPLIED', false],
      [coded('ERR_TLS_CERT_ALTNAME_INVALID'), 'TLS_VALIDATION_FAILED', 'NOT_APPLIED', false],
      [new Error('julius_brain_database_connection_not_encrypted'), 'TLS_VALIDATION_FAILED', 'NOT_APPLIED', false],
      [coded('57014', 'canceling statement due to statement timeout'), 'TRANSACTION_TIMEOUT', 'NOT_APPLIED', true],
      [coded('55P03', 'canceling statement due to lock timeout'), 'TRANSACTION_TIMEOUT', 'NOT_APPLIED', true],
      [coded('40P01', 'deadlock detected'), 'TRANSACTION_TIMEOUT', 'NOT_APPLIED', true],
      [coded('57P01', 'terminating connection due to administrator command'), 'NETWORK_PARTIAL', 'UNKNOWN', true],
      [coded('ECONNRESET'), 'NETWORK_PARTIAL', 'UNKNOWN', true],
      [new Error('Connection terminated unexpectedly'), 'NETWORK_PARTIAL', 'UNKNOWN', true],
      [new JuliusBrainOidcUnavailableError(), 'OIDC_UNAVAILABLE', 'NOT_APPLIED', true],
      [new JuliusBrainAccessError('session_unknown', 'restarted'), 'SESSION_LOST', 'NOT_APPLIED', true],
      [new JuliusBrainAccessError('session_expired', 'expired'), 'SESSION_EXPIRED', 'NOT_APPLIED', true],
      [new JuliusBrainAccessError('state_mode_not_authorized', 'no grant'), 'ACCESS_REFUSED', 'NOT_APPLIED', false],
      [new Error('something nobody anticipated'), 'UNKNOWN', 'UNKNOWN', false],
      ['a string thrown', 'UNKNOWN', 'UNKNOWN', false],
    ];
    for (const [error, failureClass, outcome, retryable] of cases) {
      expect(classifyJuliusBrainFailure(error), String((error as Error).message ?? error)).toMatchObject({ failureClass, outcome, retryable });
    }
    // Only the code is kept, never the message: a message can carry a connection string.
    expect(classifyJuliusBrainFailure(new Error(['connect to postgresql://svc:', 'hunter2', '@db failed'].join('')))).toEqual({ failureClass: 'UNKNOWN', outcome: 'UNKNOWN', retryable: false, code: null });
  });

  it('decides by state mode and phase: FRESH proceeds unpreserved, a run that requires prior state is refused, writes continue at risk, and nothing ever falls back', () => {
    const phases: JuliusBrainPhase[] = ['OPEN', 'READ_CONTEXT', 'MIRROR', 'SEAL'];
    for (const failureClass of JULIUS_BRAIN_FAILURE_CLASSES) {
      for (const outcome of ['NOT_APPLIED', 'UNKNOWN'] as const) {
        for (const retryable of [true, false]) {
          const failure = { failureClass, outcome, retryable, code: null };
          for (const mode of JULIUS_BRAIN_STATE_MODES) {
            for (const phase of phases) {
              const decision = decideJuliusBrainFailure({ mode, phase, failure });
              expect(decision.memoryFallback).toBe('NONE');
              const read = phase === 'OPEN' || phase === 'READ_CONTEXT';
              if (read && mode === 'FRESH') expect(decision.then).toBe(phase === 'OPEN' ? 'PROCEED_WITHOUT_BRAIN' : 'CONTINUE_WITHOUT_BRAIN');
              if (read && mode !== 'FRESH') expect(decision.then).toBe(phase === 'OPEN' ? 'REFUSE_RUN' : 'REFUSE_DISPATCH');
              if (!read) expect(decision.then).toBe('CONTINUE_WITHOUT_BRAIN');
              expect(decision.preservation).toBe(phase === 'MIRROR' ? 'AT_RISK' : 'NOT_PRESERVED');
              if (!retryable) expect(decision.retry).toBe('NONE');
              else if (failureClass === 'SESSION_EXPIRED' || failureClass === 'SESSION_LOST') expect(decision.retry).toBe('RENEW_SESSION');
              else expect(decision.retry).toBe(outcome === 'UNKNOWN' ? 'RECONCILE_THEN_RETRY' : 'RETRY');
            }
          }
        }
      }
    }
    // A TLS failure is never retried — least of all without TLS — and an operator is told.
    const tls = decideJuliusBrainFailure({ mode: 'FRESH', phase: 'OPEN', failure: classifyJuliusBrainFailure(coded('SELF_SIGNED_CERT_IN_CHAIN')) });
    expect(tls).toMatchObject({ retry: 'NONE', then: 'PROCEED_WITHOUT_BRAIN', alert: 'CONFIGURATION', preservation: 'NOT_PRESERVED' });
    expect(decideJuliusBrainFailure({ mode: 'LEARNING', phase: 'OPEN', failure: classifyJuliusBrainFailure(new JuliusBrainAccessError('token_claim_refused', 'ref')) })).toMatchObject({ retry: 'NONE', then: 'REFUSE_RUN', alert: 'SECURITY' });
  });

  describe('the session client', () => {
    const fresh: JuliusBrainStateModePolicy = { mode: 'FRESH', missionId: MISSION, runId: RUN };
    function world(state: JuliusBrainAccessStatePort = createJuliusBrainAccessMemoryState()) {
      let now = START * 1000;
      const clock = { now: () => new Date(now).toISOString() };
      const serviceOver = (over: JuliusBrainAccessStatePort) => createJuliusBrainAccessService({ brainId: 'brain:prj-julius-live-4', environment: 'production', binding: { databaseEnvironment: 'production' }, policy: ISSUER.policy, jwks: () => ISSUER.jwks, grants: () => [], clock, state: over });
      let service = serviceOver(state);
      const access: JuliusBrainAccessPort & { down: boolean } = {
        down: false,
        issueSession: (input) => { if (access.down) throw new JuliusBrainServiceUnavailableError(503); return service.issueSession(input); },
        authorize: (input) => { if (access.down) throw new JuliusBrainServiceUnavailableError(null, 'socket hang up'); return service.authorize(input); },
      };
      let oidcUp = true;
      const identityToken = async () => {
        if (!oidcUp) throw new Error('ACTIONS_ID_TOKEN_REQUEST_URL answered 500');
        const iat = Math.floor(now / 1000);
        return ISSUER.mint({ iat, nbf: iat, exp: iat + 300 });
      };
      const client = createJuliusBrainSessionClient({ access, identityToken, projectId: PROJECT, missionId: MISSION, stateMode: fresh });
      return {
        client, access,
        advance: (ms: number) => { now += ms; },
        restart: (lost = false) => { service = serviceOver(lost ? createJuliusBrainAccessMemoryState() : state); },
        oidc: (up: boolean) => { oidcUp = up; },
      };
    }
    const read = { type: 'READ_CONTEXT' } as const;

    it('a session expiring mid-operation is renewed once, for the same attempt and mode, and the operation resumes', async () => {
      const w = world();
      const steps: string[] = [];
      await w.client.call(read, async (session) => { steps.push(`read ${session.brainRunId}`); });
      // The seal is three calls; the session expires between the first and the second.
      await w.client.call({ type: 'SEAL', runId: RUN }, async () => { steps.push('entities'); });
      w.advance(ISSUER.policy.sessionTtlMs);
      await w.client.call({ type: 'SEAL', runId: RUN }, async (session) => { steps.push(`sealed ${session.brainRunId} ${session.policy.mode}`); });
      expect(steps).toEqual([`read ${RUN}`, 'entities', `sealed ${RUN} FRESH`]);
      expect(w.client.issued()).toBe(2);
    });

    it('a service restart during a session: durable state keeps the session; lost state forces one renewal, never a wider one', async () => {
      const durable = world();
      await durable.client.call(read, async () => undefined);
      durable.restart();
      await durable.client.call(read, async () => undefined);
      expect(durable.client.issued()).toBe(1);

      const lost = world();
      await lost.client.call(read, async () => undefined);
      lost.restart(true);
      await lost.client.call(read, async (session) => { expect(session.policy).toEqual(fresh); });
      expect(lost.client.issued()).toBe(2);
    });

    it('an identity token that cannot be obtained, a service that does not answer, and a refusal are classified, not retried around', async () => {
      const w = world();
      await w.client.call(read, async () => undefined);
      w.advance(ISSUER.policy.sessionTtlMs);
      w.oidc(false);
      const noToken = await w.client.call(read, async () => 'ran').catch((error: unknown) => error);
      expect(classifyJuliusBrainFailure(noToken)).toMatchObject({ failureClass: 'OIDC_UNAVAILABLE', retryable: true });

      w.oidc(true);
      w.access.down = true;
      const noService = await w.client.call(read, async () => 'ran').catch((error: unknown) => error);
      expect(classifyJuliusBrainFailure(noService)).toMatchObject({ failureClass: 'SERVICE_UNAVAILABLE' });

      w.access.down = false;
      let ran = false;
      const refused = await w.client.call({ type: 'READ_CONTEXT', runId: 'workflow:34739303313/1' }, async () => { ran = true; }).catch((error: unknown) => error);
      expect(classifyJuliusBrainFailure(refused)).toEqual({ failureClass: 'ACCESS_REFUSED', outcome: 'NOT_APPLIED', retryable: false, code: 'other_run' });
      expect(ran).toBe(false);

      // An expired session renews only once: a service that keeps refusing is a refusal.
      const stubborn = createJuliusBrainSessionClient({
        access: { issueSession: async () => ({ ok: true, sessionToken: 't', session: {} as never }), authorize: async () => ({ ok: false, reasonCode: 'session_expired', detail: 'always' }) },
        identityToken: async () => 'token', projectId: PROJECT, missionId: MISSION, stateMode: fresh,
      });
      await expect(stubborn.call(read, async () => undefined)).rejects.toThrow('session_expired');
      expect(stubborn.issued()).toBe(2);
    });
  });
});
