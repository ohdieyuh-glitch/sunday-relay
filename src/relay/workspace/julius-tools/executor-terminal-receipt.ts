import { createHash } from 'node:crypto';
import type { ToolInvocationResult } from '../../mission/julius/julius-tools';

const MAX_RECEIPT_BYTES = 16 * 1024;
const MAX_INLINE_OUTPUT_BYTES = 1024 * 1024;
const MAX_CHANGED_PATHS_BYTES = 64 * 1024;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

const BEFORE_FIELDS = ['receiptVersion', 'phase', 'manifestDigest', 'invocationId', 'dispatchGeneration', 'sandboxId', 'tenantDigest', 'projectDigest', 'runDigest', 'taskDigest', 'workerDigest', 'toolId', 'toolVersion', 'requestDigest', 'policyDigest', 'leaseGeneration', 'imageDigest', 'executorIdentity', 'preTreeDigest', 'startedAt'] as const;
const AFTER_FIELDS = ['receiptVersion', 'phase', 'manifestDigest', 'invocationId', 'dispatchGeneration', 'sandboxId', 'requestDigest', 'executorIdentity', 'terminalState', 'exitCode', 'durationMs', 'finishedAt', 'stdoutDigest', 'stderrDigest', 'preTreeDigest', 'postTreeDigest', 'changedPathsDigest', 'changedPathsAvailable', 'outputBytes', 'executorResultDigest'] as const;

export interface ParsedExecutorBeforeReceipt { readonly [key: string]: string; readonly receiptVersion: '1'; readonly phase: 'BEFORE'; }
export interface ParsedExecutorAfterReceipt { readonly [key: string]: string; readonly receiptVersion: '1'; readonly phase: 'AFTER'; readonly terminalState: 'SUCCEEDED' | 'FAILED'; }

function parseExact(body: string, expected: readonly string[], phase: 'BEFORE' | 'AFTER'): Record<string, string> {
  if (Buffer.byteLength(body, 'utf8') > MAX_RECEIPT_BYTES) throw new Error('executor_receipt_too_large');
  if (!body.endsWith('\n') || body.includes('\r') || body.includes('\0')) throw new Error('executor_receipt_malformed');
  const result: Record<string, string> = {};
  for (const line of body.slice(0, -1).split('\n')) {
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('executor_receipt_malformed');
    const key = line.slice(0, separator), value = line.slice(separator + 1);
    if (key in result || value.length === 0 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('executor_receipt_malformed');
    result[key] = value;
  }
  if (Object.keys(result).sort().join('\0') !== [...expected].sort().join('\0')) throw new Error('executor_receipt_fields_invalid');
  if (result.receiptVersion !== '1' || result.phase !== phase) throw new Error('executor_receipt_phase_invalid');
  return result;
}

const integer = (value: string, minimum = 0): number => {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('executor_receipt_integer_invalid');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error('executor_receipt_integer_invalid');
  return parsed;
};
const digest = (value: string): void => { if (!DIGEST.test(value)) throw new Error('executor_receipt_digest_invalid'); };
const id = (value: string): void => { if (!ID.test(value)) throw new Error('executor_receipt_id_invalid'); };
const timestamp = (value: string): void => { if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('executor_receipt_time_invalid'); };
const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

export function parseExecutorBeforeReceipt(body: string): ParsedExecutorBeforeReceipt {
  const value = parseExact(body, BEFORE_FIELDS, 'BEFORE');
  for (const key of ['manifestDigest', 'tenantDigest', 'projectDigest', 'runDigest', 'taskDigest', 'workerDigest', 'requestDigest', 'policyDigest', 'imageDigest', 'preTreeDigest']) digest(value[key]);
  for (const key of ['invocationId', 'sandboxId', 'toolId', 'toolVersion', 'executorIdentity']) id(value[key]);
  integer(value.dispatchGeneration, 1); integer(value.leaseGeneration, 1); timestamp(value.startedAt);
  return value as ParsedExecutorBeforeReceipt;
}

export function parseExecutorAfterReceipt(body: string): ParsedExecutorAfterReceipt {
  const value = parseExact(body, AFTER_FIELDS, 'AFTER');
  for (const key of ['manifestDigest', 'requestDigest', 'stdoutDigest', 'stderrDigest', 'preTreeDigest', 'postTreeDigest', 'changedPathsDigest', 'executorResultDigest']) digest(value[key]);
  for (const key of ['invocationId', 'sandboxId', 'executorIdentity']) id(value[key]);
  integer(value.dispatchGeneration, 1); integer(value.exitCode); integer(value.durationMs); integer(value.outputBytes); timestamp(value.finishedAt);
  // Whether the changed-path evidence could be gathered is signed, so an empty list cannot be read as
  // "nothing changed" when the truth is that the tool that reports it could not run.
  if (value.changedPathsAvailable !== '0' && value.changedPathsAvailable !== '1') throw new Error('executor_receipt_invalid:changedPathsAvailable');
  if (value.terminalState !== 'SUCCEEDED' && value.terminalState !== 'FAILED') throw new Error('executor_receipt_terminal_state_invalid');
  if ((value.terminalState === 'SUCCEEDED') !== (value.exitCode === '0')) throw new Error('executor_receipt_terminal_state_conflict');
  return value as ParsedExecutorAfterReceipt;
}

/** The three payloads travel base64-encoded: the receipt digests raw bytes, and a UTF-8 round trip through
 *  the wire silently rewrites any byte that is not valid UTF-8, which made honest output look tampered with. */
export interface ExecutorTerminalPayload { readonly stdout: string; readonly stderr: string; readonly changedPaths: string; readonly policyDecisionRef: string; }

/** Derives Julius' normalized result solely from the authoritative AFTER receipt and its hash-bound payloads. */
export function deriveToolInvocationResult(after: ParsedExecutorAfterReceipt, payload: ExecutorTerminalPayload, encoding: 'base64' | 'utf8' = 'base64'): ToolInvocationResult {
  const decode = (value: string, name: string) => { if (typeof value !== 'string') throw new Error(`executor_terminal_payload_encoding:${name}`); if (encoding === 'utf8') return Buffer.from(value, 'utf8'); if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error(`executor_terminal_payload_encoding:${name}`); return Buffer.from(value, 'base64'); };
  const stdout = decode(payload.stdout, 'stdout'), stderr = decode(payload.stderr, 'stderr'), changed = decode(payload.changedPaths, 'changedPaths');
  const stdoutBytes = stdout.byteLength, stderrBytes = stderr.byteLength, changedBytes = changed.byteLength;
  if (stdoutBytes + stderrBytes > MAX_INLINE_OUTPUT_BYTES || changedBytes > MAX_CHANGED_PATHS_BYTES) throw new Error('executor_terminal_payload_too_large');
  if (sha(stdout) !== after.stdoutDigest || sha(stderr) !== after.stderrDigest || sha(changed) !== after.changedPathsDigest) throw new Error('executor_terminal_payload_digest_mismatch');
  const outputBytes = integer(after.outputBytes), durationMs = integer(after.durationMs), exitCode = integer(after.exitCode);
  if (outputBytes !== stdoutBytes + stderrBytes) throw new Error('executor_terminal_output_size_mismatch');
  const terminalDigest = sha([after.exitCode, after.durationMs, after.stdoutDigest, after.stderrDigest, after.postTreeDigest, after.changedPathsDigest].join('\n'));
  if (terminalDigest !== after.executorResultDigest) throw new Error('executor_terminal_result_digest_mismatch');
  return { invocationId: after.invocationId, status: after.terminalState, exitCode, safeSummary: after.terminalState === 'SUCCEEDED' ? 'Sandbox command completed.' : 'Sandbox command failed.', stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), stdoutRef: null, stderrRef: null, artifacts: [], evidence: [], durationMs, resourceUsage: { toolCalls: 1, runtimeMs: durationMs, outputBytes }, policyDecisionRef: payload.policyDecisionRef, mutations: [] };
}

/** Rejects any independently supplied normalized result that differs from signed terminal truth. */
export function validateToolInvocationResult(authoritative: ToolInvocationResult, supplied: ToolInvocationResult): void {
  // Compared by value, not by key order: JSON.stringify would reject an equal result built in another order.
  const stable = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value) ?? 'null'
    : Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  if (stable(authoritative) !== stable(supplied)) throw new Error('executor_normalized_result_mismatch');
}
