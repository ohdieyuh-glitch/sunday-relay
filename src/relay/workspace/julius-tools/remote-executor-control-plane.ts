import { randomUUID, type KeyObject } from 'node:crypto';
import type { SandboxExecutionPort } from '../../mission/julius';
import { receiptDigest, verifyExecutorAttestation, type SignedExecutorAttestation } from './executor-attestation';
import { deriveToolInvocationResult, parseExecutorAfterReceipt, parseExecutorBeforeReceipt, validateToolInvocationResult } from './executor-terminal-receipt';

export interface ExecutorControlPlaneConfig {
  readonly endpoint: URL;
  readonly serviceCredential: string;
  readonly callerId: string;
  readonly tenantId: string;
  readonly requestTimeoutMs: number;
  readonly trustedReceiptKeys?: ReadonlyMap<string, KeyObject>;
  /** Loopback HTTP is test-only; production service traffic must use authenticated TLS. */
  readonly allowInsecureLoopbackForTests?: boolean;
}

const remoteInstances = new WeakSet<object>();
async function boundedJson(response:Response):Promise<unknown>{const reader=response.body?.getReader();if(!reader)throw new Error('executor_response_missing');const chunks:Uint8Array[]=[];let bytes=0;while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>2*1024*1024){await reader.cancel();throw new Error('executor_response_too_large');}chunks.push(next.value);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;}catch{throw new Error('executor_response_malformed');}}
async function refusal(response:Response):Promise<Error>{if(response.status===409)return new Error('executor_identity_conflict');if(response.status===401||response.status===403)return new Error('executor_authorization_refused');try{const decoded=await boundedJson(response) as {error?:unknown};if(typeof decoded.error==='string'&&/^[A-Za-z0-9_:.-]{1,256}$/.test(decoded.error))return new Error(`EXECUTOR_UNAVAILABLE:${decoded.error}`);}catch{}return new Error('EXECUTOR_UNAVAILABLE');}

/** Production transport. It has no Docker binary, socket, signing key, or receipt-store path. */
export class RemoteExecutorControlPlane implements SandboxExecutionPort {
  constructor(private readonly config: ExecutorControlPlaneConfig) {
    const loopback = ['127.0.0.1','::1','localhost'].includes(config.endpoint.hostname);
    if (config.endpoint.protocol !== 'https:' && !(config.allowInsecureLoopbackForTests && config.endpoint.protocol === 'http:' && loopback)) throw new Error('executor_endpoint_tls_required');
    if (config.endpoint.username || config.endpoint.password || config.endpoint.search || config.endpoint.hash) throw new Error('executor_endpoint_secret_or_query_refused');
    if (!config.serviceCredential || !config.callerId || !config.tenantId || config.requestTimeoutMs < 1) throw new Error('executor_control_plane_config_invalid');
    remoteInstances.add(this);
  }

  private async call<T>(operation: string, payload: unknown): Promise<T> {
    const response = await fetch(new URL('/v1/execute', this.config.endpoint), {
      method: 'POST', signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      headers: { authorization: `Bearer ${this.config.serviceCredential}`, 'content-type': 'application/json', 'x-julius-operation': operation },
      body: JSON.stringify(payload),
    }).catch(() => { throw new Error('EXECUTOR_UNAVAILABLE'); });
    if (!response.ok) throw await refusal(response);
    const decoded = await boundedJson(response) as {value:T;attestations?:readonly SignedExecutorAttestation[]};
    return decoded.value;
  }

  createSandbox = (input: Parameters<SandboxExecutionPort['createSandbox']>[0]) => this.call<Awaited<ReturnType<SandboxExecutionPort['createSandbox']>>>('create', input);
  prepareWorkspace = (input: Parameters<SandboxExecutionPort['prepareWorkspace']>[0]) => this.call<Awaited<ReturnType<SandboxExecutionPort['prepareWorkspace']>>>('prepare', input);
  async executeTool(input: Parameters<SandboxExecutionPort['executeTool']>[0]) {
    const issuedAt=new Date(),expiresAt=new Date(issuedAt.getTime()+Math.min(this.config.requestTimeoutMs,300_000));
    const envelope={schemaVersion:1,callerId:this.config.callerId,callerScope:'sandbox:execute',tenantId:this.config.tenantId,projectId:input.request.projectId,runId:input.request.runId,taskId:input.request.taskId,invocationId:input.request.invocationId,dispatchGeneration:input.dispatchGeneration,sandboxId:input.sandboxId,requestDigest:input.requestDigest,executionIdentity:`${input.request.invocationId}:${input.dispatchGeneration}:${input.sandboxId}`,nonce:randomUUID(),issuedAt:issuedAt.toISOString(),expiresAt:expiresAt.toISOString(),payload:{expectedLeaseGeneration:input.expectedLeaseGeneration,executionTokenHash:input.executionTokenHash,effectClassification:input.effectClassification,request:input.request}} as const;
    const response = await fetch(new URL('/v1/execute', this.config.endpoint), {
      method: 'POST', signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      headers: { authorization: `Bearer ${this.config.serviceCredential}`, 'content-type': 'application/json', 'x-julius-operation': 'execute' }, body: JSON.stringify(envelope),
    }).catch(() => { throw new Error('EXECUTOR_UNAVAILABLE'); });
    if (!response.ok) throw await refusal(response);
    const decoded = await boundedJson(response) as {value:Awaited<ReturnType<SandboxExecutionPort['executeTool']>>;attestations:readonly SignedExecutorAttestation[];receiptBodies:Readonly<Record<'BEFORE'|'AFTER',string>>;terminalPayload:Readonly<Record<'stdout'|'stderr'|'changedPaths',string>>};
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
    const before=parseExecutorBeforeReceipt(decoded.receiptBodies.BEFORE),after=parseExecutorAfterReceipt(decoded.receiptBodies.AFTER);
    if(before.invocationId!==after.invocationId||before.sandboxId!==after.sandboxId||before.requestDigest!==after.requestDigest||before.preTreeDigest!==after.preTreeDigest)throw new Error('SECURITY_FAILURE:executor_receipt_chain_invalid');
    const authoritative=deriveToolInvocationResult(after,{...decoded.terminalPayload,policyDecisionRef:decoded.value.policyDecisionRef});
    try{validateToolInvocationResult(authoritative,decoded.value);}catch{throw new Error('SECURITY_FAILURE:executor_result_mismatch');}
    return authoritative;
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
