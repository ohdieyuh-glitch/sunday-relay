import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// The wire carries raw bytes base64-encoded, so the fixtures encode what the receipt digested.
const b64=(value:string)=>Buffer.from(value,'utf8').toString('base64');
import { deriveToolInvocationResult, parseExecutorAfterReceipt, parseExecutorBeforeReceipt, validateToolInvocationResult } from './executor-terminal-receipt';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const d = sha('x');
const before = `receiptVersion=1\nphase=BEFORE\nmanifestDigest=${d}\ninvocationId=inv-1\ndispatchGeneration=1\nsandboxId=sb-1\ntenantDigest=${d}\nprojectDigest=${d}\nrunDigest=${d}\ntaskDigest=${d}\nworkerDigest=${d}\ntoolId=shell.bash\ntoolVersion=1\nrequestDigest=${d}\npolicyDigest=${d}\nleaseGeneration=1\nimageDigest=${d}\nexecutorIdentity=executor-1\npreTreeDigest=${d}\nstartedAt=2026-08-31T00:00:00.000Z\n`;
const afterBody = (stdout: string | Buffer = 'ok', stderr: string | Buffer = '', changed: string | Buffer = '') => {
  const result = sha(['0', '12', sha(stdout), sha(stderr), d, sha(changed)].join('\n'));
  return `receiptVersion=1\nphase=AFTER\nmanifestDigest=${d}\ninvocationId=inv-1\ndispatchGeneration=1\nsandboxId=sb-1\nrequestDigest=${d}\nexecutorIdentity=executor-1\nterminalState=SUCCEEDED\nexitCode=0\ndurationMs=12\nfinishedAt=2026-08-31T00:00:01.000Z\nstdoutDigest=${sha(stdout)}\nstderrDigest=${sha(stderr)}\npreTreeDigest=${d}\npostTreeDigest=${d}\nchangedPathsDigest=${sha(changed)}\noutputBytes=${Buffer.byteLength(stdout as string) + Buffer.byteLength(stderr as string)}\nexecutorResultDigest=${result}\n`;
};

describe('executor terminal receipts', () => {
  it('strictly parses exact bounded receipt schemas', () => {
    expect(parseExecutorBeforeReceipt(before).phase).toBe('BEFORE');
    expect(parseExecutorAfterReceipt(afterBody()).terminalState).toBe('SUCCEEDED');
    expect(() => parseExecutorAfterReceipt(`${afterBody()}extra=value\n`)).toThrow('executor_receipt_fields_invalid');
    expect(() => parseExecutorAfterReceipt('x'.repeat(16 * 1024 + 1))).toThrow('executor_receipt_too_large');
  });

  it('derives normalized terminal truth from the AFTER receipt', () => {
    const result = deriveToolInvocationResult(parseExecutorAfterReceipt(afterBody()), { stdout: b64('ok'), stderr: b64(''), changedPaths: b64(''), policyDecisionRef: 'card:1' });
    expect(result).toMatchObject({ invocationId: 'inv-1', status: 'SUCCEEDED', exitCode: 0, stdout: 'ok', durationMs: 12 });
    expect(() => validateToolInvocationResult(result, { ...result, exitCode: 9 })).toThrow('executor_normalized_result_mismatch');
  });

  it('rejects payload, terminal-state, and result-digest disagreement', () => {
    const after = parseExecutorAfterReceipt(afterBody());
    expect(() => deriveToolInvocationResult(after, { stdout: b64('forged'), stderr: b64(''), changedPaths: b64(''), policyDecisionRef: 'card:1' })).toThrow('executor_terminal_payload_digest_mismatch');
    expect(() => parseExecutorAfterReceipt(afterBody().replace('terminalState=SUCCEEDED', 'terminalState=FAILED'))).toThrow('executor_receipt_terminal_state_conflict');
    expect(() => deriveToolInvocationResult({ ...after, executorResultDigest: d }, { stdout: b64('ok'), stderr: b64(''), changedPaths: b64(''), policyDecisionRef: 'card:1' })).toThrow('executor_terminal_result_digest_mismatch');
  });

  /* The in-sandbox executor digests raw bytes. Decoding the payload to a string on the way to Julius
     rewrote every byte that is not valid UTF-8, so an honest execution emitting one such byte was
     refused with an integrity failure — the executor accusing itself of tampering. */
  it('accepts output that is not valid UTF-8',()=>{
    const binary=Buffer.from([0x6f,0x6b,0xff,0x0a]);
    const after=parseExecutorAfterReceipt(afterBody(binary));
    const result=deriveToolInvocationResult(after,{stdout:binary.toString('base64'),stderr:b64(''),changedPaths:b64(''),policyDecisionRef:'card:1'});
    expect(result.resourceUsage.outputBytes).toBe(binary.byteLength);
    expect(Buffer.byteLength(result.stdout)).toBeGreaterThanOrEqual(binary.byteLength);
  });

  it('refuses a payload that is not base64',()=>{
    expect(()=>deriveToolInvocationResult(parseExecutorAfterReceipt(afterBody()),{stdout:'not base64!!',stderr:b64(''),changedPaths:b64(''),policyDecisionRef:'card:1'})).toThrow('executor_terminal_payload_encoding:stdout');
  });
});
