import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWonderWebCreation,
  type WonderWebCapabilityGrant,
  type WonderWebFile,
} from '../../src/relay/mission/wonder-web';
import {
  WONDER_WEB_BIND_HOST,
  WONDER_WEB_CONTENT_SECURITY_POLICY,
  buildWonderWebCreation,
  closeWonderWebCreation,
  materializeWonderWebSources,
  openWonderWebCreation,
  resolveWithinRoot,
  resolveWonderWebPaths,
  wonderWebMediaType,
  type WonderWebRunHandle,
} from './index';

/**
 * The end-to-end proof for the creation pipeline: a creation is materialized,
 * built, opened in its own origin, and served behind the content policy the
 * isolation profile claims. The security assertions here are what make that
 * claim true rather than described.
 */

const OWNER = 'ghu-1001';
const STRANGER = 'ghu-2002';
let clock = 0;
const now = () => new Date(Date.UTC(2026, 8, 15, 12, 0, clock++)).toISOString();

const temps: string[] = [];
const handles: WonderWebRunHandle[] = [];

async function tempBase(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wonder-web-'));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.server.close().catch(() => {});
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true }).catch(() => {});
});

const file = (path: string): WonderWebFile => ({
  path,
  sizeBytes: 1,
  sha256: null,
  mediaType: null,
});

function newCreation(id: string, sources: readonly WonderWebFile[]) {
  const result = createWonderWebCreation({
    creationId: id,
    ownerUserId: OWNER,
    name: 'Fixture Creation',
    missionId: 'mis_1',
    projectId: 'prj_1',
    creationType: 'website',
    runtimeType: 'static_bundle',
    sourceFiles: sources,
    provenance: 'live',
    producer: { systemId: 'fixture', systemVersion: '1', attestationId: null },
    createdAtIso: now(),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** A static bundle whose build step is "the sources are already the artifacts". */
async function stage(base: string, id: string, body: string) {
  const paths = resolveWonderWebPaths(base, id);
  if (paths === null) throw new Error('paths refused');
  await mkdir(paths.artifactRoot, { recursive: true });
  await writeFile(join(paths.artifactRoot, 'index.html'), body);
  return paths;
}

/* ------------------------------------------------------------------------ */

describe('path containment', () => {
  it.each([
    '/../../etc/passwd',
    '/..%2f..%2fetc%2fpasswd',
    '/sub/../../outside.txt',
    '/a\\..\\..\\b',
  ])('refuses %s', (path) => {
    expect(resolveWithinRoot('/srv/creation', path)).toBeNull();
  });

  it('does not treat a sibling directory with a shared prefix as inside', () => {
    expect(resolveWithinRoot('/srv/root', '/../root-evil/x')).toBeNull();
  });

  it('accepts an ordinary nested asset', () => {
    expect(resolveWithinRoot('/srv/root', '/assets/app.js')).not.toBeNull();
  });

  it('refuses a creation id that could escape the root', () => {
    expect(resolveWonderWebPaths('/base', '../evil')).toBeNull();
    expect(resolveWonderWebPaths('/base', 'a/b')).toBeNull();
    expect(resolveWonderWebPaths('/base', 'cre_1')).not.toBeNull();
  });
});

describe('media types are never guessed into something executable', () => {
  it('serves an unknown extension as an opaque stream', () => {
    expect(wonderWebMediaType('weird.thing')).toBe('application/octet-stream');
    expect(wonderWebMediaType('noextension')).toBe('application/octet-stream');
  });

  it('types the ordinary web files', () => {
    expect(wonderWebMediaType('a/index.html')).toContain('text/html');
    expect(wonderWebMediaType('a/app.js')).toContain('text/javascript');
  });
});

describe('a creation builds, opens, and serves behind the boundary', () => {
  it('reaches READY and serves its entrypoint', async () => {
    const base = await tempBase();
    const paths = await stage(base, 'cre_ok', '<!doctype html><title>Hi</title><h1>MADE</h1>');
    const creation = newCreation('cre_ok', [file('index.html')]);

    const built = await buildWonderWebCreation(
      creation,
      paths,
      { executable: null, args: [], entrypoint: 'index.html', expectedArtifacts: [file('index.html')] },
      now,
    );
    expect(built.status).toBe('READY');
    expect(built.entrypoint).toBe('index.html');

    const opened = await openWonderWebCreation(built, paths, OWNER, null, now);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    handles.push(opened.handle);

    expect(opened.handle.creation.status).toBe('RUNNING');
    expect(opened.handle.server.origin).toContain(WONDER_WEB_BIND_HOST);

    const response = await fetch(opened.handle.server.entrypointUrl);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('MADE');
  });

  it('serves the content policy that carries the egress claim', async () => {
    const base = await tempBase();
    const paths = await stage(base, 'cre_csp', '<!doctype html><title>x</title>');
    const creation = newCreation('cre_csp', [file('index.html')]);
    const built = await buildWonderWebCreation(
      creation, paths,
      { executable: null, args: [], entrypoint: 'index.html', expectedArtifacts: [file('index.html')] },
      now,
    );
    const opened = await openWonderWebCreation(built, paths, OWNER, null, now);
    if (!opened.ok) throw new Error(opened.reason);
    handles.push(opened.handle);

    const response = await fetch(opened.handle.server.entrypointUrl);
    const csp = response.headers.get('content-security-policy') ?? '';

    // These two are the whole egress boundary.
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toBe(WONDER_WEB_CONTENT_SECURITY_POLICY);

    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('permissions-policy')).toContain('camera=()');
    // A creation is never handed a cookie.
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('gives each running creation its own origin, so storage cannot be shared', async () => {
    const base = await tempBase();
    const first = await stage(base, 'cre_a', '<!doctype html><title>a</title>');
    const second = await stage(base, 'cre_b', '<!doctype html><title>b</title>');
    const plan = { executable: null, args: [], entrypoint: 'index.html', expectedArtifacts: [file('index.html')] };

    const builtA = await buildWonderWebCreation(newCreation('cre_a', [file('index.html')]), first, plan, now);
    const builtB = await buildWonderWebCreation(newCreation('cre_b', [file('index.html')]), second, plan, now);
    const a = await openWonderWebCreation(builtA, first, OWNER, null, now);
    const b = await openWonderWebCreation(builtB, second, OWNER, null, now);
    if (!a.ok || !b.ok) throw new Error('expected both to open');
    handles.push(a.handle, b.handle);

    expect(a.handle.server.port).not.toBe(b.handle.server.port);
    expect(a.handle.server.origin).not.toBe(b.handle.server.origin);
  });

  it('refuses traversal, unknown paths and non-reads over HTTP', async () => {
    const base = await tempBase();
    const paths = await stage(base, 'cre_http', '<!doctype html><title>x</title>');
    // A file that exists OUTSIDE the artifact root, to prove traversal fails.
    await writeFile(join(base, 'secret.txt'), 'TOP SECRET');

    const built = await buildWonderWebCreation(
      newCreation('cre_http', [file('index.html')]), paths,
      { executable: null, args: [], entrypoint: 'index.html', expectedArtifacts: [file('index.html')] },
      now,
    );
    const opened = await openWonderWebCreation(built, paths, OWNER, null, now);
    if (!opened.ok) throw new Error(opened.reason);
    handles.push(opened.handle);
    const origin = opened.handle.server.origin;

    const traversal = await fetch(`${origin}/../../secret.txt`, { redirect: 'manual' });
    expect(traversal.status).not.toBe(200);
    expect(await traversal.text()).not.toContain('TOP SECRET');

    const encoded = await fetch(`${origin}/..%2f..%2fsecret.txt`, { redirect: 'manual' });
    expect(encoded.status).not.toBe(200);
    expect(await encoded.text()).not.toContain('TOP SECRET');

    expect((await fetch(`${origin}/nope.html`)).status).toBe(404);
    expect((await fetch(origin, { method: 'POST' })).status).toBe(405);
  });
});

describe('the runtime cannot mint a READY the build did not earn', () => {
  it('FAILS when the declared entrypoint is not on disk', async () => {
    const base = await tempBase();
    const paths = resolveWonderWebPaths(base, 'cre_missing');
    if (paths === null) throw new Error('paths refused');
    await mkdir(paths.artifactRoot, { recursive: true });
    // Nothing is written — the build "succeeds" with no entrypoint produced.

    const built = await buildWonderWebCreation(
      newCreation('cre_missing', [file('index.html')]), paths,
      { executable: null, args: [], entrypoint: 'index.html', expectedArtifacts: [file('index.html')] },
      now,
    );
    expect(built.status).toBe('FAILED');
    expect(built.entrypoint).toBeNull();
    expect(built.errors.at(-1)?.summary).toMatch(/not on disk|no entrypoint/i);
  });

  it('FAILS when the build command exits non-zero', async () => {
    const base = await tempBase();
    const paths = resolveWonderWebPaths(base, 'cre_badbuild');
    if (paths === null) throw new Error('paths refused');
    await mkdir(paths.sourceRoot, { recursive: true });

    const built = await buildWonderWebCreation(
      newCreation('cre_badbuild', [file('index.html')]), paths,
      {
        executable: process.execPath,
        args: ['-e', 'process.exit(3)'],
        entrypoint: 'index.html',
        expectedArtifacts: [file('index.html')],
      },
      now,
    );
    expect(built.status).toBe('FAILED');
    expect(built.entrypoint).toBeNull();
  });

  it('refuses to open a creation for an account that does not own it', async () => {
    const base = await tempBase();
    const paths = await stage(base, 'cre_owned', '<!doctype html><title>x</title>');
    const built = await buildWonderWebCreation(
      newCreation('cre_owned', [file('index.html')]), paths,
      { executable: null, args: [], entrypoint: 'index.html', expectedArtifacts: [file('index.html')] },
      now,
    );
    const opened = await openWonderWebCreation(built, paths, STRANGER, null, now);
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.reason).toMatch(/owns it/i);
  });

  it('refuses to open a runtime the beta does not isolate', async () => {
    const base = await tempBase();
    const paths = await stage(base, 'cre_native', '<!doctype html><title>x</title>');
    const built = await buildWonderWebCreation(
      { ...newCreation('cre_native', [file('index.html')]), runtimeType: 'native_process' },
      paths,
      { executable: null, args: [], entrypoint: 'index.html', expectedArtifacts: [file('index.html')] },
      now,
    );
    const opened = await openWonderWebCreation(built, paths, OWNER, null, now);
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.reason).toMatch(/isolat|refus/i);
  });

  it('refuses a grant the mechanism cannot mediate', async () => {
    const base = await tempBase();
    const paths = await stage(base, 'cre_grant', '<!doctype html><title>x</title>');
    const built = await buildWonderWebCreation(
      { ...newCreation('cre_grant', [file('index.html')]), runtimeType: 'node_service' },
      paths,
      { executable: null, args: [], entrypoint: 'index.html', expectedArtifacts: [file('index.html')] },
      now,
    );
    const grant: WonderWebCapabilityGrant = {
      creationId: 'cre_grant',
      grantedByUserId: OWNER,
      granted: ['host_filesystem'],
      grantedAtIso: now(),
      reason: 'test',
    };
    const opened = await openWonderWebCreation(built, paths, OWNER, grant, now);
    expect(opened.ok).toBe(false);
  });
});

describe('sources are written only inside the creation root', () => {
  it('refuses a source path that escapes', async () => {
    const base = await tempBase();
    const paths = resolveWonderWebPaths(base, 'cre_src');
    if (paths === null) throw new Error('paths refused');
    const result = await materializeWonderWebSources(
      paths,
      [file('../../escaped.txt')],
      () => 'x',
    );
    expect(result.ok).toBe(false);
  });

  it('writes nested sources faithfully', async () => {
    const base = await tempBase();
    const paths = resolveWonderWebPaths(base, 'cre_src2');
    if (paths === null) throw new Error('paths refused');
    const result = await materializeWonderWebSources(
      paths,
      [file('index.html'), file('assets/app.js')],
      (f) => `content of ${f.path}`,
    );
    expect(result.ok).toBe(true);
  });
});

describe('stopping a creation closes its port', () => {
  it('stops serving once stopped', async () => {
    const base = await tempBase();
    const paths = await stage(base, 'cre_stop', '<!doctype html><title>x</title>');
    const built = await buildWonderWebCreation(
      newCreation('cre_stop', [file('index.html')]), paths,
      { executable: null, args: [], entrypoint: 'index.html', expectedArtifacts: [file('index.html')] },
      now,
    );
    const opened = await openWonderWebCreation(built, paths, OWNER, null, now);
    if (!opened.ok) throw new Error(opened.reason);
    const url = opened.handle.server.entrypointUrl;

    expect((await fetch(url)).status).toBe(200);

    const stopped = await closeWonderWebCreation(opened.handle, now);
    expect(stopped.status).toBe('STOPPED');
    // A stop is announced only once the socket is actually gone.
    await expect(fetch(url)).rejects.toThrow();
  });
});
