import { afterEach, describe, it, expect } from 'vitest';
import { runCodingMission } from './coding';
import { resolveClaudeRuntime } from './claude-runtime';
import { createRandomIdFactory } from '../src/relay/protocol/ids';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFakeClaude } from '../src/relay/connectors/claude-code/fake-executable';
import { CLAIMED_FILE, REFERENCE_IMPLEMENTATION, TEST_FILE } from '../src/relay/connectors/claude-code/fixture';
import type { BridgeEventInput, CodingTerminalState } from './types';
import { actorMatches, isPaidApiCall } from './attestation';
import { findOccupant, type RoleOccupant } from '../src/relay/mission/role-slots';
import {
  createRepositoryRegistration,
  resolveRepositoryTarget,
} from '../src/relay/mission/repository-target';

/** A fixed instant for the registration fixtures. */
const AT = '2026-08-11T12:00:00.000Z';

/**
 * CODING LEG — OFFLINE END-TO-END.
 *
 * Runs the entire coding leg against the repo's own fake Claude executable:
 * a real child process, a real isolated Git worktree, a real file edit, a
 * real Relay inspection, a real `node --test` verification, and a real
 * captured diff — with NO model provider, no network, and no spend.
 *
 * This is the proof that the terminal shows the same single execution that
 * did the work: one process, one stream, and every terminal fact traceable
 * to something that actually happened in this run.
 */

/** The synthetic capability profile the fake runtime advertises. */
const fakeCapabilities = (now: () => string) => {
  const resolved = resolveClaudeRuntime('fake', now, true);
  if (!resolved.ok) throw new Error('fake runtime unavailable');
  return resolved.runtime.capabilities;
};

const runOffline = async (over: Partial<Parameters<typeof runCodingMission>[0]> = {}) => {
  const now = () => new Date().toISOString();
  const runtime = resolveClaudeRuntime('fake', now, true);
  expect(runtime.ok).toBe(true);
  if (!runtime.ok) throw new Error('fake runtime unavailable');

  const events: BridgeEventInput[] = [];
  const snapshots: CodingTerminalState[] = [];

  const outcome = await runCodingMission({
    handoff: {
      objective: 'Implement normalizeProjectName so the existing tests pass.',
      instructions: ['Trim, lowercase, and collapse separators.'],
      acceptanceCriteria: ['The existing test suite passes when Relay runs it.'],
      constraints: ['Edit only the claimed file.'],
    },
    executablePath: runtime.runtime.executablePath,
    capabilities: runtime.runtime.capabilities,
    now,
    ids: createRandomIdFactory(),
    emit: (e) => events.push(e),
    publishTerminal: (t) => snapshots.push(t),
    projectLabel: 'Relay controlled fixture (throwaway repository)',
    ...over,
  });

  return { outcome, events, snapshots, final: snapshots[snapshots.length - 1] };
};

describe('the terminal is powered by the one process that did the work', () => {
  it('captures a complete, truthful terminal from a single offline invocation', async () => {
    const { outcome, final } = await runOffline();

    expect(outcome.stopped).toBe(false);
    expect(outcome.verificationPassed).toBe(true);
    expect(final).toBeDefined();

    // ---- one process, one stream
    const sessionLines = final.lines.filter((l) => l.kind === 'session' && /session started/i.test(l.text));
    expect(sessionLines.length).toBeGreaterThanOrEqual(1);
    const processLines = final.lines.filter((l) => l.kind === 'process');
    expect(processLines).toHaveLength(1);
    expect(final.status).toBe('complete');

    // ---- ordering is monotonic and gapless (this is what survives refresh)
    expect(final.lines.map((l) => l.sequence)).toEqual(final.lines.map((_, i) => i));

    // ---- real timing
    expect(final.startedAt).toBeTruthy();
    expect(final.endedAt).toBeTruthy();
    expect(Date.parse(final.endedAt as string)).toBeGreaterThanOrEqual(Date.parse(final.startedAt as string));

    // ---- REAL changed file from Relay inspection (not the claim)
    expect(final.changedFiles).toEqual(['src/normalize.js']);

    // ---- REAL captured diff, read from the isolated worktree
    expect(final.diff).toBeTruthy();
    expect(final.diff).toContain('src/normalize.js');
    expect(final.diff).toContain('normalizeProjectName');

    // ---- REAL verification Relay ran itself
    expect(final.test?.command).toBe('node --test test/normalize.test.js');
    expect(final.test?.status).toBe('passed');
    expect(final.test?.exitCode).toBe(0);
    expect(final.test?.output).toBeTruthy();

    // ---- the agent's report is stored as a CLAIM
    expect(final.claim).not.toBeNull();
    expect(final.lines.some((l) => l.kind === 'claim' && l.truth === 'agent_claim')).toBe(true);

    // ---- Relay's own findings are stored as EVIDENCE
    expect(final.lines.some((l) => l.kind === 'inspection' && l.truth === 'relay_evidence')).toBe(true);
    expect(final.lines.some((l) => l.kind === 'verification' && l.truth === 'relay_evidence')).toBe(true);

    // ---- attestation reflects the process that actually ran
    expect(final.attestation?.launchVerified).toBe(true);
    expect(final.attestation?.completionVerified).toBe(true);
    expect(final.attestation?.fallbackOccurred).toBe(false);
    expect(final.attestation?.billingPath).toBe('subscription');

    // ---- permissions are the compiled envelope, not a description
    expect(final.permissions.allowedFiles).toEqual(['src/normalize.js']);
    expect(final.permissions.protectedPaths).toContain('package.json');
    expect(final.permissions.deniedCapabilities).toContain('Bash');
    // From the attestation, not a literal beside it: the local CLI runs on the
    // founder's subscription, and a hosted API-billed run would say so instead.
    expect(final.billing).toBe('subscription');
    expect(final.billing).toBe(final.attestation?.billingPath);
  }, 120_000);

  it('leaks no secret, absolute path, or full session id into the captured terminal', async () => {
    const { final } = await runOffline();
    const serialized = JSON.stringify(final);
    expect(serialized).not.toContain('/home/');
    expect(serialized).not.toContain('/tmp/relay-claude-fixture');
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/);
    expect(serialized).not.toContain(String.fromCharCode(27));
    // The provider session id is only ever present as a redacted tail.
    expect(serialized).not.toContain('bridge-fake-session');
    expect(final.externalSessionRedacted).toMatch(/^…/);
  }, 120_000);

  it('publishes progressively, so a poll mid-run sees a live terminal', async () => {
    const { snapshots } = await runOffline();
    expect(snapshots.length).toBeGreaterThan(3);
    // The first published snapshot is already an honest live state.
    const firstLive = snapshots.find((s) => s.status === 'live');
    expect(firstLive).toBeDefined();
    expect(firstLive?.test).toBeNull();
    expect(firstLive?.diff).toBeNull();
    // Snapshots only ever grow — no line is ever rewritten or removed.
    const lengths = snapshots.map((s) => s.lines.length);
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeGreaterThanOrEqual(lengths[i - 1]);
  }, 120_000);
});

describe('cancellation stops the run without claiming anything', () => {
  it('a cancel requested before the agent starts never launches a process', async () => {
    const { outcome, final, snapshots } = await runOffline({ isCancelRequested: () => true });
    expect(outcome.cancelled).toBe(true);
    expect(outcome.stopped).toBe(true);
    expect(outcome.verifiedComplete).toBe(false);
    expect(outcome.claim).toBeNull();
    // Nothing was captured because nothing ran — no fabricated terminal.
    expect(snapshots).toHaveLength(0);
    expect(final).toBeUndefined();
  }, 120_000);
});

/**
 * REQUESTED AND ACTUAL ARE TWO FIELDS BECAUSE THEY CAN DIFFER.
 *
 * The attestation used to write `requestedActor: 'Claude Code'`,
 * `actualActor: 'Claude Code'` and `billingPath: 'subscription'` as literals
 * three lines apart. That was merely redundant while one runtime could ever
 * hold the slot, and a misreport the moment a second one could: a hosted
 * Agent-SDK run is API-billed, so `subscription` names the wrong payer.
 *
 * The REQUESTED half now comes from the occupant the mission bound. The ACTUAL
 * half stays what this leg observed — the adapter it really drove.
 */
describe('the coding attestation separates who was asked for from what ran', () => {
  it('takes the requested identity from the bound occupant', async () => {
    const { outcome } = await runOffline({
      requestedOccupant: {
        actorName: 'Claude Agent SDK',
        adapterId: 'claude-agent-sdk-hosted',
        billingPath: 'api',
      },
    });
    const attestation = outcome.attestation;
    expect(attestation).not.toBeNull();
    expect(attestation?.requestedActor).toBe('Claude Agent SDK');
    expect(attestation?.requestedRuntime).toBe('claude-agent-sdk-hosted');
    // `api` in the registry's vocabulary is `api_billed` in the attestation's,
    // which is the value `isPaidApiCall` tests for.
    expect(attestation?.billingPath).toBe('api_billed');

    // AND THE ACTUAL HALF DOES NOT FOLLOW IT. This leg drove the Claude Code
    // adapter, so that is what it attests — which is exactly the mismatch a
    // founder must be able to see. (The mission refuses this combination
    // before it can happen; the fields still have to tell the truth if it did.)
    expect(attestation?.actualActor).toBe('Claude Code');
    expect(attestation?.actualRuntime).toBe('claude-code-local');
  }, 30_000);

  /**
   * THE REGRESSION BARRIER. The vocabulary split — `requestedActor` from the
   * registry's UI label, `actualActor` from the adapter — made `actorMatches`
   * false on every ordinary local mission, and a whole bridge suite stayed
   * green with the defect present. This binds the two halves through the REAL
   * registry occupant, so a wrong `actorName` fails here rather than shipping.
   */
  it('reports the shipped local occupant as the actor that actually ran', async () => {
    const local = findOccupant('coding_agent', 'claude_code_local') as RoleOccupant;
    const { outcome } = await runOffline({
      requestedOccupant: {
        actorName: local.actorName,
        adapterId: local.adapterId,
        billingPath: local.billingPath as 'subscription',
      },
    });
    expect(outcome.attestation).not.toBeNull();
    expect(actorMatches(outcome.attestation ?? undefined)).toBe(true);
  }, 30_000);

  /** A run that spends nothing is `simulated`, never a payer. */
  it('attests the offline pipeline as simulated rather than subscription-paid', async () => {
    const fake = findOccupant('coding_agent', 'claude_code_fake') as RoleOccupant;
    expect(fake.billingPath).toBe('none');
    const { outcome } = await runOffline({
      requestedOccupant: {
        actorName: fake.actorName,
        adapterId: fake.adapterId,
        billingPath: fake.billingPath as 'none',
      },
    });
    expect(outcome.attestation?.billingPath).toBe('simulated');
    expect(isPaidApiCall(outcome.attestation ?? undefined)).toBe(false);
  }, 30_000);

  /**
   * `launchVerified` IS OBSERVED, NOT INFERRED. It was `!launchFailed` — the
   * absence of an error — so a run that never started was attested as launched
   * and the website then rendered it API PAID.
   */
  it('does not attest a launch the surface never observed', async () => {
    const { outcome } = await runOffline({
      invokeAgent: async () => ({
        outcome: {
          startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z',
          cancelled: true, timedOut: false, launchFailed: false, launchObserved: false,
        },
        events: [], sessionId: null,
        structurallyValid: false, structuralReason: 'cancelled during startup',
        report: { ok: false, error: { code: 'invalid-report', message: 'x' } } as never,
        actualActor: 'Claude Agent SDK', actualRuntimeId: 'claude-agent-sdk-hosted',
        actualModel: null,
      }),
      requestedOccupant: {
        actorName: 'Claude Agent SDK', adapterId: 'claude-agent-sdk-hosted', billingPath: 'api',
      },
    });
    expect(outcome.attestation?.launchVerified).toBe(false);
    // And therefore not a paid call, which is what the browser reads.
    expect(isPaidApiCall(outcome.attestation ?? undefined)).toBe(false);
  }, 30_000);

  /**
   * THE LOCAL HALF OF THE SAME RULE. `launchObserved` was proven on the hosted
   * surface and left unheld on the local one — which is the surface that has
   * actually completed a real three-role mission. A stream with no init record
   * is a process that never announced itself.
   */
  it('does not observe a launch from a local stream that never initialised', async () => {
    // THE REAL LOCAL INVOKER, not an injected one — an injected invoker would
    // prove only that the field is passed through, and the mutation that
    // forced it true survived exactly that test.
    const now = () => new Date().toISOString();
    const dir = mkdtempSync(join(tmpdir(), 'relay-no-init-'));
    try {
      const exe = writeFakeClaude(dir, {
        scenario: 'no_init',
        sessionId: 'no-init-session', taskId: 'tsk', runId: 'run',
        editPath: CLAIMED_FILE, editContent: REFERENCE_IMPLEMENTATION,
      });
      const events: BridgeEventInput[] = [];
      const outcome = await runCodingMission({
        handoff: {
          objective: 'Implement normalizeProjectName so the existing tests pass.',
          instructions: ['Trim, lowercase, and collapse separators.'],
          acceptanceCriteria: ['The existing test suite passes when Relay runs it.'],
          constraints: ['Edit only the claimed file.'],
        },
        executablePath: exe,
        capabilities: fakeCapabilities(now),
        now,
        ids: createRandomIdFactory(),
        emit: (e) => events.push(e),
      });
      expect(outcome.attestation?.launchVerified).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('falls back to the local identity when no occupant is supplied', async () => {
    // Every caller that predates role slots drove this same adapter, so that
    // is what it was requesting.
    const { outcome } = await runOffline();
    expect(outcome.attestation?.requestedActor).toBe('Claude Code');
    expect(outcome.attestation?.requestedRuntime).toBe('claude-code-local');
    expect(outcome.attestation?.billingPath).toBe('subscription');
  }, 30_000);
});

/* ============ the coding leg against a REAL registered repository ============ */

/**
 * THE THIRD THING `REPOSITORY_TARGETS.md` LISTED AS NOT BUILT.
 *
 * The authorization spine, the observation layer and the shipping lifecycle all
 * existed and nothing in the bridge read a `MissionRepositoryTarget` — so every
 * hosted Mission Relay had ever run edited the same four-file throwaway fixture.
 *
 * This is the same coding leg, the same fake Claude, the same isolated worktree,
 * the same Relay inspection and the same `node --test` — pointed at a REAL git
 * repository created on disk by this test. No provider, no network, no spend.
 */
describe('the coding leg can target a real registered repository', () => {
  const temporaries: string[] = [];
  afterEach(() => {
    for (const path of temporaries.splice(0)) {
      try { rmSync(path, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });

  /** A real repository whose test suite fails until the agent edits one file. */
  function realProject(): string {
    const root = mkdtempSync(join(tmpdir(), 'relay-real-project-'));
    temporaries.push(root);
    const git = (args: string[]) => execFileSync('git', args, {
      cwd: root,
      env: {
        PATH: process.env.PATH ?? '', HOME: root,
        GIT_AUTHOR_NAME: 'F', GIT_AUTHOR_EMAIL: 'f@x',
        GIT_COMMITTER_NAME: 'F', GIT_COMMITTER_EMAIL: 'f@x',
      },
    });
    git(['init', '--quiet', '--initial-branch=main']);
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'test'), { recursive: true });
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(root, 'src', 'greet.js'), 'module.exports = { greet: () => "" };\n');
    writeFileSync(
      join(root, 'test', 'greet.test.js'),
      'const { test } = require("node:test");\n'
      + 'const assert = require("node:assert");\n'
      + 'const { greet } = require("../src/greet.js");\n'
      + 'test("greets", () => { assert.strictEqual(greet(), "hello"); });\n',
    );
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'real-project', version: '1.0.0' }, null, 2));
    writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
    git(['add', '--', '.']);
    git(['commit', '-m', 'failing baseline']);
    return root;
  }

  /**
   * A real repository whose VERIFICATION TEST lives where Relay runs it —
   * `test/normalize.test.js`, the path `RELAY_TEST_ARGS` hardcodes. The stub
   * fails; the fake agent edits `src/normalize.js` to the reference and the run
   * PASSES verification. `realProject()` above uses a different test path, so it
   * never passes and never exercises retention. Without this project the
   * retention-on-success path has no test.
   */
  const NORMALIZE_TEST = [
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    "const { normalizeProjectName } = require('../src/normalize.js');",
    "test('lowercases with hyphens', () => {",
    "  assert.strictEqual(normalizeProjectName('  My Project  '), 'my-project');",
    "});",
    '',
  ].join('\n');

  function verifiableProject(): string {
    const root = mkdtempSync(join(tmpdir(), 'relay-verifiable-'));
    temporaries.push(root);
    const git = (args: string[]) => execFileSync('git', args, {
      cwd: root,
      env: { PATH: process.env.PATH ?? '', HOME: root, GIT_AUTHOR_NAME: 'F', GIT_AUTHOR_EMAIL: 'f@x', GIT_COMMITTER_NAME: 'F', GIT_COMMITTER_EMAIL: 'f@x' },
    });
    git(['init', '--quiet', '--initial-branch=main']);
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'test'), { recursive: true });
    // The stub that FAILS the test — the agent must fix it.
    writeFileSync(join(root, 'src', 'normalize.js'), 'module.exports = { normalizeProjectName: () => "" };\n');
    writeFileSync(join(root, TEST_FILE), NORMALIZE_TEST);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'verifiable', version: '1.0.0' }));
    git(['add', '--', '.']);
    git(['commit', '-m', 'failing baseline']);
    return root;
  }

  function verifiableTarget(root: string) {
    const grants = (['read', 'write_worktree', 'commit'] as const).map((permission) => ({
      permission, authorizedBy: 'founder', authorizedAt: AT, expiresAt: null, note: null,
    }));
    const registration = createRepositoryRegistration({
      draft: {
        identity: { provider: 'local', host: null, owner: null, name: 'verifiable', defaultBranch: 'main' },
        location: { kind: 'local_path', path: root },
        scope: { read: ['**'], write: ['src/**'] },
        grants,
        ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
        registeredBy: 'founder',
      },
      now: AT,
    });
    if (!registration.ok) throw new Error(registration.error.message);
    const resolved = resolveRepositoryTarget({
      registration: registration.value,
      request: { repositoryKey: 'local:verifiable', selectedBy: 'founder', selectedAt: AT, workingBranch: 'relay/mission-real', permissions: grants.map((g) => g.permission) },
      now: AT,
    });
    if (!resolved.ok) throw new Error(resolved.error.message);
    return resolved.target;
  }

  function registeredTarget(root: string) {
    const grants = (['read', 'write_worktree', 'commit'] as const).map((permission) => ({
      permission, authorizedBy: 'founder', authorizedAt: AT, expiresAt: null, note: null,
    }));
    const registration = createRepositoryRegistration({
      draft: {
        identity: { provider: 'local', host: null, owner: null, name: 'real-project', defaultBranch: 'main' },
        location: { kind: 'local_path', path: root },
        scope: { read: ['**'], write: ['src/**'] },
        grants,
        ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
        registeredBy: 'founder',
      },
      now: AT,
    });
    if (!registration.ok) throw new Error(registration.error.message);
    const resolved = resolveRepositoryTarget({
      registration: registration.value,
      request: {
        repositoryKey: 'local:real-project', selectedBy: 'founder', selectedAt: AT,
        workingBranch: 'relay/mission-real', permissions: grants.map((g) => g.permission),
      },
      now: AT,
    });
    if (!resolved.ok) throw new Error(resolved.error.message);
    return resolved.target;
  }

  it('edits the REAL repository in an isolated worktree and leaves the source untouched', async () => {
    const root = realProject();
    const target = registeredTarget(root);
    const before = readFileSync(join(root, 'src', 'greet.js'), 'utf8');

    const { outcome } = await runOffline({
      repositoryTarget: target,
      intendedWritePaths: ['src/greet.js'],
      handoff: {
        objective: 'Make greet() return "hello".',
        instructions: ['Return the string "hello" from greet.'],
        acceptanceCriteria: ['The existing test suite passes when Relay runs it.'],
        constraints: ['Edit only the declared file.'],
      },
      // The repo's own fake Claude, told to edit the REAL project's file.
      executablePath: writeFakeClaude(mkdtempSync(join(tmpdir(), 'relay-fake-claude-')), {
        scenario: 'success',
        sessionId: 'real-session', taskId: 'tsk', runId: 'run',
        editPath: 'src/greet.js',
        editContent: 'module.exports = { greet: () => "hello" };\n',
      }),
    } as never);

    // The baseline is the REAL repository's commit, not a fixture's.
    expect(outcome.evidence?.baseRevision).toMatch(/^[0-9a-f]{40}$/);

    /**
     * THE SOURCE REPOSITORY IS UNTOUCHED. This is the property the whole
     * worktree design exists for, and pointing Relay at a repository somebody
     * cares about is the first time it has ever mattered.
     */
    expect(readFileSync(join(root, 'src', 'greet.js'), 'utf8')).toBe(before);
    const status = execFileSync('git', ['status', '--porcelain=v1'], {
      cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: root },
    });
    expect(status.trim(), 'the founder\'s repository is dirty').toBe('');

    /**
     * NO LEAK ON FAILURE. This project's verification test lives at a different
     * path than the one Relay runs, so the run does NOT pass verification — and
     * a real-target run that did not verify must retain NOTHING, or every failed
     * mission would leave a worktree behind forever.
     */
    expect(outcome.verificationPassed).toBe(false);
    expect(outcome.retainedWorktreePath).toBeNull();
  }, 120_000);

  it('refuses before starting an agent when the declared file is out of scope', async () => {
    const root = realProject();
    const { outcome } = await runOffline({
      repositoryTarget: registeredTarget(root),
      // `.github/**` is protected AND outside the `src/**` write scope.
      intendedWritePaths: ['.github/workflows/ci.yml'],
    } as never);
    expect(outcome.stopped).toBe(true);
    // Refused at the SOURCE, before a worktree, before a process, before spend.
    expect(outcome.stopReason ?? '').toMatch(/scope|protected/i);
    expect(outcome.evidence).toBeNull();
  }, 60_000);

  it('refuses a Mission that names no files at all', async () => {
    const root = realProject();
    const { outcome } = await runOffline({
      repositoryTarget: registeredTarget(root),
      intendedWritePaths: [],
    } as never);
    expect(outcome.stopped).toBe(true);
    expect(outcome.stopReason ?? '').toContain('must name the files it intends to write');
  }, 60_000);

  it('RETAINS the verified worktree of a real-target mission, ready to ship', async () => {
    /**
     * The ship prerequisite. A real-target mission that PASSES verification
     * keeps its worktree — `shipVerifiedMission` commits from it, and removing
     * it here would leave the ship committing a deleted directory. The retained
     * path exists, is not the source, and holds the edited-and-verified diff.
     */
    const root = verifiableProject();
    const { outcome } = await runOffline({
      repositoryTarget: verifiableTarget(root),
      intendedWritePaths: [CLAIMED_FILE],
      executablePath: writeFakeClaude(mkdtempSync(join(tmpdir(), 'relay-fake-claude-')), {
        scenario: 'success', sessionId: 'verif-session', taskId: 'tsk', runId: 'run',
        editPath: CLAIMED_FILE, editContent: REFERENCE_IMPLEMENTATION,
      }),
    } as never);

    expect(outcome.verificationPassed, 'the verifiable project must pass').toBe(true);
    expect(outcome.retainedWorktreePath).not.toBeNull();
    const wt = outcome.retainedWorktreePath as string;
    expect(existsSync(wt)).toBe(true);
    expect(wt).not.toBe(root);
    // The verified edit is in the retained worktree, uncommitted, ready to ship.
    expect(readFileSync(join(wt, 'src', 'normalize.js'), 'utf8')).toContain('normalizeProjectName');
    // And the founder's source is still clean.
    const status = execFileSync('git', ['status', '--porcelain=v1'], {
      cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: root },
    });
    expect(status.trim()).toBe('');
    // A retained worktree is disposed by the ship or teardown; clean it here.
    rmSync(wt, { recursive: true, force: true });
  }, 120_000);

  it('does NOT retain a worktree for a fixture mission', async () => {
    const { outcome } = await runOffline({});
    expect(outcome.retainedWorktreePath).toBeNull();
  }, 60_000);
});
