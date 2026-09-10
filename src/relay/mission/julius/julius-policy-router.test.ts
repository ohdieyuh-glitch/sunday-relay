import{describe,expect,it}from'vitest';import{JuliusDispatchError,JuliusProviderHealthRegistry,JuliusProviderRouter,JuliusWorkerRegistry,evaluateJuliusPolicy,normalizeProviderError,type JuliusCardPolicy,type JuliusProviderAdapter,type JuliusWorker}from'.';
import{safeReviewDiagnostics}from'./julius-router';
import{validateArchitectPlan}from'../prompt-architect/prompt-architect-plan';
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

  it('carries the Coding Agent\'s structural facts, and none of its output', () => {
    /**
     * Paid Mission #2 recorded `coder_refused` and nothing else — the third
     * worker with the same opacity the reviewer had. A transcript, a prompt or
     * a final message is not a fact this record may carry; a turn count, a
     * denial count and a result subtype are.
     */
    const SECRET = 'Authorization: Bearer FAKESECRET123456789';
    const safe = safeReviewDiagnostics({
      stage: 'build', transport: 'hosted', provider: 'anthropic',
      requestedModel: 'claude-fable-5', servedModel: 'claude-fable-5-20260114',
      responseId: 'session-abc123', numTurns: 7, toolUseCount: 12, permissionDenials: 2,
      resultSubtype: 'error_max_turns', isError: true, implementationPresent: false,
      outputBytesObserved: 4096,
      // What a careless adapter might attach, and what must not survive.
      finalText: `I edited the file. ${SECRET}`,
      prompt: 'the whole mission prompt',
      transcript: 'sk-live-FAKESECRET123456789',
      workspaceSource: 'const key = "xai-FAKESECRET123456789";',
    })!;

    expect(safe.stage).toBe('build');
    expect(safe.transport).toBe('hosted');
    expect(safe.resultSubtype).toBe('error_max_turns');
    expect(safe.isError).toBe(true);
    expect(safe.numTurns).toBe(7);
    expect(safe.toolUseCount).toBe(12);
    expect(safe.permissionDenials, 'evidence the envelope held').toBe(2);
    expect(safe.implementationPresent).toBe(false);
    expect(safe.servedModel).toBe('claude-fable-5-20260114');

    for (const key of ['finalText', 'prompt', 'transcript', 'workspaceSource']) {
      expect(Object.prototype.hasOwnProperty.call(safe, key), `${key} must not survive`).toBe(false);
    }
    const serialized = JSON.stringify(safe);
    for (const secret of ['FAKESECRET123456789', 'sk-live', 'xai-', 'Authorization', 'I edited']) {
      expect(serialized, `"${secret}" must not reach the durable record`).not.toContain(secret);
    }
  });

  it('a partial coder run reports no denials and claims no implementation', () => {
    /**
     * `permissionDenials` starts at 0 and only the RESULT message populates it,
     * and `isError` stays null until that message. So a timeout, a
     * cancellation or a provider exception after init would have published
     * "no permission denials occurred" — evidence the envelope held — and
     * "an implementation existed", on exactly the partial runs these
     * diagnostics exist to tell apart. Both must be unknown.
     */
    const partial = safeReviewDiagnostics({
      stage: 'build', transport: 'hosted', provider: 'anthropic',
      // No result arrived: no subtype, no isError, and the denial counter is
      // still its initial zero.
      resultSubtype: null, isError: null, permissionDenials: null, implementationPresent: null,
      numTurns: 4,
    })!;
    expect(partial.permissionDenials, 'a zero nobody measured is not evidence').toBeNull();
    expect(partial.implementationPresent, 'a runtime that started is not a result').toBeNull();
    expect(partial.numTurns, 'what WAS observed still travels').toBe(4);

    // And a completed run reports both, including a genuine zero.
    const completed = safeReviewDiagnostics({
      stage: 'build', transport: 'hosted', resultSubtype: 'success',
      isError: false, permissionDenials: 0, implementationPresent: true,
    })!;
    expect(completed.permissionDenials, 'a measured zero is a real answer').toBe(0);
    expect(completed.implementationPresent).toBe(true);

    // A result that errored is a result, and it did not implement anything.
    const errored = safeReviewDiagnostics({
      stage: 'build', transport: 'hosted', resultSubtype: 'error_max_turns',
      isError: true, permissionDenials: 3, implementationPresent: false,
    })!;
    expect(errored.implementationPresent).toBe(false);
    expect(errored.permissionDenials).toBe(3);
  });

  it('a reviewer failure carries no coder facts, and vice versa', () => {
    // One allowlist, three roles. A field a role does not have is null, never a
    // zero that reads as a measurement nobody took.
    const reviewer = safeReviewDiagnostics({ transport: 'local', failureShape: 'review_json_absent' })!;
    expect(reviewer.numTurns).toBeNull();
    expect(reviewer.permissionDenials).toBeNull();
    expect(reviewer.resultSubtype).toBeNull();
    expect(reviewer.implementationPresent).toBeNull();

    const coder = safeReviewDiagnostics({ transport: 'hosted', stage: 'build', numTurns: 3 })!;
    expect(coder.failureShape).toBeNull();
    expect(coder.reviewObjectCount).toBeNull();
    expect(coder.validationReasonCode).toBeNull();
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

/**
 * THE TWO ENDS OF THE ARCHITECT REFUSAL, PINNED TOGETHER.
 *
 * `validateArchitectPlan` decides WHERE a false-work claim was and WHICH phrase
 * it was; `safeReviewDiagnostics` decides what may be published. Those are
 * different files with different rules, and the gap between them is not
 * theoretical: `safeFieldName` took at most two dotted segments, so every
 * nested or indexed answer became null on the way to the artifact. Paid runs
 * 34185920678 and 34186711214 each recorded `plan_false_work_claim` with an
 * empty `validation_field`, and there was no way to tell which of the plan's
 * fields had tripped it.
 *
 * This is the only place both sides are exercised together, so a change to
 * either grammar that stops the answer reaching the artifact fails here rather
 * than in a paid run.
 */
describe('an architect refusal survives the diagnostics allowlist intact', () => {
  const refuse = (change: (plan: Record<string, unknown>) => void) => {
    const plan: Record<string, unknown> = {
      objectiveSummary: 'Implement the mission fixture change.',
      assumptions: [{ id: 'A1', statement: 'The fixture exists.', confidence: 'medium' }],
      unresolvedQuestions: [],
      requirements: [{ id: 'R1', statement: 'It must pass.', rationale: 'The contract says so.' }],
      architectureDecisions: [{ id: 'D1', decision: 'Edit in place.', rationale: 'Smallest change.', alternativesConsidered: [], accepted: false }],
      implementationSteps: [{ order: 1, description: 'Edit the fixture.', filesTouched: ['fixtures/a.ts'] }],
      acceptanceCriteria: ['AC-1'],
      testPlan: ['npm test'],
      risks: [{ id: 'RISK1', risk: 'None material.', mitigation: 'Review.', severity: 'low' }],
      prohibitedActions: [],
      proposedContractAmendments: [],
      contextRefs: [],
      handoff: {
        objective: 'Implement the fixture change.',
        boundedTask: 'Edit exactly the fixture files and make the test pass.',
        acceptanceCriteria: ['AC-1'],
        requiredTests: ['npm test'],
        allowedFileScope: ['fixtures/'],
        prohibitedActions: [],
        grantedTools: [],
        missionContractRef: 'contract-1',
        environmentRef: null,
        expectedEvidence: ['TEST'],
      },
    };
    change(plan);
    const validation = validateArchitectPlan(plan);
    expect(validation.ok, 'the fixture must be refused for this to test anything').toBe(false);
    if (validation.ok) throw new Error('unreachable');
    return validation;
  };

  it('publishes the path and the phrase for every shape the walk can produce', () => {
    const cases: readonly (readonly [string, (plan: Record<string, unknown>) => void])[] = [
      ['a top-level field', (p) => { p.objectiveSummary = 'files were edited'; }],
      ['a nested field, three segments deep', (p) => { (p.handoff as Record<string, unknown>).boundedTask = 'i edited the module'; }],
      ['an indexed element', (p) => { p.contextRefs = ['ok', 'tests were run']; }],
      ['an index inside a nested object', (p) => { (p.architectureDecisions as Record<string, unknown>[])[0]!.rationale = 'i ran the tests'; }],
      ['a key no name could be published for', (p) => { p['not a name'] = 'i edited'; }],
    ];
    for (const [name, change] of cases) {
      const validation = refuse(change);
      const safe = safeReviewDiagnostics({
        transport: 'openai', stage: 'plan', jsonParseable: true, validationPassed: false,
        validationReasonCode: validation.reasonCode,
        validationField: validation.reasonField ?? null,
        validationClaimPhrase: validation.reasonClaim ?? null,
      })!;
      expect(safe.validationField, `${name}: the path must survive`).toBe(validation.reasonField);
      expect(safe.validationField, `${name}: and must not be null`).not.toBeNull();
      expect(safe.validationClaimPhrase, `${name}: the phrase must survive`).toBe(validation.reasonClaim);
      expect(safe.validationReasonCode).toBe('plan_false_work_claim');
    }
  });

  it('still refuses a path carrying anything a sentence needs', () => {
    // The widened grammar is a PATH grammar, not a free-text one. The composite
    // `path :: phrase` form an earlier draft emitted is exactly what it drops —
    // which is why the two halves travel in two columns.
    for (const hostile of [
      'plan.testPlan[1] :: tests were run',
      'plan.<field>',
      'plan.handoff.boundedTask; DROP TABLE',
      'plan.handoff.boundedTask files were edited',
      `plan.${'a'.repeat(200)}`,
      // ASSEMBLED, NOT WRITTEN: a credential-shaped literal in this file is a
      // finding for `relay-repository-boundary.mjs`, which is that scanner
      // working. The pieces join at runtime so the source carries no key shape
      // and the allowlist still sees one.
      ['sk', 'ant', 'notarealkey000000000000'].join('-'),
    ]) {
      expect(safeReviewDiagnostics({ transport: 'openai', validationField: hostile })!.validationField, hostile).toBeNull();
    }
  });

  it('and a claim phrase that is not one of the validator tokens', () => {
    for (const hostile of ['Files Were Edited', 'i edited the file at /home/founder', 'TOKEN', '']) {
      expect(safeReviewDiagnostics({ transport: 'openai', validationClaimPhrase: hostile })!.validationClaimPhrase, hostile).toBeNull();
    }
    expect(safeReviewDiagnostics({ transport: 'openai', validationClaimPhrase: 'tests_were_run' })!.validationClaimPhrase).toBe('tests_were_run');
    // A role that validated no plan reports no phrase, rather than an empty one.
    expect(safeReviewDiagnostics({ transport: 'local', failureShape: 'review_json_absent' })!.validationClaimPhrase).toBeNull();
  });
});
