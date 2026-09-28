import {
  parseLiveMissionContract,
  type LiveMissionContractFile,
  type LiveMissionResearchClause,
} from './julius/mission-contract';

/**
 * THE PROJECT EXECUTION PROFILE -- founder decision 4, 2026-09-27.
 *
 * "PLAYERS MUST NEVER AUTHOR THOSE VALUES DIRECTLY." A Julius mission contract
 * carries two kinds of field, and they have different authors:
 *
 *   THE PLAYER'S   what they want: the objective, its requirements, its
 *                  constraints, and how to tell it is done (acceptance criteria).
 *   THE OPERATOR'S where and how it may run: the workspace on the executor
 *                  machine, the verification command, the spend ceiling, the
 *                  repair and token ceilings, the research the mission may do,
 *                  the tenant, and the marker namespace paid attempts are
 *                  counted under.
 *
 * A contract a player could fill in whole would let a player point the executor
 * at any directory, run any command, and set their own budget. So the operator's
 * half is this PROFILE -- stored server-side per project, written only with the
 * operator credential -- and the player's half is the only thing a player route
 * accepts. The server composes the two into the contract Julius receives.
 *
 * ONE DEFINITION OF A VALID CONTRACT. Every composition is handed to
 * `parseLiveMissionContract` -- the parser the mission job and the operator
 * route use -- and refused in its words when it refuses. Nothing here is a
 * second opinion about what Julius accepts.
 *
 * THE MISSION'S IDENTITY IS THE SERVER'S. `missionId` and `markerNamespace` are
 * built from a suffix the ROUTE computes, never from player text: the contract
 * parser warns that a namespace derived from a normalised id can collide.
 *
 * DECIDED (2026-09-27, after the Julius lane's question): the suffix is a hash
 * of (project, player, the client's idempotency key) -- not a fresh random
 * draw per request. A random id per request would make every retry a SECOND
 * mission (a double-click would create two) and would make an explicit rerun
 * impossible, because a rerun is of a mission id the caller can name again.
 * Keyed, a retried submission IS the same mission, which Julius's
 * one-active-run guard answers with the same run; a different contract under
 * the same key is Julius's 409 naming the live run; and a deliberate new
 * mission is a new key.
 *
 * PURE. No clock, no hashing, no I/O: the route computes the suffix and stores
 * the profile.
 */

export const WONDERLAND_EXECUTION_PROFILE_SCHEMA_V1 = 'relay-wonderland-execution-profile.v1' as const;

export interface WonderlandExecutionProfileLimits {
  /** The spend ceiling for ONE mission of this project, in dollars. */
  readonly spendUsd: number;
  readonly repairCycles: number;
  readonly architectMaxOutputTokens: number;
}

export interface WonderlandExecutionProfile {
  readonly schemaVersion: typeof WONDERLAND_EXECUTION_PROFILE_SCHEMA_V1;
  /** From the route's path, never the body: the row IS the project's. */
  readonly projectId: string;
  readonly tenantId: string;
  /** The operator's switch: false refuses every player-created mission for this project. */
  readonly enabled: boolean;
  /** Paid attempts are counted as `<prefix>-<suffix>`. */
  readonly markerNamespacePrefix: string;
  /** Absolute, on the executor machine. Privileged: never served to a player. */
  readonly workspacePath: string;
  /**
   * Empty when the project has no deterministic check. CAUTION (Julius lane, 2026-09-27): an empty command is valid
   * for CREATION -- Julius's parser allows it -- but the paid preflight, scripts/julius-live-contract-check.mjs,
   * currently refuses it. Until that one line is aligned, a project whose missions are meant to be EXECUTED needs a
   * non-empty command here. Not worked around in this file: the preflight is Julius's gate.
   */
  readonly testCommand: string;
  readonly limits: WonderlandExecutionProfileLimits;
  /** The research this project's missions may do; null means none. */
  readonly research: LiveMissionResearchClause | null;
}

/** Exactly the keys an operator writes. Anything else is refused by name: a typo must not silently default. */
export const WONDERLAND_EXECUTION_PROFILE_FIELDS = [
  'tenantId', 'enabled', 'markerNamespacePrefix', 'workspacePath', 'testCommand', 'limits', 'research',
] as const;

/** Exactly the keys a PLAYER may send. Every other contract field is the operator's. */
export const WONDERLAND_PLAYER_MISSION_FIELDS = ['objective', 'requirements', 'constraints', 'acceptanceCriteria'] as const;

export interface WonderlandPlayerMissionFields {
  readonly objective: string;
  readonly requirements: readonly string[];
  readonly constraints: readonly string[];
  readonly acceptanceCriteria: readonly { readonly id: string; readonly text: string; readonly blocking: boolean }[];
}

/** The suffix a route draws: 12 lower-case hex digits. */
export const WONDERLAND_MISSION_SUFFIX_RE = /^[0-9a-f]{12}$/u;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PREFIX_RE = /^[a-z][a-z0-9-]{1,30}$/u;
const ABSOLUTE_PATH_RE = /^(?:\/|[A-Za-z]:[\\/])/u;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: string };
const refuse = (problem: string): { ok: false; problem: string } => ({ ok: false, problem });
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/* ------------------------------------------------------------- the operator */

/**
 * An operator's profile for one project, validated. The project comes from the
 * PATH; a body naming one is refused like any other unknown key.
 */
export function parseExecutionProfile(projectId: string, body: unknown): Parsed<WonderlandExecutionProfile> {
  if (!ID_RE.test(projectId)) return refuse('The project id in the path is not a project id.');
  if (!isObject(body)) return refuse('The execution profile must be a JSON object.');
  const unknown = Object.keys(body).filter((key) => !(WONDERLAND_EXECUTION_PROFILE_FIELDS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    return refuse(`Unknown execution profile field(s): ${unknown.join(', ')}. Allowed: ${WONDERLAND_EXECUTION_PROFILE_FIELDS.join(', ')}.`);
  }
  const { tenantId, enabled, markerNamespacePrefix, workspacePath, testCommand, limits, research } = body;
  if (typeof tenantId !== 'string' || !ID_RE.test(tenantId)) return refuse('"tenantId" must be an id.');
  if (typeof enabled !== 'boolean') return refuse('"enabled" must be true or false -- the operator\'s switch, never implied.');
  if (typeof markerNamespacePrefix !== 'string' || !PREFIX_RE.test(markerNamespacePrefix)) {
    return refuse('"markerNamespacePrefix" must be 2-31 lower-case letters, digits or hyphens, starting with a letter.');
  }
  if (typeof workspacePath !== 'string' || !ABSOLUTE_PATH_RE.test(workspacePath) || CONTROL_RE.test(workspacePath)
    || workspacePath.split(/[\\/]/u).includes('..')) {
    return refuse('"workspacePath" must be an absolute path on the executor machine, with no ".." and no control characters.');
  }
  if (typeof testCommand !== 'string' || CONTROL_RE.test(testCommand) || testCommand.length > 1000) {
    return refuse('"testCommand" must be one line of at most 1000 characters -- empty when the project has no deterministic check.');
  }
  if (!isObject(limits)) return refuse('"limits" must be an object with spendUsd, repairCycles and architectMaxOutputTokens.');
  const { spendUsd, repairCycles, architectMaxOutputTokens } = limits;
  if (typeof spendUsd !== 'number' || !Number.isFinite(spendUsd) || spendUsd <= 0) {
    return refuse('"limits.spendUsd" must be a positive number of dollars: the ceiling for one mission.');
  }
  if (!Number.isInteger(repairCycles) || (repairCycles as number) < 0) return refuse('"limits.repairCycles" must be a whole number, 0 or more.');
  if (!Number.isInteger(architectMaxOutputTokens) || (architectMaxOutputTokens as number) < 1) {
    return refuse('"limits.architectMaxOutputTokens" must be a whole number of tokens, 1 or more.');
  }
  if (research !== null && !isObject(research)) return refuse('"research" must be a research clause, or null for none.');

  const profile: WonderlandExecutionProfile = Object.freeze({
    schemaVersion: WONDERLAND_EXECUTION_PROFILE_SCHEMA_V1,
    projectId,
    tenantId,
    enabled,
    markerNamespacePrefix,
    workspacePath,
    testCommand,
    limits: Object.freeze({ spendUsd, repairCycles: repairCycles as number, architectMaxOutputTokens: architectMaxOutputTokens as number }),
    research: research === null ? null : research as unknown as LiveMissionResearchClause,
  });
  // THE WHOLE PROFILE, CHECKED BY JULIUS'S OWN PARSER against a probe mission, so a research clause the domain will
  // not seal is refused when the operator writes it -- not when a player's mission is first composed from it.
  const probe = composeTrustedMissionContract(profile, {
    objective: 'probe', requirements: [], constraints: [],
    acceptanceCriteria: [{ id: 'probe', text: 'probe', blocking: true }],
  }, '000000000000');
  if (!probe.ok) return refuse(`Julius would refuse missions composed from this profile: ${probe.problem}`);
  return { ok: true, value: profile };
}

/**
 * A profile AS STORED -- what the operator route wrote: the validated profile,
 * carrying its schema version and its project. Re-validated in full on every
 * read, because a stored row is not trusted merely for having been stored: it
 * must still be this schema, for THIS project, and still pass today's rules.
 */
export function parseStoredExecutionProfile(projectId: string, stored: unknown): Parsed<WonderlandExecutionProfile> {
  if (!isObject(stored)) return refuse('The stored execution profile is not an object.');
  const { schemaVersion, projectId: storedProject, ...operatorFields } = stored;
  if (schemaVersion !== WONDERLAND_EXECUTION_PROFILE_SCHEMA_V1) {
    return refuse(`The stored execution profile is schema ${String(schemaVersion)}, not ${WONDERLAND_EXECUTION_PROFILE_SCHEMA_V1}.`);
  }
  if (storedProject !== projectId) return refuse('The stored execution profile names another project.');
  return parseExecutionProfile(projectId, operatorFields);
}

/* --------------------------------------------------------------- the player */

/**
 * What a player sent, validated -- and ONLY those four fields. A body carrying
 * any other contract field (a workspace, a command, a budget, a mission id) is
 * refused and the fields are named: silently dropping them would leave a client
 * believing it had set them.
 */
export function parsePlayerMissionFields(body: unknown):
  | { readonly ok: true; readonly value: WonderlandPlayerMissionFields }
  | { readonly ok: false; readonly kind: 'forbidden_field' | 'malformed_mission'; readonly problem: string; readonly forbidden?: readonly string[] } {
  if (!isObject(body)) return { ok: false, kind: 'malformed_mission', problem: 'A mission is a JSON object.' };
  const forbidden = Object.keys(body).filter((key) => !(WONDERLAND_PLAYER_MISSION_FIELDS as readonly string[]).includes(key));
  if (forbidden.length > 0) {
    return {
      ok: false, kind: 'forbidden_field', forbidden,
      problem: `A player sets only ${WONDERLAND_PLAYER_MISSION_FIELDS.join(', ')}. Not settable here: ${forbidden.join(', ')}.`,
    };
  }
  const malformed = (problem: string) => ({ ok: false as const, kind: 'malformed_mission' as const, problem });
  const { objective, requirements, constraints, acceptanceCriteria } = body;
  if (typeof objective !== 'string' || objective.trim() === '' || objective.length > 4000) {
    return malformed('"objective" must be a non-empty sentence of at most 4000 characters.');
  }
  const lines = (value: unknown, name: string): readonly string[] | string => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 50 || !value.every((item) => typeof item === 'string' && item.trim() !== '' && item.length <= 2000)) {
      return `"${name}" must be a list of at most 50 non-empty lines of at most 2000 characters.`;
    }
    return value as string[];
  };
  const req = lines(requirements, 'requirements');
  if (typeof req === 'string') return malformed(req);
  const con = lines(constraints, 'constraints');
  if (typeof con === 'string') return malformed(con);
  if (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.length === 0 || acceptanceCriteria.length > 50) {
    return malformed('"acceptanceCriteria" must list between 1 and 50 criteria: how to tell the mission is done.');
  }
  const ids = new Set<string>();
  const criteria: { id: string; text: string; blocking: boolean }[] = [];
  for (const item of acceptanceCriteria) {
    if (!isObject(item) || typeof item.id !== 'string' || !ID_RE.test(item.id) || ids.has(item.id)
      || typeof item.text !== 'string' || item.text.trim() === '' || item.text.length > 2000 || typeof item.blocking !== 'boolean') {
      return malformed('Every acceptance criterion needs a unique id, a non-empty text, and blocking true or false.');
    }
    ids.add(item.id);
    criteria.push({ id: item.id, text: item.text, blocking: item.blocking });
  }
  return {
    ok: true,
    value: Object.freeze({
      objective,
      requirements: Object.freeze([...req]),
      constraints: Object.freeze([...con]),
      acceptanceCriteria: Object.freeze(criteria.map((criterion) => Object.freeze(criterion))),
    }),
  };
}

/* ------------------------------------------------------------- composition */

/**
 * The contract Julius receives: the player's four fields and nothing else of
 * theirs, the operator's profile for everything else, and a server-drawn
 * identity. Handed to Julius's own parser before it is returned.
 */
export function composeTrustedMissionContract(
  profile: WonderlandExecutionProfile,
  fields: WonderlandPlayerMissionFields,
  suffix: string,
): Parsed<LiveMissionContractFile> {
  if (!WONDERLAND_MISSION_SUFFIX_RE.test(suffix)) return refuse('The mission suffix must be 12 lower-case hex digits.');
  const composed = {
    missionId: `mission:wl-${suffix}`,
    markerNamespace: `${profile.markerNamespacePrefix}-${suffix}`,
    projectId: profile.projectId,
    tenantId: profile.tenantId,
    objective: fields.objective,
    requirements: fields.requirements,
    constraints: fields.constraints,
    acceptanceCriteria: fields.acceptanceCriteria,
    testCommand: profile.testCommand,
    workspacePath: profile.workspacePath,
    limits: {
      spendUsd: profile.limits.spendUsd,
      repairCycles: profile.limits.repairCycles,
      architectMaxOutputTokens: profile.limits.architectMaxOutputTokens,
    },
    ...(profile.research === null ? {} : { research: profile.research }),
  };
  const parsed = parseLiveMissionContract(JSON.stringify(composed));
  if (!parsed.ok) return refuse(parsed.problem);
  return { ok: true, value: parsed.contract };
}
