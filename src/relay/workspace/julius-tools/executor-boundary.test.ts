import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const tracked=execFileSync('git',['ls-files','*.ts','*.tsx','*.mts','*.cts'],{cwd:root,encoding:'utf8'}).split('\n').filter(Boolean);
const production=tracked.filter(file=>!/\.test\.tsx?$/.test(file)&&!file.includes('/testing/')&&!file.endsWith('-fixtures.ts'));
const sourceOf=(file:string)=>readFileSync(join(root,file),'utf8');

describe('executor trust boundary',()=>{
  /* Docker authority belongs to the executor process alone. `assertProductionExecutorIsolation` states that
     rule but can only fire where something calls it, and Julius has no composition root that selects an
     adapter yet — so the rule is held structurally here instead of by a guard nothing invokes. */
  it('constructs the Docker adapter only in the executor control plane entry point',()=>{
    const sites=production.filter(file=>/new\s+DockerJuliusSandboxAdapter\b/.test(sourceOf(file)));
    expect(sites).toEqual(['src/relay/workspace/julius-tools/executor-control-plane-main.ts']);
  });

  it('keeps the executor signing key, receipt store and ledger out of every non-executor module',()=>{
    // The sibling harness names these to prove their ABSENCE from a Julius process; it never reads one to use it.
    const executorOnly=new Set(['scripts/julius-sibling-e2e.ts','src/relay/workspace/julius-tools/executor-control-plane-main.ts','src/relay/workspace/julius-tools/executor-control-plane-service.ts','src/relay/workspace/julius-tools/executor-receipt-store.ts','src/relay/workspace/julius-tools/durable-execution-ledger.ts','src/relay/workspace/julius-tools/docker-sandbox-adapter.ts','src/relay/workspace/julius-tools/executor-attestation.ts','src/relay/workspace/julius-tools/index.ts']);
    for(const secret of ['EXECUTOR_SIGNING_KEY_PATH','EXECUTOR_RECEIPT_ROOT','EXECUTOR_LEDGER_ROOT','EXECUTOR_CREDENTIAL_ROOT','EXECUTOR_CALLERS']){
      const readers=production.filter(file=>sourceOf(file).includes(secret)&&!executorOnly.has(file));
      expect(readers,`${secret} is read outside the executor control plane`).toEqual([]);
    }
  });

  /* Julius's transport must never gain a way to sign, so the private key type may not reach it. */
  it('never lets the Julius transport hold a private signing key',()=>{
    const transport=sourceOf('src/relay/workspace/julius-tools/remote-executor-control-plane.ts');
    expect(transport).not.toMatch(/createPrivateKey|privateSigningKey|signExecutorAttestation/);
    expect(transport).toMatch(/trustedReceiptKeys/);
  });

  /* Every physical operation must be reachable only through one authenticated, scope-checked entry. */
  it('exposes exactly one route and refuses an operation it does not know',()=>{
    const service=sourceOf('src/relay/workspace/julius-tools/executor-control-plane-service.ts');
    expect(service.match(/request\.url!=='\/v1\/execute'/g)).toHaveLength(1);
    expect(service).toMatch(/EXECUTOR_OPERATION_SET\.has/);
    expect(service).toMatch(/authority\.operations\.has\(operation\)/);
  });
});
