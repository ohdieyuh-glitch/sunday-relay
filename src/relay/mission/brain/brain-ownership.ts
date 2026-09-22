/**
 * WHO OWNS WHICH TRUTH — THE REGISTRY THE REST OF PROJECT BRAIN OBEYS.
 *
 *   PROJECT BRAIN OWNS TRUTH.  JULIUS DECIDES.  POSTGRESQL PERSISTS.
 *   RAG FINDS.  PYTHON COMPUTES.  GVE PROVES.
 *
 * Project Brain is where durable project truth lives. That is not the same as
 * being where decisions are made, and the difference is the whole point of this
 * file: the Brain must never quietly acquire an authority that belongs to
 * another system, and no other system may write into the Brain as if it held
 * one.
 *
 * Each domain of truth names exactly one AUTHOR — the system whose statement
 * about it is the fact — and lists who may PROPOSE (offer a statement the author
 * records or refuses) and who may READ. A system that is neither cannot touch
 * that domain at all.
 *
 *   AUTHOR    its statement is the fact; the Brain records it as written
 *   PROPOSE   may submit; the author decides whether it becomes truth
 *   READ      may see it under the usual scoping and permissions
 *
 * TWO RULES DESERVE THEIR OWN SENTENCE, because both have already been got
 * wrong once in this project's history:
 *
 *   A VISUAL IS NOT A FACT. Wonderland renders what the Brain and Julius say.
 *   A Relay Dog Cub Ghost on screen is the *embodiment of a regular sub-agent*,
 *   and its existence on screen is evidence of nothing. Wonderland may never
 *   author agent lifecycle, mission state, or project progression.
 *
 *   A SUB-AGENT IS NOT A COMPOUND CLONE. A regular sub-agent and a temporary
 *   /MAS Compound AI Agent clone are different entities with different
 *   lifecycles, and they live in different domains here. Nothing in this system
 *   may silently upgrade one into the other; see `brain-agent-facts.ts`.
 */

/** Every system that can touch project truth, and what it is for. */
export const BRAIN_SYSTEMS = ['PROJECT_BRAIN', 'JULIUS', 'INDEPENDENT_REVIEWER', 'PYTHON', 'GVE', 'WONDERLAND', 'OPERATOR'] as const;
export type BrainSystem = typeof BRAIN_SYSTEMS[number];

export const BRAIN_SYSTEM_PURPOSE: Readonly<Record<BrainSystem, string>> = Object.freeze({
  PROJECT_BRAIN: 'stores durable project truth, and answers for it',
  JULIUS: 'decides and acts; the authority on missions, runs, attempts and agent lifecycle',
  INDEPENDENT_REVIEWER: 'evaluates and reports findings; never rewrites what it is reviewing',
  PYTHON: 'computes; carries no mission authority and writes nothing directly',
  GVE: 'proves; consumes evaluation results and never becomes the canonical database',
  WONDERLAND: 'renders; presentation only, and never an author of truth',
  OPERATOR: 'the human, who may state intent and authorise what only a human may authorise',
});

/** The domains of truth this project has. One author each. */
export const BRAIN_TRUTH_DOMAINS = [
  'MISSION_INTENT', 'MISSION_DECISION', 'RUN_LIFECYCLE', 'AGENT_LIFECYCLE', 'COMPOUND_CLONE_LIFECYCLE',
  'EVIDENCE', 'REVIEW_FINDING', 'EVALUATION_RESULT', 'COMPUTATION_RESULT',
  'PROJECT_PROGRESSION', 'PRESENTATION_STATE',
] as const;
export type BrainTruthDomain = typeof BRAIN_TRUTH_DOMAINS[number];

export interface BrainOwnershipRule {
  readonly domain: BrainTruthDomain;
  /** The system whose statement is the fact. Exactly one. */
  readonly author: BrainSystem;
  /** Systems that may offer a statement the author records or refuses. */
  readonly propose: readonly BrainSystem[];
  readonly read: readonly BrainSystem[];
  /** Whether Project Brain keeps it durably at all. */
  readonly durable: boolean;
  /**
   * Where the authoritative rows already live. Several domains are already
   * stored by Julius on mainline; for those the Brain holds a REFERENCE and a
   * projection, never a second copy that could disagree.
   */
  readonly durableHome: string;
  readonly rule: string;
}

export const BRAIN_OWNERSHIP: readonly BrainOwnershipRule[] = [
  {
    domain: 'MISSION_INTENT', author: 'OPERATOR', propose: ['JULIUS'], read: ['PROJECT_BRAIN', 'JULIUS', 'INDEPENDENT_REVIEWER', 'GVE', 'WONDERLAND'], durable: true,
    durableHome: 'the Brain ledger',
    rule: 'What the project is for is the human\'s to state. Julius may propose a refinement; it does not invent the goal.',
  },
  {
    domain: 'MISSION_DECISION', author: 'JULIUS', propose: ['INDEPENDENT_REVIEWER'], read: ['PROJECT_BRAIN', 'JULIUS', 'INDEPENDENT_REVIEWER', 'GVE', 'WONDERLAND'], durable: true,
    durableHome: 'the Brain ledger',
    rule: 'Julius decides. The Brain records the decision it made, never a decision the Brain reached on its behalf.',
  },
  {
    domain: 'RUN_LIFECYCLE', author: 'JULIUS', propose: [], read: ['PROJECT_BRAIN', 'JULIUS', 'INDEPENDENT_REVIEWER', 'GVE', 'WONDERLAND'], durable: true,
    durableHome: 'relay_wonderland.julius_runs / julius_tasks (Julius); the Brain references them',
    rule: 'A run and its attempts exist because Julius says so. The Brain never invents a run, an attempt, or their states.',
  },
  {
    domain: 'AGENT_LIFECYCLE', author: 'JULIUS', propose: [], read: ['PROJECT_BRAIN', 'JULIUS', 'INDEPENDENT_REVIEWER', 'GVE', 'WONDERLAND'], durable: true,
    durableHome: 'relay_wonderland.julius_subagents (Julius); the Brain references request ids',
    rule: 'Regular sub-agents exist because Julius emitted their lifecycle. A Cub on screen is not evidence that one exists.',
  },
  {
    domain: 'COMPOUND_CLONE_LIFECYCLE', author: 'JULIUS', propose: [], read: ['PROJECT_BRAIN', 'JULIUS', 'INDEPENDENT_REVIEWER', 'GVE', 'WONDERLAND'], durable: true,
    durableHome: 'none yet: Julius emits no clone lifecycle today, so the Brain holds nothing',
    rule: 'A temporary /MAS Compound AI Agent clone is its own kind of thing. Only Julius may say one existed, and it is never inferred from a sub-agent.',
  },
  {
    domain: 'EVIDENCE', author: 'JULIUS', propose: ['INDEPENDENT_REVIEWER', 'PYTHON', 'GVE'], read: ['PROJECT_BRAIN', 'JULIUS', 'INDEPENDENT_REVIEWER', 'GVE', 'WONDERLAND'], durable: true,
    durableHome: 'the Brain ledger, anchored to Julius evidence ids',
    rule: 'Evidence enters through Julius, whoever produced it, so that what is recorded is what the runtime observed.',
  },
  {
    domain: 'REVIEW_FINDING', author: 'INDEPENDENT_REVIEWER', propose: [], read: ['PROJECT_BRAIN', 'JULIUS', 'INDEPENDENT_REVIEWER', 'GVE', 'WONDERLAND'], durable: true,
    durableHome: 'the Brain ledger, authored by the reviewer',
    rule: 'The reviewer authors its findings and nothing else: it may not edit the work it reviewed, nor the decisions taken about it.',
  },
  {
    domain: 'EVALUATION_RESULT', author: 'GVE', propose: ['PYTHON'], read: ['PROJECT_BRAIN', 'JULIUS', 'INDEPENDENT_REVIEWER', 'GVE', 'WONDERLAND'], durable: true,
    durableHome: 'the Brain ledger, authored by GVE',
    rule: 'GVE proves, and its results are recorded as its own. GVE does not become the project database.',
  },
  {
    domain: 'COMPUTATION_RESULT', author: 'PYTHON', propose: [], read: ['PROJECT_BRAIN', 'JULIUS', 'INDEPENDENT_REVIEWER', 'GVE'], durable: true,
    durableHome: 'the Brain ledger, as a computation record',
    rule: 'Python computes. A result is recorded as a computation, through a typed governed interface, and carries no mission authority.',
  },
  {
    domain: 'PROJECT_PROGRESSION', author: 'JULIUS', propose: ['OPERATOR'], read: ['PROJECT_BRAIN', 'JULIUS', 'WONDERLAND', 'GVE'], durable: true,
    durableHome: 'the Brain ledger, derived from verified milestones',
    rule: 'How far a project has come is derived from verified milestones Julius recorded, or from an authorisation a human gave. Never from a level a renderer wanted to show.',
  },
  {
    domain: 'PRESENTATION_STATE', author: 'WONDERLAND', propose: [], read: ['WONDERLAND'], durable: false,
    durableHome: 'nowhere: Wonderland keeps it in its own runtime',
    rule: 'Opacity, spawn effects, formation, animation and position belong to Wonderland and do not enter the Brain at all.',
  },
];

const BY_DOMAIN: ReadonlyMap<BrainTruthDomain, BrainOwnershipRule> = new Map(BRAIN_OWNERSHIP.map((rule) => [rule.domain, rule]));

export const brainOwnershipOf = (domain: BrainTruthDomain): BrainOwnershipRule => {
  const rule = BY_DOMAIN.get(domain);
  if (rule === undefined) throw new Error(`brain_ownership_unknown_domain: ${String(domain)}`);
  return rule;
};

export type BrainWriteVerdict =
  | { readonly ok: true; readonly as: 'AUTHOR' | 'PROPOSAL' }
  | { readonly ok: false; readonly reasonCode: 'not_an_author' | 'not_durable' | 'unknown_domain'; readonly detail: string };

/**
 * May this system write this domain, and as what? A proposal is not truth until
 * its author records it, so the answer distinguishes the two rather than
 * collapsing them into a boolean.
 */
export function brainMayWrite(system: BrainSystem, domain: BrainTruthDomain): BrainWriteVerdict {
  const rule = BY_DOMAIN.get(domain);
  if (rule === undefined) return { ok: false, reasonCode: 'unknown_domain', detail: `${String(domain)} is not a truth domain` };
  if (!rule.durable) return { ok: false, reasonCode: 'not_durable', detail: `${domain} is not durable project truth: ${rule.rule}` };
  if (rule.author === system) return { ok: true, as: 'AUTHOR' };
  if (rule.propose.includes(system)) return { ok: true, as: 'PROPOSAL' };
  return { ok: false, reasonCode: 'not_an_author', detail: `${system} may not write ${domain}; ${rule.author} authors it` };
}

export const brainMayRead = (system: BrainSystem, domain: BrainTruthDomain): boolean => BY_DOMAIN.get(domain)?.read.includes(system) ?? false;
