/**
 * SUNDAY RELAY — WONDERLAND COLISEUM (CLI renderer).
 *
 * READ-ONLY terminal presentation of the Coliseum duel domain: duel results,
 * the proof meter, and the command-binding table. The CLI and the website
 * render the SAME shared projection (`projectDuelResults`, imported through
 * the `../mission` barrel), so the two surfaces cannot disagree about who
 * fought, what was proven, or what remains unknown. Only the presentation
 * differs: the website styles it, this prints it.
 *
 * Truthfulness rules carried as code, not as discipline:
 * - `null` prints the word `Unknown` — never 0, never a dash posing as data.
 * - An UNVERIFIED proof entry scores 0 visibly; a claim is a CLAIM until an
 *   independent verifier confirmed it.
 * - An `unbound` command has no engine; the table says so and this renderer
 *   never fabricates a result for it.
 * - Every view rendered in this build is a DEVELOPMENT FIXTURE, and the
 *   disclosure is structural: the render functions REQUIRE the data source
 *   and print the banner before any figure, so a caller cannot drop it by
 *   forgetting a flag.
 * - "No duel" is stated as a fact, not padded with an invented example.
 */

import type {
  DuelCommandView,
  DuelParticipantResultView,
  DuelResultsView,
  ProofEntry,
  VerifiedFixFact,
} from '../mission';
import {
  acceptChallenge,
  activateDuel,
  activeAutomationFightResults,
  BASE_AUTONOMOUS_RUN_TURN_CAP,
  beginProvisioning,
  buildDuelTraceLedger,
  challengedDuelResults,
  concludeDuel,
  concludeDuelAndAward,
  concludedManualDuelResults,
  createChallenge,
  createDuelEngineBindings,
  createDuelStore,
  createFakeLoopAgent,
  createInMemoryDurableBacking,
  deriveAgentProgression,
  planAutomationFight,
  provisionSandbox,
  resolveCommand,
  totalXp,
} from '../mission';

export interface ColiseumRenderOptions {
  /** Terminal width; the layout degrades gracefully when narrow. */
  width: number;
  plain: boolean;
}

/** Where the rendered view actually came from. There is no live source yet. */
export type ColiseumDataSource = 'development_fixture';

export const COLISEUM_FIXTURE_DISCLOSURE =
  'SIMULATED DATA — DEVELOPMENT FIXTURE — NOT LIVE DUEL DATA';

const NARROW = 60;

function line(label: string, value: string, options: ColiseumRenderOptions): string {
  if (options.width < NARROW) return `${label}:\n  ${value}`;
  const padding = Math.max(1, 24 - label.length);
  return `${label}${' '.repeat(padding)}${value}`;
}

function wrap(text: string, width: number, indent: string): string[] {
  const usable = Math.max(20, width - indent.length);
  const out: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/u)) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= usable) {
      current = `${current} ${word}`;
    } else {
      out.push(`${indent}${current}`);
      current = word;
    }
  }
  if (current.length > 0) out.push(`${indent}${current}`);
  return out;
}

/** A number that may be Unknown, rendered truthfully. Unknown is not zero. */
export function formatMaybe(value: number | null): string {
  return value === null ? 'Unknown' : String(value);
}

/** A signed delta that may be Unknown. Penalties keep their minus sign. */
export function formatDelta(value: number | null): string {
  if (value === null) return 'Unknown';
  return value > 0 ? `+${value}` : String(value);
}

/**
 * THE DISCLOSURE, before any figure. Emitted by every render function in this
 * file from the REQUIRED `source` argument — the same rule the mission
 * economics renderer applies — so fixture duels can never be presented as a
 * real fight between real agents.
 */
function disclosureLines(
  source: ColiseumDataSource,
  options: ColiseumRenderOptions,
): string[] {
  const rule = '─'.repeat(
    Math.max(20, Math.min(options.width - 2, COLISEUM_FIXTURE_DISCLOSURE.length + 4)),
  );
  return [
    `  ${rule}`,
    ...wrap(COLISEUM_FIXTURE_DISCLOSURE, options.width, '  '),
    ...(source === 'development_fixture'
      ? wrap(
        'No duel ran, no sandbox was provisioned, no agent fought, and no XP was awarded. '
        + 'Relay has no live Coliseum data source configured in this build.',
        options.width,
        '  ',
      )
      : []),
    `  ${rule}`,
    '',
  ];
}

const STATUS_LABEL: Readonly<Record<DuelResultsView['status'], string>> = {
  challenged: 'Challenged',
  accepted: 'Accepted',
  provisioning: 'Provisioning',
  active: 'Active',
  concluded: 'Concluded',
  aborted: 'Aborted',
};

const MODE_LABEL: Readonly<Record<DuelResultsView['mode'], string>> = {
  manual: 'Manual duel',
  'automation-fight': 'Automation Fight',
};

/* --------------------------------------------------------------- sections */

/** PROOF METER — one participant. Unverified entries score 0, visibly. */
function proofMeterLines(
  participant: DuelParticipantResultView,
  options: ColiseumRenderOptions,
): string[] {
  const out: string[] = [];
  out.push(`  ${participant.displayName} (${participant.kind})`);
  out.push(`  ${line('  Proof score', String(participant.proofScore), options)}`);
  out.push(`  ${line('  Bugs found (verified)', String(participant.bugsFound), options)}`);
  out.push(`  ${line('  Repairs accepted', String(participant.repairsAccepted), options)}`);
  out.push(`  ${line('  Regressions prevented', String(participant.regressionsPrevented), options)}`);
  out.push(`  ${line('  Evaluation quality', formatMaybe(participant.evaluationQuality), options)}`);
  out.push(`  ${line('  Reliability delta', formatDelta(participant.reliabilityDelta), options)}`);
  out.push(`  ${line('  Performance delta', formatDelta(participant.performanceDelta), options)}`);
  out.push(`  ${line('  XP earned', String(participant.xpEarned), options)}`);
  if (participant.opponentFixBonus > 0) {
    out.push(`  ${line('  Opponent-fix bonus', String(participant.opponentFixBonus), options)}`);
  }
  if (participant.rewards.length > 0) {
    out.push(`  ${line('  Rewards', participant.rewards.join(', '), options)}`);
  }
  if (participant.entries.length === 0) {
    out.push(...wrap(
      '· No proof entries submitted. This is not the same as nothing found.',
      options.width, '  ',
    ));
  }
  for (const entry of participant.entries) {
    // A CLAIM stays a claim until verified: unverified prints 0 points and
    // says why, so a self-report can never read as evidence.
    const state = entry.verified
      ? `${entry.points} pts (verified)`
      : '0 pts (UNVERIFIED CLAIM — not evidence)';
    out.push(...wrap(`· [${entry.category}] ${entry.summary} — ${state}`, options.width, '  '));
  }
  return out;
}

/** COMMAND BINDINGS — an unbound command truthfully has no engine. */
export function renderColiseumCommands(
  commands: readonly DuelCommandView[],
  options: ColiseumRenderOptions,
): string[] {
  const out: string[] = [];
  out.push('  COMMAND BINDINGS');
  for (const command of commands) {
    const state = command.binding === 'bound'
      ? 'bound'
      : 'UNBOUND — no engine; refuses rather than fabricates';
    out.push(`  ${line(`  /${command.name}`, state, options)}`);
    out.push(...wrap(command.description, options.width, '      '));
  }
  return out;
}

/* ------------------------------------------------------------ full render */

/** COLISEUM DUEL — results + proof meter + command table, disclosure first. */
export function renderColiseumDuel(
  view: DuelResultsView,
  source: ColiseumDataSource,
  options: ColiseumRenderOptions,
): string[] {
  const out: string[] = [];
  out.push('WONDERLAND COLISEUM — DUEL');
  out.push(`  duel ${view.duelId}`);
  out.push('');
  out.push(...disclosureLines(source, options));
  out.push(`  ${line('Status', STATUS_LABEL[view.status], options)}`);
  out.push(`  ${line('Mode', MODE_LABEL[view.mode], options)}`);

  // A missing winner stays missing. For an unfinished duel there is no winner
  // to report; for a concluded one, "none declared" is itself the fact.
  const winner = view.winnerParticipantId === null
    ? (view.status === 'concluded' || view.status === 'aborted'
      ? 'None declared'
      : 'Not decided — the duel has not concluded')
    : view.winnerParticipantId;
  out.push(`  ${line('Winner', winner, options)}`);

  out.push('');
  out.push('  PROOF METER');
  for (const participant of view.participants) {
    out.push('');
    out.push(...proofMeterLines(participant, options));
  }

  out.push('');
  out.push('  VERIFIED FIXES');
  if (view.verifiedFixes.length === 0) {
    out.push(...wrap('· No verified fixes recorded for this duel.', options.width, '  '));
  }
  for (const fix of view.verifiedFixes) {
    out.push(...wrap(
      `· ${fix.summary} → ${fix.targetParticipantId} (${fix.appliedState})`,
      options.width, '  ',
    ));
  }

  out.push('');
  out.push(...renderColiseumCommands(view.commands, options));
  return out;
}

/**
 * NO DUEL — the truthful empty state. Prints the fact and stops; it never
 * substitutes a fixture, an example, or an invented fight.
 */
export function renderColiseumNoDuel(options: ColiseumRenderOptions): string[] {
  return [
    'WONDERLAND COLISEUM',
    ...wrap(
      'No duel exists. No challenge has been created, no sandbox provisioned, and no '
      + 'agent has fought. There is nothing to score and nothing is shown in its place.',
      options.width, '  ',
    ),
  ];
}

/* ---------------------------------------------------------------- fixture */

/**
 * The deterministic development fixtures this CLI reads today — the SAME
 * scenarios the Coliseum domain fixtures define, derived through the real
 * shared projection so the CLI and the website render identical facts. A live
 * Coliseum source, when one exists, supplies real duels through the identical
 * shared core; none of the semantics change when it does.
 */
/* ---------------------------------------------------------- demo duel run */

export const COLISEUM_DEMO_DISCLOSURE =
  'LOCAL DEMONSTRATION DUEL — REAL ENGINES, DEMONSTRATION INPUTS';

const DEMO_T = '2026-08-18T00:00:00.000Z';

/**
 * THE DEMONSTRATION DUEL — the sanctioned offline composition root.
 *
 * This is NOT the SIMULATED-DATA fixture rendering above: every engine result
 * printed here is REAL engine output — the real Aquala trace ledger (real
 * hash chain), the real bounded repair loop, the real reviewer gate, and the
 * real loop-agent port (the scripted fake agent, the only agent that runs
 * offline) — dispatched against deterministic sandboxed fixture targets. No
 * network, no provider call, no money. The XP award goes through the real
 * duel-conclusion writer into an IN-MEMORY durable backing; the store's own
 * durability label is printed rather than asserted.
 */
export async function runColiseumDemoDuel(options: ColiseumRenderOptions): Promise<string[]> {
  const out: string[] = [];
  const rule = '─'.repeat(Math.max(20, Math.min(options.width - 2, COLISEUM_DEMO_DISCLOSURE.length + 4)));
  out.push('WONDERLAND COLISEUM — DEMONSTRATION DUEL');
  out.push(`  ${rule}`);
  out.push(...wrap(COLISEUM_DEMO_DISCLOSURE, options.width, '  '));
  out.push(...wrap(
    'Every engine result below is REAL engine output (trace ledger, bounded repair loop, '
    + 'reviewer gate, loop-agent port) dispatched over deterministic offline inputs against '
    + 'sandboxed fixture targets. No network, no provider call, no money. This is not the '
    + 'SIMULATED DATA fixture view.',
    options.width, '  ',
  ));
  out.push(`  ${rule}`, '');

  /* -- lifecycle: challenge → accept → provision → activate (real domain) -- */
  const duelId = 'demo-duel-001';
  const challenged = createChallenge({
    duelId, mode: 'automation-fight',
    challenger: { participantId: 'auto-red', displayName: 'Red Loop', kind: 'automation' },
    opponent: { participantId: 'auto-blue', displayName: 'Blue Loop', kind: 'automation' },
    at: DEMO_T,
  });
  if (!challenged.ok) { out.push(`  challenge refused: ${challenged.reason}`); return out; }
  const accepted = acceptChallenge(challenged.duel, DEMO_T);
  if (!accepted.ok) { out.push(`  accept refused: ${accepted.reason}`); return out; }
  const provisioning = beginProvisioning(accepted.duel, DEMO_T);
  if (!provisioning.ok) { out.push(`  provisioning refused: ${provisioning.reason}`); return out; }
  const sandboxRed = provisionSandbox({
    sourceTargetRef: 'fixture:red-target@demo', sandboxCopyId: 'sandbox-demo-red', provisionedAt: DEMO_T,
  });
  const sandboxBlue = provisionSandbox({
    sourceTargetRef: 'fixture:blue-target@demo', sandboxCopyId: 'sandbox-demo-blue', provisionedAt: DEMO_T,
  });
  const activated = activateDuel(provisioning.duel, [sandboxRed, sandboxBlue], DEMO_T);
  if (!activated.ok) { out.push(`  activation refused: ${activated.reason}`); return out; }
  out.push(`  duel ${duelId} active — sandboxes ${sandboxRed.sandboxCopyId} / ${sandboxBlue.sandboxCopyId}`, '');

  /* ---------------- composition root: the REAL engine bindings ---------------- */
  const ledger = buildDuelTraceLedger({
    duelId, createdByActorId: 'relay', createdAt: DEMO_T,
    entries: [
      { eventId: 'demo-evt-1', summary: 'sandboxes provisioned for both participants', occurredAt: DEMO_T, actorId: 'auto-red' },
      { eventId: 'demo-evt-2', summary: 'duel activated in automation-fight mode', occurredAt: DEMO_T, actorId: 'auto-blue' },
    ],
  });
  if (!ledger.ok) { out.push(`  trace ledger refused: ${ledger.reason}`); return out; }

  // 2 turns per lane, 2 lanes → 4 scripted iterations for the real agent port.
  const loopAgent = createFakeLoopAgent([
    { kind: 'verified_evidence' }, { kind: 'continuing' },
    { kind: 'continuing' }, { kind: 'verified_evidence' },
  ], { adapterId: 'demo-loop-agent', agentId: 'demo-agent' });

  const ports = createDuelEngineBindings({
    traceSource: { eventsForDuel: (id) => (id === duelId ? ledger.events : null) },
    planRepairPass: (request) => ({
      // A deterministic single-finding repair plan; the LOOP that runs it is
      // the real bounded engine, verifier-closed, scope-checked.
      ports: {
        async dispatchRepair() {
          return { touchedFiles: ['src/target/parser.ts'], claimsFixed: true };
        },
        async verify() {
          return { finding: 'closed' as const };
        },
        now: () => DEMO_T,
      },
      input: {
        loopId: `repair-${request.duelId}`, findingId: 'DEMO-F-1',
        claimedFiles: ['src/target/parser.ts'], maxCycles: 2,
      },
    }),
    gateInputFor: (request) => ({
      entitlement: 'pro', verificationPassed: true, runStatus: 'completed',
      reviewer: { agentId: 'gate-verifier', sessionId: 'demo-s1', adapterId: 'gate-verifier-adapter', independenceGroup: 'reviewers' },
      implementer: { agentId: request.submitterId, sessionId: 'demo-s2', adapterId: 'demo-implementer-adapter', independenceGroup: 'implementers' },
      completionPolicySatisfied: true,
      ledger: {
        missionId: `coliseum-${request.duelId}`, taskId: request.entryId, reviewerRunId: 'demo-review-run',
        missionRevision: 1, taskRevision: 1, workspaceRevision: 'demo-rev-1',
        originalClaimedFiles: ['src/target/parser.ts'], affectedCriterionIds: ['AC-1'],
        reviews: [{
          attempt: 1, verdict: 'approved', reviewerAgentId: 'gate-verifier',
          requestedReviewerAgentId: 'gate-verifier', independent: true, provenance: 'manual', findings: [],
        }],
        postRepairEvidenceIds: [], repairDispatched: false, maxRepairIterations: 1, now: DEMO_T,
      },
    }),
    loopAgent,
    iterationDeadlineMs: 60_000,
  });

  /* -------------------- TRACE / SB / VERIFY through the real ports -------------------- */
  out.push('  COMMAND DISPATCHES (real engines)');
  out.push('  (un-attributed to an agent, so no unlock gate applies here — a');
  out.push('   player-issued command goes through the level-gated resolver instead)');
  const dispatch = async (name: 'TRACE' | 'SB' | 'VERIFY' | 'RED', body: () => Promise<string[]>): Promise<void> => {
    const resolved = resolveCommand(name, ports);
    if (!resolved.executed) {
      out.push(`  /${name} → REFUSED: ${resolved.refusal}`);
      return;
    }
    try {
      for (const line of await body()) out.push(line);
    } catch (error) {
      out.push(`  /${name} → REFUSED: ${error instanceof Error ? error.message : 'refused'}`);
    }
  };

  await dispatch('TRACE', async () => {
    const entries = await ports.trace!.readEntries(duelId);
    return [
      `  /TRACE → ${entries.length} ledger entries (real hash-chained Aquala trace):`,
      ...entries.map((e) => `      ${e.entryId} @ ${e.at} — ${e.summary}`),
    ];
  });
  await dispatch('SB', async () => {
    const repair = await ports.sandboxRepair!.runRepairPass({
      duelId, sandboxCopyId: sandboxBlue.sandboxCopyId, objective: 'close DEMO-F-1',
    });
    return [`  /SB → ${repair.outcome} — ${repair.summary}`];
  });
  const verifyOutcome: {
    verdict: 'verified-true' | 'verified-false' | 'unknown';
    verifierId: string | null;
  } = { verdict: 'unknown', verifierId: null };
  await dispatch('VERIFY', async () => {
    const verified = await ports.verify!.verify({ duelId, entryId: 'proof-red-1', submitterId: 'auto-red' });
    verifyOutcome.verdict = verified.verdict;
    verifyOutcome.verifierId = verified.verifierId;
    return [`  /VERIFY → ${verified.verdict} (independent verifier: ${verified.verifierId})`];
  });
  // An unbound command refuses truthfully, live, through the same resolver.
  await dispatch('RED', async () => []);
  out.push('');

  /* ------------------------- the bounded automation fight ------------------------- */
  const turnCap = BASE_AUTONOMOUS_RUN_TURN_CAP;
  out.push('  AUTOMATION FIGHT (real loop-agent port, scripted offline agent)');
  out.push(`  Turn cap: ${turnCap} · Budget cap: not configured`);
  const plan = planAutomationFight(activated.duel, [sandboxRed, sandboxBlue], { turnCap, budgetCap: null }, ports);
  if (!plan.ok) { out.push(`  fight refused: ${plan.reason}`); return out; }
  for (const lane of plan.lanes) {
    for (let turn = 1; turn <= plan.limits.turnCap; turn += 1) {
      const iteration = await ports.automationLoop!.runIteration({
        duelId, participantId: lane.participantId, sandboxCopyId: lane.sandboxCopyId, turn,
      });
      const cost = iteration.costMicros === null ? 'Unknown' : `${iteration.costMicros} micros`;
      out.push(`    ${lane.participantId} turn ${turn}: ${iteration.outcome} (cost ${cost}) — ${iteration.summary}`);
    }
  }
  out.push('');

  /* ----------------------- conclusion and the REAL XP award ----------------------- */
  const concluded = concludeDuel(activated.duel, 'auto-red', DEMO_T);
  if (!concluded.ok) { out.push(`  conclusion refused: ${concluded.reason}`); return out; }

  // Proof facts derived from what the engines ACTUALLY returned above: the
  // repair claim is credited as verified only if the real gate verified it.
  const realVerifierId: string | null = verifyOutcome.verdict === 'verified-true' ? verifyOutcome.verifierId : null;
  const gateVerified = realVerifierId !== null;
  const proofEntries: Readonly<Record<string, readonly ProofEntry[]>> = {
    'auto-red': [{
      entryId: 'proof-red-1', category: 'repair-accepted', submitterId: 'auto-red',
      summary: 'repaired DEMO-F-1 in the opponent sandbox (verifier-closed repair loop)',
      verification: gateVerified ? 'verified-true' : 'unverified',
      verifierId: realVerifierId, brokeSandbox: false,
    }],
    'auto-blue': [{
      entryId: 'proof-blue-1', category: 'bug-discovery', submitterId: 'auto-blue',
      summary: 'claims a parser defect in the red sandbox (no independent verification ran)',
      verification: 'unverified', verifierId: null, brokeSandbox: false,
    }],
  };
  const verifiedFixes: readonly VerifiedFixFact[] = realVerifierId !== null ? [{
    id: 'fix-demo-1', summary: 'DEMO-F-1 repaired in the blue sandbox',
    targetParticipantId: 'auto-blue', authorParticipantId: 'auto-red',
    appliedState: 'applied', verifierId: realVerifierId,
  }] : [];

  const backing = createInMemoryDurableBacking();
  const store = createDuelStore(backing);
  out.push('  XP AWARD (real duel-conclusion writer)');
  out.push(`  Ledger backing: ${store.locationLabel} [${store.durability}]`);
  const award = await concludeDuelAndAward(store, backing, {
    duel: concluded.duel, proofEntries, verifiedFixes, awardedAt: DEMO_T,
  });
  if (!award.ok) { out.push(`  award refused: ${award.refusal}`); return out; }
  for (const participant of award.participants) {
    const ledgerNow = await store.readXpLedger(participant.participantId);
    out.push(
      `    ${participant.participantId}: ${participant.written ? 'WRITTEN' : `NOT WRITTEN (${participant.writeFailure ?? 'unknown reason'})`}`
      + ` — ${participant.reward.xp} XP (opponent-fix bonus ${participant.reward.opponentFixBonus}); ledger total ${totalXp(ledgerNow)}`,
    );
  }
  const doubleAward = await concludeDuelAndAward(store, backing, {
    duel: concluded.duel, proofEntries, verifiedFixes, awardedAt: DEMO_T,
  });
  out.push(doubleAward.ok
    ? '    DOUBLE-AWARD BUG: a second award was accepted'
    : `    second award refused: ${doubleAward.refusal}`);

  /* -------------------- progression: a PROJECTION of the real ledger -------------------- */
  // Nothing below is stored anywhere: every figure is derived, on this line,
  // from the XP the duel-conclusion writer actually appended above.
  out.push('');
  out.push('  AGENT PROGRESSION (derived from the XP ledger — nothing stored)');
  out.push(`  Ledger backing: ${store.locationLabel} [${store.durability}]`);
  for (const participant of award.participants) {
    const progression = deriveAgentProgression(
      await store.readXpLedger(participant.participantId),
    );
    const next = progression.xpToNextLevel === null
      ? 'at max level'
      : `${progression.xpToNextLevel} XP to next level`;
    // No earned tier is the truthful answer at low XP — never defaulted.
    const tier = progression.earnedChakraTier === null
      ? 'none earned (level 0 earns no tier)'
      : progression.earnedChakraTier.toUpperCase();
    out.push(`    ${progression.agentId}:`);
    out.push(`      total XP ${progression.totalXp} → level ${progression.level} `
      + `(${progression.xpIntoLevel} into level, ${next})`);
    out.push(`      earned chakra tier: ${tier}`);
    out.push(`      autonomous-run turn cap: ${progression.autonomousRunTurnCap}`
      + ` · evaluation depth: ${progression.evaluationDepth}`);
    out.push(`      unlocked commands: ${progression.unlockedCommands.map((c) => `/${c}`).join(' ')}`
      + ' (an unlocked-but-unbound command still refuses)');
  }
  return out;
}

export function buildColiseumFixture(): {
  source: ColiseumDataSource;
  concluded: DuelResultsView;
  activeFight: DuelResultsView;
  challenged: DuelResultsView;
} {
  return {
    source: 'development_fixture',
    concluded: concludedManualDuelResults(),
    activeFight: activeAutomationFightResults(),
    challenged: challengedDuelResults(),
  };
}
