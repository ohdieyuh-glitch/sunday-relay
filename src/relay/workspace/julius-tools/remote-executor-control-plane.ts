import type { SandboxExecutionPort } from '../../mission/julius';

export interface ExecutorControlPlaneConfig {
  readonly endpoint: URL;
  readonly serviceCredential: string;
  readonly requestTimeoutMs: number;
}

/** Production transport. It has no Docker binary, socket, signing key, or receipt-store path. */
export class RemoteExecutorControlPlane implements SandboxExecutionPort {
  constructor(private readonly config: ExecutorControlPlaneConfig) {
    if (config.endpoint.protocol !== 'https:' && config.endpoint.protocol !== 'http:') throw new Error('executor_endpoint_scheme_invalid');
    if (config.endpoint.username || config.endpoint.password || config.endpoint.search || config.endpoint.hash) throw new Error('executor_endpoint_secret_or_query_refused');
    if (!config.serviceCredential || config.requestTimeoutMs < 1) throw new Error('executor_control_plane_config_invalid');
  }

  private async call<T>(operation: string, payload: unknown): Promise<T> {
    const response = await fetch(new URL('/v1/execute', this.config.endpoint), {
      method: 'POST', signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      headers: { authorization: `Bearer ${this.config.serviceCredential}`, 'content-type': 'application/json', 'x-julius-operation': operation },
      body: JSON.stringify(payload),
    }).catch(() => { throw new Error('EXECUTOR_UNAVAILABLE'); });
    if (!response.ok) throw new Error(response.status === 409 ? 'executor_identity_conflict' : response.status === 401 || response.status === 403 ? 'executor_authorization_refused' : 'EXECUTOR_UNAVAILABLE');
    return await response.json() as T;
  }

  createSandbox = (input: Parameters<SandboxExecutionPort['createSandbox']>[0]) => this.call<Awaited<ReturnType<SandboxExecutionPort['createSandbox']>>>('create', input);
  prepareWorkspace = (input: Parameters<SandboxExecutionPort['prepareWorkspace']>[0]) => this.call<Awaited<ReturnType<SandboxExecutionPort['prepareWorkspace']>>>('prepare', input);
  executeTool = (input: Parameters<SandboxExecutionPort['executeTool']>[0]) => this.call<Awaited<ReturnType<SandboxExecutionPort['executeTool']>>>('execute', input);
  cancelExecution = (input: Parameters<SandboxExecutionPort['cancelExecution']>[0]) => this.call<boolean>('cancel', input);
  destroySandbox = (input: Parameters<SandboxExecutionPort['destroySandbox']>[0]) => this.call<boolean>('destroy', input);
  inspectSandbox = (input: Parameters<SandboxExecutionPort['inspectSandbox']>[0]) => this.call<Awaited<ReturnType<SandboxExecutionPort['inspectSandbox']>>>('inspect', input);
  collectArtifacts = (input: Parameters<SandboxExecutionPort['collectArtifacts']>[0]) => this.call<Awaited<ReturnType<SandboxExecutionPort['collectArtifacts']>>>('artifacts', input);
  discoverSandboxes = () => this.call<Awaited<ReturnType<SandboxExecutionPort['discoverSandboxes']>>>('discover', {});
  quarantineSandbox = (input: Parameters<SandboxExecutionPort['quarantineSandbox']>[0]) => this.call<boolean>('quarantine', input);
  reconcileSandboxes = () => this.call<Awaited<ReturnType<SandboxExecutionPort['reconcileSandboxes']>>>('reconcile', {});
}

export function assertProductionExecutorIsolation(input: { nodeEnv?: string; adapter: SandboxExecutionPort }): void {
  if (input.nodeEnv === 'production' && input.adapter.constructor.name !== RemoteExecutorControlPlane.name) throw new Error('production_direct_docker_executor_refused');
}
