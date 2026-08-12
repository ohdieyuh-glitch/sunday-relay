import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import type {
  DeployObservation,
  DeployRequest,
  DeploymentProvider,
  DeploymentProviderDescriptor,
  LiveProbeResult,
} from '../src/relay/mission/repository-target';

/**
 * THE FIRST REAL DEPLOYMENT PROVIDER — and the reason it is a directory.
 *
 * `DeploymentProvider` has been a port with exactly one implementation: a fake
 * inside `repository-target-observer.test.ts`. So `DEPLOY → LIVE VERIFY →
 * SHIPPED` was a lifecycle Relay could REASON about and had never PERFORMED.
 * A stage that has only ever been exercised by a fake is a stage whose failure
 * modes are unknown, and the interesting ones here are not exotic: a deploy
 * that reports success against a stale build, and a probe that confirms a
 * revision it read out of its own request.
 *
 * A local directory is the smallest thing that makes both of those REAL rather
 * than simulated. The artifact is genuinely copied, the running system is
 * genuinely read back over HTTP, and the revision that comes back is the one
 * the filesystem actually holds — not one this module remembered. Every part
 * of that is a real observation, so `simulated` is FALSE, and it is false
 * honestly: nothing here pretends the deployment is somewhere it is not.
 *
 * STAGING ONLY, AND THE TYPE SAYS SO. `environments` is `['staging']`, so
 * `providerSupportsEnvironment` refuses a production request by name before
 * this module is called. That is deliberate and is not a placeholder for a
 * future flag: "never infer production authorization from build this" is a
 * founder rule, and a provider that serves a directory on this machine has no
 * business being the thing that ships to customers. A production provider is a
 * separate implementation, separately authorized, separately reviewed.
 *
 * NO CREDENTIAL. `credentialEnvVarName` is null because there is nothing to
 * authenticate to. That is the honest value, and it keeps the credential
 * boundary's shape: a provider that needs one NAMES it and never carries it.
 */

/** Where the revision marker is written, and read back from. */
export const REVISION_MARKER = 'relay-revision.txt';

export interface LocalDirectoryDeploymentConfig {
  /**
   * The directory the artifact is deployed INTO. Must already exist — this
   * module creates deployments beneath it but never creates the root itself,
   * because a typo that silently creates `/tmp/tpyo` and reports success is
   * exactly the "deployed somewhere nobody is looking" failure.
   */
  readonly deployRoot: string;
  /** Base URL the deployed directory is served at, when something serves it. */
  readonly baseUrl: string | null;
  readonly now?: () => string;
  readonly fetchImpl?: FetchLike;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const DESCRIPTOR: DeploymentProviderDescriptor = {
  providerId: 'local-directory',
  displayName: 'Local directory (staging)',
  environments: ['staging'],
  canReportDeployedRevision: true,
  canVerifyLive: true,
  // Every observation this provider makes is a real read of a real filesystem
  // or a real HTTP response. Nothing is invented, so nothing is simulated.
  simulated: false,
  credentialEnvVarName: null,
};

/**
 * CONTAINMENT, resolved through symlinks.
 *
 * `resolve` alone is not enough: `deployRoot/link` where `link` points outside
 * passes a string-prefix test and writes anywhere. The same lesson the
 * repository observer learned when a `git mv` walked a protected file out from
 * under a path check.
 */
function containedPath(root: string, child: string): string | null {
  const realRoot = realpathSync(root);
  const target = resolve(realRoot, child);
  // The target itself may not exist yet; its nearest existing ancestor must be
  // inside the root once symlinks are resolved.
  let probe = target;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return null;
    probe = parent;
  }
  const realProbe = realpathSync(probe);
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + sep)) return null;
  return target;
}

export function createLocalDirectoryDeploymentProvider(
  config: LocalDirectoryDeploymentConfig,
): DeploymentProvider {
  const now = config.now ?? (() => new Date().toISOString());
  const doFetch = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  const fail = (request: DeployRequest, detail: string): DeployObservation => ({
    ok: false,
    providerId: DESCRIPTOR.providerId,
    environment: request.environment,
    deployedRevision: null,
    deploymentRef: null,
    url: null,
    observedAt: now(),
    detail,
  });

  return {
    descriptor: DESCRIPTOR,

    async deploy(request: DeployRequest): Promise<DeployObservation> {
      /**
       * The environment is checked HERE TOO, even though
       * `providerSupportsEnvironment` already refuses. A provider that is only
       * safe because its caller remembered to ask is not safe — this is the
       * module that would do the damage, so this is where the refusal has to
       * hold.
       */
      if (request.environment !== 'staging') {
        return fail(request, 'The local-directory provider deploys to staging only.');
      }
      if (!/^[0-9a-f]{7,40}$/.test(request.revision)) {
        return fail(request, 'The revision to deploy is not a git revision.');
      }
      if (request.artifactPath === null) {
        return fail(request, 'This provider deploys a built artifact and none was given.');
      }
      if (!existsSync(request.artifactPath) || !statSync(request.artifactPath).isDirectory()) {
        return fail(request, 'The artifact path is not a directory that exists.');
      }
      if (!existsSync(config.deployRoot)) {
        // Never created here. See the config comment.
        return fail(request, 'The deploy root does not exist.');
      }

      const destination = containedPath(config.deployRoot, request.revision);
      if (destination === null) {
        return fail(request, 'The resolved deploy destination is outside the deploy root.');
      }

      try {
        // A previous deploy of the same revision is replaced rather than merged,
        // so a stale file from an older build cannot survive underneath.
        rmSync(destination, { recursive: true, force: true });
        mkdirSync(destination, { recursive: true });
        cpSync(request.artifactPath, destination, { recursive: true, dereference: true });
      } catch {
        return fail(request, 'The artifact could not be copied into the deploy root.');
      }

      /**
       * THE MARKER IS WRITTEN AFTER THE ARTIFACT, and the order is load-bearing.
       * An artifact that carries its own `relay-revision.txt` — a previous
       * build's, or one a repository commits — must not become what this deploy
       * reports. Relay's marker is written last so Relay's answer wins.
       *
       * Reported separately from the copy because they fail for different
       * reasons and a Mission needs to be able to say which.
       */
      try {
        writeFileSync(join(destination, REVISION_MARKER), `${request.revision}\n`, 'utf8');
      } catch {
        return fail(request, 'The artifact was copied and the revision marker could not be written.');
      }

      /**
       * THE REVISION IS READ BACK OFF DISK, NOT ECHOED.
       *
       * `DeployObservation.deployedRevision` is documented as never defaulted
       * from the request, and the only way to honour that is to go and look.
       * If the write silently did not land, this reports null and
       * `decideShipped` refuses — which is the entire point of the field.
       */
      let observed: string | null = null;
      try {
        const marker = join(destination, REVISION_MARKER);
        observed = readFileSync(marker, 'utf8').trim() || null;
      } catch {
        observed = null;
      }

      return {
        ok: observed !== null,
        providerId: DESCRIPTOR.providerId,
        environment: 'staging',
        deployedRevision: observed,
        deploymentRef: `local-directory:${request.revision}`,
        url: config.baseUrl === null ? null : `${config.baseUrl.replace(/\/+$/, '')}/${request.revision}`,
        observedAt: now(),
        detail: observed === null
          ? 'The artifact was copied and the revision marker could not be read back.'
          : null,
      };
    },

    /**
     * OBSERVE THE RUNNING SYSTEM — over HTTP, against the served URL.
     *
     * Deliberately NOT a filesystem read. `deploy` already read the disk; a
     * live probe that reads the same disk again proves the copy happened
     * twice, not that anything is serving it. The whole reason `verifyLive` is
     * a separate method is that a provider reporting on its own deploy is the
     * least independent witness available, and reusing its evidence would
     * throw that away.
     */
    async verifyLive(input): Promise<LiveProbeResult> {
      const method = `GET ${REVISION_MARKER}`;
      let response: { ok: boolean; status: number; text: () => Promise<string> };
      try {
        response = await doFetch(`${input.url.replace(/\/+$/, '')}/${REVISION_MARKER}`, { method: 'GET' });
      } catch {
        return {
          reachable: false,
          healthy: false,
          reportedRevision: null,
          method,
          observedAt: input.observedAt,
          detail: 'The deployed system could not be reached.',
        };
      }
      if (!response.ok) {
        return {
          // It ANSWERED, so it is reachable. It answered wrongly, so it is not
          // healthy. Collapsing those two into one boolean is how a 500 gets
          // recorded as "not deployed yet".
          reachable: true,
          healthy: false,
          reportedRevision: null,
          method,
          observedAt: input.observedAt,
          detail: `The deployed system answered HTTP ${String(response.status)}.`,
        };
      }
      const body = (await response.text()).trim();
      const reported = /^[0-9a-f]{7,40}$/.test(body) ? body : null;
      return {
        reachable: true,
        healthy: reported !== null && reported === input.expectedRevision,
        // Reported as READ. The caller compares; this does not pre-agree.
        reportedRevision: reported,
        method,
        observedAt: input.observedAt,
        detail: reported === null
          ? 'The deployed system did not report a revision.'
          : reported === input.expectedRevision
            ? null
            : `The deployed system is serving ${reported}, not ${input.expectedRevision}.`,
      };
    },
  };
}

/**
 * Build the artifact for a revision, in the worktree, with the repository's own
 * command. Exposed separately because BUILDING and DEPLOYING fail differently
 * and a Mission needs to be able to say which one it was.
 */
export function buildArtifact(input: {
  readonly worktreePath: string;
  readonly command: readonly string[];
  readonly outputDir: string;
  readonly timeoutMs?: number;
}): { readonly ok: true; readonly artifactPath: string } | { readonly ok: false; readonly reason: string } {
  const [binary, ...args] = input.command;
  if (binary === undefined) return { ok: false, reason: 'No build command was configured.' };
  try {
    execFileSync(binary, args, {
      cwd: input.worktreePath,
      timeout: input.timeoutMs ?? 300_000,
      stdio: 'pipe',
      // No inherited environment beyond PATH: a build must not read whatever
      // credentials happen to be exported into the bridge's process.
      env: { PATH: process.env.PATH ?? '', HOME: input.worktreePath },
    });
  } catch {
    return { ok: false, reason: 'The build command failed.' };
  }
  const artifactPath = resolve(input.worktreePath, input.outputDir);
  if (!existsSync(artifactPath) || !statSync(artifactPath).isDirectory()) {
    return { ok: false, reason: 'The build command succeeded and produced no output directory.' };
  }
  return { ok: true, artifactPath };
}
