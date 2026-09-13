import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalJuliusBrainJson, juliusBrainSha256 } from '../../mission/julius/julius-brain-contracts';
import type { JuliusPythonRequirement, JuliusPythonResolvedEnvironment } from '../../mission/julius/julius-python-contracts';
import { writeJuliusBrainFileAtomically } from '../../persistence/julius-brain-content-store';
import { juliusPythonChildEnvironment, probeJuliusPythonEnvironment } from './python-runner';

/**
 * EXPLICIT, REPRODUCIBLE PYTHON ENVIRONMENTS — NEVER THE MACHINE'S.
 *
 * An environment is a SPEC: a base interpreter and exact `name==version` pins,
 * installable only from a declared wheelhouse. Materialising it creates a
 * virtual environment in a directory named by the spec's hash, installs with
 *
 *   --no-index --find-links <wheelhouse> --only-binary=:all: --no-deps
 *
 * under an environment built from nothing (so no PIP_* variable, index URL,
 * credential or user config is inherited), then PROBES the result and refuses
 * it unless every pin is exactly installed. The base interpreter and any global
 * site-packages are never written to. A lock file records the spec, the probe
 * and the hashes; an execution cites the environment hash, and anyone with the
 * same wheels can rebuild the same environment.
 *
 * `--no-deps` is deliberate: the pin list must be COMPLETE. A transitive
 * dependency nobody declared is a dependency nobody reviewed.
 */

export interface JuliusPythonEnvironmentSpec {
  readonly environmentId: string;
  readonly baseExecutable: string;
  readonly requirements: readonly JuliusPythonRequirement[];
  /** A directory of wheels. Required when there are requirements; nothing is ever fetched. */
  readonly wheelhouse: string | null;
}

export interface JuliusPythonEnvironmentLock {
  readonly format: 'julius-python-environment-lock.v1';
  readonly environmentId: string;
  readonly specHash: string;
  readonly requirements: readonly JuliusPythonRequirement[];
  readonly environmentHash: string;
  readonly executableHash: string | null;
  readonly version: string;
  readonly platform: string;
}

export type JuliusPythonEnvironmentResult =
  | { readonly outcome: 'READY'; readonly created: boolean; readonly directory: string; readonly environment: JuliusPythonResolvedEnvironment; readonly lock: JuliusPythonEnvironmentLock }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: string; readonly detail: string };

const venvPython = (directory: string) => (process.platform === 'win32' ? join(directory, 'Scripts', 'python.exe') : join(directory, 'bin', 'python'));
const normalise = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');

export function juliusPythonEnvironmentSpecHash(spec: JuliusPythonEnvironmentSpec, baseVersion: string): string {
  const requirements = [...spec.requirements].map(({ name, version }) => ({ name: normalise(name), version })).sort((a, b) => a.name.localeCompare(b.name));
  return juliusBrainSha256(canonicalJuliusBrainJson({ environmentId: spec.environmentId, baseVersion, requirements }));
}

function unsatisfied(environment: JuliusPythonResolvedEnvironment, requirements: readonly JuliusPythonRequirement[]): string[] {
  const installed = new Map(environment.distributions.map((dist) => [normalise(dist.name), dist.version]));
  return requirements.filter((requirement) => installed.get(normalise(requirement.name)) !== requirement.version)
    .map((requirement) => `${requirement.name}==${requirement.version} (installed: ${installed.get(normalise(requirement.name)) ?? 'none'})`);
}

export async function materializeJuliusPythonEnvironment(spec: JuliusPythonEnvironmentSpec, options: { readonly root: string }): Promise<JuliusPythonEnvironmentResult> {
  const base = await probeJuliusPythonEnvironment(`${spec.environmentId}:base`, spec.baseExecutable);
  if (base === null) return { outcome: 'REFUSED', reasonCode: 'BASE_INTERPRETER_UNUSABLE', detail: 'The base interpreter did not answer the probe.' };
  if (spec.requirements.length > 0 && (spec.wheelhouse === null || !existsSync(spec.wheelhouse))) {
    return { outcome: 'REFUSED', reasonCode: 'WHEELHOUSE_REQUIRED', detail: 'Pinned requirements install only from a declared wheelhouse; nothing is fetched.' };
  }
  const specHash = juliusPythonEnvironmentSpecHash(spec, base.version);
  const directory = join(options.root, `${spec.environmentId.replace(/[^A-Za-z0-9._-]/g, '_')}-${specHash.slice(7, 23)}`);
  const lockPath = join(directory, 'julius-environment.lock.json');

  if (existsSync(lockPath)) {
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as JuliusPythonEnvironmentLock;
    const environment = await probeJuliusPythonEnvironment(spec.environmentId, venvPython(directory));
    // REUSED ONLY IF IT IS STILL WHAT THE LOCK SAYS. A venv someone edited is rebuilt, not trusted.
    if (environment !== null && lock.specHash === specHash && environment.environmentHash === lock.environmentHash && unsatisfied(environment, spec.requirements).length === 0) {
      return { outcome: 'READY', created: false, directory, environment, lock };
    }
    await rm(directory, { recursive: true, force: true });
  }

  const staging = `${directory}.staging-${process.pid}-${Date.now()}`;
  await mkdir(options.root, { recursive: true });
  const env = { ...juliusPythonChildEnvironment({ sandbox: tmpdir(), executable: spec.baseExecutable, executionId: 'environment', secrets: [], hostEnv: process.env }), PIP_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null', PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_NO_INPUT: '1' };
  const created = spawnSync(spec.baseExecutable, ['-s', '-m', 'venv', ...(spec.requirements.length === 0 ? ['--without-pip'] : []), staging], { encoding: 'utf8', timeout: 300_000, windowsHide: true, env });
  if (created.status !== 0) {
    await rm(staging, { recursive: true, force: true });
    return { outcome: 'REFUSED', reasonCode: 'VENV_CREATION_FAILED', detail: `${created.stderr ?? ''}`.trim().slice(-400) };
  }
  if (spec.requirements.length > 0) {
    const pins = spec.requirements.map(({ name, version }) => `${name}==${version}`);
    const install = spawnSync(venvPython(staging), ['-s', '-m', 'pip', 'install', '--no-index', '--find-links', spec.wheelhouse!, '--only-binary=:all:', '--no-deps', '--require-virtualenv', ...pins], {
      encoding: 'utf8', timeout: 600_000, windowsHide: true, env,
    });
    if (install.status !== 0) {
      await rm(staging, { recursive: true, force: true });
      return { outcome: 'REFUSED', reasonCode: 'DEPENDENCY_INSTALL_FAILED', detail: `${install.stdout ?? ''}\n${install.stderr ?? ''}`.trim().slice(-600) };
    }
  }
  // Moved into place before probing, so the interpreter is probed at its final path.
  await rm(directory, { recursive: true, force: true });
  await rename(staging, directory);
  const environment = await probeJuliusPythonEnvironment(spec.environmentId, venvPython(directory));
  if (environment === null) return { outcome: 'REFUSED', reasonCode: 'ENVIRONMENT_UNUSABLE', detail: 'The new environment did not answer the probe.' };
  const missing = unsatisfied(environment, spec.requirements);
  if (missing.length > 0) return { outcome: 'REFUSED', reasonCode: 'DEPENDENCY_UNSATISFIED', detail: missing.join(', ') };
  const lock: JuliusPythonEnvironmentLock = {
    format: 'julius-python-environment-lock.v1', environmentId: spec.environmentId, specHash, requirements: spec.requirements,
    environmentHash: environment.environmentHash, executableHash: environment.executableHash, version: environment.version, platform: environment.platform,
  };
  await writeJuliusBrainFileAtomically(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  return { outcome: 'READY', created: true, directory, environment, lock };
}

/** A registry over declared specs: an environment is materialised (or re-verified) on first use. */
export class MaterializedJuliusPythonEnvironmentRegistry {
  private readonly pending = new Map<string, Promise<JuliusPythonResolvedEnvironment | null>>();
  constructor(private readonly specs: ReadonlyMap<string, JuliusPythonEnvironmentSpec>, private readonly root: string) {}
  resolve(environmentId: string): Promise<JuliusPythonResolvedEnvironment | null> {
    const spec = this.specs.get(environmentId);
    if (spec === undefined) return Promise.resolve(null);
    let result = this.pending.get(environmentId);
    if (result === undefined) {
      result = materializeJuliusPythonEnvironment(spec, { root: this.root }).then((outcome) => (outcome.outcome === 'READY' ? outcome.environment : null));
      this.pending.set(environmentId, result);
    }
    return result;
  }
}

/** sha256 of a wheel file, for a wheelhouse manifest. */
export async function juliusWheelHash(path: string): Promise<string> {
  return `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`;
}
