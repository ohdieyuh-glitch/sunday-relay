import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { juliusPrincipal, juliusWorkerPrincipal } from '../../mission/julius/julius-brain-contracts';
import { juliusBrainSchemaDocument } from '../../mission/julius/julius-brain-schema-document';
import { createJuliusProjectBrainService } from '../../mission/julius/julius-brain-service';
import { createJuliusBrainMemoryStore } from '../../mission/julius/julius-brain-store';
import { JULIUS_PYTHON_DEFAULT_LIMITS, JULIUS_PYTHON_REQUEST_FORMAT } from '../../mission/julius/julius-python-contracts';
import { createJuliusPythonExecutionMemoryStore, createJuliusPythonExecutionService } from '../../mission/julius/julius-python-service';
import { cardPolicy } from '../../mission/julius/julius-runtime-fixtures';
import { LocalJuliusBrainContentStore } from '../../persistence/julius-brain-content-store';
import { MaterializedJuliusPythonEnvironmentRegistry, materializeJuliusPythonEnvironment, type JuliusPythonEnvironmentSpec } from './python-environments';
import { NodeJuliusPythonRunner, discoverJuliusPythonExecutable, resolveJuliusPythonSdkRoot } from './python-runner';

/**
 * PINNED, OFFLINE, ISOLATED PYTHON ENVIRONMENTS — with a real virtual
 * environment, a real wheel built on the spot, and a real execution that
 * imports it. Reports todo without a CPython 3.11+.
 */
const python = discoverJuliusPythonExecutable();
const sdkRoot = resolveJuliusPythonSdkRoot();
const suite = python !== null && sdkRoot !== null ? describe : describe.todo;

/** A minimal, valid pure-Python wheel, built with the standard library only. */
const BUILD_WHEEL = [
  'import base64, hashlib, sys, zipfile',
  'out, version = sys.argv[1], sys.argv[2]',
  'files = {',
  '  "juliusdemo/__init__.py": "VALUE = 42\\nVERSION = %r\\n" % version,',
  '  "juliusdemo-%s.dist-info/METADATA" % version: "Metadata-Version: 2.1\\nName: juliusdemo\\nVersion: %s\\n" % version,',
  '  "juliusdemo-%s.dist-info/WHEEL" % version: "Wheel-Version: 1.0\\nGenerator: julius-test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n",',
  '}',
  'record = "juliusdemo-%s.dist-info/RECORD" % version',
  'lines = []',
  'path = "%s/juliusdemo-%s-py3-none-any.whl" % (out, version)',
  'with zipfile.ZipFile(path, "w") as wheel:',
  '    for name, text in files.items():',
  '        data = text.encode()',
  '        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()',
  '        lines.append("%s,sha256=%s,%d" % (name, digest, len(data)))',
  '        wheel.writestr(name, data)',
  '    lines.append("%s,," % record)',
  '    wheel.writestr(record, "\\n".join(lines) + "\\n")',
].join('\n');

suite('explicit Python environments', () => {
  let wheelhouse = '';
  let root = '';
  beforeAll(() => {
    wheelhouse = mkdtempSync(join(tmpdir(), 'jpy-wheels-'));
    root = mkdtempSync(join(tmpdir(), 'jpy-envs-'));
    const built = spawnSync(python!, ['-c', BUILD_WHEEL, wheelhouse, '1.0.0'], { encoding: 'utf8', windowsHide: true });
    if (built.status !== 0) throw new Error(built.stderr);
  });

  const spec = (overrides: Partial<JuliusPythonEnvironmentSpec> = {}): JuliusPythonEnvironmentSpec => ({
    environmentId: 'demo-env', baseExecutable: python!, requirements: [{ name: 'juliusdemo', version: '1.0.0' }], wheelhouse, ...overrides,
  });

  it('materialises pinned wheels offline into its own venv, locks it, reuses it, and never touches the base interpreter', async () => {
    const first = await materializeJuliusPythonEnvironment(spec(), { root });
    if (first.outcome !== 'READY') throw new Error(`${first.reasonCode}: ${first.detail}`);
    expect(first.created).toBe(true);
    expect(first.environment.distributions).toContainEqual({ name: 'juliusdemo', version: '1.0.0' });
    expect(first.environment.executable.startsWith(root)).toBe(true);
    expect(first.lock).toMatchObject({ format: 'julius-python-environment-lock.v1', environmentHash: first.environment.environmentHash, requirements: [{ name: 'juliusdemo', version: '1.0.0' }] });
    const base = spawnSync(python!, ['-s', '-c', 'import juliusdemo'], { encoding: 'utf8', windowsHide: true });
    expect(base.status, 'the base interpreter must not have gained the package').not.toBe(0);
    const again = await materializeJuliusPythonEnvironment(spec(), { root });
    expect(again).toMatchObject({ outcome: 'READY', created: false, directory: first.directory });
  }, 300_000);

  it('refuses what it cannot build exactly: an absent version, or pins with no wheelhouse', async () => {
    expect(await materializeJuliusPythonEnvironment(spec({ environmentId: 'missing', requirements: [{ name: 'juliusdemo', version: '9.9.9' }] }), { root })).toMatchObject({ outcome: 'REFUSED', reasonCode: 'DEPENDENCY_INSTALL_FAILED' });
    expect(await materializeJuliusPythonEnvironment(spec({ environmentId: 'no-wheels', wheelhouse: null }), { root })).toMatchObject({ outcome: 'REFUSED', reasonCode: 'WHEELHOUSE_REQUIRED' });
  }, 300_000);

  it('an execution in the pinned environment imports the dependency and records exactly what it used', async () => {
    const clock = { now: () => new Date().toISOString() };
    const brains = createJuliusBrainMemoryStore();
    const brainService = createJuliusProjectBrainService({ store: brains, clock });
    await brainService.initialize({ brainId: 'brain:env', projectId: 'prj-env', title: 'env', principal: juliusPrincipal('JULIUS', 'julius') });
    const content = new LocalJuliusBrainContentStore(mkdtempSync(join(tmpdir(), 'jpy-env-cas-')));
    const environments = new MaterializedJuliusPythonEnvironmentRegistry(new Map([['demo-env', spec()]]), root);
    const service = createJuliusPythonExecutionService({
      store: createJuliusPythonExecutionMemoryStore(brains), brains,
      runner: new NodeJuliusPythonRunner({ sandboxRoot: mkdtempSync(join(tmpdir(), 'jpy-env-sbx-')), sdkRoot: sdkRoot!, content }),
      environments, secrets: { has: () => false, resolve: async () => null },
      policies: { cardFor: async () => cardPolicy({ capabilities: ['python', 'process'], network: false }) },
      schema: juliusBrainSchemaDocument(), clock, hostInstanceId: 'host-env',
    });
    const record = await service.execute({
      format: JULIUS_PYTHON_REQUEST_FORMAT, executionId: 'exec-env', idempotencyKey: 'exec-env', brainId: 'brain:env', projectId: 'prj-env',
      missionId: 'mission:env', runId: null, taskId: 'task-env', requestedBy: juliusWorkerPrincipal('coder', 'CODING_AGENT'), purpose: 'use the pinned dependency',
      script: { kind: 'INLINE', source: 'import juliusdemo\nfrom julius import result\nresult.set({"value": juliusdemo.VALUE, "version": juliusdemo.VERSION})\n' },
      argv: [], inputs: {}, files: [], brainRead: { kinds: [], taskScoped: false, includeHistory: false }, brainWrite: { kinds: ['TRACE'], maxRecords: 1 },
      environment: { environmentId: 'demo-env', requirements: [{ name: 'juliusdemo', version: '1.0.0' }] }, network: { mode: 'DENY' }, secrets: [],
      limits: { ...JULIUS_PYTHON_DEFAULT_LIMITS, timeoutMs: 60_000 }, requestedAt: clock.now(),
    });
    expect(record.outcome?.stderr?.text).toBe('');
    expect(record.state).toBe('SUCCEEDED');
    expect(record.outcome!.structured.value).toEqual({ value: 42, version: '1.0.0' });
    expect(record.outcome!.usage!.dependencies).toEqual([{ name: 'juliusdemo', version: '1.0.0' }]);
    const handle = (await brainService.open({ brainId: 'brain:env', projectId: 'prj-env', principal: juliusPrincipal('JULIUS', 'julius') }))!;
    const [execution] = await handle.current('PYTHON_EXECUTION');
    expect(execution!.body).toMatchObject({ requirements: [{ name: 'juliusdemo', version: '1.0.0' }], dependencies: [{ name: 'juliusdemo', version: '1.0.0' }], environmentHash: (await environments.resolve('demo-env'))!.environmentHash });
  }, 300_000);
});
