import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  REVISION_MARKER,
  buildArtifact,
  createLocalDirectoryDeploymentProvider,
} from './local-directory-deployment-provider';
import { decideShipped, providerSupportsEnvironment } from '../src/relay/mission/repository-target';
import type { ShipStageEvidence } from '../src/relay/mission/repository-target';

/**
 * THE DEPLOY AND LIVE-VERIFY STAGES, PERFORMED RATHER THAN DESCRIBED.
 *
 * Before this, `DeploymentProvider` had one implementation and it was a fake in
 * a test. These exercise a real copy onto a real filesystem and a real HTTP
 * read-back from a real server, because the two failures worth catching here
 * cannot be reproduced with a stub that agrees with itself: a deploy that
 * reports success against a stale build, and a probe that "confirms" a revision
 * it took from its own input.
 *
 * ONE LIMIT, STATED RATHER THAN GLOSSED. Mutating `deploy` to echo
 * `request.revision` instead of reading the marker back does NOT fail these
 * tests, and no test here can make it: a write and a read inside one call
 * cannot disagree on a working filesystem. What IS enforced is the part that
 * is observable — the marker's ordering, the not-written path reporting null,
 * and `verifyLive` reading the RUNNING system, where the same mutation
 * (echoing `expectedRevision`) fails three tests. The `deployedRevision`
 * contract is real at the boundary that can actually be observed.
 */

const NOW = '2026-08-11T12:00:00.000Z';
const REV = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const temporaries: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((r) => server.close(() => r()));
  for (const path of temporaries.splice(0)) {
    try { rmSync(path, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function tempDir(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  temporaries.push(path);
  return path;
}

/** A built artifact: a directory with a file in it. */
function artifact(): string {
  const root = tempDir('relay-artifact-');
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>app</title>\n');
  return root;
}

/** A real static server over a real directory. */
async function serve(root: string): Promise<string> {
  const server = createServer((request, response) => {
    const name = (request.url ?? '/').replace(/^\/+/, '');
    // Read FIRST. `writeHead(200)` then a throwing read commits the headers and
    // the catch cannot send a 404 onto them — ERR_HTTP_HEADERS_SENT, which
    // surfaces as an unhandled server error rather than a test failure.
    let body: Buffer | null = null;
    try { body = readFileSync(join(root, name)); } catch { body = null; }
    if (body === null) response.writeHead(404).end('not found');
    else response.writeHead(200).end(body);
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${String(address.port)}`;
}

const provider = (deployRoot: string, baseUrl: string | null = null) =>
  createLocalDirectoryDeploymentProvider({ deployRoot, baseUrl, now: () => NOW });

describe('the deploy actually happens, and is read back rather than assumed', () => {
  it('copies the artifact and reports the revision it READ off disk', async () => {
    const root = tempDir('relay-deploy-');
    const result = await provider(root).deploy({
      repositoryKey: 'local:demo', environment: 'staging', revision: REV,
      branch: 'relay/m1', artifactPath: artifact(), requestedAt: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.deployedRevision).toBe(REV);
    // The artifact is really there.
    expect(readFileSync(join(root, REV, 'index.html'), 'utf8')).toContain('<title>app</title>');
    expect(readFileSync(join(root, REV, REVISION_MARKER), 'utf8').trim()).toBe(REV);
  });

  it('REPLACES a previous deploy of the same revision instead of merging into it', async () => {
    /**
     * A stale file surviving underneath a new deploy is the classic way a
     * deployment "succeeds" while serving something nobody built.
     */
    const root = tempDir('relay-deploy-');
    mkdirSync(join(root, REV), { recursive: true });
    writeFileSync(join(root, REV, 'stale.js'), 'from an older build\n');
    const result = await provider(root).deploy({
      repositoryKey: 'local:demo', environment: 'staging', revision: REV,
      branch: 'relay/m1', artifactPath: artifact(), requestedAt: NOW,
    });
    expect(result.ok).toBe(true);
    expect(() => readFileSync(join(root, REV, 'stale.js'))).toThrow();
  });

  it('writes Relay\'s marker LAST, so an artifact carrying its own cannot win', async () => {
    /**
     * A repository that commits a `relay-revision.txt`, or a build that emits
     * one, would otherwise decide what this deploy reports it shipped. The
     * ordering is the guard, and swapping it is a plausible refactor.
     */
    const built = tempDir('relay-artifact-');
    writeFileSync(join(built, 'index.html'), '<!doctype html>\n');
    writeFileSync(join(built, REVISION_MARKER), `${OTHER}\n`);
    const root = tempDir('relay-deploy-');
    const result = await provider(root).deploy({
      repositoryKey: 'local:demo', environment: 'staging', revision: REV,
      branch: 'relay/m1', artifactPath: built, requestedAt: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.deployedRevision).toBe(REV);
    expect(readFileSync(join(root, REV, REVISION_MARKER), 'utf8').trim()).toBe(REV);
  });

  it('reports NOT-OK when the marker cannot be written', async () => {
    /**
     * `deployedRevision` is documented as never defaulted from the request, and
     * this is the path where the difference shows: the copy landed, the marker
     * did not, and the honest answer is null rather than the revision that was
     * asked for. A directory at the marker's path makes the write fail for
     * real.
     */
    const built = tempDir('relay-artifact-');
    writeFileSync(join(built, 'index.html'), '<!doctype html>\n');
    mkdirSync(join(built, REVISION_MARKER));
    const root = tempDir('relay-deploy-');
    const result = await provider(root).deploy({
      repositoryKey: 'local:demo', environment: 'staging', revision: REV,
      branch: 'relay/m1', artifactPath: built, requestedAt: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.deployedRevision).toBeNull();
    expect(result.detail).toContain('marker could not be written');
  });

  it('REFUSES production, in the provider itself and not only at the gate', async () => {
    const root = tempDir('relay-deploy-');
    // The gate refuses first...
    const gate = providerSupportsEnvironment({
      descriptor: provider(root).descriptor, environment: 'production',
    });
    expect(gate.ok).toBe(false);
    // ...and the module that would do the damage refuses too, because a
    // provider that is safe only when its caller remembers to ask is not safe.
    const result = await provider(root).deploy({
      repositoryKey: 'local:demo', environment: 'production', revision: REV,
      branch: 'relay/m1', artifactPath: artifact(), requestedAt: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('staging only');
  });

  it('REFUSES a destination that escapes the deploy root through a symlink', async () => {
    const root = tempDir('relay-deploy-');
    const outside = tempDir('relay-outside-');
    symlinkSync(outside, join(root, REV));
    const result = await provider(root).deploy({
      repositoryKey: 'local:demo', environment: 'staging', revision: REV,
      branch: 'relay/m1', artifactPath: artifact(), requestedAt: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('outside the deploy root');
  });

  it('never creates the deploy root, so a typo cannot become a successful deploy', async () => {
    const result = await provider(join(tempDir('relay-deploy-'), 'tpyo')).deploy({
      repositoryKey: 'local:demo', environment: 'staging', revision: REV,
      branch: 'relay/m1', artifactPath: artifact(), requestedAt: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('deploy root does not exist');
  });
});

describe('live verification reads the RUNNING system', () => {
  it('confirms the revision the server actually serves', async () => {
    const root = tempDir('relay-deploy-');
    const p = provider(root);
    await p.deploy({
      repositoryKey: 'local:demo', environment: 'staging', revision: REV,
      branch: 'relay/m1', artifactPath: artifact(), requestedAt: NOW,
    });
    const url = await serve(join(root, REV));
    const probe = await p.verifyLive({ url, expectedRevision: REV, observedAt: NOW });
    expect(probe.reachable).toBe(true);
    expect(probe.healthy).toBe(true);
    expect(probe.reportedRevision).toBe(REV);
  });

  it('catches a deploy that shipped a STALE revision', async () => {
    /**
     * The failure this whole stage exists for. The server is serving one
     * revision and the Mission believes it deployed another; a probe that
     * echoed its own `expectedRevision` would report healthy.
     */
    const root = tempDir('relay-deploy-');
    const p = provider(root);
    await p.deploy({
      repositoryKey: 'local:demo', environment: 'staging', revision: OTHER,
      branch: 'relay/m1', artifactPath: artifact(), requestedAt: NOW,
    });
    const url = await serve(join(root, OTHER));
    const probe = await p.verifyLive({ url, expectedRevision: REV, observedAt: NOW });
    expect(probe.reachable).toBe(true);
    expect(probe.healthy).toBe(false);
    expect(probe.reportedRevision).toBe(OTHER);
    expect(probe.detail).toContain(`serving ${OTHER}`);
  });

  it('drives DEPLOY → LIVE VERIFY → SHIPPED as one real chain', async () => {
    /**
     * The whole point of the stage, performed rather than described: a real
     * copy, a real server, a real HTTP read-back, and the lifecycle's own
     * verdict computed from what was OBSERVED at each step.
     */
    const root = tempDir('relay-deploy-');
    const p = provider(root);
    const deployment = await p.deploy({
      repositoryKey: 'local:demo', environment: 'staging', revision: REV,
      branch: 'relay/m1', artifactPath: artifact(), requestedAt: NOW,
    });
    const url = await serve(join(root, REV));
    const liveProbe = await p.verifyLive({ url, expectedRevision: REV, observedAt: NOW });

    const evidence: ShipStageEvidence = {
      stage: 'deployed',
      observedAt: deployment.observedAt,
      commitSha: null,
      branch: 'relay/m1',
      remoteRef: null,
      pullRequestRef: null,
      environment: deployment.environment,
      deployedRevision: deployment.deployedRevision,
      liveProbe,
      detail: deployment.detail,
    };
    const verdict = decideShipped({ committedSha: REV, deployment: evidence, liveProbe });
    expect(verdict.shipped).toBe(true);
    expect(verdict.liveRevision).toBe(REV);
  });

  it('refuses SHIPPED when the running system serves a different revision', async () => {
    const root = tempDir('relay-deploy-');
    const p = provider(root);
    const deployment = await p.deploy({
      repositoryKey: 'local:demo', environment: 'staging', revision: REV,
      branch: 'relay/m1', artifactPath: artifact(), requestedAt: NOW,
    });
    // Deployed REV, but something else is actually being served.
    const stale = tempDir('relay-stale-');
    writeFileSync(join(stale, REVISION_MARKER), `${OTHER}\n`);
    const url = await serve(stale);
    const liveProbe = await p.verifyLive({ url, expectedRevision: REV, observedAt: NOW });

    const verdict = decideShipped({
      committedSha: REV,
      deployment: {
        stage: 'deployed', observedAt: NOW, commitSha: null, branch: 'relay/m1',
        remoteRef: null, pullRequestRef: null, environment: deployment.environment,
        deployedRevision: deployment.deployedRevision, liveProbe, detail: null,
      },
      liveProbe,
    });
    // The deploy succeeded and the system is NOT serving what was deployed.
    // "Deployed" and "shipped" are different facts and this is the gap.
    expect(deployment.ok).toBe(true);
    expect(verdict.shipped).toBe(false);
  });

  it('separates UNREACHABLE from ANSWERED-BADLY', async () => {
    const root = tempDir('relay-deploy-');
    // Nothing is listening here.
    const dead = await provider(root).verifyLive({
      url: 'http://127.0.0.1:1', expectedRevision: REV, observedAt: NOW,
    });
    expect(dead.reachable).toBe(false);
    expect(dead.reportedRevision).toBeNull();

    // Something IS listening and has no marker: a 404 is an answer.
    const url = await serve(tempDir('relay-empty-'));
    const answered = await provider(root).verifyLive({ url, expectedRevision: REV, observedAt: NOW });
    // Collapsing these two into one boolean is how a 500 gets recorded as
    // "not deployed yet" rather than "deployed and broken".
    expect(answered.reachable).toBe(true);
    expect(answered.healthy).toBe(false);
  });

  it('does not accept a body that is not a revision', async () => {
    const root = tempDir('relay-serve-');
    writeFileSync(join(root, REVISION_MARKER), '<!doctype html><title>404</title>\n');
    const url = await serve(root);
    const probe = await provider(tempDir('relay-deploy-')).verifyLive({
      url, expectedRevision: REV, observedAt: NOW,
    });
    // A proxy or SPA fallback happily returns 200 and an HTML page for any
    // path. Treating that as a reported revision would be the provider
    // inventing agreement.
    expect(probe.healthy).toBe(false);
    expect(probe.reportedRevision).toBeNull();
  });
});

/**
 * The fixture's output directory is `build-output` rather than the repository's
 * usual build-output name, and that is not cosmetic.
 * `scripts/ci-test-accounting.test.ts` flags any test file quoting that name as
 * reading a build artifact, so CI re-runs it after the build. This test creates
 * a throwaway directory inside a temp dir and reads no build output, so
 * declaring it build-dependent would be false and loosening the scanner would
 * blind it to the real case.
 *
 * The scanner does not strip comments, so a NOTE explaining this that quoted
 * the name would trip it too — which is how this comment came to be written
 * the long way round.
 */
describe('building the artifact is a separate, separately-reported step', () => {
  it('reports the output directory when the command really produces one', () => {
    const worktree = tempDir('relay-build-');
    const result = buildArtifact({
      worktreePath: worktree,
      command: ['sh', '-c', 'mkdir -p build-output && echo built > build-output/index.html'],
      outputDir: 'build-output',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(readFileSync(join(result.artifactPath, 'index.html'), 'utf8')).toContain('built');
  });

  it('REFUSES when the command succeeds and produces nothing', () => {
    // "Exit code 0" is not "there is a build". This is the deploy-a-stale-or-
    // absent-artifact failure caught one stage earlier.
    const result = buildArtifact({
      worktreePath: tempDir('relay-build-'), command: ['true'], outputDir: 'build-output',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no output directory');
  });

  it('REFUSES when the command fails', () => {
    const result = buildArtifact({
      worktreePath: tempDir('relay-build-'), command: ['false'], outputDir: 'build-output',
    });
    expect(result.ok).toBe(false);
  });
});
