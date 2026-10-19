import { mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  authorizeWonderWebRun,
  beginWonderWebBuild,
  beginWonderWebPreparation,
  completeWonderWebBuild,
  failWonderWebCreation,
  isSafeCreationPath,
  startWonderWebRun,
  stopWonderWebRun,
  type WonderWebBuildOutcome,
  type WonderWebCapabilityGrant,
  type WonderWebCreationDraft,
  type WonderWebFile,
  type WonderWebLogLine,
} from '../../src/relay/mission/wonder-web';
import { runBoundedCommand } from '../../src/relay/workspace/command-runner';
import {
  serveWonderWebCreation,
  type WonderWebRunningServer,
} from './creation-sandbox-server';

/**
 * WONDER WEB — the Node-side runtime.
 *
 * This is the composition root for the creation pipeline: it owns the disk, the
 * build process and the server, and it drives the PURE lifecycle in
 * `src/relay/mission/wonder-web` rather than re-deciding anything. Every state
 * change goes through a domain function, so the honesty rules are enforced in
 * one place and this file cannot invent a READY.
 *
 * THE BOUNDED RUNNER IS REUSED, NOT REBUILT. `runBoundedCommand` already
 * executes an approved command with `shell: false`, hard-bounds runtime and both
 * output streams, redacts secrets out of what it captures, and — the property
 * that matters most here — reports `exitCode: null` when a process's exit was
 * never observed. That maps exactly onto the lifecycle's rule that an
 * unobserved exit is unknown and unknown is not success, so the two layers
 * agree without either one being adjusted to fit.
 */

/** The directory name creations are materialized under. Never inside a repo. */
export const WONDER_WEB_ROOT_DIRNAME = '.wonder-web';

/** A build may not run forever, and a creation may not print forever. */
export const WONDER_WEB_BUILD_TIMEOUT_MS = 180_000;
export const WONDER_WEB_OUTPUT_LIMIT_BYTES = 256 * 1024;

export interface WonderWebRuntimePaths {
  /** Where sources are written. */
  readonly sourceRoot: string;
  /** Where build artifacts are read from and served. */
  readonly artifactRoot: string;
}

/**
 * Resolve the two roots for a creation, refusing an id that could escape.
 *
 * The creation id becomes a path segment, so it is validated as strictly as any
 * file path — an id containing a separator would otherwise place a creation
 * anywhere the process can write.
 */
export function resolveWonderWebPaths(
  baseDir: string,
  creationId: string,
): WonderWebRuntimePaths | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(creationId)) return null;
  const base = resolve(baseDir, WONDER_WEB_ROOT_DIRNAME, creationId);
  return { sourceRoot: join(base, 'src'), artifactRoot: join(base, 'out') };
}

function logLines(
  text: string,
  stream: 'build' | 'runtime',
  startSequence: number,
): readonly WonderWebLogLine[] {
  if (text === '') return [];
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line, index) => ({
      sequence: startSequence + index,
      stream,
      // The runner already sanitized and bounded this; the cap here is per line
      // so one enormous line cannot dominate the panel.
      text: line.slice(0, 2_000),
      redactionsApplied: 0,
    }));
}

/**
 * Write a creation's sources to disk.
 *
 * Each path is re-validated here even though the domain validated it at
 * creation time. The domain protects the RECORD; this protects the DISK, and
 * the two are separated by a store, a process boundary and possibly a restart.
 */
export async function materializeWonderWebSources(
  paths: WonderWebRuntimePaths,
  files: readonly WonderWebFile[],
  contentOf: (file: WonderWebFile) => string | Uint8Array,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  await mkdir(paths.sourceRoot, { recursive: true });
  for (const file of files) {
    if (!isSafeCreationPath(file.path)) {
      return { ok: false, reason: `source path escapes the creation root: ${file.path}` };
    }
    const target = join(paths.sourceRoot, file.path);
    const contained = resolve(target).startsWith(resolve(paths.sourceRoot) + sep);
    if (!contained) {
      return { ok: false, reason: `source path resolves outside the creation root: ${file.path}` };
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contentOf(file));
  }
  return { ok: true };
}

export interface WonderWebBuildPlan {
  /** Null for a bundle that needs no build step. */
  readonly executable: string | null;
  readonly args: readonly string[];
  /** Relative to the artifact root, once the build has run. */
  readonly entrypoint: string;
  /** Files the build is expected to have produced, for the record. */
  readonly expectedArtifacts: readonly WonderWebFile[];
}

/**
 * Run the build and produce the outcome the lifecycle will judge.
 *
 * A plan with no executable is NOT a skipped build — it is a build whose step is
 * "the sources are already the artifacts", and it still has to prove the
 * entrypoint exists on disk before it may report exit 0. A static bundle whose
 * entrypoint is missing therefore FAILS here rather than becoming a READY
 * creation that serves a 404.
 */
export async function runWonderWebBuild(
  paths: WonderWebRuntimePaths,
  plan: WonderWebBuildPlan,
  now: () => string,
): Promise<WonderWebBuildOutcome> {
  const startedAtIso = now();
  await mkdir(paths.artifactRoot, { recursive: true });

  let logs: readonly WonderWebLogLine[] = [];
  let exitCode: number | null = 0;

  if (plan.executable !== null) {
    const outcome = await runBoundedCommand(
      {
        executable: plan.executable,
        args: [...plan.args],
        cwd: paths.sourceRoot,
        // A build receives no ambient environment. Inheriting `process.env`
        // would hand generated code every credential this process holds.
        env: {},
        timeoutMs: WONDER_WEB_BUILD_TIMEOUT_MS,
        outputLimitBytes: WONDER_WEB_OUTPUT_LIMIT_BYTES,
      },
      now,
    );
    logs = [
      ...logLines(outcome.stdout, 'build', 1),
      ...logLines(outcome.stderr, 'build', 10_000),
    ];
    // `null` travels through unchanged: a timeout, a cancel or an unconfirmed
    // termination must reach the lifecycle as "never observed", not as a number.
    exitCode = outcome.exitCode;
  }

  const entrypointPath = join(paths.artifactRoot, plan.entrypoint);
  const entrypointExists = await stat(entrypointPath)
    .then((s) => s.isFile())
    .catch(() => false);

  if (exitCode === 0 && !entrypointExists) {
    /**
     * A SUCCESSFUL BUILD THAT PRODUCED NOTHING IS NOT A FAILED BUILD.
     *
     * An earlier draft reported this as `exitCode: 1`, and the record then read
     * "The build exited 1" — which is false twice over: the build did not exit
     * 1, and the actual problem (nothing to open) was buried in a log line
     * nobody would read. The exit code travels unchanged and the entrypoint is
     * reported as absent, which is what actually happened; the lifecycle's own
     * `entrypoint === null` branch then states the real reason.
     */
    return {
      startedAtIso,
      finishedAtIso: now(),
      exitCode: 0,
      artifacts: [],
      entrypoint: null,
      logs: [
        ...logs,
        {
          sequence: 20_000,
          stream: 'build',
          text: `The build reported success but ${plan.entrypoint} is not on disk.`,
          redactionsApplied: 0,
        },
      ],
    };
  }

  return {
    startedAtIso,
    finishedAtIso: now(),
    exitCode,
    artifacts: exitCode === 0 ? plan.expectedArtifacts : [],
    entrypoint: exitCode === 0 ? plan.entrypoint : null,
    logs,
  };
}

/**
 * Drive a creation from wherever it is to READY, or to a FAILED that says why.
 *
 * Returns the draft at every step rather than mutating, so a caller that fails
 * mid-way still holds a record it can persist — a creation whose build died is
 * not a creation that disappears.
 */
export async function buildWonderWebCreation(
  creation: WonderWebCreationDraft,
  paths: WonderWebRuntimePaths,
  plan: WonderWebBuildPlan,
  now: () => string,
): Promise<WonderWebCreationDraft> {
  const prepared = beginWonderWebPreparation(creation, now());
  if (!prepared.ok) return creation;

  const started = beginWonderWebBuild(prepared.value, now());
  if (!started.ok) {
    const failed = failWonderWebCreation(
      prepared.value,
      { phase: 'prepare', summary: started.error.message, detail: null, occurredAtIso: now() },
      now(),
    );
    return failed.ok ? failed.value : prepared.value;
  }

  let outcome: WonderWebBuildOutcome;
  try {
    outcome = await runWonderWebBuild(paths, plan, now);
  } catch (error) {
    const failed = failWonderWebCreation(
      started.value,
      {
        phase: 'build',
        summary: 'The build could not be started.',
        detail: error instanceof Error ? error.message.slice(0, 200) : null,
        occurredAtIso: now(),
      },
      now(),
    );
    return failed.ok ? failed.value : started.value;
  }

  const completed = completeWonderWebBuild(started.value, outcome, now());
  if (completed.ok) return completed.value;

  // The lifecycle refused the outcome itself — an entrypoint naming a file the
  // build did not produce, for instance. That is a failure of the build, and it
  // is recorded as one rather than dropped.
  const failed = failWonderWebCreation(
    started.value,
    { phase: 'build', summary: completed.error.message, detail: null, occurredAtIso: now() },
    now(),
  );
  return failed.ok ? failed.value : started.value;
}

/* ------------------------------------------------------------ running it */

export interface WonderWebRunHandle {
  readonly creation: WonderWebCreationDraft;
  readonly server: WonderWebRunningServer;
}

/**
 * Open a READY creation for use.
 *
 * Authorization comes FIRST and comes from the domain: ownership, beta
 * eligibility of the runtime, and the refusal of any capability the mechanism
 * cannot mediate. Only then is a port opened. A caller cannot reach the server
 * by skipping the check, because the check is what returns the paths.
 */
export async function openWonderWebCreation(
  creation: WonderWebCreationDraft,
  paths: WonderWebRuntimePaths,
  requesterUserId: string,
  grant: WonderWebCapabilityGrant | null,
  now: () => string,
): Promise<{ readonly ok: true; readonly handle: WonderWebRunHandle } | { readonly ok: false; readonly reason: string }> {
  const authorized = authorizeWonderWebRun(creation, requesterUserId, grant);
  if (!authorized.ok) return { ok: false, reason: authorized.error.message };

  if (creation.entrypoint === null) {
    return { ok: false, reason: 'This creation has no entrypoint, so there is nothing to open.' };
  }

  const running = startWonderWebRun(creation, now());
  if (!running.ok) return { ok: false, reason: running.error.message };

  const server = await serveWonderWebCreation({
    creationId: creation.creationId,
    rootPath: paths.artifactRoot,
    entrypoint: creation.entrypoint,
  });

  return { ok: true, handle: { creation: running.value, server } };
}

/** Close the port and record the stop. A stop is announced only once confirmed. */
export async function closeWonderWebCreation(
  handle: WonderWebRunHandle,
  now: () => string,
): Promise<WonderWebCreationDraft> {
  await handle.server.close();
  const stopped = stopWonderWebRun(handle.creation, now());
  return stopped.ok ? stopped.value : handle.creation;
}

/** Remove a creation's materialized files. The RECORD is never removed here. */
export async function discardWonderWebFiles(paths: WonderWebRuntimePaths): Promise<void> {
  await rm(dirname(paths.sourceRoot), { recursive: true, force: true });
}
