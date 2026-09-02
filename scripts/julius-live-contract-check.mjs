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

/** Ceilings this repository is willing to dispatch without a further decision. */
const MAX_SPEND_USD = 5;
const MAX_REPAIR_CYCLES = 1;
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

const limits = contract.limits;
if (limits === undefined || limits === null || typeof limits !== 'object') {
  // Absent limits are NOT a default here: the entrypoint would fall back to
  // its own, and this mission must state its own ceilings explicitly.
  refuse('limits must be present and state spendUsd and repairCycles explicitly');
} else {
  if (typeof limits.spendUsd !== 'number' || !Number.isFinite(limits.spendUsd) || limits.spendUsd <= 0) {
    refuse('limits.spendUsd must be a positive, finite number');
  } else if (limits.spendUsd > MAX_SPEND_USD) {
    refuse(`limits.spendUsd is ${limits.spendUsd}, above the ${MAX_SPEND_USD} ceiling for a first live mission`);
  }
  if (!Number.isInteger(limits.repairCycles) || limits.repairCycles < 0) {
    refuse('limits.repairCycles must be a non-negative integer');
  } else if (limits.repairCycles > MAX_REPAIR_CYCLES) {
    refuse(`limits.repairCycles is ${limits.repairCycles}, above the ${MAX_REPAIR_CYCLES} allowed for a first live mission`);
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
out(`  repair ceiling: ${limits?.repairCycles ?? 'MISSING'} cycle(s)`);

if (problems.length > 0) {
  out('CONTRACT REFUSED:');
  for (const problem of problems) out(`  - ${problem}`);
  process.exit(1);
}
out('CONTRACT OK: bounded, verifiable, and aimed outside this repository.');
