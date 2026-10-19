import { execFileSync } from 'node:child_process';
import {
  copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  juliusHostedToolAuthority,
  type HostedHookOutput,
  type HostedToolDecision,
} from './hosted-tool-authority';
import { runHostedCodingAgent, type HostedQueryFn } from './hosted-runner';
import { JULIUS_FILE_AUTHORITY_REFUSALS } from '../../src/relay/mission/julius/julius-file-authority';

/**
 * THE AUTHORITY, AGAINST A REAL DIRECTORY.
 *
 * Every case calls the hook exactly as the SDK does -- `tool_name` plus the
 * tool's own input, with the ABSOLUTE `file_path` Claude Code's file tools send
 * -- against a real temporary workspace, with a real directory OUTSIDE it and a
 * real junction (a symlink on POSIX) planted inside it. A suite that used only
 * relative paths would have passed an authority that refuses every real call.
 *
 * The describe blocks numbered 1-13 are the founder's Priority 10 confinement
 * matrix, one block per required proof.
 */

let base: string;
let workspace: string;
let outside: string;
let decisions: HostedToolDecision[];

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'julius-authority-')));
  workspace = join(base, 'ws');
  outside = join(base, 'outside');
  for (const dir of ['src', '.git/hooks', '.claude', '.github/workflows', '.julius', 'packages/lib/.git']) {
    mkdirSync(join(workspace, ...dir.split('/')), { recursive: true });
  }
  mkdirSync(outside, { recursive: true });
  const files: Array<[string, string]> = [
    ['src/app.ts', 'export const app = 1;\n'], ['.git/config', '[core]\n'], ['packages/lib/.git/config', '[core]\n'],
    ['.claude/settings.json', '{}\n'], ['.github/workflows/ci.yml', 'on: push\n'], ['.github/CODEOWNERS', '* @owner\n'],
    ['.julius/loader.mjs', 'export {};\n'], ['.env', 'TOKEN=x\n'], ['.env.example', 'TOKEN=\n'], ['.npmrc', '//registry/:_authToken=x\n'],
  ];
  for (const [path, content] of files) writeFileSync(join(workspace, ...path.split('/')), content);
  writeFileSync(join(outside, 'secret.txt'), 'the host is not the workspace\n');
  decisions = [];
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const hook = (workspacePath: string = workspace, signal?: AbortSignal) =>
  juliusHostedToolAuthority({ workspacePath, record: (decision) => decisions.push(decision), ...(signal === undefined ? {} : { signal }) });

const call = async (toolName: string, toolInput: Record<string, unknown>, sdkSignal?: AbortSignal) =>
  hook()({ hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput }, 'toolu_test',
    sdkSignal === undefined ? undefined : { signal: sdkSignal });

/** The refusal's NAME, or null when the hook had no objection. */
const refusalOf = (output: HostedHookOutput): string | null =>
  ('hookSpecificOutput' in output && output.hookSpecificOutput.permissionDecision === 'deny')
    ? output.hookSpecificOutput.permissionDecisionReason.split(':')[0] ?? null
    : null;

/** The whole reason the model is shown, or null. */
const reasonOf = (output: HostedHookOutput): string | null =>
  'hookSpecificOutput' in output ? output.hookSpecificOutput.permissionDecisionReason : null;

const ws = (...segments: string[]) => join(workspace, ...segments);

describe('1. an in-workspace Read is allowed', () => {
  it('by the absolute path the runtime sends, by a relative spelling, and inside `.git` (reading is not changing)', async () => {
    expect(await call('Read', { file_path: ws('src', 'app.ts') })).toEqual({});
    expect(await call('Read', { file_path: 'src/app.ts' })).toEqual({});
    expect(await call('Read', { file_path: ws('.git', 'config') })).toEqual({});
    expect(await call('LS', { path: workspace })).toEqual({});
    // Allowed reads are confined, not recorded.
    expect(decisions).toEqual([]);
  });
});

describe('2. an in-workspace Edit is allowed', () => {
  it('for every edit tool, and every allowed edit is recorded by its workspace-relative path', async () => {
    expect(await call('Edit', { file_path: ws('src', 'app.ts'), old_string: '1', new_string: '2' })).toEqual({});
    expect(await call('MultiEdit', { file_path: 'src/app.ts', edits: [] })).toEqual({});
    expect(decisions.map((d) => [d.tool, d.allowed, d.path, d.refusal])).toEqual([
      ['Edit', true, 'src/app.ts', null], ['MultiEdit', true, 'src/app.ts', null],
    ]);
  });
});

describe('3. an outside-workspace Read is refused', () => {
  it('for every reading and searching tool', async () => {
    const target = join(outside, 'secret.txt');
    expect(refusalOf(await call('Read', { file_path: target }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('NotebookRead', { notebook_path: target }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('LS', { path: outside }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Grep', { pattern: 'secret', path: outside }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Glob', { pattern: '*.txt', path: outside }))).toBe('path_outside_workspace');
  });
});

describe('4. an outside-workspace Edit is refused', () => {
  it('for every edit tool, and for the creation tool before it is refused for being one', async () => {
    const target = join(outside, 'secret.txt');
    expect(refusalOf(await call('Edit', { file_path: target, old_string: 'host', new_string: 'x' }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('MultiEdit', { file_path: target, edits: [] }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('NotebookEdit', { notebook_path: join(outside, 'n.ipynb'), new_source: 'x' }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Write', { file_path: join(outside, 'planted.ts'), content: 'x' }))).toBe('path_outside_workspace');
    expect(readFileSync(target, 'utf8')).toBe('the host is not the workspace\n');
  });
});

describe('5. `..` traversal is refused', () => {
  it('whatever it would resolve to -- including a traversal that lands back inside', async () => {
    expect(refusalOf(await call('Read', { file_path: '../outside/secret.txt' }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Read', { file_path: `${workspace}/src/../../outside/secret.txt` }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Edit', { file_path: 'src/../src/app.ts', old_string: '1', new_string: '2' }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Edit', { file_path: 'src\\..\\..\\outside\\secret.txt', old_string: 'a', new_string: 'b' }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Glob', { pattern: '../**/*.txt' }))).toBe('glob_outside_workspace');
    expect(refusalOf(await call('Grep', { pattern: 'x', glob: 'src/../../**' }))).toBe('glob_outside_workspace');
  });
});

describe('6. an absolute external path is refused', () => {
  it('the checkout this bridge runs from -- the reviewer and the evidence scripts -- cannot be read or changed', async () => {
    const checkout = process.cwd();
    expect(refusalOf(await call('Read', { file_path: join(checkout, 'package.json') }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Edit', {
      file_path: join(checkout, '.github', 'julius-live-evidence-dump.sh'), old_string: 'dump', new_string: 'x',
    }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Grep', { pattern: 'API_KEY', path: checkout }))).toBe('path_outside_workspace');
  });

  it('the parent process environment, the filesystem root and a glob rooted outside are refused', async () => {
    expect(refusalOf(await call('Read', { file_path: '/proc/self/environ' }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Read', { file_path: '/etc/passwd' }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('LS', { path: '/' }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Glob', { pattern: '/etc/**' }))).toBe('glob_outside_workspace');
    expect(refusalOf(await call('Glob', { pattern: `${outside}/**/*.txt` }))).toBe('glob_outside_workspace');
    expect(refusalOf(await call('Grep', { pattern: 'x', glob: '~/.ssh/*' }))).toBe('glob_outside_workspace');
    // CONTROL: an absolute glob rooted INSIDE the workspace is a search of the workspace.
    expect(await call('Glob', { pattern: `${workspace}/src/**/*.ts` })).toEqual({});
  });

  it('a call is judged by EVERY path it names, not only the first', async () => {
    expect(refusalOf(await call('Read', { file_path: ws('src', 'app.ts'), path: outside }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('SomeFutureTool', { path: join(outside, 'secret.txt') }))).toBe('path_outside_workspace');
  });
});

describe('7. a path that looks inside but resolves through a junction or symlink outside is refused', () => {
  it('a directory junction (a symlink on POSIX) planted inside the workspace does not reach outside it', async () => {
    // A junction needs no privilege on Windows; on POSIX the type argument is ignored.
    symlinkSync(outside, ws('src', 'escape'), 'junction');
    expect(refusalOf(await call('Read', { file_path: ws('src', 'escape', 'secret.txt') }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Read', { file_path: 'src/escape/secret.txt' }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Edit', { file_path: ws('src', 'escape', 'secret.txt'), old_string: 'host', new_string: 'x' }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Glob', { pattern: '*', path: ws('src', 'escape') }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Grep', { pattern: 'secret', path: ws('src', 'escape') }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Write', { file_path: ws('src', 'escape', 'new.ts'), content: 'x' }))).toBe('path_outside_workspace');
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('the host is not the workspace\n');
  });

  it('a DANGLING link is refused rather than guessed at', async () => {
    symlinkSync(join(base, 'not-yet'), ws('src', 'dangling'), 'junction');
    expect(refusalOf(await call('Edit', { file_path: ws('src', 'dangling', 'x.ts'), old_string: 'a', new_string: 'b' }))).toBe('path_outside_workspace');
  });

  it('CONTROL: a workspace REACHED through a junction still admits every path inside it', async () => {
    const alias = join(base, 'alias');
    symlinkSync(workspace, alias, 'junction');
    const viaAlias = juliusHostedToolAuthority({ workspacePath: alias });
    expect(await viaAlias({ tool_name: 'Edit', tool_input: { file_path: join(alias, 'src', 'app.ts'), old_string: '1', new_string: '2' } })).toEqual({});
    expect(await viaAlias({ tool_name: 'Read', tool_input: { file_path: ws('src', 'app.ts') } })).toEqual({});
  });
});

describe('8. `.git` control locations are refused', () => {
  it('for every edit tool, at any depth, and in ANY case', async () => {
    expect(refusalOf(await call('Edit', { file_path: ws('.git', 'config'), old_string: '[core]', new_string: '[core]\n\tfsmonitor = x' }))).toBe('path_control_location');
    expect(refusalOf(await call('MultiEdit', { file_path: ws('.GIT', 'hooks', 'pre-commit'), edits: [] }))).toBe('path_control_location');
    expect(refusalOf(await call('Edit', { file_path: ws('packages', 'lib', '.git', 'config'), old_string: 'a', new_string: 'b' }))).toBe('path_control_location');
    expect(refusalOf(await call('NotebookEdit', { notebook_path: ws('.git', 'x.ipynb'), new_source: 'x' }))).toBe('path_control_location');
    expect(readFileSync(ws('.git', 'config'), 'utf8')).toBe('[core]\n');
  });
});

describe('9. `.claude` and the other control locations are refused', () => {
  it('settings a later Claude Code session would load, hook directories, and the harness the final check runs', async () => {
    expect(refusalOf(await call('Edit', { file_path: ws('.claude', 'settings.json'), old_string: '{}', new_string: '{"hooks":{}}' }))).toBe('path_control_location');
    expect(refusalOf(await call('Edit', { file_path: ws('.Claude', 'settings.json'), old_string: '{}', new_string: 'x' }))).toBe('path_control_location');
    expect(refusalOf(await call('Edit', { file_path: ws('.julius', 'loader.mjs'), old_string: 'export', new_string: 'x' }))).toBe('path_control_location');
    expect(refusalOf(await call('Edit', { file_path: ws('.husky', 'pre-commit'), old_string: 'a', new_string: 'b' }))).toBe('path_control_location');
    expect(refusalOf(await call('Edit', { file_path: ws('node_modules', 'pkg', 'index.js'), old_string: 'a', new_string: 'b' }))).toBe('path_control_location');
  });
});

describe('10. a CI workflow cannot be changed; the rest of `.github` can', () => {
  it('refuses the workflow directory in any case, and admits CODEOWNERS', async () => {
    expect(refusalOf(await call('Edit', { file_path: ws('.github', 'workflows', 'ci.yml'), old_string: 'push', new_string: 'x' }))).toBe('path_workflow_location');
    expect(refusalOf(await call('Edit', { file_path: ws('.GitHub', 'Workflows', 'ci.yml'), old_string: 'push', new_string: 'x' }))).toBe('path_workflow_location');
    expect(await call('Edit', { file_path: ws('.github', 'CODEOWNERS'), old_string: '@owner', new_string: '@other' })).toEqual({});
  });
});

describe('11. credential locations are refused', () => {
  it('inside the workspace for every edit, while their documentation stays editable', async () => {
    expect(refusalOf(await call('Edit', { file_path: ws('.env'), old_string: 'x', new_string: 'y' }))).toBe('path_credential_location');
    expect(refusalOf(await call('Edit', { file_path: ws('.npmrc'), old_string: 'x', new_string: 'y' }))).toBe('path_credential_location');
    expect(refusalOf(await call('Edit', { file_path: ws('.ssh', 'id_rsa'), old_string: 'x', new_string: 'y' }))).toBe('path_credential_location');
    expect(refusalOf(await call('Edit', { file_path: ws('.aws', 'credentials'), old_string: 'x', new_string: 'y' }))).toBe('path_credential_location');
    expect(await call('Edit', { file_path: ws('.env.example'), old_string: 'TOKEN=', new_string: 'TOKEN=<value>' })).toEqual({});
  });

  it('and the host\'s own credential stores are outside the workspace, so they cannot even be read', async () => {
    expect(refusalOf(await call('Read', { file_path: join(homedir(), '.ssh', 'id_rsa') }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Read', { file_path: join(homedir(), '.claude', '.credentials.json') }))).toBe('path_outside_workspace');
    expect(refusalOf(await call('Read', { file_path: join(homedir(), '.config', 'julius', 'julius-worker.pem') }))).toBe('path_outside_workspace');
  });
});

describe('12. no host path reaches a record or a reason', () => {
  it('an outside request is recorded as outside, never by the path it named, and the reason the model sees names none', async () => {
    symlinkSync(outside, ws('src', 'escape'), 'junction');
    const outputs = [
      await call('Read', { file_path: join(outside, 'secret.txt') }),
      await call('Read', { file_path: ws('src', 'escape', 'secret.txt') }),
      await call('Edit', { file_path: join(process.cwd(), 'package.json'), old_string: 'a', new_string: 'b' }),
      await call('Read', { file_path: join(homedir(), '.ssh', 'id_rsa') }),
      await call('Glob', { pattern: `${outside}/**` }),
      await call('Edit', { file_path: ws('.git', 'config'), old_string: 'a', new_string: 'b' }),
      await call('Write', { file_path: ws('src', 'new.ts'), content: 'x' }),
    ];
    const reasons = outputs.map(reasonOf);
    expect(reasons.every((reason) => reason !== null)).toBe(true);
    const everything = JSON.stringify({ decisions, reasons });
    for (const hostPath of [base, workspace, outside, process.cwd(), homedir()]) {
      expect(everything, hostPath).not.toContain(hostPath);
      expect(everything, hostPath).not.toContain(hostPath.replace(/\\/gu, '/'));
      expect(everything, hostPath).not.toContain(JSON.stringify(hostPath).slice(1, -1));
    }
    expect(decisions.filter((d) => d.refusal === 'path_outside_workspace').every((d) => d.path === null)).toBe(true);
    expect(decisions.find((d) => d.refusal === 'path_control_location')).toMatchObject({ path: '.git/config' });
  });
});

describe('the creation tool, cancellation, and a workspace that cannot be found', () => {
  it('no mission is granted file creation: `Write` is refused inside the workspace too', async () => {
    expect(refusalOf(await call('Write', { file_path: ws('src', 'new.ts'), content: 'x' }))).toBe('creation_not_granted');
    expect(refusalOf(await call('Write', { file_path: 'src/app.ts', content: 'x' }))).toBe('creation_not_granted');
    expect(readFileSync(ws('src', 'app.ts'), 'utf8')).toBe('export const app = 1;\n');
  });

  it('a cancelled dispatch makes no further file operation, whichever signal reports it', async () => {
    const sdk = new AbortController(); sdk.abort();
    expect(refusalOf(await call('Edit', { file_path: ws('src', 'app.ts'), old_string: '1', new_string: '2' }, sdk.signal))).toBe('dispatch_cancelled');
    const run = new AbortController(); run.abort();
    const stopped = hook(workspace, run.signal);
    expect(refusalOf(await stopped({ tool_name: 'Read', tool_input: { file_path: ws('src', 'app.ts') } }))).toBe('dispatch_cancelled');
  });

  it('a workspace that cannot be resolved fails CLOSED', async () => {
    const orphan = hook(join(base, 'does-not-exist'));
    expect(refusalOf(await orphan({ tool_name: 'Read', tool_input: { file_path: join(base, 'does-not-exist', 'x.ts') } }))).toBe('workspace_unresolvable');
    expect(refusalOf(await orphan({ tool_name: 'Glob', tool_input: { pattern: '**/*' } }))).toBe('workspace_unresolvable');
  });

  it('a file tool that names no path is refused; a tool that names no file is none of this authority\'s business', async () => {
    expect(refusalOf(await call('Edit', { old_string: 'a', new_string: 'b' }))).toBe('path_unreadable');
    expect(refusalOf(await call('Read', { file_path: '' }))).toBe('path_unreadable');
    expect(await call('TodoWrite', { todos: [] })).toEqual({});
    expect(await call('WebSearch', { query: 'x' })).toEqual({});
    expect(await call('Glob', { pattern: 'src/**/*.ts' })).toEqual({});
    expect(await call('Grep', { pattern: 'app', glob: '*.ts' })).toEqual({});
  });

  it('a home-relative spelling is not a workspace path even though it resolves inside one', async () => {
    expect(refusalOf(await call('Read', { file_path: '~/.ssh/id_rsa' }))).toBe('path_absolute');
  });
});

describe('the refusal vocabulary stays CLOSED', () => {
  it('every refusal this authority produces is a name the closed set admits', async () => {
    const aborted = new AbortController(); aborted.abort();
    await call('Read', { file_path: join(outside, 'secret.txt') });
    await call('Read', { file_path: '' });
    await call('Read', { file_path: '~/.ssh/id_rsa' });
    await call('Glob', { pattern: '../x' });
    await call('Write', { file_path: ws('src', 'x.ts'), content: 'x' });
    await call('Write', { file_path: ws('src', 'late.ts'), content: 'x' }, aborted.signal);
    await call('Edit', { file_path: ws('.git', 'config'), old_string: 'a', new_string: 'b' });
    await call('Edit', { file_path: ws('.env'), old_string: 'a', new_string: 'b' });
    await call('Edit', { file_path: ws('.github', 'workflows', 'ci.yml'), old_string: 'a', new_string: 'b' });
    await hook(join(base, 'gone'))({ tool_name: 'Read', tool_input: { file_path: 'x' } });
    const names = new Set(decisions.filter((d) => !d.allowed).map((d) => d.refusal as string));
    for (const name of names) expect(JULIUS_FILE_AUTHORITY_REFUSALS, name).toContain(name);
    expect([...names].sort()).toEqual([
      'creation_not_granted', 'dispatch_cancelled', 'glob_outside_workspace', 'path_absolute', 'path_control_location',
      'path_credential_location', 'path_outside_workspace', 'path_unreadable', 'path_workflow_location', 'workspace_unresolvable',
    ]);
  });
});

describe('the runner installs the authority on EVERY hosted run', () => {
  const capture = (): { fn: HostedQueryFn; options: Array<Record<string, unknown>> } => {
    const options: Array<Record<string, unknown>> = [];
    const fn: HostedQueryFn = (params) => {
      options.push(params.options);
      return (async function* () {
        yield { type: 'system', subtype: 'init', model: 'claude-sonnet-5', cwd: workspace, tools: ['Read', 'Glob', 'Grep', 'Edit'] };
        yield { type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 1, total_cost_usd: 0, usage: {}, permission_denials: [] };
      })();
    };
    return { fn, options };
  };

  it('as a PreToolUse hook with no matcher, which confines what the allow list would approve, and leaves the envelope unchanged', async () => {
    const { fn, options } = capture();
    await runHostedCodingAgent({
      queryFn: fn, prompt: 'edit the adapter', workspacePath: workspace, apiKey: 'sk-ant-TEST',
      requestedModel: null, now: () => '2026-09-28T00:00:00.000Z',
    });
    expect(options).toHaveLength(1);
    const sent = options[0] ?? {};
    const matchers = (sent.hooks as { PreToolUse?: Array<{ matcher?: string; hooks: unknown[] }> } | undefined)?.PreToolUse ?? [];
    expect(matchers).toHaveLength(1);
    expect(matchers[0]?.matcher).toBeUndefined();
    const installed = matchers[0]?.hooks[0] as (input: unknown, id?: string, o?: { signal?: AbortSignal }) => Promise<HostedHookOutput>;
    expect(typeof installed).toBe('function');
    expect(refusalOf(await installed({ tool_name: 'Read', tool_input: { file_path: join(outside, 'secret.txt') } }))).toBe('path_outside_workspace');
    expect(refusalOf(await installed({ tool_name: 'Edit', tool_input: { file_path: ws('.git', 'config'), old_string: 'a', new_string: 'b' } }))).toBe('path_control_location');
    expect(await installed({ tool_name: 'Edit', tool_input: { file_path: ws('src', 'app.ts'), old_string: '1', new_string: '2' } })).toEqual({});
    // The authority confines; it does not widen. The allow list, the disallow list and the mode are as they were.
    expect(sent.allowedTools).toEqual(['Read', 'Glob', 'Grep', 'Edit']);
    expect(sent.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Write', 'NotebookEdit', 'WebFetch']));
    expect(sent.permissionMode).toBe('acceptEdits');
    expect(sent.settingSources).toEqual([]);
  });

  it('the installed hook is refused once the run itself is stopped', async () => {
    const { fn, options } = capture();
    let stop: (() => void) | null = null;
    await runHostedCodingAgent({
      queryFn: fn, prompt: 'edit the adapter', workspacePath: workspace, apiKey: 'sk-ant-TEST',
      requestedModel: null, now: () => '2026-09-28T00:00:00.000Z', onCancel: (cancel) => { stop = cancel; },
    });
    expect(stop).not.toBeNull();
    (stop as unknown as () => void)();
    const installed = ((options[0]?.hooks as { PreToolUse: Array<{ hooks: unknown[] }> }).PreToolUse[0]?.hooks[0]) as
      (input: unknown) => Promise<HostedHookOutput>;
    expect(refusalOf(await installed({ tool_name: 'Read', tool_input: { file_path: ws('src', 'app.ts') } }))).toBe('dispatch_cancelled');
  });
});

/* ------------------------------------------------------------------ Mission 6 */

const REPO = process.cwd();
const MISSION_6 = join(REPO, '.github', 'julius-missions', 'julius-live-mission-6');

const slicePaths = (): string[] => readFileSync(join(MISSION_6, 'slice.txt'), 'utf8').split('\n')
  .map((line) => line.replace(/#.*$/u, '').trim()).filter((line) => line !== '');

const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? filesUnder(full) : [full];
});

/**
 * The workspace `.github/julius-live-workspace.sh` provisions for Mission 6, in
 * the same shape: the slice at repository-relative paths, the seeded
 * specification laid over it, the two `.julius/` harness files, and a git
 * directory. Built from the REAL frozen files, so a change to what Mission 6
 * provisions reaches this test.
 */
const provisionMission6 = (): string => {
  const root = join(base, 'mission-6');
  const place = (rel: string, from: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    copyFileSync(from, join(root, rel));
  };
  for (const rel of slicePaths()) place(rel, join(REPO, ...rel.split('/')));
  const seed = join(MISSION_6, 'seed');
  for (const file of filesUnder(seed)) place(relative(seed, file).split(/[\\/]/u).join('/'), file);
  for (const name of ['resolve.mjs', 'loader.mjs']) place(`.julius/${name}`, join(REPO, '.github', 'julius-mission-slice', name));
  place('.git/config', join(workspace, '.git', 'config'));
  return root;
};

describe('13. Mission 6, provisioned as the hosted rig provisions it, is unaffected', () => {
  it('everything its contract asks of the Coding Agent -- Read, Glob, Grep and Edit of the adapter -- is allowed', async () => {
    const root = provisionMission6();
    const m6 = juliusHostedToolAuthority({ workspacePath: root, record: (d) => decisions.push(d) });
    const at = (rel: string) => join(root, ...rel.split('/'));
    const adapter = 'src/relay/workspace/julius-tools/node-tool-adapter.ts';
    const spec = 'src/relay/workspace/julius-tools/node-tool-search-paths.test.ts';
    const calls: Array<[string, Record<string, unknown>]> = [
      ['Glob', { pattern: '**/*.ts' }],
      ['Glob', { pattern: 'src/**/*.ts', path: root }],
      ['Glob', { pattern: `${root}/src/**/*.ts` }],
      ['Grep', { pattern: 'path.relative', path: at('src'), glob: '*.ts' }],
      ['Grep', { pattern: 'search.find', path: at(adapter) }],
      ['LS', { path: root }],
      ['Read', { file_path: at(adapter) }],
      ['Read', { file_path: at(spec) }],
      ['Read', { file_path: at('.julius/loader.mjs') }],
      ['Edit', { file_path: at(adapter), old_string: 'path.relative', new_string: 'juliusSearchPath' }],
      ['Edit', { file_path: adapter, old_string: 'a', new_string: 'b' }],
    ];
    for (const [tool, input] of calls) {
      expect(await m6({ tool_name: tool, tool_input: input }), `${tool} ${JSON.stringify(input)}`).toEqual({});
    }
    expect(decisions.map((d) => [d.tool, d.allowed, d.path])).toEqual([
      ['Edit', true, adapter], ['Edit', true, adapter],
    ]);
  });

  it('what it changes for Mission 6 is only what the contract already forbids, or what the envelope never offered', async () => {
    const root = provisionMission6();
    const m6 = juliusHostedToolAuthority({ workspacePath: root });
    // "Do not touch `.julius/`" -- the harness the final check loads. Now refused at the tool, not only judged after.
    expect(refusalOf(await m6({ tool_name: 'Edit', tool_input: { file_path: join(root, '.julius', 'loader.mjs'), old_string: 'a', new_string: 'b' } })))
      .toBe('path_control_location');
    // "you cannot create files" -- `Write` is in the envelope's disallow list; the authority agrees.
    expect(refusalOf(await m6({ tool_name: 'Write', tool_input: { file_path: join(root, 'src', 'new.ts'), content: 'x' } })))
      .toBe('creation_not_granted');
    // The seeded specification is NOT refused here: the contract forbids editing it and the review judges that,
    // exactly as before. The authority is containment, not the mission's scope judge.
    expect(await m6({ tool_name: 'Edit', tool_input: { file_path: join(root, 'src', 'relay', 'workspace', 'julius-tools', 'node-tool-search-paths.test.ts'), old_string: 'a', new_string: 'b' } }))
      .toEqual({});
  });

  it('no link can be provisioned into its workspace: its sources are tracked as regular files, and the provisioner makes none', () => {
    const tracked = [...slicePaths(), '.github/julius-missions/julius-live-mission-6', '.github/julius-mission-slice'];
    const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--', ...tracked], { cwd: REPO, encoding: 'utf8' })
      .split('\n').filter((line) => line !== '');
    expect(tree.length).toBeGreaterThanOrEqual(slicePaths().length + 3);
    expect(tree.filter((line) => line.startsWith('120000 ')), 'a tracked symlink').toEqual([]);

    const provisioner = readFileSync(join(REPO, '.github', 'julius-live-workspace.sh'), 'utf8').split('\n')
      .filter((line) => !/^\s*#/u.test(line)).join('\n');
    // The slice is extracted from `git archive`, which can only produce a link from a tracked link (none, above);
    // the seed overlay copies regular files only; the harness is two `cp`s.
    expect(provisioner).toMatch(/archive --format=tar "\$slice_sha" -- "\$\{paths\[@\]\}" \| tar -x -C "\$WORKSPACE"/u);
    expect(provisioner).toMatch(/find "\$SEED_OVERLAY" -type f -print0/u);
    expect(provisioner).not.toMatch(/\bln\s+-|\bsymlink|\bmklink\b|\bjunction\b/iu);
  });
});
