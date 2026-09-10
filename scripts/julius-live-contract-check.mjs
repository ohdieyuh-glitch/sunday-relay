#!/usr/bin/env node
/**
 * Refuses a first-live Mission Contract that is unbounded or aimed at the
 * wrong filesystem, BEFORE any provider is paid.
 *
 * The live entrypoint already validates the contract's SHAPE. What it cannot
 * know is deployment intent: that this particular mission is meant to be tiny,
 * to cost almost nothing, and to run in a throwaway directory rather than in
 * the Sunday Relay checkout. A live coding agent pointed at this repository
 * would be editing the very code that governs it, so the workspace check below
 * is the one that matters most.
 *
 * Reads only. Prints only the contract's own bounded fields — a Mission
 * Contract carries no credential, and nothing here would print one if it did.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/**
 * CEILINGS, PER MISSION, because a decision about one mission is not a decision
 * about the next one.
 *
 * The default is what this repository is willing to dispatch without anyone
 * deciding anything: five dollars and a single repair cycle. A mission may be
 * granted more, and the grant is written here against that mission's own
 * accounting namespace — so raising a ceiling is a visible, reviewable edit
 * naming exactly which mission it applies to.
 *
 * Raising the DEFAULT instead would have been a smaller diff and a much larger
 * change: every existing mission, and every mission written afterwards, would
 * silently inherit an authorisation nobody made for it.
 *
 * A namespace absent from this table gets the default. That is deliberate: a
 * new mission is bounded until someone says otherwise, rather than unbounded
 * until someone notices.
 */
const DEFAULT_LIMITS = Object.freeze({ spendUsd: 5, repairCycles: 1 });
/**
 * MIRRORS `ARCHITECT_OUTPUT_TOKEN_RESERVATION` in
 * `relay-bridge/julius/live-composition.ts`. This script is dependency-free by
 * design and cannot import a bundled module, so the number is repeated here and
 * `scripts/julius-first-live-mission.test.ts` holds the two to each other — a
 * silent drift would let a contract declare a ceiling the budget never reserved.
 */
const ARCHITECT_OUTPUT_TOKEN_RESERVATION = 20_000;
const MISSION_LIMITS = Object.freeze({
  // Founder decision, 2026-09-06: mission 2 gets a larger bounded budget for
  // its paid rerun. Its first paid attempt entered LIVE and did not complete,
  // and the repairs it needs cost more than one cycle allows.
  'julius-live-mission-2': Object.freeze({ spendUsd: 20, repairCycles: 3 }),
  // Founder decision, 2026-09-09: mission 3 gets the same bounded budget. It is
  // the run that has to exercise the repair loop and the Independent Reviewer
  // end to end, and one repair cycle cannot demonstrate a repair LINEAGE. The
  // ceiling is a bound and not a forecast — mission 2 spent $0.515 against this
  // same grant — and it authorises nothing on its own: the paid dispatch still
  // needs `confirm_live` typed by a human.
  //
  // Asked and answered rather than inferred. The mission's own contract already
  // declared 20/3, and the zero-spend preflight refused it (run 34396331071)
  // because a contract cannot grant itself a ceiling. That refusal was correct,
  // and the grant belongs here, named, where raising it is visible.
  'julius-live-mission-3': Object.freeze({ spendUsd: 20, repairCycles: 3 }),
  // Campaign decision, 2026-09-10, under the founder's standing authorisation to
  // run paid missions without asking per dispatch — bounded and named here
  // rather than assumed, because that authorisation removed the per-run
  // approval and not the ceiling.
  //
  // The same 20/3 as missions 2 and 3, and for the same reason: a mission that
  // must exercise the repair loop needs more than one cycle to show a repair
  // LINEAGE rather than a single retry. It is a BOUND, not a forecast — mission
  // 2 spent $0.515 against this grant and mission 3 spent $0.609 — and the
  // coder's own share is `floor(20 / (1 + 3))` = $5 under `julius-allocation.v1`,
  // which is what actually limits the one worker that can spend at scale.
  //
  // Mission 4 is a harder task than mission 3 (a domain module with nine
  // invariants, against a single resolver function), so more coder turns are
  // plausible; $5 of headroom against a $0.61 precedent is deliberate slack, not
  // an expectation.
  'julius-live-mission-4': Object.freeze({ spendUsd: 20, repairCycles: 3 }),
  //
  // MISSION 5 IS THE FIRST RAISE ARGUED FROM MEASUREMENT RATHER THAN CAUTION.
  //
  // Mission 4 COMPLETED (run 34470535718) and settled a real provider-reported
  // $1.390954 against its $5 coder share — 27.8% of it — for 110 added lines in
  // one file, 10 acceptance tests, no repair cycle. That is the only paid
  // datapoint for a mission of this shape, and it is one datapoint: it bounds
  // nothing on its own.
  //
  // Mission 5 is materially larger on every axis that plausibly costs coder
  // turns: THREE production modules instead of one, and two of them are
  // existing files being integrated rather than a blank stub; 17 requirements
  // against 12; 21 acceptance tests against 10; and a backward-compatibility
  // obligation to a caller (`julius-task-pipeline.ts`) that is not even in the
  // slice. `floor(30 / (1 + 3))` = $7.50 is the coder's share here, 1.5x
  // Mission 4's against roughly three times the surface.
  //
  // Still a BOUND and not a forecast. If mission 5 spends like mission 4 it
  // will use around a fifth of it, and the evidence bundle will say so either
  // way. Three cycles for the same reason as missions 2 through 4: a repair
  // LINEAGE needs more than one.
  'julius-live-mission-5': Object.freeze({ spendUsd: 30, repairCycles: 3 }),
});

/** The ceilings that apply to THIS contract, by its own declared namespace. */
const ceilingsFor = (namespace) =>
  (typeof namespace === 'string' && Object.hasOwn(MISSION_LIMITS, namespace))
    ? MISSION_LIMITS[namespace]
    : DEFAULT_LIMITS;

const MAX_ACCEPTANCE_CRITERIA = 12;

const problems = [];
const refuse = (problem) => problems.push(problem);

const path = process.argv[2];
if (!path) {
  process.stderr.write('usage: julius-live-contract-check.mjs <contract.json>\n');
  process.exit(2);
}

let contract;
try {
  contract = JSON.parse(readFileSync(path, 'utf8'));
} catch (error) {
  process.stderr.write(`contract_unreadable: ${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exit(1);
}

for (const field of ['missionId', 'projectId', 'tenantId', 'objective', 'testCommand', 'workspacePath']) {
  if (typeof contract[field] !== 'string' || contract[field].trim() === '') {
    refuse(`field "${field}" must be a non-empty string`);
  }
}

const criteria = contract.acceptanceCriteria;
if (!Array.isArray(criteria) || criteria.length === 0) {
  refuse('acceptanceCriteria must be a non-empty array');
} else {
  if (criteria.length > MAX_ACCEPTANCE_CRITERIA) {
    refuse(`acceptanceCriteria has ${criteria.length} entries, more than the ${MAX_ACCEPTANCE_CRITERIA} this mission may carry`);
  }
  if (!criteria.some((criterion) => criterion && criterion.blocking === true)) {
    // A mission whose criteria are all non-blocking can be completed without
    // satisfying any of them, which is not a verification at all.
    refuse('at least one acceptance criterion must be blocking');
  }
  for (const [index, criterion] of criteria.entries()) {
    if (!criterion || typeof criterion.id !== 'string' || typeof criterion.text !== 'string' || typeof criterion.blocking !== 'boolean') {
      refuse(`acceptance criterion ${index} needs a string id, a string text and a boolean blocking flag`);
    }
  }
}

/* ------------------------------------------------------------ the ceilings */

/**
 * The namespace decides which ceilings apply, so it is read as strictly as the
 * live workflow reads it. An unreadable namespace falls to the default rather
 * than to the most permissive entry.
 */
const namespace = typeof contract.markerNamespace === 'string' ? contract.markerNamespace : null;
const { spendUsd: MAX_SPEND_USD, repairCycles: MAX_REPAIR_CYCLES } = ceilingsFor(namespace);

const limits = contract.limits;
if (limits === undefined || limits === null || typeof limits !== 'object') {
  // Absent limits are NOT a default here: the entrypoint would fall back to
  // its own, and this mission must state its own ceilings explicitly.
  refuse('limits must be present and state spendUsd and repairCycles explicitly');
} else {
  if (typeof limits.spendUsd !== 'number' || !Number.isFinite(limits.spendUsd) || limits.spendUsd <= 0) {
    refuse('limits.spendUsd must be a positive, finite number');
  } else if (limits.spendUsd > MAX_SPEND_USD) {
    refuse(`limits.spendUsd is ${limits.spendUsd}, above the ${MAX_SPEND_USD} ceiling for ${namespace ?? 'a mission with no declared namespace'}`);
  }
  if (!Number.isInteger(limits.repairCycles) || limits.repairCycles < 0) {
    refuse('limits.repairCycles must be a non-negative integer');
  } else if (limits.repairCycles > MAX_REPAIR_CYCLES) {
    refuse(`limits.repairCycles is ${limits.repairCycles}, above the ${MAX_REPAIR_CYCLES} allowed for ${namespace ?? 'a mission with no declared namespace'}`);
  }
  /*
   * THE ARCHITECT'S OUTPUT CEILING IS OPTIONAL AND BOUNDED.
   *
   * Optional because a mission that says nothing keeps the connector's default
   * and behaves exactly as every mission before it did. Bounded by the output
   * tokens the run budget ALREADY reserves per dispatch
   * (`ARCHITECT_OUTPUT_TOKEN_RESERVATION` in `relay-bridge/julius/live-composition.ts`),
   * because that is what stops a raised token limit outrunning the mission's
   * own spendUsd ceiling: a mission may not buy more output than the
   * reservation covers. Raising it further is a deliberate edit in BOTH places.
   */
  if (limits.architectMaxOutputTokens !== undefined) {
    if (!Number.isInteger(limits.architectMaxOutputTokens) || limits.architectMaxOutputTokens <= 0) {
      refuse('limits.architectMaxOutputTokens must be a positive integer when declared');
    } else if (limits.architectMaxOutputTokens > ARCHITECT_OUTPUT_TOKEN_RESERVATION) {
      refuse(`limits.architectMaxOutputTokens is ${limits.architectMaxOutputTokens}, above the ${ARCHITECT_OUTPUT_TOKEN_RESERVATION} output tokens the run budget reserves per dispatch; raise the reservation deliberately or lower the ceiling`);
    }
  }
}

/* -------------------------------------------------- the workspace is not us */

if (typeof contract.workspacePath === 'string' && contract.workspacePath.trim() !== '') {
  const workspace = resolve(contract.workspacePath);
  const repository = realpathSync(resolve(process.cwd()));
  // `realpath` where it exists, so a symlink into the checkout cannot disguise
  // itself; the literal path where it does not, so this check still runs
  // before the workspace has been provisioned.
  let real = workspace;
  try { real = realpathSync(workspace); } catch { /* not provisioned yet */ }
  const contained = (parent, child) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
  if (contained(repository, real) || contained(repository, workspace)) {
    refuse(`workspacePath resolves inside this repository (${real}); a live coding agent must never be pointed at the Relay checkout`);
  }
}

/* --------------------------------------------------------------- the report */

const out = (line) => process.stdout.write(`${line}\n`);
out('JULIUS LIVE MISSION CONTRACT');
out(`  mission: ${contract.missionId ?? 'MISSING'} (project ${contract.projectId ?? 'MISSING'}, tenant ${contract.tenantId ?? 'MISSING'})`);
out(`  workspace: ${contract.workspacePath ?? 'MISSING'}`);
out(`  test command: ${contract.testCommand ?? 'MISSING'}`);
out(`  acceptance criteria: ${Array.isArray(criteria) ? criteria.length : 0} (${Array.isArray(criteria) ? criteria.filter((c) => c && c.blocking).length : 0} blocking)`);
out(`  spend ceiling: ${limits?.spendUsd ?? 'MISSING'} USD`);
out(`  architect output ceiling: ${limits?.architectMaxOutputTokens ?? 'default (connector)'} of ${ARCHITECT_OUTPUT_TOKEN_RESERVATION} reserved`);
out(`  repair ceiling: ${limits?.repairCycles ?? 'MISSING'} cycle(s)`);

if (problems.length > 0) {
  out('CONTRACT REFUSED:');
  for (const problem of problems) out(`  - ${problem}`);
  process.exit(1);
}
out('CONTRACT OK: bounded, verifiable, and aimed outside this repository.');
