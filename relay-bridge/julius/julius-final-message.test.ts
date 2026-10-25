import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { JULIUS_FINAL_MESSAGE_PUBLISHED_CHARS, writeJuliusFinalMessage } from './julius-final-message';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const roots: string[] = [];
function layout(): { workspace: string; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'julius-final-message-'));
  roots.push(root);
  const workspace = join(root, 'ws');
  mkdirSync(workspace);
  return { workspace, out: join(root, 'final-message') };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const TASK = 'task:build-1';
const DOC = '{"sales":[{"id":"t-1","price_cc":1250}]}';

describe('the coder final message is kept outside the workspace for the hidden checker', () => {
  it('writes nothing when the workflow names no directory', () => {
    const { workspace } = layout();
    expect(writeJuliusFinalMessage({ directory: undefined, workspacePath: workspace, taskId: TASK, runId: 'wlj_x', finalText: DOC }))
      .toEqual({ written: false, reason: 'no_directory' });
    expect(readdirSync(workspace)).toEqual([]);
  });

  it('keeps the trimmed bytes raw, hashes raw and trimmed text, and publishes only a redacted copy', () => {
    const { workspace, out } = layout();
    const finalText = `  ${DOC}\n`;
    const result = writeJuliusFinalMessage({ directory: out, workspacePath: workspace, taskId: TASK, runId: 'wlj_x', finalText });
    expect(result).toMatchObject({ written: true, manifest: { taskId: TASK, runId: 'wlj_x', rawSha256: sha256(finalText), trimmedSha256: sha256(DOC), trimmedUtf8Bytes: DOC.length } });
    expect(readdirSync(out).sort()).toEqual(['task_build-1.manifest.json', 'task_build-1.raw.txt', 'task_build-1.redacted.json']);
    expect(readFileSync(join(out, 'task_build-1.raw.txt'), 'utf8')).toBe(DOC);
    const redacted = JSON.parse(readFileSync(join(out, 'task_build-1.redacted.json'), 'utf8')) as Record<string, unknown>;
    expect(redacted).toMatchObject({ text: DOC, truncated: false, alteredByRedaction: false, trimmedSha256: sha256(DOC) });
    expect(readdirSync(workspace)).toEqual([]);
    if (process.platform !== 'win32') expect(statSync(join(out, 'task_build-1.raw.txt')).mode & 0o777).toBe(0o600);
  });

  it('redacts a credential-shaped string in the published copy, says so, and still hashes the original', () => {
    const { workspace, out } = layout();
    const leaky = `{"note":"sk-${'a'.repeat(24)}"}`;
    writeJuliusFinalMessage({ directory: out, workspacePath: workspace, taskId: TASK, runId: 'wlj_x', finalText: leaky });
    const redacted = JSON.parse(readFileSync(join(out, 'task_build-1.redacted.json'), 'utf8')) as Record<string, unknown>;
    expect(redacted.text).not.toContain('sk-aaaa');
    expect(redacted.alteredByRedaction).toBe(true);
    expect(redacted.trimmedSha256).toBe(sha256(leaky));
    expect(readFileSync(join(out, 'task_build-1.raw.txt'), 'utf8')).toBe(leaky);
  });

  it('caps the published copy at the contract cut and records the truncation', () => {
    const { workspace, out } = layout();
    const long = 'x'.repeat(JULIUS_FINAL_MESSAGE_PUBLISHED_CHARS + 5);
    writeJuliusFinalMessage({ directory: out, workspacePath: workspace, taskId: TASK, runId: 'wlj_x', finalText: long });
    const redacted = JSON.parse(readFileSync(join(out, 'task_build-1.redacted.json'), 'utf8')) as { text: string; truncated: boolean };
    expect(redacted.text.length).toBe(JULIUS_FINAL_MESSAGE_PUBLISHED_CHARS);
    expect(redacted.truncated).toBe(true);
    expect(readFileSync(join(out, 'task_build-1.raw.txt'), 'utf8')).toBe(long);
  });

  it('refuses a directory inside the workspace, or one that contains it', () => {
    const { workspace } = layout();
    expect(writeJuliusFinalMessage({ directory: join(workspace, 'out'), workspacePath: workspace, taskId: TASK, runId: 'wlj_x', finalText: DOC }))
      .toEqual({ written: false, reason: 'directory_inside_workspace' });
    expect(writeJuliusFinalMessage({ directory: join(workspace, '..'), workspacePath: workspace, taskId: TASK, runId: 'wlj_x', finalText: DOC }))
      .toEqual({ written: false, reason: 'directory_inside_workspace' });
  });

  it('never replaces a record already written for the task', () => {
    const { workspace, out } = layout();
    writeJuliusFinalMessage({ directory: out, workspacePath: workspace, taskId: TASK, runId: 'wlj_x', finalText: DOC });
    expect(writeJuliusFinalMessage({ directory: out, workspacePath: workspace, taskId: TASK, runId: 'wlj_x', finalText: '{"other":1}' }))
      .toEqual({ written: false, reason: 'write_failed' });
    expect(readFileSync(join(out, 'task_build-1.raw.txt'), 'utf8')).toBe(DOC);
  });

  it('refuses a relative directory, an unsafe task id, and a missing final message', () => {
    const { workspace, out } = layout();
    expect(writeJuliusFinalMessage({ directory: 'final-message', workspacePath: workspace, taskId: TASK, runId: 'wlj_x', finalText: DOC }).written).toBe(false);
    expect(writeJuliusFinalMessage({ directory: out, workspacePath: workspace, taskId: '../escape', runId: 'wlj_x', finalText: DOC }))
      .toEqual({ written: false, reason: 'task_id_unsafe' });
    expect(writeJuliusFinalMessage({ directory: out, workspacePath: workspace, taskId: TASK, runId: 'wlj_x', finalText: null }))
      .toEqual({ written: false, reason: 'no_text' });
    expect(existsSync(join(out, 'task_build-1.raw.txt'))).toBe(false);
  });

  it('is read by nothing in the runtime: no module but the hosted invoker imports it', () => {
    const importers = ['relay-bridge', 'src'].flatMap((root) => walk(root))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('julius-final-message.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes('julius-final-message'));
    expect(importers.map((f) => f.split('\\').join('/'))).toEqual(['relay-bridge/hosted-coding-agent/hosted-invoker.ts']);
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
