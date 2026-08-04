import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeFakeHermes } from '../relay-bridge/reviewer-harness/hermes/fake-executable';

/**
 * SIGNAL REGISTRATION, EXERCISED AS A REAL PROCESS.
 *
 * The shutdown EFFECTS were already covered — lifecycle refusal, `/healthz`
 * draining, and `cancelAll` against a real process group. What nothing covered
 * was the wiring in `main.ts`: that `process.on('SIGTERM', …)` is actually
 * registered on the process a platform will signal. A handler that was never
 * installed passes every one of those effect tests and still leaves Railway
 * killing a container mid-review.
 *
 * So this spawns the BUILT entry point, starts a real review against the
 * hanging fake Hermes, signals it, and watches what the operating system
 * actually does. Loopback only; no provider is contacted.
 *
 * BUILD-DEPENDENT, AND ACCOUNTED FOR. `npm test` runs before
 * `npm run relay:hermes:build`, so in a clean checkout the artifact does not
 * exist yet. The artifact-absent branch asserts that CI re-runs this exact
 * file after that build — the only place the claim can be proven — and
 * `scripts/ci-test-accounting.test.ts` holds the ledger.
 */

const ROOT = resolve(__dirname, '..');
const ENTRY = join(ROOT, 'dist-relay-hermes', 'main.cjs');
const TOKEN = 'signal-test-service-token';
const FAKE_KEY = 'sk-ant-SIGNAL-TEST-NEVER-REAL';

let dir: string;

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'relay-hermes-signal-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

/** A port nothing is listening on right now. */
function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => res(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms); });
const processTableHas = (token: string): boolean =>
  execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' }).includes(token);

interface Started {
  child: ReturnType<typeof spawn>;
  port: number;
  probe: string;
  output: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

async function startBuiltService(label: string): Promise<Started> {
  const port = await freePort();
  const probe = `relay-signal-probe-${label}-${process.pid}`;
  const executable = writeFakeHermes(join(dir, probe), 'hang');

  let output = '';
  const child = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      HOST: '127.0.0.1',
      PORT: String(port),
      RELAY_HERMES_SERVICE_TOKEN: TOKEN,
      RELAY_HERMES_PROVIDER: 'anthropic',
      RELAY_HERMES_MODEL: 'claude-sonnet-5',
      ANTHROPIC_API_KEY: FAKE_KEY,
      RELAY_HERMES_EXECUTABLE: executable,
    },
  });
  child.stdout?.on('data', (c: Buffer) => { output += c.toString('utf8'); });
  child.stderr?.on('data', (c: Buffer) => { output += c.toString('utf8'); });

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
    child.once('close', (code, signal) => res({ code, signal }));
  });

  // Wait for it to actually listen.
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (r.status === 200) break;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  return { child, port, probe, output: () => output, exited };
}

describe('the built service registers real signal handlers', () => {
  if (!existsSync(ENTRY)) {
    it('is re-run by CI after the Hermes service build', () => {
      const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'relay-ci.yml'), 'utf8');
      expect(
        workflow.includes('relay-hermes-service/signal-lifecycle.test.ts'),
        'this file needs dist-relay-hermes/main.cjs, so CI must re-run it after `npm run relay:hermes:build`',
      ).toBe(true);
      expect(
        workflow.indexOf('relay-hermes-service/signal-lifecycle.test.ts'),
        'the re-run must come AFTER the build that produces the artifact',
      ).toBeGreaterThan(workflow.indexOf('npm run relay:hermes:build'));
    });
    return;
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    it(`drains, cancels the active review and exits on ${signal}`, async () => {
      const s = await startBuiltService(signal.toLowerCase());
      try {
        // It is up and healthy.
        expect((await fetch(`http://127.0.0.1:${s.port}/healthz`)).status).toBe(200);

        // Start a review that will never finish on its own.
        const created = await fetch(`http://127.0.0.1:${s.port}/v1/reviews`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            runId: `run-${signal}`, idempotencyKey: `key-${signal}`, prompt: 'review',
            limits: { timeoutMs: 60_000, maxOutputBytes: 4096, maxTurns: 1, maxPromptBytes: 4096 },
          }),
        });
        expect(created.status).toBe(200);

        for (let i = 0; i < 60 && !processTableHas(s.probe); i += 1) await sleep(100);
        expect(processTableHas(s.probe), 'the review process should be live before signalling').toBe(true);

        // THE SIGNAL. This is the part no other test exercises.
        s.child.kill(signal);

        /*
         * WAIT FOR DRAINING TO BE OBSERVABLE BEFORE PROBING.
         *
         * Delivering a signal and running its handler are two events, and
         * between them the server is still an ordinary server. Probing in that
         * window tested the SCHEDULER, not the drain: on a quiet box the
         * handler always won and the test passed; under load the request
         * sometimes arrived first and the test failed for a service behaving
         * exactly as designed. A flake that only appears when the box is busy
         * is worse than no test, because it teaches people to re-run.
         *
         * `/healthz` reports the lifecycle, so draining is observable. Once it
         * says so, refusing a new review is a real obligation and this asserts
         * it. A closed socket is also a refusal, and is accepted as one.
         */
        for (let i = 0; i < 100; i += 1) {
          try {
            const health = await fetch(`http://127.0.0.1:${s.port}/healthz`);
            const body = await health.json() as { status?: string };
            if (body.status === 'shutting_down') break;
          } catch {
            break; // already stopped listening — the strongest refusal there is
          }
          await sleep(20);
        }

        // A review created while draining must never be accepted. The server
        // may already have stopped listening, which is also a refusal.
        let refusedStatus: number | 'connection-refused';
        try {
          const during = await fetch(`http://127.0.0.1:${s.port}/v1/reviews`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              runId: `late-${signal}`, idempotencyKey: `late-key-${signal}`, prompt: 'late',
              limits: { timeoutMs: 1000, maxOutputBytes: 1024, maxTurns: 1, maxPromptBytes: 1024 },
            }),
          });
          refusedStatus = during.status;
        } catch {
          refusedStatus = 'connection-refused';
        }
        expect(refusedStatus, 'a draining service must not accept a new review').not.toBe(200);

        // The handler ran, and the process exited within its bounded grace.
        const ended = await Promise.race([
          s.exited,
          sleep(20_000).then(() => null),
        ]);
        expect(ended, `${signal} did not reach a registered handler`).not.toBeNull();
        expect(ended?.code).toBe(0);

        // The handler said so, and the run was cancelled rather than completed.
        expect(s.output()).toContain(`received ${signal}`);
        expect(s.output()).toContain('draining');

        // No orphan process group survives the shutdown.
        for (let i = 0; i < 100 && processTableHas(s.probe); i += 1) await sleep(100);
        expect(processTableHas(s.probe), 'an interrupted review left an orphan process').toBe(false);

        // Nothing the process printed may carry a credential or the token.
        expect(s.output()).not.toContain(FAKE_KEY);
        expect(s.output()).not.toContain(TOKEN);
      } finally {
        if (s.child.exitCode === null) s.child.kill('SIGKILL');
      }
    }, 120_000);
  }
});
