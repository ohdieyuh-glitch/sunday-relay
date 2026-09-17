/**
 * WONDER WEB IN WONDERLAND — the development-preview surfaces, projected by the real domain.
 *
 * Unreal renders Wonder Web and decides nothing (docs/relay/WONDER_WEB.md: "the surface renders `WonderWebSurface`
 * and computes no authority of its own"). Until a live bridge delivers projections to the game, the in-world surface
 * reads a fixed set of them from `wonderland/UiArt/WonderWeb/wonder-web-preview.json`. THIS SCRIPT IS WHERE THEY COME
 * FROM: a sample creation is walked through the domain's own lifecycle (`createWonderWebCreation` ...
 * `completeWonderWebBuild` ... `stopWonderWebRun`), and every state the preview shows is `projectWonderWebSurface`'s
 * output for that record -- so READY still has exactly one door, peer tabs are still observations, and an observer
 * still gets no terminal input, because the domain says so and Unreal only draws it.
 *
 * NOTHING HERE IS LIVE. The creation's provenance is `simulated`, its producer is the development preview, the peers
 * are sample people, and the file says so in its header; the Unreal surface repeats it on screen.
 *
 * HOW TO REGENERATE. It needs a checkout that carries the Wonder Web domain (main after #273). The file is named so that
 * this repository's vitest never collects it; copy it beside itself as `*.test.ts` in such a checkout and run it with
 * the output path set, e.g.
 *   cp wonderland/Tools/wonder_web/wonder-web-preview.generate.ts wonderland/Tools/wonder_web/wonder-web-preview.generate.test.ts
 *   WONDER_WEB_PREVIEW_OUT=wonderland/UiArt/WonderWeb/wonder-web-preview.json npx vitest run wonderland/Tools/wonder_web/wonder-web-preview.generate.test.ts
 * The test asserts the domain rules the preview leans on before it writes anything.
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  appendWonderWebLogs,
  beginWonderWebBuild,
  beginWonderWebPreparation,
  completeWonderWebBuild,
  createWonderWebCreation,
  projectWonderWebSurface,
  rebuildWonderWebCreation,
  startWonderWebRun,
  stopWonderWebRun,
  type WonderWebCreationDraft,
  type WonderWebFile,
  type WonderWebLogLine,
  type WonderWebPeer,
  type WonderWebSurface,
} from '../../../src/relay/mission/wonder-web';

const AT = '2026-09-17T09:00:00.000Z';
const VIEWER = 'sample-viewer';
const PROJECT = 'sample-wonderland-project';

/** The founder's reference names its peers KAI, JUDITH, TANISH and MAYA; the preview uses them as SAMPLE people. */
const PEERS: readonly WonderWebPeer[] = [
  { userId: 'sample-peer-kai', displayName: 'KAI', connectionState: 'LIVE' },
  { userId: 'sample-peer-judith', displayName: 'JUDITH', connectionState: 'LIVE' },
  { userId: 'sample-peer-tanish', displayName: 'TANISH', connectionState: 'RECONNECTING' },
  { userId: 'sample-peer-maya', displayName: 'MAYA', connectionState: 'LIVE' },
];

const file = (path: string, sizeBytes: number, mediaType: string | null): WonderWebFile => ({
  path,
  sizeBytes,
  sha256: null,
  mediaType,
});

const SOURCES = [
  file('index.html', 1840, 'text/html'),
  file('src/canvas.ts', 3120, 'text/typescript'),
  file('src/palette.ts', 880, 'text/typescript'),
  file('src/styles.css', 1210, 'text/css'),
];
const ARTIFACTS = [
  file('index.html', 1905, 'text/html'),
  file('assets/canvas.js', 5420, 'text/javascript'),
  file('assets/styles.css', 1210, 'text/css'),
];

function must<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(`the domain refused the sample: ${result.error.message}`);
  return result.value;
}

let sequence = 0;
const log = (stream: 'build' | 'runtime', text: string): WonderWebLogLine => ({
  sequence: ++sequence,
  stream,
  text,
  redactionsApplied: 0,
});

function sampleCreation(creationId: string, ownerUserId: string, name: string): WonderWebCreationDraft {
  return must(
    createWonderWebCreation({
      creationId,
      ownerUserId,
      name,
      missionId: null,
      projectId: PROJECT,
      creationType: 'web_app',
      runtimeType: 'static_bundle',
      sourceFiles: SOURCES,
      provenance: 'simulated',
      producer: { systemId: 'wonderland-development-preview', systemVersion: null, attestationId: null },
      createdAtIso: AT,
    }),
  );
}

function surface(creation: WonderWebCreationDraft | null, viewerUserId = VIEWER): WonderWebSurface {
  return projectWonderWebSurface({
    viewerUserId,
    viewerDisplayName: 'YOU',
    peers: PEERS,
    creation,
    projectId: PROJECT,
    observedAtIso: AT,
    unavailableReason: null,
  });
}

/** One creation's life, as the preview plays it: every step is a domain transition, and every frame a projection. */
function buildMyViewSequence() {
  const frames: Record<string, WonderWebSurface> = {};
  frames.idle = surface(null);

  let creation = sampleCreation('sample-pixel-canvas', VIEWER, 'Pixel Canvas');
  frames.created = surface(creation);

  creation = must(beginWonderWebPreparation(creation, AT));
  creation = appendWonderWebLogs(creation, [log('build', '$ wonder prepare'), log('build', 'materializing 4 source files into the build root')], AT);
  frames.preparing = surface(creation);

  creation = must(beginWonderWebBuild(creation, AT));
  const buildSteps = [
    ['$ wonder build', 'env: {} -- the build inherits no credentials'],
    ['compiling src/canvas.ts', 'compiling src/palette.ts'],
    ['bundling assets/canvas.js (5.4 kB)', 'copying assets/styles.css'],
    ['writing index.html', 'build finished: exit 0'],
  ];
  buildSteps.forEach((pair, index) => {
    creation = appendWonderWebLogs(creation, pair.map((text) => log('build', text)), AT);
    frames[`building_${index + 1}`] = surface(creation);
  });

  // THE ONLY DOOR INTO READY: an observed exit 0 and an entrypoint the build actually wrote.
  creation = must(
    completeWonderWebBuild(
      creation,
      { startedAtIso: AT, finishedAtIso: AT, exitCode: 0, artifacts: ARTIFACTS, entrypoint: 'index.html', logs: [] },
      AT,
    ),
  );
  frames.ready = surface(creation);

  creation = must(startWonderWebRun(creation, AT));
  creation = appendWonderWebLogs(
    creation,
    [log('runtime', '$ wonder run'), log('runtime', 'serving index.html from its own origin (simulated in the preview)'), log('runtime', 'Pixel Canvas is running')],
    AT,
  );
  frames.running = surface(creation);

  const stopped = appendWonderWebLogs(must(stopWonderWebRun(creation, AT)), [log('runtime', '$ wonder stop'), log('runtime', 'stopped. the build is still here')], AT);
  frames.stopped = surface(stopped);

  const restarted = appendWonderWebLogs(must(startWonderWebRun(stopped, AT)), [log('runtime', '$ wonder run'), log('runtime', 'Pixel Canvas is running again')], AT);
  frames.restarted = surface(restarted);

  // A BUILD THAT FAILS, for the error state: exit 1 is FAILED with its reason, never READY.
  let broken = must(rebuildWonderWebCreation(stopped, AT));
  broken = must(beginWonderWebBuild(broken, AT));
  broken = appendWonderWebLogs(broken, [log('build', '$ wonder build'), log('build', "src/canvas.ts(42,7): error: 'pallete' is not defined")], AT);
  frames.failing = surface(broken);
  broken = must(
    completeWonderWebBuild(
      broken,
      { startedAtIso: AT, finishedAtIso: AT, exitCode: 1, artifacts: [], entrypoint: null, logs: [log('build', 'build failed: exit 1')] },
      AT,
    ),
  );
  frames.failed = surface(broken);

  return frames;
}

/** What a viewer sees on a peer's tab: that peer's creation, projected for the viewer -- an observation. */
function buildPeerViews() {
  const views: Record<string, WonderWebSurface> = {};
  const states: Record<string, (c: WonderWebCreationDraft) => WonderWebCreationDraft> = {
    'sample-peer-kai': (c) => must(startWonderWebRun(must(completeWonderWebBuild(must(beginWonderWebBuild(must(beginWonderWebPreparation(c, AT)), AT)), { startedAtIso: AT, finishedAtIso: AT, exitCode: 0, artifacts: ARTIFACTS, entrypoint: 'index.html', logs: [] }, AT)), AT)),
    'sample-peer-judith': (c) => must(beginWonderWebBuild(must(beginWonderWebPreparation(c, AT)), AT)),
    'sample-peer-tanish': (c) => must(completeWonderWebBuild(must(beginWonderWebBuild(must(beginWonderWebPreparation(c, AT)), AT)), { startedAtIso: AT, finishedAtIso: AT, exitCode: 0, artifacts: ARTIFACTS, entrypoint: 'index.html', logs: [] }, AT)),
    'sample-peer-maya': (c) => must(completeWonderWebBuild(must(beginWonderWebBuild(must(beginWonderWebPreparation(c, AT)), AT)), { startedAtIso: AT, finishedAtIso: AT, exitCode: 2, artifacts: [], entrypoint: null, logs: [] }, AT)),
  };
  for (const peer of PEERS) {
    const creation = states[peer.userId](sampleCreation(`sample-${peer.displayName.toLowerCase()}-creation`, peer.userId, `${peer.displayName}'s creation`));
    views[peer.userId] = surface(creation);
  }
  return views;
}

export function generateWonderWebPreview() {
  sequence = 0;
  return {
    schema: 'wonderland-wonder-web-preview.v1',
    notice: 'DEVELOPMENT PREVIEW · SAMPLE DATA · SIMULATED CREATION. Every surface below is projectWonderWebSurface output for a simulated creation walked through the Wonder Web lifecycle; no runtime, bridge or peer is connected.',
    domain: 'src/relay/mission/wonder-web (relay-wonder-web.v1)',
    viewerUserId: VIEWER,
    projectId: PROJECT,
    myView: buildMyViewSequence(),
    peerViews: buildPeerViews(),
  };
}

describe('wonder web preview surfaces', () => {
  it('are domain projections that keep the domain rules', () => {
    const preview = generateWonderWebPreview();
    expect(preview.myView.idle.viewport.kind).toBe('idle');
    expect(preview.myView.running.viewport).toMatchObject({ kind: 'creation', running: true });
    expect(preview.myView.failed.viewport.kind).toBe('failed');
    for (const view of Object.values(preview.peerViews)) {
      expect(view.viewport.kind).toBe('observed');
      expect(view.terminal.acceptsInput).toBe(false);
      expect(view.terminal.lines).toHaveLength(0);
      expect(view.tabs.slice(1).every((tab) => tab.access === 'observe')).toBe(true);
    }
    const out = process.env.WONDER_WEB_PREVIEW_OUT;
    if (out) writeFileSync(out, `${JSON.stringify(preview, null, 2)}\n`, 'utf8');
  });
});
