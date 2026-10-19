import {describe,expect,it} from 'vitest';
import {decideToolReconciliation} from './julius-tool-lifecycle';

describe('tool crash-after-effect reconciliation',()=>{
 it('never automatically replays unknown destructive work',()=>{
  for(const effectClassification of ['NON_IDEMPOTENT_MUTATION','PROCESS_WITH_EXTERNAL_EFFECT'] as const){
   expect(decideToolReconciliation({effectClassification,receiptState:'STARTED_UNKNOWN_OUTCOME'})).toBe('REQUIRE_AUTHORIZED_DECISION');
   expect(decideToolReconciliation({effectClassification,receiptState:'SANDBOX_GONE'})).toBe('REQUIRE_AUTHORIZED_DECISION');
  }
 });
 it('settles a durable completion receipt or a proven after-state',()=>{
  expect(decideToolReconciliation({effectClassification:'NON_IDEMPOTENT_MUTATION',receiptState:'COMPLETED_WITH_RESULT'})).toBe('SETTLE_RECEIPT');
  expect(decideToolReconciliation({effectClassification:'IDEMPOTENT_MUTATION',receiptState:'STARTED_UNKNOWN_OUTCOME',afterStateMatches:true})).toBe('SETTLE_RECEIPT');
 });
 it('only retries never-started or lost read-only work',()=>{
  expect(decideToolReconciliation({effectClassification:'READ_ONLY',receiptState:'NEVER_STARTED'})).toBe('RETRY_SAFE');
  expect(decideToolReconciliation({effectClassification:'READ_ONLY',receiptState:'STARTED_UNKNOWN_OUTCOME'})).toBe('REQUIRE_AUTHORIZED_DECISION');
 });
});
