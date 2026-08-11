import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { runHermesReview } from './hermes-reviewer';
import type { ReviewPacket } from './hermes-reviewer';
import { runRemoteHermesReview, type RemoteHermesConfig } from './hermes-remote-review';
import { loadXaiConfig, modelMatchesVerified } from './reviewer-harness/hermes/xai-models';
import { MODEL_IDENTITY_RELATIONS, classifyModelIdentity } from './model-identity';

/**
 * DEFECT 3 — WHICH MODEL ACTUALLY REVIEWED.
 *
 * `docs/relay/HOSTED_MISSION_EVIDENCE.md` carried exactly one open defect out
 * of the hosted-pipeline milestone: the reviewer evidence named a model Relay
 * had only ever REQUESTED. Nothing was lying on purpose — the served model was
 * dropped independently at four separate layers, and the single `model` field
 * at the top then filled the hole from configuration:
 *
 *   1. `runHermesReview` (the local spawn) never passed `--usage-file`, so
 *      Hermes was never asked to report what ran, and the outcome's model was
 *      `cfg.model` — configuration wearing evidence's name.
 *   2. `runRemoteHermesReview` hardcoded `model: null` and did not even read
 *      `usage` off the poll response.
 *   3. Both harness transports projected the usage block and copied the token
 *      counts while discarding the model.
 *   4. `loadXaiConfig` read `RELAY_REVIEWER_MODEL`, a name no deployment sets
 *      — the reviewer model is configured as `RELAY_HERMES_MODEL` — so the
 *      requested model was null everywhere it mattered.
 *
 * This file holds seams 1, 2 and 4 open independently, plus the rule that
 * decides what a requested/served difference MEANS. Seam 3 — the transports —
 * is proven in two places: the decoder half in
 * `reviewer-harness/hermes/remote-transport.test.ts`, and the PRODUCER half
 * over real HTTP through the real service in `relay-hermes-service/end-to-end.test.ts`
 * ("carries the served model the fake Hermes reported"). The mission-level
 * consequences are in `orchestrator.test.ts`, where the pipeline harness is.
 *
 * Nothing here opens a socket. The local path's process is a fake spawn and the
 * remote path's service is a fake fetch.
 */

const PACKET: ReviewPacket = {
  missionId: 'msn-served-model',
  originalRequest: 'Add the migration guard.',
  handoffJson: JSON.stringify({ objective: 'Add the migration guard.' }),
  acceptanceCriteria: ['The guard refuses an unknown version.'],
  baseRevision: 'abc1234',
  artifactDigest: 'sha256:deadbeef',
  changedFiles: ['src/app.ts'],
  unifiedDiff: 'diff --git a/src/app.ts b/src/app.ts',
  changedFileContents: 'export const guard = true;',
  testCommand: 'npm test',
  testOutput: 'ok',
  relayEvidence: ['relay verified the diff applies'],
};

const REVIEW_JSON = JSON.stringify({
  verdict: 'approved',
  summary: 'The guard is present.',
  findings: [],
  requirementsChecked: [{ requirement: 'The guard refuses an unknown version.', status: 'passed', evidence: 'line 4' }],
});

/* --------------------------------------------------- seam 1: the local spawn */

/**
 * A fake `hermes` that behaves like the real one: it writes its usage report to
 * whatever path `--usage-file` names, and the model it reports is the model
 * that answered — which a provider is free to make different from the request.
 */
function fakeHermes(options: { usageModel?: string | null; writeUsage?: boolean } = {}) {
  const seen: { args: string[]; usageFilePath: string | null } = { args: [], usageFilePath: null };
  const spawnImpl = ((_exe: string, args: string[], _opts: { cwd: string }) => {
    seen.args = args;
    const flag = args.indexOf('--usage-file');
    seen.usageFilePath = flag >= 0 ? (args[flag + 1] ?? null) : null;
    if (options.writeUsage !== false && seen.usageFilePath !== null) {
      writeFileSync(
        seen.usageFilePath,
        JSON.stringify({
          input_tokens: 1200,
          output_tokens: 300,
          ...(options.usageModel === undefined || options.usageModel === null
            ? {}
            : { model: options.usageModel }),
        }),
      );
    }
    const child = {
      stdout: { on: (_e: string, cb: (c: Buffer) => void) => cb(Buffer.from(REVIEW_JSON)) },
      stderr: { on: () => undefined },
      on: (event: string, cb: (arg?: unknown) => void) => {
        if (event === 'close') setTimeout(() => cb(0), 0);
      },
      kill: () => undefined,
    };
    return child as never;
  }) as never;
  return { spawnImpl, seen };
}

const runLocal = (
  fake: ReturnType<typeof fakeHermes>,
  config: { executable: string; timeoutMs: number; maxOutputBytes: number; model?: string; provider?: string },
) =>
  runHermesReview({
    packet: PACKET,
    config,
    now: () => '2026-08-11T00:00:00.000Z',
    spawnImpl: fake.spawnImpl,
  });

describe('seam 1 — the local reviewer reports the model Hermes named, not the one configured', () => {
  it('asks Hermes for a usage report at all', async () => {
    const fake = fakeHermes({ usageModel: 'grok-4-0709' });
    await runLocal(fake, { executable: 'hermes', timeoutMs: 2_000, maxOutputBytes: 8_192, model: 'grok-4' });
    // Without this flag the reviewer never reports what ran, and there is no
    // evidence to attest — the state this path was in.
    expect(fake.seen.args).toContain('--usage-file');
    // Read-only is unchanged by the addition.
    expect(fake.seen.args).toContain('--safe-mode');
    // The requested model is still passed, on its own flag.
    expect(fake.seen.args).toContain('-m');
    expect(fake.seen.args).toContain('grok-4');
  });

  it('separates the requested model from the served one when they differ', async () => {
    // The provider answers with a dated variant of the requested family. This
    // is the ordinary case, and the case a single `model` field cannot express.
    const fake = fakeHermes({ usageModel: 'grok-4-0709' });
    const outcome = await runLocal(fake, {
      executable: 'hermes', timeoutMs: 2_000, maxOutputBytes: 8_192, model: 'grok-4', provider: 'xai',
    });
    expect(outcome.kind).toBe('reviewed');
    if (outcome.kind !== 'reviewed') throw new Error(JSON.stringify(outcome));
    expect(outcome.requestedModel).toBe('grok-4');
    expect(outcome.servedModel).toBe('grok-4-0709');
    // The two really are different strings, so this asserts a fact about the
    // run rather than agreeing with configuration.
    expect(outcome.servedModel).not.toBe(outcome.requestedModel);
  });

  it('leaves the served model Unknown when Hermes reports none, never filling it from config', async () => {
    const fake = fakeHermes({ usageModel: null });
    const outcome = await runLocal(fake, {
      executable: 'hermes', timeoutMs: 2_000, maxOutputBytes: 8_192, model: 'grok-4',
    });
    if (outcome.kind !== 'reviewed') throw new Error(JSON.stringify(outcome));
    expect(outcome.requestedModel).toBe('grok-4');
    // This is the defect in one assertion: it used to be 'grok-4'.
    expect(outcome.servedModel).toBeNull();
  });

  it('leaves the served model Unknown when no usage report is written at all', async () => {
    const fake = fakeHermes({ writeUsage: false });
    const outcome = await runLocal(fake, {
      executable: 'hermes', timeoutMs: 2_000, maxOutputBytes: 8_192, model: 'grok-4',
    });
    if (outcome.kind !== 'reviewed') throw new Error(JSON.stringify(outcome));
    expect(outcome.servedModel).toBeNull();
    // A missing file is not a parse failure that should lose the review.
    expect(outcome.result.verdict).toBe('approved');
  });

  it('puts the usage file inside the scratch cwd, so it leaves nothing behind', async () => {
    const fake = fakeHermes({ usageModel: 'grok-4-0709' });
    await runLocal(fake, { executable: 'hermes', timeoutMs: 2_000, maxOutputBytes: 8_192, model: 'grok-4' });
    const path = fake.seen.usageFilePath as string;
    expect(path).toContain('relay-hermes-review-');
    // The reviewer's scratch directory is removed with the run, and the usage
    // report goes with it rather than accumulating under the system tmpdir.
    expect(existsSync(path)).toBe(false);
  });
});

/* ------------------------------------------------ seam 2: the remote service */

const remoteConfig: RemoteHermesConfig = {
  serviceUrl: 'https://hermes.example.com',
  token: 'service-token',
  trustedOrigins: ['https://hermes.example.com'],
  timeoutMs: 1_000,
  reviewTimeoutMs: 10_000,
  pollIntervalMs: 1,
};

const remoteDeps = { now: () => '2026-08-11T00:00:00.000Z', sleep: () => Promise.resolve() };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const runRemote = (usage: unknown) => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(json({ accepted: true, runId: 'run-served' }))
    .mockResolvedValueOnce(json({
      runId: 'run-served', status: 'completed', reviewText: REVIEW_JSON,
      ...(usage === undefined ? {} : { usage }),
    }));
  return runRemoteHermesReview({
    packet: PACKET, config: remoteConfig, runId: 'run-served',
    deps: { ...remoteDeps, fetchImpl: fetchImpl as unknown as typeof fetch },
  });
};

describe('seam 2 — the hosted reviewer reports the model the service observed', () => {
  it('reads the served model off the service’s own usage report', async () => {
    const outcome = await runRemote({ inputTokens: 900, outputTokens: 210, model: 'grok-4-0709' });
    if (outcome.kind !== 'reviewed') throw new Error(JSON.stringify(outcome));
    // This return used to be a hardcoded `model: null`, and the poll did not
    // read `usage` at all — so every HOSTED review arrived with nothing on the
    // served axis and the mission filled it from preflight configuration.
    expect(outcome.servedModel).toBe('grok-4-0709');
    /**
     * And nothing on the REQUESTED axis, because the bridge genuinely did not
     * request a model: it asks the service for a review and the service's own
     * configuration decides. Inventing one here would be the defect rebuilt.
     */
    expect(outcome.requestedModel).toBeNull();
  });

  it('leaves the served model Unknown when the service reports no usage', async () => {
    const outcome = await runRemote(undefined);
    if (outcome.kind !== 'reviewed') throw new Error(JSON.stringify(outcome));
    expect(outcome.servedModel).toBeNull();
    expect(outcome.result.verdict).toBe('approved');
  });

  it('leaves the served model Unknown when usage names no model', async () => {
    const outcome = await runRemote({ inputTokens: 900, outputTokens: 210 });
    if (outcome.kind !== 'reviewed') throw new Error(JSON.stringify(outcome));
    expect(outcome.servedModel).toBeNull();
  });

  it('refuses a served model that is not a non-empty string', async () => {
    for (const model of [null, '', '   ', 42, { name: 'grok' }]) {
      const outcome = await runRemote({ inputTokens: 1, outputTokens: 1, model });
      if (outcome.kind !== 'reviewed') throw new Error(JSON.stringify(outcome));
      expect(outcome.servedModel, JSON.stringify(model)).toBeNull();
    }
  });
});

/* ------------------------------- seam 4: the name the deployment actually sets */

describe('seam 4 — the reviewer model is read from the variable deployments set', () => {
  it('reads RELAY_HERMES_MODEL, which is how every deployment configures it', () => {
    const cfg = loadXaiConfig({ XAI_API_KEY: 'k', RELAY_HERMES_MODEL: 'grok-4' } as NodeJS.ProcessEnv);
    // This was null on every real deployment, because the loader read a name
    // nothing sets — which made model verification permanently unreachable.
    expect(cfg.requestedModel).toBe('grok-4');
  });

  it('still honours the older RELAY_REVIEWER_MODEL rather than silently ignoring it', () => {
    const cfg = loadXaiConfig({ XAI_API_KEY: 'k', RELAY_REVIEWER_MODEL: 'grok-3' } as NodeJS.ProcessEnv);
    expect(cfg.requestedModel).toBe('grok-3');
  });

  it('prefers the canonical name when both are set, rather than picking by accident', () => {
    const cfg = loadXaiConfig({
      XAI_API_KEY: 'k', RELAY_HERMES_MODEL: 'grok-4', RELAY_REVIEWER_MODEL: 'grok-3',
    } as NodeJS.ProcessEnv);
    expect(cfg.requestedModel).toBe('grok-4');
  });

  it('keeps an unconfigured model null instead of choosing one', () => {
    const cfg = loadXaiConfig({ XAI_API_KEY: 'k' } as NodeJS.ProcessEnv);
    // Relay does not pick a reviewer model on the founder's behalf.
    expect(cfg.requestedModel).toBeNull();
  });

  it('does not read a blank value as a configured model', () => {
    const cfg = loadXaiConfig({ XAI_API_KEY: 'k', RELAY_HERMES_MODEL: '   ' } as NodeJS.ProcessEnv);
    expect(cfg.requestedModel).toBeNull();
  });
});

/* --------------------------------- the documentation this defect was filed in */

describe('the recorded defect and its documentation agree', () => {
  it('HOSTED_MISSION_EVIDENCE no longer carries defect 3 as open', () => {
    // Relative to the repo root, like `.env.example` in orchestrator.test.ts.
    // The bridge tsconfig forbids `import.meta`, so no URL is built here.
    const doc = readFileSync('docs/relay/HOSTED_MISSION_EVIDENCE.md', 'utf8');
    /**
     * A doc that still lists the defect as open, beside code that closed it, is
     * the failure mode this repository has repaired more often than any bug:
     * a claim the code no longer supports. Asserted on the doc, so the two
     * cannot drift apart silently.
     */
    expect(doc).toContain("The reviewer's served model is not proven. — CLOSED");
    // And the section no longer calls its whole contents unfixed.
    expect(doc).not.toContain('## Defects found and NOT fixed');
  });
});

/* ------------------------- the rule that decides what a difference MEANS */

describe('a version resolution is not a substitution', () => {
  /**
   * THE REGRESSION THIS FILE'S FIRST VERSION SHIPPED.
   *
   * Splitting requested from served produced a second question, and the first
   * answer was `requested !== served`. That refused `gpt-4o` answered by
   * `gpt-4o-2024-08-06` — the pair the test above calls "the ordinary case" —
   * so on the `openai_reviewer` configuration this repository's own docs
   * recommend for a hosted run, EVERY mission failed at the review step with
   * `retryable: false`, after the review had been paid for, and the founder was
   * told their provider had swapped the reviewer. An independent review found it
   * by running the real registry.
   *
   * These cases are the rule, and the mission-level consequence is in
   * `orchestrator.test.ts`.
   */
  const relation = (requested: string | null, served: string | null) =>
    classifyModelIdentity({ requested, served }).relation;

  it('calls every real provider version resolution a resolution', () => {
    for (const [requested, served] of [
      ['gpt-4o', 'gpt-4o-2024-08-06'],
      ['claude-sonnet-5', 'claude-sonnet-5-20260114'],
      ['grok-4', 'grok-4-0709'],
      ['gpt-test', 'gpt-test-2026-01-01'],
      ['model', 'model@2026-01'],
      ['model', 'model:v2'],
      ['model', 'model/2026-01'],
      ['gpt-test', 'gpt-test-0613'],
    ] as const) {
      const verdict = classifyModelIdentity({ requested, served });
      expect(verdict.relation, `${requested} → ${served}`).toBe('resolution');
      expect(verdict.substituted, `${requested} → ${served}`).toBe(false);
    }
  });

  it('still calls a genuinely different model a substitution', () => {
    for (const [requested, served] of [
      ['grok-4', 'grok-3-mini'],
      // A VARIANT, not a snapshot. `gpt-4o-mini` satisfies "prefix plus
      // separator" and is a different, weaker, cheaper model — the
      // counterexample that made the first version of this rule unsound.
      ['gpt-4o', 'gpt-4o-mini'],
      ['gpt-4o', 'gpt-4o-turbo'],
      ['gpt-4o', 'gpt-4o-preview'],
      // `latest` does not even name what ran.
      ['gpt-4o', 'gpt-4o-latest'],
      ['claude-sonnet-5', 'claude-haiku-4-5'],
      // The REVERSE direction: a request that pinned a snapshot and got the
      // family back did not have its pin honoured, and a pin nobody honours is
      // not a pin.
      ['gpt-4o-2024-08-06', 'gpt-4o'],
      // A shared prefix with no separator is a different model, not a snapshot.
      ['grok-4', 'grok-40'],
    ] as const) {
      const verdict = classifyModelIdentity({ requested, served });
      expect(verdict.relation, `${requested} → ${served}`).toBe('substitution');
      expect(verdict.substituted, `${requested} → ${served}`).toBe(true);
      // Both names travel, so a refusal names what it refused and why.
      expect(verdict.reason).toContain(served);
      expect(verdict.reason).toContain(requested);
    }
  });

  it('refuses a version BUMP, which a `.` separator used to accept as a snapshot', () => {
    /**
     * `.` was in `RESOLUTION_SEPARATORS` and undocumented, and it made
     * `gpt-4` → `gpt-4.1` a "resolution". `gpt-4.1` is a different model with
     * different weights and a different price. An independent review found this
     * by running the classifier over 46 real provider id pairs.
     */
    for (const [requested, served] of [
      ['gpt-4', 'gpt-4.1'],
      ['grok-4', 'grok-4.1'],
      ['llama-3', 'llama-3.1'],
      // And the digit floor: one or two digits is a version bump, not a
      // snapshot. Every real snapshot is a date or a zero-padded build number.
      ['gpt-4o', 'gpt-4o-2'],
      ['claude-3', 'claude-3-5'],
    ] as const) {
      expect(relation(requested, served), `${requested} → ${served}`).toBe('substitution');
    }
  });

  it('accepts a three-digit or longer snapshot, which is what providers actually emit', () => {
    for (const [requested, served] of [
      ['gemini-1.5-pro', 'gemini-1.5-pro-002'],
      ['claude-3-5-sonnet', 'claude-3-5-sonnet-20241022'],
      ['grok-2', 'grok-2-1212'],
      ['mistral-large', 'mistral-large-2411'],
    ] as const) {
      expect(relation(requested, served), `${requested} → ${served}`).toBe('resolution');
    }
  });

  it('does not silently carry a separator the comment above it fails to mention', () => {
    /**
     * The sentence enumerating the separators listed four while the array held
     * five, and the undocumented fifth was the unsound one. Asserted against the
     * source so the two cannot drift again.
     */
    const source = readFileSync('relay-bridge/model-identity.ts', 'utf8');
    const declared = /const RESOLUTION_SEPARATORS = \[(.*?)\] as const;/.exec(source)?.[1] ?? '';
    expect(declared).toContain("'-'");
    // `.` must stay out, and the comment must say it is out.
    expect(declared).not.toContain("'.'");
    expect(source).toContain('`.` IS DELIBERATELY ABSENT');
  });

  it('cannot verify an ALIAS, and says so rather than refusing a paid review', () => {
    /**
     * The same over-refusal class as the original regression, for provider alias
     * forms. `claude-3-5-sonnet-latest` answered by `claude-3-5-sonnet-20241022`
     * is the provider doing exactly what the alias asked for — refusing it threw
     * away a paid review with `retryable: false`.
     *
     * Relay holds no alias table and must not invent one, so the honest answer
     * is neither "match" nor "substitution".
     */
    for (const [requested, served] of [
      ['claude-3-5-sonnet-latest', 'claude-3-5-sonnet-20241022'],
      ['mistral-large-latest', 'mistral-large-2411'],
      ['gpt-4-turbo-preview', 'gpt-4-0125-preview'],
      ['claude-sonnet-4-0', 'claude-sonnet-4-20250514'],
    ] as const) {
      const verdict = classifyModelIdentity({ requested, served });
      expect(verdict.relation, `${requested} → ${served}`).toBe('alias_unverifiable');
      // Not a substitution, so the mission is not failed over it.
      expect(verdict.substituted, `${requested} → ${served}`).toBe(false);
      // And the record says the check could not be made rather than implying it
      // passed.
      expect(verdict.reason).toContain('unverified');
      expect(verdict.reason).toContain(served);
      expect(verdict.reason).toContain(requested);
    }
  });

  it('still refuses an alias answered by a DIFFERENT provider\'s family', () => {
    // However loose an alias is, it does not cross providers.
    expect(relation('claude-3-5-sonnet-latest', 'grok-3-mini')).toBe('substitution');
    expect(relation('mistral-large-latest', 'gpt-4o-2024-08-06')).toBe('substitution');
  });

  it('treats a case-only difference as the same model', () => {
    // Failing a paid review over capitalization is the over-refusal this rule
    // exists to avoid.
    expect(relation('Grok-4', 'grok-4')).toBe('exact');
    expect(relation('grok-4', 'GROK-4-0709')).toBe('resolution');
  });

  it('keeps Unknown as Unknown and an unrequested model as unrequested', () => {
    // Neither is a substitution, and neither is promoted to a match.
    expect(relation('grok-4', null)).toBe('unknown');
    expect(relation('grok-4', '   ')).toBe('unknown');
    expect(relation(null, 'grok-4')).toBe('unrequested');
    expect(relation(null, null)).toBe('unknown');
    for (const r of ['unknown', 'unrequested'] as const) {
      expect(MODEL_IDENTITY_RELATIONS).toContain(r);
    }
  });

  it('is the same rule the xAI harness guard uses', () => {
    /**
     * ONE MEANS. `modelMatchesVerified` had its own exact-match copy of this
     * rule with no production caller, and the mission leg then wrote a second
     * inline copy and got the same thing wrong. Both delegate here now, so a
     * resolution is accepted in both or refused in both.
     */
    expect(modelMatchesVerified('gpt-4o', 'gpt-4o-2024-08-06').ok).toBe(true);
    expect(modelMatchesVerified('grok-4', 'grok-3-mini').ok).toBe(false);
    // Unknown stays Unknown here too.
    expect(modelMatchesVerified('grok-4', null).ok).toBe(true);
    // And a missing VERIFIED id is still a failure: this function exists to
    // compare against a verified model, and having none is not agreement.
    expect(modelMatchesVerified(null, 'grok-4').ok).toBe(false);
  });
});
