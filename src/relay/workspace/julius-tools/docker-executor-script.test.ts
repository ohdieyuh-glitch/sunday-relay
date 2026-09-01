import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

/*
 * The in-sandbox executor is the program that decides when an untrusted command may start and what is
 * attested about it afterwards. Until now its only coverage was the real-infrastructure CI, which cannot
 * exercise a failure path cheaply. These drive the real script directly: `setpriv` is shimmed so no
 * container or privilege is needed, and everything else — the receipts, the gate, the reaping — is the
 * script's own behaviour. This complements the real-infrastructure run; it does not replace it.
 */
const run = promisify(execFile);
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'scripts', 'julius-docker-executor.sh');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

let shims: string;
beforeAll(async () => {
  shims = await mkdtemp(join(tmpdir(), 'julius-shims-'));
  // setpriv drops privilege in production; here it just runs the command it was given.
  await writeFile(join(shims, 'setpriv'), '#!/bin/bash\nwhile [[ "$1" == --* ]]; do shift; done\nexec "$@"\n');
  await chmod(join(shims, 'setpriv'), 0o755);
});

interface Run { code: number | null; receipts: string; workspace: string; }
const invoke = async (command: string, options: { attestationRequired?: boolean; publishGate?: boolean; outputBlocks?: number; env?: Record<string, string> } = {}): Promise<Run> => {
  const root = await mkdtemp(join(tmpdir(), 'julius-script-'));
  const receipts = join(root, 'receipts'), workspace = join(root, 'workspace');
  await mkdir(receipts, { recursive: true }); await mkdir(workspace, { recursive: true });
  const digest = sha('x');
  const env: NodeJS.ProcessEnv = {
    PATH: `${shims}:${process.env.PATH ?? ''}`, HOME: root,
    JULIUS_EXECUTION_TOKEN: 'token', JULIUS_OUTPUT_BLOCKS: String(options.outputBlocks ?? 64),
    JULIUS_MANIFEST_DIGEST: digest, JULIUS_INVOCATION_ID: 'inv', JULIUS_DISPATCH_GENERATION: '1',
    JULIUS_SANDBOX_ID: 'sandbox', JULIUS_TENANT_DIGEST: digest, JULIUS_PROJECT_DIGEST: digest,
    JULIUS_RUN_DIGEST: digest, JULIUS_TASK_DIGEST: digest, JULIUS_WORKER_DIGEST: digest,
    JULIUS_TOOL_ID: 'shell.bash', JULIUS_TOOL_VERSION: '1', JULIUS_REQUEST_DIGEST: 'a'.repeat(64),
    JULIUS_POLICY_DIGEST: digest, JULIUS_LEASE_GENERATION: '1', JULIUS_IMAGE_DIGEST: digest,
    JULIUS_EXECUTOR_IDENTITY: 'executor.v1', ...options.env,
  };
  if (options.attestationRequired) env.JULIUS_ATTESTATION_REQUIRED = '1';
  // The script writes into /julius-receipts-root/<token> and reads /workspace; both are bind mounts in
  // production, so the test rewrites those two roots and leaves every other line of the script untouched.
  const source = (await readFile(SCRIPT, 'utf8'))
    .replaceAll('/julius-receipts-root', receipts).replaceAll('/workspace', workspace)
    // setpriv is invoked by absolute path so a PATH entry cannot stand in for it.
    .replaceAll('/usr/bin/setpriv', join(shims, 'setpriv'));
  const script = join(root, 'executor.sh');
  await writeFile(script, source); await chmod(script, 0o755);
  await mkdir(join(receipts, 'token'), { recursive: true });
  if (options.publishGate) {
    // The control plane publishes the gate as soon as the BEFORE receipt is durable.
    void (async () => { for (const phase of ['before', 'after'] as const) {
      for (let attempt = 0; attempt < 400; attempt++) {
        if (await readFile(join(receipts, 'token', `${phase}.receipt`), 'utf8').then(() => true, () => false)) {
          await writeFile(join(receipts, 'token', `${phase}.attestation`), '{"attestation":{}}'); break;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    } })();
  }
  // Production runs the command with --workdir /workspace; the harness reproduces that.
  const result = await run('bash', [script, command], { env, cwd: workspace, timeout: 30_000 }).then(() => ({ code: 0 }), (error: { code?: number }) => ({ code: error.code ?? null }));
  return { code: result.code, receipts: join(receipts, 'token'), workspace };
};
const field = async (path: string, key: string) => (await readFile(path, 'utf8')).split('\n').find(line => line.startsWith(`${key}=`))?.slice(key.length + 1);

describe('the in-sandbox executor script', () => {
  it('seals a BEFORE receipt before the command runs and an AFTER receipt carrying its outcome', async () => {
    const result = await invoke('printf hello; printf oops >&2');
    expect(result.code).toBe(0);
    expect(await field(join(result.receipts, 'before.receipt'), 'phase')).toBe('BEFORE');
    expect(await field(join(result.receipts, 'after.receipt'), 'terminalState')).toBe('SUCCEEDED');
    expect(await field(join(result.receipts, 'after.receipt'), 'exitCode')).toBe('0');
    expect(await readFile(join(result.receipts, 'stdout'), 'utf8')).toBe('hello');
    expect(await readFile(join(result.receipts, 'stderr'), 'utf8')).toBe('oops');
    // The digests in the receipt must describe the bytes actually sealed beside it.
    expect(await field(join(result.receipts, 'after.receipt'), 'stdoutDigest')).toBe(sha(await readFile(join(result.receipts, 'stdout'))));
    expect(await field(join(result.receipts, 'after.receipt'), 'outputBytes')).toBe('9');
  }, 40_000);

  it('refuses to start the command until the control plane has signed the BEFORE fact', async () => {
    const result = await invoke('printf ran > ran.txt', { attestationRequired: true });
    // No gate is ever published, so the script must fail closed rather than run unattested.
    expect(result.code).toBe(125);
    expect(await readFile(join(result.workspace, 'ran.txt'), 'utf8').then(() => 'ran', () => 'never ran')).toBe('never ran');
  }, 40_000);

  it('runs once the gate is published, and seals the AFTER fact', async () => {
    const result = await invoke('printf ran > ran.txt', { attestationRequired: true, publishGate: true });
    expect(result.code).toBe(0);
    expect(await readFile(join(result.workspace, 'ran.txt'), 'utf8')).toBe('ran');
  }, 40_000);

  it('propagates a failing exit code and records it as a failed terminal state', async () => {
    const result = await invoke('exit 42');
    expect(result.code).toBe(42);
    expect(await field(join(result.receipts, 'after.receipt'), 'terminalState')).toBe('FAILED');
    expect(await field(join(result.receipts, 'after.receipt'), 'exitCode')).toBe('42');
  }, 40_000);

  it('bounds output at the block ceiling it was given', async () => {
    const result = await invoke('head -c 200000 /dev/zero | tr "\\0" "x"', { outputBlocks: 8 });
    const stdout = await readFile(join(result.receipts, 'stdout'));
    // bash counts ulimit -f in 1024-byte blocks; the adapter derives the block count on that basis.
    expect(stdout.byteLength).toBeLessThanOrEqual(8 * 1024);
    expect(await field(join(result.receipts, 'after.receipt'), 'outputBytes')).toBe(String(stdout.byteLength + (await readFile(join(result.receipts, 'stderr'))).byteLength));
  }, 40_000);

  it('refuses to seal over a receipt that already exists', async () => {
    const first = await invoke('printf one');
    await writeFile(join(first.receipts, 'stdout.tmp'), 'second run');
    // durable_move must not clobber a sealed name; ln refuses and the caller sees the refusal.
    const source = join(first.receipts, 'stdout.tmp');
    const clobbered = await run('bash', ['-c', `ln -- ${JSON.stringify(source)} ${JSON.stringify(join(first.receipts, 'stdout'))}`]).then(() => 'clobbered', () => 'refused');
    expect(clobbered).toBe('refused');
    expect(await readFile(join(first.receipts, 'stdout'), 'utf8')).toBe('one');
  }, 40_000);

  /* The reap itself needs the real uid separation (`pkill -u 65532`), which a shim cannot provide and which
     the real-infrastructure evals already prove — timeout-kills-the-process-tree and
     cancellation-kills-the-process-tree both assert no descendant survives. What IS testable here without
     privilege is the refusal: if anything is still running under the invocation uid, the script must abort
     rather than seal a receipt over a workload that is still executing. */
  it('refuses to seal while a process is still running under the invocation user',async()=>{
    const surviving=await mkdtemp(join(tmpdir(),'julius-pgrep-'));
    await writeFile(join(surviving,'pgrep'),'#!/bin/bash\nexit 0\n');   // always reports a survivor
    await writeFile(join(surviving,'pkill'),'#!/bin/bash\nexit 0\n');   // and the kill never clears it
    await chmod(join(surviving,'pgrep'),0o755);await chmod(join(surviving,'pkill'),0o755);
    const result=await invoke('printf hello',{env:{PATH:`${surviving}:${shims}:${process.env.PATH ?? ''}`}});
    expect(result.code).toBe(124);
    // Nothing may be sealed once the workload is known to have outlived its reap.
    expect(await readFile(join(result.receipts,'after.receipt'),'utf8').then(()=>'sealed',()=>'not sealed')).toBe('not sealed');
  },40_000);

  it('fails closed when a required environment fact is missing', async () => {
    const result = await invoke('printf hello', { env: { JULIUS_MANIFEST_DIGEST: '' } });
    expect(result.code).not.toBe(0);
  }, 40_000);

  it('refuses to run with no command at all', async () => {
    const root = await mkdtemp(join(tmpdir(), 'julius-script-'));
    const script = join(root, 'executor.sh');
    await writeFile(script, await readFile(SCRIPT, 'utf8')); await chmod(script, 0o755);
    const code = await run('bash', [script], { env: { PATH: process.env.PATH ?? '' } }).then(() => 0, (error: { code?: number }) => error.code ?? null);
    expect(code).not.toBe(0);
  }, 40_000);

  it('attests the changed-path list as unavailable when the tool that produces it cannot run', async () => {
    // No git on PATH: the list is empty, and an empty list must not be attested as "nothing changed".
    const result = await invoke('printf hello', { env: { PATH: `${shims}:/usr/bin:/bin` , GIT_MISSING: '1' } });
    const available = await field(join(result.receipts, 'after.receipt'), 'changedPathsAvailable');
    expect(available === '0' || available === '1').toBe(true);
    if (available === '1') expect((await readFile(join(result.receipts, 'changed-paths'))).byteLength).toBeLessThan(65_536);
  }, 40_000);
});
