#!/usr/bin/env node
/**
 * WONDERLAND DEPLOY CHECK — IS THE HOSTED BRIDGE THE BUILD WE MEANT, READY, AND CLOSED, BEFORE ANY PLAYER?
 *
 * Railway deploys `main` by itself. Nothing said, from outside, which commit it
 * had deployed, and the hosted-store procedure's readiness step was a `curl`
 * read by eye. This is the bridge's counterpart of proving which commit Vercel
 * serves: one command, nothing written, every answer a fact the bridge gives.
 *
 *   RELAY_BRIDGE_TOKEN=... node scripts/wonderland-deploy-check.mjs \
 *     --bridge https://<bridge> --origin <an origin the bridge allows> --expect-commit <40-hex sha>
 *
 * ONLY READS. The public liveness probe; the readiness report, once without the
 * operator token (it must be refused) and once with it; and the probe again from
 * an origin no deployment allows, then from the one given. No player, no
 * session, no command, no write.
 *
 * THE CHECKS (`DEPLOY_CHECKS`, a closed list), each PASS or FAIL with what was
 * seen. Reported, never judged: the voice schema, the EOS configuration, and
 * the boot (which start of the process answered, and since when).
 *
 * Exit: 0 every check passed; 1 a check failed or the bridge could not be
 * reached; 2 usage, or no operator token.
 */

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { inspectR16Host, readR16Backend, resolveR16Host } from './wonderland-r16-harness.mjs';

export const DEPLOY_CHECK_VERSION = 'wonderland-deploy-check.v1';

/** THE CLOSED LIST. A check not judged is a check failed. */
export const DEPLOY_CHECKS = Object.freeze([
  'HEALTH: the public liveness probe answers {"status":"ok"} and says nothing else',
  'HOSTED: the bridge is reached over HTTPS on a public host',
  'OPERATOR ONLY: the readiness report is refused without the operator token',
  'CORS: an origin the bridge does not allow is refused, and an allowed one is echoed exactly',
  'BUILD: the platform attests the commit the bridge runs, and it is the expected one',
  'PRODUCTION: the bridge takes the production branch of its gates',
  'STORE: the database is connected and its ledger is gap-free, with nothing pending and no stamp this build does not know',
  'SOCIAL: the social store is ready',
]);

/** An origin no deployment allows: `.invalid` is reserved and never resolves (RFC 6761). */
export const DEPLOY_CHECK_FOREIGN_ORIGIN = 'https://not-an-allowed-origin.invalid';

/**
 * EVERY FACT THE CHECKS JUDGE, by GET alone. The liveness probe is the one at
 * the bridge's root (`/health`), whatever path `--bridge` carries; the report
 * is read the way the R16 harness reads it.
 */
export async function readDeployFacts({ bridge, origin, operatorToken, fetch, resolve }) {
  const root = new URL(bridge).origin;
  const get = async (url, headers = {}) => {
    try {
      const response = await fetch(url, { method: 'GET', headers });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return { status: response.status, body, allowOrigin: response.headers.get('access-control-allow-origin') };
    } catch {
      return { status: 0, body: null, allowOrigin: null };
    }
  };
  const health = await get(`${root}/health`);
  const unauthenticated = await get(`${bridge}/wonderland/readiness`);
  const foreign = await get(`${root}/health`, { origin: DEPLOY_CHECK_FOREIGN_ORIGIN });
  const allowed = await get(`${root}/health`, { origin });
  const report = operatorToken ? await get(`${bridge}/wonderland/readiness`, { authorization: `Bearer ${operatorToken}` }) : null;
  const backend = await readR16Backend({ bridge, operatorToken, fetch });
  const host = await inspectR16Host(bridge, resolve);
  const surfaces = report?.status === 200 ? report.body?.data?.surfaces ?? null : null;
  return Object.freeze({
    origin, health, unauthenticated, foreign, allowed, backend, host,
    reported: Object.freeze({
      voiceSchema: typeof surfaces?.voiceSchema === 'string' ? surfaces.voiceSchema : 'UNKNOWN',
      eosClientConfig: typeof surfaces?.eosClientConfig === 'string' ? surfaces.eosClientConfig : 'UNKNOWN',
      eosTrustedServer: typeof surfaces?.eosTrustedServer === 'string' ? surfaces.eosTrustedServer : 'UNKNOWN',
    }),
  });
}

/** THE CHECKS, JUDGED. Pure: every fact is an input. */
export function judgeDeploy(facts, expectCommit) {
  const rows = [];
  const row = (index, passed, detail) => {
    rows.push(Object.freeze({ name: DEPLOY_CHECKS[index], result: passed ? 'PASS' : 'FAIL', detail: passed ? '' : detail }));
  };
  const { health, unauthenticated, foreign, allowed, origin, backend, host } = facts;
  row(0, health.status === 200 && JSON.stringify(health.body) === JSON.stringify({ status: 'ok' }),
    `it answered ${String(health.status)} ${JSON.stringify(health.body)}`);
  row(1, host.https && (host.kind === 'PUBLIC_ADDRESS' || (host.kind === 'NAME' && host.resolves === 'PUBLIC')),
    `https=${String(host.https)} host=${host.kind} resolves=${host.resolves}`);
  row(2, unauthenticated.status === 401, `without the token it answered ${String(unauthenticated.status)}`);
  row(3, foreign.status === 403 && foreign.allowOrigin === null && allowed.status === 200 && allowed.allowOrigin === origin,
    `a foreign origin got ${String(foreign.status)} (allow-origin ${String(foreign.allowOrigin)}); ${origin} got ${String(allowed.status)} (allow-origin ${String(allowed.allowOrigin)})`);
  if (!backend.readable) {
    for (const index of [4, 5, 6, 7]) row(index, false, `the readiness report could not be read (${backend.reason})`);
    return Object.freeze(rows);
  }
  row(4, backend.commit !== null && backend.commit === expectCommit,
    backend.commit === null ? 'no platform attested a commit' : `the platform attests ${backend.commit}, not ${expectCommit}`);
  row(5, backend.production === true, 'the bridge takes the development branch of its gates');
  const ledger = backend.ledger;
  row(6, backend.database === 'CONNECTED' && ledger !== null && ledger.gapFree && ledger.pending.length === 0 && ledger.unknown.length === 0,
    backend.database !== 'CONNECTED'
      ? `the database is ${backend.database}`
      : `the ledger is through ${String(ledger?.through ?? 'nothing')}, gap_free=${String(ledger?.gapFree)}, pending=${JSON.stringify(ledger?.pending ?? null)}, unknown=${JSON.stringify(ledger?.unknown ?? null)}`);
  row(7, backend.social === 'READY', `social is ${backend.social}`);
  return Object.freeze(rows);
}

/* --------------------------------------------------------------------- CLI --- */

const option = (argv, name) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};

async function main(argv, env) {
  const out = (line) => process.stdout.write(`${line}\n`);
  const bridge = option(argv, 'bridge')?.replace(/\/+$/u, '');
  const origin = option(argv, 'origin')?.trim().replace(/\/+$/u, '');
  const expectCommit = option(argv, 'expect-commit')?.trim().toLowerCase();
  if (!bridge || !/^https?:\/\/[^\s]+$/u.test(bridge) || !origin || !/^https?:\/\/[^\s/]+$/u.test(origin) || !expectCommit || !/^[0-9a-f]{40}$/u.test(expectCommit)) {
    process.stderr.write('usage: wonderland-deploy-check.mjs --bridge <url> --origin <an allowed origin> --expect-commit <40-hex sha>\n');
    return 2;
  }
  if (!env.RELAY_BRIDGE_TOKEN) {
    out('DEPLOY BLOCKED — RELAY_BRIDGE_TOKEN is required: the readiness report is operator-only.');
    return 2;
  }
  const facts = await readDeployFacts({ bridge, origin, operatorToken: env.RELAY_BRIDGE_TOKEN, fetch, resolve: resolveR16Host });
  if (facts.health.status === 0) {
    out('DEPLOY BLOCKED — the bridge could not be reached.');
    return 1;
  }
  out(`DEPLOY ${DEPLOY_CHECK_VERSION} bridge=${new URL(bridge).host} expect_commit=${expectCommit}`);
  const rows = judgeDeploy(facts, expectCommit);
  for (const row of rows) out(`DEPLOY ${row.result} ${row.name}${row.result === 'FAIL' ? ` — ${row.detail}` : ''}`);
  const boot = facts.backend.readable ? `boot=${facts.backend.bootId.slice(0, 12)} started_at=${String(facts.backend.startedAt)}` : 'boot=UNKNOWN';
  out(`DEPLOY REPORTED voice_schema=${facts.reported.voiceSchema} eos_client_config=${facts.reported.eosClientConfig} eos_trusted_server=${facts.reported.eosTrustedServer} ${boot}`);
  const failed = rows.filter((row) => row.result === 'FAIL').length + (DEPLOY_CHECKS.length - rows.length);
  out(`DEPLOY SUMMARY passed=${String(rows.length - rows.filter((row) => row.result === 'FAIL').length)} failed=${String(failed)} of=${String(DEPLOY_CHECKS.length)}`);
  return failed === 0 ? 0 : 1;
}

const entry = (() => {
  if (!process.argv[1]) return null;
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; }
})();
if (entry === import.meta.url) {
  main(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; });
}
