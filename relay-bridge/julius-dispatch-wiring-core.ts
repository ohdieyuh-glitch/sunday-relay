import { createHash } from 'node:crypto';

import type { runGptArchitect } from '../src/relay/connectors/gpt-architect';
import type { GptArchitectConfig } from '../src/relay/connectors/gpt-architect/config';
import type { JuliusCodingAgentProvider } from '../src/relay/mission/julius/julius-coding-agent';
import { J1_ARTIFACT_FILE, type WorkspaceFs } from './julius-dispatch-bundle';
import { createFrozenRunLookup, createJ1ProductionComposition, J1_CODER_READ_PATHS, J1_CODER_WRITE_PATHS } from './julius-dispatch-adapters';
import {
  createJuliusDispatch, createUncomposedJuliusDispatch, frozenMissionProblems,
  type DispatchInput, type DispatchLedger, type DispatchOutcome, type FrozenMission, type JuliusDispatchController,
} from './julius-dispatch';
import { createFrozenReviewerChecker, type FrozenCheckerRun } from './julius-frozen-checker';
import type { XaiDirectReviewerInput } from './julius-xai-direct-reviewer';
import type { ShellEffectPort } from './julius/executor-effects';
import { assertNoProviderKeysInEnv, type KeyStore } from './julius-key-store';
import { isAbsoluteBashPath, type J1SeedFile } from './julius-local-shell-port';

/**
 * J1 LIVE WIRING CORE (no pin values live here). Builds the real composition (GPT architect + Claude Code coder + direct xAI reviewer + reviewer-frozen checker +
 * file ledger + run lookup) from an INJECTED environment, or returns a REFUSE-ONLY controller. DEFAULT OFF and FAIL-CLOSED:
 *   - JULIUS_J1_ENABLED is not '1' -> refuse-only, reason `j1_disabled` (the same controller the bridge ships today);
 *   - ANY missing, malformed or mismatched value, pin or dependency -> refuse-only with a reason CODE (never a value, never a secret).
 * Every pin is verified here BEFORE a live controller exists. Nothing is read from the process environment: the caller hands the
 * environment (or an accessor for it, so the kill switch is re-read per use), and every effect (file reads, child process, fetch,
 * ledger open, temp file) arrives through `deps`. Building a controller places no key and calls no provider.
 */

/**
 * The two frozen sha256 values the environment must EQUAL. This core takes them as a REQUIRED argument; the production module
 * (`julius-dispatch-wiring.ts`) passes its constants and exposes no way to pass anything else. Only the test kit passes test values.
 */
export interface J1Pins { readonly contractSha256: string; readonly checkerSha256: string }

export type J1Env = Readonly<Record<string, string | undefined>>;

export interface J1WiringDeps {
  /** Reads the exact bytes of a file (sync: the contract binding is sync). */
  readonly readFileSync: (path: string) => Uint8Array;
  readonly fetchImpl: XaiDirectReviewerInput['fetchImpl'];
  /** Runs a command with args, no shell; resolves with the exit code and full stdout. The real one spawns a child. */
  readonly runProcess: (command: string, args: readonly string[], env: Readonly<Record<string, string>>) => Promise<FrozenCheckerRun>;
  /** Stages bytes into a fresh private directory (mode 0700 where supported). */
  readonly stageFiles: (files: readonly { readonly name: string; readonly bytes: Uint8Array }[]) => Promise<{ readonly paths: readonly string[]; readonly cleanup: () => Promise<void> }>;
  /** Reads a staged file back (re-hash after the run). */
  readonly readStagedFile: (path: string) => Promise<Uint8Array>;
  readonly realpath: (path: string) => Promise<string>;
  /** The environment the checker child's allow-list is drawn from (the real one passes process.env; nothing else is passed on). */
  readonly checkerBaseEnv: Readonly<Record<string, string | undefined>>;
  readonly writeArtifact: (text: string) => Promise<{ readonly path: string; readonly cleanup: () => Promise<void> }>;
  /** Opens the append-only dispatch ledger at the path (the real one is `createFileDispatchLedger`). May throw. */
  readonly openLedger: (file: string) => DispatchLedger;
  /** The real architect runner; the adapter's own default is used when absent. */
  readonly architectRun?: typeof runGptArchitect;
  /** Builds the coding provider for ONE attempt from the allow-listed env. Null = not available = refuse. */
  readonly coderProviderFor: ((env: Readonly<Record<string, string>>, ctx: { readonly requestedModel: string }) => JuliusCodingAgentProvider) | null;
  readonly shell: ShellEffectPort | null;
  /**
   * Builds the shell for the CONFIGURED coder workspace and the three pinned, re-hashed seed files (the local J1 port). Used only when `shell` is null.
   * Construct-only: building it spawns and writes nothing. Null/absent with `shell` null = refuse (dep_shell_absent).
   */
  readonly shellFor?: ((ctx: { readonly workspacePath: string; readonly bashPath: string; readonly seedFiles: readonly J1SeedFile[] }) => ShellEffectPort) | null;
  /** D-2: whether an absolute path exists (the real one is existsSync). Null = not available = refuse (dep_path_exists_absent). */
  readonly pathExists: ((path: string) => boolean) | null;
  /** Builds the key store for a private key directory (JULIUS_J1_KEY_DIR). Null = not available = refuse. May throw (a bad directory). */
  readonly keyStoreFor: ((dir: string) => KeyStore) | null;
  /** Builds the workspace file-system port the bundle step reads (before/after hash lists, the artifact file). Null = not available = refuse. */
  readonly workspaceFs: ((root: string) => WorkspaceFs) | null;
  readonly now: () => number;
  readonly newId?: () => string;
  /** Safe lines only. */
  readonly log?: (line: string) => void;
  readonly recordChecker?: (entry: { readonly runId: string; readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }) => void;
}

export type J1WiringResult =
  | { readonly live: true; readonly controller: JuliusDispatchController; readonly reason: null }
  | { readonly live: false; readonly controller: JuliusDispatchController; readonly reason: string };

class Refuse extends Error {
  constructor(readonly code: string) { super(code); }
}

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/u;
const TOKEN = /^[a-z0-9_]{1,80}$/u;

export function createJ1LiveDispatchWithPins(env: J1Env | (() => J1Env), deps: J1WiringDeps, pins: J1Pins): J1WiringResult {
  const read: () => J1Env = typeof env === 'function' ? env : (): J1Env => env;
  const refuseOnly = (reason: string): J1WiringResult => {
    try { deps.log?.(`[julius-j1-wiring] refuse-only reason=${reason}`); } catch { /* a log sink must not break startup */ }
    return { live: false, controller: createUncomposedJuliusDispatch(() => ({ ...read() }), deps.now), reason };
  };
  if (read().JULIUS_J1_ENABLED !== '1') return refuseOnly('j1_disabled');
  try {
    return build(read, deps, pins);
  } catch (error) {
    if (error instanceof Refuse) return refuseOnly(error.code);
    const message = error instanceof Error ? error.message : '';
    return refuseOnly(TOKEN.test(message) ? `composition_refused_${message}` : 'composition_failed');
  }
}

function build(read: () => J1Env, deps: J1WiringDeps, pins: J1Pins): J1WiringResult {
  const env = read();
  const need = (name: string): string => {
    const v = (env[name] ?? '').trim();
    if (v === '') throw new Refuse(`config_missing_${name.toLowerCase()}`);
    return v;
  };
  const needHex = (name: string): string => {
    const v = need(name);
    if (!HEX64.test(v)) throw new Refuse(`config_invalid_${name.toLowerCase()}`);
    return v;
  };
  const needPositive = (name: string, integer: boolean): number => {
    const n = Number(need(name));
    if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) throw new Refuse(`config_invalid_${name.toLowerCase()}`);
    return n;
  };
  const needList = (name: string): readonly string[] => {
    const list = need(name).split(',').map((s) => s.trim());
    if (list.some((s) => s === '')) throw new Refuse(`config_invalid_${name.toLowerCase()}`);
    return list;
  };

  /* Dependencies that cannot be proven here are required, never defaulted. */
  const coderProviderFor = deps.coderProviderFor;
  if (coderProviderFor === null) throw new Refuse('dep_coder_provider_absent');
  if (deps.shell === null && (deps.shellFor === undefined || deps.shellFor === null)) throw new Refuse('dep_shell_absent');
  const keyStoreFor = deps.keyStoreFor;
  if (keyStoreFor === null) throw new Refuse('dep_key_store_absent');
  const pathExists = deps.pathExists;
  if (pathExists === null || pathExists === undefined) throw new Refuse('dep_path_exists_absent');
  const workspaceFs = deps.workspaceFs;
  if (workspaceFs === null) throw new Refuse('dep_workspace_fs_absent');

  /* 1. Configuration the controller itself will demand (checked now so a live object never starts half-configured). */
  need('JULIUS_J1_FOUNDER_PLAYER_ID');
  const projectId = need('JULIUS_J1_PROJECT_ID');
  need('JULIUS_J1_REVIEWER_PROVIDER');
  needPositive('JULIUS_J1_BUDGET_CAP_USD', false);
  needPositive('JULIUS_J1_LEG_ESTIMATE_USD', false);

  /* 2. Pins: contract, checker, pristine seed files. Each file is read and hashed HERE. */
  const contractSha = needHex('JULIUS_J1_CONTRACT_SHA256');
  const checkerSha = needHex('JULIUS_J1_CHECKER_SHA256');
  if (contractSha !== pins.contractSha256) throw new Refuse('pin_contract_sha256_not_the_frozen_value');
  if (checkerSha !== pins.checkerSha256) throw new Refuse('pin_checker_sha256_not_the_frozen_value');
  const contractPath = need('JULIUS_J1_CONTRACT_PATH');
  const checkerPath = need('JULIUS_J1_CHECKER_PATH');
  const ledgerSeedPath = need('JULIUS_J1_SEED_LEDGER_PATH');
  const ledgerSeedSha = needHex('JULIUS_J1_SEED_LEDGER_SHA256');
  const postsSeedPath = need('JULIUS_J1_SEED_POSTS_PATH');
  const postsSeedSha = needHex('JULIUS_J1_SEED_POSTS_SHA256');
  const formatTestPath = need('JULIUS_J1_SEED_FORMAT_TEST_PATH');
  const formatTestSha = needHex('JULIUS_J1_SEED_FORMAT_TEST_SHA256');
  const nodePath = need('JULIUS_J1_NODE_PATH');
  /* D-2: bash is an absolute pinned path that exists; PATH is never searched. */
  const bashPath = need('JULIUS_J1_BASH_PATH');
  if (!isAbsoluteBashPath(bashPath)) throw new Refuse('config_invalid_julius_j1_bash_path');
  let bashThere = false;
  try { bashThere = pathExists(bashPath); } catch { bashThere = false; }
  if (!bashThere) throw new Refuse('bash_path_not_found');
  const fileSha = (path: string, code: string): string => {
    try { return sha256Hex(deps.readFileSync(path)); } catch { throw new Refuse(`${code}_unreadable`); }
  };
  if (fileSha(checkerPath, 'pin_checker') !== checkerSha) throw new Refuse('pin_checker_file_mismatch');
  if (fileSha(ledgerSeedPath, 'pin_seed_ledger') !== ledgerSeedSha) throw new Refuse('pin_seed_ledger_file_mismatch');
  if (fileSha(postsSeedPath, 'pin_seed_posts') !== postsSeedSha) throw new Refuse('pin_seed_posts_file_mismatch');
  if (fileSha(formatTestPath, 'pin_seed_format_test') !== formatTestSha) throw new Refuse('pin_seed_format_test_file_mismatch');
  const readContractBytes = (): Uint8Array => deps.readFileSync(contractPath);
  let contractBytes: Uint8Array;
  try { contractBytes = readContractBytes(); } catch { throw new Refuse('pin_contract_unreadable'); }
  if (sha256Hex(contractBytes) !== contractSha) throw new Refuse('pin_contract_sha256_mismatch');
  const brief = Buffer.from(contractBytes).toString('utf8');
  /* THE BRIEF IS THE CONTRACT BYTES: the string the roles get must re-encode to exactly the pinned bytes (invalid UTF-8 or a changed BOM would not). */
  const briefSha256 = sha256Hex(Buffer.from(brief, 'utf8'));
  if (briefSha256 !== contractSha) throw new Refuse('brief_not_contract_bytes');

  /* 3. The frozen mission record (attestations are compared by the controller; shape verified here). */
  const frozen: FrozenMission = {
    missionId: need('JULIUS_J1_MISSION_ID'), contractSha256: contractSha, checkerSha256: checkerSha,
    missionAuthor: need('JULIUS_J1_MISSION_AUTHOR'), checkerAuthor: need('JULIUS_J1_CHECKER_AUTHOR'),
    seededDefect: false, preregId: need('JULIUS_J1_PREREG_ID'),
  };
  if (frozenMissionProblems(frozen).length > 0) throw new Refuse('frozen_mission_record_invalid');

  /* 4. Models, key variable NAMES, served-model allow list, architect and coder settings. */
  const architectModel = need('JULIUS_J1_ARCHITECT_MODEL');
  const coderModel = need('JULIUS_J1_CODER_MODEL');
  const reviewerModel = need('JULIUS_J1_REVIEWER_MODEL');
  const architectKeyEnv = need('JULIUS_J1_ARCHITECT_KEY_ENV');
  const reviewerKeyEnv = need('JULIUS_J1_REVIEWER_KEY_ENV');
  /* Per-role served-model lists: REQUIRED, no implicit default in live mode. */
  const architectServedAllow = needList('JULIUS_J1_ARCHITECT_SERVED_MODEL_ALLOW');
  const coderServedAllow = needList('JULIUS_J1_CODER_SERVED_MODEL_ALLOW');
  const servedModelAllow = needList('JULIUS_J1_REVIEWER_SERVED_MODEL_ALLOW');
  /* PROVIDER KEYS NEVER LIVE IN process.env: the coder session inherits this env. Refuse if either logical key name is in it, then build the store. */
  const keyDir = need('JULIUS_J1_KEY_DIR');
  if (!assertNoProviderKeysInEnv(env, [architectKeyEnv, reviewerKeyEnv]).ok) throw new Refuse('provider_key_in_env');
  let keyStore: KeyStore;
  try { keyStore = keyStoreFor(keyDir); } catch { throw new Refuse('key_store_unavailable'); }
  if (!keyStore.has(architectKeyEnv) || !keyStore.has(reviewerKeyEnv)) throw new Refuse('key_store_key_unavailable');
  const architectConfig: GptArchitectConfig = {
    apiKeyPresent: true, model: architectModel, liveMode: true,
    maxOutputTokens: needPositive('JULIUS_J1_ARCHITECT_MAX_OUTPUT_TOKENS', true), timeoutMs: needPositive('JULIUS_J1_ARCHITECT_TIMEOUT_MS', true), unusable: [],
  };
  const permittedPaths = needList('JULIUS_J1_CODER_PERMITTED_PATHS');
  /* The coder writes exactly out/normalized.json: the environment cannot widen that. */
  if (permittedPaths.length !== J1_CODER_WRITE_PATHS.length || permittedPaths.some((p, i) => p !== J1_CODER_WRITE_PATHS[i])) throw new Refuse('config_invalid_julius_j1_coder_permitted_paths');
  const workspacePath = need('JULIUS_J1_CODER_WORKSPACE_PATH');
  const workerId = need('JULIUS_J1_CODER_WORKER_ID');
  const ledgerFile = need('JULIUS_J1_LEDGER_FILE');
  /* The shell for THIS workspace: the supplied one, else built from the configured path and the pinned seed files (bytes read now, hashes re-checked by the port). */
  const shell: ShellEffectPort = deps.shell ?? deps.shellFor!({
    workspacePath, bashPath,
    seedFiles: [
      { name: 'data/legacy_ledger.csv', bytes: deps.readFileSync(ledgerSeedPath), sha256: ledgerSeedSha },
      { name: 'data/posts.json', bytes: deps.readFileSync(postsSeedPath), sha256: postsSeedSha },
      { name: 'format.test.mjs', bytes: deps.readFileSync(formatTestPath), sha256: formatTestSha },
    ],
  });

  /* 5. Compose. Pure construction; the ledger is opened last, only after every pin held. */
  const providers = createJ1ProductionComposition({
    env, brief, fetchImpl: deps.fetchImpl,
    architect: { config: architectConfig, keyEnv: architectKeyEnv, servedModelAllow: architectServedAllow, ...(deps.architectRun === undefined ? {} : { run: deps.architectRun }) },
    coder: { providerFor: (childEnv) => coderProviderFor(childEnv, { requestedModel: coderModel }), shell, projectId, workerId, workspacePath, model: coderModel, servedModelAllow: coderServedAllow, permittedPaths, readPaths: J1_CODER_READ_PATHS, bundle: { fs: workspaceFs(workspacePath), artifactPath: J1_ARTIFACT_FILE, gitDir: '.git' }, keyEnv: null, secretKeyEnvs: [] },
    reviewer: { model: reviewerModel, keyEnv: reviewerKeyEnv, servedModelAllow },
  });
  /* J1 creates its own run, so the lookup answers with the FROZEN record for the one configured project. */
  const runs = createFrozenRunLookup({ projectId, frozen });
  const checker = createFrozenReviewerChecker({
    nodePath, checkerPath, checkerSha256: checkerSha, ledgerPath: ledgerSeedPath, ledgerSha256: ledgerSeedSha, postsPath: postsSeedPath, postsSha256: postsSeedSha,
    readFileBytes: async (path) => deps.readFileSync(path), stage: deps.stageFiles, readStagedBytes: deps.readStagedFile, realpath: deps.realpath, baseEnv: deps.checkerBaseEnv, writeArtifact: deps.writeArtifact, run: deps.runProcess,
    ...(deps.recordChecker === undefined ? {} : { record: deps.recordChecker }),
  });
  let ledger: DispatchLedger;
  try { ledger = deps.openLedger(ledgerFile); } catch { throw new Refuse('ledger_open_failed'); }

  const inner = createJuliusDispatch({
    providers, runs, frozen, checker, ledger, mode: 'live', briefSha256, env: () => ({ ...read() }), keyStore, now: deps.now,
    ...(deps.newId === undefined ? {} : { newId: deps.newId }),
    ...(deps.log === undefined ? {} : { log: deps.log }),
  });
  /* recover() must finish before the first dispatch (OPEN_ITEMS 21). A failed recovery refuses every dispatch. */
  let recovered: Promise<Awaited<ReturnType<JuliusDispatchController['recover']>> | null> | null = null;
  const ready = (): Promise<Awaited<ReturnType<JuliusDispatchController['recover']>> | null> => {
    recovered ??= inner.recover().catch(() => {
      try { deps.log?.('[julius-j1-wiring] recover failed; dispatch refused'); } catch { /* ignore */ }
      return null;
    });
    return recovered;
  };
  const controller: JuliusDispatchController = {
    async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
      if ((await ready()) === null) return { ok: false, status: 503, code: 'julius_dispatch_ledger_unavailable' };
      return inner.dispatch(input);
    },
    issueEcho: (i) => inner.issueEcho(i),
    events: (i) => inner.events(i),
    result: (i) => inner.result(i),
    async recover() {
      const r = await ready();
      if (r === null) throw new Error('julius dispatch recovery failed');
      return r;
    },
    whenIdle: () => inner.whenIdle(),
    killSwitchOn: () => inner.killSwitchOn(),
  };
  return { live: true, controller, reason: null };
}
