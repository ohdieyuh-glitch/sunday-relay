import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  juliusHostedToolAuthority,
  summariseHostedToolDecisions,
  type HostedHookOutput,
  type HostedToolDecision,
} from './hosted-tool-authority';
import { JULIUS_FILE_AUTHORITY_REFUSALS, type JuliusFileCreationPolicy } from '../../src/relay/mission/julius/julius-file-creation';

/**
 * THE AUTHORITY, AGAINST A REAL DIRECTORY.
 *
 * Every case calls the hook exactly as the SDK does -- `tool_name` plus the
 * tool's own input, with the ABSOLUTE `file_path` Claude Code's file tools send
 * -- against a real temporary workspace. The first design passed its tests with
 * relative paths and would have refused every real creation as absolute; this
 * suite would have caught it.
 */

let base: string;
let workspace: string;
let outside: string;
let decisions: HostedToolDecision[];

const creation: JuliusFileCreationPolicy = Object.freeze({
  permittedPaths: ['src', 'tests'],
  alsoWithin: [],
  outOfScope: ['src/vendor'],
  maxBytes: 2048,
  mayOverwrite: false,
});

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'julius-authority-')));
  workspace = join(base, 'ws');
  outside = join(base, 'outside');
  mkdirSync(join(workspace, 'src', 'vendor'), { recursive: true });
  mkdirSync(join(workspace, 'tests'), { recursive: true });
  mkdirSync(join(workspace, '.git', 'hooks'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(workspace, 'src', 'app.ts'), 'export const app = 1;\n');
  writeFileSync(join(workspace, '.git', 'config'), '[core]\n');
  writeFileSync(join(outside, 'secret.txt'), 'the host is not the workspace\n');
  decisions = [];
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const hook = (policy: { creation: JuliusFileCreationPolicy | null; outOfScope?: readonly string[] } = { creation }) =>
  juliusHostedToolAuthority({
    workspacePath: workspace,
    policy: { creation: policy.creation, outOfScope: policy.outOfScope ?? ['src/vendor'] },
    record: (decision) => decisions.push(decision),
  });

const call = async (toolName: string, toolInput: Record<string, unknown>, policy?: Parameters<typeof hook>[0], signal?: AbortSignal) =>
  hook(policy)({ hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput }, 'toolu_test', signal === undefined ? undefined : { signal });

const denied = (output: HostedHookOutput): string | null =>
  ('hookSpecificOutput' in output && output.hookSpecificOutput.permissionDecision === 'deny')
    ? output.hookSpecificOutput.permissionDecisionReason.split(':')[0] ?? null
    : null;

describe('creation: a mission that grants it can create files -- by the ABSOLUTE path the runtime sends', () => {
  it('creates a new source file, a new test file and a nested file', async () => {
    for (const relativePath of ['src/settings/toggle.ts', 'tests/settings/toggle.test.ts', 'src/a/b/c/deep.ts']) {
      const output = await call('Write', { file_path: join(workspace, ...relativePath.split('/')), content: 'export {};\n' });
      expect(denied(output), relativePath).toBeNull();
    }
    expect(decisions.map((d) => [d.tool, d.allowed, d.path])).toEqual([
      ['Write', true, 'src/settings/toggle.ts'], ['Write', true, 'tests/settings/toggle.test.ts'], ['Write', true, 'src/a/b/c/deep.ts'],
    ]);
  });

  it('a relative path is judged the same way as the absolute one', async () => {
    expect(denied(await call('Write', { file_path: 'src/relative.ts', content: 'x' }))).toBeNull();
    expect(decisions[0]).toMatchObject({ allowed: true, path: 'src/relative.ts' });
  });

  it('no grant, no creation -- the default for every mission written before this capability', async () => {
    expect(denied(await call('Write', { file_path: join(workspace, 'src', 'new.ts'), content: 'x' }, { creation: null }))).toBe('creation_not_granted');
  });

  it('refuses an unauthorized overwrite, observed from the real filesystem rather than the model\'s belief', async () => {
    expect(denied(await call('Write', { file_path: join(workspace, 'src', 'app.ts'), content: 'x' }))).toBe('overwrite_not_authorized');
    expect(denied(await call('Write', { file_path: join(workspace, 'src', 'app.ts'), content: 'x' },
      { creation: { ...creation, mayOverwrite: true } }))).toBeNull();
  });

  it('refuses an oversized file, measured in UTF-8 bytes', async () => {
    expect(denied(await call('Write', { file_path: join(workspace, 'src', 'big.ts'), content: 'é'.repeat(1025) }))).toBe('content_too_large');
    expect(denied(await call('Write', { file_path: join(workspace, 'src', 'ok.ts'), content: 'a'.repeat(2048) }))).toBeNull();
  });

  it('refuses control locations, out-of-scope paths and paths no grant covers', async () => {
    expect(denied(await call('Write', { file_path: join(workspace, '.git', 'hooks', 'pre-commit'), content: '#!/bin/sh' },
      { creation: { ...creation, permittedPaths: ['src', '.git'] } }))).toBe('path_control_location');
    expect(denied(await call('Write', { file_path: join(workspace, 'src', 'vendor', 'lib.ts'), content: 'x' }))).toBe('path_out_of_scope');
    expect(denied(await call('Write', { file_path: join(workspace, 'docs', 'x.md'), content: 'x' }))).toBe('path_not_permitted');
  });
});

describe('confinement: no file tool reaches outside the workspace, by any spelling', () => {
  it('refuses an absolute path outside the workspace for EVERY file tool -- read, edit, write and search', async () => {
    const target = join(outside, 'secret.txt');
    expect(denied(await call('Read', { file_path: target }))).toBe('path_outside_workspace');
    expect(denied(await call('Edit', { file_path: target, old_string: 'host', new_string: 'x' }))).toBe('path_outside_workspace');
    expect(denied(await call('Write', { file_path: join(outside, 'planted.ts'), content: 'x' }))).toBe('path_outside_workspace');
    expect(denied(await call('Grep', { pattern: 'secret', path: outside }))).toBe('path_outside_workspace');
    expect(denied(await call('Glob', { pattern: '*.txt', path: outside }))).toBe('path_outside_workspace');
  });

  it('refuses ".." whatever it would resolve to -- including a traversal that lands back inside', async () => {
    expect(denied(await call('Read', { file_path: join(workspace, 'src', '..', '..', 'outside', 'secret.txt') }))).toBe('path_outside_workspace');
    expect(denied(await call('Read', { file_path: 'src/../src/app.ts' }))).toBe('path_outside_workspace');
    expect(denied(await call('Glob', { pattern: '../**/*.txt' }))).toBe('glob_outside_workspace');
    expect(denied(await call('Grep', { pattern: 'x', glob: '/etc/**' }))).toBe('glob_outside_workspace');
  });

  it('refuses a path that escapes through a link planted inside the workspace', async () => {
    // A directory junction needs no privilege on Windows; on POSIX the type is ignored.
    symlinkSync(outside, join(workspace, 'src', 'escape'), 'junction');
    expect(denied(await call('Read', { file_path: join(workspace, 'src', 'escape', 'secret.txt') }))).toBe('path_outside_workspace');
    expect(denied(await call('Write', { file_path: join(workspace, 'src', 'escape', 'new.ts'), content: 'x' }))).toBe('path_outside_workspace');
    expect(denied(await call('Glob', { pattern: '*', path: join(workspace, 'src', 'escape') }))).toBe('path_outside_workspace');
  });

  it('CONTROL: reads and searches inside the workspace pass untouched, and are counted rather than listed', async () => {
    expect(denied(await call('Read', { file_path: join(workspace, 'src', 'app.ts') }))).toBeNull();
    expect(denied(await call('Read', { file_path: join(workspace, '.git', 'config') }))).toBeNull();
    expect(denied(await call('Glob', { pattern: 'src/**/*.ts' }))).toBeNull();
    expect(denied(await call('Grep', { pattern: 'app', path: join(workspace, 'src') }))).toBeNull();
    expect(decisions).toEqual([]);
  });
});

describe('edits: allowed across the repository, refused where no contract could make them safe', () => {
  it('an ordinary edit is allowed and recorded; `.git/config` and out-of-scope edits are refused', async () => {
    expect(denied(await call('Edit', { file_path: join(workspace, 'src', 'app.ts'), old_string: '1', new_string: '2' }))).toBeNull();
    expect(denied(await call('Edit', { file_path: join(workspace, '.git', 'config'), old_string: '[core]', new_string: '[core]\n\tfsmonitor = x' }))).toBe('path_control_location');
    expect(denied(await call('MultiEdit', { file_path: join(workspace, 'src', 'vendor', 'lib.ts'), edits: [] }))).toBe('path_out_of_scope');
    expect(decisions.map((d) => [d.tool, d.allowed, d.refusal])).toEqual([
      ['Edit', true, null], ['Edit', false, 'path_control_location'], ['MultiEdit', false, 'path_out_of_scope'],
    ]);
  });
});

describe('the record, the cancellation, and what is never leaked', () => {
  it('a cancelled dispatch makes no further file operation', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(denied(await call('Write', { file_path: join(workspace, 'src', 'late.ts'), content: 'x' }, undefined, controller.signal))).toBe('dispatch_cancelled');
  });

  it('a workspace that cannot be resolved fails CLOSED', async () => {
    const orphan = juliusHostedToolAuthority({
      workspacePath: join(base, 'does-not-exist'), policy: { creation, outOfScope: [] }, record: (d) => decisions.push(d),
    });
    const output = await orphan({ tool_name: 'Read', tool_input: { file_path: join(base, 'does-not-exist', 'x.ts') } });
    expect(denied(output)).toBe('workspace_unresolvable');
  });

  it('a tool that names no file is none of this authority\'s business', async () => {
    expect(await call('TodoWrite', { todos: [] })).toEqual({});
    expect(await call('WebSearch', { query: 'x' })).toEqual({});
  });

  it('NO RECORD AND NO REASON CARRIES A HOST PATH -- an outside request is recorded as outside', async () => {
    await call('Read', { file_path: join(outside, 'secret.txt') });
    await call('Write', { file_path: join(workspace, 'src', 'vendor', 'x.ts'), content: 'x' });
    await call('Write', { file_path: join(workspace, 'src', 'fine.ts'), content: 'x' });
    const serialised = JSON.stringify(decisions);
    expect(serialised).not.toContain(base);
    expect(serialised).not.toContain(base.replace(/\\/gu, '/'));
    expect(decisions[0]).toMatchObject({ allowed: false, path: null, refusal: 'path_outside_workspace' });
  });

  it('every refusal this authority can produce is a name the durable record admits', async () => {
    symlinkSync(outside, join(workspace, 'src', 'escape'), 'junction');
    const controller = new AbortController(); controller.abort();
    await call('Read', { file_path: join(outside, 'secret.txt') });
    await call('Read', { file_path: 'src/../src/app.ts' });
    await call('Read', { file_path: '' });
    await call('Glob', { pattern: '../x' });
    await call('Write', { file_path: join(workspace, 'src', 'x.ts'), content: 'x' }, { creation: null });
    await call('Write', { file_path: join(workspace, 'src', 'escape', 'x.ts'), content: 'x' });
    await call('Write', { file_path: join(workspace, 'src', 'late.ts'), content: 'x' }, undefined, controller.signal);
    await call('Edit', { file_path: join(workspace, '.git', 'config'), old_string: 'a', new_string: 'b' });
    const orphan = juliusHostedToolAuthority({ workspacePath: join(base, 'gone'), policy: { creation, outOfScope: [] }, record: (d) => decisions.push(d) });
    await orphan({ tool_name: 'Read', tool_input: { file_path: 'x' } });
    const names = new Set(decisions.filter((d) => !d.allowed).map((d) => d.refusal as string));
    for (const name of names) expect(JULIUS_FILE_AUTHORITY_REFUSALS, name).toContain(name);
    for (const expected of ['path_outside_workspace', 'path_unreadable', 'glob_outside_workspace', 'creation_not_granted', 'dispatch_cancelled', 'path_control_location', 'workspace_unresolvable']) {
      expect(names, expected).toContain(expected);
    }
  });

  it('the summary is bounded scalars and the created list, never text', () => {
    const summary = summariseHostedToolDecisions([
      { tool: 'Write', allowed: true, path: 'src/a.ts', refusal: null, because: 'x' },
      { tool: 'Write', allowed: true, path: 'src/a.ts', refusal: null, because: 'x' },
      { tool: 'Write', allowed: false, path: 'src/vendor/b.ts', refusal: 'path_out_of_scope', because: 'x' },
      { tool: 'Edit', allowed: true, path: 'src/c.ts', refusal: null, because: 'x' },
      { tool: 'Read', allowed: false, path: null, refusal: 'path_outside_workspace', because: 'x' },
    ]);
    expect(summary).toEqual({
      writesAllowed: 2, writesRefused: 1, editsAllowed: 1, editsRefused: 0, othersRefused: 1,
      firstRefusal: 'path_out_of_scope', created: ['src/a.ts'],
    });
  });
});
