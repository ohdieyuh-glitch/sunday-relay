import type {
  AgentConnectionStatus,
  ConnectionStatuses,
  EvidenceRecommendation,
  ProjectCategory,
  ProjectRouteDefinition,
  ResearchRecommendation,
  WorkforceRecommendation,
} from './contracts';

/**
 * Deterministic recommendation previews for the Relay Entry Home. Pure data +
 * pure functions — no provider call, no research call, no randomness. Route
 * selection drives objective prefill, category, workforce, research, and
 * evidence recommendations. Nothing here starts execution.
 */

/* ------------------------------------------------------- primary routes */

export const PRIMARY_PROJECT_ROUTES: ProjectRouteDefinition[] = [
  {
    routeId: 'route-feature',
    routeNumber: '01',
    title: 'BUILD A PRODUCT FEATURE',
    summary:
      'Plan, implement, test, independently review, and complete a focused feature.',
    category: 'product_feature',
    objectiveTemplate:
      'Build a focused product feature: describe the feature, where it lives, and what done means.',
    meta: 'FEATURE · SEMI · REVIEW REQUIRED',
  },
  {
    routeId: 'route-interface',
    routeNumber: '02',
    title: 'BUILD A WEB OR MOBILE INTERFACE',
    summary:
      'Turn a product objective and visual direction into a responsive product screen.',
    category: 'interface',
    objectiveTemplate:
      'Build a responsive product screen: describe the screen, its users, and the visual direction.',
    meta: 'INTERFACE · SEMI · VISUAL EVIDENCE',
  },
  {
    routeId: 'route-application',
    routeNumber: '03',
    title: 'BUILD A NEW APPLICATION',
    summary:
      'Create the product structure, architecture, initial implementation, testing, and review plan.',
    category: 'new_application',
    objectiveTemplate:
      'Build a new application: describe the product, its users, and the first working slice.',
    meta: 'APPLICATION · GUIDED · FULL PLAN',
  },
  {
    routeId: 'route-review',
    routeNumber: '04',
    title: 'REVIEW AN EXISTING PROJECT',
    summary:
      'Inspect architecture, incomplete work, risks, tests, security boundaries, and next actions.',
    category: 'project_review',
    objectiveTemplate:
      'Review an existing project: name the repository or system and what you want inspected.',
    meta: 'REVIEW · GUIDED · FINDINGS REPORT',
  },
  {
    routeId: 'route-bugfix',
    routeNumber: '05',
    title: 'FIX A BUG OR FAILING BUILD',
    summary:
      'Diagnose the problem, assign a bounded repair, verify it, and require independent review when appropriate.',
    category: 'bug_fix',
    objectiveTemplate:
      'Fix a bug or failing build: describe the failure, where it appears, and how to reproduce it.',
    meta: 'REPAIR · SEMI · FAIL-BEFORE PROOF',
  },
  {
    routeId: 'route-api',
    routeNumber: '06',
    title: 'BUILD AN API OR BACKEND SERVICE',
    summary:
      'Define contracts, implement behavior, test edge cases, and independently review the result.',
    category: 'api_service',
    objectiveTemplate:
      'Build an API or backend service: describe the contract, consumers, and edge cases that matter.',
    meta: 'BACKEND · SEMI · CONTRACT TESTS',
  },
];

/* ----------------------------------------------------- secondary routes */

export const SECONDARY_PROJECT_ROUTES: ProjectRouteDefinition[] = [
  ['route-auth', '07', 'HARDEN AUTHENTICATION', 'authentication', 'Harden authentication: describe the current auth flow and the threats that concern you.', 'SECURITY · GUIDED · REVIEW REQUIRED'],
  ['route-payments', '08', 'ADD PAYMENTS', 'payments', 'Add payments: describe the products, currencies, and provider constraints.', 'PAYMENTS · GUIDED · REVIEW REQUIRED'],
  ['route-agent', '09', 'CREATE AN AGENT', 'agent', 'Create an agent: describe its job, tools, and boundaries.', 'AGENT · SEMI · BOUNDED TOOLS'],
  ['route-pipeline', '10', 'CREATE A DATA PIPELINE', 'data_pipeline', 'Create a data pipeline: describe sources, transforms, and destinations.', 'DATA · SEMI · EDGE-CASE TESTS'],
  ['route-refactor', '11', 'REFACTOR A MODULE', 'refactor', 'Refactor a module: name the module and the behavior that must not change.', 'REFACTOR · SEMI · BEHAVIOR LOCK'],
  ['route-performance', '12', 'IMPROVE PERFORMANCE', 'performance', 'Improve performance: describe the slow path and the target measurement.', 'PERF · SEMI · MEASURED PROOF'],
  ['route-memory', '13', 'ADD PROJECT MEMORY', 'project_memory', 'Add project memory: describe what the project should remember across sessions.', 'MEMORY · SEMI · REVIEW REQUIRED'],
  ['route-internal', '14', 'BUILD AN INTERNAL TOOL', 'internal_tool', 'Build an internal tool: describe the team, the task, and the workflow.', 'INTERNAL · SEMI · WORKING DEMO'],
  ['route-observability', '15', 'ADD OBSERVABILITY', 'observability', 'Add observability: describe the signals, alerts, and dashboards you need.', 'OBSERVE · SEMI · SIGNAL TESTS'],
  ['route-release', '16', 'PREPARE A PRODUCTION RELEASE', 'production_release', 'Prepare a production release: describe the release scope and the safety gates.', 'RELEASE · GUIDED · FULL GATES'],
].map(([routeId, routeNumber, title, category, objectiveTemplate, meta]) => ({
  routeId,
  routeNumber,
  title,
  summary: '',
  category: category as ProjectCategory,
  objectiveTemplate,
  meta,
  secondary: true,
}));

export const ALL_PROJECT_ROUTES = [...PRIMARY_PROJECT_ROUTES, ...SECONDARY_PROJECT_ROUTES];

export function findProjectRoute(routeId: string): ProjectRouteDefinition | null {
  return ALL_PROJECT_ROUTES.find((r) => r.routeId === routeId) ?? null;
}

/* ----------------------------------------------------- default statuses */

/**
 * Truthful defaults: Claude Code has a real local adapter (CONNECTED), Codex
 * has a real reviewer adapter (AVAILABLE), the Prompt Architect role is a
 * recommendation until Project Settings confirms it. Never label Hermes,
 * OpenClaw, Ophiuchus, or any agent without a real adapter as connected.
 */
export const DEFAULT_CONNECTION_STATUSES: ConnectionStatuses = {
  promptArchitect: 'recommended',
  codingAgent: 'connected',
  reviewer: 'available',
};

export const CONNECTION_STATUS_LABEL: Record<AgentConnectionStatus, string> = {
  connected: 'CONNECTED',
  available: 'AVAILABLE',
  recommended: 'RECOMMENDED',
  sign_in_required: 'SIGN-IN REQUIRED',
  simulation: 'SIMULATION',
  coming_later: 'COMING LATER',
  not_configured: 'NOT CONFIGURED',
};

/* --------------------------------------------------------- workforce rec */

const ARCHITECT_DESCRIPTION =
  'Plans the mission, continuously researches the project, expands the Project Brain, and prepares every Coding Agent handoff.';

export function buildWorkforceRecommendation(
  category: ProjectCategory | null,
  statuses: ConnectionStatuses = DEFAULT_CONNECTION_STATUSES,
): WorkforceRecommendation {
  const reviewCritical =
    category === 'authentication' ||
    category === 'payments' ||
    category === 'production_release' ||
    category === 'api_service' ||
    category === 'bug_fix';
  return {
    roles: [
      {
        role: 'prompt_architect',
        agentName: 'Sunday Alcatraz',
        description: ARCHITECT_DESCRIPTION,
        responsibilities: [
          'Mission planning',
          'Prompt generation',
          'Continuous project research',
          'Project Brain development',
          'Coding Agent handoffs',
        ],
        status: statuses.promptArchitect,
        handoffLabel: 'MISSION + RESEARCH + HANDOFF',
      },
      {
        role: 'coding_agent',
        agentName: 'Claude Code',
        description: 'Implements bounded tasks and produces evidence Relay can verify.',
        responsibilities: ['Implementation', 'Tests', 'Bounded repairs'],
        status: statuses.codingAgent,
        handoffLabel: 'VERIFIED IMPLEMENTATION',
      },
      {
        role: 'reviewer',
        agentName: 'Codex',
        description: reviewCritical
          ? 'Independent review is strongly recommended for this route.'
          : 'Independent review of the implemented work.',
        responsibilities: ['Independent review', 'Findings', 'Approval or repair requirement'],
        status: statuses.reviewer,
        handoffLabel: 'REVIEW EVIDENCE',
      },
      {
        role: 'relay',
        agentName: 'Relay',
        description: 'Verified result — Relay confirms evidence before anything is called complete.',
        responsibilities: ['Inspection', 'Verification', 'Completion policy'],
        status: 'connected',
        handoffLabel: null,
      },
    ],
    rationale:
      category === null
        ? 'Default workforce for a new Relay project.'
        : `Workforce tuned for the ${category.replace(/_/g, ' ')} route.`,
  };
}

/* ---------------------------------------------------------- research rec */

const RESEARCH_TOPICS: Partial<Record<ProjectCategory, string[]>> = {
  product_feature: ['Feature-domain conventions', 'Adjacent product patterns'],
  interface: ['Accessibility standards', 'Responsive layout patterns', 'Design-system conventions'],
  new_application: ['Architecture patterns', 'Stack maturity and support', 'Comparable products'],
  project_review: ['Security advisories for the stack', 'Current testing practice'],
  bug_fix: ['Known issues in the dependencies involved', 'Regression-test practice'],
  api_service: ['API contract standards', 'Authentication and rate-limit practice'],
  authentication: ['Current OWASP guidance', 'Session and MFA standards'],
  payments: ['Provider API changes', 'Compliance requirements'],
  agent: ['Tool-safety practice', 'Agent evaluation methods'],
  data_pipeline: ['Schema-evolution practice', 'Backfill and idempotency patterns'],
  refactor: ['Language idioms', 'Behavior-preserving refactor practice'],
  performance: ['Profiling methods', 'Known bottleneck patterns'],
  project_memory: ['Retrieval patterns', 'Data-retention practice'],
  internal_tool: ['Workflow conventions', 'Internal-tool security practice'],
  observability: ['Telemetry standards', 'Alert-fatigue practice'],
  production_release: ['Release-gate practice', 'Rollback patterns'],
};

export function buildResearchRecommendation(
  category: ProjectCategory | null,
): ResearchRecommendation {
  return {
    status: 'not_configured',
    description:
      'Your Prompt Architect can continuously research the technologies, domain, standards, competitors, risks, and changing information connected to this project.',
    topics: category ? RESEARCH_TOPICS[category] ?? [] : [],
    sourceTypes: ['Official documentation', 'Standards bodies', 'Security advisories'],
    knowledgeGaps: [],
    updateSensitivity:
      category === 'authentication' || category === 'payments' || category === 'production_release'
        ? 'high'
        : 'medium',
    technologiesToMonitor: [],
  };
}

/* ---------------------------------------------------------- evidence rec */

export function buildEvidenceRecommendation(
  category: ProjectCategory | null,
): EvidenceRecommendation {
  const base = ['Typecheck passes', 'Targeted tests pass', 'Full test suite passes'];
  const extra: Partial<Record<ProjectCategory, string[]>> = {
    interface: ['Responsive layouts verified at 320px', 'Accessibility checks pass'],
    bug_fix: ['Failing test written before the fix', 'Repair verified by rerun'],
    api_service: ['Contract tests pass', 'Edge-case tests pass'],
    authentication: ['Independent security review approved'],
    payments: ['Independent review approved', 'No credential values in code'],
    production_release: ['Build succeeds', 'Independent review approved', 'Rollback plan documented'],
    new_application: ['Build succeeds', 'Architecture review recorded'],
    project_review: ['Findings report delivered with evidence'],
    performance: ['Before/after measurements recorded'],
  };
  return { requirements: [...base, ...(category ? extra[category] ?? [] : [])] };
}
