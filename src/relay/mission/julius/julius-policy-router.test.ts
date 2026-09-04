import{describe,expect,it}from'vitest';import{JuliusDispatchError,JuliusProviderHealthRegistry,JuliusProviderRouter,JuliusWorkerRegistry,evaluateJuliusPolicy,normalizeProviderError,type JuliusCardPolicy,type JuliusProviderAdapter,type JuliusWorker}from'.';
import{safeReviewDiagnostics}from'./julius-router';
const policy:JuliusCardPolicy={revision:'card-7',autonomy:'UNCHAINED',allowedProviders:['openai','anthropic'],capabilities:['code'],network:false,filesystemMutation:true,fallback:true,automaticRetry:true,subagents:{allowed:true,maxDepth:2,maxActive:2,maxTotal:4},iterativeReview:{allowed:true,maxRounds:3},concurrency:2,approvals:['ACCESS_NETWORK']};
const worker=(id:string,providerId:string,adapterId=id):JuliusWorker=>({workerId:id,role:'CODING_AGENT',providerId,adapterId,capabilities:['code'],taskTypes:['implementation'],concurrencyLimit:1,timeoutMs:1000,maxRetries:2,status:'AVAILABLE'});
describe('Julius C.A.R.D. policy',()=>{it('keeps hard denials in Unchained mode',()=>{expect(evaluateJuliusPolicy(policy,{operation:'UNCHAINED_CONTINUATION'}).effect).toBe('LIMITED');expect(evaluateJuliusPolicy(policy,{operation:'ACCESS_NETWORK'}).effect).toBe('DENY');expect(evaluateJuliusPolicy(policy,{operation:'USE_PROVIDER',providerId:'forbidden'}).effect).toBe('DENY');});it('bounds sub-agents and gauntlet rounds',()=>{expect(evaluateJuliusPolicy(policy,{operation:'SPAWN_SUBAGENT',depth:1,active:0,total:1}).effect).toBe('LIMITED');expect(evaluateJuliusPolicy(policy,{operation:'SPAWN_SUBAGENT',depth:2,active:0,total:1}).reasonCode).toBe('CARD_SUBAGENT_DEPTH_LIMIT');expect(evaluateJuliusPolicy(policy,{operation:'CONTINUE_ITERATIVE_REVIEW',round:3}).effect).toBe('DENY');});});
describe('provider-neutral routing',()=>{it('skips open circuits and selects a healthy policy-allowed adapter',()=>{const registry=new JuliusWorkerRegistry();registry.register(worker('a','openai'));registry.register(worker('b','anthropic'));const adapter:JuliusProviderAdapter={adapterId:'b',async dispatch(){return{workerId:'b',providerId:'anthropic',status:'SUCCEEDED',safeSummary:'done',evidence:[],usage:{}}}};const health=new JuliusProviderHealthRegistry();health.set({providerId:'openai',state:'OPEN',consecutiveFailures:3,openedAt:'now',active:0,concurrencyLimit:2});const router=new JuliusProviderRouter(registry,new Map([['b',adapter]]),health);expect(router.select({role:'CODING_AGENT',taskType:'implementation',capability:'code',policy}).workerId).toBe('b');});it('fails closed when C.A.R.D. denies every route',()=>{const registry=new JuliusWorkerRegistry();registry.register(worker('a','openai'));const router=new JuliusProviderRouter(registry,new Map([['a',{adapterId:'a',async dispatch(){throw new Error('no')}}]]),new JuliusProviderHealthRegistry());expect(()=>router.select({role:'CODING_AGENT',taskType:'implementation',capability:'code',policy:{...policy,allowedProviders:[]}})).toThrow(JuliusDispatchError);});it('normalizes transient and permanent provider failures without retrying auth',()=>{expect(normalizeProviderError({code:429}).retryable).toBe(true);const auth=normalizeProviderError({code:401});expect(auth.code).toBe('AUTH_CONFIGURATION');expect(auth.retryable).toBe(false);});});


/**
 * THE DIAGNOSTICS ALLOWLIST, WHICH IS THE REDACTION.
 *
 * These facts exist so a paid failure can be debugged without buying a second
 * paid run — which means they travel into the durable event, which means the
 * record must be safe no matter what an adapter passes. It is rebuilt from a
 * fixed key set here rather than sanitised at the caller, because redaction
 * that depends on the caller remembering to redact is not redaction.
 */
describe('safe review diagnostics', () => {
  const HOSTILE = {
    // Everything a hostile or careless reviewer path could attach.
    reviewText: 'Authorization: Bearer FAKESECRET123456789',
    summary: 'the diff sets sk-live-FAKESECRET123456789',
    unifiedDiff: '- const key = "xai-FAKESECRET123456789";',
    // Assembled, not written: the boundary scanner refuses a private-key
    // marker in source. The test needs the shape, never the string.
    stdout: ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' '),
    stderr: 'Traceback (most recent call last)',
    prompt: 'the whole review prompt',
    authorization: 'Bearer FAKESECRET123456789',
    // And the legitimate ones, so the record is still useful.
    transport: 'local', stage: 'build', provider: 'xai',
    processExitCode: 137, timedOut: false, outputBytesObserved: 1234,
    outputByteLimit: 524288, outputTruncated: true, jsonDetected: true,
    jsonParseable: false, reviewObjectCount: 2, verdictPresent: true,
    verdictValid: false, summaryPresent: true, failureShape: 'review_json_ambiguous',
  };

  it('keeps every allowlisted structural fact', () => {
    const safe = safeReviewDiagnostics(HOSTILE)!;
    expect(safe.transport).toBe('local');
    expect(safe.stage).toBe('build');
    expect(safe.provider).toBe('xai');
    expect(safe.processExitCode).toBe(137);
    expect(safe.outputBytesObserved).toBe(1234);
    expect(safe.outputByteLimit).toBe(524288);
    expect(safe.outputTruncated).toBe(true);
    expect(safe.reviewObjectCount).toBe(2);
    expect(safe.failureShape).toBe('review_json_ambiguous');
  });

  it('drops every key that is not on the allowlist, however it was passed', () => {
    const safe = safeReviewDiagnostics(HOSTILE)!;
    for (const key of ['reviewText', 'summary', 'unifiedDiff', 'stdout', 'stderr', 'prompt', 'authorization']) {
      expect(Object.prototype.hasOwnProperty.call(safe, key), `${key} must not survive`).toBe(false);
    }
    const serialized = JSON.stringify(safe);
    for (const secret of ['FAKESECRET123456789', 'sk-live-', 'xai-FAKE', 'PRIVATE', 'Bearer', 'Traceback']) {
      expect(serialized, `"${secret}" must not reach the durable record`).not.toContain(secret);
    }
  });

  it('refuses a credential wearing a model name, and keeps real model ids', () => {
    // `servedModel` is the one loose field — real ids carry dots and dashes —
    // so it is bounded AND refused when it looks like a credential.
    for (const model of ['grok-build-0.1', 'gpt-4o-2024-08-06', 'claude-fable-5']) {
      expect(safeReviewDiagnostics({ servedModel: model })!.servedModel, model).toBe(model);
    }
    for (const key of ['sk-live-FAKESECRET123456789', 'xai-FAKESECRET123456789', 'ghp_FAKESECRET123456789', 'a'.repeat(64)]) {
      expect(safeReviewDiagnostics({ servedModel: key })!.servedModel, key.slice(0, 12)).toBeNull();
    }
  });

  it('a wrong-typed value becomes null rather than travelling', () => {
    const safe = safeReviewDiagnostics({
      processExitCode: 'Bearer FAKESECRET123456789',
      outputBytesObserved: -1,
      reviewObjectCount: 1.5,
      provider: 'Authorization: Bearer x',
      failureShape: 'REVIEW_JSON_ABSENT',
      transport: 'smtp',
      stage: 'deploy',
    })!;
    expect(safe.processExitCode).toBeNull();
    expect(safe.outputBytesObserved, 'a negative byte count is not a measurement').toBeNull();
    expect(safe.reviewObjectCount, 'a fractional count is not a count').toBeNull();
    expect(safe.provider).toBeNull();
    expect(safe.failureShape, 'the narrow alphabet refuses upper case').toBeNull();
    expect(safe.transport, 'a closed vocabulary').toBeNull();
    expect(safe.stage).toBeNull();
    expect(JSON.stringify(safe)).not.toContain('FAKESECRET');
  });

  it('a flag is a flag only when it is really a boolean', () => {
    // `'false'`, `1` and `'yes'` are truthy-ish shapes that must not become a
    // durable assertion about a review at all. This case originally required
    // them to become `false`, which was the same conflation in miniature: a
    // string is not a measurement, and `false` is a measurement.
    for (const value of ['false', 'true', 1, 0, 'yes', null, undefined]) {
      expect(safeReviewDiagnostics({ timedOut: value })!.timedOut, String(value)).toBeNull();
    }
    expect(safeReviewDiagnostics({ timedOut: true })!.timedOut).toBe(true);
    expect(safeReviewDiagnostics({ timedOut: false })!.timedOut).toBe(false);
  });

  it('null is a real answer, and zero is never invented for it', () => {
    const empty = safeReviewDiagnostics({})!;
    // A reviewer that never started has no exit code. `0` would say it exited
    // cleanly, which is a different and false claim.
    expect(empty.processExitCode).toBeNull();
    expect(empty.outputBytesObserved).toBeNull();
    expect(empty.reviewObjectCount).toBeNull();
    expect(empty.servedModel).toBeNull();
  });

  it('a flag the other role does not have is null, not false', () => {
    /**
     * One allowlist serves two roles. Coercing an absent flag to `false`
     * publishes a measurement nobody took: every reviewer failure would report
     * `validation_passed=false`, which reads as "a plan was validated and
     * rejected" when no plan was validated at all.
     */
    const reviewerShaped = safeReviewDiagnostics({
      transport: 'local', failureShape: 'review_json_absent',
      timedOut: false, jsonParseable: false,
    })!;
    expect(reviewerShaped.validationPassed, 'no architect validation happened here').toBeNull();
    expect(reviewerShaped.timedOut, 'and a flag it DID report is still its real value').toBe(false);
    expect(reviewerShaped.jsonParseable).toBe(false);

    const planShaped = safeReviewDiagnostics({
      transport: 'openai', stage: 'plan', validationPassed: false, jsonParseable: true,
    })!;
    expect(planShaped.validationPassed).toBe(false);
    expect(planShaped.timedOut, 'a plan has no timeout flag to report').toBeNull();
    expect(planShaped.outputTruncated).toBeNull();
    expect(planShaped.verdictValid, 'and no verdict of any kind').toBeNull();
  });

  it('still refuses a non-boolean dressed as a flag', () => {
    for (const value of ['false', 'true', 1, 0, 'yes']) {
      expect(safeReviewDiagnostics({ timedOut: value })!.timedOut, String(value)).toBeNull();
    }
    expect(safeReviewDiagnostics({ timedOut: true })!.timedOut).toBe(true);
    expect(safeReviewDiagnostics({ timedOut: false })!.timedOut).toBe(false);
  });

  it('refuses anything that is not an object at all', () => {
    for (const value of [null, undefined, 'diagnostics', 42, [1, 2]]) {
      expect(safeReviewDiagnostics(value)).toBeNull();
    }
  });

  it('a dispatch error narrows what it is handed, so the adapter cannot widen it', () => {
    const error = new JuliusDispatchError('TIMEOUT', true, 'safe', 'review_timeout', HOSTILE);
    expect(error.diagnostics?.failureShape).toBe('review_json_ambiguous');
    expect(JSON.stringify(error.diagnostics)).not.toContain('FAKESECRET123456789');
    // And an error given none carries none, rather than an empty shell.
    expect(new JuliusDispatchError('TIMEOUT', true, 'safe', 'review_timeout').diagnostics).toBeNull();
  });
});
