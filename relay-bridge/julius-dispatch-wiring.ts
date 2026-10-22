import { createHash } from 'node:crypto';

import type { runGptArchitect } from '../src/relay/connectors/gpt-architect';
import type { GptArchitectConfig } from '../src/relay/connectors/gpt-architect/config';
import type { JuliusCodingAgentProvider } from '../src/relay/mission/julius/julius-coding-agent';
import type { JuliusApiIdentity, JuliusApiResult, JuliusRunView } from '../src/relay/mission/julius/julius-runtime-api';
import { assertContractBinding, createJ1ProductionComposition, createJuliusRunLookup } from './julius-dispatch-adapters';
import {
  createJuliusDispatch, createUncomposedJuliusDispatch, frozenMissionProblems,
  type DispatchInput, type DispatchLedger, type DispatchOutcome, type FrozenMission, type JuliusDispatchController,
} from './julius-dispatch';
import { createFrozenReviewerChecker, type FrozenCheckerRun } from './julius-frozen-checker';
import type { XaiDirectReviewerInput } from './julius-xai-direct-reviewer';
import type { ShellEffectPort } from './julius/executor-effects';

/**
 * J1 LIVE WIRING. Builds the real composition (GPT architect + Claude Code coder + direct xAI reviewer + reviewer-frozen checker +
 * file ledger + run lookup) from an INJECTED environment, or returns a REFUSE-ONLY controller. DEFAULT OFF and FAIL-CLOSED:
 *   - JULIUS_J1_ENABLED is not '1' -> refuse-only, reason `j1_disabled` (the same controller the bridge ships today);
 *   - ANY missing, malformed or mismatched value, pin or dependency -> refuse-only with a reason CODE (never a value, never a secret).
 * Every pin is verified here BEFORE a live controller exists. Nothing is read from the process environment: the caller hands the
 * environment (or an accessor for it, so the kill switch is re-read per use), and every effect (file reads, child process, fetch,
 * ledger open, temp file) arrives through `deps`. Building a controller places no key and calls no provider.
 */

/** The reviewer-frozen pins. The environment must EQUAL these; changing a pin therefore needs a code edit, which is reviewed. */
export const J1_PINNED_CONTRACT_SHA256 = 'bfa90f50f70916ff52180a94537f243300da8dcc51ee06d3952b0f18876226aa';
export const J1_PINNED_CHECKER_SHA256 = '1d1dc64ff9cf8f1f4133bbe22a65c483a9ad343a3ef4c2ee898709549b46f5dd';

export type J1Env = Readonly<Record<string, string | undefined>>;

export interface J1WiringDeps {
  /** Reads the exact bytes of a file (sync: the contract binding is sync). */
  readonly readFileSync: (path: string) => Uint8Array;
  readonly fetchImpl: XaiDirectReviewerInput['fetchImpl'];
  /** Runs a command with args, no shell; resolves with the exit code and full stdout. The real one spawns a child. */
  readonly runProcess: (command: string, args: readonly string[]) => Promise<FrozenCheckerRun>;
  readonly writeArtifact: (text: string) => Promise<{ readonly path: string; readonly cleanup: () => Promise<void> }>;
  /** Opens the append-only dispatch ledger at the path (the real one is `createFileDispatchLedger`). May throw. */
  readonly openLedger: (file: string) => DispatchLedger;
  /** The real architect runner; the adapter's own default is used when absent. */
  readonly architectRun?: typeof runGptArchitect;
  /** Builds the coding provider for ONE attempt from the allow-listed env. Null = not available = refuse. */
  readonly coderProviderFor: ((env: Readonly<Record<string, string>>) => JuliusCodingAgentProvider) | null;
  readonly shell: ShellEffectPort | null;
  /** The Julius run store port set the run lookup needs. Null = not available = refuse. */
  readonly runStore: {
    readonly api: { inspectRun(identity: JuliusApiIdentity, runId: string): Promise<JuliusApiResult<JuliusRunView>> };
    readonly identityFor: (projectId: string) => JuliusApiIdentity;
    readonly contractSha256Of: (input: { readonly projectId: string; readonly runId: string; readonly missionId: string }) => Promise<string | null>;
  } | null;
  readonly now: () => number;
  readonly newId?: () => string;
  /** Safe lines only. */
  readonly log?: (line: string) => void;
  /** Override of the frozen contract/checker pins. TESTS ONLY (fake bytes cannot hash to the real pins); the server never passes it. */
  readonly pinned?: { readonly contractSha256: string; readonly checkerSha256: string };
  readonly recordChecker?: (entry: { readonly runId: string; readonly exitCode: number | null; readonly stdout: string }) => void;
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

export function createJ1LiveDispatchFromEnv(env: J1Env | (() => J1Env), deps: J1WiringDeps): J1WiringResult {
  const read: () => J1Env = typeof env === 'function' ? env : (): J1Env => env;
  const refuseOnly = (reason: string): J1WiringResult => {
    try { deps.log?.(`[julius-j1-wiring] refuse-only reason=${reason}`); } catch { /* a log sink must not break startup */ }
    return { live: false, controller: createUncomposedJuliusDispatch(() => ({ ...read() }), deps.now), reason };
  };
  if (read().JULIUS_J1_ENABLED !== '1') return refuseOnly('j1_disabled');
  try {
    return build(read, deps);
  } catch (error) {
    if (error instanceof Refuse) return refuseOnly(error.code);
    const message = error instanceof Error ? error.message : '';
    return refuseOnly(TOKEN.test(message) ? `composition_refused_${message}` : 'composition_failed');
  }
}

function build(read: () => J1Env, deps: J1WiringDeps): J1WiringResult {
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
  if (deps.coderProviderFor === null) throw new Refuse('dep_coder_provider_absent');
  if (deps.shell === null) throw new Refuse('dep_shell_absent');
  if (deps.runStore === null) throw new Refuse('dep_run_store_absent');

  /* 1. Configuration the controller itself will demand (checked now so a live object never starts half-configured). */
  need('JULIUS_J1_FOUNDER_PLAYER_ID');
  const projectId = need('JULIUS_J1_PROJECT_ID');
  need('JULIUS_J1_REVIEWER_PROVIDER');
  needPositive('JULIUS_J1_BUDGET_CAP_USD', false);
  needPositive('JULIUS_J1_LEG_ESTIMATE_USD', false);

  /* 2. Pins: contract, checker, pristine seed files. Each file is read and hashed HERE. */
  const contractSha = needHex('JULIUS_J1_CONTRACT_SHA256');
  const checkerSha = needHex('JULIUS_J1_CHECKER_SHA256');
  if (contractSha !== (deps.pinned?.contractSha256 ?? J1_PINNED_CONTRACT_SHA256)) throw new Refuse('pin_contract_sha256_not_the_frozen_value');
  if (checkerSha !== (deps.pinned?.checkerSha256 ?? J1_PINNED_CHECKER_SHA256)) throw new Refuse('pin_checker_sha256_not_the_frozen_value');
  const contractPath = need('JULIUS_J1_CONTRACT_PATH');
  const checkerPath = need('JULIUS_J1_CHECKER_PATH');
  const ledgerSeedPath = need('JULIUS_J1_SEED_LEDGER_PATH');
  const ledgerSeedSha = needHex('JULIUS_J1_SEED_LEDGER_SHA256');
  const postsSeedPath = need('JULIUS_J1_SEED_POSTS_PATH');
  const postsSeedSha = needHex('JULIUS_J1_SEED_POSTS_SHA256');
  const nodePath = need('JULIUS_J1_NODE_PATH');
  const fileSha = (path: string, code: string): string => {
    try { return sha256Hex(deps.readFileSync(path)); } catch { throw new Refuse(`${code}_unreadable`); }
  };
  if (fileSha(checkerPath, 'pin_checker') !== checkerSha) throw new Refuse('pin_checker_file_mismatch');
  if (fileSha(ledgerSeedPath, 'pin_seed_ledger') !== ledgerSeedSha) throw new Refuse('pin_seed_ledger_file_mismatch');
  if (fileSha(postsSeedPath, 'pin_seed_posts') !== postsSeedSha) throw new Refuse('pin_seed_posts_file_mismatch');
  const readContractBytes = (): Uint8Array => deps.readFileSync(contractPath);
  try {
    assertContractBinding({ contractSha256Of: deps.runStore.contractSha256Of, preregContractSha256: contractSha, readContractBytes });
  } catch (error) {
    throw new Refuse(`pin_${error instanceof Error && TOKEN.test(error.message) ? error.message : 'contract_binding_failed'}`);
  }
  const brief = Buffer.from(readContractBytes()).toString('utf8');

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
  const architectConfig: GptArchitectConfig = {
    apiKeyPresent: (env[architectKeyEnv] ?? '').trim() !== '', model: architectModel, liveMode: true,
    maxOutputTokens: needPositive('JULIUS_J1_ARCHITECT_MAX_OUTPUT_TOKENS', true), timeoutMs: needPositive('JULIUS_J1_ARCHITECT_TIMEOUT_MS', true), unusable: [],
  };
  const permittedPaths = needList('JULIUS_J1_CODER_PERMITTED_PATHS');
  const workspacePath = need('JULIUS_J1_CODER_WORKSPACE_PATH');
  const workerId = need('JULIUS_J1_CODER_WORKER_ID');
  const ledgerFile = need('JULIUS_J1_LEDGER_FILE');

  /* 5. Compose. Pure construction; the ledger is opened last, only after every pin held. */
  const providers = createJ1ProductionComposition({
    env, brief, fetchImpl: deps.fetchImpl,
    architect: { config: architectConfig, keyEnv: architectKeyEnv, servedModelAllow: architectServedAllow, ...(deps.architectRun === undefined ? {} : { run: deps.architectRun }) },
    coder: { providerFor: deps.coderProviderFor, shell: deps.shell, projectId, workerId, workspacePath, model: coderModel, servedModelAllow: coderServedAllow, permittedPaths, keyEnv: null, secretKeyEnvs: [] },
    reviewer: { model: reviewerModel, keyEnv: reviewerKeyEnv, servedModelAllow },
  });
  const runs = createJuliusRunLookup({
    api: deps.runStore.api, identityFor: deps.runStore.identityFor, contractSha256Of: deps.runStore.contractSha256Of,
    contractBinding: { preregContractSha256: contractSha, readContractBytes },
  });
  const checker = createFrozenReviewerChecker({
    nodePath, checkerPath, checkerSha256: checkerSha, ledgerPath: ledgerSeedPath, ledgerSha256: ledgerSeedSha, postsPath: postsSeedPath, postsSha256: postsSeedSha,
    readFileBytes: async (path) => deps.readFileSync(path), writeArtifact: deps.writeArtifact, run: deps.runProcess,
    ...(deps.recordChecker === undefined ? {} : { record: deps.recordChecker }),
  });
  let ledger: DispatchLedger;
  try { ledger = deps.openLedger(ledgerFile); } catch { throw new Refuse('ledger_open_failed'); }

  const inner = createJuliusDispatch({
    providers, runs, frozen, checker, ledger, mode: 'live', env: () => ({ ...read() }), now: deps.now,
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
