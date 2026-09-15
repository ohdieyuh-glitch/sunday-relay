import type { JuliusBrainAccessResult, JuliusBrainCallFacts, JuliusBrainRunSession, JuliusBrainServiceCall } from './julius-brain-access';
import { JuliusBrainAccessError, JuliusBrainOidcUnavailableError } from './julius-brain-failure-model';
import type { JuliusBrainStateModePolicy } from './julius-brain-state-modes';

/**
 * THE RUN'S SIDE OF A BRAIN SESSION — LOCAL, NOT DEPLOYED.
 *
 * A run holds one session for its attempt. Each call is authorised by the
 * service when it is admitted; an admitted call completes (or times out) under
 * the database's own limits, and the next call needs a live session. When the
 * service answers that the session expired, or that it no longer knows it (a
 * service without durable sessions restarted), the client renews ONCE with a
 * new identity token and asks again. The renewed session is the same attempt,
 * mission and state mode — the service's registration decides that, not the
 * client — so renewal can never widen anything. Every other refusal is final.
 *
 *   identity token unobtainable   JuliusBrainOidcUnavailableError
 *   service does not answer       whatever the transport throws (classified by
 *                                 `classifyJuliusBrainFailure`)
 *   refused                       JuliusBrainAccessError with the reason
 */

export interface JuliusBrainAccessPort {
  issueSession(input: { readonly token: string; readonly projectId: string; readonly missionId: string; readonly stateMode: JuliusBrainStateModePolicy }):
    Promise<JuliusBrainAccessResult<{ readonly sessionToken: string; readonly session: JuliusBrainRunSession }>>;
  authorize(input: { readonly sessionToken: string; readonly call: JuliusBrainServiceCall; readonly facts?: JuliusBrainCallFacts }):
    Promise<JuliusBrainAccessResult<{ readonly session: JuliusBrainRunSession }>>;
}

export interface JuliusBrainSessionClient {
  /** Authorise the call, renewing an expired or forgotten session once, then run the effect under the authorised session. */
  call<T>(call: JuliusBrainServiceCall, effect: (session: JuliusBrainRunSession) => Promise<T>, facts?: JuliusBrainCallFacts): Promise<T>;
  /** How many sessions this client has been issued. */
  readonly issued: () => number;
}

export function createJuliusBrainSessionClient(deps: {
  readonly access: JuliusBrainAccessPort;
  /** A fresh identity token for this attempt (on GitHub, a request to the runner's OIDC token endpoint). */
  readonly identityToken: () => Promise<string>;
  readonly projectId: string;
  readonly missionId: string;
  readonly stateMode: JuliusBrainStateModePolicy;
}): JuliusBrainSessionClient {
  let current: { readonly sessionToken: string } | null = null;
  let issued = 0;

  const issue = async () => {
    let token: string;
    try {
      token = await deps.identityToken();
    } catch (error) {
      throw error instanceof JuliusBrainOidcUnavailableError ? error : new JuliusBrainOidcUnavailableError(error instanceof Error ? error.message.split('\n')[0]!.slice(0, 200) : 'unknown');
    }
    const result = await deps.access.issueSession({ token, projectId: deps.projectId, missionId: deps.missionId, stateMode: deps.stateMode });
    if (!result.ok) throw new JuliusBrainAccessError(result.reasonCode, result.detail);
    issued += 1;
    current = { sessionToken: result.sessionToken };
    return current;
  };

  return {
    issued: () => issued,
    async call(call, effect, facts) {
      for (let renewed = false; ; renewed = true) {
        const held = current ?? await issue();
        const decision = await deps.access.authorize({ sessionToken: held.sessionToken, call, facts });
        if (decision.ok) return effect(decision.session);
        if (!renewed && (decision.reasonCode === 'session_expired' || decision.reasonCode === 'session_unknown')) { current = null; continue; }
        throw new JuliusBrainAccessError(decision.reasonCode, decision.detail);
      }
    },
  };
}
