/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * Deterministic IN-MEMORY repositories — clearly labeled: these are the
 * milestone's test/development persistence boundary, NOT a database and NOT
 * production persistence. The Aquala Trace ledger (Milestone 4) replaces the
 * event store with durable, hash-chained append-only storage.
 *
 * Guarantees enforced here:
 *   - command ids are unique (duplicates are rejected, not overwritten);
 *   - events are append-only, contiguous per command, never reordered,
 *     replaced, or deleted;
 *   - every returned record is a deep-frozen clone — callers can NEVER
 *     mutate stored state through a returned reference;
 *   - rejected and failed commands remain inspectable;
 *   - executed commands retain their applied state-change ids and their
 *     execution outcome for deterministic duplicate responses.
 */

import type { RelayMissionCommandContext } from './command-context';
import { cloneCommandContext } from './command-context';
import { commandError, type RelayMissionCommandError } from './command-errors';
import type { RelayMissionCommandEvent } from './command-events';
import type {
  RelayCommandPrerequisite,
  RelayMissionCommand,
  RelayMissionCommandStatus,
} from './command-types';

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const frozenClone = <T>(value: T): T => deepFreeze(deepClone(value));

/* ---------------------------------------------------- command repository */

export interface StoredExecutionOutcome {
  commandId: string;
  appliedChangeIds: string[];
  executedAt: string;
  eventIds: string[];
}

export type RepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RelayMissionCommandError };

export class InMemoryMissionCommandRepository {
  private readonly commands = new Map<string, RelayMissionCommand>();
  private readonly events = new Map<string, RelayMissionCommandEvent[]>();
  private readonly eventIds = new Set<string>();
  private readonly prerequisites = new Map<string, RelayCommandPrerequisite[]>();
  private readonly outcomes = new Map<string, StoredExecutionOutcome>();

  /* ------------------------------ commands ------------------------------ */

  createCommand(command: RelayMissionCommand): RepositoryResult<RelayMissionCommand> {
    if (this.commands.has(command.commandId)) {
      return {
        ok: false,
        error: commandError(
          'DUPLICATE_COMMAND',
          `command ${command.commandId} already exists — command ids are unique`,
          'issue the command under a fresh command id, or inspect the existing record',
          { commandId: command.commandId, entityType: 'command', entityId: command.commandId },
        ),
      };
    }
    this.commands.set(command.commandId, deepClone(command));
    return { ok: true, value: frozenClone(command) };
  }

  getCommand(commandId: string): RelayMissionCommand | null {
    const stored = this.commands.get(commandId);
    return stored ? frozenClone(stored) : null;
  }

  listCommands(): RelayMissionCommand[] {
    return [...this.commands.values()].map((c) => frozenClone(c));
  }

  /** Controlled lifecycle update — commands are never deleted. */
  updateCommand(
    commandId: string,
    patch: Partial<
      Pick<RelayMissionCommand, 'status' | 'rejectionReason' | 'executionEventIds'>
    > & { status?: RelayMissionCommandStatus },
  ): RepositoryResult<RelayMissionCommand> {
    const stored = this.commands.get(commandId);
    if (!stored) {
      return {
        ok: false,
        error: commandError(
          'DUPLICATE_COMMAND',
          `command ${commandId} does not exist`,
          'create the command before updating it',
          { commandId, entityType: 'command', entityId: commandId },
        ),
      };
    }
    const next = { ...stored, ...deepClone(patch) };
    this.commands.set(commandId, next);
    return { ok: true, value: frozenClone(next) };
  }

  /* ------------------------------- events ------------------------------- */

  nextEventSequence(commandId: string): number {
    return this.events.get(commandId)?.length ?? 0;
  }

  /** APPEND-ONLY: the sequence must be exactly the next slot, the event id
      must be globally fresh, and there is no removal or replacement API. */
  appendEvent(event: RelayMissionCommandEvent): RepositoryResult<RelayMissionCommandEvent> {
    const list = this.events.get(event.commandId) ?? [];
    if (this.eventIds.has(event.eventId)) {
      return {
        ok: false,
        error: commandError(
          'DUPLICATE_COMMAND',
          `event ${event.eventId} already exists — events are immutable`,
          'append a new event with a fresh id instead',
          { commandId: event.commandId, entityType: 'command', entityId: event.eventId },
        ),
      };
    }
    if (event.sequence !== list.length) {
      return {
        ok: false,
        error: commandError(
          'ATOMIC_APPLICATION_FAILED',
          `event sequence ${event.sequence} does not extend the ordered stream (next is ${list.length}) — events cannot be reordered`,
          'recompute the next sequence and append again',
          {
            commandId: event.commandId,
            entityType: 'command',
            entityId: event.eventId,
            expected: String(list.length),
            actual: String(event.sequence),
          },
        ),
      };
    }
    const frozen = deepFreeze(event);
    list.push(frozen);
    this.events.set(event.commandId, list);
    this.eventIds.add(event.eventId);
    return { ok: true, value: frozen };
  }

  listEvents(commandId: string): RelayMissionCommandEvent[] {
    return [...(this.events.get(commandId) ?? [])];
  }

  /* --------------------------- prerequisites --------------------------- */

  savePrerequisites(commandId: string, prerequisites: RelayCommandPrerequisite[]): void {
    this.prerequisites.set(commandId, deepClone(prerequisites));
  }

  getPrerequisites(commandId: string): RelayCommandPrerequisite[] {
    return (this.prerequisites.get(commandId) ?? []).map((p) => frozenClone(p));
  }

  updatePrerequisite(
    commandId: string,
    prerequisiteId: string,
    patch: Partial<
      Pick<RelayCommandPrerequisite, 'status' | 'satisfiedBy' | 'satisfiedAt' | 'failureReason'>
    >,
  ): RepositoryResult<RelayCommandPrerequisite> {
    const list = this.prerequisites.get(commandId) ?? [];
    const index = list.findIndex((p) => p.prerequisiteId === prerequisiteId);
    if (index === -1) {
      return {
        ok: false,
        error: commandError(
          'APPROVAL_INVALID',
          `prerequisite ${prerequisiteId} does not exist for command ${commandId}`,
          'inspect the command prerequisites and reference an existing one',
          { commandId, entityType: 'command', entityId: prerequisiteId },
        ),
      };
    }
    if (list[index].status !== 'pending') {
      return {
        ok: false,
        error: commandError(
          'APPROVAL_INVALID',
          `prerequisite ${prerequisiteId} is already ${list[index].status} — it cannot change again`,
          'issue a fresh command if circumstances changed',
          {
            commandId,
            entityType: 'command',
            entityId: prerequisiteId,
            expected: 'pending',
            actual: list[index].status,
          },
        ),
      };
    }
    const next = { ...list[index], ...deepClone(patch) };
    list[index] = next;
    this.prerequisites.set(commandId, list);
    return { ok: true, value: frozenClone(next) };
  }

  /* ---------------------------- execution outcomes ---------------------------- */

  saveExecutionOutcome(outcome: StoredExecutionOutcome): void {
    this.outcomes.set(outcome.commandId, deepClone(outcome));
  }

  getExecutionOutcome(commandId: string): StoredExecutionOutcome | null {
    const stored = this.outcomes.get(commandId);
    return stored ? frozenClone(stored) : null;
  }
}

/* --------------------------------------------------- mock context store */

/**
 * Deterministic mission-context store (MOCK — fixtures and tests only). The
 * executor re-reads the context from here at execution time and commits the
 * complete next context in one atomic replacement on success.
 */
export class InMemoryMissionContextStore {
  private readonly contexts = new Map<string, RelayMissionCommandContext>();

  save(context: RelayMissionCommandContext): void {
    this.contexts.set(context.mission.missionId, cloneCommandContext(context));
  }

  get(missionId: string): RelayMissionCommandContext | null {
    const stored = this.contexts.get(missionId);
    return stored ? cloneCommandContext(stored) : null;
  }

  /** Single-shot atomic replacement — the ONLY mutation path. */
  commit(missionId: string, next: RelayMissionCommandContext): void {
    this.contexts.set(missionId, cloneCommandContext(next));
  }
}
