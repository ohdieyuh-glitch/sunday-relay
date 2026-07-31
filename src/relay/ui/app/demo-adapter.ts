import { buildProjectBriefDraft } from '../entry-home/project-brief';
import type { ProjectBriefDraft } from '../entry-home/contracts';
import type {
  MissionRole,
  ProjectBrain,
  RelayApplicationAdapter,
  RelayEvent,
  RelayMissionState,
} from './contracts';

/**
 * DEMO RELAY APPLICATION ADAPTER — deterministic, offline, honest.
 *
 * Provides the founder-demo data path with ZERO provider calls, ZERO
 * network calls, ZERO command execution, and ZERO repository changes.
 * Nothing here claims Claude, Codex, or any provider ran: agent activity
 * events are CLAIMS until the (simulated) Relay verification step, wording
 * says "Relay prepared…", and every mission is flagged demo. Demo events
 * can never enter a non-demo mission (guarded in advanceMission).
 *
 * Brief generation is transparent rule-based extraction over the founder's
 * request (reusing the existing deterministic buildProjectBriefDraft), so
 * different requests produce different briefs — no LLM required, none
 * implied.
 */

type ScriptEvent = Omit<RelayEvent, 'id' | 'missionId' | 'sequence' | 'demo' | 'at'>;

interface ScriptStep {
  nextState: RelayMissionState;
  role: MissionRole;
  events: ScriptEvent[];
}

const ev = (
  role: MissionRole,
  category: RelayEvent['category'],
  truth: RelayEvent['truth'],
  headline: string,
  detail?: string,
  meta?: string,
  extra?: Partial<ScriptEvent>,
): ScriptEvent => ({ role, category, truth, headline, detail, meta, ...extra });

/**
 * The deterministic demo mission script. One entry per ADVANCE action.
 * The final VERIFIED COMPLETE only occurs after: coding claim → Relay
 * verification → reviewer finding → repair → re-verification → reviewer
 * approval → completion-policy evaluation. The renderer never invents any
 * of these — it can only display what the machine appended.
 */
export const DEMO_MISSION_SCRIPT: readonly ScriptStep[] = [
  {
    nextState: 'ready',
    role: 'relay',
    events: [
      ev('relay', 'relay', 'system_notice', 'Mission Contract approved.', 'Scope, roles, and completion policy locked for this mission.'),
    ],
  },
  {
    nextState: 'architect_working',
    role: 'prompt_architect',
    events: [
      ev('prompt_architect', 'prompt_architect', 'system_notice', 'generating implementation brief', 'Analyzing requirements, constraints, and system context…'),
      ev('prompt_architect', 'research', 'system_notice', 'researching project details', 'Exploring technologies, dependencies, and architectural patterns…'),
    ],
  },
  {
    nextState: 'handoff_ready',
    role: 'prompt_architect',
    events: [
      ev('prompt_architect', 'prompt_architect', 'system_notice', 'handoff prompt ready', 'Passing to Coding Agent…', undefined, { done: true }),
      ev('relay', 'relay', 'system_notice', 'handoff compiled', 'Architect → Coding Agent transition successful'),
    ],
  },
  {
    nextState: 'coding',
    role: 'coding_agent',
    events: [
      ev('coding_agent', 'coding_agent', 'agent_claim', 'implementing first module', 'Creating the primary application module…', 'CREATE src/app/core.ts'),
      ev('coding_agent', 'coding_agent', 'agent_claim', 'wiring project structure', 'Updating configuration and types…', 'MODIFY src/app/config.ts'),
    ],
  },
  {
    nextState: 'claim_submitted',
    role: 'coding_agent',
    events: [
      ev('coding_agent', 'coding_agent', 'agent_claim', 'running checks', 'Executing the required test suite…', 'RUN npm test'),
      ev('coding_agent', 'coding_agent', 'agent_claim', 'work submitted — all checks passing', '14 passed, 0 failed — pending Relay verification', undefined, { done: true }),
    ],
  },
  {
    nextState: 'relay_verifying',
    role: 'relay',
    events: [
      ev('relay', 'workspace_inspection', 'relay_evidence', 'Claimed files match changed files. No protected files touched.'),
      ev('relay', 'verification', 'relay_evidence', 'Required tests passed under Relay verification.', 'Typecheck clean. 14/14 tests verified independently.'),
    ],
  },
  {
    nextState: 'reviewer_reviewing',
    role: 'reviewer',
    events: [
      ev('reviewer', 'reviewer', 'review_verdict', 'Independent review started.', 'Reviewer has read-only access to the held output.'),
    ],
  },
  {
    nextState: 'repair_required',
    role: 'reviewer',
    events: [
      ev('reviewer', 'reviewer', 'review_verdict', 'Finding F-1 — edge-case input is not validated.', 'Empty input reaches the core module unchecked. Repair required before approval.', undefined, { findingId: 'F-1' }),
    ],
  },
  {
    nextState: 'repair_in_progress',
    role: 'coding_agent',
    events: [
      ev('relay', 'repair', 'system_notice', 'Bounded repair R-1 authorized for F-1.', 'Authorized files only; scope is locked to the finding.', undefined, { findingId: 'F-1', repairId: 'R-1' }),
      ev('coding_agent', 'repair', 'agent_claim', 'repair implemented', 'Input validation added with regression test…', 'MODIFY src/app/core.ts', { findingId: 'F-1', repairId: 'R-1' }),
    ],
  },
  {
    nextState: 're_verifying',
    role: 'relay',
    events: [
      ev('relay', 'verification', 'relay_evidence', 'Repair verified: regression test passes.', '15/15 tests verified after repair R-1.', undefined, { repairId: 'R-1' }),
    ],
  },
  {
    nextState: 'approved',
    role: 'reviewer',
    events: [
      ev('reviewer', 'reviewer', 'review_verdict', 'Re-review complete — finding F-1 closed. Approved.', 'Requirements satisfied; no open findings remain.', undefined, { findingId: 'F-1' }),
    ],
  },
  {
    nextState: 'verified_complete',
    role: 'relay',
    events: [
      ev('relay', 'completion_engine', 'relay_evidence', 'Completion policy satisfied — MISSION VERIFIED COMPLETE.', 'Claim verified · review approved · repair closed · policy evaluated.', undefined, { done: true }),
    ],
  },
];

export function createDemoRelayApplicationAdapter(): RelayApplicationAdapter {
  return {
    kind: 'demo',

    createProjectBrief(request: string): ProjectBriefDraft {
      // Transparent rule-based extraction — deterministic per request.
      return buildProjectBriefDraft(request, null);
    },

    prepareProjectBrain({ projectId, brief, settings }): ProjectBrain {
      const now = new Date().toISOString();
      return {
        projectId,
        projectSummary: brief.desiredResult || brief.problem || brief.workingTitle,
        knownTechnologies: settings
          ? Object.values(settings.technology).filter((t): t is string => t !== null)
          : [],
        architectureNotes: [`Project type: ${brief.projectType}`, ...brief.coreFunctionality.slice(0, 3)],
        decisions: [],
        constraints: [...brief.constraints],
        assumptions: ['Draft prepared from your request — review before starting.'],
        researchNotes: [...brief.researchTopics.slice(0, 4)],
        recentHandoffs: [],
        lastUpdatedAt: now,
      };
    },

    advanceMission({ mission }): {
      nextState: RelayMissionState;
      role: MissionRole;
      events: Omit<RelayEvent, 'id' | 'missionId' | 'sequence' | 'demo'>[];
    } | null {
      // Demo events can NEVER enter a non-demo mission.
      if (!mission.demo) return null;
      if (mission.state === 'verified_complete') return null;
      const step = DEMO_MISSION_SCRIPT[mission.currentStep];
      if (!step) return null;
      const at = new Date().toISOString();
      return {
        nextState: step.nextState,
        role: step.role,
        events: step.events.map((e) => ({ ...e, at })),
      };
    },
  };
}
