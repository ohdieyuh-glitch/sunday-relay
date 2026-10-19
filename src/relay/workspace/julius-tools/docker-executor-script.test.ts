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

interface Run { code: number | null; stderr: string; receipts: string; workspace: string; }
const invoke = async (command: string | null, options: { attestationRequired?: boolean; publishGate?: boolean | 'before-only'; outputBlocks?: number; env?: Record<string, string>; reuse?: Run } = {}): Promise<Run> => {
  const root = options.reuse ? dirname(dirname(options.reuse.receipts)) : await mkdtemp(join(tmpdir(), 'julius-script-'));
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
    const phases = options.publishGate === 'before-only' ? (['before'] as const) : (['before', 'after'] as const);
    void (async () => { for (const phase of phases) {
      for (let attempt = 0; attempt < 400; attempt++) {
        if (await readFile(join(receipts, 'token', `${phase}.receipt`), 'utf8').then(() => true, () => false)) {
          await writeFile(join(receipts, 'token', `${phase}.attestation`), '{"attestation":{}}'); break;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    } })();
  }
  // Production runs the command with --workdir /workspace; the harness reproduces that.
  // `null` passes NO command argument, which is what the missing-command guard is about.
  const result = await run('bash', command === null ? [script] : [script, command], { env, cwd: workspace, timeout: 30_000 })
    .then(({ stderr }) => ({ code: 0, stderr }), (error: { code?: number; stderr?: string }) => ({ code: error.code ?? null, stderr: error.stderr ?? '' }));
  return { code: result.code, stderr: result.stderr, receipts: join(receipts, 'token'), workspace };
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

  it('refuses to report a terminal outcome the control plane has not signed', async () => {
    /* The AFTER gate is the other half of the attestation contract: a command that ran is not a terminal
       answer until the signed AFTER fact is durable. Only the BEFORE gate is published here. */
    const result = await invoke('printf ran > ran.txt', { attestationRequired: true, publishGate: 'before-only' });
    expect(result.code).toBe(125);
    // The command did run — this is about refusing to declare the outcome, not about refusing to start.
    expect(await readFile(join(result.workspace, 'ran.txt'), 'utf8')).toBe('ran');
  }, 60_000);

  it('propagates a failing exit code and records it as a failed terminal state', async () => {
    const result = await invoke('exit 42');
    expect(result.code).toBe(42);
    expect(await field(join(result.receipts, 'after.receipt'), 'terminalState')).toBe('FAILED');
    expect(await field(join(result.receipts, 'after.receipt'), 'exitCode')).toBe('42');
  }, 40_000);

  it('bounds output at the block ceiling it was given', async () => {
    const result = await invoke('head -c 200000 /dev/zero | tr "\\0" "x"', { outputBlocks: 8 });
    const stdout = await readFile(join(result.receipts, 'stdout'));
    /* Two-sided, and that is the whole point. `<= 8*1024` alone is satisfied by a 512-byte block unit too,
       which is exactly the defect that survived seven rounds: the flood eval read 65,674 bytes against a
       declared 32,768 and the one-sided bound called it truncation working. 8 blocks must mean 8 KiB. */
    expect(stdout.byteLength).toBeLessThanOrEqual(8 * 1024);
    expect(stdout.byteLength).toBeGreaterThan(4 * 1024);
    expect(await field(join(result.receipts, 'after.receipt'), 'outputBytes')).toBe(String(stdout.byteLength + (await readFile(join(result.receipts, 'stderr'))).byteLength));
  }, 40_000);

  it('refuses to seal over a receipt that already exists', async () => {
    const first = await invoke('printf one');
    expect(await readFile(join(first.receipts, 'stdout'), 'utf8')).toBe('one');
    /* Re-entered against the SAME receipt directory. The script itself must refuse, at exit 125, before the
       command runs — asserting that coreutils' own `ln` refuses would pass with durable_move rewritten to
       clobber, which is a property of coreutils and not of this program. */
    const second = await invoke('printf two', { reuse: first });
    expect(second.code).toBe(125);
    expect(await readFile(join(first.receipts, 'stdout'), 'utf8')).toBe('one');
  }, 60_000);

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
    // Named, not merely non-zero: `not.toBe(0)` is satisfied by any breakage at all, including one that has
    // nothing to do with the missing fact, and would still pass with the guard deleted.
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('JULIUS_MANIFEST_DIGEST');
    expect(await readFile(join(result.receipts, 'before.receipt'), 'utf8').then(() => 'sealed', () => 'not sealed')).toBe('not sealed');
  }, 40_000);

  it('refuses to run with no command at all', async () => {
    /* Run with a COMPLETE environment and no command argument. Previously this ran with no environment
       either, so it died on the first missing fact and proved nothing about the missing command — it would
       have passed with the command guard removed entirely. */
    const result = await invoke(null);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('missing command');
  }, 40_000);

  it('attests a complete changed-path list as available and a truncated one as not', async () => {
    // A real repository with a handful of changes: the list is complete, so it is available.
    const small = await invoke('git init -q . && git -c user.email=a@b -c user.name=a commit -q --allow-empty -m x && printf x > a.txt && printf y > b.txt');
    expect(await field(join(small.receipts, 'after.receipt'), 'changedPathsAvailable')).toBe('1');
    /* And one the script itself truncates. `head -n 100` closes the pipe, which destroys git's exit status,
       so an incomplete list can never be distinguished from a complete one and must report unavailable. */
    const large = await invoke('git init -q . && git -c user.email=a@b -c user.name=a commit -q --allow-empty -m x && for i in $(seq 1 300); do printf x > "f-$i.txt"; done');
    expect(await field(join(large.receipts, 'after.receipt'), 'changedPathsAvailable')).toBe('0');
  }, 60_000);

  it('attests a post-state digest that differs when the command changed the tree', async () => {
    /* Nothing downstream can catch a post-state digest copied from the pre-state one: consume() re-derives
       the result digest from the same value, so afterStateDigest is verified by nothing but this. */
    const result = await invoke('printf mutation > changed.txt');
    const before = await field(join(result.receipts, 'before.receipt'), 'preTreeDigest');
    const after = await field(join(result.receipts, 'after.receipt'), 'postTreeDigest');
    expect(before).toMatch(/^[a-f0-9]{64}$/);
    expect(after).not.toBe(before);
  }, 40_000);
});
