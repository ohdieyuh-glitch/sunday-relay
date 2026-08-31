import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteExecutorControlPlane, assertProductionExecutorIsolation } from './remote-executor-control-plane';
import { DockerJuliusSandboxAdapter } from './docker-sandbox-adapter';

afterEach(() => vi.unstubAllGlobals());
describe('remote executor production boundary', () => {
  it('fails closed when the independent control plane is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const remote = new RemoteExecutorControlPlane({ endpoint: new URL('https://executor.internal'), serviceCredential: 'scoped', callerId:'julius-prod', tenantId:'tenant', requestTimeoutMs: 50 });
    await expect(remote.discoverSandboxes()).rejects.toThrow('EXECUTOR_UNAVAILABLE');
  });

  it('refuses the direct Docker adapter in production', () => {
    const direct = new DockerJuliusSandboxAdapter({ image: `sha256:${'a'.repeat(64)}`, enabled: false, unsafeDevelopmentMode: true });
    expect(() => assertProductionExecutorIsolation({ nodeEnv: 'production', adapter: direct })).toThrow('production_direct_docker_executor_refused');
    const remote = new RemoteExecutorControlPlane({ endpoint: new URL('https://executor.internal'), serviceCredential: 'scoped', callerId:'julius-prod', tenantId:'tenant', requestTimeoutMs: 50 });
    expect(() => assertProductionExecutorIsolation({ nodeEnv: 'production', adapter: remote })).not.toThrow();
  });

  it('refuses plaintext credentials outside an explicit loopback test boundary', () => {
    expect(() => new RemoteExecutorControlPlane({ endpoint: new URL('http://executor.internal'), serviceCredential: 'scoped', callerId:'julius-prod', tenantId:'tenant', requestTimeoutMs: 50 })).toThrow('executor_endpoint_tls_required');
  });
});
