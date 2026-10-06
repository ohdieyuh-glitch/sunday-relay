import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * `.github/julius-learning-store.sh` WITHOUT A DATABASE (Decision C, Option D).
 *
 * The script holds the database commands a learning pair's store crosses on: arm WITHOUT's dump and arm WITH's
 * restore. These cases pin what can be pinned with no server: ONE argument list per command, whichever launcher
 * runs it (the paid job's container, a throwaway's host tools); the versions said and an older client refused; no
 * password in any printed line; and every value that reaches SQL checked for its shape before anything connects.
 * The round trip itself, over a real PostgreSQL, is relay-bridge/julius-learning-store-roundtrip.real-postgres.test.ts.
 */

const ROOT = resolve(__dirname, '..');
const SCRIPT = join(ROOT, '.github', 'julius-learning-store.sh');
/** Git's bash on Windows, never WSL's; plain bash everywhere else (as julius-first-live-mission.test.ts finds it). */
const BASH = process.platform === 'win32' && existsSync('C:\\Program Files\\Git\\bin\\bash.exe') ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const scratch = mkdtempSync(join(tmpdir(), 'julius-learning-store-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const RUN = `run:${'0123456789abcdef'.repeat(2).slice(0, 24)}`;
/** A password made at run time, so no credential-shaped literal sits in the source. */
const secret = () => `pw-${randomBytes(12).toString('hex')}`;

function store(args: readonly string[], env: Record<string, string>) {
  const result = spawnSync(BASH, [SCRIPT, ...args], {
    encoding: 'utf8', timeout: 60_000,
    env: {
      PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', TEMP: tmpdir(), TMP: tmpdir(), HOME: process.env.HOME ?? '',
      LC_ALL: 'C', ...env,
    },
  });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Client tools that only answer their versions: enough for every check that runs before a dump or a restore. */
function fakeClient(label: string, clientMajor: number, serverVersionNum: string): string {
  const dir = join(scratch, label);
  mkdirSync(dir, { recursive: true });
  for (const [tool, answer] of [['pg_dump', `pg_dump (PostgreSQL) ${String(clientMajor)}.4`], ['pg_restore', `pg_restore (PostgreSQL) ${String(clientMajor)}.4`], ['psql', serverVersionNum]] as const) {
    const path = join(dir, tool);
    writeFileSync(path, `#!/usr/bin/env bash\necho '${answer}'\n`);
    chmodSync(path, 0o755);
  }
  return dir;
}

describe('the learning store script, without a database', () => {
  it('builds ONE argument list per command: the container and host launchers differ only in their prefix (A1)', () => {
    const { status, out } = store([], { JULIUS_STORE_DRY_RUN: '1', PGDATABASE: 'jlrt_db' });
    expect(status).toBe(0);
    const lines = out.split('\n').filter((line) => line.startsWith('JULIUS_STORE_DRY_RUN '));
    const parsed = lines.map((line) => {
      const [head, prefix, args] = line.split(' | ');
      const [, mode, builder] = head!.split(' ');
      return { mode: mode!, builder: builder!, prefix: prefix!.trim(), args: args!.trim() };
    });
    expect(parsed).toHaveLength(6);
    for (const builder of ['args_dump', 'args_render', 'args_restore']) {
      const container = parsed.find((line) => line.mode === 'container' && line.builder === builder)!;
      const host = parsed.find((line) => line.mode === 'host' && line.builder === builder)!;
      expect(container.args, `${builder}: the paid path runs exactly what the test runs`).toBe(host.args);
      // The container's own server: no runner-side PGHOST or PGPORT crosses into it.
      expect(container.prefix).toMatch(/^docker exec -i -e PGUSER -e PGDATABASE -e PGPASSWORD \S+ pg_(dump|restore)$/u);
      expect(host.prefix).toMatch(/\/pg_(dump|restore)(\.exe)?$/u);
    }
    const argsOf = (builder: string) => parsed.find((line) => line.builder === builder)!.args;
    expect(argsOf('args_dump')).toBe('--format=custom --compress=0 --no-password');
    // pg_restore will not write a script without being told where: `--file=-` is stdout (PostgreSQL 12+).
    expect(argsOf('args_render')).toBe('--file=- --no-password');
    expect(argsOf('args_restore')).toBe('--no-owner --no-privileges --single-transaction --exit-on-error --no-password --dbname=jlrt_db');
    expect(out, 'no connection URL and no password flag in any argument list').not.toMatch(/postgres(ql)?:\/\/|--password\b| -W\b/u);
  });

  it('says both versions, and REFUSES a client older than the server before anything is dumped (A2)', () => {
    const old = store(['dump', join(scratch, 'old-out'), RUN], { JULIUS_PG_BINDIR: fakeClient('old', 15, '160002'), PGUSER: 'u', PGDATABASE: 'd' });
    expect(old.status).toBe(1);
    expect(old.out).toContain('JULIUS_STORE_VERSIONS client="pg_dump (PostgreSQL) 15.4" server_version_num=160002');
    expect(old.out).toContain('julius_store_client_too_old: client 15 < server 16');
    expect(existsSync(join(scratch, 'old-out', 'julius.pgdump')), 'nothing was dumped').toBe(false);
  });

  it('never prints the password it was given: the connection is the PG* environment, never an argument (A4)', () => {
    const password = secret();
    const refused = store(['dump', join(scratch, 'pw-out'), RUN], { JULIUS_PG_BINDIR: fakeClient('pw', 15, '160002'), PGUSER: 'u', PGDATABASE: 'd', PGPASSWORD: password });
    const dry = store([], { JULIUS_STORE_DRY_RUN: '1', PGDATABASE: 'd', PGPASSWORD: password });
    expect(refused.out.length).toBeGreaterThan(0);
    for (const run of [refused, dry]) expect(run.out.includes(password)).toBe(false);
  });

  it('A5: the round trip, demanded against a server that cannot answer, FAILS by that cause and is never todo', async () => {
    // The precondition, checked: nothing listens on the discard port, so the server cannot say its version.
    const refused = await new Promise<string>((done) => {
      const socket = createConnection({ host: '127.0.0.1', port: 9 });
      socket.once('connect', () => { socket.destroy(); done('connected'); });
      socket.once('error', (error: NodeJS.ErrnoException) => done(error.code ?? 'error'));
    });
    expect(refused, 'nothing answers on 127.0.0.1:9').not.toBe('connected');
    const child = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'relay-bridge/julius-learning-store-roundtrip.real-postgres.test.ts'], {
      cwd: ROOT, encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('VITEST'))), JULIUS_REAL_POSTGRES: '1', JULIUS_TEST_DATABASE_URL: 'postgresql://jlrt@127.0.0.1:9/jlrt_none' },
    });
    expect(child.status).not.toBe(0);
    expect(`${child.stdout}${child.stderr}`).toContain('julius_real_postgres_server_unreadable: JULIUS_REAL_POSTGRES=1 demands this suite');
  }, 300_000);

  it('checks every value that reaches SQL for its shape before it connects anywhere', () => {
    const env = { PGUSER: 'u', PGDATABASE: 'd' };
    expect(store(['dump', join(scratch, 'x'), 'run:not-a-run'], env).out).toContain("julius_store_run_invalid: 'run:not-a-run'");
    const dump = join(scratch, 'a.pgdump');
    writeFileSync(dump, 'not an archive');
    const injected = store(['restore', dump, "run:0123456789abcdef01234567' OR '1'='1", 'a'.repeat(64)], env);
    expect(injected.status).toBe(1);
    expect(injected.out).toContain('julius_store_run_invalid');
    expect(store(['restore', dump, RUN, 'not-a-digest'], env).out).toContain('julius_store_registration_invalid');
    expect(store(['restore', join(scratch, 'absent.pgdump'), RUN, 'a'.repeat(64)], env).out).toContain('learning_store_dump_missing');
    expect(store(['what'], env)).toMatchObject({ status: 1, out: expect.stringContaining('usage: julius-learning-store.sh') });
  });
});
