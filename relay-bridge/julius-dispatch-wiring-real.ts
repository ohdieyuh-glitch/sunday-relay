import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileDispatchLedger } from './julius-dispatch';
import type { J1WiringDeps } from './julius-dispatch-wiring';

/**
 * The REAL effects for `createJ1LiveDispatchFromEnv`: file reads, one child process, global fetch, the file ledger, a temp file.
 * Constructing this object performs none of them. It reads no environment variable.
 *
 * NOT PROVIDED, ON PURPOSE: the Claude Code coding provider, the executor shell port and the Julius run store. Each is `null`, so a
 * live composition built from these deps REFUSES (`dep_*_absent`) until a reviewed change supplies them. Nothing here can make J1 live.
 */
export function realJ1WiringDeps(log: (line: string) => void, now: () => number = Date.now): J1WiringDeps {
  return {
    readFileSync: (path) => readFileSync(path),
    fetchImpl: async (url, init) => {
      const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body, ...(init.signal === undefined ? {} : { signal: init.signal }) });
      return { ok: res.ok, status: res.status, text: () => res.text() };
    },
    runProcess: (command, args) => new Promise((resolve) => {
      execFile(command, [...args], { timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
        const code = error === null ? 0 : (error as NodeJS.ErrnoException & { code?: unknown }).code;
        resolve({ exitCode: typeof code === 'number' ? code : error === null ? 0 : null, stdout: typeof stdout === 'string' ? stdout : '' });
      });
    }),
    writeArtifact: async (text) => {
      const dir = mkdtempSync(join(tmpdir(), 'j1-artifact-'));
      const path = join(dir, 'artifact.txt');
      writeFileSync(path, text, 'utf8');
      return { path, cleanup: async () => { rmSync(dir, { recursive: true, force: true }); } };
    },
    openLedger: (file) => createFileDispatchLedger({ file }),
    coderProviderFor: null,
    shell: null,
    runStore: null,
    now,
    log,
  };
}
