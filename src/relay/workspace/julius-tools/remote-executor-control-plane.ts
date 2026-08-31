import type { KeyObject } from 'node:crypto';
import type { SandboxExecutionPort } from '../../mission/julius';
import { receiptDigest, verifyExecutorAttestation, type SignedExecutorAttestation } from './executor-attestation';

export interface ExecutorControlPlaneConfig {
  readonly endpoint: URL;
  readonly serviceCredential: string;
  readonly requestTimeoutMs: number;
  readonly trustedReceiptKeys?: ReadonlyMap<string, KeyObject>;
  /** Loopback HTTP is test-only; production service traffic must use authenticated TLS. */
  readonly allowInsecureLoopbackForTests?: boolean;
}

const remoteInstances = new WeakSet<object>();

/** Production transport. It has no Docker binary, socket, signing key, or receipt-store path. */
export class RemoteExecutorControlPlane implements SandboxExecutionPort {
  constructor(private readonly config: ExecutorControlPlaneConfig) {
    const loopback = ['127.0.0.1','::1','localhost'].includes(config.endpoint.hostname);
    if (config.endpoint.protocol !== 'https:' && !(config.allowInsecureLoopbackForTests && config.endpoint.protocol === 'http:' && loopback)) throw new Error('executor_endpoint_tls_required');
    if (config.endpoint.username || config.endpoint.password || config.endpoint.search || config.endpoint.hash) throw new Error('executor_endpoint_secret_or_query_refused');
    if (!config.serviceCredential || config.requestTimeoutMs < 1) throw new Error('executor_control_plane_config_invalid');
    remoteInstances.add(this);
  }

  private async call<T>(operation: string, payload: unknown): Promise<T> {
    const response = await fetch(new URL('/v1/execute', this.config.endpoint), {
      method: 'POST', signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      headers: { authorization: `Bearer ${this.config.serviceCredential}`, 'content-type': 'application/json', 'x-julius-operation': operation },
      body: JSON.stringify(payload),
    }).catch(() => { throw new Error('EXECUTOR_UNAVAILABLE'); });
    if (!response.ok) throw new Error(response.status === 409 ? 'executor_identity_conflict' : response.status === 401 || response.status === 403 ? 'executor_authorization_refused' : 'EXECUTOR_UNAVAILABLE');
    const decoded = await response.json() as {value:T;attestations?:readonly SignedExecutorAttestation[]};
    return decoded.value;
  }

  createSandbox = (input: Parameters<SandboxExecutionPort['createSandbox']>[0]) => this.call<Awaited<ReturnType<SandboxExecutionPort['createSandbox']>>>('create', input);
  prepareWorkspace = (input: Parameters<SandboxExecutionPort['prepareWorkspace']>[0]) => this.call<Awaited<ReturnType<SandboxExecutionPort['prepareWorkspace']>>>('prepare', input);
  async executeTool(input: Parameters<SandboxExecutionPort['executeTool']>[0]) {
    const response = await fetch(new URL('/v1/execute', this.config.endpoint), {
      method: 'POST', signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      headers: { authorization: `Bearer ${this.config.serviceCredential}`, 'content-type': 'application/json', 'x-julius-operation': 'execute' }, body: JSON.stringify(input),
    }).catch(() => { throw new Error('EXECUTOR_UNAVAILABLE'); });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'executor_authorization_refused' : response.status === 409 ? 'executor_identity_conflict' : 'EXECUTOR_UNAVAILABLE');
    const decoded = await response.json() as {value:Awaited<ReturnType<SandboxExecutionPort['executeTool']>>;attestations:readonly SignedExecutorAttestation[];receiptBodies:Readonly<Record<'BEFORE'|'AFTER',string>>};
    if (!this.config.trustedReceiptKeys || decoded.attestations?.length !== 2) throw new Error('SECURITY_FAILURE:executor_attestation_missing');
    const executionIdentity = `${input.request.invocationId}:${input.dispatchGeneration}:${input.sandboxId}`;
    for (const phase of ['BEFORE', 'AFTER'] as const) {
      const signed = decoded.attestations.find(item => item.attestation.phase === phase);
      if (!signed) throw new Error(`SECURITY_FAILURE:executor_${phase.toLowerCase()}_attestation_missing`);
      if (typeof decoded.receiptBodies?.[phase] !== 'string' || receiptDigest(decoded.receiptBodies[phase]) !== signed.attestation.receiptDigest) throw new Error('SECURITY_FAILURE:executor_receipt_digest_invalid');
      try {
        verifyExecutorAttestation(signed, this.config.trustedReceiptKeys, {phase,executionIdentity,invocationId:input.request.invocationId,dispatchGeneration:input.dispatchGeneration,sandboxId:input.sandboxId,requestDigest:input.requestDigest,receiptDigest:signed.attestation.receiptDigest});
      } catch { throw new Error('SECURITY_FAILURE:executor_attestation_invalid'); }
    }
    return decoded.value;
  }
  cancelExecution = (input: Parameters<SandboxExecutionPort['cancelExecution']>[0]) => this.call<boolean>('cancel', input);
  destroySandbox = (input: Parameters<SandboxExecutionPort['destroySandbox']>[0]) => this.call<boolean>('destroy', input);
  inspectSandbox = (input: Parameters<SandboxExecutionPort['inspectSandbox']>[0]) => this.call<Awaited<ReturnType<SandboxExecutionPort['inspectSandbox']>>>('inspect', input);
  collectArtifacts = (input: Parameters<SandboxExecutionPort['collectArtifacts']>[0]) => this.call<Awaited<ReturnType<SandboxExecutionPort['collectArtifacts']>>>('artifacts', input);
  discoverSandboxes = () => this.call<Awaited<ReturnType<SandboxExecutionPort['discoverSandboxes']>>>('discover', {});
  quarantineSandbox = (input: Parameters<SandboxExecutionPort['quarantineSandbox']>[0]) => this.call<boolean>('quarantine', input);
  reconcileSandboxes = () => this.call<Awaited<ReturnType<SandboxExecutionPort['reconcileSandboxes']>>>('reconcile', {});
}

export function assertProductionExecutorIsolation(input: { nodeEnv?: string; adapter: SandboxExecutionPort }): void {
  if (input.nodeEnv === 'production' && !remoteInstances.has(input.adapter)) throw new Error('production_direct_docker_executor_refused');
}
