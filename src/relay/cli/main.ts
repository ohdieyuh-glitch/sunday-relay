import { parseArgs } from 'node:util';
import * as readline from 'node:readline';
import { RELAY_PROTOCOL_VERSION } from '../protocol/version';
import { createRelayApp, SCENARIOS, type RelayApp } from '../core/app';
import { createSession } from './interactive';
import { buildPresentationFrames } from './presentation';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
import { detectRenderOptions, renderAudit, renderEvent, renderManualTask, welcome, badge, type RenderOptions } from './render';
import { buildCompetitiveFrames, competitiveJson } from './competitive';
import { buildMissionControlFrames } from './mission-control';
import { EXIT, exitCodeForFinalStatus } from './exit-codes';
import { bridgeClientFrom, runReviewerBridgeCli } from './reviewer-bridge-cli';
import { BRIDGE_URL_ENV } from '../reviewer-bridge-client';
import { runWorkspaceVerification, workspaceDoctorReport } from '../workspace';
import { createRandomIdFactory } from '../protocol/ids';
import {
  checkLivePrerequisites, classifyClaudeAuth, claudeDoctorReport, CLAUDE_ADAPTER_ID,
  DEFAULT_LIVE_LIMITS,
  probeClaudeCapabilities, runClaudeContractVerification, runClaudeProof,
} from '../connectors/claude-code';
import {
  checkReviewPrerequisites, classifyCodexAuth, codexDoctorReport,
  probeCodexCapabilities, runCodexReviewerContractVerification, runCodexReviewProof,
} from '../connectors/codex-reviewer';
import {
  checkSupervisedPrerequisites, runSupervisedContractVerification, runSupervisedProof,
} from '../connectors/supervised';
import {
  createNodeCodingAgentStore, createNodeMissionWorktreeStore, createNodePromptArchitectStore,
  createNodeReviewerHarnessStore, createStateStore, createSupervisedRunRecorder, recoverRun,
  resolveStateRoot, runPersistenceContractVerification, runRecoveryDrill, stateDoctorReport,
} from '../persistence';
// The worktree projection comes through the mission BARREL — the CLI
// boundary permits '../mission', never a deep module path.
import {
  detectCaps, findProjectRecord, loadAppData, productHome, productProjects, productProjectStatus,
  productProjectView, productRecover, productRunConfirmation, runCliContractVerification,
  runCliDemo, runProductShell, type ProjectView,
} from './product';
import { createNodePreflightDeps, runYcPreflight, ycDemoNotice } from '../yc';
import {
  PSP_ARGUMENT_REFUSAL, runPspAgentImportCommand, type PspCredentialSource,
} from './product';
import { createUnavailableEntitlementService } from '../psp';
// Development fixtures are imported from their own module (never through the
// domain surface) so the production import path never reaches them at all.
import { createFixtureEntitlementService } from '../psp/psp-fixtures';
import {
  buildMissionEconomicsFixture,
  renderMissionBudget,
  renderMissionEconomics,
  renderMissionReceipts,
} from './mission-economics';
import { renderAgentOperatingProfiles } from './agent-operating';
import { LOOP_CLI_HELP, runLoopCli } from './loop-cli';
// The SHARED projection — the same one the website's inspector renders.
import {
  RELAY_AGENT_ROLES, operatingProfileFixture, projectAgentOperatingProfiles,
  projectMissionWorktree, renderWorktreeStatusLines,
  codingAgentDraftFrom, projectCodingAgentRuntime, renderCodingAgentStatusLines,
  runtimeRecordFromObservation, usageFromRuntimeReport,
  architectDraftFrom, projectPromptArchitect, renderArchitectStatusLines,
  harnessDraftFrom, projectReviewerHarness, renderHarnessCatalogLines, renderReviewerStatusLines,
} from '../mission';
import { evaluateReadiness, readGptArchitectConfig } from '../connectors/gpt-architect';
import { inspectClaudeRuntime } from './claude-runtime';

/**
 * Relay CLI entry (Prompt 5). Thin client: parses arguments, composes the
 * Relay app through the approved composition root, renders read models.
 * Simulation-only, volatile storage — and it says so, always.
 */

export const CLI_VERSION = '0.5.0';

export interface CliIo {
  out(line: string): void;
  isTTY: boolean;
  env: NodeJS.ProcessEnv;
}

const defaultIo: CliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  isTTY: process.stdout.isTTY === true,
  env: process.env,
};

export interface ParsedCli {
  command: 'interactive' | 'demo' | 'run' | 'doctor' | 'version' | 'help' | 'workspace' | 'claude' | 'codex' | 'supervised'
    | 'state' | 'runs' | 'persistence'
    | 'home' | 'projects' | 'project' | 'recover' | 'cli' | 'session' | 'yc' | 'agent' | 'mission' | 'reviewer'
    | 'loop';
  /** The canonical slash string this invocation reconstructs, when the command
   *  is a Loop command. The CLI never parses the grammar itself. */
  loopArgs?: readonly string[];
  workspaceAction?: 'doctor' | 'verify';
  agentAction?: 'import' | 'profile';
  /** Which agent's operating profile to print; all three when absent. */
  role?: string;
  missionAction?: 'economics' | 'budget' | 'receipts' | 'worktree' | 'coding-agent' | 'prompt-architect' | 'reviewer';
  reviewerMode?: 'status' | 'inspect' | 'stop' | 'test-connection' | 'start' | 'retry';
  reviewerAction?: 'harnesses' | 'pair-browser';
  pairOrigin?: string;
  authorize?: boolean;
  harness?: string;
  model?: string;
  generation?: string;
  idempotencyKey?: string;
  priorRun?: string;
  architectMode?: 'status' | 'inspect' | 'stop';
  codingAgentMode?: 'status' | 'inspect' | 'stop';
  worktreeMode?: 'status' | 'inspect';
  missionRef?: string;
  /** True when a credential was pasted as an argument — refused, never used. */
  credentialInArgv?: boolean;
  stdinCredential?: boolean;
  /** The NAME of an environment reference. Never the credential value. */
  credentialEnv?: string;
  assumeYes?: boolean;
  workspaceId?: string;
  claudeAction?: 'doctor' | 'run' | 'inspect' | 'cancel' | 'contract-verify';
  codexAction?: 'doctor' | 'run' | 'inspect' | 'cancel' | 'contract-verify';
  supervisedAction?: 'run' | 'contract-verify';
  stateAction?: 'doctor';
  runsAction?: 'list' | 'inspect' | 'recover' | 'archive';
  persistenceAction?: 'contract-verify' | 'recovery-drill';
  projectAction?: 'new' | 'open' | 'status' | 'settings' | 'workforce' | 'research' | 'run'
    | 'terminal' | 'tasks' | 'findings' | 'evidence' | 'history' | 'repairs';
  cliAction?: 'demo' | 'contract-verify';
  ycAction?: 'check' | 'demo';
  projectRef?: string;
  reducedMotion?: boolean;
  watch?: boolean;
  once?: boolean;
  runRef?: string;
  stateRoot?: string;
  fixture?: string;
  confirmLive: boolean;
  /** Keep the throwaway workspace + fixture after a live proof for inspection. */
  preserveEvidence?: boolean;
  scenario?: string;
  objective?: string;
  maxCost?: number;
  untilStopped: boolean;
  autoAcceptBlueprint: boolean;
  presentation: boolean;
  pace?: number;
  compact: boolean;
  json: boolean;
  noColor: boolean;
  plain: boolean;
  quiet: boolean;
  error?: string;
}

export function parseCli(argv: string[]): ParsedCli {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        objective: { type: 'string' },
        scenario: { type: 'string' },
        'max-cost': { type: 'string' },
        'until-stopped': { type: 'boolean', default: false },
        'auto-accept-blueprint': { type: 'boolean', default: false },
        presentation: { type: 'boolean', default: false },
        pace: { type: 'string' },
        compact: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        'no-color': { type: 'boolean', default: false },
        plain: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        fixture: { type: 'string' },
        'confirm-live': { type: 'boolean', default: false },
        'preserve-evidence': { type: 'boolean', default: false },
        run: { type: 'string' },
        'state-root': { type: 'string' },
        project: { type: 'string' },
        'reduced-motion': { type: 'boolean', default: false },
        watch: { type: 'boolean', default: false },
        once: { type: 'boolean', default: false },
        // PSP Agent ID import. There is deliberately NO --psp-agent-id flag:
        // a bearer credential must never reach argv, shell history, or the
        // process table. The ID arrives by hidden prompt, stdin, or a NAMED
        // environment reference (the name, never the value).
        stdin: { type: 'boolean', default: false },
        'credential-env': { type: 'string' },
        yes: { type: 'boolean', default: false },
        workspace: { type: 'string' },
        // Reviewer bridge controls. There is deliberately NO --bridge-token
        // flag: a bearer credential must never reach argv, shell history or
        // the process table. The token arrives only through RELAY_BRIDGE_TOKEN.
        authorize: { type: 'boolean', default: false },
        harness: { type: 'string' },
        model: { type: 'string' },
        generation: { type: 'string' },
        'idempotency-key': { type: 'string' },
        'prior-run': { type: 'string' },
      },
    });
    const pace = values.pace !== undefined ? Number(values.pace) : undefined;
    const base = {
      json: values.json === true, noColor: values['no-color'] === true,
      plain: values.plain === true, quiet: values.quiet === true,
      untilStopped: values['until-stopped'] === true,
      autoAcceptBlueprint: values['auto-accept-blueprint'] === true,
      authorize: values.authorize === true,
      harness: values.harness,
      model: values.model,
      generation: values.generation,
      idempotencyKey: values['idempotency-key'],
      priorRun: values['prior-run'],
      presentation: values.presentation === true,
      pace, compact: values.compact === true,
      watch: values.watch === true, once: values.once === true,
      confirmLive: values['confirm-live'] === true,
      preserveEvidence: values['preserve-evidence'] === true,
    };
    if (pace !== undefined && (!Number.isFinite(pace) || pace < 0)) {
      return { command: 'help', ...base, pace: undefined, error: '--pace must be a non-negative number of milliseconds.' };
    }
    const [first, second, third] = positionals;
    if (values.help || first === 'help') return { command: 'help', ...base };
    // LOOP COMMANDS. Deliberately NOT parsed here: `loop-cli.ts` rebuilds the
    // canonical slash string and hands it to the ONE domain grammar, so argv
    // and a browser composer cannot drift. A literal slash argument
    // (`relay "/loop all fix it"`) takes the same path.
    if (first === 'loop' || first === 'loops' || first === 'sloop' || first?.startsWith('/')) {
      return { command: 'loop', loopArgs: positionals, ...base };
    }
    if (first === 'mission') {
      const missionActions = ['economics', 'budget', 'receipts', 'worktree', 'coding-agent', 'prompt-architect', 'reviewer'] as const;
      type MissionAction = (typeof missionActions)[number];
      if (!missionActions.includes(second as MissionAction)) {
        return {
          command: 'mission',
          ...base,
          error: 'mission requires an action: economics, budget, receipts, worktree, coding-agent, prompt-architect, or reviewer.',
        };
      }
      if (second === 'reviewer') {
        // `relay mission reviewer <action> <mission-id>`. The bridge-backed
        // actions reach the server through the Reviewer Bridge Client; there
        // is still no harness passthrough from the terminal.
        const modes = ['status', 'inspect', 'stop', 'test-connection', 'start', 'retry'] as const;
        if (!modes.includes(third as (typeof modes)[number])) {
          return {
            command: 'mission', missionAction: 'reviewer', ...base,
            error: 'mission reviewer requires status, inspect, stop, test-connection, start, or retry, then a mission id.',
          };
        }
        return {
          command: 'mission', missionAction: 'reviewer',
          reviewerMode: third as (typeof modes)[number],
          missionRef: positionals[3], stateRoot: values['state-root'], ...base,
        };
      }

      if (second === 'prompt-architect') {
        // `relay mission prompt-architect <status|inspect|stop> <mission-id>`.
        // No arbitrary OpenAI request passthrough exists here by design.
        const modes = ['status', 'inspect', 'stop'] as const;
        if (!modes.includes(third as (typeof modes)[number])) {
          return {
            command: 'mission', missionAction: 'prompt-architect', ...base,
            error: 'mission prompt-architect requires status, inspect, or stop, then a mission id.',
          };
        }
        return {
          command: 'mission', missionAction: 'prompt-architect',
          architectMode: third as (typeof modes)[number],
          missionRef: positionals[3], stateRoot: values['state-root'], ...base,
        };
      }

      if (second === 'coding-agent') {
        // `relay mission coding-agent <status|inspect|stop> <mission-id>`.
        // No arbitrary Claude CLI passthrough exists here by design.
        const modes = ['status', 'inspect', 'stop'] as const;
        if (!modes.includes(third as (typeof modes)[number])) {
          return {
            command: 'mission',
            missionAction: 'coding-agent',
            ...base,
            error: 'mission coding-agent requires status, inspect, or stop, then a mission id.',
          };
        }
        return {
          command: 'mission',
          missionAction: 'coding-agent',
          codingAgentMode: third as (typeof modes)[number],
          missionRef: positionals[3],
          stateRoot: values['state-root'],
          ...base,
        };
      }

      if (second === 'worktree') {
        // `relay mission worktree <status|inspect> <mission-id>` — read-only.
        // There is no raw-git passthrough here by design.
        const modes = ['status', 'inspect'] as const;
        const mode = third;
        if (!modes.includes(mode as (typeof modes)[number])) {
          return {
            command: 'mission',
            missionAction: 'worktree',
            ...base,
            error: 'mission worktree requires status or inspect, then a mission id.',
          };
        }
        return {
          command: 'mission',
          missionAction: 'worktree',
          worktreeMode: mode as (typeof modes)[number],
          missionRef: positionals[3],
          stateRoot: values['state-root'],
          ...base,
        };
      }
      return {
        command: 'mission',
        missionAction: second as MissionAction,
        ...base,
        projectRef: third,
      };
    }

    if (first === 'reviewer') {
      // `relay reviewer harnesses` — the catalog only. There is no harness
      // passthrough, because no harness adapter exists.
      if (second !== 'harnesses' && second !== 'pair-browser') {
        return {
          command: 'reviewer', ...base,
          error: 'reviewer requires an action: harnesses or pair-browser.',
        };
      }
      return {
        command: 'reviewer', ...base,
        reviewerAction: second as 'harnesses' | 'pair-browser',
        pairOrigin: positionals[2],
      };
    }

    if (first === 'agent' || first === 'psp-agent') {
      // `agent profile` prints the four canonical operating components —
      // Runtime, Mission Contract, Environment, Tools — from the SAME shared
      // projection the website panels render.
      if (second === 'profile') {
        // Validated HERE, like every other sub-action, rather than inside the
        // handler — an unknown role is a usage error, not a runtime surprise.
        if (third !== undefined && !RELAY_AGENT_ROLES.includes(third as never)) {
          return {
            command: 'agent', agentAction: 'profile', ...base,
            error: `Unknown agent role "${third}". Known: ${RELAY_AGENT_ROLES.join(', ')}.`,
          };
        }
        return { command: 'agent', agentAction: 'profile', ...base, role: third };
      }
      if (second !== 'import') {
        return { command: 'agent', ...base, error: `${first} requires an action: import or profile.` };
      }
      // A credential pasted as a positional argument is REFUSED, never used.
      if (third !== undefined) {
        return {
          command: 'agent', agentAction: 'import', ...base,
          credentialInArgv: true,
        };
      }
      return {
        command: 'agent', agentAction: 'import', ...base,
        stdinCredential: values.stdin === true,
        credentialEnv: values['credential-env'],
        assumeYes: values.yes === true,
        workspaceId: values.workspace,
      };
    }
    if (first === 'version') return { command: 'version', ...base };
    if (first === 'doctor') return { command: 'doctor', ...base };
    if (first === 'workspace') {
      if (second !== 'doctor' && second !== 'verify') {
        return { command: 'workspace', ...base, error: 'workspace requires an action: doctor or verify.' };
      }
      return { command: 'workspace', workspaceAction: second, ...base };
    }
    if (first === 'claude') {
      const actions = ['doctor', 'run', 'inspect', 'cancel', 'contract-verify'];
      if (!second || !actions.includes(second)) {
        return { command: 'claude', ...base, error: 'claude requires an action: doctor, run, inspect, cancel, or contract-verify.' };
      }
      // `--project` names the receipt the proof writes (so it can be read back
      // with `relay mission coding-agent status <id>`); `--state-root` says
      // where. Both are optional — the receipt id otherwise derives from the
      // run's own redacted session reference.
      return {
        command: 'claude', claudeAction: second as ParsedCli['claudeAction'], fixture: values.fixture,
        projectRef: values.project, stateRoot: values['state-root'], ...base,
      };
    }
    if (first === 'codex') {
      const actions = ['doctor', 'run', 'inspect', 'cancel', 'contract-verify'];
      if (!second || !actions.includes(second)) {
        return { command: 'codex', ...base, error: 'codex requires an action: doctor, run, inspect, cancel, or contract-verify.' };
      }
      return { command: 'codex', codexAction: second as ParsedCli['codexAction'], fixture: values.fixture, ...base };
    }
    if (first === 'supervised') {
      const actions = ['run', 'contract-verify'];
      if (!second || !actions.includes(second)) {
        return { command: 'supervised', ...base, error: 'supervised requires an action: run or contract-verify.' };
      }
      return { command: 'supervised', supervisedAction: second as ParsedCli['supervisedAction'], fixture: values.fixture, ...base };
    }
    if (first === 'state') {
      if (second !== 'doctor') return { command: 'state', ...base, error: 'state requires an action: doctor.' };
      return { command: 'state', stateAction: 'doctor', stateRoot: values['state-root'], ...base };
    }
    if (first === 'runs') {
      const actions = ['list', 'inspect', 'recover', 'archive'];
      if (!second || !actions.includes(second)) {
        return { command: 'runs', ...base, error: 'runs requires an action: list, inspect, recover, or archive.' };
      }
      if (second !== 'list' && !values.run) {
        return { command: 'runs', ...base, error: `runs ${second} requires --run <run-reference>.` };
      }
      return {
        command: 'runs', runsAction: second as ParsedCli['runsAction'],
        runRef: values.run, stateRoot: values['state-root'], ...base,
      };
    }
    if (first === 'persistence') {
      const actions = ['contract-verify', 'recovery-drill'];
      if (!second || !actions.includes(second)) {
        return { command: 'persistence', ...base, error: 'persistence requires an action: contract-verify or recovery-drill.' };
      }
      return { command: 'persistence', persistenceAction: second as ParsedCli['persistenceAction'], ...base };
    }
    if (first === 'home' || first === 'projects' || first === 'session') {
      return { command: first, stateRoot: values['state-root'], reducedMotion: values['reduced-motion'], ...base };
    }
    if (first === 'project') {
      const actions = ['new', 'open', 'status', 'settings', 'workforce', 'research', 'run',
        'terminal', 'tasks', 'findings', 'evidence', 'history', 'repairs'];
      if (!second || !actions.includes(second)) {
        return { command: 'project', ...base, error: `project requires an action: ${actions.join(', ')}.` };
      }
      return {
        command: 'project', projectAction: second as ParsedCli['projectAction'],
        projectRef: values.project ?? positionals[2], stateRoot: values['state-root'],
        reducedMotion: values['reduced-motion'], ...base,
      };
    }
    if (first === 'recover') {
      return { command: 'recover', runRef: values.run ?? positionals[1], stateRoot: values['state-root'], ...base };
    }
    if (first === 'cli') {
      const actions = ['demo', 'contract-verify'];
      if (!second || !actions.includes(second)) {
        return { command: 'cli', ...base, error: 'cli requires an action: demo or contract-verify.' };
      }
      return { command: 'cli', cliAction: second as ParsedCli['cliAction'], reducedMotion: values['reduced-motion'], ...base };
    }
    if (first === 'yc') {
      const actions = ['check', 'demo'];
      if (!second || !actions.includes(second)) {
        return { command: 'yc', ...base, error: 'yc requires an action: check (demo preflight) or demo (offline launcher).' };
      }
      return { command: 'yc', ycAction: second as ParsedCli['ycAction'], reducedMotion: values['reduced-motion'], ...base };
    }
    if (first === 'demo') {
      if (!second) return { command: 'demo', ...base, error: 'demo requires a scenario name (e.g. relay demo repair).' };
      // mission-control is a presentation OVER the competitive scenario.
      if (second === 'mission-control') return { command: 'demo', scenario: 'mission-control', ...base };
      if (!SCENARIOS[second]) return { command: 'demo', ...base, error: `Unknown scenario "${second}". Known: ${Object.keys(SCENARIOS).join(', ')}, mission-control.` };
      return { command: 'demo', scenario: second, ...base };
    }
    if (first === 'run') {
      if (!values.objective) return { command: 'run', ...base, error: 'run requires --objective "<text>".' };
      const scenario = values.scenario ?? 'direct';
      if (!SCENARIOS[scenario]) return { command: 'run', ...base, error: `Unknown scenario "${scenario}".` };
      const maxCost = values['max-cost'] !== undefined ? Number(values['max-cost']) : undefined;
      if (maxCost !== undefined && (!Number.isFinite(maxCost) || maxCost <= 0)) {
        return { command: 'run', ...base, error: '--max-cost must be a positive number.' };
      }
      return { command: 'run', objective: values.objective, scenario, maxCost, ...base };
    }
    if (first !== undefined) return { command: 'help', ...base, error: `Unknown command "${first}".` };
    return { command: 'interactive', ...base };
  } catch (err) {
    return {
      command: 'help', json: false, noColor: true, plain: true, quiet: false,
      untilStopped: false, autoAcceptBlueprint: false, presentation: false, compact: false,
      confirmLive: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const HELP_TEXT = [
  'Sunday Relay CLI — simulation demo surface (SIMULATED · VOLATILE storage)',
  '',
  'Usage:',
  '  relay                          interactive session',
  '  relay demo <scenario>          run one deterministic scenario',
  '  relay run --objective "<t>"    run a custom displayed objective',
  '       [--scenario <name>] [--max-cost <usd>] [--until-stopped]',
  '       [--auto-accept-blueprint]',
  '  relay doctor                   read-only environment checks',
  '  relay workspace doctor         isolated-worktree capability checks (live local)',
  '  relay mission worktree status <mission-id>   isolated worktree state (read-only)',
  '  relay mission worktree inspect <mission-id>  the same state plus validation findings',
  '  relay mission coding-agent status <mission-id>   Coding Agent runtime state',
  '  relay mission coding-agent inspect <mission-id>  runtime state plus probed capabilities',
  '  relay mission coding-agent stop <mission-id>     record a stop request (work preserved)',
  '  relay mission prompt-architect status <mission-id>   GPT planning state',
  '  relay mission prompt-architect inspect <mission-id>  state plus server configuration',
  '  relay mission prompt-architect stop <mission-id>     record a cancellation request',
  '  relay mission reviewer status <mission-id>   Reviewer harness state',
  '  relay mission reviewer inspect <mission-id>  state plus independence reasoning',
  '  relay mission reviewer stop <mission-id>     record a cancellation request',
  '  relay mission reviewer test-connection <id>  verify the bridge Reviewer (no run)',
  '  relay mission reviewer start <mission-id>    start an authorized Reviewer run',
  '  relay mission reviewer retry <mission-id>    retry a failed run as a NEW run',
  '  relay loop <objective>         draft a Loop for your active compound agent',
  '  relay loop all|team <objective>        every eligible agent',
  '  relay loop architect|coding|reviewer <objective>   one role',
  '  relay loop architect,coding <objective>            several roles',
  '  relay loop status|inspect|pause|resume|stop [loop-id]',
  '  relay loops                    the Loop catalog',
  '  relay loop schedule|cron|schedules     Cron Loop grammar (runtime not enabled)',
  '  relay sloop <objective>        Swarm Loop (requires Unchain)',
  '  relay loop help                the full Loop grammar',
  '  relay reviewer harnesses       the Reviewer harness catalog (truthful statuses)',
  '  relay reviewer pair-browser <origin>  mint a one-time browser pairing grant',
  '  relay workspace verify         deterministic workspace security verification',
  '  relay claude doctor            truthful Claude Code capability + auth report',
  '  relay claude contract-verify   offline adapter proof (no provider call)',
  '  relay claude run --fixture safe-edit --confirm-live   REAL Claude Code proof',
  '      --model <alias|id>     request a model (the answering model is read back)',
  '      --preserve-evidence    keep the throwaway worktree + fixture to inspect',
  '      --project <id>         name the receipt written for the run',
  '  relay codex doctor             truthful Codex reviewer capability + auth report',
  '  relay codex contract-verify    offline reviewer proof (no provider call)',
  '  relay codex run --fixture review-defect --confirm-live   REAL Codex review',
  '  relay supervised contract-verify   offline full-workflow proof (no provider call)',
  '  relay supervised run --fixture safe-edit --confirm-live   REAL supervised loop',
  '  relay state doctor             durable state-directory health report',
  '  relay runs list                safe summaries of persisted runs',
  '  relay runs inspect --run <ref> truthful reconstructed run state',
  '  relay runs recover --run <ref> validate + replay + plan (zero provider calls)',
  '  relay runs archive --run <ref> archive a completed run (never deletes)',
  '  relay persistence contract-verify   offline process-restart proof (no provider call)',
  '  relay persistence recovery-drill    two-process crash recovery drill (offline)',
  '  relay                          the Relay terminal product shell (interactive TTY)',
  '  relay home | relay projects    product home / project list (durable state)',
  '  relay project new|open|status|settings|workforce|research|tasks|findings|evidence|history|run',
  '  relay recover [<run-ref>]      recovery status / plan (zero provider calls)',
  '  relay cli demo                 OFFLINE terminal product demo (fake adapters)',
  '  relay cli contract-verify      CLI product contract proof (no provider call)',
  '  relay agent profile [role]     runtime, mission contract, environment, tools',
  '       (all three agents when no role is given; the same projection the',
  '        website inspector renders — no provider call)',
  '  relay agent import             import a PSP agent with your PSP Agent ID',
  '       (prompts with HIDDEN input; the ID is never accepted as an argument)',
  '       [--stdin]                 read the ID from secure stdin instead',
  '       [--credential-env NAME]   read it from a NAMED environment reference',
  '       [--workspace <id>] [--yes]',
  '  relay psp-agent import         same command, spelled out',
  '  relay yc check                 YC demo preflight (read-only, no provider call)',
  '  relay yc demo                  founder YC demo launcher (offline simulation only)',
  '  relay session                  legacy simulated interactive session',
  '  relay demo competitive         Mission Contract + Claude/Codex proof (SIMULATED)',
  '  relay demo mission-control     modes + Relay Dog + Reviewer gate + Live Terminal',
  '  relay version | relay help',
  '',
  'Options: --json --no-color --plain --quiet',
  `Scenarios: ${Object.keys(SCENARIOS).join(', ')}`,
].join('\n');

/* ----------------------- demo / run execution ---------------------- */

export interface DemoOutcome {
  exitCode: number;
  lines: string[];
  finalStatus: string;
  json?: unknown;
  /** The composed app (read models only) for presentation rendering. */
  app: RelayApp;
}

export function runScenarioToCompletion(input: {
  scenarioName: string;
  objective?: string;
  maxCost?: number;
  autoAcceptBlueprint?: boolean;
  render: RenderOptions;
  ids?: Parameters<typeof createRelayApp>[0]['ids'];
  now?: () => string;
}): DemoOutcome {
  const { scenarioName, render } = input;
  const definition = SCENARIOS[scenarioName];
  const lines: string[] = [];
  const emit = (moreLines: string[]) => lines.push(...moreLines);
  const created = createRelayApp({
    scenarioName,
    interactiveBlueprint: false,
    maxCostUsd: input.maxCost,
    ids: input.ids,
    now: input.now,
  });
  if (!created.ok) return { exitCode: EXIT.usage, lines: [created.error.message], finalStatus: 'error', app: null as unknown as RelayApp };
  const app: RelayApp = created.value;
  emit(welcome(render, scenarioName));
  const objective = input.objective ?? `Demonstrate the "${scenarioName}" Relay scenario.`;
  const started = app.start(objective);
  if (!started.ok) return { exitCode: EXIT.internalError, lines: [...lines, started.error.message], finalStatus: 'error', app };

  let seq = 0;
  const drain = () => {
    const events = app.events(seq);
    seq = events.at(-1)?.sequence ?? seq;
    emit(events.map((e) => renderEvent(e, render)));
  };

  const doContinue = () => {
    const result = app.continueRun();
    if (!result.ok) emit([`${badge('FAIL')} ${result.error.message}`]);
    drain();
  };

  // pause/cancel choreography must act MID-run — step partway instead of
  // completing first (a cancel after completion would be a dishonest demo).
  if (definition.choreography === 'pause-resume' || definition.choreography === 'cancel' || definition.choreography === 'stale') {
    for (let i = 0; i < 4; i++) app.step();
    drain();
  } else {
    doContinue();
  }
  /* demo choreography for multi-phase scenarios */
  if (definition.choreography === 'pause-resume') {
    app.pause();
    emit([`${badge('INFO')} Paused by demo choreography.`]);
    app.resume();
    emit([`${badge('INFO')} Resumed.`]);
    doContinue();
  } else if (definition.choreography === 'cancel') {
    app.cancel('demo choreography cancellation');
    drain();
  } else if (definition.choreography === 'duplicate') {
    emit([`${badge('INFO')} First run is active. Creating an EQUIVALENT second run (same equivalence key)…`]);
    const second = app.startSecondEquivalentRun();
    if (second.ok) doContinue();
  } else if (definition.choreography === 'stale') {
    emit([`${badge('INFO')} Repository moved to a new revision under the compiled handoff…`]);
    app.moveBaseRevision('rev-moved-by-demo');
    doContinue();
  } else if (definition.choreography === 'manual') {
    // Manual Task demo: the run REALLY stopped at the checkpoint; the demo
    // choreography plays the user choosing "Done", honestly labeled.
    if (app.manualTask()) {
      emit(['', ...renderManualTask(app)]);
      emit(['', `${badge('INFO')} Demo choreography: the user completes the steps and chooses "Done".`]);
      const responded = app.respondManualTask('done');
      if (!responded.ok) emit([`${badge('FAIL')} ${responded.error.message}`]);
      drain();
      doContinue();
    }
  }

  const status = app.status();
  const finalStatus = status?.status ?? 'unknown';
  const audit = app.audit();
  if (audit) emit(['', ...renderAudit(app)]);
  if (status?.checkpoint && !status.checkpoint.respondedAt) {
    if (app.manualTask()) emit(['', ...renderManualTask(app)]);
    else emit(['', 'CHECKPOINT REQUIRED', `  ${status.checkpoint.reason}`, '  Automatic work has stopped.']);
  }
  const exitCode = exitCodeForFinalStatus(finalStatus, status?.checkpoint?.reason ?? null);
  const jsonPayload = {
    scenario: scenarioName,
    protocolVersion: RELAY_PROTOCOL_VERSION,
    adapterProfile: 'simulation',
    storageProfile: 'volatile-memory',
    finalStatus,
    exitCode,
    status,
    audit,
    manualTask: app.manualTask(),
    events: app.events(0),
    usage: app.usage(),
  };
  return { exitCode, lines, finalStatus, json: jsonPayload, app };
}

/* ------------------------------ doctor ----------------------------- */

export function doctorReport(io: CliIo): { lines: string[]; exitCode: number } {
  const checks: Array<[string, string]> = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push(['Node runtime', nodeMajor >= 18 ? `v${process.versions.node} (supported)` : `v${process.versions.node} (UNSUPPORTED — need >= 18)`]);
  let coreOk = false;
  try {
    const app = createRelayApp({ scenarioName: 'direct' });
    coreOk = app.ok;
  } catch {
    coreOk = false;
  }
  checks.push(['Relay Core', coreOk ? 'available' : 'FAILED to construct']);
  checks.push(['Protocol', RELAY_PROTOCOL_VERSION]);
  checks.push(['Simulation adapters', 'available']);
  checks.push(['Scenario registry', `${Object.keys(SCENARIOS).length} scenarios`]);
  checks.push(['Current storage', 'volatile memory (state dies with the process)']);
  checks.push(['Durable storage', 'live local (journal + snapshots + mission records)']);
  checks.push(['Real Claude Code adapter', 'DEFERRED']);
  checks.push(['Real Codex adapter', 'DEFERRED']);
  checks.push(['Hermes adapter', 'DEFERRED']);
  checks.push(['Worktree manager', 'live local (isolated mission worktrees)']);
  checks.push(['Production deployment', 'disabled']);
  checks.push(['Provider credentials accessed', 'no']);
  checks.push(['Terminal TTY', io.isTTY ? 'interactive' : 'non-interactive']);
  checks.push(['Color', io.env.NO_COLOR !== undefined ? 'disabled (NO_COLOR)' : io.isTTY ? 'available' : 'disabled (no TTY)']);
  const ready = coreOk && nodeMajor >= 18;
  checks.push(['Demo readiness', ready ? 'ready' : 'NOT READY']);
  return {
    lines: ['RELAY DOCTOR', ...checks.map(([k, v]) => `  ${k.padEnd(28)} ${v}`)],
    exitCode: ready ? EXIT.completed : EXIT.doctorFailure,
  };
}

/* --------------------------- claude commands ----------------------- */

async function runClaudeCli(parsed: ParsedCli, io: CliIo): Promise<number> {
  const now = () => new Date().toISOString();
  const out = (...lines: string[]) => lines.forEach((line) => io.out(line));

  if (parsed.claudeAction === 'doctor') {
    const report = claudeDoctorReport(now());
    if (parsed.json) io.out(JSON.stringify({ report: report.lines.slice(1), exitCode: report.exitCode }));
    else report.lines.forEach((line) => io.out(line));
    return report.exitCode;
  }

  if (parsed.claudeAction === 'contract-verify') {
    io.out('RELAY CLAUDE ADAPTER CONTRACT VERIFICATION (offline — no provider call)');
    const { checks, failures } = await runClaudeContractVerification();
    for (const check of checks) io.out(`  [${check.ok ? 'PASS' : 'FAIL'}] ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
    if (failures > 0) {
      io.out(`\nCLAUDE CONTRACT VERIFICATION FAILED: ${failures} check(s).`);
      return EXIT.doctorFailure;
    }
    io.out('\nCLAUDE CONTRACT VERIFICATION PASSED — adapter proven with no provider call.');
    return EXIT.completed;
  }

  if (parsed.claudeAction === 'inspect' || parsed.claudeAction === 'cancel') {
    // Live sessions are volatile and process-local: a fresh CLI process has
    // no active live run to inspect or cancel. Reported truthfully.
    io.out(parsed.claudeAction === 'inspect'
      ? 'No active live Claude run in this process (live sessions are volatile and not durably stored).'
      : 'No active live Claude run to cancel in this process.');
    return EXIT.completed;
  }

  // claudeAction === 'run': the explicit live proof.
  const fixture = parsed.fixture ?? 'safe-edit';
  if (fixture !== 'safe-edit') {
    io.out(`Only the "safe-edit" fixture is supported for the live proof (got "${fixture}").`);
    return EXIT.usage;
  }
  const caps = probeClaudeCapabilities(now());
  const auth = classifyClaudeAuth(now(), caps.executablePath);

  const prereq = checkLivePrerequisites({
    capabilities: caps, authApproved: auth.approvedForLiveRun, authLoggedIn: auth.loggedIn,
    authSourceClass: auth.sourceClass, settingsRisk: 'clean', approvalGranted: parsed.confirmLive,
  });
  const turnLimitLine = `  unlimited (bounded by ${Math.round(DEFAULT_LIVE_LIMITS.maxRuntimeMs / 60_000)}-minute runtime and output limits)`;
  if (!prereq.ready) {
    // Manual Task-shaped stop — simple steps, no live call, no secrets.
    out('MANUAL TASK', '', 'Relay needs your help.', '', prereq.manualTitle, '',
      'Why Relay stopped:', `  ${prereq.manualReason}`);
    if (!parsed.confirmLive && caps.executablePath && auth.approvedForLiveRun) {
      // The pre-confirmation screen states exactly what the confirmed run will
      // do — including what becomes of the evidence — so the founder approves
      // the run they are actually about to get.
      out('', 'LIVE CLAUDE CODE RUN', '',
        'This will use your existing Claude Code account.', '',
        'Workspace:', '  Isolated Relay worktree',
        'Source repository:', '  Will not be modified',
        'Deployment:', '  Disabled', 'Git push:', '  Prohibited',
        'Maximum agent turns:', turnLimitLine,
        'Files Claude may change:', '  src/normalize.js',
        'Requested model:', `  ${parsed.model ?? 'account default (none requested)'}`,
        'Evidence after the run:', `  ${parsed.preserveEvidence ? 'preserved for inspection' : 'removed'}`, '',
        'To proceed, re-run with --confirm-live (approval is never inferred from a TTY).');
    }
    return EXIT.checkpointRequired;
  }

  // Approved live run — show the confirmation screen, then run for real.
  out('LIVE CLAUDE CODE RUN', '',
    'This will use your existing Claude Code account.', '',
    'Workspace:', '  Isolated Relay worktree',
    'Source repository:', '  Will not be modified',
    'Deployment:', '  Disabled', 'Git push:', '  Prohibited',
    'Maximum agent turns:', turnLimitLine,
    'Files Claude may change:', '  src/normalize.js',
    'Requested model:', `  ${parsed.model ?? 'account default (none requested)'}`,
    'Evidence after the run:', `  ${parsed.preserveEvidence ? 'preserved for inspection' : 'removed'}`, '',
    'Confirmed via --confirm-live.');

  const proof = await runClaudeProof({
    executablePath: caps.executablePath!, capabilities: caps, now, ids: createRandomIdFactory(),
    requestedModel: parsed.model ?? null,
    preserveEvidence: parsed.preserveEvidence === true,
  });

  // Persist the receipt. This is the COMPOSITION ROOT: the adapter reported
  // what it observed and may not import the mission layer, so the CLI maps
  // those observations onto the canonical record and writes it. A receipt
  // that cannot be written is REPORTED as unwritten — never silently skipped,
  // and never allowed to change the proof's own exit code.
  const receipt = await writeCodingAgentReceipt(parsed, io, proof, caps);

  if (parsed.json) {
    io.out(JSON.stringify({
      exitCode: proof.exitCode, sessionCaptured: proof.sessionCaptured,
      filesChanged: proof.filesChanged, protectedChanges: proof.protectedChanges,
      inspectionAssessment: proof.inspectionAssessment, sourceUnchanged: proof.sourceUnchanged,
      verificationPassed: proof.verificationPassed, completionOutcome: proof.completionOutcome,
      // Requested and actual stay separate all the way into the JSON.
      requestedModel: proof.identity.requestedModel,
      actualModel: proof.identity.actualModel,
      actualRuntime: proof.identity.actualRuntime,
      runtimeVersion: proof.identity.runtimeVersion,
      launchVerified: proof.identity.launchVerified,
      sessionRefRedacted: proof.identity.sessionRefRedacted,
      turns: proof.identity.turns,
      reportedCostUsd: proof.identity.reportedCostUsd,
      filesInspected: proof.scope.filesInspected,
      toolsUsed: proof.scope.toolsUsed,
      scopeEscapes: proof.scope.escapes,
      scopeContained: proof.scope.contained,
      unifiedDiff: proof.unifiedDiff,
      preservedWorkspacePath: proof.preservedWorkspacePath,
      preservedFixturePath: proof.preservedFixturePath,
      stopReason: proof.stopReason,
      receipt,
      audit: proof.audit,
    }));
  } else {
    proof.lines.forEach((line) => io.out(line));
    if (proof.unifiedDiff !== null && proof.unifiedDiff.trim() !== '') {
      out('', 'RESULTING DIFF (read by Relay from the isolated worktree)');
      proof.unifiedDiff.split('\n').forEach((line) => io.out(`  ${line}`));
    }
    out('', 'PATHS INSPECTED (reported by the runtime, all inside the workspace)');
    if (proof.scope.filesInspected.length === 0) out('  None recorded');
    else proof.scope.filesInspected.forEach((f) => io.out(`  ${f}`));
    out('', 'RECEIPT', `  ${receipt.message}`);
  }
  return proof.exitCode;
}

/**
 * Write the durable Coding Agent receipt for one live proof.
 *
 * The mission id defaults to the redacted session reference so the founder can
 * read the run back with `relay mission coding-agent status <id>`; `--project`
 * overrides it. The write is best-effort BY DESIGN: a proof that really ran
 * must not be reported as failed because a state directory was unwritable, but
 * the failure is always stated.
 */
async function writeCodingAgentReceipt(
  parsed: ParsedCli,
  io: CliIo,
  proof: Awaited<ReturnType<typeof runClaudeProof>>,
  caps: ReturnType<typeof probeClaudeCapabilities>,
): Promise<{ written: boolean; missionId: string | null; location: string | null; message: string }> {
  const missionId = (parsed.projectRef ?? '').trim() !== ''
    ? (parsed.projectRef as string).trim()
    : `claude-live-proof-${(proof.sessionCaptured ?? 'unknown').slice(-8)}`;

  const root = resolveStateRoot(io.env as Record<string, string | undefined>, parsed.stateRoot);
  if (!root.ok) {
    return { written: false, missionId, location: null, message: `Receipt NOT written: ${root.error.message}` };
  }

  const availability = inspectClaudeRuntime(new Date().toISOString());
  // Relay only reaches its verification command once its own inspection has
  // accepted the change; before that, no test was attempted at all.
  const verificationAttempted = proof.inspectionAssessment === 'allowed';
  const draft = runtimeRecordFromObservation({
    missionId,
    projectId: 'relay-coding-agent-live-proof',
    requestedRuntime: 'Claude Code',
    requestedModel: proof.identity.requestedModel,
    adapterId: CLAUDE_ADAPTER_ID,
    actualRuntime: proof.identity.actualRuntime,
    actualModel: proof.identity.actualModel,
    runtimeVersion: proof.identity.runtimeVersion ?? caps.version,
    launchVerified: proof.identity.launchVerified,
    runId: proof.audit?.runId ?? null,
    sessionRefRedacted: proof.identity.sessionRefRedacted,
    capabilities: availability.capabilities,
    worktreeRef: proof.preservedWorkspacePath,
    startedAt: proof.startedAt,
    endedAt: proof.endedAt,
    exitCode: proof.exitCodeObserved,
    signal: proof.signal,
    cancellationRequested: proof.cancelled,
    timedOut: proof.timedOut,
    terminationConfirmed: proof.terminationConfirmed,
    spawnFailed: proof.spawnFailed,
    filesChanged: proof.filesChanged,
    filesInspected: proof.scope.filesInspected,
    // Relay runs exactly one verification command, and only once its own
    // inspection has passed. It counts as COMPLETED only when Relay observed
    // it pass — but a command that ran and failed still ran, so the count and
    // the status must not disagree ("failed (0 run)" describes nothing).
    commandsStarted: verificationAttempted ? 1 : 0,
    commandsCompleted: proof.verificationPassed ? 1 : 0,
    testsRun: verificationAttempted ? 1 : 0,
    testStatus: proof.verificationPassed ? 'passed' : verificationAttempted ? 'failed' : 'not_run',
    outputRefs: [],
    evidenceRefs: proof.evidence.map((e) => e.evidenceId as unknown as string),
    warnings: [...proof.scope.escapes],
    usage: usageFromRuntimeReport({
      // This CLI reports turns and cost, not token counts; unknown stays null
      // rather than becoming zero.
      inputTokens: null,
      outputTokens: null,
      reportedCostUsd: proof.identity.reportedCostUsd,
    }),
    stopReason: proof.stopReason,
    now: new Date().toISOString(),
  });

  const store = createNodeCodingAgentStore(root.value.root);
  const written = await store.write(draft);
  if (!written.ok) {
    return {
      written: false, missionId, location: store.locationLabel,
      message: `Receipt NOT written: ${written.reason ?? 'unknown error'}`,
    };
  }
  return {
    written: true, missionId, location: store.locationLabel,
    message: `Saved. Read it back with: relay mission coding-agent status ${missionId}`,
  };
}

/* --------------------------- codex commands ------------------------ */

async function runCodexCli(parsed: ParsedCli, io: CliIo): Promise<number> {
  const now = () => new Date().toISOString();
  const out = (...lines: string[]) => lines.forEach((line) => io.out(line));

  if (parsed.codexAction === 'doctor') {
    const report = codexDoctorReport(now());
    if (parsed.json) io.out(JSON.stringify({ report: report.lines.slice(1), exitCode: report.exitCode }));
    else report.lines.forEach((line) => io.out(line));
    return report.exitCode;
  }

  if (parsed.codexAction === 'contract-verify') {
    io.out('RELAY CODEX REVIEWER CONTRACT VERIFICATION (offline — no provider call)');
    const { checks, failures } = await runCodexReviewerContractVerification();
    for (const check of checks) io.out(`  [${check.ok ? 'PASS' : 'FAIL'}] ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
    if (failures > 0) {
      io.out(`\nCODEX CONTRACT VERIFICATION FAILED: ${failures} check(s).`);
      return EXIT.doctorFailure;
    }
    io.out('\nCODEX CONTRACT VERIFICATION PASSED — reviewer proven with no provider call.');
    return EXIT.completed;
  }

  if (parsed.codexAction === 'inspect' || parsed.codexAction === 'cancel') {
    io.out(parsed.codexAction === 'inspect'
      ? 'No active live Codex review in this process (reviewer sessions are volatile and not durably stored).'
      : 'No active live Codex review to cancel in this process.');
    return EXIT.completed;
  }

  // codexAction === 'run': the explicit live independent review.
  const fixture = parsed.fixture ?? 'review-defect';
  if (fixture !== 'review-defect') {
    io.out(`Only the "review-defect" fixture is supported for the live review (got "${fixture}").`);
    return EXIT.usage;
  }
  const caps = probeCodexCapabilities(now());
  const auth = classifyCodexAuth(now(), caps.executablePath);
  // The trusted Relay fixture supplies no hooks/plugins/MCP/custom provider.
  const configRisk = 'clean' as const;

  const prereq = checkReviewPrerequisites({
    capabilities: caps, authApproved: auth.approvedForLiveReview, authStatus: auth.status,
    configRisk, approvalGranted: parsed.confirmLive,
  });

  const reviewScreen = (footer: string): void => {
    out('LIVE CODEX REVIEW', '',
      'This will use your existing local Codex account.', '',
      'Role:', '  Independent Coding Reviewer',
      'Workspace:', '  Isolated Relay worktree',
      'Access:', '  Read only',
      'Files Codex may modify:', '  None',
      'Source repository:', '  Will not be modified',
      'Deployment:', '  Disabled', 'Git push:', '  Prohibited',
      'Fallback Reviewer:', '  Disabled',
      'Expected live calls:', '  1', '',
      footer);
  };

  if (!prereq.ready) {
    // Manual Task-shaped stop — simple steps, no live call, no secrets, never
    // an API key. Sign-in help mirrors the required Manual Task copy.
    out('MANUAL TASK', '', 'Relay needs your help.', '', prereq.manualTitle, '',
      'Why Relay stopped:', `  ${prereq.manualReason}`);
    if (prereq.manualTitle === 'Sign in to Codex') {
      out('', 'Do this:', '  1. Open a new terminal.', '  2. Type `codex`.',
        '  3. Complete the sign-in steps.', '  4. Close Codex when sign-in is finished.',
        '  5. Return to Relay.', '  6. Choose "Done."', '',
        'What Relay will do next:', '  Relay will check Codex again before starting the review.',
        '', 'Do not paste an API key into Relay.');
    }
    if (!parsed.confirmLive && caps.executablePath && auth.approvedForLiveReview && caps.readOnlySandboxSupported) {
      reviewScreen('To proceed, re-run with --confirm-live (approval is never inferred from a TTY).');
    }
    return EXIT.checkpointRequired;
  }

  // Approved live review — show the confirmation screen, then run for real.
  reviewScreen('Confirmed via --confirm-live.');

  const proof = await runCodexReviewProof({
    executablePath: caps.executablePath!, capabilities: caps, now, ids: createRandomIdFactory(),
  });
  if (parsed.json) {
    io.out(JSON.stringify({
      exitCode: proof.exitCode, reviewId: proof.reviewId, sessionCaptured: proof.sessionCaptured,
      launchVerified: proof.launchVerified, requestedReviewer: proof.requestedReviewer,
      actualReviewer: proof.actualReviewer, reviewerIndependent: proof.reviewerIndependent,
      preInspectionAssessment: proof.preInspectionAssessment, postInspectionAssessment: proof.postInspectionAssessment,
      reviewerFileChanges: proof.reviewerFileChanges, sourceUnchanged: proof.sourceUnchanged,
      verdict: proof.verdict, blockingFindings: proof.blockingFindings, outputVisibility: proof.outputVisibility,
      fallbackOccurred: proof.fallbackOccurred, cleanupOutcome: proof.cleanupOutcome,
    }));
  } else {
    proof.lines.forEach((line) => io.out(line));
  }
  return proof.exitCode;
}

/* ------------------------- supervised commands --------------------- */

async function runSupervisedCli(parsed: ParsedCli, io: CliIo): Promise<number> {
  const now = () => new Date().toISOString();
  const out = (...lines: string[]) => lines.forEach((line) => io.out(line));

  if (parsed.supervisedAction === 'contract-verify') {
    io.out('RELAY SUPERVISED WORKFLOW CONTRACT VERIFICATION (offline — no provider call)');
    const { checks, failures } = await runSupervisedContractVerification();
    for (const check of checks) io.out(`  [${check.ok ? 'PASS' : 'FAIL'}] ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
    if (failures > 0) {
      io.out(`\nSUPERVISED CONTRACT VERIFICATION FAILED: ${failures} check(s).`);
      return EXIT.doctorFailure;
    }
    io.out('\nSUPERVISED CONTRACT VERIFICATION PASSED — full workflow proven with no provider call.');
    io.out('\nREADY FOR LIVE SUPERVISED WORKFLOW');
    return EXIT.completed;
  }

  // supervisedAction === 'run': the explicit founder-initiated live workflow.
  const fixture = parsed.fixture ?? 'safe-edit';
  if (fixture !== 'safe-edit') {
    io.out(`Only the "safe-edit" fixture is supported for the supervised live workflow (got "${fixture}").`);
    return EXIT.usage;
  }
  const claudeCaps = probeClaudeCapabilities(now());
  const claudeAuth = classifyClaudeAuth(now(), claudeCaps.executablePath);
  const codexCaps = probeCodexCapabilities(now());
  const codexAuth = classifyCodexAuth(now(), codexCaps.executablePath);

  const prereq = checkSupervisedPrerequisites({
    claude: {
      capabilities: claudeCaps, authApproved: claudeAuth.approvedForLiveRun,
      authLoggedIn: claudeAuth.loggedIn, authSourceClass: claudeAuth.sourceClass,
      settingsRisk: 'clean', approvalGranted: parsed.confirmLive,
    },
    codex: {
      capabilities: codexCaps, authApproved: codexAuth.approvedForLiveReview,
      authStatus: codexAuth.status, configRisk: 'clean', approvalGranted: parsed.confirmLive,
    },
  });

  const workflowScreen = (footer: string): void => {
    out('LIVE SUPERVISED WORKFLOW', '',
      'This will use your existing local Claude Code and Codex accounts.', '',
      'Implementer:', '  Claude Code (live)',
      'Reviewer:', '  Codex (live, independent, read only)',
      'Workspace:', '  Isolated Relay worktree',
      'Source repository:', '  Will not be modified',
      'Deployment:', '  Disabled', 'Git push:', '  Prohibited',
      'Fallback:', '  Disabled',
      'Fault injection:', '  None — every verdict is the reviewer\'s genuine report',
      'Repairs:', '  At most ONE bounded repair, only on a genuine reviewer finding',
      'Expected live calls:', '  2 (implementation + review); up to 4 with one repair cycle',
      'Files Claude may change:', '  src/normalize.js', '',
      footer);
  };

  if (!prereq.ready) {
    out('MANUAL TASK', '', 'Relay needs your help.', '', prereq.manualTitle, '',
      'Why Relay stopped:', `  ${prereq.manualReason}`);
    const bothOtherwiseReady = !parsed.confirmLive &&
      claudeCaps.executablePath && claudeAuth.approvedForLiveRun &&
      codexCaps.executablePath && codexAuth.approvedForLiveReview && codexCaps.readOnlySandboxSupported;
    if (bothOtherwiseReady) {
      workflowScreen('To proceed, re-run with --confirm-live (approval is never inferred from a TTY).');
    }
    return EXIT.checkpointRequired;
  }

  workflowScreen('Confirmed via --confirm-live.');

  // Prompt 8.5: live supervised runs persist durably to the local state root
  // (journal + snapshots), so a crash is recoverable via `relay runs recover`.
  const stateRoot = resolveStateRoot(io.env as Record<string, string | undefined>, parsed.stateRoot);
  if (!stateRoot.ok) {
    io.out(`Durable state root unavailable: ${stateRoot.error.message}`);
    return EXIT.doctorFailure;
  }
  const recorder = createSupervisedRunRecorder({
    store: createStateStore({ root: stateRoot.value.root }), now,
  });
  let proof;
  try {
    proof = await runSupervisedProof({
      claude: { executablePath: claudeCaps.executablePath!, capabilities: claudeCaps },
      codex: { executablePath: codexCaps.executablePath!, capabilities: codexCaps },
      now, ids: createRandomIdFactory(), persistence: recorder,
    });
  } finally {
    recorder.release();
  }
  if (parsed.json) {
    io.out(JSON.stringify({
      exitCode: proof.exitCode, path: proof.path, stopReason: proof.stopReason,
      claudeSessionCaptured: proof.claudeSessionCaptured, codexSessionCaptured: proof.codexSessionCaptured,
      claudeInvocations: proof.claudeInvocations, codexInvocations: proof.codexInvocations,
      reviewVerdicts: proof.reviewVerdicts, reviewerIndependent: proof.reviewerIndependent,
      filesChanged: proof.filesChanged, protectedChanges: proof.protectedChanges,
      verificationsPassed: proof.verificationsPassed, repairDispatched: proof.repairDispatched,
      findings: proof.findings, repairs: proof.repairs, outputVisibility: proof.outputVisibility,
      completionOutcome: proof.completionOutcome, sourceUnchanged: proof.sourceUnchanged,
      audit: proof.audit,
    }));
  } else {
    proof.lines.forEach((line) => io.out(line));
  }
  return proof.exitCode;
}

/* ------------------- durable state / runs / recovery ---------------- */

function resolveCliStateRoot(parsed: ParsedCli, io: CliIo): { root: string } | { error: string } {
  const resolved = resolveStateRoot(io.env as Record<string, string | undefined>, parsed.stateRoot);
  if (!resolved.ok) return { error: resolved.error.message };
  return { root: resolved.value.root };
}

function runStateCli(parsed: ParsedCli, io: CliIo): number {
  const report = stateDoctorReport({
    env: io.env as Record<string, string | undefined>,
    overrideRoot: parsed.stateRoot, now: new Date().toISOString(),
  });
  if (parsed.json) io.out(JSON.stringify({ report: report.lines.slice(1), exitCode: report.exitCode }));
  else report.lines.forEach((line) => io.out(line));
  return report.exitCode === 0 ? EXIT.completed : EXIT.doctorFailure;
}

function runRunsCli(parsed: ParsedCli, io: CliIo): number {
  const rootResult = resolveCliStateRoot(parsed, io);
  if ('error' in rootResult) { io.out(rootResult.error); return EXIT.doctorFailure; }
  const store = createStateStore({ root: rootResult.root });
  const now = () => new Date().toISOString();

  if (parsed.runsAction === 'list') {
    const runs = store.listRuns();
    if (parsed.json) { io.out(JSON.stringify({ runs })); return EXIT.completed; }
    io.out('PERSISTED RELAY RUNS');
    if (runs.length === 0) { io.out('  (none)'); return EXIT.completed; }
    for (const run of runs) {
      io.out(`  ${run.displayName.padEnd(32).slice(0, 32)} ${run.lifecycle.padEnd(20)} ${run.phase.padEnd(16)} ${run.updatedAt}` +
        `${run.archived ? '  [archived]' : ''}${run.recoveryRequired ? '  [RECOVERY REQUIRED]' : ''}`);
    }
    return EXIT.completed;
  }

  const runRef = parsed.runRef!;
  if (parsed.runsAction === 'archive') {
    const archived = store.archiveRun(runRef, now());
    io.out(archived.ok ? 'Run archived (evidence preserved; still inspectable).' : archived.error.message);
    return archived.ok ? EXIT.completed : EXIT.doctorFailure;
  }

  // inspect (read-only) and recover (validation + replay + reconciliation +
  // plan). NEITHER makes any provider call.
  const report = recoverRun({ store, reference: runRef, now, persistMarkers: parsed.runsAction === 'recover' });
  if (!report.ok) { io.out(report.error.message); return EXIT.doctorFailure; }
  const value = report.value;
  const state = value.loaded?.state ?? null;
  if (parsed.json) {
    io.out(JSON.stringify({
      runRef, plan: value.plan, lifecycle: state?.run.lifecycle ?? null,
      quarantined: value.quarantined, projectionEvents: value.projectionEvents,
    }));
    return value.plan.outcome === 'unrecoverable' ? EXIT.doctorFailure : EXIT.completed;
  }
  io.out(parsed.runsAction === 'recover' ? 'RELAY RUN RECOVERY (zero provider calls)' : 'RELAY RUN INSPECTION');
  io.out(`  Mission:                ${state?.mission.objective ?? '(unavailable)'}`);
  io.out(`  Lifecycle:              ${state?.run.lifecycle ?? 'corrupted'}`);
  io.out(`  Phase:                  ${state?.run.phase ?? '-'}`);
  io.out(`  Output visibility:      ${state?.run.outputVisibility ?? '-'}`);
  io.out(`  Workspace:              ${value.plan.workspaceReconciliation}`);
  io.out(`  Evidence:               ${state?.evidence.length ?? 0} record(s), ${value.plan.staleEvidenceIds.length} stale`);
  io.out(`  Open findings:          ${value.plan.openFindingIds.join(', ') || 'none'}`);
  io.out(`  Pending repairs:        ${value.plan.pendingRepairIds.join(', ') || 'none'}`);
  io.out(`  Calls consumed:         ${value.plan.callBudget.consumed} of ${value.plan.callBudget.maxCalls}` +
    ` (${value.plan.callBudget.remaining} remaining)`);
  for (const [provider, readiness] of Object.entries(value.plan.sessionReadiness)) {
    // Readiness classification only — raw provider session ids are never shown.
    io.out(`  ${`${provider} session:`.padEnd(24)}${readiness}`);
  }
  io.out(`  Recovery plan:          ${value.plan.outcome}`);
  for (const action of value.plan.nextPermittedActions) io.out(`    → ${action}`);
  io.out('  Live calls:             require explicit founder authorization (never automatic after restart)');
  for (const diagnostic of value.plan.diagnostics.slice(0, 6)) io.out(`  note: ${diagnostic}`);
  return value.plan.outcome === 'unrecoverable' ? EXIT.doctorFailure : EXIT.completed;
}

async function runPersistenceCli(parsed: ParsedCli, io: CliIo): Promise<number> {
  if (parsed.persistenceAction === 'contract-verify') {
    io.out('RELAY PERSISTENCE CONTRACT VERIFICATION (offline — separate Node processes, no provider call)');
    const { checks, failures, processesSpawned } = await runPersistenceContractVerification();
    for (const check of checks) io.out(`  [${check.ok ? 'PASS' : 'FAIL'}] ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
    io.out(`  (scenario steps ran across ${processesSpawned} separate Node processes)`);
    if (failures > 0) {
      io.out(`\nPERSISTENCE CONTRACT VERIFICATION FAILED: ${failures} check(s).`);
      return EXIT.doctorFailure;
    }
    io.out('\nPERSISTENCE CONTRACT VERIFICATION PASSED — durable state and cross-process recovery proven with no provider call.');
    return EXIT.completed;
  }
  // recovery-drill (Gate B — offline, two processes, zero provider calls)
  const drill = await runRecoveryDrill();
  drill.lines.forEach((line) => io.out(line));
  return drill.exitCode === 0 ? EXIT.completed : EXIT.doctorFailure;
}

/* ------------------------ product shell commands -------------------- */

function productCaps(parsed: ParsedCli, io: CliIo): ReturnType<typeof detectCaps> {
  return detectCaps({
    argv: {
      'no-color': parsed.noColor, plain: parsed.plain, json: parsed.json,
      'reduced-motion': parsed.reducedMotion === true, compact: parsed.compact,
    },
    env: io.env as Record<string, string | undefined>,
    isTTY: io.isTTY && process.stdin.isTTY === true,
    columns: process.stdout.columns,
  });
}

async function runProductCli(parsed: ParsedCli, io: CliIo): Promise<number> {
  const caps = productCaps(parsed, io);

  if (parsed.command === 'cli') {
    if (parsed.cliAction === 'contract-verify') {
      io.out('RELAY CLI PRODUCT CONTRACT VERIFICATION (offline — fixtures, isolated state root, no provider call)');
      const { checks, failures } = await runCliContractVerification(parseCli as never);
      for (const check of checks) io.out(`  [${check.ok ? 'PASS' : 'FAIL'}] ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
      if (failures > 0) {
        io.out(`\nCLI CONTRACT VERIFICATION FAILED: ${failures} check(s).`);
        return EXIT.doctorFailure;
      }
      io.out('\nCLI CONTRACT VERIFICATION PASSED — terminal product proven with no provider call.');
      return EXIT.completed;
    }
    // cli demo — OFFLINE, fake adapters, isolated temp state root.
    const demo = await runCliDemo({ caps, plain: parsed.plain || parsed.json || !caps.tty });
    demo.lines.forEach((line) => io.out(line));
    return demo.exitCode;
  }

  const rootResult = resolveStateRoot(io.env as Record<string, string | undefined>, parsed.stateRoot);
  if (!rootResult.ok) { io.out(rootResult.error.message); return EXIT.doctorFailure; }
  const store = createStateStore({ root: rootResult.value.root });
  const emit = (result: { lines: string[]; json?: unknown; exitCode: number }): number => {
    if (parsed.json) io.out(JSON.stringify(result.json ?? { lines: result.lines }));
    else result.lines.forEach((line) => io.out(line));
    return result.exitCode;
  };
  // Read-only commands honor --watch (live re-render in a TTY, Ctrl+C to
  // leave) and --once (a single deterministic snapshot). --once is already the
  // default for these, so it is only meaningful at the interactive entrypoints.
  const respond = (produce: () => { lines: string[]; json?: unknown; exitCode: number }): number | Promise<number> =>
    (parsed.watch && caps.tty && !parsed.json && !parsed.plain ? runProductWatch(produce, emit) : emit(produce()));

  if (parsed.command === 'home') return respond(() => productHome(store, caps));
  if (parsed.command === 'projects') return respond(() => productProjects(store, caps));
  if (parsed.command === 'recover') return respond(() => productRecover(store, caps, parsed.runRef));

  // relay project <action>
  switch (parsed.projectAction) {
    case 'new':
    case 'open':
    case 'terminal': {
      // --once (or a non-TTY / plain / json context) prints a single snapshot
      // instead of opening the interactive shell.
      if (!caps.tty || parsed.json || parsed.plain || parsed.once) {
        if (parsed.projectAction === 'new') {
          io.out('`relay project new` is interactive. Run it in a TTY to open the draft flow.');
          return caps.tty && parsed.once ? EXIT.completed : EXIT.usage;
        }
        return respond(() => productProjectStatus(store, caps, parsed.projectRef));
      }
      const data = loadAppData(store);
      const selected = parsed.projectAction === 'new' ? null : findProjectRecord(store, parsed.projectRef);
      const initialScreen = parsed.projectAction === 'new' ? 'new-project'
        : parsed.projectAction === 'terminal' ? 'console' : 'project';
      return runProductShell({
        caps, data, store, playbackMs: 0, now: () => new Date().toISOString(),
        initialScreen, selectedProjectId: selected?.projectId ?? null,
      });
    }
    case 'status':
      return respond(() => productProjectStatus(store, caps, parsed.projectRef));
    case 'settings':
    case 'workforce':
    case 'research':
    case 'tasks':
    case 'findings':
    case 'repairs':
    case 'evidence':
    case 'history':
      return respond(() => productProjectView(store, caps, parsed.projectAction as ProjectView, parsed.projectRef));
    case 'run':
      return emit(productRunConfirmation(store, caps, parsed.projectRef));
    default:
      io.out('Unknown project action.');
      return EXIT.usage;
  }
}

/* --------------------------- yc demo commands ----------------------- */

/* ------------------------- PSP Agent ID import ------------------------- */

/**
 * Read a line from the terminal WITHOUT echoing it. Raw mode is entered for
 * the duration of the read and restored on every exit path, including Ctrl+C
 * and a thrown error, so a credential can never appear on screen and the
 * terminal can never be left in raw mode.
 *
 * Returns null when echo cannot be suppressed — the caller then refuses to ask
 * for the credential at all rather than asking for it in the clear.
 */
async function readHiddenLine(prompt: string): Promise<string | null> {
  const input = process.stdin;
  const output = process.stdout;
  if (input.isTTY !== true || typeof input.setRawMode !== 'function') return null;

  return new Promise<string | null>((resolve) => {
    let buffer = '';
    let settled = false;
    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      input.removeListener('data', onData);
      try { input.setRawMode(false); } catch { /* terminal already restored */ }
      input.pause();
      output.write('\n');
      resolve(value);
    };

    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { finish(buffer); buffer = ''; return; }
        if (ch === '\x03') { finish(null); buffer = ''; return; }   // Ctrl+C
        if (ch === '\x7f' || ch === '\b') { buffer = buffer.slice(0, -1); continue; }
        // Control characters are dropped; nothing is ever echoed back.
        if (ch >= ' ') buffer += ch;
      }
    };

    input.on('data', onData);
  });
}

/** Read a plain confirmation line (echoed — it is not a secret). */
async function readConfirmation(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(prompt, resolve));
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function readAllStdin(): Promise<string> {
  const chunks: string[] = [];
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) chunks.push(chunk as string);
  return chunks.join('');
}

/**
 * MISSION ECONOMICS on the terminal. Renders the SAME shared projection the
 * website renders, so both surfaces state the same mission truth. Read-only:
 * it evaluates and prints, and never spends, mutates a budget, or calls a
 * provider. A budget CHANGE goes through the validated change_budget command.
 */
async function runMissionCli(parsed: ParsedCli, io: CliIo): Promise<number> {
  const render = detectRenderOptions(parsed, io.env, io.isTTY);
  if (parsed.error) {
    io.out(parsed.error);
    return EXIT.usage;
  }

  // THERE IS NO LIVE MISSION ECONOMICS SOURCE IN THIS BUILD. These commands
  // render a deterministic development fixture, and every renderer below
  // carries that disclosure — derived from the receipts' own
  // `development_fixture` source, so it cannot be dropped here. When a live
  // source lands, the same renderers will show no banner, because the data
  // will genuinely be live.
  const fixture = buildMissionEconomicsFixture();
  const options = { width: render.width ?? 80, plain: render.plain === true };

  switch (parsed.missionAction) {
    case 'economics':
      for (const line of renderMissionEconomics(fixture.projection, options)) io.out(line);
      return EXIT.completed;
    case 'budget':
      for (const line of renderMissionBudget(fixture.projection, fixture.evaluation, options)) {
        io.out(line);
      }
      return EXIT.completed;
    case 'receipts':
      for (const line of renderMissionReceipts(fixture.receipts, options)) io.out(line);
      return EXIT.completed;
    case 'worktree':
      return await runMissionWorktreeCli(parsed, io);
    case 'coding-agent':
      return await runMissionCodingAgentCli(parsed, io);
    case 'prompt-architect':
      return await runMissionArchitectCli(parsed, io);
    case 'reviewer':
      return await runMissionReviewerCli(parsed, io);
    default:
      io.out('mission requires an action: economics, budget, receipts, worktree, coding-agent, prompt-architect, or reviewer.');
      return EXIT.usage;
  }
}

/**
 * `relay mission worktree status|inspect <mission-id>` — READ-ONLY.
 *
 * Prints the SAME projection the website's Coding Agent Environment
 * inspector renders, so the two surfaces cannot disagree. Creation and
 * removal are deliberately NOT exposed here: they are internal APIs in this
 * milestone, and there is no raw-git passthrough at all.
 */
async function runMissionWorktreeCli(parsed: ParsedCli, io: CliIo): Promise<number> {
  const missionId = parsed.missionRef;
  if (missionId === undefined || missionId.trim() === '') {
    io.out('mission worktree requires a mission id.');
    return EXIT.usage;
  }
  const root = resolveStateRoot(io.env as Record<string, string | undefined>, parsed.stateRoot);
  if (!root.ok) {
    io.out(root.error.message);
    return EXIT.usage;
  }
  const store = createNodeMissionWorktreeStore(root.value.root);
  const read = await store.read(missionId);

  if (!read.ok && read.reason !== 'not_found') {
    // A record Relay cannot trust is reported as such — never as "no
    // worktree", and never repaired silently.
    io.out(`MISSION WORKTREE — ${missionId}`);
    io.out(`  State:        Requires inspection (${read.reason})`);
    io.out(`  Detail:       ${read.detail}`);
    return EXIT.blocked;
  }

  const view = projectMissionWorktree(read.ok ? read.record : null);
  for (const line of renderWorktreeStatusLines(missionId, view)) io.out(line);

  if (parsed.worktreeMode === 'inspect' && read.ok) {
    io.out('  Validation:');
    for (const found of read.record.validationFindings) {
      io.out(`    [${found.ok ? 'PASS' : 'FAIL'}] ${found.check} — ${found.detail}`);
    }
    // The full path appears ONLY in the explicit detail view.
    io.out(`  Full path:    ${read.record.worktreePath}`);
  }
  return EXIT.completed;
}

/**
 * `relay mission coding-agent status|inspect|stop <mission-id>`.
 *
 * Prints the SAME projection the website's Coding Agent panel renders. There
 * is no raw Claude CLI passthrough: `stop` records a cancellation REQUEST
 * against the durable record — it never reaches into a process this command
 * cannot prove it owns.
 */
async function runMissionCodingAgentCli(parsed: ParsedCli, io: CliIo): Promise<number> {
  const missionId = parsed.missionRef;
  if (missionId === undefined || missionId.trim() === '') {
    io.out('mission coding-agent requires a mission id.');
    return EXIT.usage;
  }
  const root = resolveStateRoot(io.env as Record<string, string | undefined>, parsed.stateRoot);
  if (!root.ok) {
    io.out(root.error.message);
    return EXIT.usage;
  }
  const store = createNodeCodingAgentStore(root.value.root);
  const read = await store.read(missionId);

  if (!read.ok && read.reason !== 'not_found') {
    io.out(`CODING AGENT — ${missionId}`);
    io.out(`  Connection:   Requires inspection (${read.reason})`);
    io.out(`  Detail:       ${read.detail}`);
    return EXIT.blocked;
  }

  if (parsed.codingAgentMode === 'stop') {
    if (!read.ok) {
      io.out(`No Coding Agent run is recorded for ${missionId}.`);
      return EXIT.usage;
    }
    // A stop REQUEST is recorded; termination is only ever confirmed by the
    // component that actually owns the process.
    const stopped = await store.write({
      ...codingAgentDraftFrom(read.record),
      cancellationRequested: true,
      updatedAt: new Date().toISOString(),
    });
    if (!stopped.ok) {
      io.out(`Could not record the stop request: ${stopped.reason ?? 'unknown error'}`);
      return EXIT.blocked;
    }
    io.out(`Stop requested for ${missionId}. Mission work and evidence are preserved.`);
    return EXIT.completed;
  }

  // The CLI runs on the machine, so it may report the REAL local runtime.
  const availability = inspectClaudeRuntime(new Date().toISOString());
  const view = projectCodingAgentRuntime(read.ok ? read.record : null, {
    bridgeAvailable: availability.installed,
  });
  for (const line of renderCodingAgentStatusLines(missionId, view)) io.out(line);

  if (parsed.codingAgentMode === 'inspect') {
    io.out('  Installed runtime:');
    io.out(`    executable:  ${availability.installed ? 'present' : 'not installed'}`);
    io.out(`    version:     ${availability.version ?? 'Unknown'}`);
    io.out(`    auth class:  ${availability.authClass}`);
    io.out(`    live run:    ${availability.authorizedForLiveRun ? 'authorized' : 'not authorized'}`);
    if (availability.blockedReason !== null) io.out(`    blocked:     ${availability.blockedReason}`);
    io.out('  Capabilities:');
    for (const [name, enabled] of Object.entries(availability.capabilities)) {
      io.out(`    [${enabled ? 'YES' : 'NO '}] ${name}`);
    }
  }
  return EXIT.completed;
}

/**
 * `relay mission prompt-architect status|inspect|stop <mission-id>`.
 *
 * Prints the SAME projection the website renders. `stop` records a
 * cancellation REQUEST; confirmation belongs to whatever owns the in-flight
 * request. There is no OpenAI request passthrough.
 */
async function runMissionArchitectCli(parsed: ParsedCli, io: CliIo): Promise<number> {
  const missionId = parsed.missionRef;
  if (missionId === undefined || missionId.trim() === '') {
    io.out('mission prompt-architect requires a mission id.');
    return EXIT.usage;
  }
  const root = resolveStateRoot(io.env as Record<string, string | undefined>, parsed.stateRoot);
  if (!root.ok) {
    io.out(root.error.message);
    return EXIT.usage;
  }
  const store = createNodePromptArchitectStore(root.value.root);
  const read = await store.read(missionId);

  if (!read.ok && read.reason !== 'not_found') {
    io.out(`PROMPT ARCHITECT — ${missionId}`);
    io.out(`  Connection:   Requires inspection (${read.reason})`);
    io.out(`  Detail:       ${read.detail}`);
    return EXIT.blocked;
  }

  if (parsed.architectMode === 'stop') {
    if (!read.ok) {
      io.out(`No Prompt Architect run is recorded for ${missionId}.`);
      return EXIT.usage;
    }
    const stopped = await store.write({
      ...architectDraftFrom(read.record),
      cancellationRequested: true,
      updatedAt: new Date().toISOString(),
    });
    if (!stopped.ok) {
      io.out(`Could not record the stop request: ${stopped.reason ?? 'unknown error'}`);
      return EXIT.blocked;
    }
    io.out(`Stop requested for ${missionId}. Any evidence already received is preserved.`);
    return EXIT.completed;
  }

  const config = readGptArchitectConfig(io.env as Record<string, string | undefined>);
  const readiness = evaluateReadiness(config);
  const view = projectPromptArchitect(read.ok ? read.record : null, {
    bridgeAvailable: readiness.ready,
  });
  for (const line of renderArchitectStatusLines(missionId, view)) io.out(line);

  if (parsed.architectMode === 'inspect') {
    io.out('  Server configuration:');
    // Presence only — the key value is never read into this output.
    io.out(`    API key:     ${config.apiKeyPresent ? 'present' : 'absent'}`);
    io.out(`    model:       ${config.model ?? 'not configured'}`);
    io.out(`    live mode:   ${config.liveMode ? 'enabled' : 'disabled'}`);
    io.out(`    max tokens:  ${config.maxOutputTokens}`);
    if (readiness.blockedReason !== null) io.out(`    blocked:     ${readiness.blockedReason}`);
  }
  return EXIT.completed;
}

/**
 * `relay mission reviewer status|inspect|stop <mission-id>`.
 *
 * Prints the SAME projection the website renders. No harness is startable
 * from here — no adapter exists for any catalog entry yet.
 */
async function runMissionReviewerCli(parsed: ParsedCli, io: CliIo): Promise<number> {
  const missionId = parsed.missionRef;
  if (missionId === undefined || missionId.trim() === '') {
    io.out('mission reviewer requires a mission id.');
    return EXIT.usage;
  }

  /**
   * THE LIVE PATH. `test-connection`, `start` and `retry` only exist against a
   * Relay Bridge, and `status`/`inspect`/`stop` prefer it when one is
   * configured — a configured bridge is the authority, and falling back to the
   * local record would report stale state as current.
   *
   * With no bridge configured, the existing local behaviour is untouched.
   */
  const bridgeConfigured = (io.env as Record<string, string | undefined>)[BRIDGE_URL_ENV] !== undefined
    && ((io.env as Record<string, string | undefined>)[BRIDGE_URL_ENV] ?? '').trim() !== '';
  const liveOnly = parsed.reviewerMode === 'test-connection'
    || parsed.reviewerMode === 'start' || parsed.reviewerMode === 'retry';
  if (liveOnly || (bridgeConfigured && parsed.reviewerMode !== undefined)) {
    return await runReviewerBridgeCli({
      mode: (parsed.reviewerMode ?? 'status') as 'status',
      missionId,
      json: parsed.json === true,
      authorize: parsed.authorize === true,
      harness: parsed.harness,
      model: parsed.model,
      generation: parsed.generation,
      idempotencyKey: parsed.idempotencyKey,
      priorRun: parsed.priorRun,
    }, { out: io.out, env: io.env as Record<string, string | undefined> });
  }
  const root = resolveStateRoot(io.env as Record<string, string | undefined>, parsed.stateRoot);
  if (!root.ok) {
    io.out(root.error.message);
    return EXIT.usage;
  }
  const store = createNodeReviewerHarnessStore(root.value.root);
  const read = await store.read(missionId);

  if (!read.ok && read.reason !== 'not_found') {
    io.out(`REVIEWER — ${missionId}`);
    io.out(`  Connection:   Needs inspection (${read.reason})`);
    io.out(`  Detail:       ${read.detail}`);
    return EXIT.blocked;
  }

  if (parsed.reviewerMode === 'stop') {
    if (!read.ok) {
      io.out(`No Reviewer run is recorded for ${missionId}.`);
      return EXIT.usage;
    }
    const stopped = await store.write({
      ...harnessDraftFrom(read.record),
      cancellationRequested: true,
      updatedAt: new Date().toISOString(),
    });
    if (!stopped.ok) {
      io.out(`Could not record the stop request: ${stopped.reason ?? 'unknown error'}`);
      return EXIT.blocked;
    }
    io.out(`Stop requested for ${missionId}. Findings and evidence are preserved.`);
    return EXIT.completed;
  }

  // No harness adapter exists yet, so no bridge can make one startable.
  const view = projectReviewerHarness(read.ok ? read.record : null, { bridgeAvailable: false });
  for (const line of renderReviewerStatusLines(missionId, view)) io.out(line);
  if (parsed.reviewerMode === 'inspect') {
    io.out('  Independence reasons:');
    for (const reason of view.independenceReasons) io.out(`    - ${reason}`);
  }
  return EXIT.completed;
}

/**
 * `relay reviewer pair-browser <origin>` — mint a one-time browser grant.
 *
 * This is the ONLY way a browser credential comes into existence, and it costs
 * the operator token to run. The grant is printed once, is single-use, expires
 * in a couple of minutes, and is bound to the exact origin given. The operator
 * token itself is never printed.
 */
async function runBrowserPairingCli(parsed: ParsedCli, io: CliIo): Promise<number> {
  const origin = parsed.pairOrigin;
  if (origin === undefined || origin.trim() === '') {
    io.out('reviewer pair-browser requires the exact browser origin, e.g. https://sunday-relay.vercel.app');
    return EXIT.usage;
  }
  const built = bridgeClientFrom({ out: io.out, env: io.env as Record<string, string | undefined> });
  if (!built.ok) {
    io.out(`  Blocked:      ${built.error.kind.replace(/_/g, ' ')}`);
    io.out(`  Detail:       ${built.error.message}`);
    return EXIT.blocked;
  }
  const result = await built.value.createBrowserPairing(origin.trim());
  if (!result.ok) {
    io.out('BROWSER PAIRING');
    io.out(`  Blocked:      ${result.error.kind.replace(/_/g, ' ')}`);
    io.out(`  Detail:       ${result.error.message}`);
    return EXIT.blocked;
  }
  const grant = result.value;
  io.out('BROWSER PAIRING GRANT');
  io.out(`  Origin:       ${grant.origin}`);
  io.out(`  Grant id:     ${grant.grantId}`);
  io.out(`  Grant secret: ${grant.grantSecret}`);
  io.out(`  Expires:      ${grant.expiresAt} (${grant.expiresInSeconds}s)`);
  io.out('  Single use. Paste it into the Relay browser once, then it is spent.');
  return EXIT.completed;
}

/** `relay reviewer harnesses` — the truthful catalog. */
function runReviewerCatalogCli(io: CliIo): number {
  for (const line of renderHarnessCatalogLines()) io.out(line);
  return EXIT.completed;
}

async function runAgentCli(parsed: ParsedCli, io: CliIo): Promise<number> {
  const caps = productCaps(parsed, io);

  if (parsed.credentialInArgv === true) {
    PSP_ARGUMENT_REFUSAL.forEach((line) => io.out(line));
    return EXIT.usage;
  }
  // THE OPERATING PROFILE. Rendered from the shared projection, so this
  // prints exactly what the website's inspector shows. No credential is read
  // and no provider is contacted to produce it.
  if (parsed.agentAction === 'profile') {
    if (parsed.error) {
      io.out(parsed.error);
      return EXIT.usage;
    }
    const render = detectRenderOptions(parsed, io.env, io.isTTY);
    const options = { width: render.width ?? 80, plain: render.plain === true };
    const requested = parsed.role;
    const roles = requested === undefined
      ? RELAY_AGENT_ROLES
      : RELAY_AGENT_ROLES.filter((role) => role === requested);
    const projections = projectAgentOperatingProfiles(roles.map(operatingProfileFixture));
    for (const line of renderAgentOperatingProfiles(projections, options)) io.out(line);
    return EXIT.completed;
  }

  if (parsed.agentAction !== 'import') {
    io.out('agent requires an action: import or profile.');
    return EXIT.usage;
  }

  // NO PRODUCTION ENTITLEMENT BACKEND EXISTS. Ship on Sunday's purchase and
  // trading service is not implemented, so the production boundary refuses
  // every credential rather than inventing an entitlement. The deterministic
  // fixture service is used ONLY when the developer opts in explicitly.
  const useFixtures = io.env.RELAY_PSP_FIXTURES === '1';
  const service = useFixtures
    ? createFixtureEntitlementService()
    : createUnavailableEntitlementService();
  if (useFixtures) {
    io.out('[DEVELOPMENT FIXTURES] Synthetic PSP entitlements — no marketplace, no purchase.');
  }

  const workspaceId = parsed.workspaceId ?? 'ws-relay-001';
  const source: PspCredentialSource = parsed.stdinCredential === true
    ? { kind: 'stdin', read: readAllStdin }
    : parsed.credentialEnv !== undefined
      ? {
        kind: 'env',
        name: parsed.credentialEnv,
        read: (name) => (io.env as Record<string, string | undefined>)[name],
      }
      : { kind: 'interactive' };

  let counter = 0;
  const outcome = await runPspAgentImportCommand({
    caps,
    workspace: {
      workspaceId,
      userId: io.env.RELAY_USER_ID ?? 'user-holder',
      importAllowed: true,
      relayVersion: CLI_VERSION,
      grantablePermissions: [
        'workspace.read', 'workspace.write', 'mission.run', 'mission.review',
      ],
      installedPspIds: [],
    },
    service,
    now: () => new Date().toISOString(),
    importId: () => `imp-${++counter}`,
    io: {
      out: (line) => io.out(line),
      readSecret: readHiddenLine,
      confirm: readConfirmation,
    },
    source,
    assumeYes: parsed.assumeYes === true,
  });

  return outcome.imported ? EXIT.completed : EXIT.usage;
}

async function runYcCli(parsed: ParsedCli, io: CliIo): Promise<number> {
  const caps = productCaps(parsed, io);
  if (parsed.ycAction === 'check') {
    const deps = createNodePreflightDeps({
      env: io.env as Record<string, string | undefined>,
      columns: io.isTTY ? process.stdout.columns : undefined,
      // The plain-demo check runs IN-PROCESS through the same offline demo
      // the founder will record — no subprocess, no provider, temp state.
      runPlainDemo: async () => runCliDemo({ caps: { ...caps, tty: false }, plain: true }),
    });
    const report = await runYcPreflight(deps);
    if (parsed.json) io.out(JSON.stringify({ checks: report.checks, exitCode: report.exitCode }));
    else report.lines.forEach((line) => io.out(line));
    return report.exitCode === 0 ? EXIT.completed : EXIT.doctorFailure;
  }
  // yc demo — the founder launcher: honesty notice, then EXACTLY the
  // approved offline simulation (`relay cli demo`); never a second engine.
  for (const line of ycDemoNotice(caps.unicode)) io.out(line);
  const demo = await runCliDemo({ caps, plain: parsed.plain || parsed.json || !caps.tty });
  demo.lines.forEach((line) => io.out(line));
  return demo.exitCode;
}

/** --watch loop for read-only product commands: clear + re-render the same
 * canonical projection on an interval, leaving cleanly on Ctrl+C (SIGINT).
 * TTY-only; never touches raw mode, so the shell IO loop is unaffected.
 * Resolves with the LAST produced exit code (never masks a failing view),
 * and always rewrites the terminal reset + cursor-show sequence on exit.
 * The hooks are injectable for tests; production uses process defaults. */
export function runProductWatch(
  produce: () => { lines: string[]; json?: unknown; exitCode: number },
  emit: (r: { lines: string[]; json?: unknown; exitCode: number }) => number,
  hooks: {
    intervalMs?: number;
    write?: (text: string) => void;
    signalSource?: {
      on(event: 'SIGINT', listener: () => void): unknown;
      removeListener(event: 'SIGINT', listener: () => void): unknown;
    };
  } = {},
): Promise<number> {
  const write = hooks.write ?? ((text: string): void => { process.stdout.write(text); });
  const signals = hooks.signalSource ?? process;
  return new Promise<number>((resolve) => {
    let timer: NodeJS.Timeout | null = null;
    let settled = false;
    let lastCode: number = EXIT.completed;
    const stop = (code?: number): void => {
      if (settled) return;
      settled = true;
      if (timer) { clearInterval(timer); timer = null; }
      signals.removeListener('SIGINT', onSigint);
      try { write('\x1b[0m\x1b[?25h'); } catch { /* stream closed */ }
      resolve(code ?? lastCode);
    };
    const onSigint = (): void => stop();
    const paint = (): void => {
      try {
        write('\x1b[H\x1b[2J');
        lastCode = emit(produce());
        write('\n[watching — Ctrl+C to exit]\n');
      } catch { stop(EXIT.internalError); }
    };
    signals.on('SIGINT', onSigint);
    paint();
    // Only arm the interval if the FIRST paint did not already settle (a
    // synchronous throw on the first paint calls stop() while timer is still
    // null; scheduling here unconditionally would orphan an uncancellable
    // clear-screen loop that keeps the process alive). Guarded, not moved,
    // so a later interval paint that throws is still cleared by stop().
    if (!settled) timer = setInterval(paint, Math.max(200, hooks.intervalMs ?? 2000));
  });
}

/* ------------------------------- main ------------------------------ */

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const parsed = parseCli(argv);
  const render = detectRenderOptions(
    { json: parsed.json, 'no-color': parsed.noColor, plain: parsed.plain, quiet: parsed.quiet },
    io.env,
    io.isTTY,
  );
  if (parsed.error) {
    io.out(parsed.error);
    io.out(HELP_TEXT);
    return EXIT.usage;
  }
  switch (parsed.command) {
    case 'help':
      io.out(HELP_TEXT);
      return EXIT.completed;
    case 'version':
      if (parsed.json) {
        io.out(JSON.stringify({ cliVersion: CLI_VERSION, protocolVersion: RELAY_PROTOCOL_VERSION, adapterProfile: 'simulation', storageProfile: 'volatile-memory' }));
      } else {
        io.out(`Relay CLI ${CLI_VERSION}`);
        io.out(`Protocol ${RELAY_PROTOCOL_VERSION}`);
        io.out('Adapter profile: simulation');
        io.out('Storage profile: volatile memory');
      }
      return EXIT.completed;
    case 'doctor': {
      const report = doctorReport(io);
      if (parsed.json) io.out(JSON.stringify({ report: report.lines.slice(1), exitCode: report.exitCode }));
      else report.lines.forEach((line) => io.out(line));
      return report.exitCode;
    }
    case 'workspace': {
      // Live local workspace infrastructure — composed ONLY here; the CLI
      // renders results and never makes workspace policy decisions.
      if (parsed.workspaceAction === 'doctor') {
        const report = workspaceDoctorReport();
        if (parsed.json) io.out(JSON.stringify({ report: report.lines.slice(1), exitCode: report.exitCode }));
        else report.lines.forEach((line) => io.out(line));
        return report.exitCode;
      }
      io.out('RELAY WORKSPACE VERIFICATION (live local, fixture repository only)');
      const { checks, failures } = await runWorkspaceVerification();
      for (const check of checks) {
        io.out(`  [${check.ok ? 'PASS' : 'FAIL'}] ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
      }
      if (failures > 0) {
        io.out(`\nWORKSPACE VERIFICATION FAILED: ${failures} check(s).`);
        return EXIT.doctorFailure;
      }
      io.out('\nWORKSPACE VERIFICATION PASSED — isolation, policy, and cleanup proven.');
      return EXIT.completed;
    }
    case 'loop': {
      const args = parsed.loopArgs ?? [];
      if (args[1] === 'help') {
        LOOP_CLI_HELP.forEach((line) => io.out(line));
        return EXIT.completed;
      }
      // The CLI observes no agent registry and no feature flags yet, so both
      // are omitted rather than invented: the preview says Unknown where it
      // does not know, and the Loop Engine reports itself disabled because it
      // is. A surface that guessed here would be the first thing to lie.
      const result = runLoopCli({ positionals: args, observedAt: new Date().toISOString() });
      result.lines.forEach((line) => io.out(line));
      return result.invalid ? EXIT.usage : EXIT.completed;
    }
    case 'claude':
      return runClaudeCli(parsed, io);
    case 'codex':
      return runCodexCli(parsed, io);
    case 'supervised':
      return runSupervisedCli(parsed, io);
    case 'state':
      return runStateCli(parsed, io);
    case 'runs':
      return runRunsCli(parsed, io);
    case 'persistence':
      return runPersistenceCli(parsed, io);
    case 'home':
    case 'projects':
    case 'project':
    case 'recover':
    case 'cli':
      return runProductCli(parsed, io);
    case 'yc':
      return runYcCli(parsed, io);
    case 'agent':
      return runAgentCli(parsed, io);
    case 'reviewer':
      if (parsed.reviewerAction === 'pair-browser') return await runBrowserPairingCli(parsed, io);
      return runReviewerCatalogCli(io);
    case 'mission':
      return runMissionCli(parsed, io);
    case 'demo':
    case 'run': {
      // mission-control renders over a real competitive run.
      const isMissionControl = parsed.scenario === 'mission-control';
      const isCompetitive = parsed.scenario === 'competitive';
      const runScenarioName = isMissionControl ? 'competitive' : parsed.scenario!;
      const definition = SCENARIOS[runScenarioName];
      const objective = parsed.objective ?? definition.displayObjective;
      const outcome = runScenarioToCompletion({
        scenarioName: runScenarioName,
        objective,
        maxCost: parsed.maxCost,
        autoAcceptBlueprint: parsed.autoAcceptBlueprint,
        render,
      });
      // Presentation mode: renderer-only milestones + pacing. Auto-enabled
      // for yc / competitive / mission-control unless JSON/quiet was requested.
      const presentation = !parsed.json && !parsed.quiet && (parsed.presentation || parsed.scenario === 'yc' || isCompetitive || isMissionControl);
      const nowIso = new Date().toISOString();
      if (parsed.json) {
        const payload = isCompetitive || isMissionControl
          ? { ...(outcome.json as object), mission: competitiveJson(outcome.app, nowIso) }
          : outcome.json;
        io.out(JSON.stringify(payload));
      } else if (parsed.quiet) {
        io.out(`${outcome.finalStatus} (exit ${outcome.exitCode})`);
      } else if (presentation) {
        const frames = isMissionControl
          ? buildMissionControlFrames(outcome.app, render, nowIso)
          : isCompetitive
            ? buildCompetitiveFrames(outcome.app, render, nowIso)
            : buildPresentationFrames(outcome.app, render);
        const pace = parsed.pace ?? (io.isTTY ? 2500 : 0);
        for (const frame of frames) {
          frame.lines.forEach((line) => io.out(line));
          if (pace > 0 && frame !== frames[frames.length - 1]) await sleep(pace);
        }
      } else {
        outcome.lines.forEach((line) => io.out(line));
      }
      return outcome.exitCode;
    }
    case 'interactive': {
      // Bare `relay` opens the terminal PRODUCT shell (Prompt 8.6). The
      // legacy simulated session remains available via `relay session`.
      const caps = productCaps(parsed, io);
      // --once prints a single home snapshot instead of opening the shell.
      if (caps.tty && !parsed.json && !parsed.plain && !parsed.once) {
        const rootResult = resolveStateRoot(io.env as Record<string, string | undefined>, parsed.stateRoot);
        if (!rootResult.ok) { io.out(rootResult.error.message); return EXIT.doctorFailure; }
        const store = createStateStore({ root: rootResult.value.root });
        return runProductShell({
          caps, data: loadAppData(store), store, playbackMs: 0, now: () => new Date().toISOString(),
        });
      }
      return runProductCli({ ...parsed, command: 'home' }, io);
    }
    case 'session': {
      const session = createSession({
        render,
        scenarioName: parsed.scenario ?? 'repair',
        interactiveBlueprint: !parsed.autoAcceptBlueprint,
      });
      session.banner().forEach((line) => io.out(line));
      io.out('Enter an engineering objective (or /help):');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
      rl.prompt();
      rl.on('line', (line) => {
        const result = session.handleLine(line);
        result.lines.forEach((l) => io.out(l));
        if (result.exit) rl.close();
        else rl.prompt();
      });
      rl.on('close', () => process.exit(EXIT.completed));
      return EXIT.completed;
    }
  }
}

/* Bundled entry */
if (require.main === module) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
