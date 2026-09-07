/**
 * EVERY WORLD A SURFACE IS WATCHING, AND THE WALL BETWEEN THEM.
 *
 * Each module under this directory holds ONE world's worth of state: a bridge
 * session per project, an entry per project, an embodiment per project. That is
 * the right shape for each of them and it is not the shape a surface has. A
 * founder with three projects has three worlds, one browser tab and one event
 * stream, and something has to decide which of the three an arriving event
 * belongs to.
 *
 * THAT DECISION IS THE WHOLE MODULE. Get it wrong once and project A's mission
 * animates project B's dog, or B's usage meter drains because A spent money —
 * and it would not look like a bug. It would look like the world working, on
 * the wrong world. There is no error, no exception and no red state; the
 * founder simply watches the wrong truth.
 *
 * SO THE GUARANTEE IS STATED IN THE STRONGEST FORM AVAILABLE. Routing anything
 * leaves every other world REFERENTIALLY IDENTICAL — not equal, identical, the
 * same frozen object. A test can assert that with `toBe`, and no amount of
 * later refactoring can satisfy it by accident. Equality would pass for a
 * module that rebuilt every world on every event and got the values right this
 * time; identity only passes if the other worlds were never touched.
 *
 * WHAT ROUTING WILL NOT DO. It will not create a world for an event naming a
 * project nobody asked to watch. A stream that carries a project this surface
 * never subscribed to is either a server-side leak or a client bug, and the
 * response to both is to count it and drop it — never to start rendering it.
 */

import { exactKeys } from './wonderland-contracts';
import type { WonderlandEvent } from './wonderland-backend';
import {
  applyWonderlandBridgeEvent,
  applyWonderlandBridgeUsageReport,
  openWonderlandBridge,
} from './wonderland-bridge';
import type { WonderlandBridgeSession } from './wonderland-bridge';
import { beginWonderlandEntry, isInsideWonderland } from './wonderland-entry';
import type { WonderlandEntry } from './wonderland-entry';
import type { WonderlandUsageReport } from './wonderland-usage-authority';
import { planWonderlandAnimation } from './wonderland-julius-animation';
import type { WonderlandAnimationPlan } from './wonderland-julius-animation';

/* ------------------------------------------------------------ versioning */

export const WONDERLAND_WORLDS_SCHEMA_V1 = 'relay-wonderland-worlds.v1' as const;
export type WonderlandWorldsSchemaVersion = typeof WONDERLAND_WORLDS_SCHEMA_V1;

/* -------------------------------------------------------------- one world */

/**
 * ONE PROJECT'S WORLD: the wire, the state, and the way in.
 *
 * Deliberately not flattened into the surrounding record. A world is the unit
 * that gets isolated, and a unit you can pass to a function whole is one a
 * caller cannot accidentally assemble from two projects' halves.
 */
export interface WonderlandWorld {
  readonly projectId: string;
  readonly bridge: WonderlandBridgeSession;
  readonly entry: WonderlandEntry;
}

export const WONDERLAND_WORLD_FIELDS = exactKeys<WonderlandWorld>()([
  'projectId',
  'bridge',
  'entry',
] as const);

/* ------------------------------------------------------------ all of them */

export interface WonderlandWorlds {
  readonly schemaVersion: WonderlandWorldsSchemaVersion;
  /** Keyed by project id. The key and `world.projectId` always agree. */
  readonly worlds: Readonly<Record<string, WonderlandWorld>>;
  /** Which one a single-world surface is showing. A view concern only. */
  readonly focusedProjectId: string | null;
  /** Events and reports naming a project this surface never asked to watch. */
  readonly unwatchedProjectMessagesDropped: number;
}

export const WONDERLAND_WORLDS_FIELDS = exactKeys<WonderlandWorlds>()([
  'schemaVersion',
  'worlds',
  'focusedProjectId',
  'unwatchedProjectMessagesDropped',
] as const);

/** Watching nothing. */
export function openWonderlandWorlds(): WonderlandWorlds {
  return Object.freeze({
    schemaVersion: WONDERLAND_WORLDS_SCHEMA_V1,
    worlds: Object.freeze({}),
    focusedProjectId: null,
    unwatchedProjectMessagesDropped: 0,
  });
}

/**
 * Start watching a project.
 *
 * Watching one already watched is a NO-OP that returns the same object, rather
 * than a reset. A surface re-rendering, or a second component asking for the
 * same project, must not discard a fold that is already tracking a mission —
 * and returning the identical object means a caller comparing by reference sees
 * correctly that nothing changed.
 */
export function watchWonderlandWorld(
  worlds: WonderlandWorlds,
  input: {
    readonly projectId: string;
    readonly playerId: string;
    readonly missionId?: string | null;
    readonly agentId?: string | null;
    readonly staleAfterSeconds?: number;
  },
): WonderlandWorlds {
  if (Object.prototype.hasOwnProperty.call(worlds.worlds, input.projectId)) return worlds;
  const world: WonderlandWorld = Object.freeze({
    projectId: input.projectId,
    bridge: openWonderlandBridge({
      projectId: input.projectId,
      missionId: input.missionId ?? null,
      agentId: input.agentId ?? null,
      staleAfterSeconds: input.staleAfterSeconds,
    }),
    entry: beginWonderlandEntry({ projectId: input.projectId, playerId: input.playerId }),
  });
  return Object.freeze({
    ...worlds,
    worlds: Object.freeze({ ...worlds.worlds, [input.projectId]: world }),
    // The first world watched becomes the focused one. A surface with exactly
    // one project should not have to choose it, and a surface with several
    // gets an explicit `focusWonderlandWorld` anyway.
    focusedProjectId: worlds.focusedProjectId ?? input.projectId,
  });
}

/**
 * Stop watching a project and drop everything held for it.
 *
 * Focus moves to null rather than to another world: picking a replacement would
 * be this module deciding what a person is looking at, and a surface that
 * closed a world knows better than this record does what should replace it.
 */
export function forgetWonderlandWorld(
  worlds: WonderlandWorlds,
  projectId: string,
): WonderlandWorlds {
  if (!Object.prototype.hasOwnProperty.call(worlds.worlds, projectId)) return worlds;
  const remaining: Record<string, WonderlandWorld> = {};
  for (const [key, world] of Object.entries(worlds.worlds)) {
    if (key !== projectId) remaining[key] = world;
  }
  return Object.freeze({
    ...worlds,
    worlds: Object.freeze(remaining),
    focusedProjectId: worlds.focusedProjectId === projectId ? null : worlds.focusedProjectId,
  });
}

/* ---------------------------------------------------------------- routing */

/**
 * Replace exactly one world, leaving every other object identical.
 *
 * The single place a world is written. Every route below goes through it, which
 * is what makes the isolation guarantee provable rather than repeated: there is
 * one function that could break it.
 */
function replaceWorld(
  worlds: WonderlandWorlds,
  projectId: string,
  next: (world: WonderlandWorld) => WonderlandWorld,
): WonderlandWorlds {
  const current = worlds.worlds[projectId];
  if (current === undefined) {
    return Object.freeze({
      ...worlds,
      unwatchedProjectMessagesDropped: worlds.unwatchedProjectMessagesDropped + 1,
    });
  }
  const replaced = next(current);
  if (replaced === current) return worlds;
  return Object.freeze({
    ...worlds,
    worlds: Object.freeze({ ...worlds.worlds, [projectId]: replaced }),
  });
}

/**
 * Route one event to the world it names.
 *
 * The event's OWN `projectId` decides, never the focused world. A surface that
 * routed by what the user was looking at would apply a background project's
 * events to the foreground one every time someone switched tabs — and the
 * symptom would be a dog that briefly acts out somebody else's mission.
 */
export function routeWonderlandEvent(
  worlds: WonderlandWorlds,
  event: WonderlandEvent,
): WonderlandWorlds {
  return replaceWorld(worlds, event.projectId, (world) =>
    Object.freeze({ ...world, bridge: applyWonderlandBridgeEvent(world.bridge, event) }),
  );
}

/** Route many events in order. Each still lands in its own world. */
export function routeWonderlandEvents(
  worlds: WonderlandWorlds,
  events: readonly WonderlandEvent[],
): WonderlandWorlds {
  return events.reduce(routeWonderlandEvent, worlds);
}

/**
 * Route one usage report to the world it names.
 *
 * The report's project decides, for the same reason and with a sharper
 * consequence: usage is money, and a meter that drained because a different
 * project spent would be a false statement about a person's remaining budget.
 */
export function routeWonderlandUsageReport(
  worlds: WonderlandWorlds,
  report: WonderlandUsageReport,
): WonderlandWorlds {
  return replaceWorld(worlds, report.projectId, (world) =>
    Object.freeze({
      ...world,
      bridge: applyWonderlandBridgeUsageReport(world.bridge, report),
    }),
  );
}

/**
 * Replace one world's entry.
 *
 * Entry moves through its own functions rather than through this record, so
 * this takes the RESULT and stores it. It refuses a result belonging to another
 * project: an entry carries its own `projectId`, and storing one under a
 * different key is the exact confusion this module exists to prevent — it would
 * make the key and the record disagree about whose world it is.
 */
export function setWonderlandEntry(
  worlds: WonderlandWorlds,
  entry: WonderlandEntry,
): WonderlandWorlds {
  return replaceWorld(worlds, entry.projectId, (world) =>
    entry.projectId === world.projectId ? Object.freeze({ ...world, entry }) : world,
  );
}

/* ---------------------------------------------------------------- reading */

/** One world, or null. Never a fabricated empty one. */
export function readWonderlandWorld(
  worlds: WonderlandWorlds,
  projectId: string,
): WonderlandWorld | null {
  return worlds.worlds[projectId] ?? null;
}

/** Which world a single-world surface should draw, or null for none. */
export function focusedWonderlandWorld(worlds: WonderlandWorlds): WonderlandWorld | null {
  return worlds.focusedProjectId === null ? null : readWonderlandWorld(worlds, worlds.focusedProjectId);
}

/**
 * Look at a different world.
 *
 * Changes NOTHING about any world — focus is which one is drawn, and a record
 * that paused a background fold when a person looked away would be silently
 * losing events it had already received.
 */
export function focusWonderlandWorld(
  worlds: WonderlandWorlds,
  projectId: string,
): WonderlandWorlds {
  if (!Object.prototype.hasOwnProperty.call(worlds.worlds, projectId)) return worlds;
  if (worlds.focusedProjectId === projectId) return worlds;
  return Object.freeze({ ...worlds, focusedProjectId: projectId });
}

/** Every project being watched, in the order they were first watched. */
export const watchedWonderlandProjects = (worlds: WonderlandWorlds): readonly string[] =>
  Object.freeze(Object.keys(worlds.worlds));

/** The worlds a person is actually looking at. Usually none, today. */
export const presentedWonderlandWorlds = (worlds: WonderlandWorlds): readonly WonderlandWorld[] =>
  Object.freeze(Object.values(worlds.worlds).filter((world) => isInsideWonderland(world.entry)));

/**
 * The animation plan for ONE world across an update.
 *
 * Takes both records rather than both worlds so a caller cannot pair the
 * previous state of one project with the next state of another — which is the
 * same class of mistake as misrouting an event, arriving through the door
 * marked "presentation" instead.
 *
 * A project that was not being watched before is a `wake` from nothing, which
 * is exactly right: the world has just learned what that Julius is doing.
 */
export function planWonderlandWorldAnimation(
  previous: WonderlandWorlds,
  next: WonderlandWorlds,
  projectId: string,
): WonderlandAnimationPlan | null {
  const after = readWonderlandWorld(next, projectId);
  if (after === null) return null;
  const before = readWonderlandWorld(previous, projectId);
  return planWonderlandAnimation(before?.bridge.embodiment ?? null, after.bridge.embodiment);
}
