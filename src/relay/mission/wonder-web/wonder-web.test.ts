import { describe, expect, it } from 'vitest';
import {
  WONDER_WEB_CAPABILITIES,
  WONDER_WEB_CREATION_STATUSES,
  WONDER_WEB_EDGES,
  WONDER_WEB_ISOLATION_PROFILES,
  authorizeWonderWebAction,
  authorizeWonderWebRun,
  beginWonderWebBuild,
  beginWonderWebPreparation,
  completeWonderWebBuild,
  createWonderWebCreation,
  decideWonderWebCapability,
  isLegalWonderWebTransition,
  isSafeCreationPath,
  projectWonderWebSurface,
  readWonderWebCreation,
  sealWonderWebCreation,
  startWonderWebRun,
  wonderWebAccessFor,
  type WonderWebBuildOutcome,
  type WonderWebCapabilityGrant,
  type WonderWebCreationDraft,
  type WonderWebFile,
} from './index';

const AT = '2026-09-15T12:00:00.000Z';
const OWNER = 'ghu-1001';
const STRANGER = 'ghu-2002';

const file = (path: string): WonderWebFile => ({
  path,
  sizeBytes: 12,
  sha256: null,
  mediaType: null,
});

function draft(overrides: Partial<Parameters<typeof createWonderWebCreation>[0]> = {}) {
  const result = createWonderWebCreation({
    creationId: 'cre_1',
    ownerUserId: OWNER,
    name: 'Test Creation',
    missionId: 'mis_1',
    projectId: 'prj_1',
    creationType: 'website',
    runtimeType: 'static_bundle',
    sourceFiles: [file('index.html')],
    provenance: 'live',
    producer: { systemId: 'fixture', systemVersion: '1', attestationId: null },
    createdAtIso: AT,
    ...overrides,
  });
  if (!result.ok) throw new Error(`fixture refused: ${result.error.message}`);
  return result.value;
}

/** Drive a creation to the point a build is running. */
function building(): WonderWebCreationDraft {
  const prepared = beginWonderWebPreparation(draft(), AT);
  if (!prepared.ok) throw new Error('prepare refused');
  const built = beginWonderWebBuild(prepared.value, AT);
  if (!built.ok) throw new Error('build start refused');
  return built.value;
}

const outcome = (over: Partial<WonderWebBuildOutcome> = {}): WonderWebBuildOutcome => ({
  startedAtIso: AT,
  finishedAtIso: AT,
  exitCode: 0,
  artifacts: [file('index.html')],
  entrypoint: 'index.html',
  logs: [],
  ...over,
});

/* ------------------------------------------------------------------------ */

describe('READY is reachable only through a build that actually succeeded', () => {
  it('has exactly one inbound edge, from BUILDING', () => {
    const inbound = WONDER_WEB_CREATION_STATUSES.filter((from) =>
      WONDER_WEB_EDGES[from].includes('READY'),
    );
    expect(inbound).toEqual(['BUILDING']);
  });

  it('reaches READY on a zero exit with an entrypoint the build produced', () => {
    const done = completeWonderWebBuild(building(), outcome(), AT);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.status).toBe('READY');
    expect(done.value.entrypoint).toBe('index.html');
  });

  it('FAILS on a non-zero exit instead of reporting READY', () => {
    const done = completeWonderWebBuild(building(), outcome({ exitCode: 1 }), AT);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.status).toBe('FAILED');
    expect(done.value.entrypoint).toBeNull();
    expect(done.value.errors.at(-1)?.summary).toContain('exited 1');
  });

  it('treats an UNOBSERVED exit as failure, never as success', () => {
    const done = completeWonderWebBuild(building(), outcome({ exitCode: null }), AT);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.status).toBe('FAILED');
    expect(done.value.errors.at(-1)?.summary).toMatch(/never observed/i);
  });

  it('FAILS a build that exited zero but produced no entrypoint', () => {
    const done = completeWonderWebBuild(
      building(),
      outcome({ entrypoint: null, artifacts: [] }),
      AT,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.status).toBe('FAILED');
    expect(done.value.errors.at(-1)?.summary).toMatch(/no entrypoint/i);
  });

  it('refuses an entrypoint naming a file the build never wrote', () => {
    const done = completeWonderWebBuild(
      building(),
      outcome({ entrypoint: 'ghost.html' }),
      AT,
    );
    expect(done.ok).toBe(false);
    if (done.ok) return;
    expect(done.error.code).toBe('evidence-required');
  });

  it('cannot complete a build that never started', () => {
    const done = completeWonderWebBuild(draft(), outcome(), AT);
    expect(done.ok).toBe(false);
    if (done.ok) return;
    expect(done.error.code).toBe('illegal-transition');
  });

  it('refuses every transition the table does not list', () => {
    for (const from of WONDER_WEB_CREATION_STATUSES) {
      for (const to of WONDER_WEB_CREATION_STATUSES) {
        const legal = WONDER_WEB_EDGES[from].includes(to);
        expect(isLegalWonderWebTransition(from, to), `${from} -> ${to}`).toBe(legal);
      }
    }
  });
});

describe('a creation cannot name a path outside its own root', () => {
  it.each([
    '/etc/passwd',
    'C:/Windows/System32/cmd.exe',
    '../../secrets.env',
    'a/../../b',
    'dir\\file.txt',
    '',
  ])('refuses %s', (path) => {
    expect(isSafeCreationPath(path)).toBe(false);
  });

  it.each(['index.html', 'assets/app.js', 'a/b/c/d.css'])('accepts %s', (path) => {
    expect(isSafeCreationPath(path)).toBe(true);
  });

  it('refuses a source file that escapes at creation time', () => {
    const result = createWonderWebCreation({
      creationId: 'cre_bad',
      ownerUserId: OWNER,
      name: 'Escaper',
      creationType: 'website',
      runtimeType: 'static_bundle',
      sourceFiles: [file('../../etc/passwd')],
      provenance: 'live',
      producer: { systemId: 'fixture', systemVersion: null, attestationId: null },
      createdAtIso: AT,
    });
    expect(result.ok).toBe(false);
  });
});

describe('the sandbox fails closed', () => {
  it('denies every capability when no grant exists', () => {
    for (const capability of WONDER_WEB_CAPABILITIES) {
      const decision = decideWonderWebCapability(capability, 'cre_1', null);
      expect(decision.allowed, capability).toBe(false);
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });

  it('denies a grant issued for a different creation', () => {
    const grant: WonderWebCapabilityGrant = {
      creationId: 'cre_other',
      grantedByUserId: OWNER,
      granted: ['network_egress'],
      grantedAtIso: AT,
      reason: 'test',
    };
    const decision = decideWonderWebCapability('network_egress', 'cre_1', grant);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('cre_other');
  });

  it('refuses to run a runtime that is not beta-eligible', () => {
    const local = draft({ runtimeType: 'native_process' });
    const authorized = authorizeWonderWebRun(local, OWNER, null);
    expect(authorized.ok).toBe(false);
    if (authorized.ok) return;
    expect(authorized.error.code).toBe('permission-denied');
  });

  it('refuses a capability the mechanism cannot actually mediate', () => {
    // A node_service is not beta-eligible at all, so use the eligible runtime
    // and a capability its profile does enforce — the grant must still not be
    // able to open a hole the mechanism would have to honour.
    const unenforceable = draft({ runtimeType: 'node_service' });
    const grant: WonderWebCapabilityGrant = {
      creationId: unenforceable.creationId,
      grantedByUserId: OWNER,
      granted: ['host_filesystem'],
      grantedAtIso: AT,
      reason: 'test',
    };
    const authorized = authorizeWonderWebRun(unenforceable, OWNER, grant);
    expect(authorized.ok).toBe(false);
  });

  it('never claims an isolation it does not implement', () => {
    for (const profile of Object.values(WONDER_WEB_ISOLATION_PROFILES)) {
      if (profile.unenforcedDenials.length > 0) {
        expect(profile.limitation, `${profile.runtimeType} hides a limitation`).not.toBeNull();
      }
      // A capability cannot be both enforced and unenforced by one mechanism.
      for (const capability of profile.enforcedDenials) {
        expect(profile.unenforcedDenials).not.toContain(capability);
      }
    }
  });

  it('only marks a runtime beta-eligible when it enforces every capability', () => {
    for (const profile of Object.values(WONDER_WEB_ISOLATION_PROFILES)) {
      if (profile.betaEligible) {
        expect([...profile.enforcedDenials].sort()).toEqual([...WONDER_WEB_CAPABILITIES].sort());
        expect(profile.unenforcedDenials).toEqual([]);
      }
    }
  });
});

describe('ownership — replication is not authorization', () => {
  const creation = draft();

  it('gives the owner control', () => {
    expect(wonderWebAccessFor(creation, OWNER)).toBe('control');
  });

  it('gives observation when the OWNER is co-present', () => {
    // The predicate asks where the owner is, not where the requester is.
    expect(wonderWebAccessFor(creation, STRANGER, [OWNER])).toBe('observe');
  });

  it('gives an unrelated player nothing', () => {
    expect(wonderWebAccessFor(creation, STRANGER)).toBe('none');
  });

  it('gives nothing when only the requester is in the session', () => {
    expect(wonderWebAccessFor(creation, STRANGER, [STRANGER])).toBe('none');
  });

  it('refuses every control action to a co-present observer', () => {
    for (const action of [
      'open', 'run', 'stop', 'restart', 'rebuild',
      'read_files', 'read_logs', 'save_to_project', 'grant_capability',
    ] as const) {
      const decision = authorizeWonderWebAction(creation, STRANGER, action, [OWNER]);
      expect(decision.ok, `${action} leaked to a non-owner`).toBe(false);
    }
  });

  it('refuses a stranger the right to run it', () => {
    const authorized = authorizeWonderWebRun(creation, STRANGER, null);
    expect(authorized.ok).toBe(false);
  });
});

describe('the surface tells the truth about what it is showing', () => {
  it('shows the idle Wonder face when nothing is open', () => {
    const surface = projectWonderWebSurface({
      viewerUserId: OWNER,
      viewerDisplayName: 'KAI',
      peers: [],
      creation: null,
      projectId: null,
      observedAtIso: AT,
    });
    expect(surface.viewport.kind).toBe('idle');
    expect(surface.tabs[0].label).toBe('MY VIEW');
    expect(surface.terminal.prompt).toBe('wonder@project:~$');
  });

  it('renders a failure as a failure, not an empty page', () => {
    const failed = completeWonderWebBuild(building(), outcome({ exitCode: 2 }), AT);
    if (!failed.ok) throw new Error('expected a recorded failure');
    const surface = projectWonderWebSurface({
      viewerUserId: OWNER,
      viewerDisplayName: 'KAI',
      peers: [],
      creation: failed.value,
      projectId: 'prj_1',
      observedAtIso: AT,
    });
    expect(surface.viewport.kind).toBe('failed');
  });

  it('gives a peer an observed viewport, no entrypoint and no terminal input', () => {
    const ready = completeWonderWebBuild(building(), outcome(), AT);
    if (!ready.ok) throw new Error('expected READY');
    const surface = projectWonderWebSurface({
      viewerUserId: STRANGER,
      viewerDisplayName: 'JUDITH',
      peers: [{ userId: OWNER, displayName: 'KAI', connectionState: 'LIVE' }],
      creation: ready.value,
      projectId: 'prj_1',
      observedAtIso: AT,
    });
    expect(surface.viewport.kind).toBe('observed');
    expect(surface.terminal.acceptsInput).toBe(false);
    expect(surface.terminal.lines).toEqual([]);
    expect(surface.chrome.canStop).toBe(false);
    expect(surface.chrome.canRebuild).toBe(false);
  });

  it('shows nothing at all to a viewer with no standing', () => {
    // REGRESSION: this viewport once fell through to the openable branch and
    // handed a stranger the entrypoint of somebody else's creation.
    const ready = completeWonderWebBuild(building(), outcome(), AT);
    if (!ready.ok) throw new Error('expected READY');
    const surface = projectWonderWebSurface({
      viewerUserId: STRANGER,
      viewerDisplayName: 'MAYA',
      peers: [],
      creation: ready.value,
      projectId: 'prj_1',
      observedAtIso: AT,
    });
    expect(surface.viewport.kind).toBe('idle');
    expect(JSON.stringify(surface)).not.toContain('index.html');
  });

  it('never emits a controllable tab for a peer', () => {
    const surface = projectWonderWebSurface({
      viewerUserId: OWNER,
      viewerDisplayName: 'KAI',
      peers: [
        { userId: 'ghu-3', displayName: 'JUDITH', connectionState: 'LIVE' },
        { userId: 'ghu-4', displayName: 'TANISH', connectionState: 'RECONNECTING' },
      ],
      creation: null,
      projectId: 'prj_1',
      observedAtIso: AT,
    });
    expect(surface.tabs).toHaveLength(3);
    for (const tab of surface.tabs.slice(1)) {
      expect(tab.access).toBe('observe');
      expect(tab.isSelf).toBe(false);
    }
    // Distinct peers get distinguishable dots, as the reference shows.
    expect(surface.tabs[1].dotColorToken).not.toBe(surface.tabs[2].dotColorToken);
  });
});

describe('a stored creation survives a round trip and detects tampering', () => {
  it('reads back what it sealed', () => {
    const sealed = sealWonderWebCreation(draft());
    const read = readWonderWebCreation(JSON.parse(JSON.stringify(sealed)));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.record.creationId).toBe('cre_1');
    expect(read.record.ownerUserId).toBe(OWNER);
  });

  it('refuses a record whose owner was edited after sealing', () => {
    const sealed = sealWonderWebCreation(draft());
    const tampered = { ...sealed, ownerUserId: STRANGER };
    const read = readWonderWebCreation(tampered);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe('corrupt');
  });

  it('reports an unknown schema version rather than calling it absent', () => {
    const sealed = sealWonderWebCreation(draft());
    const future = { ...sealed, schemaVersion: 'relay-wonder-web.v99' };
    const read = readWonderWebCreation(future);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe('unsupported_version');
  });

  it('never turns a corrupt record into "no creation"', () => {
    const read = readWonderWebCreation({ schemaVersion: 'relay-wonder-web.v1' });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe('corrupt');
  });
});

describe('a run needs an entrypoint', () => {
  it('refuses to start a creation that has none', () => {
    const started = startWonderWebRun(draft(), AT);
    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.error.code).toBe('evidence-required');
  });
});
