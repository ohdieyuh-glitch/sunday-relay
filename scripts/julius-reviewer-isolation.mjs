#!/usr/bin/env node
/**
 * THE PAID REVIEWER HOLDS NO TOOL, AND THE BOOTSTRAP PROVES IT.
 *
 * `.github/julius-live-hermes.sh` used to write a reviewer profile with two
 * sections, the provider deadline and `api_max_retries`, and nothing else.
 * Measured against the pinned Hermes (2ea39dae, v0.18.2) with that exact
 * profile, through a wrapper built the way the bootstrap builds it, with the
 * flags `runHermesReview` passes, `hermes -z --safe-mode` built an agent with
 * 18 toolsets enabled and these tools in its request: clarify, delegate_task,
 * execute_code, memory, patch, process, read_file, search_files,
 * session_search, skill_manage, skill_view, skills_list, terminal, todo,
 * web_extract, web_search, write_file and x_search. One-shot mode sets
 * HERMES_YOLO_MODE=1, so every approval those tools would ask for is granted.
 * That agent reads a model-written diff, on a runner that can reach docker.
 *
 * `--safe-mode` did not prevent it. At this commit it skips plugin discovery,
 * shell-hook registration and MCP servers. It also sets
 * HERMES_IGNORE_USER_CONFIG, which only the interactive chat reads: the
 * one-shot path loads the profile's `config.yaml` either way. So the profile
 * decides what the reviewer can do, and it said nothing about tools.
 *
 * READ-ONLY IS THEREFORE CARRIED BY THE PROFILE, the way the reviewer harness
 * has always carried it (`relay-bridge/reviewer-harness/hermes/isolated-profile.ts`):
 * every toolset disabled, no MCP servers, plugins or hooks, memory and
 * checkpoints off. This module renders that profile for the paid path, and
 * judges the record the bootstrap's proof writes after running the REAL wrapper
 * and the REAL `hermes -z` with the network closed
 * (`.github/julius-live-hermes-isolation/sitecustomize.py`).
 *
 * `kanban` IS ON THE LIST, AND THE HARNESS LIST LACKED IT. `hermes tools list`
 * does not show it, because it is not a configurable toolset, and with the
 * harness's 23 names disabled the one-shot path still resolved `kanban` as
 * enabled. Its tools stayed out of the request only because their own check
 * wants HERMES_KANBAN_TASK in the environment or `kanban` in a profile's
 * `toolsets`. With `kanban` disabled too the resolved set is empty.
 *
 * `max_turns: 1` IS WRITTEN AND DOES NOTHING HERE. The one-shot path builds its
 * agent with Hermes's default of 90 iterations whatever the profile says, which
 * the record reports. It is kept so the paid profile carries every setting the
 * harness profile does. What bounds a tool loop is that there is no tool.
 *
 * The toolset list MIRRORS the harness's `DISABLED_TOOLSETS`, and
 * `julius-reviewer-isolation.test.ts` fails if the two differ by a name.
 *
 * THE PROOF ALSO CARRIES THE PROMPT THE WAY THE REVIEW DOES. The paid reviewer
 * reads its packet from a file (`RELAY_HERMES_PROMPT_TRANSPORT=file`), because
 * as an argument Linux refuses it at 131,072 bytes. The proof's prompt is
 * larger than that, and the verdict requires the agent to have received every
 * byte of it, so the same run proves the transport on the pinned binary.
 */

import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REVIEWER_ISOLATION_POLICY_VERSION = 'julius-reviewer-isolation.v1';

/** Every toolset the pinned Hermes resolves for the one-shot path. The reviewer gets none. */
export const REVIEWER_DISABLED_TOOLSETS = Object.freeze([
  'web', 'browser', 'terminal', 'file', 'code_execution', 'vision', 'video',
  'image_gen', 'video_gen', 'x_search', 'tts', 'skills', 'todo', 'memory',
  'context_engine', 'session_search', 'clarify', 'delegation', 'cronjob',
  'homeassistant', 'spotify', 'yuanbao', 'computer_use', 'kanban',
]);

/**
 * One request attempt per provider call. The profile says `api_max_retries: 0`
 * and Hermes floors the value at one attempt, which is what it reports.
 */
export const REVIEWER_API_ATTEMPTS = 1;

/** Linux's MAX_ARG_STRLEN: execve refuses any single argument this long or longer. */
export const LINUX_MAX_ARG_STRLEN = 131_072;

/** What the proof's record must carry for each named fact. */
export const REVIEWER_ISOLATION_RECORD_FIELDS = Object.freeze([
  'reached', 'network_guard_verified', 'model_visible_tools', 'valid_tool_names',
  'agent_enabled_toolsets', 'resolved_cli_toolsets', 'safe_mode', 'shell_hooks_registered',
  'api_attempts', 'request_timeout_seconds', 'stale_timeout_seconds',
  'codex_event_stale_timeout_seconds', 'codex_ttfb_timeout_seconds', 'provider', 'model',
  'max_iterations', 'network_refused', 'prompt_bytes',
]);

const PROVIDER_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/u;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

/** A name from the record, reduced to characters a log line can carry safely. */
function safeName(value) {
  const text = typeof value === 'string' ? value : String(value);
  const reduced = text.replace(/[^A-Za-z0-9_.:/-]/gu, '?');
  return reduced.length > 64 ? `${reduced.slice(0, 63)}…` : reduced;
}

function requirePositiveInteger(value, reason) {
  const number = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isInteger(number) || number <= 0) throw new Error(reason);
  return number;
}

function requireProvider(provider) {
  if (typeof provider !== 'string' || !PROVIDER_PATTERN.test(provider)) throw new Error('reviewer_isolation_provider_invalid');
  return provider;
}

/**
 * The paid reviewer's whole profile configuration.
 *
 * The provider section is the deadline the bootstrap has always written; the
 * rest is the harness's isolated profile. The model and the provider are still
 * NOT chosen here: they stay on Julius's command line, so this file cannot
 * become a second place that decides who reviews.
 */
export function reviewerProfileConfigYaml({ provider, requestTimeoutSeconds }) {
  const name = requireProvider(provider);
  const seconds = requirePositiveInteger(requestTimeoutSeconds, 'reviewer_isolation_timeout_invalid');
  return [
    '# Relay-owned paid Reviewer profile, written by .github/julius-live-hermes.sh.',
    '# Read-only lives here: every toolset is disabled. See scripts/julius-reviewer-isolation.mjs.',
    'providers:',
    `  ${name}:`,
    `    request_timeout_seconds: ${seconds}`,
    `    stale_timeout_seconds: ${seconds}`,
    'agent:',
    '  api_max_retries: 0',
    '  disabled_toolsets:',
    ...REVIEWER_DISABLED_TOOLSETS.map((toolset) => `    - ${toolset}`),
    '  max_turns: 1',
    'mcp_servers: {}',
    'plugins: []',
    'hooks: {}',
    'hooks_auto_accept: false',
    'memory:',
    '  enabled: false',
    'checkpoints:',
    '  enabled: false',
    '',
  ].join('\n');
}

const isNameList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

/**
 * JUDGES THE PROOF'S RECORD. Every refusal names the fact that failed, and the
 * evidence line on success states every fact the record established.
 *
 * `expected` is what the bootstrap was configured with: the provider and model
 * Julius will pass, the request deadline the profile carries, and the size of
 * the prompt file the proof wrote, which must exceed one argument's ceiling.
 * `sideRecords` are the network refusals Hermes's own child processes wrote.
 */
export function verifyReviewerIsolation(record, expected, sideRecords = []) {
  const refuse = (reason) => ({ ok: false, reason });
  const provider = requireProvider(expected?.provider);
  if (typeof expected?.model !== 'string' || !MODEL_PATTERN.test(expected.model)) throw new Error('reviewer_isolation_model_invalid');
  const seconds = requirePositiveInteger(expected?.requestTimeoutSeconds, 'reviewer_isolation_timeout_invalid');
  const promptBytes = requirePositiveInteger(expected?.promptBytes, 'reviewer_isolation_prompt_bytes_invalid');
  // A proof prompt one argument could carry would prove nothing about the transport.
  if (promptBytes < LINUX_MAX_ARG_STRLEN) throw new Error('reviewer_isolation_prompt_bytes_within_argv_ceiling');

  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return refuse('reviewer_isolation_unproven:no_record');
  }
  // A proof whose network guard was not shown to work proves nothing about
  // what it did not contact, so this is checked before anything it recorded.
  if (record.network_guard_verified !== true) return refuse('reviewer_isolation_unproven:network_guard_not_verified');
  if (record.reached !== true) return refuse('reviewer_isolation_unproven:hermes_never_built_an_agent');
  if (record.capture_error !== undefined) return refuse('reviewer_isolation_unproven:capture_failed');

  if (!isNameList(record.model_visible_tools) || !isNameList(record.valid_tool_names)) {
    return refuse('reviewer_isolation_unproven:tools_unreadable');
  }
  const held = [...new Set([...record.model_visible_tools, ...record.valid_tool_names])].sort();
  if (held.length > 0) return refuse(`reviewer_holds_tools:${held.map(safeName).join(',')}`);

  // `null` is how Hermes spells "no restriction": every toolset.
  if (record.agent_enabled_toolsets === null) return refuse('reviewer_toolsets_unrestricted');
  if (!isNameList(record.agent_enabled_toolsets) || !isNameList(record.resolved_cli_toolsets)) {
    return refuse('reviewer_isolation_unproven:toolsets_unreadable');
  }
  const enabled = [...new Set([...record.agent_enabled_toolsets, ...record.resolved_cli_toolsets])].sort();
  if (enabled.length > 0) return refuse(`reviewer_toolsets_enabled:${enabled.map(safeName).join(',')}`);

  if (record.safe_mode !== true) return refuse('reviewer_safe_mode_off');
  if (record.shell_hooks_registered !== 0) {
    return refuse(`reviewer_shell_hooks_registered:${Number.isInteger(record.shell_hooks_registered) ? record.shell_hooks_registered : 'unknown'}`);
  }
  if (record.api_attempts !== REVIEWER_API_ATTEMPTS) {
    return refuse(`reviewer_api_attempts:${Number.isInteger(record.api_attempts) ? record.api_attempts : 'unknown'}_expected_${REVIEWER_API_ATTEMPTS}`);
  }
  /**
   * THE STREAM WATCHDOGS ARE THE REQUEST DEADLINE, OR THE REVIEW IS KILLED EARLY.
   * Unset means the engine's size-scaled default — 12 s of silence below ~10k
   * tokens — which ended paid qualification 34753589938's reviewer. So unset is
   * refused exactly like a wrong number.
   */
  for (const field of ['request_timeout_seconds', 'stale_timeout_seconds', 'codex_event_stale_timeout_seconds', 'codex_ttfb_timeout_seconds']) {
    if (record[field] !== seconds) {
      return refuse(`reviewer_${field}:${typeof record[field] === 'number' ? record[field] : 'unknown'}_expected_${seconds}`);
    }
  }
  if (record.provider !== provider || record.model !== expected.model) {
    return refuse(`reviewer_identity:${safeName(record.provider)}/${safeName(record.model)}_expected_${provider}/${expected.model}`);
  }
  // EVERY BYTE, OR THE TRANSPORT IS NOT PROVEN. Short means the prompt was cut
  // somewhere between the file and the agent; long means something was added.
  if (record.prompt_bytes !== promptBytes) {
    return refuse(`reviewer_prompt_bytes:${Number.isInteger(record.prompt_bytes) ? record.prompt_bytes : 'unknown'}_expected_${promptBytes}`);
  }
  if (!isNameList(record.network_refused)) return refuse('reviewer_isolation_unproven:network_record_unreadable');

  const childRefusals = sideRecords.reduce(
    (total, side) => total + (isNameList(side?.network_refused) ? side.network_refused.length : 0), 0);
  const maxIterations = Number.isInteger(record.max_iterations) ? record.max_iterations : 'unknown';
  return {
    ok: true,
    evidence: [
      'hermes_reviewer_isolation=PROVEN',
      'model_visible_tools=0',
      'toolsets=0',
      'safe_mode=on',
      'shell_hooks=0',
      `api_attempts=${REVIEWER_API_ATTEMPTS}`,
      `request_timeout_s=${seconds}`,
      `stale_timeout_s=${seconds}`,
      `codex_event_stale_timeout_s=${seconds}`,
      `codex_ttfb_timeout_s=${seconds}`,
      `max_iterations=${maxIterations}`,
      `prompt_bytes=${promptBytes}`,
      `proof_network_refusals=${record.network_refused.length + childRefusals}`,
      '(hermes -z through the wrapper and its prompt-file launcher, network closed, no model asked)',
    ].join(' '),
  };
}

/** Reads the proof's record and the side records beside it. Missing or unparseable is `null`. */
export function readIsolationRecords(recordPath) {
  const parse = (path) => {
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  };
  let siblings = [];
  try {
    const prefix = `${basename(recordPath)}.child-`;
    siblings = readdirSync(dirname(recordPath)).filter((name) => name.startsWith(prefix)).sort();
  } catch { siblings = []; }
  return {
    record: parse(recordPath),
    sideRecords: siblings.map((name) => parse(join(dirname(recordPath), name))).filter((side) => side !== null),
  };
}

function main(argv) {
  const [command, ...rest] = argv;
  try {
    if (command === 'config' && rest.length === 2) {
      process.stdout.write(reviewerProfileConfigYaml({ provider: rest[0], requestTimeoutSeconds: rest[1] }));
      return 0;
    }
    if (command === 'verify' && rest.length === 5) {
      const [recordPath, provider, model, requestTimeoutSeconds, promptBytes] = rest;
      const { record, sideRecords } = readIsolationRecords(recordPath);
      const verdict = verifyReviewerIsolation(record, { provider, model, requestTimeoutSeconds, promptBytes }, sideRecords);
      if (!verdict.ok) {
        process.stderr.write(`${verdict.reason}\n`);
        return 1;
      }
      process.stdout.write(`${verdict.evidence}\n`);
      return 0;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'reviewer_isolation_failed'}\n`);
    return 1;
  }
  process.stderr.write('usage: julius-reviewer-isolation.mjs config <provider> <requestTimeoutSeconds>\n'
    + '       julius-reviewer-isolation.mjs verify <record.json> <provider> <model> <requestTimeoutSeconds> <promptBytes>\n');
  return 2;
}

const entrypoint = (() => {
  if (!process.argv[1]) return null;
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; }
})();
if (entrypoint !== null && import.meta.url === entrypoint) {
  process.exitCode = main(process.argv.slice(2));
}
