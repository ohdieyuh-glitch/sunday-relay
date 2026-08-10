import { LIVE_REACH_SOURCES, type LiveReachSource } from '../live-reach/live-reach-contracts';

/**
 * THE FOUNDER MISSION PACK — the missions a founder actually runs, as DATA.
 *
 * A pack written as prose rots the first time a field is renamed, and the
 * founder discovers it at the moment they are trying to test something. So the
 * pack lives here, in the shape `MissionRegistry.start` accepts, and a test
 * validates every entry against the real vocabularies. A mission naming a
 * source Relay does not model fails the suite rather than the founder.
 *
 * WHAT EACH ENTRY HAS TO SAY, and the reason for each:
 *
 *   spends         Whether running it costs money. Ordered so the free ones
 *                  come first: a founder should be able to prove a lot before
 *                  anything is billable.
 *   requires       The configuration this mission genuinely needs. Empty means
 *                  it runs against what is already deployed.
 *   proves         The claim this mission tests. Not "it works" — the specific
 *                  thing that would be false if Relay were pretending.
 *   wouldFailIf    How the founder catches a fake. Every mission has one, and
 *                  writing it is what keeps the pack from being a demo script.
 *
 * NOTHING HERE ASSERTS THAT A MISSION PASSES. The pack says what to run and
 * what to look at. What actually happened is whatever the run reports.
 */

export interface FounderMissionReference {
  readonly source: LiveReachSource;
  readonly reference: string;
}

export interface FounderMission {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly evidenceReferences: readonly FounderMissionReference[];
  /** Money. Rate limits are not money and are not counted here. */
  readonly spends: boolean;
  /** Environment this mission needs beyond what is already deployed. */
  readonly requires: readonly string[];
  readonly proves: string;
  readonly wouldFailIf: string;
}

/**
 * Ordered deliberately: everything provable for free comes before anything
 * billable, so a founder can stop at any point and still have learned
 * something real.
 */
export const FOUNDER_MISSIONS: readonly FounderMission[] = Object.freeze([
  Object.freeze({
    id: 'fm-1-refusal-is-real',
    title: 'A Mission that must be refused',
    objective: 'Summarise the current pricing page of a competitor and post it to our X account.',
    evidenceReferences: Object.freeze([]),
    spends: false,
    requires: Object.freeze([]),
    proves:
      'Relay refuses what it cannot do instead of describing it. No X backend exists, so the '
      + 'publish half is unsupported and says so by name rather than failing vaguely later.',
    wouldFailIf:
      'The run reports a post as sent, queued or scheduled. Nothing in this build can publish '
      + 'anywhere, so any of those words is the product lying.',
  }),

  Object.freeze({
    id: 'fm-2-evidence-before-planning',
    title: 'A Mission that reads before it plans',
    objective:
      'Using the release notes provided, tell me whether upgrading breaks our adapter, and cite '
      + 'what you read.',
    evidenceReferences: Object.freeze([
      Object.freeze({ source: 'github' as LiveReachSource, reference: 'https://github.com/vitest-dev/vitest/releases' }),
    ]),
    spends: true,
    requires: Object.freeze(['RELAY_PROMPT_ARCHITECT_MODE=live', 'OPENAI_API_KEY', 'OPENAI_PROMPT_ARCHITECT_MODEL']),
    proves:
      'Retrieval happens BEFORE the architect plans, the observation reaches it fenced as data, '
      + 'and the Project Brain records that something was read without absorbing what it claimed.',
    wouldFailIf:
      'The plan cites the release notes while the event log shows no retrieval, or the retrieval '
      + 'is timestamped after the architect ran. A plan made from recollection cannot be fixed by '
      + 'evidence arriving afterwards.',
  }),

  Object.freeze({
    id: 'fm-3-unready-source-refuses',
    title: 'A Mission that asks for a source nobody probed',
    objective: 'Check whether this page mentions our product, and tell me what it says.',
    evidenceReferences: Object.freeze([
      Object.freeze({ source: 'web' as LiveReachSource, reference: 'https://example.com/' }),
    ]),
    spends: true,
    requires: Object.freeze(['RELAY_PROMPT_ARCHITECT_MODE=live', 'OPENAI_API_KEY', 'OPENAI_PROMPT_ARCHITECT_MODEL']),
    proves:
      'READY is observed, never assumed. A deployment that has probed nothing refuses the '
      + 'retrieval as not_ready and the Mission continues with less rather than failing.',
    wouldFailIf:
      'The page content appears in the plan without a probe having been run through '
      + '/relay-api/live-reach/probe. That would mean readiness was inferred from configuration.',
  }),

  Object.freeze({
    id: 'fm-4-three-roles-one-change',
    title: 'A Mission that writes code and is reviewed by something else',
    objective:
      'Add a guard that refuses an unknown schema version, with a test that fails without it.',
    evidenceReferences: Object.freeze([]),
    spends: true,
    requires: Object.freeze([
      'RELAY_PROMPT_ARCHITECT_MODE=live', 'OPENAI_API_KEY', 'OPENAI_PROMPT_ARCHITECT_MODEL',
      'RELAY_ROLE_CODING_AGENT', 'RELAY_ROLE_REVIEWER', 'ANTHROPIC_API_KEY',
    ]),
    proves:
      'Three roles, three attestations, and a reviewer that did not write the change. The '
      + 'requested and actual model are separate fields and the actual one comes from the '
      + 'provider response.',
    wouldFailIf:
      'The reviewer and the coding agent share an independence group, or the actual model equals '
      + 'the requested one on every leg — which is what a build that never asked the provider '
      + 'would report.',
  }),

  Object.freeze({
    id: 'fm-5-the-same-mission-twice',
    title: 'The same Mission, run twice',
    objective:
      'Add a guard that refuses an unknown schema version, with a test that fails without it.',
    evidenceReferences: Object.freeze([]),
    spends: true,
    requires: Object.freeze([
      'RELAY_PROMPT_ARCHITECT_MODE=live', 'OPENAI_API_KEY', 'OPENAI_PROMPT_ARCHITECT_MODEL',
      'RELAY_ROLE_CODING_AGENT', 'RELAY_ROLE_REVIEWER', 'ANTHROPIC_API_KEY',
    ]),
    proves:
      'Idempotency is real. The same idempotency key returns the first run rather than starting '
      + 'a second one, so a retried request does not spend twice.',
    wouldFailIf:
      'Two runs appear with different ids for one key, or the second reports a fresh provider '
      + 'call. Either means a retry costs money a founder did not authorise.',
  }),
]);

export type FounderMissionProblem =
  | 'duplicate_id'
  | 'unknown_source'
  | 'empty_objective'
  | 'reference_not_absolute'
  | 'spending_mission_requires_nothing'
  | 'no_failure_condition';

export interface FounderMissionFault {
  readonly missionId: string;
  readonly problem: FounderMissionProblem;
  readonly detail: string;
}

/**
 * Check the pack against the vocabularies Relay actually has.
 *
 * The interesting rule is the last two. A mission that spends money and lists
 * no requirement is a mission a founder will run expecting it to be free —
 * that is a bill, not a typo. And a mission with no `wouldFailIf` is a demo
 * script: it tells you what to do and never tells you how to catch a fake.
 */
export function checkFounderMissions(
  missions: readonly FounderMission[] = FOUNDER_MISSIONS,
): readonly FounderMissionFault[] {
  const faults: FounderMissionFault[] = [];
  const seen = new Set<string>();

  for (const mission of missions) {
    if (seen.has(mission.id)) {
      faults.push({ missionId: mission.id, problem: 'duplicate_id', detail: 'Two missions share an id.' });
    }
    seen.add(mission.id);

    if (mission.objective.trim() === '') {
      faults.push({ missionId: mission.id, problem: 'empty_objective', detail: 'A mission needs an objective.' });
    }

    for (const reference of mission.evidenceReferences) {
      if (!LIVE_REACH_SOURCES.includes(reference.source)) {
        faults.push({
          missionId: mission.id,
          problem: 'unknown_source',
          detail: `${reference.source} is not a source Relay models.`,
        });
      }
      if (!/^https?:\/\//.test(reference.reference)) {
        faults.push({
          missionId: mission.id,
          problem: 'reference_not_absolute',
          detail: `${reference.reference} is not an absolute URL, and the network policy resolves absolute URLs only.`,
        });
      }
    }

    if (mission.spends && mission.requires.length === 0) {
      faults.push({
        missionId: mission.id,
        problem: 'spending_mission_requires_nothing',
        detail: 'A mission that spends money must say what it needs, or a founder runs it expecting it to be free.',
      });
    }

    if (mission.wouldFailIf.trim() === '') {
      faults.push({
        missionId: mission.id,
        problem: 'no_failure_condition',
        detail: 'A mission with no way to catch a fake is a demo script.',
      });
    }
  }

  return faults;
}

/** The missions that cost nothing, for a founder who wants to start there. */
export function freeMissions(
  missions: readonly FounderMission[] = FOUNDER_MISSIONS,
): readonly FounderMission[] {
  return missions.filter((mission) => !mission.spends);
}
