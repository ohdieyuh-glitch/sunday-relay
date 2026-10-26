/**
 * REHEARSAL HARNESS — SIMULATED. TEST-ONLY. NEVER PART OF THE PRODUCTION SERVER.
 *
 * Serves the REAL Wonderland admission, /status and Start routes on
 * 127.0.0.1:8793 so the client can rehearse the second phrase
 * (`acknowledgeRerun: "RERUN PAID MISSION"`) against the bridge change.
 * Everything behind the routes is fake:
 * - the two prior-run counts are chosen by this harness's own argv, for both
 *   /status and the Start's claim core: `--prior 0 | 1 | UNKNOWN` is the
 *   attempted-marker count (`priorAttempted`), and `--completed 0 | 1 |
 *   UNKNOWN` (default 0) is the step-9 completed-marker count, which with the
 *   fixture workflow's recorded constant (0 for this namespace) is
 *   `priorCompleted`;
 * - `gh` is a recording fake: it answers main's workflow, contract and lane
 *   grant from fixtures, answers the spent tag as absent, and NEVER runs
 *   `gh workflow run` or any other process. A "dispatch" is a logged argv.
 * - the paired session is any request carrying `Relay-Session <token>` with
 *   the harness's token (`--session-token`, default `rehearsal-session`) for
 *   project `rehearsal-project`; the founder is `rehearsal-founder`.
 * - the admission file is a fresh temporary directory per launch.
 *
 * No environment variable is read. Nothing in `relay-bridge/server.ts` or any
 * other production file imports this; a source-scan test pins that.
 *
 * Launch (from the repository root, no npm):
 *   node node_modules/esbuild/bin/esbuild relay-bridge/rehearsal/rerun-consent-harness.ts --bundle --platform=node --format=cjs --outfile=dist/rehearsal/rerun-consent-harness.cjs --log-level=warning
 *   node dist/rehearsal/rerun-consent-harness.cjs --prior 1 [--completed 0|1|UNKNOWN]
 */

import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PAID_WORKFLOW_FILE } from '../../src/relay/integration/wonderland-admission/admission-contract';
import { openAdmissionFile } from '../../src/relay/integration/wonderland-admission/admission-file';
import {
  createOperatorClaimTool,
  LANE_GRANT_SOURCE,
  missionContractPath,
  type GhResult,
  type GhSpawner,
  type PriorAttemptRead,
  type PriorAttemptReader,
} from '../../src/relay/integration/wonderland-admission/operator-claim';
import {
  createWonderlandAdmissionService,
  handleWonderlandAdmissionRoute,
  handleWonderlandStatusRoute,
  wonderlandAdmissionRequestFrom,
} from '../wonderland-admission-route';
import { handleWonderlandMissionStartRoute } from '../wonderland-mission-start-route';

export const REHEARSAL_HOST = '127.0.0.1';
export const REHEARSAL_PORT = 8793;
const TAG = '[SIMULATED rerun-consent rehearsal]';
const PROJECT = 'rehearsal-project';
const FOUNDER = 'rehearsal-founder';
const MISSION = 'julius-inworld-data-1';
const REPO = 'rehearsal/sunday-relay';
const SIMULATED_WORKFLOW_RUN = '1';

const WORKFLOW = `
name: rehearsal fixture (simulated)
on:
  workflow_dispatch:
    inputs:
      confirm_live:
        default: ''
      acknowledge_rerun:
        default: ''
      mission:
        description: 'slug'
      lane:
        description: 'lane'
      dispatch_key:
        description: 'key'
      run_id:
        default: ''
jobs:
  paid:
    steps:
      - run: |
          case "$MARKER_NAMESPACE" in
            julius-first-live) RECORDED_PAID_ATTEMPTS=1 ;;  # run 33697109210
            *)                 RECORDED_PAID_ATTEMPTS=0 ;;
          esac
`;
const LANE_GRANT = "const DEFAULT_LANES = Object.freeze(['lab']);\nconst MISSION_LANES = Object.freeze({\n  'julius-first-live': Object.freeze(['regression']),\n});\n";

export type RehearsalPrior = 0 | 1 | 'UNKNOWN';

export function parseRehearsalArgv(argv: readonly string[]): {
  readonly prior: RehearsalPrior;
  readonly completed: RehearsalPrior;
  readonly sessionToken: string;
} | null {
  const option = (name: string): string | null => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] ?? null : null;
  };
  const count = (raw: string | null): RehearsalPrior | null => (raw === '0' ? 0 : raw === '1' ? 1 : raw === 'UNKNOWN' ? 'UNKNOWN' : null);
  const prior = count(option('prior'));
  const completed = argv.includes('--completed') ? count(option('completed')) : 0;
  const sessionToken = option('session-token') ?? 'rehearsal-session';
  if (prior === null || completed === null || !/^[A-Za-z0-9_-]{8,128}$/u.test(sessionToken)) return null;
  return { prior, completed, sessionToken };
}

/** The recording fake `gh`. It never starts a process. */
export function rehearsalGh(log: (line: string) => void): GhSpawner & { readonly calls: string[][] } {
  const calls: string[][] = [];
  const contents = `repos/${REPO}/contents/`;
  return {
    calls,
    run(args): GhResult {
      calls.push([...args]);
      const target = args.find((arg) => arg.startsWith(contents));
      if (args[0] === 'api' && target !== undefined) {
        const path = target.slice(contents.length).replace(/\?ref=main$/u, '');
        const text = path === `.github/workflows/${PAID_WORKFLOW_FILE}` ? WORKFLOW
          : path === missionContractPath(MISSION) ? JSON.stringify({ markerNamespace: MISSION })
            : path === LANE_GRANT_SOURCE ? LANE_GRANT : null;
        return text === null ? { code: 1, stdout: '', stderr: 'HTTP 404' } : { code: 0, stdout: text, stderr: '' };
      }
      if (args[0] === 'api') {
        return { code: 1, stdout: `HTTP/2.0 404 Not Found\nDate: ${new Date().toUTCString()}\n\n{"message":"Not Found"}\n`, stderr: '' };
      }
      if (args[0] === 'workflow') {
        log(`${TAG} gh workflow run NOT EXECUTED; recorded argv: ${JSON.stringify(args)}`);
        return { code: 0, stdout: `https://github.com/${REPO}/actions/runs/${SIMULATED_WORKFLOW_RUN}\n`, stderr: '' };
      }
      return { code: 99, stdout: '', stderr: '' };
    },
  };
}

export function rehearsalPriorReader(prior: RehearsalPrior, completed: RehearsalPrior = 0): PriorAttemptReader {
  const of = (value: RehearsalPrior): PriorAttemptRead => (value === 'UNKNOWN' ? { readable: false } : { readable: true, counted: value });
  return { read: () => Promise.resolve(of(prior)), readCompleted: () => Promise.resolve(of(completed)) };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64 * 1024) reject(new Error('body too large'));
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const header = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

export function startRehearsal(input: {
  readonly prior: RehearsalPrior;
  readonly completed: RehearsalPrior;
  readonly sessionToken: string;
  readonly log?: (line: string) => void;
}) {
  const log = input.log ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  const storePath = join(mkdtempSync(join(tmpdir(), 'relay-rerun-rehearsal-')), 'admission.json');
  const env: Record<string, string | undefined> = {
    JULIUS_WONDERLAND_ADMISSION: '1',
    JULIUS_J1_PROJECT_ID: PROJECT,
    JULIUS_J1_FOUNDER_PLAYER_ID: FOUNDER,
    JULIUS_WONDERLAND_MISSION: MISSION,
    JULIUS_WONDERLAND_ADMISSION_STORE: storePath,
    JULIUS_WONDERLAND_START: '1',
    JULIUS_WONDERLAND_GITHUB_REPO: REPO,
    JULIUS_WONDERLAND_START_LANE: 'lab',
  };
  const ports = createWonderlandAdmissionService({
    env,
    operatorToken: undefined,
    verifyNativeSession: ({ token }) => (token === input.sessionToken ? { playerId: FOUNDER, projectId: PROJECT, sessionId: 'rehearsal-session-1' } : null),
    readWorkflowText: () => null,
  });
  const gh = rehearsalGh(log);
  const prior = rehearsalPriorReader(input.prior, input.completed);
  const tool = createOperatorClaimTool(openAdmissionFile(storePath), gh, undefined, prior);
  // The fixture workflow records 0 prior paid attempts for this namespace, so priorCompleted is the completed count.
  const statusCount = () => Promise.resolve({ attempted: input.prior, completed: input.completed });
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const send = (status: number, body: unknown): void => {
        log(`${TAG} ${req.method ?? ''} ${req.url ?? ''} -> ${String(status)} ${JSON.stringify(body)}`);
        res.writeHead(status, { 'content-type': 'application/json', 'x-relay-simulated': 'rerun-consent-rehearsal' });
        res.end(JSON.stringify(body));
      };
      try {
        const rawUrl = req.url ?? '/';
        const url = rawUrl.startsWith('/relay-api/') ? rawUrl.slice('/relay-api'.length) : rawUrl;
        const path = url.split('?')[0] ?? '/';
        const body = req.method === 'POST' ? await readBody(req) : undefined;
        const now = new Date();
        const request = wonderlandAdmissionRequestFrom({
          method: req.method ?? 'GET',
          path,
          url,
          authorization: header(req.headers.authorization),
          origin: header(req.headers.origin),
          body,
          idempotencyKey: header(req.headers['x-relay-idempotency-key']),
          remoteAddress: req.socket.remoteAddress,
          host: header(req.headers.host),
          forwarded: req.headers['x-forwarded-for'] !== undefined || req.headers.forwarded !== undefined,
          nowIso: now.toISOString(),
          nowMs: now.getTime(),
        });
        const answer = await handleWonderlandAdmissionRoute(request, ports)
          ?? await handleWonderlandStatusRoute(request, ports, statusCount)
          ?? await handleWonderlandMissionStartRoute(request, ports, { claimTool: () => tool });
        if (answer === null) send(404, { error: { kind: 'not_found', message: 'Not found (simulated rehearsal).' } });
        else send(answer.status, answer.body);
      } catch {
        send(500, { error: { kind: 'rehearsal_error', message: 'Simulated rehearsal error.' } });
      }
    })();
  });
  server.listen(REHEARSAL_PORT, REHEARSAL_HOST, () => {
    log(`${TAG} listening on http://${REHEARSAL_HOST}:${String(REHEARSAL_PORT)} ONLY. prior=${String(input.prior)} completed=${String(input.completed)}. project=${PROJECT} founder=${FOUNDER}.`);
    log(`${TAG} every answer is simulated; no gh process is started and no workflow can run. Store: ${storePath}`);
  });
  return { server, gh, storePath, close: () => { server.close(); ports.close(); } };
}

if (require.main === module) {
  const parsed = parseRehearsalArgv(process.argv.slice(2));
  if (parsed === null) {
    process.stderr.write('Usage: node dist/rehearsal/rerun-consent-harness.cjs --prior 0|1|UNKNOWN [--completed 0|1|UNKNOWN] [--session-token <8-128 chars>]\n');
    process.exitCode = 2;
  } else {
    startRehearsal(parsed);
  }
}
