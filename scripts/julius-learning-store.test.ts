import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createConnection } from 'node:net';
import { delimiter, join, resolve } from 'node:path';
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
    // AND ONE I/O. `docker exec` offers only pipes: an archive written to one has no data offsets, and one read from
    // one cannot be sought. Both modes go through pipes, so the tested path restores the kind of archive the paid one makes.
    const source = readFileSync(SCRIPT, 'utf8');
    expect(source).toContain('tool pg_dump args_dump | cat > "$out/julius.pgdump"');
    expect(source).toContain('cat "$out/julius.pgdump" | tool pg_restore args_render > "$rendering"');
    expect(source).toContain('cat "$dump" | tool pg_restore args_restore');
    expect(source, 'no file is redirected straight onto a tool').not.toMatch(/tool pg_(dump|restore) args_\w+ *</u);
    expect(source, 'the dump never lands on a seekable stdout').not.toMatch(/tool pg_dump args_dump *>/u);
  });

  it('is executable in git (100755): the runner calls it as ./.github/julius-learning-store.sh, and a 100644 file is "Permission denied" there', () => {
    // Git Bash runs a shebang file whatever its mode, so only the index can show what a Linux runner will see.
    const entry = execFileSync('git', ['-C', ROOT, 'ls-files', '-s', '.github/julius-learning-store.sh'], { encoding: 'utf8' }).trim();
    expect(entry).toMatch(/^100755 [0-9a-f]{40} 0\t\.github\/julius-learning-store\.sh$/u);
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
    const wlj = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';
    const admitted = store(['dump', join(scratch, 'wlj-out'), wlj], env);
    expect(admitted.out, 'a canonical wlj_ id passes the parser and fails only for want of a client').not.toContain('julius_store_run_invalid');
    expect(admitted.out).toContain('julius_store_no_client');
    const legacy = store(['dump', join(scratch, 'legacy-out'), RUN], env);
    expect(legacy.out, 'a legacy run: id stays readable').not.toContain('julius_store_run_invalid');
    expect(legacy.out).toContain('julius_store_no_client');
    expect(store(['dump', join(scratch, 'probe'), 'preflight:julius-abcd1234'], env).out).toContain("julius_store_run_invalid: 'preflight:julius-abcd1234'");
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

/**
 * G2 (the C7 zero-spend dry run, 2026-10-14): ARM WITH'S GITHUB READS, RETRIED ONLY WHEN THE CAUSE IS TRANSIENT.
 *
 * Arm WITH's restore reads arm WITHOUT's run, its artifact listing and its two zips over the GitHub API before anything
 * is spent, and one such read timed out once in the dry run. `julius-learning-store.sh gh-get <endpoint> [<jq>]` is that
 * read: a GET, asked again at most three times in all when the network gave no answer or GitHub answered 5xx or 429,
 * and final at once on anything else. A fake `gh`, first on PATH, plays each attempt from a plan and logs every call.
 */
describe('the learning store script\'s GitHub reads: a bounded retry for transient failures only (G2)', () => {
  const ENDPOINT = 'repos/owner/repo/actions/runs/4242';
  type Attempt = 'ok' | 'net' | '502' | '503' | '429' | '404' | '403' | '401' | '422' | 'auth';
  let stubs = 0;

  /** A fake `gh`: call n plays line n of the plan, `ok` answering the bytes of answer.<n>; every argv is logged. */
  function fakeGh(plan: readonly Attempt[], answers: Readonly<Record<number, Buffer>> = {}): string {
    stubs += 1;
    const dir = join(scratch, `gh-${String(stubs)}`);
    mkdirSync(join(dir, 'bin'), { recursive: true });
    writeFileSync(join(dir, 'plan'), `${plan.join('\n')}\n`);
    writeFileSync(join(dir, 'calls'), '');
    for (const [n, bytes] of Object.entries(answers)) writeFileSync(join(dir, `answer.${n}`), bytes);
    writeFileSync(join(dir, 'bin', 'gh'), [
      '#!/usr/bin/env bash',
      // One call per line, its arguments separated by US (0x1f).
      'for arg in "$@"; do printf \'%s\\037\' "$arg"; done >> "$GH_STUB/calls"; printf \'\\n\' >> "$GH_STUB/calls"',
      'n=$(wc -l < "$GH_STUB/calls" | tr -d \' \')',
      'case "$(sed -n "${n}p" "$GH_STUB/plan")" in',
      '  ok) if [ -f "$GH_STUB/answer.$n" ]; then cat "$GH_STUB/answer.$n"; else echo "answer $n"; fi ;;',
      // gh's own words for each failure; an HTTP error's BODY goes to stdout, as gh writes it.
      '  net) echo "Get \\"https://api.github.com/$2\\": dial tcp 140.82.112.6:443: connectex: A connection attempt failed because the connected party did not properly respond after a period of time." >&2; exit 1 ;;',
      '  502) echo "<html>502 Bad Gateway</html>"; echo "gh: HTTP 502" >&2; exit 1 ;;',
      '  503) echo \'{"message":"Service Unavailable"}\'; echo "gh: Service Unavailable (HTTP 503)" >&2; exit 1 ;;',
      '  429) echo \'{"message":"API rate limit exceeded"}\'; echo "gh: API rate limit exceeded for installation. (HTTP 429)" >&2; exit 1 ;;',
      '  404) echo \'{"message":"Not Found","status":"404"}\'; echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;',
      '  403) echo \'{"message":"Resource not accessible by integration"}\'; echo "gh: Resource not accessible by integration (HTTP 403)" >&2; exit 1 ;;',
      '  401) echo \'{"message":"Bad credentials"}\'; echo "gh: Bad credentials (HTTP 401)" >&2; exit 1 ;;',
      '  422) echo \'{"message":"Validation Failed"}\'; echo "gh: Validation Failed (HTTP 422)" >&2; exit 1 ;;',
      '  auth) echo "gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable." >&2; exit 4 ;;',
      '  *) echo "gh-stub: call $n was not planned" >&2; exit 97 ;;',
      'esac',
      '',
    ].join('\n'), { mode: 0o755 });
    return dir;
  }

  /** The calls the fake received, each as its argv. */
  const callsOf = (stub: string): string[][] => readFileSync(join(stub, 'calls'), 'utf8').split('\n').filter((line) => line !== '')
    .map((line) => line.split('\x1f').slice(0, -1));

  /** `gh-get`, as the workflow step runs it: no PG* at all, the fake first on PATH, stdout kept as BYTES. */
  function ghGet(stub: string, args: readonly string[], env: Record<string, string> = {}) {
    const result = spawnSync(BASH, [SCRIPT, 'gh-get', ...args], {
      timeout: 60_000,
      env: {
        PATH: `${join(stub, 'bin')}${delimiter}${process.env.PATH ?? ''}`, SystemRoot: process.env.SystemRoot ?? '', TEMP: tmpdir(), TMP: tmpdir(),
        HOME: process.env.HOME ?? '', LC_ALL: 'C', GH_STUB: stub.replaceAll('\\', '/'), JULIUS_STORE_GH_BACKOFF_S: '0', ...env,
      },
    });
    return { status: result.status, stdout: result.stdout, err: result.stderr.toString('utf8'), calls: callsOf(stub) };
  }

  it('asks again after a transient failure (no answer, HTTP 5xx, HTTP 429), and gives the good answer\'s bytes alone', () => {
    // An artifact zip's bytes: binary, NULs and line ends included. The failed attempts printed bodies of their own.
    const zip = Buffer.concat([Buffer.from('PK\x03\x04'), randomBytes(4096), Buffer.from([0, 255, 13, 10, 0])]);
    const stub = fakeGh(['net', '502', 'ok'], { 3: zip });
    const read = ghGet(stub, [`${ENDPOINT}/zip`]);
    expect(read.status, read.err).toBe(0);
    expect(Buffer.compare(read.stdout, zip), 'exactly the bytes of the attempt that succeeded, nothing of the failed ones').toBe(0);
    expect(read.calls).toEqual([1, 2, 3].map(() => ['api', `${ENDPOINT}/zip`, '--method', 'GET']));
    expect(read.err).toContain(`JULIUS_STORE_GH_GET try=1/3 transient="no answer from the network" endpoint=${ENDPOINT}/zip`);
    expect(read.err).toContain(`JULIUS_STORE_GH_GET try=2/3 transient="HTTP 502" endpoint=${ENDPOINT}/zip`);

    // A filtered read (the run, the artifact listing): the filter travels on every attempt, and only the answer is printed.
    const filtered = fakeGh(['429', '503', 'ok']);
    const answer = ghGet(filtered, [ENDPOINT, '.workflow_id']);
    expect(answer.status, answer.err).toBe(0);
    expect(answer.stdout.toString('utf8')).toBe('answer 3\n');
    expect(answer.calls).toEqual([1, 2, 3].map(() => ['api', ENDPOINT, '--method', 'GET', '--jq', '.workflow_id']));
    expect(answer.err).toContain('transient="HTTP 429"');
    expect(answer.err).toContain('transient="HTTP 503"');
  });

  it('is bounded: three transient failures in a row fail by name after exactly three calls, and nothing reaches stdout', () => {
    const stub = fakeGh(['502', 'net', '429', 'ok']);
    const read = ghGet(stub, [ENDPOINT]);
    expect(read.status).toBe(1);
    expect(read.calls, 'the fourth, good answer is never asked for').toHaveLength(3);
    expect(read.err).toContain(`learning_store_github_read_exhausted: GET ${ENDPOINT} failed 3 times (last: HTTP 429)`);
    expect(read.stdout.length, 'no failed attempt\'s body reaches the caller').toBe(0);
  });

  it('waits between attempts, by the stated backoff (JULIUS_STORE_GH_BACKOFF_S times the attempt), and refuses an unbounded one', () => {
    const stub = fakeGh(['502', 'ok']);
    const started = Date.now();
    const read = ghGet(stub, [ENDPOINT], { JULIUS_STORE_GH_BACKOFF_S: '1' });
    expect(read.status, read.err).toBe(0);
    expect(Date.now() - started, 'one wait of 1 x 1 s before the second attempt').toBeGreaterThanOrEqual(900);
    for (const backoff of ['abc', '100', '-1']) {
      const refused = ghGet(fakeGh(['ok']), [ENDPOINT], { JULIUS_STORE_GH_BACKOFF_S: backoff });
      expect(refused.status, backoff).toBe(1);
      expect(refused.err).toContain(`julius_store_github_backoff_invalid: '${backoff}'`);
      expect(refused.calls).toHaveLength(0);
    }
  });

  it('CONTROL: an HTTP 4xx other than 429 IS the answer: refused at once, never asked again, its body never reaching stdout', () => {
    for (const code of ['404', '403', '401', '422'] as const) {
      const read = ghGet(fakeGh([code, 'ok']), [ENDPOINT, '.id']);
      expect(read.status, code).toBe(1);
      expect(read.calls, `HTTP ${code} is not retried`).toHaveLength(1);
      expect(read.err).toContain(`learning_store_github_read_refused: GET ${ENDPOINT} answered HTTP ${code} (not retried)`);
      expect(read.stdout.length).toBe(0);
    }
    // A failure the script cannot name as transient (here: gh has no token) is not guessed to be one.
    const unnamed = ghGet(fakeGh(['auth', 'ok']), [ENDPOINT]);
    expect(unnamed.status).toBe(1);
    expect(unnamed.calls).toHaveLength(1);
    expect(unnamed.err).toContain(`learning_store_github_read_failed: GET ${ENDPOINT} failed (gh exit 4) for a cause that is not transient (not retried)`);
  });

  it('CONTROL: an integrity failure is never retried into a pass: the first answer is final, whatever its bytes', () => {
    // The restore's own check on what it fetched (workflow r5 step 3): the digest the WITHOUT run recorded. The second
    // planned answer is the RECORDED bytes, so a retry of the check would pass; it must never be asked for.
    const recorded = Buffer.from(`PGDMP\0recorded ${randomBytes(8).toString('hex')}`);
    const tampered = Buffer.from(`PGDMP\0tampered ${randomBytes(8).toString('hex')}`);
    const check = (stub: string) => {
      const out = join(stub, 'julius.pgdump').replaceAll('\\', '/');
      const script = [
        'set -euo pipefail',
        `"$STORE_SCRIPT" gh-get ${ENDPOINT.replace('runs/4242', 'artifacts/901/zip')} > "$OUT"`,
        'actual=$(sha256sum < "$OUT" | cut -d" " -f1)',
        '[ "$actual" = "$RECORDED" ] || { echo "learning_store_digest_mismatch: the store is not the one its run recorded" >&2; exit 1; }',
        'echo "digest bound: $actual"',
      ].join('\n');
      const result = spawnSync(BASH, ['--noprofile', '--norc', '-c', script], {
        encoding: 'utf8', timeout: 60_000,
        env: {
          PATH: `${join(stub, 'bin')}${delimiter}${process.env.PATH ?? ''}`, SystemRoot: process.env.SystemRoot ?? '', TEMP: tmpdir(), TMP: tmpdir(),
          HOME: process.env.HOME ?? '', LC_ALL: 'C', GH_STUB: stub.replaceAll('\\', '/'), JULIUS_STORE_GH_BACKOFF_S: '0',
          STORE_SCRIPT: SCRIPT.replaceAll('\\', '/'), OUT: out, RECORDED: createHash('sha256').update(recorded).digest('hex'),
        },
      });
      return { status: result.status, out: `${result.stdout}${result.stderr}`, calls: callsOf(stub) };
    };
    const refused = check(fakeGh(['ok', 'ok'], { 1: tampered, 2: recorded }));
    expect(refused.status).toBe(1);
    expect(refused.out).toContain('learning_store_digest_mismatch: the store is not the one its run recorded');
    expect(refused.calls, 'one read; the recorded bytes behind it were never fetched').toHaveLength(1);
    // The check can pass: the same composition on the recorded bytes binds them.
    const bound = check(fakeGh(['ok'], { 1: recorded }));
    expect(bound.status, bound.out).toBe(0);
    expect(bound.out).toContain(`digest bound: ${createHash('sha256').update(recorded).digest('hex')}`);
  });

  it('is a GET of one repository\'s Actions endpoint by construction: a write, a flag or another API is refused before gh is called', () => {
    for (const args of [
      [], ['repos/o/r/actions/runs/1', '.id', '-f'], ['--method=POST'], ['-X', 'POST'], ['graphql'], ['repos/o/r/pulls/1/merge'],
      ['repos/o/r/actions/runs/1 --method POST'], ['repos/o/r/actions/runs/1;id'], ['/repos/o/r/actions/runs/1'], ['repos/o/r/actions/../../../user'],
    ]) {
      const read = ghGet(fakeGh(['ok']), args);
      expect(read.status, JSON.stringify(args)).toBe(1);
      expect(read.calls, `${JSON.stringify(args)}: gh is never called`).toHaveLength(0);
      expect(read.err).toMatch(/usage: julius-learning-store\.sh|julius_store_github_endpoint_invalid/u);
    }
    // Every call it makes is `gh api <endpoint> --method GET [--jq <filter>]`: no field, no input, no other method.
    const source = readFileSync(SCRIPT, 'utf8');
    expect(source).toContain('gh_call=(gh api "$endpoint" --method GET)');
    expect(source.match(/\bgh api\b/gu), 'one place builds a GitHub call').toHaveLength(1);
  });
});
