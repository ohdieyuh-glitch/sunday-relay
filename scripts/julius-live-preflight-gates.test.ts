import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  LIVE_BRANCH,
  LIVE_PREFLIGHT_VERDICTS,
  LIVE_REF,
  evaluateLivePreflight,
  parseGateLine,
} from './julius-live-preflight-gates.mjs';

/**
 * THE QUESTION A RUN HAS TO ASK.
 *
 * The provenance and monotonicity gates describe `main`. Neither can tell you
 * whether the job about to execute is running that commit, and a job running a
 * different one has verified code it is not going to execute.
 */

const MAIN = '1'.repeat(40);
const OTHER = '2'.repeat(40);

const gate = (verdict: string, over: Record<string, unknown> = {}) =>
  ({ exitCode: 0, verdict, mainSha: MAIN, reason: 'fine', ...over });
const failing = (verdict: string, over: Record<string, unknown> = {}) =>
  ({ exitCode: 1, verdict, mainSha: MAIN, reason: 'because', ...over });

/** The passing shape. Every case below spoils exactly one part of it. */
const preflight = (over: Record<string, unknown> = {}) => evaluateLivePreflight({
  repository: 'owner/repo',
  branch: LIVE_BRANCH,
  ref: LIVE_REF,
  workflowSha: MAIN,
  frozenMainSha: MAIN,
  provenance: gate('provenant'),
  monotonicity: gate('monotonic', { accepted: 1 }),
  finalMainSha: MAIN,
  ...over,
});

describe('live preflight', () => {
  it('passes only when every invariant is simultaneously true', () => {
    const result = preflight();
    expect(result.verdict).toBe('pass');
    expect(result.frozenMainSha).toBe(MAIN);
    expect(result.workflowSha).toBe(MAIN);
    expect(result.ref).toBe('refs/heads/main');
    expect(result.provenance).toBe('provenant');
    expect(result.monotonicity).toBe('monotonic');
    expect(result.acceptedCheckpoints).toBe(1);
    expect(result.finalMainSha).toBe(MAIN);
  });

  it('names every fact it passed on, so the reason is checkable', () => {
    expect(preflight().reason).toContain(MAIN);
    expect(preflight().reason).toContain('provenant and monotonic');
  });

  it('there is one passing verdict and it is named', () => {
    expect(LIVE_PREFLIGHT_VERDICTS.filter((name) => name !== 'pass'))
      .toEqual(['blocked', 'indeterminate']);
    expect(LIVE_REF).toBe('refs/heads/main');
  });

  it('is reachable as a gate', () => {
    const scripts = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8')) as
      { scripts: Record<string, string> };
    expect(scripts.scripts['julius:live-preflight'])
      .toContain('scripts/julius-live-preflight-gates.mjs');
  });
});

/**
 * THE BRANCH AND COMMIT BINDING.
 *
 * Everything the two gates establish is about `main`. If the job runs for a
 * different ref, or executes a different commit, those facts describe code that
 * is not about to run.
 */
describe('binding the job to what was verified', () => {
  it('branch main with refs/heads/main is the only pair that passes', () => {
    expect(preflight({ branch: 'main', ref: 'refs/heads/main' }).verdict).toBe('pass');
  });

  it('a caller cannot legitimise another branch by being consistent about it', () => {
    // THE BUG THIS REPLACED. An earlier revision built the expected ref out of
    // the supplied branch, so any self-consistent pair satisfied it. Everything
    // else here is perfect: the commit is the frozen tip, both gates pass on it,
    // and main never moves. Only the branch is wrong, and that is enough.
    const consistent = preflight({ branch: 'relay/anything', ref: 'refs/heads/relay/anything' });
    expect(consistent.verdict).toBe('blocked');
    expect(consistent.reason).toContain('may only run from main');
  });

  it('and cannot get there by naming main while running elsewhere, or the reverse', () => {
    expect(preflight({ branch: 'relay/anything', ref: 'refs/heads/main' }).verdict).toBe('blocked');
    expect(preflight({ branch: 'main', ref: 'refs/heads/relay/anything' }).verdict).toBe('blocked');
  });

  it('a branch that cannot be read fails closed', () => {
    for (const branch of [undefined, null, '', 42, ['main'], { branch: 'main' }, true]) {
      const result = preflight({ branch });
      expect(result.verdict, String(branch)).toBe('indeterminate');
      expect(result.reason).toContain('could not be read');
    }
  });

  it('a branch that merely resembles main is not main', () => {
    for (const branch of ['Main', 'MAIN', 'main ', ' main', 'mainline', 'refs/heads/main', 'origin/main']) {
      expect(preflight({ branch }).verdict, branch).toBe('blocked');
    }
  });

  it('another ref fails even when its commit is a perfectly valid one', () => {
    // The commit is the real `main` tip and both gates passed on it. The job
    // still runs for a ref a live mission may not run from.
    const elsewhere = preflight({ ref: 'refs/heads/relay/anything' });
    expect(elsewhere.verdict).toBe('blocked');
    expect(elsewhere.reason).toContain('not refs/heads/main');
  });

  it('a near-miss ref is not the ref', () => {
    // Suffix and prefix matching are both wrong, and each of these is the kind
    // of near-miss that would slip past one of them.
    for (const ref of ['refs/heads/mainline', 'refs/tags/main', 'main', 'heads/main',
      'refs/heads/main ', 'refs/remotes/origin/main', '']) {
      expect(preflight({ ref }).verdict, ref || '(empty)').toBe('blocked');
    }
    for (const ref of [undefined, null, 42, ['refs/heads/main']]) {
      expect(preflight({ ref }).verdict, String(ref)).toBe('blocked');
    }
  });

  it('the correct ref with the WRONG commit fails', () => {
    // The hazard this exists for: gates vouch for `main`, the job executes
    // something else.
    const mismatched = preflight({ workflowSha: OTHER });
    expect(mismatched.verdict).toBe('blocked');
    expect(mismatched.reason).toContain('is not the main tip');
  });

  it('a malformed job commit fails', () => {
    // Uppercase hex is not a sha here: git object ids are lowercase, and a
    // case-insensitive comparison would accept a value the API never emits.
    // (`MAIN` is all digits, so `toUpperCase` on it would test nothing.)
    for (const sha of [undefined, null, '', 'not-a-sha', 'A'.repeat(40), `${MAIN}x`, MAIN.slice(0, 39), 42]) {
      expect(preflight({ workflowSha: sha }).verdict, String(sha)).toBe('blocked');
    }
  });

  it('an unreadable main is indeterminate, not merely blocked', () => {
    // "We could not read the branch" and "the branch is wrong" call for
    // different actions.
    for (const sha of [undefined, null, '', 'not-a-sha', 42]) {
      const result = preflight({ frozenMainSha: sha });
      expect(result.verdict, String(sha)).toBe('indeterminate');
      expect(result.reason).toContain('could not be read');
    }
  });
});

/**
 * THE GATES ARE CONSUMED, NOT TRUSTED.
 *
 * Each one reports both an exit status and a verdict, and the pair has to agree
 * and has to be about the frozen commit. A gate that contradicts itself has been
 * altered, wrapped or misread, and reading past it means choosing which half to
 * believe.
 */
describe('reading the two gates', () => {
  it('provenance failing blocks even when monotonicity passes', () => {
    for (const [reported, expected] of [
      ['unprovenanced', 'blocked'],
      ['indeterminate', 'indeterminate'],
    ] as const) {
      const result = preflight({ provenance: failing(reported) });
      expect(result.verdict, reported).toBe(expected);
      expect(result.reason).toContain(`provenance is ${reported}`);
    }
  });

  it('monotonicity failing blocks even when provenance passes', () => {
    for (const [reported, expected] of [
      ['regressed', 'blocked'],
      ['uninitialized', 'blocked'],
      ['indeterminate', 'indeterminate'],
    ] as const) {
      const result = preflight({ monotonicity: failing(reported) });
      expect(result.verdict, reported).toBe(expected);
      expect(result.reason).toContain(`monotonicity is ${reported}`);
    }
  });

  it('a gate that contradicts itself is not evidence', () => {
    // Exit 0 with a failing verdict, and a non-zero exit with the passing one.
    // Either is a gate that has been tampered with or misparsed.
    expect(preflight({ provenance: gate('unprovenanced') }).verdict).toBe('indeterminate');
    expect(preflight({ provenance: { ...failing('provenant') } }).verdict).toBe('indeterminate');
    expect(preflight({ monotonicity: gate('regressed') }).verdict).toBe('indeterminate');
    expect(preflight({ monotonicity: { ...failing('monotonic') } }).verdict).toBe('indeterminate');
    expect(preflight({ provenance: gate('unprovenanced') }).reason).toContain('contradicted itself');
  });

  it('a gate whose output could not be read is not a gate that passed', () => {
    for (const broken of [undefined, null, 'unavailable', 42, [],
      { exitCode: 0 }, { verdict: 'provenant' }, { exitCode: '0', verdict: 'provenant', mainSha: MAIN }]) {
      expect(preflight({ provenance: broken }).verdict, JSON.stringify(broken)).toBe('indeterminate');
    }
  });

  it('a gate report about a DIFFERENT commit answers a different question', () => {
    // Both gates passing on two different states of the branch would look like
    // agreement. Binding each report to the frozen sha is what stops that.
    const drifted = preflight({ provenance: gate('provenant', { mainSha: OTHER }) });
    expect(drifted.verdict).toBe('indeterminate');
    expect(drifted.reason).toContain('not the frozen');
    expect(preflight({ monotonicity: gate('monotonic', { mainSha: OTHER }) }).verdict).toBe('indeterminate');
    expect(preflight({ monotonicity: gate('monotonic', { mainSha: undefined }) }).verdict).toBe('indeterminate');
  });
});

/**
 * ORDERING IS PART OF THE CONTRACT.
 *
 * The re-read happens after both gates and before any pass. A branch that
 * advanced while they ran leaves two true reports about a commit that is no
 * longer the tip.
 */
describe('the frozen epoch', () => {
  it('both gates passing but main moving before the final read blocks', () => {
    const moved = preflight({ finalMainSha: OTHER });
    expect(moved.verdict).toBe('indeterminate');
    expect(moved.reason).toContain('moved during the preflight');
    expect(moved.finalMainSha).toBe(OTHER);
  });

  it('a main that could not be re-read at all is equally unproven', () => {
    for (const sha of [undefined, null, '', 'not-a-sha']) {
      const result = preflight({ finalMainSha: sha });
      expect(result.verdict, String(sha)).toBe('indeterminate');
      expect(result.reason).toContain('held still');
    }
  });

  it('the re-read is required even when everything else is perfect', () => {
    // If the final read were optional, a caller could omit it and pass.
    expect(preflight({ finalMainSha: undefined }).verdict).not.toBe('pass');
  });

  it('a failing gate is reported before the re-read is even consulted', () => {
    // The gate result is the more specific fact, and reporting "main moved"
    // for a branch that is also unprovenanced would name the wrong problem.
    const both = preflight({ provenance: failing('unprovenanced'), finalMainSha: OTHER });
    expect(both.verdict).toBe('blocked');
    expect(both.reason).toContain('provenance is unprovenanced');
  });

  it('every verdict other than pass blocks', () => {
    for (const result of [
      preflight({ branch: 'relay/anything', ref: 'refs/heads/relay/anything' }),
      preflight({ branch: undefined }),
      preflight({ ref: 'refs/heads/other' }),
      preflight({ workflowSha: OTHER }),
      preflight({ provenance: failing('unprovenanced') }),
      preflight({ monotonicity: failing('regressed') }),
      preflight({ monotonicity: failing('uninitialized') }),
      preflight({ finalMainSha: OTHER }),
      preflight({ frozenMainSha: 'nope' }),
    ]) {
      expect(result.verdict).not.toBe('pass');
      expect(LIVE_PREFLIGHT_VERDICTS).toContain(result.verdict);
    }
  });
});

/**
 * READING A GATE'S LINE.
 *
 * Both gates emit `key=value ... reason=<free text>`. The parser is separate and
 * tested because a gate whose output cannot be read must become
 * `indeterminate`, never a silent pass.
 */
describe('parsing a gate line', () => {
  const provenanceLine = 'repo=owner/repo branch=main provenance=provenant'
    + ` main=${MAIN} tree=abc pr=230 reviewed_head=def approved_by=ohdieyuh-glitch`
    + ' reason=main 1111 carries the tree of 2222, approved by someone';

  it('reads the verdict, the commit and the free-text reason', () => {
    const parsed = parseGateLine(provenanceLine, 'provenance');
    expect(parsed?.verdict).toBe('provenant');
    expect(parsed?.mainSha).toBe(MAIN);
    expect(parsed?.reason).toContain('carries the tree of');
  });

  it('reads the accepted count from the monotonicity line', () => {
    const parsed = parseGateLine(
      `repo=owner/repo branch=main monotonicity=monotonic main=${MAIN} accepted=3 missing=0 reason=fine`,
      'monotonicity',
    );
    expect(parsed?.verdict).toBe('monotonic');
    expect(parsed?.accepted).toBe(3);
  });

  it('finds the line among other output, and takes the last one', () => {
    expect(parseGateLine(`noise\n${provenanceLine}\nmore noise`, 'provenance')?.verdict).toBe('provenant');
    expect(parseGateLine(`x provenance=stale main=${MAIN} reason=a\nx provenance=provenant main=${MAIN} reason=b`, 'provenance')?.verdict)
      .toBe('provenant');
  });

  it('returns null when the verdict key is absent, which fails closed', () => {
    for (const text of ['', 'nothing useful', 'monotonicity=monotonic', undefined, null, 42]) {
      expect(parseGateLine(text, 'provenance'), String(text)).toBeNull();
    }
    // And null reaches the kernel as indeterminate rather than as a pass.
    expect(preflight({ provenance: { exitCode: 0 } }).verdict).toBe('indeterminate');
  });

  it('a line with no reason is still readable', () => {
    const parsed = parseGateLine(`provenance=unprovenanced main=${MAIN}`, 'provenance');
    expect(parsed?.verdict).toBe('unprovenanced');
    expect(parsed?.reason).toBe('');
  });
});

/**
 * WHAT THIS FILE MAY NOT DO.
 *
 * It runs immediately before a job that can spend money, from a checkout chosen
 * precisely because it is trusted. A verifier that could act is not a verifier.
 */
describe('the helper is a question, not an action', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'julius-live-preflight-gates.mjs'), 'utf8');

  it('imports no provider SDK and no network client beyond gh', () => {
    const imports = [...source.matchAll(/from '([^']+)'/gu)].map((m) => m[1]!);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      expect(specifier, `${specifier} is not a node builtin or a sibling gate`)
        .toMatch(/^(node:[a-z_/]+|\.\/julius-[a-z-]+\.mjs)$/u);
    }
    for (const forbidden of ['anthropic', 'openai', 'undici', 'axios', 'node-fetch', '@ai-sdk']) {
      expect(source.toLowerCase(), `${forbidden} has no business here`).not.toContain(forbidden);
    }
  });

  it('never mutates GitHub state', () => {
    // Every `gh api` it makes is a plain GET. A verb flag, a dispatch or a
    // marker write would make this something other than a question.
    expect(source).not.toMatch(/'-X'|"-X"|--method/u);
    expect(source).not.toContain('dispatches');
    expect(source).not.toContain('upload-artifact');
    expect(source).not.toMatch(/\bstatuses\/\$\{/u);
  });

  it('compares the ref against the constant, never against caller input', () => {
    // Behaviourally this is belt and braces: with the branch locked to `main`,
    // `refs/heads/${branch}` and LIVE_REF are the same string, so a mutation
    // that derives the ref changes nothing and no behavioural test can catch
    // it. What it WOULD do is survive a later change that relaxes the branch
    // lock, and quietly restore the bug this revision fixed — a self-consistent
    // pair legitimising any branch. So the form is pinned here directly.
    expect(source).toContain('ref !== LIVE_REF');
    expect(source).not.toMatch(/refs\/heads\/\$\{branch\}/u);
    expect(source).toContain('branch !== LIVE_BRANCH');
  });

  it('resolves the sibling gates beside itself, not from the working tree', () => {
    // The whole point: run from a trusted checkout, judge a different commit.
    expect(source).toContain('import.meta.dirname');
    expect(source).toContain('join(here, script)');
    expect(source).not.toMatch(/process\.cwd\(\)/u);
    // And the commands themselves are literals, so the boundary scanner can
    // read what this file runs rather than having to trust it.
    expect(source).toMatch(/execFileSync\('gh', argv/u);
    expect(source).toMatch(/execFileSync\('node', argv/u);
  });
});
