import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import {
  DISABLED_TOOLSETS, WRITE_CAPABLE_TOOLSETS, isolatedConfigYaml,
} from '../relay-bridge/reviewer-harness/hermes/isolated-profile';
import {
  REVIEWER_API_ATTEMPTS, REVIEWER_DISABLED_TOOLSETS, REVIEWER_ISOLATION_RECORD_FIELDS,
  readIsolationRecords, reviewerProfileConfigYaml, verifyReviewerIsolation,
} from './julius-reviewer-isolation.mjs';
import { ISOLATION_PROOF_MUTATIONS, PROFILE_HEREDOC_BEFORE_ISOLATION } from './julius-reviewer-isolation-proof-mutations.mjs';

/**
 * THE PAID REVIEWER HOLDS NO TOOL.
 *
 * The records below were written by `.github/julius-live-hermes-isolation/sitecustomize.py`
 * running the pinned Hermes (2ea39dae, v0.18.2) through a wrapper built as the
 * bootstrap builds it, with the flags `runHermesReview` passes. They are what
 * the proof actually observed, not a description of what it should observe.
 */

const ROOT = resolve(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const BOOTSTRAP = '.github/julius-live-hermes.sh';
const HOOK = '.github/julius-live-hermes-isolation/sitecustomize.py';
const MODULE = join(ROOT, 'scripts/julius-reviewer-isolation.mjs');

const EXPECTED = { provider: 'xai', model: 'grok-build-0.1', requestTimeoutSeconds: 90 } as const;

/** The profile this change writes: every toolset disabled. Observed, 2026-09-13. */
const PROVEN = {
  agent_enabled_toolsets: [], api_attempts: 1, max_iterations: 90, model: 'grok-build-0.1',
  model_visible_tools: [], network_guard_verified: true, network_refused: ["getaddrinfo:'models.dev'"],
  prompt_bytes: 15, provider: 'xai', reached: true, request_timeout_seconds: 90.0, resolved_cli_toolsets: [],
  safe_mode: true, shell_hooks_registered: 0, stale_timeout_seconds: 90.0, valid_tool_names: [],
};

/** The profile the paid path wrote before this change: a deadline and nothing about tools. Observed, 2026-09-13. */
const BEFORE = {
  ...PROVEN,
  agent_enabled_toolsets: ['browser', 'clarify', 'code_execution', 'computer_use', 'cronjob', 'delegation', 'file', 'image_gen', 'kanban', 'memory', 'session_search', 'skills', 'terminal', 'todo', 'tts', 'vision', 'web', 'x_search'],
  resolved_cli_toolsets: ['browser', 'clarify', 'code_execution', 'computer_use', 'cronjob', 'delegation', 'file', 'image_gen', 'kanban', 'memory', 'session_search', 'skills', 'terminal', 'todo', 'tts', 'vision', 'web', 'x_search'],
  model_visible_tools: ['clarify', 'delegate_task', 'execute_code', 'memory', 'patch', 'process', 'read_file', 'search_files', 'session_search', 'skill_manage', 'skill_view', 'skills_list', 'terminal', 'todo', 'web_extract', 'web_search', 'write_file', 'x_search'],
  valid_tool_names: ['clarify', 'delegate_task', 'execute_code', 'memory', 'patch', 'process', 'read_file', 'search_files', 'session_search', 'skill_manage', 'skill_view', 'skills_list', 'terminal', 'todo', 'web_extract', 'web_search', 'write_file', 'x_search'],
};

/** The harness's 23 names without `kanban`: no tool in the request, one toolset still resolved. Observed, 2026-09-13. */
const WITHOUT_KANBAN = { ...PROVEN, agent_enabled_toolsets: ['kanban'], resolved_cli_toolsets: ['kanban'] };

const refusal = (record: unknown, expected = EXPECTED, side: unknown[] = []): string => {
  const verdict = verifyReviewerIsolation(record, expected, side);
  expect(verdict.ok, JSON.stringify(verdict)).toBe(false);
  return verdict.ok ? '' : verdict.reason;
};

describe('the paid profile carries the harness profile', () => {
  it('disables exactly the toolsets the harness disables, kanban and every write-capable toolset included', () => {
    expect([...REVIEWER_DISABLED_TOOLSETS]).toEqual([...DISABLED_TOOLSETS]);
    expect(REVIEWER_DISABLED_TOOLSETS).toContain('kanban');
    for (const toolset of WRITE_CAPABLE_TOOLSETS) expect(REVIEWER_DISABLED_TOOLSETS, toolset).toContain(toolset);
  });

  it('writes every setting line of the harness profile, and keeps the deadline and single attempt', () => {
    const paid = reviewerProfileConfigYaml({ provider: 'xai', requestTimeoutSeconds: 90 }).split('\n');
    for (const line of isolatedConfigYaml().split('\n')) {
      if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
      expect(paid, `the paid profile lacks the harness line "${line}"`).toContain(line);
    }
    for (const line of ['providers:', '  xai:', '    request_timeout_seconds: 90', '    stale_timeout_seconds: 90', '  api_max_retries: 0']) {
      expect(paid).toContain(line);
    }
    // Who reviews stays on Julius's command line.
    expect(paid.join('\n')).not.toMatch(/^\s*(model|default|provider):/mu);
  });

  it('refuses a provider or a deadline that could reshape the file', () => {
    expect(() => reviewerProfileConfigYaml({ provider: 'xai:\n  evil', requestTimeoutSeconds: 90 })).toThrow('reviewer_isolation_provider_invalid');
    expect(() => reviewerProfileConfigYaml({ provider: 'xai', requestTimeoutSeconds: '90\nagent:' })).toThrow('reviewer_isolation_timeout_invalid');
    expect(() => reviewerProfileConfigYaml({ provider: 'xai', requestTimeoutSeconds: 0 })).toThrow('reviewer_isolation_timeout_invalid');
    expect(reviewerProfileConfigYaml({ provider: 'xai', requestTimeoutSeconds: '90' }))
      .toBe(reviewerProfileConfigYaml({ provider: 'xai', requestTimeoutSeconds: 90 }));
  });
});

describe('the verdict on what the proof observed', () => {
  it('accepts the profile this change writes, and says every fact it established', () => {
    const verdict = verifyReviewerIsolation(PROVEN, EXPECTED);
    expect(verdict).toEqual({
      ok: true,
      evidence: 'hermes_reviewer_isolation=PROVEN model_visible_tools=0 toolsets=0 safe_mode=on shell_hooks=0 '
        + `api_attempts=${REVIEWER_API_ATTEMPTS} request_timeout_s=90 stale_timeout_s=90 max_iterations=90 proof_network_refusals=1 `
        + '(hermes -z through the wrapper, network closed, no model asked)',
    });
  });

  it('refuses the profile the paid path wrote before, naming every tool the reviewer held', () => {
    expect(refusal(BEFORE)).toBe(`reviewer_holds_tools:${BEFORE.model_visible_tools.join(',')}`);
  });

  it('refuses a resolved toolset even when no tool reached the request', () => {
    expect(refusal(WITHOUT_KANBAN)).toBe('reviewer_toolsets_enabled:kanban');
    expect(refusal({ ...PROVEN, agent_enabled_toolsets: null })).toBe('reviewer_toolsets_unrestricted');
  });

  it('refuses a run where safe mode did not take effect or a shell hook was registered', () => {
    expect(refusal({ ...PROVEN, safe_mode: false })).toBe('reviewer_safe_mode_off');
    expect(refusal({ ...PROVEN, shell_hooks_registered: 1 })).toBe('reviewer_shell_hooks_registered:1');
    expect(refusal({ ...PROVEN, shell_hooks_registered: null })).toBe('reviewer_shell_hooks_registered:unknown');
  });

  it('refuses retries and deadlines other than the ones configured', () => {
    expect(refusal({ ...PROVEN, api_attempts: 3 })).toBe('reviewer_api_attempts:3_expected_1');
    expect(refusal({ ...PROVEN, request_timeout_seconds: 60, stale_timeout_seconds: 60 })).toBe('reviewer_request_timeout_seconds:60_expected_90');
    expect(refusal({ ...PROVEN, stale_timeout_seconds: null })).toBe('reviewer_stale_timeout_seconds:unknown_expected_90');
  });

  it('refuses an agent built for a different provider or model', () => {
    expect(refusal({ ...PROVEN, model: 'grok-4' })).toBe('reviewer_identity:xai/grok-4_expected_xai/grok-build-0.1');
  });

  it('treats anything it cannot read as unproven, never as isolated', () => {
    expect(refusal(null)).toBe('reviewer_isolation_unproven:no_record');
    expect(refusal({ reached: false, network_guard_verified: true, network_refused: [] }))
      .toBe('reviewer_isolation_unproven:hermes_never_built_an_agent');
    expect(refusal({ ...PROVEN, network_guard_verified: false })).toBe('reviewer_isolation_unproven:network_guard_not_verified');
    expect(refusal({ ...PROVEN, capture_error: 'AttributeError: x' })).toBe('reviewer_isolation_unproven:capture_failed');
    expect(refusal({ ...PROVEN, model_visible_tools: undefined })).toBe('reviewer_isolation_unproven:tools_unreadable');
    expect(refusal({ ...PROVEN, resolved_cli_toolsets: 'none' })).toBe('reviewer_isolation_unproven:toolsets_unreadable');
    expect(refusal({ ...PROVEN, network_refused: undefined })).toBe('reviewer_isolation_unproven:network_record_unreadable');
  });

  it('keeps a hostile tool name out of the job log', () => {
    const reason = refusal({ ...PROVEN, model_visible_tools: ['evil\nhermes_reviewer_isolation=PROVEN'] });
    expect(reason).not.toContain('\n');
    expect(reason.startsWith('reviewer_holds_tools:evil?hermes_reviewer_isolation?PROVEN')).toBe(true);
  });

  it('counts the refusals Hermes child processes recorded', () => {
    const verdict = verifyReviewerIsolation(PROVEN, EXPECTED, [{ network_refused: ["getaddrinfo:'a'", "getaddrinfo:'b'"] }]);
    expect(verdict.ok && verdict.evidence).toContain('proof_network_refusals=3');
  });
});

describe('the command the bootstrap runs', () => {
  const run = (args: string[]) => spawnSync(process.execPath, [MODULE, ...args], { encoding: 'utf8' });

  it('prints the profile the function renders', () => {
    const result = run(['config', 'xai', '90']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(reviewerProfileConfigYaml({ provider: 'xai', requestTimeoutSeconds: 90 }));
    expect(run(['config', 'xai:', '90']).status).toBe(1);
  });

  it('verifies a record from disk, counting side records, and refuses a missing one on stderr', () => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-reviewer-isolation-'));
    writeFileSync(join(dir, 'record.json'), JSON.stringify(PROVEN));
    writeFileSync(join(dir, 'record.json.child-4242'), JSON.stringify({ network_refused: ["getaddrinfo:'x'"] }));
    expect(readIsolationRecords(join(dir, 'record.json')).sideRecords).toHaveLength(1);
    const proven = run(['verify', join(dir, 'record.json'), 'xai', 'grok-build-0.1', '90']);
    expect(proven.status).toBe(0);
    expect(proven.stdout).toContain('hermes_reviewer_isolation=PROVEN');
    expect(proven.stdout).toContain('proof_network_refusals=2');

    const missing = run(['verify', join(dir, 'absent.json'), 'xai', 'grok-build-0.1', '90']);
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe('');
    expect(missing.stderr.trim()).toBe('reviewer_isolation_unproven:no_record');

    writeFileSync(join(dir, 'before.json'), JSON.stringify(BEFORE));
    const before = run(['verify', join(dir, 'before.json'), 'xai', 'grok-build-0.1', '90']);
    expect(before.status).toBe(1);
    expect(before.stderr).toContain('reviewer_holds_tools:clarify,delegate_task,execute_code');
  });
});

const bootstrapText = read(BOOTSTRAP);
const PROOF_START = bootstrapText.indexOf('isolation_hook_source="$(pwd -P)');
const PROOF_END = bootstrapText.indexOf('HERMES_BOOTSTRAP_EVIDENCE=${HERMES_BOOTSTRAP_EVIDENCE');
/** The proof's commands: from the recorder's source path to the evidence block. */
const PROOF_BLOCK = bootstrapText.slice(PROOF_START, PROOF_END);
const withoutComments = (text: string): string => text.split('\n').filter((line) => !/^\s*#/u.test(line)).join('\n');

describe('the bootstrap proves isolation on the path the review takes', () => {
  const bootstrap = bootstrapText;
  const reviewer = read('relay-bridge/hermes-reviewer.ts');
  const proofAt = bootstrap.indexOf('"$HERMES_WRAPPER_DIR/hermes" -z');
  const proofBlock = PROOF_BLOCK;

  it('finds the proof it is about to hold to account', () => {
    expect(PROOF_START).toBeGreaterThan(-1);
    expect(PROOF_END).toBeGreaterThan(PROOF_START);
  });

  it('renders the profile from the policy module instead of a heredoc of its own', () => {
    expect(bootstrap).toContain('node scripts/julius-reviewer-isolation.mjs config "$HERMES_PROVIDER" "$HERMES_REQUEST_TIMEOUT_SECONDS"');
    expect(bootstrap).not.toContain('<<CONFIG');
  });

  it('runs the wrapper it just wrote, after the profile and before the evidence, and refuses the job on a refusal', () => {
    expect(proofAt, 'the proof runs the wrapper, not the Hermes binary beside it').toBeGreaterThan(-1);
    expect(proofAt).toBeGreaterThan(bootstrap.indexOf('cat > "$HERMES_WRAPPER_DIR/hermes"'));
    expect(proofAt).toBeGreaterThan(bootstrap.indexOf('julius-reviewer-isolation.mjs config'));
    expect(proofAt).toBeLessThan(bootstrap.indexOf('HERMES_BOOTSTRAP_EVIDENCE=${HERMES_BOOTSTRAP_EVIDENCE'));
    expect(bootstrap).toMatch(/reviewer_isolation="\$\(node scripts\/julius-reviewer-isolation\.mjs verify [^)]*\)" \|\| \{[^}]*exit 1; \}/u);
    expect(bootstrap).toContain('echo "$reviewer_isolation"');
  });

  it('gives the proof the reviewer child environment, plus only the hook and its record', () => {
    // runHermesReview spawns with PATH and HOME and nothing else; if that ever
    // changes, the proof below is proving a different environment.
    expect(reviewer).toMatch(/env: \{ PATH: process\.env\.PATH \?\? '', HOME: process\.env\.HOME \?\? '' \}/u);
    const assignments = [...proofBlock.matchAll(/\s([A-Z_]+)="/gu)].map((match) => match[1]);
    expect(proofBlock).toContain('exec env -i PATH="$PATH" HOME="$HOME"');
    expect(new Set(assignments)).toEqual(new Set(['PATH', 'HOME', 'PYTHONPATH', 'RELAY_REVIEWER_ISOLATION_RECORD']));
  });

  it('passes the flags runHermesReview passes, from an empty scratch directory, with the record outside it', () => {
    expect(reviewer).toContain("const args = ['-z', prompt, '--safe-mode', '--usage-file', usageFilePath];");
    expect(reviewer).toContain("const usageFilePath = join(cwd, 'relay-hermes-usage.json');");
    expect(reviewer).toContain("if (cfg.model) args.push('-m', cfg.model);");
    expect(reviewer).toContain("if (cfg.provider) args.push('--provider', cfg.provider);");
    expect(proofBlock).toContain('--safe-mode --usage-file "$isolation_cwd/relay-hermes-usage.json"');
    expect(proofBlock).toContain('-m "$RELAY_HERMES_MODEL" --provider "$HERMES_PROVIDER"');
    expect(proofBlock).toContain('isolation_cwd="$(mktemp -d)"');
    expect(proofBlock).toContain('cd "$isolation_cwd"');
    expect(proofBlock).toContain('RELAY_REVIEWER_ISOLATION_RECORD="$isolation_dir/record.json"');
    expect(bootstrap).toMatch(/^: "\$\{RELAY_HERMES_MODEL:\?missing RELAY_HERMES_MODEL\}"$/mu);
  });

  it('loads a hook that exists, reads the record variable the bootstrap sets, and records every fact the verdict reads', () => {
    expect(proofBlock).toContain('isolation_hook_source="$(pwd -P)/.github/julius-live-hermes-isolation/sitecustomize.py"');
    expect(existsSync(join(ROOT, HOOK))).toBe(true);
    const hook = read(HOOK);
    expect(hook).toContain('os.environ.get("RELAY_REVIEWER_ISOLATION_RECORD", "")');
    expect(hook, 'without its variable the recorder installs nothing').toMatch(/\nif _RECORD_PATH:\n {4}_install\(\)\n?$/u);
    for (const field of REVIEWER_ISOLATION_RECORD_FIELDS) {
      expect(hook, `the hook never records ${field}`).toMatch(new RegExp(`"${field}"`, 'u'));
    }
  });
});

/**
 * A RECORDER THAT REACHED THE PAID REVIEW WOULD ITSELF BE A PATCHED AGENT.
 *
 * The proof patches Hermes on purpose, for one command. These cases hold that
 * the patch cannot follow the wrapper into a real review: the wrapper names
 * none of it, the variables that load it appear nowhere but the proof, nothing
 * on the paid review path mentions it, and the copy it runs from lives in a
 * fresh directory that is neither the profile nor the wrapper's and is removed
 * whatever the verdict.
 */
describe('the recorder can never reach the paid review', () => {
  const wrapperStart = bootstrapText.indexOf('cat > "$HERMES_WRAPPER_DIR/hermes" <<WRAPPER');
  const wrapper = bootstrapText.slice(wrapperStart, bootstrapText.indexOf('\nWRAPPER\n', wrapperStart) + '\nWRAPPER\n'.length);

  it('the wrapper Julius spawns for real reviews sets HOME and HERMES_HOME and nothing else', () => {
    expect(wrapperStart).toBeGreaterThan(-1);
    const execLines = wrapper.split('\n').filter((line) => line.startsWith('exec '));
    expect(execLines).toEqual(['exec env HOME="$HERMES_PROFILE_HOME" HERMES_HOME="$HERMES_PROFILE_HOME/.hermes" "$HERMES_BIN" "\\$@"']);
    for (const forbidden of ['PYTHONPATH', 'RELAY_REVIEWER_ISOLATION', 'sitecustomize', 'isolation']) {
      expect(wrapper, `the wrapper must not mention ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the variables that load the recorder appear in the bootstrap only inside the proof', () => {
    const outside = withoutComments(bootstrapText.slice(0, PROOF_START)) + withoutComments(bootstrapText.slice(PROOF_END));
    for (const name of ['PYTHONPATH', 'RELAY_REVIEWER_ISOLATION', 'sitecustomize']) {
      expect(outside, `${name} outside the proof`).not.toContain(name);
    }
  });

  it('nothing on the paid review path mentions the recorder', () => {
    for (const path of [
      '.github/workflows/julius-first-live-mission.yml',
      'relay-bridge/hermes-reviewer.ts',
      'relay-bridge/julius/live-workers.ts',
      'relay-bridge/julius/live-composition.ts',
    ]) {
      const text = read(path);
      for (const name of ['PYTHONPATH', 'RELAY_REVIEWER_ISOLATION', 'julius-live-hermes-isolation', 'sitecustomize']) {
        expect(text, `${path} mentions ${name}`).not.toContain(name);
      }
    }
    // A job-wide TMPDIR could put the proof's fresh directories somewhere shared.
    expect(read('.github/workflows/julius-first-live-mission.yml')).not.toContain('TMPDIR');
  });

  it('runs the recorder from a copy in a fresh directory outside the profile and the wrapper, removed on every path', () => {
    expect(PROOF_BLOCK).toContain('isolation_dir="$(mktemp -d)"');
    expect(PROOF_BLOCK).toContain('isolation_cwd="$(mktemp -d)"');
    expect(PROOF_BLOCK).toContain('cp "$isolation_hook_source" "$isolation_dir/hook/sitecustomize.py"');
    expect(PROOF_BLOCK).toContain('PYTHONPATH="$isolation_dir/hook"');
    const assignments = PROOF_BLOCK.split('\n').filter((line) => /^isolation_[a-z_]+=/u.test(line));
    expect(assignments.length).toBe(3);
    for (const line of assignments) {
      expect(line, 'no proof path may be derived from the profile').not.toContain('HERMES_PROFILE_HOME');
      expect(line, 'or from the wrapper directory').not.toContain('HERMES_WRAPPER_DIR');
    }
    expect(PROOF_BLOCK.match(/rm -rf "\$isolation_dir" "\$isolation_cwd"/gu), 'on refusal and on success').toHaveLength(2);
    expect(withoutComments(PROOF_BLOCK)).not.toMatch(/HERMES_PROFILE_HOME/u);
  });
});

/**
 * THE PROOF RUNS ON A DRY RUN, and its line reaches the bundle a receipt quotes.
 *
 * A proof that only a paid dispatch reached would first be seen by the run it
 * was meant to protect. It is part of the Hermes bootstrap step, which carries
 * no condition, so every dispatch runs it before the roles check, the dry-run
 * stop and anything that can reach a provider.
 */
describe('the proof runs on every dispatch and its line reaches the evidence', () => {
  const workflow = read('.github/workflows/julius-first-live-mission.yml');
  const step = (name: string): { start: number; body: string } => {
    const start = workflow.indexOf(`- name: ${name}`);
    const rest = workflow.slice(start);
    return { start, body: rest.slice(0, rest.indexOf('\n      - ', 1)) };
  };

  it('is part of the unconditional Hermes bootstrap step, before the roles check, the dry-run stop and LIVE', () => {
    const hermes = step("'Preflight: install Hermes and bootstrap the ephemeral reviewer profile'");
    expect(hermes.start).toBeGreaterThan(-1);
    expect(hermes.body).toContain('run: ./.github/julius-live-hermes.sh');
    expect(hermes.body, 'a condition here could skip the proof on a dry run').not.toMatch(/^\s*if:/mu);
    for (const later of [
      "'Preflight: all three roles resolve to the expected models, nothing dispatched'",
      "'Preflight complete — stopping here (no confirm_live given)'",
      "'Record that a paid mission was attempted (before any provider can be reached)'",
      "'LIVE: run the first real Julius mission'",
    ]) {
      const at = workflow.indexOf(`- name: ${later}`);
      expect(at, later).toBeGreaterThan(-1);
      expect(hermes.start, `the proof must precede ${later}`).toBeLessThan(at);
    }
    expect(step("'Preflight complete — stopping here (no confirm_live given)'").body).toContain("if: inputs.confirm_live != 'RUN LIVE MISSION'");
  });

  it('writes the verdict into the file the evidence step copies whole, and the credential scan passes it', () => {
    expect(bootstrapText).toContain('HERMES_BOOTSTRAP_EVIDENCE=${HERMES_BOOTSTRAP_EVIDENCE:-/tmp/julius-hermes-bootstrap.evidence.txt}');
    const evidenceBlock = bootstrapText.slice(PROOF_END);
    expect(evidenceBlock.indexOf('echo "$reviewer_isolation"')).toBeLessThan(evidenceBlock.indexOf('| tee "$HERMES_BOOTSTRAP_EVIDENCE"'));
    const collect = step('Collect the redacted validation evidence');
    expect(collect.body).toMatch(/if:\s*always\(\)/u);
    expect(collect.body).toContain('cp /tmp/julius-hermes-bootstrap.evidence.txt \\\n            julius-live-evidence/hermes-bootstrap.evidence.txt');
    // The scan's shape layer, read from the workflow rather than retyped.
    const shape = /grep -rEq '([^']+)' julius-live-evidence/u.exec(workflow)?.[1];
    expect(shape).toBeDefined();
    const verdict = verifyReviewerIsolation(PROVEN, EXPECTED);
    expect(verdict.ok).toBe(true);
    const line = verdict.ok ? verdict.evidence : '';
    expect(line.startsWith('hermes_reviewer_isolation=PROVEN ')).toBe(true);
    expect(new RegExp(shape!.replaceAll('[[:space:]]', '\\s'), 'u').test(line)).toBe(false);
  });
});

/**
 * THE HOOK, AGAINST A HERMES SMALL ENOUGH TO READ.
 *
 * The real proof needs the pinned Hermes, which only the bootstrap installs
 * (`scripts/julius-reviewer-isolation-proof.sh` runs it in a container). These
 * cases hold the hook's own contract against a stand-in with the same module
 * names: it records and never lets the conversation run, it closes the
 * network, a Python child cannot overwrite the record, a Hermes that never
 * builds an agent is recorded as such, and without its variable it does
 * nothing at all.
 */
describe('the proof hook', () => {
  const python = ['python3', 'python'].find((candidate) => spawnSync(candidate, ['-c', 'import sys; assert sys.version_info >= (3, 8)']).status === 0);

  const fakeHermes = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-fake-hermes-'));
    mkdirSync(join(dir, 'hermes_cli'));
    mkdirSync(join(dir, 'agent'));
    writeFileSync(join(dir, 'hermes_cli', '__init__.py'), '');
    writeFileSync(join(dir, 'agent', '__init__.py'), '');
    writeFileSync(join(dir, 'agent', 'shell_hooks.py'), '_registered = set()\n');
    writeFileSync(join(dir, 'hermes_cli', 'config.py'), 'def load_config():\n    return {}\n');
    writeFileSync(join(dir, 'hermes_cli', 'tools_config.py'), [
      'import os',
      'def _get_platform_tools(cfg, platform):',
      '    return set(filter(None, os.environ.get("FAKE_TOOLSETS", "").split(",")))',
    ].join('\n'));
    writeFileSync(join(dir, 'hermes_cli', 'timeouts.py'), [
      'def get_provider_request_timeout(provider, model=None):',
      '    return 90.0',
      'def get_provider_stale_timeout(provider, model=None):',
      '    return 90.0',
    ].join('\n'));
    writeFileSync(join(dir, 'run_agent.py'), [
      'import os, socket',
      'class AIAgent:',
      '    def __init__(self):',
      '        names = list(filter(None, os.environ.get("FAKE_TOOLS", "").split(",")))',
      '        self.tools = [{"type": "function", "function": {"name": n}} for n in names]',
      '        self.valid_tool_names = set(names)',
      '        self.enabled_toolsets = sorted(filter(None, os.environ.get("FAKE_TOOLSETS", "").split(",")))',
      '        self.provider, self.model = "xai", "grok-build-0.1"',
      '        self._api_max_retries, self.max_iterations = 1, 90',
      '    def run_conversation(self, message):',
      '        open(os.environ["FAKE_CONVERSATION_MARK"], "w").write("the model was asked")',
      '        return {"final_response": "a real answer"}',
    ].join('\n'));
    writeFileSync(join(dir, 'fake_hermes.py'), [
      'import os, socket, subprocess, sys',
      'if "--safe-mode" in sys.argv:',
      '    os.environ["HERMES_SAFE_MODE"] = "1"',
      '# Loopback only: the case without the hook must not reach anything either.',
      'try:',
      '    socket.create_connection(("127.0.0.1", 9), timeout=2)',
      '    print("NETWORK OPEN")',
      'except OSError as exc:',
      '    print("network refused:", type(exc).__name__)',
      'child = [sys.executable, "-c", "import socket\\ntry:\\n socket.getaddrinfo(\'localhost\', 443)\\nexcept OSError:\\n pass"]',
      'subprocess.run(child, check=True)',
      'if os.environ.get("FAKE_NEVER_BUILDS"):',
      '    sys.exit(3)',
      'from run_agent import AIAgent',
      'print(AIAgent().run_conversation("proof")["final_response"])',
      '# A Python child that outlives the capture must not overwrite the record.',
      'subprocess.run(child, check=True)',
    ].join('\n'));
    return dir;
  };

  const runHook = (env: Record<string, string>, withRecordVariable = true, flags: string[] = ['--safe-mode']) => {
    const hermes = fakeHermes();
    const work = mkdtempSync(join(tmpdir(), 'julius-hook-proof-'));
    const record = join(work, 'record.json');
    const mark = join(work, 'conversation-ran');
    // A copy, as the bootstrap runs it, so Python's bytecode never lands in the checkout.
    const hook = mkdtempSync(join(tmpdir(), 'julius-hook-copy-'));
    writeFileSync(join(hook, 'sitecustomize.py'), read(HOOK));
    const result = spawnSync(python!, [join(hermes, 'fake_hermes.py'), '-z', 'proof', ...flags], {
      cwd: work,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        SYSTEMROOT: process.env.SYSTEMROOT ?? '',
        PYTHONPATH: [hook, hermes].join(delimiter),
        FAKE_CONVERSATION_MARK: mark,
        ...(withRecordVariable ? { RELAY_REVIEWER_ISOLATION_RECORD: record } : {}),
        ...env,
      },
    });
    const parsed = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) as Record<string, unknown> : null;
    return { result, record: parsed, conversationRan: existsSync(mark), dir: work };
  };

  it('has a Python to run under', () => {
    expect(python, 'the hook is Python; these cases need python3 or python on PATH').toBeDefined();
  });

  it('records what the agent was built with and never lets the conversation run', () => {
    const { result, record, conversationRan } = runHook({ FAKE_TOOLS: 'terminal,write_file', FAKE_TOOLSETS: 'terminal,file' });
    expect(result.stdout).toContain('RELAY_REVIEWER_ISOLATION_PROOF_CAPTURED');
    expect(conversationRan, 'the hook must return before a model is asked anything').toBe(false);
    expect(record).toMatchObject({
      reached: true, network_guard_verified: true, safe_mode: true, shell_hooks_registered: 0,
      model_visible_tools: ['terminal', 'write_file'], valid_tool_names: ['terminal', 'write_file'],
      agent_enabled_toolsets: ['file', 'terminal'], resolved_cli_toolsets: ['file', 'terminal'],
      api_attempts: 1, request_timeout_seconds: 90, stale_timeout_seconds: 90, provider: 'xai', model: 'grok-build-0.1',
    });
    expect(verifyReviewerIsolation(record, EXPECTED)).toEqual({ ok: false, reason: 'reviewer_holds_tools:terminal,write_file' });
  }, 30_000);

  it('closes the network, and a Python child it starts can neither reach it nor overwrite the record', () => {
    const { result, record, dir } = runHook({});
    expect(result.stdout).toContain('network refused: _NetworkRefused');
    expect(result.stdout).not.toContain('NETWORK OPEN');
    expect(record?.network_refused).toEqual(["create_connection:('127.0.0.1', 9)"]);
    // The second child exited after the capture; the record is still the capture.
    expect(record?.reached).toBe(true);
    const { sideRecords } = readIsolationRecords(join(dir, 'record.json'));
    expect(sideRecords).toEqual([{ network_refused: ["getaddrinfo:'localhost'"] }, { network_refused: ["getaddrinfo:'localhost'"] }]);
    expect(verifyReviewerIsolation(record, EXPECTED, sideRecords)).toMatchObject({ ok: true });
  }, 30_000);

  it('reads safe mode from the environment Hermes set, so a run without the flag says so', () => {
    const { record } = runHook({}, true, []);
    expect(record?.safe_mode).toBe(false);
    expect(verifyReviewerIsolation(record, EXPECTED)).toEqual({ ok: false, reason: 'reviewer_safe_mode_off' });
  }, 30_000);

  it('records a Hermes that never built an agent as exactly that', () => {
    const { result, record } = runHook({ FAKE_NEVER_BUILDS: '1' });
    expect(result.status).toBe(3);
    expect(record).toEqual({ reached: false, network_guard_verified: true, network_refused: ["create_connection:('127.0.0.1', 9)"] });
  }, 30_000);

  it('does nothing at all without its variable', () => {
    const { result, record, conversationRan } = runHook({}, false);
    expect(record).toBeNull();
    expect(conversationRan).toBe(true);
    expect(result.stdout).toContain('a real answer');
    expect(result.stdout).not.toContain('_NetworkRefused');
  }, 30_000);
});

/**
 * THE CONTAINER PROOF BREAKS WHAT IT SAYS IT BREAKS.
 *
 * `scripts/julius-reviewer-isolation-proof.sh` expects each mutated bootstrap to
 * be refused. A mutation that silently stopped applying would turn a refusal
 * case into a failure the proof reports, but only when someone runs it; these
 * cases apply every mutation to the files as they are now.
 */
describe('the container proof breaks what it says it breaks', () => {
  const mutation = (name: string) => {
    const found = ISOLATION_PROOF_MUTATIONS.find((candidate) => candidate.name === name);
    expect(found, name).toBeDefined();
    return found!;
  };

  it('restores the pre-fix heredoc verbatim, with the proof and its verdict still in place', () => {
    const before = mutation('before-this-change');
    const mutated = before.apply(read(before.file));
    expect(mutated).toContain(PROFILE_HEREDOC_BEFORE_ISOLATION);
    expect(PROFILE_HEREDOC_BEFORE_ISOLATION).not.toContain('disabled_toolsets');
    expect(mutated).not.toContain('julius-reviewer-isolation.mjs config');
    expect(mutated).toContain('node scripts/julius-reviewer-isolation.mjs verify');
    expect(mutated).toContain('"$HERMES_WRAPPER_DIR/hermes" -z');
    expect(mutated).toContain('chmod 0600 "$HERMES_PROFILE_HOME/.hermes/config.yaml"');
  });

  it('takes kanban off the list and nothing else', () => {
    const withoutKanban = mutation('without-kanban');
    const original = read(withoutKanban.file);
    const mutated = withoutKanban.apply(original);
    expect(original.length - mutated.length).toBe(" 'kanban',".length);
    expect(mutated).not.toContain("'kanban'");
  });

  it('drops --safe-mode from the proof command only', () => {
    const withoutSafeMode = mutation('without-safe-mode');
    const original = read(withoutSafeMode.file);
    const mutated = withoutSafeMode.apply(original);
    expect(original.split('--safe-mode').length - mutated.split('--safe-mode').length).toBe(1);
    expect(mutated).toContain('--usage-file "$isolation_cwd/relay-hermes-usage.json"');
  });

  it('refuses to apply when its anchor is gone', () => {
    for (const each of ISOLATION_PROOF_MUTATIONS) {
      expect(() => each.apply('nothing to anchor on'), each.name).toThrow(`isolation_proof_mutation_anchor_missing:${each.name}`);
    }
  });

  it('is run in full by the proof script, whose header names each mutation and its refusal', () => {
    const script = read('scripts/julius-reviewer-isolation-proof.sh');
    expect(script).toContain('mutations=$(node scripts/julius-reviewer-isolation-proof-mutations.mjs list)');
    expect(script).toContain('scripts/julius-reviewer-isolation-proof-mutations.mjs; do');
    for (const each of ISOLATION_PROOF_MUTATIONS) {
      expect(script, each.name).toMatch(new RegExp(`^#\\s+${each.name}\\s`, 'mu'));
      expect(script, each.refusal).toContain(`-> ${each.refusal}`);
    }
    const listed = execFileSync(process.execPath, [join(ROOT, 'scripts/julius-reviewer-isolation-proof-mutations.mjs'), 'list'], { encoding: 'utf8' });
    expect(listed.trim().split('\n')).toEqual(ISOLATION_PROOF_MUTATIONS.map((each) => `${each.name}\t${each.refusal}`));
  });
});

describe('what the proof leaves behind', () => {
  it('keeps Hermes output and the raw record out of the log, and the policy module holds no credential', () => {
    expect(PROOF_BLOCK).toContain(') >/dev/null 2>&1 || true');
    expect(bootstrapText).not.toMatch(/cat "\$isolation_dir/u);
    expect(execFileSync(process.execPath, [MODULE, 'config', 'xai', '90'], { encoding: 'utf8' })).not.toMatch(/API_KEY|secret|token/iu);
  });
});
