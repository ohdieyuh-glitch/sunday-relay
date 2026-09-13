import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

import { canonicalJuliusBrainJson, juliusBrainSha256 } from '../../mission/julius/julius-brain-contracts';
import { containsJuliusSecret, redactJuliusSecrets } from '../../mission/julius/julius-brain-secrets';
import {
  JULIUS_PYTHON_MAX_PROPOSAL_BYTES,
  JULIUS_PYTHON_MAX_RESULT_BYTES,
  type JuliusPythonCollectedArtifact,
  type JuliusPythonResolvedEnvironment,
  type JuliusPythonRunInput,
  type JuliusPythonRunOutcome,
  type JuliusPythonRunnerPort,
  type JuliusPythonStream,
  type JuliusPythonTermination,
} from '../../mission/julius/julius-python-contracts';
import type { JuliusBrainContentStore } from '../../persistence/julius-brain-content-store';

/**
 * THE HOST SIDE OF A GOVERNED PYTHON EXECUTION.
 *
 * One fresh directory per execution:
 *
 *   <sandbox>/work      the script's cwd                       writable
 *   <sandbox>/out       artifacts handed back to Julius        writable
 *   <sandbox>/tmp       TEMP/TMP/TMPDIR/HOME                   writable
 *   <sandbox>/inputs    hash-verified input files              readable
 *   <sandbox>/script    main.py, hash-verified                 readable
 *   <sandbox>/control   control, context, schema, outputs      runner-only writes
 *
 * THE ENVIRONMENT IS BUILT FROM NOTHING. `process.env` is never spread into
 * the child: it receives the handful of variables Python needs to start, the
 * sandbox's own paths, and exactly the secrets the execution was granted by
 * capability. A credential in the host's environment is not in the child's.
 *
 * WHAT THE HOST OBSERVES ITSELF, and never takes from the process: the exit
 * code and signal, wall time, every byte of both streams (hashed as produced,
 * retained up to the limit, redacted before anyone reads them), and every
 * artifact's bytes (hashed and stored content-addressed, or quarantined).
 *
 * TERMINATION IS OF THE WHOLE TREE. POSIX: the child leads its own process
 * group and the group is killed. Windows: `taskkill /T /F`, and inside the
 * process the runner's Job Object forbids a child process from existing at all.
 */

export const JULIUS_PYTHON_INTERPRETER_FLAGS = Object.freeze(['-s', '-P', '-B', '-X', 'utf8']);

export interface NodeJuliusPythonRunnerConfig {
  readonly sandboxRoot: string;
  /** The directory containing the `julius` SDK package. */
  readonly sdkRoot: string;
  readonly content: JuliusBrainContentStore;
  readonly keepSandbox?: boolean;
  /** A runaway stream beyond this multiple of the retained limit ends the execution. */
  readonly runawayOutputFactor?: number;
  /** Observability: the interpreter's process id, once spawned. */
  readonly onSpawn?: (input: { readonly executionId: string; readonly pid: number }) => void;
}

/** The SDK shipped in this repository, found the way migrations are found. */
export function resolveJuliusPythonSdkRoot(): string | null {
  const candidates = [join(__dirname, '..', '..', '..', '..', 'relay-python'), join(process.cwd(), 'relay-python')];
  return candidates.find((candidate) => existsSync(join(candidate, 'julius', '_runner.py'))) ?? null;
}

class BoundedStream {
  private readonly chunks: Buffer[] = [];
  private retained = 0;
  bytes = 0;
  private readonly hash = createHash('sha256');
  constructor(private readonly limit: number) {}
  push(chunk: Buffer): void {
    this.bytes += chunk.byteLength;
    this.hash.update(chunk);
    if (this.retained < this.limit) {
      const take = chunk.subarray(0, this.limit - this.retained);
      this.chunks.push(take);
      this.retained += take.byteLength;
    }
  }
  finish(literals: readonly string[]): JuliusPythonStream {
    // A multi-byte character cut at the limit decodes as U+FFFD; the byte count
    // and the hash still describe what was actually produced.
    const redacted = redactJuliusSecrets(Buffer.concat(this.chunks).toString('utf8'), literals);
    return { text: redacted.text, bytes: this.bytes, truncated: this.bytes > this.retained, hash: `sha256:${this.hash.digest('hex')}`, redactions: redacted.redactions };
  }
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

async function readBounded(path: string, maxBytes: number): Promise<{ text: string | null; tooLarge: boolean }> {
  try {
    const info = await lstat(path);
    if (!info.isFile()) return { text: null, tooLarge: false };
    if (info.size > maxBytes) return { text: null, tooLarge: true };
    return { text: await readFile(path, 'utf8'), tooLarge: false };
  } catch {
    return { text: null, tooLarge: false };
  }
}

export function juliusPythonChildEnvironment(input: { readonly sandbox: string; readonly executable: string; readonly executionId: string; readonly secrets: readonly { envName: string; value: string }[]; readonly hostEnv?: NodeJS.ProcessEnv }): Record<string, string> {
  const tmp = join(input.sandbox, 'tmp');
  const env: Record<string, string> = {
    PYTHONHASHSEED: '0', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1', PYTHONIOENCODING: 'utf-8',
    TMPDIR: tmp, TEMP: tmp, TMP: tmp, HOME: tmp,
    JULIUS_PYTHON_EXECUTION_ID: input.executionId,
  };
  if (process.platform === 'win32') {
    // Python cannot initialise its hash randomisation without SYSTEMROOT; it is
    // the one host variable the child genuinely needs, and it holds no secret.
    const systemRoot = input.hostEnv?.SYSTEMROOT ?? input.hostEnv?.SystemRoot ?? 'C:\\Windows';
    env.SYSTEMROOT = systemRoot;
    env.USERPROFILE = tmp;
    env.PATH = [dirname(input.executable), join(systemRoot, 'System32')].join(delimiter);
  } else {
    env.PATH = [dirname(input.executable), '/usr/bin', '/bin'].join(delimiter);
    env.LANG = 'C.UTF-8';
    env.LC_ALL = 'C.UTF-8';
  }
  for (const secret of input.secrets) env[secret.envName] = secret.value;
  return env;
}

export class NodeJuliusPythonRunner implements JuliusPythonRunnerPort {
  constructor(private readonly config: NodeJuliusPythonRunnerConfig) {}

  async run(input: JuliusPythonRunInput, signal: AbortSignal): Promise<JuliusPythonRunOutcome> {
    const { request } = input;
    const sandbox = resolve(this.config.sandboxRoot, `${request.executionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)}-${randomUUID()}`);
    const dirs = Object.fromEntries(['work', 'out', 'tmp', 'inputs', 'script', 'control'].map((name) => [name, join(sandbox, name)])) as Record<'work' | 'out' | 'tmp' | 'inputs' | 'script' | 'control', string>;
    const literals = input.secrets.map((secret) => secret.value);
    const started = Date.now();
    const emptyStream = (): JuliusPythonStream => ({ text: '', bytes: 0, truncated: false, hash: juliusBrainSha256(''), redactions: 0 });
    const failed = (termination: JuliusPythonTermination, spawnError: string, scriptHash: string): JuliusPythonRunOutcome => ({
      termination, exitCode: null, durationMs: Date.now() - started, scriptHash, stdout: emptyStream(), stderr: emptyStream(),
      resultText: null, resultTooLarge: false, proposalsText: null, proposalsTooLarge: false, usageText: null, artifacts: [], spawnError,
    });

    try {
      for (const dir of Object.values(dirs)) await mkdir(dir, { recursive: true });

      let scriptBytes: Buffer;
      if (request.script.kind === 'INLINE') scriptBytes = Buffer.from(request.script.source, 'utf8');
      else {
        const stored = await this.config.content.get(request.script.storageRef);
        if (stored === null) return failed('SPAWN_FAILED', 'script_artifact_missing', request.script.contentHash);
        scriptBytes = Buffer.from(stored);
      }
      const scriptHash = `sha256:${createHash('sha256').update(scriptBytes).digest('hex')}`;
      const expectedScriptHash = request.script.kind === 'INLINE' ? juliusBrainSha256(request.script.source) : request.script.contentHash;
      if (scriptHash !== expectedScriptHash) return failed('SPAWN_FAILED', 'script_hash_mismatch', scriptHash);
      const scriptPath = join(dirs.script, 'main.py');
      await writeFile(scriptPath, scriptBytes);

      for (const file of request.files) {
        const bytes = await this.config.content.get(file.storageRef);
        if (bytes === null || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== file.contentHash) {
          return failed('SPAWN_FAILED', `input_file_unavailable:${file.name}`, scriptHash);
        }
        await writeFile(join(dirs.inputs, file.name), bytes, { flag: 'wx' });
      }

      const control = {
        executionId: request.executionId, missionId: request.missionId, taskId: request.taskId,
        inputs: request.inputs, argv: request.argv, writeGrant: input.writeGrant,
        scriptPath, scriptHash, workDir: dirs.work, outputDir: dirs.out, controlDir: dirs.control,
        readRoots: [dirs.inputs, dirs.script, dirs.control], writeRoots: [dirs.work, dirs.out, dirs.tmp],
        contextPath: join(dirs.control, 'context.json'), schemaPath: join(dirs.control, 'schema.json'),
        resultPath: join(dirs.control, 'result.json'), proposalsPath: join(dirs.control, 'proposals.jsonl'), usagePath: join(dirs.control, 'usage.json'),
        limits: { memoryBytes: request.limits.memoryBytes, maxArtifactBytes: request.limits.maxArtifactBytes },
        network: request.network,
        requirements: request.environment.requirements,
      };
      await writeFile(control.contextPath, JSON.stringify(input.context));
      await writeFile(control.schemaPath, JSON.stringify(input.schema));
      const controlPath = join(dirs.control, 'control.json');
      await writeFile(controlPath, JSON.stringify(control));

      if (signal.aborted) return failed('CANCELLED', 'cancelled_before_start', scriptHash);

      const stdout = new BoundedStream(request.limits.outputBytes);
      const stderr = new BoundedStream(request.limits.outputBytes);
      const runaway = request.limits.outputBytes * (this.config.runawayOutputFactor ?? 16);
      const child = spawn(input.environment.executable, [...JULIUS_PYTHON_INTERPRETER_FLAGS, join(this.config.sdkRoot, 'julius', '_runner.py'), controlPath], {
        cwd: dirs.work,
        env: juliusPythonChildEnvironment({ sandbox, executable: input.environment.executable, executionId: request.executionId, secrets: input.secrets, hostEnv: process.env }),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
        shell: false,
      });

      if (child.pid !== undefined) this.config.onSpawn?.({ executionId: request.executionId, pid: child.pid });
      let termination: JuliusPythonTermination = 'EXITED';
      const end = (reason: JuliusPythonTermination) => {
        if (termination !== 'EXITED') return;
        termination = reason;
        killTree(child.pid);
      };
      const timer = setTimeout(() => end('TIMED_OUT'), request.limits.timeoutMs);
      const onAbort = () => end('CANCELLED');
      signal.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', (chunk: Buffer) => { stdout.push(chunk); if (stdout.bytes > runaway) end('OUTPUT_LIMIT'); });
      child.stderr.on('data', (chunk: Buffer) => { stderr.push(chunk); if (stderr.bytes > runaway) end('OUTPUT_LIMIT'); });

      const exit = await new Promise<{ code: number | null; error: string | null }>((resolveExit) => {
        child.once('error', (error) => resolveExit({ code: null, error: error.message.split('\n')[0]!.slice(0, 300) }));
        child.once('close', (code) => resolveExit({ code, error: null }));
      });
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (exit.error !== null) return { ...failed('SPAWN_FAILED', exit.error, scriptHash), stdout: stdout.finish(literals), stderr: stderr.finish(literals) };

      const result = await readBounded(control.resultPath, JULIUS_PYTHON_MAX_RESULT_BYTES);
      const proposals = await readBounded(control.proposalsPath, JULIUS_PYTHON_MAX_PROPOSAL_BYTES);
      const usage = await readBounded(control.usagePath, 256 * 1024);
      const artifacts = termination === 'EXITED' ? await this.collect(dirs.out, request.limits, literals) : [];
      return {
        termination, exitCode: termination === 'EXITED' ? exit.code : null, durationMs: Date.now() - started, scriptHash,
        stdout: stdout.finish(literals), stderr: stderr.finish(literals),
        resultText: result.text, resultTooLarge: result.tooLarge, proposalsText: proposals.text, proposalsTooLarge: proposals.tooLarge,
        usageText: usage.text, artifacts, spawnError: null,
      };
    } finally {
      if (!this.config.keepSandbox) await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    }
  }

  private async collect(outDir: string, limits: JuliusPythonRunInput['request']['limits'], literals: readonly string[]): Promise<JuliusPythonCollectedArtifact[]> {
    const names = (await readdir(outDir)).filter((name) => !name.startsWith('.')).sort();
    const collected: JuliusPythonCollectedArtifact[] = [];
    for (const name of names) {
      const path = join(outDir, name);
      const info = await lstat(path);
      if (collected.length >= limits.maxArtifacts) { collected.push({ name, byteSize: info.size, contentHash: null, storageRef: null, quarantined: 'over_artifact_limit' }); continue; }
      if (!info.isFile()) { collected.push({ name, byteSize: 0, contentHash: null, storageRef: null, quarantined: 'not_a_regular_file' }); continue; }
      if (info.size > limits.maxArtifactBytes) { collected.push({ name, byteSize: info.size, contentHash: null, storageRef: null, quarantined: 'too_large' }); continue; }
      const bytes = await readFile(path);
      // Scanned as text whatever the type: a granted secret written into a
      // "binary" is still the secret, and its bytes never reach storage.
      if (containsJuliusSecret(bytes.toString('latin1'), literals) || containsJuliusSecret(bytes.toString('utf8'), literals)) {
        collected.push({ name, byteSize: bytes.byteLength, contentHash: null, storageRef: null, quarantined: 'contains_secret' });
        continue;
      }
      const stored = await this.config.content.put(bytes);
      collected.push({ name, byteSize: stored.byteSize, contentHash: stored.contentHash, storageRef: stored.storageRef, quarantined: null });
    }
    return collected;
  }
}

/* ------------------------------------------------------------ environments */

const PROBE = [
  'import json, platform, sys',
  'from importlib import metadata',
  'dists = sorted({(d.metadata["Name"], d.version) for d in metadata.distributions() if d.metadata["Name"]})',
  'print(json.dumps({"version": platform.python_version(), "implementation": platform.python_implementation(), "platform": platform.platform(), "executable": sys.executable, "distributions": [{"name": n, "version": v} for n, v in dists]}))',
].join('\n');

/**
 * VERIFY AN INTERPRETER, don't trust a path. Runs it with the same scrubbed
 * environment an execution gets, and records its version, platform, installed
 * distributions and executable hash. The environment hash is what an eval's
 * reproducibility metadata cites.
 */
export async function probeJuliusPythonEnvironment(environmentId: string, executable: string): Promise<JuliusPythonResolvedEnvironment | null> {
  const scratch = tmpdir();
  const probe = spawnSync(executable, [...JULIUS_PYTHON_INTERPRETER_FLAGS, '-c', PROBE], {
    encoding: 'utf8', timeout: 60_000, windowsHide: true,
    env: juliusPythonChildEnvironment({ sandbox: scratch, executable, executionId: 'probe', secrets: [], hostEnv: process.env }),
  });
  if (probe.status !== 0 || typeof probe.stdout !== 'string') return null;
  let facts: { version: string; implementation: string; platform: string; executable: string; distributions: { name: string; version: string }[] };
  try { facts = JSON.parse(probe.stdout.trim().split('\n').at(-1)!); } catch { return null; }
  let executableHash: string | null = null;
  try { executableHash = `sha256:${createHash('sha256').update(await readFile(facts.executable)).digest('hex')}`; } catch { executableHash = null; }
  const distributions = facts.distributions.map(({ name, version }) => ({ name, version })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    environmentId, executable: facts.executable, version: facts.version, implementation: facts.implementation, platform: facts.platform,
    executableHash,
    environmentHash: juliusBrainSha256(canonicalJuliusBrainJson({ version: facts.version, implementation: facts.implementation, platform: facts.platform, distributions })),
    distributions,
  };
}

/** A fixed catalogue of verified environments. Callers name an id; they never supply a path. */
export class StaticJuliusPythonEnvironmentRegistry {
  private readonly cache = new Map<string, Promise<JuliusPythonResolvedEnvironment | null>>();
  constructor(private readonly executables: ReadonlyMap<string, string>) {}
  resolve(environmentId: string): Promise<JuliusPythonResolvedEnvironment | null> {
    const executable = this.executables.get(environmentId);
    if (executable === undefined) return Promise.resolve(null);
    let pending = this.cache.get(environmentId);
    if (pending === undefined) {
      pending = probeJuliusPythonEnvironment(environmentId, executable);
      this.cache.set(environmentId, pending);
    }
    return pending;
  }
}

/** The first CPython 3.11+ on PATH, as an absolute executable; for tests and local development. */
export function discoverJuliusPythonExecutable(): string | null {
  for (const candidate of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
    const probe = spawnSync(candidate, ['-c', 'import sys; print(sys.executable); print(sys.version_info >= (3, 11))'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
    if (probe.status !== 0) continue;
    const [executable, modern] = probe.stdout.trim().split(/\r?\n/);
    if (modern === 'True' && executable && existsSync(executable)) return executable;
  }
  return null;
}
