import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveToolInvocationResult, parseExecutorAfterReceipt, parseExecutorBeforeReceipt, validateToolInvocationResult } from './executor-terminal-receipt';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const d = sha('x');
const before = `receiptVersion=1\nphase=BEFORE\nmanifestDigest=${d}\ninvocationId=inv-1\ndispatchGeneration=1\nsandboxId=sb-1\ntenantDigest=${d}\nprojectDigest=${d}\nrunDigest=${d}\ntaskDigest=${d}\nworkerDigest=${d}\ntoolId=shell.bash\ntoolVersion=1\nrequestDigest=${d}\npolicyDigest=${d}\nleaseGeneration=1\nimageDigest=${d}\nexecutorIdentity=executor-1\npreTreeDigest=${d}\nstartedAt=2026-08-31T00:00:00.000Z\n`;
const afterBody = (stdout = 'ok', stderr = '', changed = '') => {
  const result = sha(['0', '12', sha(stdout), sha(stderr), d, sha(changed)].join('\n'));
  return `receiptVersion=1\nphase=AFTER\nmanifestDigest=${d}\ninvocationId=inv-1\ndispatchGeneration=1\nsandboxId=sb-1\nrequestDigest=${d}\nexecutorIdentity=executor-1\nterminalState=SUCCEEDED\nexitCode=0\ndurationMs=12\nfinishedAt=2026-08-31T00:00:01.000Z\nstdoutDigest=${sha(stdout)}\nstderrDigest=${sha(stderr)}\npreTreeDigest=${d}\npostTreeDigest=${d}\nchangedPathsDigest=${sha(changed)}\noutputBytes=${Buffer.byteLength(stdout) + Buffer.byteLength(stderr)}\nexecutorResultDigest=${result}\n`;
};

describe('executor terminal receipts', () => {
  it('strictly parses exact bounded receipt schemas', () => {
    expect(parseExecutorBeforeReceipt(before).phase).toBe('BEFORE');
    expect(parseExecutorAfterReceipt(afterBody()).terminalState).toBe('SUCCEEDED');
    expect(() => parseExecutorAfterReceipt(`${afterBody()}extra=value\n`)).toThrow('executor_receipt_fields_invalid');
    expect(() => parseExecutorAfterReceipt('x'.repeat(16 * 1024 + 1))).toThrow('executor_receipt_too_large');
  });

  it('derives normalized terminal truth from the AFTER receipt', () => {
    const result = deriveToolInvocationResult(parseExecutorAfterReceipt(afterBody()), { stdout: 'ok', stderr: '', changedPaths: '', policyDecisionRef: 'card:1' });
    expect(result).toMatchObject({ invocationId: 'inv-1', status: 'SUCCEEDED', exitCode: 0, stdout: 'ok', durationMs: 12 });
    expect(() => validateToolInvocationResult(result, { ...result, exitCode: 9 })).toThrow('executor_normalized_result_mismatch');
  });

  it('rejects payload, terminal-state, and result-digest disagreement', () => {
    const after = parseExecutorAfterReceipt(afterBody());
    expect(() => deriveToolInvocationResult(after, { stdout: 'forged', stderr: '', changedPaths: '', policyDecisionRef: 'card:1' })).toThrow('executor_terminal_payload_digest_mismatch');
    expect(() => parseExecutorAfterReceipt(afterBody().replace('terminalState=SUCCEEDED', 'terminalState=FAILED'))).toThrow('executor_receipt_terminal_state_conflict');
    expect(() => deriveToolInvocationResult({ ...after, executorResultDigest: d }, { stdout: 'ok', stderr: '', changedPaths: '', policyDecisionRef: 'card:1' })).toThrow('executor_terminal_result_digest_mismatch');
  });
});
