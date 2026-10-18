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
  //
  // THE FIRST CONTINUOUS QUALIFICATION. Smaller than Mission 5 on every axis of
  // CODE — one pure module of about 200 lines against three integrated files —
  // and larger on dispatches, which is what actually spends.
  //
  // Missions 2 through 5 bought plan → build → review. This one is specified to
  // buy plan → review → LOCK → build → pause → guidance → review of the
  // guidance → resume → review, plus a repair round if one is justified. That is
  // roughly twice the dispatches at a fraction of the per-dispatch surface.
  //
  // ARGUED FROM THE TWO PAID DATAPOINTS, not from caution. Mission 4 settled
  // $1.390954 for one file; Mission 5 settled $5.177120 for three integrated
  // ones. One file at Mission 4's rate with double the dispatches is on the
  // order of $3; $25 is a bound with real slack for a run shape nobody has
  // observed yet, and the evidence bundle will say what it actually cost.
  // Three cycles for the same reason as every mission before it: a repair
  // LINEAGE needs more than one.
  //
  // $60 IS THIS QUALIFICATION'S NUMBER, NOT JULIUS'S CAP. Set 2026-09-12 on the
  // founder's written authorization: the three provider accounts held roughly
  // $20 each, and the founder does not want an internal dollar ceiling whose
  // purpose is protecting that prepaid credit. A run cannot be charged $60
  // before a provider refuses, so the provider's balance is the limit that binds.
  //
  // `spendUsd` exists here for SCHEMA AND ALLOCATION COMPATIBILITY: the contract
  // must state a finite figure, and allocation v3 divides it into each slot's
  // protected floor, the shared pool and the repair reserve. It is not founder
  // cost protection. BEFORE ANY FUTURE PAID RUN, refresh it to the provider
  // budget that is actually funded and available at that time; a stale figure
  // here would starve the allocator or misstate what the mission may draw.
  //
  // Nothing that is not money is loosened by it: three repair rounds, one
  // attempt per review stage and every worker deadline are unchanged, and no
  // model, participation, research, verification or repair budget is reduced
  // to preserve unused credit.
  'julius-continuous-1': Object.freeze({ spendUsd: 60, repairCycles: 3 }),
  'julius-unreal-mission-1': Object.freeze({ spendUsd: 30, repairCycles: 3 }), // row 14-Unreal C1: founder 14a (10-07), "up to $30 with up to 3 repair cycles"; lane: the default lab
  // DECISION C, THE LEARNING PAIR (all four arms share this namespace: WITHOUT-1, WITH-1, WITHOUT-2, WITH-2). Founder (c1),
  // 2026-10-07: "Reuse Mission 5's existing mission body", so Mission 5's limits, per arm. Founder (c2): "Do not spend beyond
  // what was preregistered" -- four arms, no extra arm, no re-dispatch. No MISSION_LANES entry (the default lab: lanes grant no
  // money) and no MISSION_RESEARCH entry (Mission 5 has none).
  'julius-learning-pair-1': Object.freeze({ spendUsd: 30, repairCycles: 3 }),
});

/** The ceilings that apply to THIS contract, by its own declared namespace. */
const ceilingsFor = (namespace) =>
  (typeof namespace === 'string' && Object.hasOwn(MISSION_LIMITS, namespace))
    ? MISSION_LIMITS[namespace]
    : DEFAULT_LIMITS;

const MAX_ACCEPTANCE_CRITERIA = 12;

/**
 * RESEARCH AUTHORITY IS GRANTED HERE, PER MISSION, OR IT IS NOT GRANTED.
 *
 * The live entrypoint will seal whatever research clause a contract carries —
 * the domain checks that the allowlist is WELL FORMED, which is a different
 * question from whether this mission was ever authorised to read the outside
 * world at all. Without this table a mission document could grant itself the
 * internet by editing its own file, which is the exact mistake the spend
 * ceilings above exist to prevent: run 34396331071 refused mission 3's
 * self-declared 20/3 for the same reason, and the grant belongs here, named,
 * where raising it is visible.
 *
 * THE TABLE IS EMPTY, AND THAT IS THE CURRENT STATE OF THE PRODUCT: no mission
 * has been authorised to research, every paid mission so far has run with
 * `noJuliusResearch`, and a contract declaring a `research` clause is refused
 * until a human writes its grant in here. Authorising one is a deliberate,
 * reviewable edit naming the mission, the sources, the read capabilities, the
 * hosts and the retrieval budget — not a side effect of shipping the plumbing.
 *
 * A grant is a CEILING, exactly like spendUsd: the contract states what it
 * wants and this refuses anything the grant does not cover. It never widens a
 * contract, and it never asserts Relay can reach any of it — reachability is
 * an operator observation (`JULIUS_RESEARCH_OBSERVED_BACKENDS`) and is a third,
 * separate fact.
 */
const NO_RESEARCH = Object.freeze({
  roles: Object.freeze([]),
  allowances: Object.freeze([]),
  missionBudget: Object.freeze({ maxRetrievals: 0, maxBytes: 0 }),
  roleBudget: Object.freeze({ maxRetrievals: 0, maxBytes: 0 }),
});
const MISSION_RESEARCH = Object.freeze({
  /**
   * THE FIRST MISSION GRANTED RESEARCH, AND THE FIRST EVER.
   *
   * Every paid mission before this one ran under `noJuliusResearch`. This grant
   * is the deliberate act that table was built to require: it names the mission,
   * the source, the read capability, the exact host and the retrieval budget,
   * and it grants nothing else.
   *
   * WHY THIS MISSION AND WHY THIS HOST. The mission turns on one question its
   * own workspace cannot answer — what the evidence exporter writes for a SQL
   * NULL — and the authoritative general answer is PostgreSQL's own
   * documentation of unaligned output. One host, one read capability, no
   * search: a worker may fetch a documentation page and nothing else.
   *
   * ALL THREE ROLES, BECAUSE ALL THREE CAN NOW ASK. This entry first named
   * only the Coding Agent, on the ground that the Prompt Architect and the
   * Independent Reviewer answered with fixed schemas and had no channel
   * through which a research ask could reach Julius. That is no longer true:
   * their schemas carry `researchAsks` as a required field, so both slots ask
   * on every turn. Leaving the grant at one role would have refused those asks
   * `role_not_authorized` while the mission's own charter asks the Architect to
   * investigate before the contract locks — the mission would have bought a
   * record proving the opposite of what it set out to demonstrate.
   *
   * THE BUDGET IS DELIBERATELY TIGHT, AND WAS ALREADY SIZED FOR THREE. Two
   * retrievals per slot and six for the mission: exactly three slots' worth,
   * which is why widening the roles adds no retrieval, no host and no
   * capability. That is enough to read a page and check a second, and not
   * enough to browse. A slot that needs more is a slot whose question was not
   * the one this mission is about, and the refusal will say so on the record.
   *
   * IT AUTHORISES NOTHING ELSE. No other mission is named here, so every other
   * mission still gets `noJuliusResearch`. Adding a second entry is a second
   * deliberate act.
   */
  'julius-continuous-1': Object.freeze({
    roles: Object.freeze(['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER']),
    allowances: Object.freeze([
      Object.freeze({
        source: 'web',
        capabilities: Object.freeze(['read_item']),
        hosts: Object.freeze(['www.postgresql.org']),
      }),
    ]),
    missionBudget: Object.freeze({ maxRetrievals: 9, maxBytes: 900_000 }),
    roleBudget: Object.freeze({ maxRetrievals: 3, maxBytes: 300_000 }),
  }),
});

/**
 * WHICH PAID-RUN LANE A MISSION MAY CLAIM, because priority is an authorisation
 * too.
 *
 * Every paid run of `julius-first-live-mission.yml` waits in one queue for the
 * one paid provider slot (`scripts/julius-paid-slot.mjs`), ordered by lane:
 * `qualification`, then `qualification-repair`, then `lab`, then `regression`.
 * A lane typed at dispatch is only a claim. If it were also the grant, a lab
 * experiment could buy qualification priority by typing the word, and the
 * queue's order would be whatever the last person to dispatch wanted it to be.
 *
 * So the grant lives here, beside the ceilings, against each mission's own
 * accounting namespace. A namespace absent from this table may claim `lab` and
 * nothing else — the same default posture as the ceilings: a new mission is an
 * experiment until someone writes down that it is more. The missions that
 * already have a paid history are `regression` when they run again.
 *
 * This is a vocabulary check, not a budget: it grants no money and no reach.
 */
const PAID_LANES = Object.freeze(['qualification', 'qualification-repair', 'lab', 'regression']);
const DEFAULT_LANES = Object.freeze(['lab']);
const MISSION_LANES = Object.freeze({
  'julius-first-live': Object.freeze(['regression']),
  'julius-live-mission-2': Object.freeze(['regression']),
  'julius-live-mission-3': Object.freeze(['regression']),
  'julius-live-mission-4': Object.freeze(['regression']),
  'julius-live-mission-5': Object.freeze(['regression']),
  // THE FORMAL CONTINUOUS-WORKER QUALIFICATION, and the only mission that may
  // take the head of the queue. `qualification-repair` is its paid rerun after a
  // repair, which still outranks every lab experiment.
  'julius-continuous-1': Object.freeze(['qualification', 'qualification-repair']),
});

/** The lanes THIS contract may claim, by its own declared namespace. */
const lanesFor = (namespace) =>
  (typeof namespace === 'string' && Object.hasOwn(MISSION_LANES, namespace))
    ? MISSION_LANES[namespace]
    : DEFAULT_LANES;

/** The research grant that applies to THIS contract, by its own namespace. */
const researchGrantFor = (namespace) =>
  (typeof namespace === 'string' && Object.hasOwn(MISSION_RESEARCH, namespace))
    ? MISSION_RESEARCH[namespace]
    : NO_RESEARCH;

const problems = [];
const refuse = (problem) => problems.push(problem);

const path = process.argv[2];
if (!path) {
  process.stderr.write('usage: julius-live-contract-check.mjs <contract.json> [--lane <lane>]\n');
  process.exit(2);
}
/**
 * `--lane` is OPTIONAL, and absent means "no lane is being claimed" — a dry run
 * that will never enter the paid queue. A PRESENT lane must be a word of the
 * vocabulary and one this mission is granted; an empty value is a malformed
 * claim, not an absent one.
 */
const laneAt = process.argv.indexOf('--lane');
const claimedLane = laneAt === -1 ? null : (process.argv[laneAt + 1] ?? '');

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

if (claimedLane !== null) {
  const granted = lanesFor(namespace);
  if (!PAID_LANES.includes(claimedLane)) {
    refuse(`lane "${claimedLane}" is not a paid-run lane (${PAID_LANES.join(', ')})`);
  } else if (!granted.includes(claimedLane)) {
    refuse(`lane "${claimedLane}" is not granted to ${namespace ?? 'a mission with no declared namespace'}; it may claim ${granted.join(', ')}`);
  }
}
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

/* ------------------------------------------------------- research authority */

/**
 * A contract may ask for research. It may not grant itself research.
 *
 * Every refusal below names the exact clause that exceeded the grant, because
 * "research refused" at request time reads like the mission working as
 * intended rather than like a mission document asking for something nobody
 * authorised.
 */
const research = contract.research;
if (research !== undefined) {
  const grant = researchGrantFor(namespace);
  if (grant === NO_RESEARCH) {
    refuse(`research is declared but no research grant exists for ${namespace ?? 'a mission with no declared namespace'}; a contract cannot grant itself research authority`);
  } else if (research === null || typeof research !== 'object' || Array.isArray(research)) {
    refuse('research must be an object when declared');
  } else {
    const roles = Array.isArray(research.roles) ? research.roles : null;
    if (roles === null) refuse('research.roles must be an array');
    else for (const role of roles) {
      if (!grant.roles.includes(role)) refuse(`research.roles names "${role}", which this mission's grant does not cover`);
    }

    const allowances = Array.isArray(research.allowances) ? research.allowances : null;
    if (allowances === null) refuse('research.allowances must be an array');
    else for (const [index, allowance] of allowances.entries()) {
      if (!allowance || typeof allowance !== 'object') { refuse(`research.allowances[${index}] must be an object`); continue; }
      const granted = grant.allowances.find((entry) => entry.source === allowance.source);
      if (granted === undefined) {
        refuse(`research.allowances[${index}] names source "${allowance.source}", which this mission's grant does not cover`);
        continue;
      }
      const capabilities = Array.isArray(allowance.capabilities) ? allowance.capabilities : [];
      for (const capability of capabilities) {
        if (!granted.capabilities.includes(capability)) {
          refuse(`research.allowances[${index}] asks for "${capability}" on "${allowance.source}", which this mission's grant does not cover`);
        }
      }
      const hosts = Array.isArray(allowance.hosts) ? allowance.hosts : [];
      for (const host of hosts) {
        // Exact pattern match against the granted list, deliberately: deciding
        // whether `*.python.org` is "covered by" some other pattern is host
        // matching, and a second implementation of host matching in a gate
        // script is precisely the sort of thing that opens a hole.
        if (!granted.hosts.includes(String(host).trim().toLowerCase())) {
          refuse(`research.allowances[${index}] asks for host "${host}" on "${allowance.source}", which is not one of this mission's granted hosts`);
        }
      }
    }

    for (const [name, ceiling] of [['missionBudget', grant.missionBudget], ['roleBudget', grant.roleBudget]]) {
      const budget = research[name];
      if (!budget || typeof budget !== 'object') { refuse(`research.${name} must be an object stating maxRetrievals`); continue; }
      if (!Number.isInteger(budget.maxRetrievals) || budget.maxRetrievals < 0) {
        refuse(`research.${name}.maxRetrievals must be a non-negative integer`);
      } else if (budget.maxRetrievals > ceiling.maxRetrievals) {
        refuse(`research.${name}.maxRetrievals is ${budget.maxRetrievals}, above the ${ceiling.maxRetrievals} this mission is granted`);
      }
      if (budget.maxBytes === undefined || budget.maxBytes === null) {
        // Null is "no byte cap". Permitted only where the grant itself has none.
        if (ceiling.maxBytes !== null) refuse(`research.${name}.maxBytes must state a byte cap; this mission is granted at most ${ceiling.maxBytes}`);
      } else if (!Number.isInteger(budget.maxBytes) || budget.maxBytes < 0) {
        refuse(`research.${name}.maxBytes must be a non-negative integer or null`);
      } else if (ceiling.maxBytes !== null && budget.maxBytes > ceiling.maxBytes) {
        refuse(`research.${name}.maxBytes is ${budget.maxBytes}, above the ${ceiling.maxBytes} this mission is granted`);
      }
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
out(`  paid-run lanes: ${lanesFor(namespace).join(', ')}${claimedLane === null ? '' : ` (claimed: ${claimedLane})`}`);
out(`  research: ${research === undefined
  ? 'NONE — every ask is refused research_not_authorized'
  : `${Array.isArray(research.allowances) ? research.allowances.length : 0} allowance(s) for ${Array.isArray(research.roles) ? research.roles.join(', ') : 'no role'}`}`);

if (problems.length > 0) {
  out('CONTRACT REFUSED:');
  for (const problem of problems) out(`  - ${problem}`);
  process.exit(1);
}
out('CONTRACT OK: bounded, verifiable, and aimed outside this repository.');
