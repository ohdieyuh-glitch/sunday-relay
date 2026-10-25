import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { JULIUS_FINAL_MESSAGE_PUBLISHED_CHARS, juliusFinalMessageStem, writeJuliusFinalMessage } from './julius-final-message';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const roots: string[] = [];
function layout(): { workspace: string; out: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'julius-final-message-'));
  roots.push(root);
  const workspace = join(root, 'ws');
  const out = join(root, 'final-message');
  mkdirSync(workspace);
  mkdirSync(out, { mode: 0o700 });
  return { workspace, out, root };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const TASK = 'task:build-1';
const CONTEXT = 'context:7';
const STEM = juliusFinalMessageStem(TASK, CONTEXT);
const DOC = '{"sales":[{"id":"t-1","price_cc":1250}]}';
const write = (over: Partial<Parameters<typeof writeJuliusFinalMessage>[0]> & { directory: string | undefined; workspacePath: string }) =>
  writeJuliusFinalMessage({ taskId: TASK, contextId: CONTEXT, runId: 'wlj_x', finalText: DOC, ...over });

describe('the coder final message is kept outside the workspace for the hidden checker', () => {
  it('writes nothing when the workflow names no directory', () => {
    const { workspace } = layout();
    expect(write({ directory: undefined, workspacePath: workspace })).toEqual({ written: false, reason: 'no_directory' });
    expect(readdirSync(workspace)).toEqual([]);
  });

  it('keys the files by task and dispatch context, keeps the trimmed bytes raw, and publishes only a redacted copy', () => {
    const { workspace, out } = layout();
    const result = write({ directory: out, workspacePath: workspace, finalText: `  ${DOC}\n` });
    expect(result).toMatchObject({ written: true, manifest: { taskId: TASK, contextId: CONTEXT, runId: 'wlj_x', trimmedSha256: sha256(DOC), trimmedUtf8Bytes: DOC.length } });
    expect(STEM).toBe('task_build-1.context_7');
    expect(readdirSync(out).sort()).toEqual([`${STEM}.manifest.json`, `${STEM}.raw.txt`, `${STEM}.redacted.json`]);
    expect(readFileSync(join(out, `${STEM}.raw.txt`), 'utf8')).toBe(DOC);
    const redacted = JSON.parse(readFileSync(join(out, `${STEM}.redacted.json`), 'utf8')) as Record<string, unknown>;
    expect(redacted).toMatchObject({ text: DOC, truncated: false, alteredByRedaction: false, trimmedSha256: sha256(DOC) });
    expect('rawSha256' in redacted).toBe(false);
    expect(readdirSync(workspace)).toEqual([]);
    if (process.platform !== 'win32') expect(statSync(join(out, `${STEM}.raw.txt`)).mode & 0o777).toBe(0o600);
  });

  it('a second dispatch of the same task is a different file, and a repeat of one dispatch never replaces it', () => {
    const { workspace, out } = layout();
    write({ directory: out, workspacePath: workspace });
    expect(write({ directory: out, workspacePath: workspace, contextId: 'context:8', finalText: '{"other":1}' }).written).toBe(true);
    expect(write({ directory: out, workspacePath: workspace, finalText: '{"replaced":1}' })).toEqual({ written: false, reason: 'write_failed' });
    expect(readFileSync(join(out, `${STEM}.raw.txt`), 'utf8')).toBe(DOC);
  });

  it('redacts a credential-shaped string in the published copy, says so, and still hashes the original', () => {
    const { workspace, out } = layout();
    const leaky = `{"note":"sk-${'a'.repeat(24)}"}`;
    write({ directory: out, workspacePath: workspace, finalText: leaky });
    const redacted = JSON.parse(readFileSync(join(out, `${STEM}.redacted.json`), 'utf8')) as Record<string, unknown>;
    expect(redacted.text).not.toContain('sk-aaaa');
    expect(redacted.alteredByRedaction).toBe(true);
    expect(redacted.trimmedSha256).toBe(sha256(leaky));
  });

  it('caps the published copy at the contract cut and records the truncation', () => {
    const { workspace, out } = layout();
    const long = 'x'.repeat(JULIUS_FINAL_MESSAGE_PUBLISHED_CHARS + 5);
    write({ directory: out, workspacePath: workspace, finalText: long });
    const redacted = JSON.parse(readFileSync(join(out, `${STEM}.redacted.json`), 'utf8')) as { text: string; truncated: boolean };
    expect(redacted.text.length).toBe(JULIUS_FINAL_MESSAGE_PUBLISHED_CHARS);
    expect(redacted.truncated).toBe(true);
  });

  it('refuses a directory inside the workspace, one that contains it, one that does not exist, and a symlink', () => {
    const { workspace, root } = layout();
    mkdirSync(join(workspace, 'out'));
    expect(write({ directory: join(workspace, 'out'), workspacePath: workspace })).toEqual({ written: false, reason: 'directory_inside_workspace' });
    expect(write({ directory: root, workspacePath: workspace })).toEqual({ written: false, reason: 'directory_inside_workspace' });
    expect(write({ directory: join(root, 'never-made'), workspacePath: workspace })).toEqual({ written: false, reason: 'directory_unusable' });
    const link = join(root, 'link');
    try { symlinkSync(join(root, 'final-message'), link, 'junction'); } catch { return; }
    expect(write({ directory: link, workspacePath: workspace })).toEqual({ written: false, reason: 'directory_unusable' });
  });

  it('refuses a directory another user owns or others may write', () => {
    const { workspace, out } = layout();
    const fs = (mode: number, uid: number) => ({
      inspectDirectory: () => ({ isDirectory: true, isSymlink: false, mode, uid }),
      realpath: (p: string) => p,
      writeExclusive: () => { throw new Error('must not write'); },
    });
    expect(write({ directory: out, workspacePath: workspace, uid: 1000, fs: fs(0o40700, 0) })).toEqual({ written: false, reason: 'directory_unusable' });
    expect(write({ directory: out, workspacePath: workspace, uid: 1000, fs: fs(0o40777, 1000) })).toEqual({ written: false, reason: 'directory_unusable' });
    expect(write({ directory: out, workspacePath: workspace, uid: 1000, fs: fs(0o40720, 1000) })).toEqual({ written: false, reason: 'directory_unusable' });
    if (process.platform !== 'win32') {
      chmodSync(out, 0o777);
      expect(write({ directory: out, workspacePath: workspace })).toEqual({ written: false, reason: 'directory_unusable' });
    }
  });

  it('refuses a relative directory, an unsafe id, and a missing final message', () => {
    const { workspace, out } = layout();
    expect(write({ directory: 'final-message', workspacePath: workspace }).written).toBe(false);
    expect(write({ directory: out, workspacePath: workspace, taskId: '../escape' })).toEqual({ written: false, reason: 'id_unsafe' });
    expect(write({ directory: out, workspacePath: workspace, contextId: 'a/b' })).toEqual({ written: false, reason: 'id_unsafe' });
    expect(write({ directory: out, workspacePath: workspace, finalText: null })).toEqual({ written: false, reason: 'no_text' });
    expect(existsSync(join(out, `${STEM}.raw.txt`))).toBe(false);
  });

  it('is read by nothing in the runtime: only the paid Coding Agent provider imports it', () => {
    const importers = ['relay-bridge', 'src'].flatMap((root) => walk(root))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('julius-final-message.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes('julius-final-message'));
    expect(importers.map((f) => f.split('\\').join('/'))).toEqual(['relay-bridge/julius/claude-code-coding-provider.ts']);
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}
