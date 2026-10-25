/**
 * THIN LOCAL ENTRY for the Wonderland operator claim.
 *
 *   node --experimental-strip-types src/relay/integration/wonderland-admission/operator-claim-cli.ts claim \
 *     --store <file> --wonderland-run <wlj_> --server-run <run:> --repo <owner/name> --lane <lane>
 *
 * Dry-run is the default: it prints the exact `gh` command, writes no claim
 * record, and spawns nothing. `--dispatch` also requires `--confirm 'RUN LIVE MISSION'`.
 * Only that path spawns `gh` (a read of the spent tag, then the workflow
 * run). This process never reads a credential. The admission file is local.
 *
 * Loopback only. There is no listen socket and no remote store.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAID_WORKFLOW_FILE } from './admission-contract';
import { isLocalStorePath, openAdmissionFile } from './admission-file';
import {
  createOperatorClaimTool,
  type ClaimResult,
  type GhResult,
  type GhSpawner,
  type OperatorView,
  type StatusResult,
} from './operator-claim';

const USAGE = [
  'wonderland-operator-claim — local, loopback-only claim of one admitted Wonderland pair.',
  'The admission file stays on this machine. This process reads no credential.',
  '',
  '  claim  --store <file> --wonderland-run <wlj_> --server-run <run:> --repo <owner/name> --lane <lane> [--workflow <yml>]',
  '         Dry-run: print the exact gh command. Writes no claim record and spawns nothing.',
  '  claim  ... --dispatch --confirm \'RUN LIVE MISSION\'',
  '         gh reads the spent tag. If it is absent, the claim is reserved and gh runs the workflow once.',
  '  status --store <file> --wonderland-run <wlj_> --server-run <run:>',
  '         Print the claimed record, its run: id, and the spent-tag state. Spawns nothing.',
  '',
  'A second claim prints the existing state and does not dispatch again.',
  'dispatch_failed and already_spent stay terminal.',
  'A visible RUN_ID_ALREADY_SPENT halt is already_spent.',
  'A visible SPENT_TAG_UNVERIFIED halt is dispatch_failed.',
].join('\n');

export interface OperatorClaimCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface OperatorClaimCliDeps {
  readonly spawn: GhSpawner;
  readonly nowIso: () => string;
  readonly readWorkflow: (path: string) => string;
}

export async function runOperatorClaimCli(
  argv: readonly string[],
  io: OperatorClaimCliIo,
  deps: OperatorClaimCliDeps,
): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.error !== undefined) {
    io.err(parsed.error);
    io.err(USAGE);
    return 2;
  }
  if (parsed.help || parsed.command === 'help') {
    io.out(USAGE);
    return 0;
  }
  if (parsed.command !== 'claim' && parsed.command !== 'status') {
    io.err(USAGE);
    return 2;
  }
  const store = flag(parsed, 'store');
  const wonderlandRunId = flag(parsed, 'wonderland-run');
  const serverRunId = flag(parsed, 'server-run');
  if (store === null || wonderlandRunId === null || serverRunId === null) {
    io.err(USAGE);
    return 2;
  }
  if (!isLocalStorePath(store)) {
    io.err('operator_store_not_local');
    return 1;
  }
  let file;
  try {
    file = openAdmissionFile(store);
  } catch (error) {
    return failClosed(io, error);
  }
  const tool = createOperatorClaimTool(file, deps.spawn, { nowIso: deps.nowIso });
  if (parsed.command === 'status') {
    if (parsed.dispatch || parsed.flags.has('confirm') || parsed.flags.has('lane') || parsed.flags.has('repo')) {
      io.err(USAGE);
      return 2;
    }
    try {
      return emitStatus(io, await tool.status(wonderlandRunId, serverRunId));
    } catch (error) {
      return failClosed(io, error);
    }
  }
  const repo = flag(parsed, 'repo');
  const lane = flag(parsed, 'lane');
  if (repo === null || lane === null) {
    io.err(USAGE);
    return 2;
  }
  const workflowPath = flag(parsed, 'workflow') ?? join(process.cwd(), '.github', 'workflows', PAID_WORKFLOW_FILE);
  let workflowSource: string;
  try {
    workflowSource = deps.readWorkflow(workflowPath);
  } catch {
    io.err('workflow_unreadable');
    return 1;
  }
  try {
    const result = await tool.claim({
      wonderlandRunId,
      serverRunId,
      repo,
      lane,
      workflowSource,
      dispatch: parsed.dispatch,
      confirmation: flag(parsed, 'confirm'),
    });
    return emitClaim(io, result);
  } catch (error) {
    return failClosed(io, error);
  }
}

function emitClaim(io: OperatorClaimCliIo, result: ClaimResult): number {
  if (result.ok) {
    const body: Record<string, unknown> = {
      ok: true,
      claimed: result.claimed,
      replayed: result.replayed,
      dispatchedWorkflow: result.dispatchedWorkflow,
      ...publicRecord(result.record),
    };
    if (!result.dispatchedWorkflow && result.command !== null) body.command = result.command;
    io.out(JSON.stringify(body));
    if (!result.replayed && !result.dispatchedWorkflow && result.command !== null) io.out(result.command);
    return 0;
  }
  const body: Record<string, unknown> = {
    ok: false,
    kind: result.kind,
    message: result.message,
  };
  if (
    result.kind === 'dispatch_failed'
    || result.kind === 'RUN_ID_ALREADY_SPENT'
    || result.kind === 'SPENT_TAG_UNVERIFIED'
    || result.kind === 'AWAITING_OPERATOR_EXPIRED'
  ) {
    body.retry = false;
  }
  if (result.requiredInput !== null) body.requiredInput = result.requiredInput;
  if (result.record !== null) Object.assign(body, publicRecord(result.record));
  io.out(JSON.stringify(body));
  if (result.requiredInput !== null) io.err(result.requiredInput);
  return 1;
}

function emitStatus(io: OperatorClaimCliIo, result: StatusResult): number {
  if (!result.ok) {
    io.out(JSON.stringify({ ok: false, kind: result.kind, message: result.message }));
    return 1;
  }
  const body: Record<string, unknown> = { ok: true, ...publicRecord(result.record) };
  if (result.phase !== null) {
    body.state = result.phase.projection.state;
    body.updatedAt = result.phase.updatedAt;
    if (result.phase.projection.cause !== undefined) body.cause = result.phase.projection.cause;
  }
  if (
    result.record.state === 'dispatch_failed'
    || result.record.state === 'already_spent'
    || result.phase?.projection.cause === 'AWAITING_OPERATOR_EXPIRED'
  ) body.retry = false;
  io.out(JSON.stringify(body));
  return 0;
}

function publicRecord(record: OperatorView): Record<string, unknown> {
  return {
    wonderlandRunId: record.wonderlandRunId,
    serverRunId: record.serverRunId,
    state: record.state,
    missionId: record.missionId,
    dispatchKey: record.dispatchKey,
    spentTag: record.spentTag,
    spentTagState: record.spentTagState,
    concurrencyGroup: record.concurrencyGroup,
    halt: record.halt,
    dispatchAttempted: record.dispatchAttempted,
    dispatchError: record.dispatchError,
    claimedAt: record.claimedAt,
    workflowRunId: record.workflowRunId,
  };
}

function failClosed(io: OperatorClaimCliIo, error: unknown): number {
  const message = error instanceof Error ? error.message : '';
  io.err(/^[a-z0-9_]+$/.test(message) ? message : 'operator_claim_failed');
  return 1;
}

interface ParsedArgs {
  readonly command: string | null;
  readonly help: boolean;
  readonly dispatch: boolean;
  readonly flags: ReadonlyMap<string, string>;
  readonly error?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string>();
  let command: string | null = null;
  let dispatch = false;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--dispatch') {
      dispatch = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      if (command !== null) return { command, help, dispatch, flags, error: 'usage' };
      command = arg;
      continue;
    }
    const eq = arg.indexOf('=');
    const name = (eq === -1 ? arg.slice(2) : arg.slice(2, eq));
    if (!FLAG_NAMES.has(name)) return { command, help, dispatch, flags, error: 'usage' };
    const value = eq === -1 ? argv[index + 1] : arg.slice(eq + 1);
    if (value === undefined || (eq === -1 && value.startsWith('--'))) {
      return { command, help, dispatch, flags, error: 'usage' };
    }
    if (eq === -1) index += 1;
    flags.set(name, value);
  }
  return { command, help, dispatch, flags };
}

const FLAG_NAMES = new Set(['store', 'wonderland-run', 'server-run', 'repo', 'lane', 'workflow', 'confirm']);

function flag(parsed: ParsedArgs, name: string): string | null {
  const value = parsed.flags.get(name);
  return value === undefined || value.trim() === '' ? null : value;
}

function ghSpawn(args: readonly string[]): GhResult {
  try {
    const result = spawnSync('gh', [...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      code: typeof result.status === 'number' ? result.status : 1,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
    };
  } catch {
    return { code: 127, stdout: '', stderr: '' };
  }
}

const entry = process.argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === entry) {
  runOperatorClaimCli(process.argv.slice(2), {
    out: (line) => { process.stdout.write(`${line}\n`); },
    err: (line) => { process.stderr.write(`${line}\n`); },
  }, {
    spawn: { run: ghSpawn },
    nowIso: () => new Date().toISOString(),
    readWorkflow: (path) => readFileSync(path, 'utf8'),
  }).then((code) => {
    process.exitCode = code;
  }, () => {
    process.exitCode = 1;
  });
}
