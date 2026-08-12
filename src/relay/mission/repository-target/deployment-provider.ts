/**
 * THE DEPLOYMENT PROVIDER PORT.
 *
 * Deploying is the first thing Relay does that leaves the repository, and it is
 * the only step whose success cannot be judged from its own return value. A
 * provider that returns `{ ok: true }` has told Relay it believes it succeeded.
 * The port is shaped so that belief is never enough:
 *
 *   - `deploy` returns what it OBSERVED, including the revision it says it
 *     deployed — and that field is nullable, because a provider that cannot
 *     report one must say so rather than echo the revision it was asked for.
 *   - `verifyLive` is a SEPARATE method, and the reason is that a provider
 *     reporting on its own deploy is the least independent witness available.
 *     `decideShipped` requires both, and treats a provider's word and the
 *     running system's word as two different facts.
 *
 * WHAT A PROVIDER MAY NOT DO. It may not decide that a Mission is shipped —
 * `decideShipped` does, from evidence. It may not decide it is authorized —
 * `advanceShipStage` does, from permissions. It may not widen an environment: a
 * provider handed `staging` deploys to staging or refuses. A provider that
 * could promote its own target would make `deploy_production` decorative.
 *
 * PURE PORT. No Node, no network, no clock. Implementations live outside the
 * domain and are wired by a composition root, which is how the browser can read
 * a deployment record it could never have produced.
 */

import type { DeployEnvironment, LiveProbeResult } from './repository-lifecycle';

/**
 * WHAT A PROVIDER IS, TRUTHFULLY, before it is asked to do anything.
 *
 * `canReportDeployedRevision` is the field that decides whether this provider
 * can ever produce a SHIPPED verdict from the provider side, and it is declared
 * up front so a founder learns it at configuration rather than after a deploy.
 * A provider that declares `false` is still useful — it deploys, and the running
 * system's own revision report can still close the loop — but the record will
 * say which half of the evidence is missing.
 *
 * `simulated` exists because Relay's rule is that simulated data says so. A
 * simulated provider may never produce evidence that renders as real, and
 * production navigation must never load one.
 */
export interface DeploymentProviderDescriptor {
  readonly providerId: string;
  readonly displayName: string;
  /** Environments this provider is configured for. Never inferred. */
  readonly environments: readonly DeployEnvironment[];
  readonly canReportDeployedRevision: boolean;
  /** Whether this provider can observe the running system at all. */
  readonly canVerifyLive: boolean;
  readonly simulated: boolean;
  /** Env var name the credential is read from, server-side. Never the value. */
  readonly credentialEnvVarName: string | null;
}

export interface DeployRequest {
  readonly repositoryKey: string;
  readonly environment: DeployEnvironment;
  /** The revision Relay committed and wants deployed. */
  readonly revision: string;
  readonly branch: string;
  /** Absolute path to the built artifact, when the provider takes one. */
  readonly artifactPath: string | null;
  readonly requestedAt: string;
}

/**
 * WHAT THE PROVIDER OBSERVED ABOUT ITS OWN DEPLOY.
 *
 * `deployedRevision` is nullable and is NEVER defaulted from
 * `DeployRequest.revision`. Echoing the request back would make every deploy
 * appear to ship the right revision, which is precisely the check
 * `decideShipped` exists to perform — the most common real failure is a deploy
 * that succeeded against a stale build.
 */
export interface DeployObservation {
  readonly ok: boolean;
  readonly providerId: string;
  readonly environment: DeployEnvironment;
  readonly deployedRevision: string | null;
  /** Provider's own id for the deployment, for the audit trail. */
  readonly deploymentRef: string | null;
  /** Where the deployed system can be reached, when the provider knows. */
  readonly url: string | null;
  readonly observedAt: string;
  /** Safe. Never a credential, never provider output verbatim. */
  readonly detail: string | null;
}

export interface DeploymentProvider {
  readonly descriptor: DeploymentProviderDescriptor;
  deploy(request: DeployRequest): Promise<DeployObservation>;
  /**
   * Observe the RUNNING system. Separate from `deploy` on purpose: a provider
   * reporting on its own deploy is the least independent witness available.
   */
  verifyLive(input: {
    readonly url: string;
    readonly expectedRevision: string;
    readonly observedAt: string;
  }): Promise<LiveProbeResult>;
}

/**
 * MAY THIS PROVIDER BE ASKED FOR THIS ENVIRONMENT?
 *
 * A provider configured only for staging that is handed a production deploy is
 * a misconfiguration, and the failure mode without this check is the worst
 * available: a provider that quietly deploys to the only environment it knows.
 * That is a production deploy performed under a staging authorization, or a
 * staging deploy recorded as production. Both are refused by name, before the
 * provider is called.
 */
export function providerSupportsEnvironment(input: {
  readonly descriptor: DeploymentProviderDescriptor;
  readonly environment: DeployEnvironment;
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const { descriptor, environment } = input;
  if (!descriptor.environments.includes(environment)) {
    return {
      ok: false,
      reason:
        `Deployment provider "${descriptor.providerId}" is configured for `
        + `${descriptor.environments.join(', ') || 'no environments'} and was asked for ${environment}.`,
    };
  }
  if (environment === 'production' && descriptor.simulated) {
    /**
     * A SIMULATED PROVIDER MAY NEVER TOUCH PRODUCTION. Not because it would do
     * damage — it would do nothing — but because it would produce a production
     * deployment record for a deploy that never happened, and that record is
     * what a founder reads to decide the software is live.
     */
    return { ok: false, reason: 'A simulated deployment provider may not be used for production.' };
  }
  return { ok: true };
}
