import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

import { handleWonderlandJuliusRoute } from './wonderland-julius-routes';
import type {
  WonderlandJuliusResultSource,
  WonderlandJuliusRouteDeps,
  WonderlandJuliusWorld,
  WonderlandProjectMembershipSource,
} from './wonderland-julius-routes';
import { NATIVE_WORLD_AUDIENCE, createBrowserSessionStore } from './browser-session/grants';
import type { BrowserSessionStore } from './browser-session/grants';
import { WonderlandJuliusReaderPostgres } from '../src/relay/persistence/wonderland-julius-reader-postgres';
import type { JuliusMissionResultView } from '../src/relay/mission/julius/julius-runtime-api';

/**
 * ROW 12, R6: THE BODIES ARE CHECKED AGAINST THE CLIENT'S DECODERS, NOT THE SERVER'S
 * OWN EXPECTATION (the row-14 lesson). And R5 (one deterministic contract) and R4
 * (no secret in any body or log line) on the same fixtures.
 *
 * THE PORT BELOW IS THE CLIENT'S RULES, field for field, from CORE's final RC
 * (task3 6eb97308; its stream and decoder sources unchanged since 8327165b):
 *
 *   WonderlandJuliusStream.cpp   DataOf (l.103), SplitPage (l.199), ParseResult (l.231),
 *                                RunQuery (l.472), the result's run check (l.837)
 *   WonderlandWireDecode.cpp     the strict reader (l.61-311), FFieldReader (l.324-492),
 *                                envelope (l.563), activity (l.664), delivery (l.785),
 *                                usage (l.893-1032), hydration (l.1058-1547)
 *   WonderlandWireDecode.tables.cpp   every token a decoder accepts
 *   WonderlandJuliusSubsystem.cpp     AdoptHydration's identity rules (l.159-200)
 *
 * Where the engine is LENIENT (UE's FJsonObject getters coerce a number to a
 * string, for instance) the port is STRICT: a body the strict port accepts is a
 * body the client accepts. Where the engine is strict, the port is equally so,
 * and the controls below prove each rule refuses what the client refuses -- an
 * instrument that cannot fail proves nothing.
 *
 * The Unreal decoder itself cannot run on this machine's test runner; the
 * golden bodies in R5 are the captured bodies a WonderlandWireDecode unit run
 * would be given.
 */

/* ===================================================================== */
/*  THE CLIENT, PORTED                                                    */
/* ===================================================================== */

const WIRE_MAX_BYTES = 262_144;
const WIRE_MAX_DEPTH = 32;
const WIRE_MAX_KEYS = 128;
const WIRE_MAX_STRING_BYTES = 8_192;
const WIRE_MAX_EXACT = 9_007_199_254_740_991;
const HYDRATION_SCHEMA = 'relay-wonderland-hydration.v1';
const RESULT_SCHEMA = 'relay-wonderland-julius-result.v1';

/** WonderlandWireDecode.tables.cpp: every token, per enum. Anything else is refused by name. */
const TOKENS = {
  EWonderlandJuliusState: ['idle', 'attention', 'prompt_architect', 'coding', 'handoff', 'independent_review', 'repair', 'verifying', 'complete', 'blocked', 'error'],
  EWonderlandJuliusStateSource: ['julius_run_state', 'relay_phase', 'event_type'],
  EWonderlandWorkerRole: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER', 'SPECIALIST'],
  EWonderlandActivitySignal: ['awaiting_approval', 'provider_degraded', 'recovering', 'retrying', 'switching_worker', 'swarming', 'retrieving_context'],
  EWonderlandUsageChannel: ['compound_agent', 'single_agent'],
  EWonderlandUsageStatus: ['available', 'limited', 'blocked', 'updating', 'unavailable'],
  EWonderlandProvenance: ['simulated', 'live', 'imported', 'manual'],
  EWonderlandHudAnchor: ['top_left', 'top_right', 'bottom_left', 'bottom_right'],
  EWonderlandUnknownReason: ['not_observed', 'insufficient_samples', 'unknown_denominator', 'stale', 'unreadable'],
  EWonderlandUsageReading: ['not_reported', 'known', 'stale', 'unavailable'],
  EWonderlandAutonomy: ['SUPERVISED', 'AUTONOMOUS', 'UNCHAINED'],
  EWonderlandBrainKind: ['OBJECTIVE', 'REQUIREMENT', 'CONSTRAINT', 'DECISION', 'FINDING', 'REPAIR', 'HANDOFF', 'ARTIFACT', 'EVIDENCE'],
  EWonderlandGatedOperation: ['DISPATCH_WORKER', 'USE_CAPABILITY', 'USE_PROVIDER', 'USE_TOOL', 'READ_FILESYSTEM', 'EXECUTE_PROCESS', 'ACCESS_NETWORK', 'MUTATE_FILESYSTEM', 'SPAWN_SUBAGENT', 'CONTINUE_ITERATIVE_REVIEW', 'FALLBACK_PROVIDER', 'AUTOMATIC_RETRY', 'UNCHAINED_CONTINUATION'],
} as const;
type TokenTable = keyof typeof TOKENS;

type Wire =
  | { readonly k: 'null' }
  | { readonly k: 'bool'; readonly b: boolean }
  | { readonly k: 'num'; readonly n: number }
  | { readonly k: 'str'; readonly s: string }
  | { readonly k: 'arr'; readonly items: readonly Wire[] }
  | { readonly k: 'obj'; readonly keys: readonly string[]; readonly vals: readonly Wire[] };
type WireObject = Extract<Wire, { k: 'obj' }>;

/** A refusal, named the way EWonderlandWireError names it, at the field the decoder names. */
class Refused extends Error {
  constructor(readonly code: string, readonly field = '') {
    super(field === '' ? code : `${code} at ${field}`);
  }
}

/** ParseDocument + FParser: bytes in, one object out, or a refusal. */
function parseDocument(text: string): WireObject {
  const data = Buffer.from(text, 'utf8');
  if (data.length === 0) throw new Refused('not_json');
  if (data.length > WIRE_MAX_BYTES) throw new Refused('too_large');
  let at = 0;
  let depth = 0;
  const fail = (code: string): never => { throw new Refused(code); };
  const digit = (c: number | undefined) => c !== undefined && c >= 0x30 && c <= 0x39;
  const skip = () => { while (at < data.length && [0x20, 0x09, 0x0a, 0x0d].includes(data[at])) at += 1; };
  const literal = (word: string) => {
    if (at + word.length > data.length) fail('not_json');
    for (let i = 0; i < word.length; i += 1) if (data[at + i] !== word.charCodeAt(i)) fail('not_json');
    at += word.length;
  };
  const hex4 = (): number => {
    if (at + 4 > data.length) fail('not_json');
    let value = 0;
    for (let i = 0; i < 4; i += 1) {
      const c = data[at + i];
      const d = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x61 && c <= 0x66 ? c - 0x57 : c >= 0x41 && c <= 0x46 ? c - 0x37 : fail('not_json');
      value = (value << 4) | d;
    }
    at += 4;
    return value;
  };
  const readString = (): string => {
    if (data[at] !== 0x22) fail('not_json');
    at += 1;
    const out: number[] = [];
    for (;;) {
      if (at >= data.length) fail('not_json');
      if (out.length > WIRE_MAX_STRING_BYTES) fail('too_large');
      const c = data[at];
      if (c === 0x22) { at += 1; return Buffer.from(out).toString('utf8'); }
      if (c === 0x5c) {
        at += 1;
        if (at >= data.length) fail('not_json');
        const escape = data[at];
        at += 1;
        const simple: Record<number, number> = { 0x22: 0x22, 0x5c: 0x5c, 0x2f: 0x2f, 0x62: 0x08, 0x66: 0x0c, 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09 };
        if (simple[escape] !== undefined) { out.push(simple[escape]); continue; }
        if (escape !== 0x75) fail('not_json');
        let code = hex4();
        if (code >= 0xd800 && code <= 0xdbff) {
          if (data[at] !== 0x5c || data[at + 1] !== 0x75) fail('not_json');
          at += 2;
          const low = hex4();
          if (low < 0xdc00 || low > 0xdfff) fail('not_json');
          code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          fail('not_json');
        }
        out.push(...Buffer.from(String.fromCodePoint(code), 'utf8'));
        continue;
      }
      // A raw control character is not permitted in a JSON string.
      if (c < 0x20) fail('not_json');
      out.push(c);
      at += 1;
    }
  };
  const readNumber = (): number => {
    const start = at;
    if (data[at] === 0x2d) at += 1;
    if (at >= data.length) fail('not_json');
    if (data[at] === 0x30) at += 1;
    else if (data[at] >= 0x31 && data[at] <= 0x39) { while (digit(data[at])) at += 1; } else fail('not_json');
    if (data[at] === 0x2e) {
      at += 1;
      if (!digit(data[at])) fail('not_json');
      while (digit(data[at])) at += 1;
    }
    if (data[at] === 0x65 || data[at] === 0x45) {
      at += 1;
      if (data[at] === 0x2b || data[at] === 0x2d) at += 1;
      if (!digit(data[at])) fail('not_json');
      while (digit(data[at])) at += 1;
    }
    const value = Number(data.subarray(start, at).toString('latin1'));
    if (!Number.isFinite(value)) fail('number_not_finite');
    return value;
  };
  const readValue = (): Wire => {
    if (depth >= WIRE_MAX_DEPTH) fail('too_large');
    skip();
    if (at >= data.length) fail('not_json');
    const c = data[at];
    if (c === 0x6e) { literal('null'); return { k: 'null' }; }
    if (c === 0x74) { literal('true'); return { k: 'bool', b: true }; }
    if (c === 0x66) { literal('false'); return { k: 'bool', b: false }; }
    if (c === 0x22) return { k: 'str', s: readString() };
    if (c === 0x2d || digit(c)) return { k: 'num', n: readNumber() };
    if (c === 0x5b) {
      at += 1; depth += 1; skip();
      const items: Wire[] = [];
      if (data[at] === 0x5d) { at += 1; depth -= 1; return { k: 'arr', items }; }
      for (;;) {
        items.push(readValue());
        skip();
        if (data[at] === 0x2c) { at += 1; continue; }
        if (data[at] === 0x5d) { at += 1; depth -= 1; return { k: 'arr', items }; }
        fail('not_json');
      }
    }
    if (c === 0x7b) {
      at += 1; depth += 1; skip();
      const keys: string[] = [];
      const vals: Wire[] = [];
      if (data[at] === 0x7d) { at += 1; depth -= 1; return { k: 'obj', keys, vals }; }
      for (;;) {
        skip();
        const key = readString();
        if (keys.includes(key)) fail('duplicate_key');
        if (keys.length >= WIRE_MAX_KEYS) fail('too_large');
        skip();
        if (data[at] !== 0x3a) fail('not_json');
        at += 1;
        const value = readValue();
        keys.push(key);
        vals.push(value);
        skip();
        if (data[at] === 0x2c) { at += 1; continue; }
        if (data[at] === 0x7d) { at += 1; depth -= 1; return { k: 'obj', keys, vals }; }
        fail('not_json');
      }
    }
    return fail('not_json');
  };
  const root = readValue();
  skip();
  // A second value after the first is a second document, not a longer one.
  if (at !== data.length) fail('not_json');
  if (root.k !== 'obj') fail('not_object');
  return root as WireObject;
}

const field = (object: WireObject, name: string): Wire | undefined => {
  const index = object.keys.indexOf(name);
  return index === -1 ? undefined : object.vals[index];
};

/** FFieldReader: records the FIRST refusal and keeps reading, exactly as the engine's does. */
class Fields {
  refusal: Refused | null = null;
  constructor(readonly object: WireObject) {}
  reject(code: string, name: string): undefined {
    if (this.refusal === null) this.refusal = new Refused(code, name);
    return undefined;
  }
  done(): void { if (this.refusal !== null) throw this.refusal; }
  /** The first refusal so far, read live (a property check would stay narrowed across the calls between). */
  failure(): Refused | null { return this.refusal; }
  string(name: string): string | undefined {
    const value = field(this.object, name);
    if (value === undefined) return this.reject('missing_field', name);
    if (value.k !== 'str') return this.reject('wrong_type', name);
    return value.s;
  }
  identity(name: string): string | undefined {
    const value = this.string(name);
    if (value !== undefined && !/[^ \t\n\r]/u.test(value)) return this.reject('identity_rejected', name);
    return value;
  }
  nullableText(name: string): string | null | undefined {
    const value = field(this.object, name);
    if (value === undefined) return this.reject('missing_field', name);
    if (value.k === 'null') return null;
    if (value.k !== 'str') return this.reject('wrong_type', name);
    return value.s;
  }
  bool(name: string): boolean | undefined {
    const value = field(this.object, name);
    if (value === undefined) return this.reject('missing_field', name);
    if (value.k !== 'bool') return this.reject('wrong_type', name);
    return value.b;
  }
  integer(name: string): number | undefined {
    const value = field(this.object, name);
    if (value === undefined) return this.reject('missing_field', name);
    if (value.k !== 'num') return this.reject('wrong_type', name);
    if (value.n !== Math.floor(value.n)) return this.reject('number_not_integer', name);
    if (Math.abs(value.n) > WIRE_MAX_EXACT) return this.reject('number_out_of_range', name);
    return value.n;
  }
  nullableInteger(name: string): number | null | undefined {
    const value = field(this.object, name);
    if (value === undefined) return this.reject('missing_field', name);
    if (value.k === 'null') return null;
    return this.integer(name);
  }
  nullableFlag(name: string): boolean | null | undefined {
    const value = field(this.object, name);
    if (value === undefined) return this.reject('missing_field', name);
    if (value.k === 'null') return null;
    return this.bool(name);
  }
  nullableEnum(name: string, table: TokenTable): string | null | undefined {
    const value = field(this.object, name);
    if (value === undefined) return this.reject('missing_field', name);
    if (value.k === 'null') return null;
    return this.requiredEnum(name, table);
  }
  requiredEnum(name: string, table: TokenTable): string | undefined {
    const value = field(this.object, name);
    if (value === undefined) return this.reject('missing_field', name);
    if (value.k !== 'str') return this.reject('wrong_type', name);
    if (!(TOKENS[table] as readonly string[]).includes(value.s)) return this.reject('unknown_token', name);
    return value.s;
  }
}

const nonNegative = (value: number | null | undefined, name: string) => {
  if (typeof value === 'number' && value < 0) throw new Refused('number_out_of_range', name);
};

function decodeEnvelope(object: WireObject) {
  const f = new Fields(object);
  const envelope = {
    schemaVersion: f.string('schemaVersion'), eventId: f.identity('eventId'), projectId: f.identity('projectId'),
    worldSessionId: f.nullableText('worldSessionId'), juliusInstanceId: f.nullableText('juliusInstanceId'),
    missionId: f.nullableText('missionId'), runId: f.nullableText('runId'), taskId: f.nullableText('taskId'),
    sourceState: f.nullableText('sourceState'), workerRole: f.nullableEnum('workerRole', 'EWonderlandWorkerRole'),
    state: f.requiredEnum('state', 'EWonderlandJuliusState'), stateSource: f.requiredEnum('stateSource', 'EWonderlandJuliusStateSource'),
    terminal: f.bool('terminal'), sequence: f.integer('sequence'), revision: f.integer('revision'),
    metadataDropped: f.integer('metadataDropped'), occurredAt: f.string('occurredAt'),
  };
  // METADATA IS SCALARS ONLY.
  const metadata = field(object, 'metadata');
  if (metadata === undefined) f.reject('missing_field', 'metadata');
  else if (metadata.k !== 'obj') f.reject('wrong_type', 'metadata');
  else if (metadata.vals.some((value) => value.k === 'arr' || value.k === 'obj')) f.reject('wrong_type', 'metadata');
  f.done();
  nonNegative(envelope.sequence, 'sequence');
  nonNegative(envelope.revision, 'revision');
  nonNegative(envelope.metadataDropped, 'metadataDropped');
  return envelope;
}

function decodeSignals(value: Wire | undefined, name: string, f: Fields): void {
  if (value === undefined) { f.reject('missing_field', name); return; }
  if (value.k !== 'arr') { f.reject('wrong_type', name); return; }
  for (const item of value.items) {
    if (item.k !== 'str') { f.reject('wrong_type', name); return; }
    if (!(TOKENS.EWonderlandActivitySignal as readonly string[]).includes(item.s)) { f.reject('unknown_token', name); return; }
  }
}

function decodeActivity(object: WireObject) {
  const f = new Fields(object);
  const activity = {
    schemaVersion: f.string('schemaVersion'), projectId: f.identity('projectId'), runId: f.string('runId'),
    observedAtIso: f.nullableText('observedAtIso'), activeSubagents: f.integer('activeSubagents'),
    subagentsDenied: f.integer('subagentsDenied'), unusedEvents: f.integer('unusedEvents'),
  };
  decodeSignals(field(object, 'signals'), 'signals', f);
  const workers = field(object, 'workers');
  if (workers === undefined) f.reject('missing_field', 'workers');
  else if (workers.k !== 'arr') f.reject('wrong_type', 'workers');
  else {
    for (const item of workers.items) {
      if (item.k !== 'obj') { f.reject('wrong_type', 'workers'); break; }
      const worker = new Fields(item);
      worker.identity('workerId');
      if (worker.refusal !== null) { f.reject(worker.refusal.code, worker.refusal.field); break; }
      const signals = field(item, 'signals');
      if (signals === undefined || signals.k !== 'arr') { f.reject('missing_field', 'workers.signals'); break; }
      decodeSignals(signals, 'workers.signals', f);
    }
  }
  f.done();
  nonNegative(activity.activeSubagents, 'activeSubagents');
  nonNegative(activity.subagentsDenied, 'subagentsDenied');
  nonNegative(activity.unusedEvents, 'unusedEvents');
  return activity;
}

/** WonderlandDecodeDeliveryBytes. */
function decodeDelivery(text: string) {
  const root = parseDocument(text);
  const envelopeValue = field(root, 'envelope');
  if (envelopeValue === undefined) throw new Refused('missing_field', 'envelope');
  if (envelopeValue.k !== 'obj') throw new Refused('wrong_type', 'envelope');
  const envelope = decodeEnvelope(envelopeValue);
  const activityValue = field(root, 'activity');
  if (activityValue === undefined) throw new Refused('missing_field', 'activity');
  if (activityValue.k !== 'obj') throw new Refused('wrong_type', 'activity');
  const activity = decodeActivity(activityValue);
  if (activity.projectId !== envelope.projectId) throw new Refused('identity_rejected', 'activity.projectId');
  if (envelope.runId !== null && activity.runId !== envelope.runId) throw new Refused('identity_rejected', 'activity.runId');
  return { envelope, activity };
}

function decodeFigure(owner: WireObject, name: string, f: Fields): void {
  const value = field(owner, name);
  if (value === undefined) { f.reject('missing_field', name); return; }
  if (value.k !== 'obj') { f.reject('wrong_type', name); return; }
  const inner = new Fields(value);
  const known = inner.bool('known');
  const bad = inner.failure();
  if (bad !== null) { f.reject(bad.code, bad.field); return; }
  const number = field(value, 'value');
  if (number === undefined) { f.reject('missing_field', name); return; }
  // KNOWN AND NULL, or UNKNOWN AND A VALUE, are the two contradictions refused.
  if (known === true && number.k !== 'num') { f.reject('wrong_type', name); return; }
  if (known === false && number.k !== 'null') { f.reject('wrong_type', name); return; }
  inner.nullableEnum('reason', 'EWonderlandUnknownReason');
  const reason = inner.failure();
  if (reason !== null) f.reject(reason.code, reason.field);
}

function decodeMeter(owner: WireObject, name: string, f: Fields): string | undefined {
  const value = field(owner, name);
  if (value === undefined) return f.reject('missing_field', name);
  if (value.k !== 'obj') return f.reject('wrong_type', name);
  const meter = new Fields(value);
  meter.string('schemaVersion'); meter.string('observedAtIso');
  meter.nullableText('tierId'); meter.nullableText('tierLabel'); meter.nullableText('unitLabel'); meter.nullableText('unavailableReason');
  const channel = meter.requiredEnum('channel', 'EWonderlandUsageChannel');
  meter.requiredEnum('status', 'EWonderlandUsageStatus');
  meter.requiredEnum('provenance', 'EWonderlandProvenance');
  meter.requiredEnum('anchor', 'EWonderlandHudAnchor');
  meter.bool('simulated');
  for (const figure of ['capacityUnits', 'usedUnits', 'remainingUnits', 'referenceCapacityUnits', 'capacitySpan', 'fillFraction', 'remainingFraction']) {
    decodeFigure(value, figure, meter);
  }
  if (meter.refusal !== null) return f.reject(meter.refusal.code, meter.refusal.field);
  return channel;
}

function decodeUsageHud(object: WireObject): void {
  const f = new Fields(object);
  f.string('schemaVersion'); f.string('observedAtIso'); f.requiredEnum('anchor', 'EWonderlandHudAnchor');
  const compound = decodeMeter(object, 'compoundAgent', f);
  const single = decodeMeter(object, 'singleAgent', f);
  f.done();
  // THE TWO METERS ARE NOT INTERCHANGEABLE.
  if (compound !== 'compound_agent') throw new Refused('identity_rejected', 'compoundAgent.channel');
  if (single !== 'single_agent') throw new Refused('identity_rejected', 'singleAgent.channel');
}

function decodeRunSnapshot(object: WireObject) {
  const f = new Fields(object);
  const run = {
    schemaVersion: f.string('schemaVersion'), projectId: f.identity('projectId'), runId: f.identity('runId'),
    juliusInstanceId: f.nullableText('juliusInstanceId'), missionId: f.nullableText('missionId'),
    state: f.string('state'), observedAtIso: f.string('observedAtIso'), revision: f.integer('revision'),
    atSequence: f.nullableInteger('atSequence'), activeTasks: f.nullableInteger('activeTasks'), pendingApprovals: f.nullableInteger('pendingApprovals'),
  };
  f.done();
  nonNegative(run.revision, 'run.revision');
  nonNegative(run.atSequence, 'run.atSequence');
  nonNegative(run.activeTasks, 'run.activeTasks');
  nonNegative(run.pendingApprovals, 'run.pendingApprovals');
  return run;
}

function decodeUsageStatus(object: WireObject): void {
  const f = new Fields(object);
  f.requiredEnum('reading', 'EWonderlandUsageReading'); f.nullableText('reason'); f.nullableText('authorityId');
  const age = field(object, 'ageSeconds');
  if (age === undefined) f.reject('missing_field', 'ageSeconds');
  else if (age.k !== 'null' && age.k !== 'num') f.reject('wrong_type', 'ageSeconds');
  else if (age.k === 'num' && age.n < 0) f.reject('number_out_of_range', 'ageSeconds');
  const counts = ['revision', 'foreignProjectReportsRejected', 'staleRevisionsRejected', 'malformedReportsRejected'].map((name) => [name, f.integer(name)] as const);
  f.done();
  for (const [name, value] of counts) nonNegative(value, `usageStatus.${name}`);
}

function decodeBrain(object: WireObject) {
  const f = new Fields(object);
  const brain = {
    schemaVersion: f.string('schemaVersion'), projectId: f.identity('projectId'), runId: f.string('runId'), taskId: f.string('taskId'),
    contentHash: f.string('contentHash'), observedAtIso: f.string('observedAtIso'), truncated: f.bool('truncated'),
    brainRevision: f.integer('brainRevision'), entryCount: f.integer('entryCount'), characterCount: f.integer('characterCount'), redactionCount: f.integer('redactionCount'),
  };
  const kinds = field(object, 'kindCounts');
  if (kinds === undefined) f.reject('missing_field', 'kindCounts');
  else if (kinds.k !== 'obj') f.reject('wrong_type', 'kindCounts');
  else {
    const seen = new Set<string>();
    kinds.keys.forEach((key, index) => {
      const value = kinds.vals[index];
      if (value.k !== 'num') { f.reject('wrong_type', 'kindCounts'); return; }
      if (value.n !== Math.floor(value.n)) { f.reject('number_not_integer', 'kindCounts'); return; }
      if (value.n < 0 || value.n > WIRE_MAX_EXACT) { f.reject('number_out_of_range', 'kindCounts'); return; }
      // AN UNKNOWN KIND IS TOLERATED; every known one must be present.
      if ((TOKENS.EWonderlandBrainKind as readonly string[]).includes(key)) seen.add(key);
    });
    if (TOKENS.EWonderlandBrainKind.some((kind) => !seen.has(kind))) f.reject('missing_field', 'kindCounts');
  }
  f.done();
  for (const name of ['brainRevision', 'entryCount', 'characterCount', 'redactionCount'] as const) nonNegative(brain[name], `brain.${name}`);
  return brain;
}

function decodeCard(object: WireObject): void {
  const f = new Fields(object);
  f.string('cardRevision');
  for (const name of ['hasPromptArchitect', 'hasCodingAgent', 'hasIndependentReviewer', 'swarmEligible']) f.nullableFlag(name);
  f.nullableEnum('autonomy', 'EWonderlandAutonomy');
  const roles = field(object, 'eligibleSwarmRoles');
  if (roles === undefined) f.reject('missing_field', 'eligibleSwarmRoles');
  else if (roles.k !== 'arr') f.reject('wrong_type', 'eligibleSwarmRoles');
  else if (roles.items.some((item) => item.k !== 'str')) f.reject('wrong_type', 'eligibleSwarmRoles');
  f.done();
}

function decodeGate(object: WireObject) {
  const f = new Fields(object);
  const gate = {
    schemaVersion: f.string('schemaVersion'), projectId: f.identity('projectId'), runId: f.identity('runId'), gateId: f.identity('gateId'),
    taskId: f.nullableText('taskId'), reasonCode: f.string('reasonCode'), requestedAtIso: f.string('requestedAtIso'),
    operation: f.requiredEnum('operation', 'EWonderlandGatedOperation'),
  };
  f.done();
  return gate;
}

const requiredObject = (root: WireObject, name: string): WireObject => {
  const value = field(root, name);
  if (value === undefined) throw new Refused('missing_field', name);
  if (value.k !== 'obj') throw new Refused('wrong_type', name);
  return value;
};

/** WonderlandDecodeHydrationBytes. */
function decodeHydration(text: string) {
  const root = parseDocument(text);
  const f = new Fields(root);
  const head = { schemaVersion: f.string('schemaVersion'), projectId: f.identity('projectId'), worldSessionId: f.nullableText('worldSessionId'), observedAtIso: f.string('observedAtIso') };
  f.done();
  // THE SCHEMA, BEFORE ANY FIELD IS BELIEVED.
  if (head.schemaVersion !== HYDRATION_SCHEMA) throw new Refused('schema_rejected', 'schemaVersion');
  const run = decodeRunSnapshot(requiredObject(root, 'run'));
  const state = new Fields(root);
  const visualState = state.requiredEnum('visualState', 'EWonderlandJuliusState');
  state.done();
  const terminalReader = new Fields(root);
  const terminal = terminalReader.bool('terminal');
  terminalReader.done();
  decodeUsageHud(requiredObject(root, 'usage'));
  decodeUsageStatus(requiredObject(root, 'usageStatus'));
  const activity = decodeActivity(requiredObject(root, 'activity'));
  const brain = decodeBrain(requiredObject(root, 'brain'));
  decodeCard(requiredObject(root, 'card'));
  // THE GATES: required as a field, permitted to be empty.
  const gatesValue = field(root, 'humanGates');
  if (gatesValue === undefined) throw new Refused('missing_field', 'humanGates');
  if (gatesValue.k !== 'arr') throw new Refused('wrong_type', 'humanGates');
  const gates = gatesValue.items.map((item) => {
    if (item.k !== 'obj') throw new Refused('wrong_type', 'humanGates');
    return decodeGate(item);
  });
  // EVERY HALF NAMES THE SAME RUN IN THE SAME PROJECT.
  if (run.projectId !== head.projectId) throw new Refused('identity_rejected', 'run.projectId');
  if (activity.projectId !== head.projectId) throw new Refused('identity_rejected', 'activity.projectId');
  if (activity.runId !== run.runId) throw new Refused('identity_rejected', 'activity.runId');
  if (brain.projectId !== head.projectId) throw new Refused('identity_rejected', 'brain.projectId');
  for (const gate of gates) {
    if (gate.projectId !== head.projectId) throw new Refused('identity_rejected', 'humanGates.projectId');
    if (gate.runId !== run.runId) throw new Refused('identity_rejected', 'humanGates.runId');
  }
  return { ...head, run, visualState, terminal, activity, brain, gates };
}

/** Json::DataOf: the body is `{"data":{...}}`, or it is refused whole. */
function dataOf(body: string): Record<string, unknown> {
  const root: unknown = JSON.parse(body);
  if (root === null || typeof root !== 'object' || Array.isArray(root)) throw new Refused('not_object', 'body');
  const data = (root as Record<string, unknown>).data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Refused('missing_field', 'data');
  return data as Record<string, unknown>;
}

/**
 * The hydrate leg: UnwrapData (re-serialised, as the engine re-serialises the
 * `data` object), the strict decoder, then AdoptHydration's identity rules
 * against what the world asked for.
 */
function clientHydrate(body: string, asked: { readonly projectId: string; readonly runId: string }) {
  const hydration = decodeHydration(JSON.stringify(dataOf(body)));
  if (hydration.projectId !== asked.projectId) throw new Refused('foreign_project', 'adopt');
  if (hydration.run.runId !== asked.runId) throw new Refused('foreign_run', 'adopt');
  if (hydration.run.projectId !== hydration.projectId) throw new Refused('foreign_project', 'adopt.run');
  return hydration;
}

/** The events leg: SplitPage, then every delivery through the strict decoder (the first refusal stops the page). */
function clientPage(body: string, asked: { readonly projectId: string; readonly runId: string }) {
  const data = dataOf(body);
  if (!Array.isArray(data.deliveries)) throw new Refused('missing_field', 'deliveries');
  if (typeof data.nextCursor !== 'number' || !Number.isSafeInteger(data.nextCursor)) throw new Refused('missing_field', 'nextCursor');
  const deliveries = (data.deliveries as unknown[]).map((delivery) => {
    if (delivery === null || typeof delivery !== 'object' || Array.isArray(delivery)) throw new Refused('not_object', 'delivery');
    const decoded = decodeDelivery(JSON.stringify(delivery));
    // The subsystem applies only its own project's envelopes; a foreign one is refused there.
    if (decoded.envelope.projectId !== asked.projectId) throw new Refused('foreign_project', 'apply');
    if (decoded.envelope.runId !== null && decoded.envelope.runId !== asked.runId) throw new Refused('foreign_run', 'apply');
    return decoded;
  });
  return { deliveries, nextCursor: data.nextCursor as number };
}

/** ParseResult, strict where the engine coerces, plus the run check (JS:837). */
function clientResult(body: string, askedRunId: string) {
  const data = dataOf(body);
  const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  const need = (ok: boolean, name: string) => { if (!ok) throw new Refused('refused', name); };
  need(data.schemaVersion === RESULT_SCHEMA, 'schemaVersion');
  need(typeof data.runId === 'string' && data.runId !== '', 'runId');
  need(typeof data.juliusState === 'string', 'juliusState');
  need(typeof data.verified === 'boolean', 'verified');
  need(typeof data.terminal === 'boolean', 'terminal');
  need(Array.isArray(data.criteria), 'criteria');
  need(Array.isArray(data.deliverables), 'deliverables');
  need(Array.isArray(data.openFindings), 'openFindings');
  need(isObject(data.cost) && typeof data.cost.visible === 'boolean', 'cost');
  need(data.taskState === undefined || data.taskState === null || typeof data.taskState === 'string', 'taskState');
  for (const criterion of data.criteria as unknown[]) need(isObject(criterion) && typeof criterion.satisfied === 'boolean', 'criteria.satisfied');
  for (const deliverable of data.deliverables as unknown[]) need(isObject(deliverable) && typeof deliverable.evidenceId === 'string', 'deliverables.evidenceId');
  if (data.review !== undefined && data.review !== null) {
    const review = data.review;
    need(isObject(review), 'review');
    if (isObject(review)) {
      need(review.verdict === undefined || review.verdict === null || typeof review.verdict === 'string', 'review.verdict');
      need(review.repairRounds === undefined || typeof review.repairRounds === 'number', 'review.repairRounds');
      need(review.reReviewedAfterRepair === undefined || typeof review.reReviewedAfterRepair === 'boolean', 'review.reReviewedAfterRepair');
    }
  }
  if (data.failure !== undefined && data.failure !== null) {
    const failure = data.failure;
    need(isObject(failure), 'failure');
    if (isObject(failure)) {
      need(typeof failure.reasonCode === 'string', 'failure.reasonCode');
      need(failure.failureClass === undefined || failure.failureClass === null || typeof failure.failureClass === 'string', 'failure.failureClass');
    }
  }
  const cost = data.cost as Record<string, unknown>;
  if (cost.visible === true) {
    need(typeof cost.knownUsdMicros === 'number', 'cost.knownUsdMicros');
    need(typeof cost.unknownComponents === 'number', 'cost.unknownComponents');
    need(typeof cost.complete === 'boolean', 'cost.complete');
  }
  need(data.tokens === undefined || typeof data.tokens === 'string', 'tokens');
  need(data.withheldDetails === undefined || typeof data.withheldDetails === 'number', 'withheldDetails');
  // A result for another run is not this one's (JS:837).
  need(data.runId === askedRunId, 'runId (asked)');
  return {
    runId: data.runId as string,
    criteriaMet: (data.criteria as Array<{ satisfied: boolean }>).filter((criterion) => criterion.satisfied).length,
    criteriaTotal: (data.criteria as unknown[]).length,
    deliverableIds: (data.deliverables as Array<{ evidenceId: string }>).map((deliverable) => deliverable.evidenceId),
    openFindings: (data.openFindings as unknown[]).length,
    costVisible: cost.visible === true,
  };
}

/* ===================================================================== */
/*  THE FIXTURE: one run, as PostgreSQL and Julius hold it                */
/* ===================================================================== */

const PLAYER = 'ghu-424242';
const PROJECT = 'project-alpha';
const RUN = 'run:0a1b2c3d';
const AT = '2026-10-07T12:00:00.000Z';
const NOW = Date.parse(AT);

/** A Julius event as main's appender writes it: FLAT, the operational event whole. */
const flatEvent = (sequence: number, type: string, facts: Record<string, string | number | boolean | null>, extra: { taskId?: string; workerId?: string } = {}) => ({
  event_id: `event-${sequence}`, stream_id: RUN, project_id: PROJECT, sequence: String(sequence), event_type: `julius.${type}`, occurred_at: AT,
  payload: {
    eventId: `event-${sequence}`, runId: RUN, projectId: PROJECT, type, taskId: extra.taskId ?? null, workerId: extra.workerId ?? null,
    correlationId: `corr-${sequence}`, causationId: null, occurredAt: AT, facts,
  },
});

interface Ledger {
  readonly gates?: readonly Record<string, unknown>[];
  readonly events?: readonly ReturnType<typeof flatEvent>[];
}

const DEFAULT_EVENTS = [
  flatEvent(1, 'run.created', { missionId: 'mission:alpha' }),
  flatEvent(2, 'run.transitioned', { to: 'EXECUTING', reasonCode: 'PLAN_ACCEPTED' }),
  flatEvent(3, 'worker.dispatched', { role: 'CODING_AGENT', attempt: 1 }, { taskId: 'task-build', workerId: 'worker-coder' }),
  flatEvent(4, 'run.transitioned', { to: 'REVIEWING', reasonCode: 'BUILD_SUBMITTED', outcome: 'accepted' }),
];

/** A pg pool answering the reader's statements with rows shaped as `pg` returns them. */
function ledgerPool(ledger: Ledger = {}): Pool {
  const events = ledger.events ?? DEFAULT_EVENTS;
  const atSequence = events.reduce((max, event) => Math.max(max, Number(event.sequence)), 0);
  return {
    query: async (sql: string, values: readonly unknown[] = []) => {
      const ours = values[0] === RUN && values[1] === PROJECT;
      if (sql.includes('julius_context_snapshots')) {
        return { rows: ours ? [{
          task_id: 'task-plan', project_brain_revision: '3', content_hash: 'sha256:0f9e8d7c', character_count: '2048', redaction_count: '1',
          truncated: false, created_at: AT, kinds: ['DECISION', 'CONSTRAINT', 'RESEARCH_NOTE'],
        }] : [] };
      }
      if (sql.includes('LEFT JOIN LATERAL')) {
        if (!ours) return { rows: [] };
        const after = Number(values[2]);
        const page = events.filter((event) => Number(event.sequence) > after).slice(0, Number(values[3]));
        return { rows: page.length > 0 ? page.map((event) => ({ revision: '9', ...event }))
          : [{ revision: '9', event_id: null, stream_id: null, project_id: null, sequence: null, event_type: null, payload: null, occurred_at: null }] };
      }
      if (sql.includes('AS at_sequence')) {
        return { rows: ours ? [{
          state: 'REVIEWING', version: '9', mission_id: 'mission:alpha', card_revision: 'card:alpha:2',
          at_sequence: String(atSequence), active_tasks: '1', pending_approvals: String((ledger.gates ?? []).length),
          open_gates: (ledger.gates ?? []).length === 0 ? null : ledger.gates, observed_at: AT,
        }] : [] };
      }
      if (sql.includes('sequence<=$3')) {
        return { rows: ours ? events.filter((event) => Number(event.sequence) <= Number(values[2])) : [] };
      }
      return { rows: [] };
    },
  } as unknown as Pool;
}

const VIEW: JuliusMissionResultView = {
  runId: RUN, missionId: 'mission:alpha', state: 'COMPLETED', verified: true, terminal: true,
  criteria: [
    { criterionId: 'criterion-renders', description: 'The page renders the leaderboard', requiredEvidenceTypes: ['TEST'], satisfied: true, basis: 'EVIDENCE', evidenceIds: ['evidence-test-1'] },
    { criterionId: 'criterion-complete', description: 'The mission is complete', requiredEvidenceTypes: [], satisfied: true, basis: 'COMPLETION', evidenceIds: [] },
  ],
  deliverables: [
    { evidenceId: 'evidence-diff-1', taskId: 'task-build', type: 'DIFF', safeSummary: 'Added the leaderboard component', artifactRef: null, integrityHash: null, retained: false, occurredAt: AT },
    { evidenceId: 'evidence-test-1', taskId: 'task-build', type: 'TEST', safeSummary: '12 tests passed', artifactRef: null, integrityHash: null, retained: false, occurredAt: AT },
  ],
  outstandingFindings: [],
  reviewDecisions: [
    { taskId: 'task-build', action: 'REPAIR', reasonCode: 'TESTS_MISSING' },
    { taskId: 'task-build', action: 'ACCEPT', reasonCode: 'MISSION_VERIFIED' },
  ],
  cost: { knownUsdMicros: 84_210, unknownComponents: 0, complete: true },
  failure: null,
};

const OWNER: WonderlandProjectMembershipSource = {
  lookup: async ({ playerId, projectId }) => (playerId === PLAYER && projectId === PROJECT ? { playerId, projectId, role: 'OWNER' } : null),
};
const MEMBER_TABLE = Object.freeze({ MEMBER: Object.freeze(['read_world_state', 'read_mission_result'] as const) });

function worldOver(pool: Pool, membership: WonderlandProjectMembershipSource = OWNER, view: JuliusMissionResultView = VIEW): WonderlandJuliusWorld {
  const results: WonderlandJuliusResultSource = {
    result: async ({ projectId, runId }) => (projectId === PROJECT && runId === view.runId ? view : null),
  };
  return { read: async (work) => work({ membership, reader: new WonderlandJuliusReaderPostgres(pool), results }) };
}

function nativeSession(store: BrowserSessionStore): string {
  const grant = store.createGrant({ origin: NATIVE_WORLD_AUDIENCE, now: NOW, scope: 'native_world', participantId: PLAYER, projectId: PROJECT });
  const redeemed = store.consumeGrant({ grantId: grant.grantId, secret: grant.secret, origin: NATIVE_WORLD_AUDIENCE, now: NOW });
  if (!redeemed.ok) throw new Error('fixture could not redeem');
  return redeemed.session.token;
}

/**
 * One request exactly as the Unreal client makes it: `Authorization: Relay-Session
 * <token>`, NO Origin, `projectId=<url-encoded>&runId=<raw>&cursor=<n>` (RunQuery),
 * and the page route with `mode=page` first (ReadPage).
 */
async function asClient(route: 'hydrate' | 'events' | 'result', deps: Omit<WonderlandJuliusRouteDeps, 'sessions'>, cursor = 0) {
  const store = createBrowserSessionStore();
  const token = nativeSession(store);
  const query = `projectId=${encodeURIComponent(PROJECT)}&runId=${RUN}&cursor=${cursor}`;
  const url = route === 'events' ? `/wonderland/julius/events?mode=page&${query}` : `/wonderland/julius/${route}?${query}`;
  const answer = await handleWonderlandJuliusRoute({
    method: 'GET', path: `/wonderland/julius/${route}`, url, authorization: `Relay-Session ${token}`, origin: undefined, now: NOW,
  }, { ...deps, sessions: store });
  // The world session id is a fresh random id per session: the one value in a body that is the caller's own, not the run's.
  const body = JSON.stringify(answer?.body ?? null).split(JSON.stringify(sessionIdOf(store, token)).slice(1, -1)).join('world-session');
  return { status: answer?.status, body };
}

function sessionIdOf(store: BrowserSessionStore, token: string): string {
  const verified = store.verifyNativeSession({ token, now: NOW });
  if (!verified.ok) throw new Error('fixture session did not verify');
  return verified.sessionId;
}

const ASKED = { projectId: PROJECT, runId: RUN };

/* ===================================================================== */
/*  CONTROLS: the port refuses what the client refuses                    */
/* ===================================================================== */

describe('the ported client decoders can fail (controls)', () => {
  const good = async () => (await asClient('hydrate', { world: worldOver(ledgerPool()) })).body;
  const mutateHydration = async (change: (data: Record<string, any>) => void) => {
    const body = JSON.parse(await good());
    change(body.data);
    return JSON.stringify(body);
  };
  const refusalOf = (fn: () => unknown) => {
    try { fn(); return null; } catch (error) { return error instanceof Refused ? `${error.code}${error.field === '' ? '' : ` at ${error.field}`}` : `THREW ${String(error)}`; }
  };

  it('CONTROL: the real hydration decodes, so every refusal below is the mutation\'s', async () => {
    const body = await good();
    expect(refusalOf(() => clientHydrate(body, ASKED))).toBeNull();
    expect(refusalOf(() => clientHydrate('{"data":{}}', ASKED))).toBe('missing_field at schemaVersion');
    expect(refusalOf(() => clientHydrate('{"hydration":{}}', ASKED))).toBe('missing_field at data');
  });

  const hydrationCases: Array<[string, (data: Record<string, any>) => void, string]> = [
    ['the schema is another version', (d) => { d.schemaVersion = 'relay-wonderland-hydration.v2'; }, 'schema_rejected at schemaVersion'],
    ['humanGates is missing', (d) => { delete d.humanGates; }, 'missing_field at humanGates'],
    ['the drawable state is a word the client cannot name', (d) => { d.visualState = 'running'; }, 'unknown_token at visualState'],
    ['the run names another project', (d) => { d.run.projectId = 'project-beta'; }, 'identity_rejected at run.projectId'],
    ['the activity names another run', (d) => { d.activity.runId = 'run:other'; }, 'identity_rejected at activity.runId'],
    ['a known brain kind is missing', (d) => { delete d.brain.kindCounts.EVIDENCE; }, 'missing_field at kindCounts'],
    ['the two meters are swapped', (d) => { [d.usage.compoundAgent, d.usage.singleAgent] = [d.usage.singleAgent, d.usage.compoundAgent]; }, 'identity_rejected at compoundAgent.channel'],
    ['a count is negative', (d) => { d.run.atSequence = -1; }, 'number_out_of_range at run.atSequence'],
    ['a sequence is not whole', (d) => { d.run.revision = 9.5; }, 'number_not_integer at revision'],
    ['a C.A.R.D. slot is a string', (d) => { d.card.hasCodingAgent = 'unknown'; }, 'wrong_type at hasCodingAgent'],
    ['the project is blank', (d) => { d.projectId = '   '; }, 'identity_rejected at projectId'],
    ['a known figure carries null', (d) => { d.usage.compoundAgent.usedUnits = { known: true, value: null, reason: null }; }, 'wrong_type at usedUnits'],
  ];
  for (const [name, change, expected] of hydrationCases) {
    it(`a hydration is refused whole when ${name}`, async () => {
      const body = await mutateHydration(change);
      expect(refusalOf(() => clientHydrate(body, ASKED))).toBe(expected);
    });
  }

  it('the world refuses a hydration of another project or another run (AdoptHydration)', async () => {
    const body = await good();
    expect(refusalOf(() => clientHydrate(body, { projectId: 'project-beta', runId: RUN }))).toBe('foreign_project at adopt');
    expect(refusalOf(() => clientHydrate(body, { projectId: PROJECT, runId: 'run:other' }))).toBe('foreign_run at adopt');
  });

  it('the strict reader refuses duplicate keys, trailing content, bare tokens and non-finite numbers', () => {
    expect(refusalOf(() => parseDocument('{"a":1,"a":2}'))).toBe('duplicate_key');
    expect(refusalOf(() => parseDocument('{"a":1} {"b":2}'))).toBe('not_json');
    expect(refusalOf(() => parseDocument('{"a":NaN}'))).toBe('not_json');
    expect(refusalOf(() => parseDocument('{"a":1e400}'))).toBe('number_not_finite');
    expect(refusalOf(() => parseDocument('{"a":01}'))).toBe('not_json');
    expect(refusalOf(() => parseDocument('[1]'))).toBe('not_object');
    expect(refusalOf(() => parseDocument(`{"a":"${'x'.repeat(WIRE_MAX_STRING_BYTES + 1)}"}`))).toBe('too_large');
    expect(refusalOf(() => parseDocument(`{"a":${'['.repeat(WIRE_MAX_DEPTH)}${']'.repeat(WIRE_MAX_DEPTH)}}`))).toBe('too_large');
    expect(refusalOf(() => parseDocument('{"a":"\\ud800"}'))).toBe('not_json');
    expect(refusalOf(() => parseDocument('{"a":"\\u00e9\\ud83d\\ude00","b":[true,false,null,-0.5e-3]}'))).toBeNull();
  });

  it('a page is refused when it is not one, and a delivery when it breaks a rule', async () => {
    const page = JSON.parse((await asClient('events', { world: worldOver(ledgerPool()) })).body);
    expect(refusalOf(() => clientPage(JSON.stringify(page), ASKED))).toBeNull();
    expect(refusalOf(() => clientPage(JSON.stringify({ data: { ...page.data, deliveries: 'none' } }), ASKED))).toBe('missing_field at deliveries');
    expect(refusalOf(() => clientPage(JSON.stringify({ data: { deliveries: page.data.deliveries } }), ASKED))).toBe('missing_field at nextCursor');
    expect(refusalOf(() => clientPage(JSON.stringify({ data: { ...page.data, deliveries: ['a string'] } }), ASKED))).toBe('not_object at delivery');
    const first = page.data.deliveries[0];
    const broken = (change: (delivery: Record<string, any>) => void) => {
      const copy = JSON.parse(JSON.stringify(first));
      change(copy);
      return refusalOf(() => decodeDelivery(JSON.stringify(copy)));
    };
    expect(broken((d) => { delete d.envelope; })).toBe('missing_field at envelope');
    expect(broken((d) => { d.activity.projectId = 'project-beta'; })).toBe('identity_rejected at activity.projectId');
    expect(broken((d) => { d.envelope.metadata = { nested: { a: 1 } }; })).toBe('wrong_type at metadata');
    expect(broken((d) => { d.envelope.state = 'EXECUTING'; })).toBe('unknown_token at state');
    expect(broken((d) => { d.activity.signals = ['thinking']; })).toBe('unknown_token at signals');
    expect(broken((d) => { d.envelope.sequence = -3; })).toBe('number_out_of_range at sequence');
  });

  it('a result is refused whole when a required field is missing or wrong, and when it is another run\'s', async () => {
    const body = JSON.parse((await asClient('result', { world: worldOver(ledgerPool()) })).body);
    expect(refusalOf(() => clientResult(JSON.stringify(body), RUN))).toBeNull();
    const broken = (change: (data: Record<string, any>) => void, asked = RUN) => {
      const copy = JSON.parse(JSON.stringify(body));
      change(copy.data);
      return refusalOf(() => clientResult(JSON.stringify(copy), asked));
    };
    expect(broken((d) => { d.schemaVersion = 'relay-wonderland-julius-result.v2'; })).toBe('refused at schemaVersion');
    expect(broken(() => undefined, 'run:asked-for-another')).toBe('refused at runId (asked)');
    expect(broken((d) => { delete d.cost.knownUsdMicros; })).toBe('refused at cost.knownUsdMicros');
    expect(broken((d) => { delete d.criteria[0].satisfied; })).toBe('refused at criteria.satisfied');
    expect(broken((d) => { d.deliverables[0].evidenceId = 7; })).toBe('refused at deliverables.evidenceId');
    expect(broken((d) => { d.verified = 'true'; })).toBe('refused at verified');
    expect(broken((d) => { delete d.openFindings; })).toBe('refused at openFindings');
    expect(refusalOf(() => clientResult(JSON.stringify(body.data), RUN))).toBe('missing_field at data');
  });
});

/* ===================================================================== */
/*  R6: each route's real body, through the client's own rules            */
/* ===================================================================== */

describe('R6: every route\'s body decodes by the client\'s rules', () => {
  it('hydrate: the decoder accepts it whole, and the world adopts it for the run it asked about', async () => {
    const { status, body } = await asClient('hydrate', { world: worldOver(ledgerPool({
      gates: [{ gate_id: 'approval-1', task_id: 'task-build', operation: 'EXECUTE_PROCESS', reason_code: 'CARD_APPROVAL_REQUIRED', requested_at: AT }],
    })) });
    expect(status).toBe(200);
    const hydration = clientHydrate(body, ASKED);
    expect(hydration.schemaVersion).toBe(HYDRATION_SCHEMA);
    expect(hydration.run).toMatchObject({ projectId: PROJECT, runId: RUN, state: 'REVIEWING', revision: 9, atSequence: 4, pendingApprovals: 1 });
    expect(hydration.visualState).toBe('independent_review');
    expect(hydration.gates).toEqual([expect.objectContaining({ gateId: 'approval-1', operation: 'EXECUTE_PROCESS', reasonCode: 'CARD_APPROVAL_REQUIRED' })]);
  });

  it('events?mode=page: SplitPage accepts it and EVERY delivery decodes, in ledger order, for the asked run', async () => {
    const { status, body } = await asClient('events', { world: worldOver(ledgerPool()) });
    expect(status).toBe(200);
    const page = clientPage(body, ASKED);
    expect(page.deliveries.length).toBeGreaterThan(0);
    const sequences = page.deliveries.map((delivery) => delivery.envelope.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => (a ?? 0) - (b ?? 0)));
    expect(page.nextCursor).toBe(4);
    expect(page.deliveries.map((delivery) => delivery.envelope.state)).toContain('independent_review');
  });

  it('events: a cursor resume decodes the same way and starts strictly after the cursor', async () => {
    const { body } = await asClient('events', { world: worldOver(ledgerPool()) }, 2);
    const page = clientPage(body, ASKED);
    expect(page.deliveries.every((delivery) => (delivery.envelope.sequence ?? 0) > 2)).toBe(true);
    expect(page.nextCursor).toBe(4);
    const end = clientPage((await asClient('events', { world: worldOver(ledgerPool()) }, 4)).body, ASKED);
    expect(end).toEqual({ deliveries: [], nextCursor: 4 });
  });

  it('result: ParseResult accepts the owner\'s body, cost visible with all three parts', async () => {
    const { status, body } = await asClient('result', { world: worldOver(ledgerPool()) });
    expect(status).toBe(200);
    expect(clientResult(body, RUN)).toEqual({
      runId: RUN, criteriaMet: 2, criteriaTotal: 2, deliverableIds: ['evidence-diff-1', 'evidence-test-1'], openFindings: 0, costVisible: true,
    });
  });

  it('result: a member\'s body (cost hidden) is accepted too -- `cost: {visible:false}` is all the client needs', async () => {
    const member: WonderlandProjectMembershipSource = { lookup: async ({ playerId, projectId }) => ({ playerId, projectId, role: 'MEMBER' }) };
    const { status, body } = await asClient('result', { world: worldOver(ledgerPool(), member), roleCapabilities: MEMBER_TABLE });
    expect(status).toBe(200);
    expect(JSON.parse(body).data.cost).toEqual({ visible: false });
    expect(clientResult(body, RUN).costVisible).toBe(false);
    expect(body).not.toContain('84210');
  });
});

/* ===================================================================== */
/*  R5: deterministic -- the exact schema strings and repeatable bodies   */
/* ===================================================================== */

describe('R5: a deterministic contract', () => {
  it('the schema strings are EXACTLY the ones the client compares against', async () => {
    expect(JSON.parse((await asClient('hydrate', { world: worldOver(ledgerPool()) })).body).data.schemaVersion).toBe('relay-wonderland-hydration.v1');
    expect(JSON.parse((await asClient('result', { world: worldOver(ledgerPool()) })).body).data.schemaVersion).toBe('relay-wonderland-julius-result.v1');
  });

  it('the same run read twice is the same bytes, on every route (no clock but observedAtIso, which is the database\'s)', async () => {
    for (const route of ['hydrate', 'events', 'result'] as const) {
      const first = await asClient(route, { world: worldOver(ledgerPool()) });
      const second = await asClient(route, { world: worldOver(ledgerPool()) });
      expect(second.body, route).toBe(first.body);
    }
  });
});

/* ===================================================================== */
/*  R4: a secret seeded in the run reaches no body and no log line        */
/* ===================================================================== */

describe('R4: no secret in any response or log line', () => {
  // ASSEMBLED AT RUN TIME, so no credential-shaped literal sits in this file for a
  // repository scan to find: each is the SHAPE the boundary redactor recognises.
  const SECRETS = {
    anthropic: ['sk', 'ant', 'api03'].join('-') + '-' + 'Zq7x'.repeat(10),
    github: ['gh', 'p_'].join('') + 'A1b2C3d4'.repeat(5),
    awsKeyId: ['AK', 'IA'].join('') + 'Q7W8E9R0T1Y2U3I4',
    bearer: ['Bear', 'er '].join('') + 'tok_' + '9f8e7d6c5b4a'.repeat(3),
    connection: ['postgres', '://', 'world', ':', 'hunter2hunter2', '@', 'db.internal:5432/julius'].join(''),
  };
  const MARKER = 'BENIGN_MARKER_7Q';
  const leaky = Object.values(SECRETS);

  afterEach(() => { vi.restoreAllMocks(); });

  const seededLedger = (): Ledger => ({
    gates: [
      { gate_id: 'approval-1', task_id: 'task-build', operation: 'EXECUTE_PROCESS', reason_code: SECRETS.awsKeyId, requested_at: AT },
      { gate_id: 'approval-2', task_id: 'task-build', operation: 'ACCESS_NETWORK', reason_code: MARKER, requested_at: AT },
    ],
    events: [
      flatEvent(1, 'run.created', { missionId: 'mission:alpha' }),
      flatEvent(2, 'run.transitioned', { to: 'EXECUTING', reasonCode: SECRETS.anthropic }),
      flatEvent(3, 'run.transitioned', { to: 'REVIEWING', reasonCode: MARKER, outcome: SECRETS.bearer }),
      flatEvent(4, 'finding.recorded', { severity: SECRETS.github, reasonCode: SECRETS.connection }, { taskId: 'task-build', workerId: 'worker-reviewer' }),
      flatEvent(5, 'run.transitioned', { to: 'REPAIRING', outcome: ['thinking', 'process:', 'try', 'the', 'key'].join(' ') }),
    ],
  });

  const seededView: JuliusMissionResultView = {
    ...VIEW,
    state: 'FAILED', verified: false,
    criteria: [
      { ...VIEW.criteria[0], description: `Use ${SECRETS.anthropic} to call the API` },
      { ...VIEW.criteria[1], description: `${MARKER} stays readable` },
    ],
    deliverables: [
      { ...VIEW.deliverables[0], safeSummary: `Wrote C:\\Users\\founder\\secrets\\deploy.env and ${SECRETS.github}`, artifactRef: '/home/founder/.ssh/id_ed25519', integrityHash: 'not-a-digest' },
    ],
    outstandingFindings: [
      { findingId: 'finding-1', taskId: 'task-build', claim: `Leaked ${SECRETS.bearer} in the log`, severity: 'HIGH' },
      { findingId: 'finding-2', taskId: 'task-build', claim: 'Error: boom\n    at Object.<anonymous> (C:\\work\\x.ts:1:1)', severity: 'LOW' },
    ],
    reviewDecisions: [{ taskId: 'task-build', action: 'HALT', reasonCode: SECRETS.connection }],
    failure: { reasonCode: SECRETS.awsKeyId, failureClass: `chain of thought: ${SECRETS.anthropic}` },
  };

  it('hydrate, events and result -- for the owner and over every route -- carry no seeded secret, and neither does any log line', async () => {
    const logged: string[] = [];
    for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')); });
    }
    const bodies: string[] = [];
    for (const route of ['hydrate', 'events', 'result'] as const) {
      const { status, body } = await asClient(route, {
        world: worldOver(ledgerPool(seededLedger()), OWNER, seededView),
        log: (line) => logged.push(line),
        onAuthorization: (decision) => logged.push(JSON.stringify(decision)),
      });
      expect(status, `${route}: ${body}`).toBe(200);
      bodies.push(body);
    }
    // And the refusals' log lines, for a non-member and a store that fails with a secret in its message.
    for (const deps of [
      { world: worldOver(ledgerPool(seededLedger()), { lookup: async () => null }, seededView) },
      { world: { read: async () => { throw Object.assign(new Error(`connect ${SECRETS.connection} failed`), { code: '08006' }); } } },
    ] as const) {
      await asClient('result', { ...deps, log: (line) => logged.push(line) });
    }
    for (const secret of leaky) {
      for (const [index, body] of bodies.entries()) expect(body.includes(secret), `body ${index} carries ${secret.slice(0, 6)}...`).toBe(false);
      for (const line of logged) expect(line.includes(secret), `a log line carries ${secret.slice(0, 6)}...: ${line}`).toBe(false);
    }
    expect(bodies.join('\n')).not.toMatch(/founder|\.ssh|id_ed25519|chain of thought|thinking process|Object\.<anonymous>/u);
  });

  it('CONTROL: the fields the secrets were seeded into DO cross -- the screen removed the secrets, not the fields', async () => {
    const hydrate = await asClient('hydrate', { world: worldOver(ledgerPool(seededLedger()), OWNER, seededView) });
    const events = await asClient('events', { world: worldOver(ledgerPool(seededLedger()), OWNER, seededView) });
    const result = await asClient('result', { world: worldOver(ledgerPool(seededLedger()), OWNER, seededView) });
    // The gate's reason code crosses when it is a code, and is blanked when it is a credential.
    const gates = JSON.parse(hydrate.body).data.humanGates as Array<{ gateId: string; reasonCode: string }>;
    expect(gates.map((gate) => [gate.gateId, gate.reasonCode])).toEqual([['approval-1', ''], ['approval-2', MARKER]]);
    // An event's reason code crosses as metadata; a secret-shaped VALUE is DROPPED, and counted.
    const deliveries = JSON.parse(events.body).data.deliveries as Array<{ envelope: { sequence: number; metadata: Record<string, unknown>; metadataDropped: number } }>;
    const bySequence = new Map(deliveries.map((delivery) => [delivery.envelope.sequence, delivery.envelope]));
    // seq 2: the key under `reasonCode` is gone, and the drop is counted.
    expect(bySequence.get(2)?.metadata.reasonCode).toBeUndefined();
    expect(bySequence.get(2)?.metadataDropped).toBe(1);
    // seq 3: the innocent code crosses verbatim; the bearer beside it was already redacted upstream (the normalizer).
    expect(bySequence.get(3)?.metadata.reasonCode).toBe(MARKER);
    expect(JSON.stringify(bySequence.get(3)?.metadata)).not.toContain(SECRETS.bearer.split(' ')[1]);
    // seq 4 is a finding, which is not a world envelope at all; seq 5's reasoning is dropped and counted.
    expect(bySequence.has(4)).toBe(false);
    expect(bySequence.get(5)?.metadata.outcome).toBeUndefined();
    expect(bySequence.get(5)?.metadataDropped).toBe(1);
    // The criterion that held no secret is shown verbatim; the projection counts what it withheld.
    const data = JSON.parse(result.body).data as { criteria: Array<{ description: string }>; withheldDetails: number; deliverables: Array<{ artifactRef: unknown; integrityHash: unknown }> };
    expect(data.criteria[1].description).toBe(`${MARKER} stays readable`);
    expect(data.withheldDetails).toBeGreaterThanOrEqual(8);
    expect(data.deliverables[0]).toMatchObject({ artifactRef: null, integrityHash: null });
    // And every body still decodes by the client's rules: screening never broke the contract.
    clientHydrate(hydrate.body, ASKED);
    clientPage(events.body, ASKED);
    clientResult(result.body, RUN);
  });
});

/* ===================================================================== */
/*  R5: GOLDEN BODIES -- the exact bytes each route answers for one fixed  */
/*  run (the caller's random session id normalised to `world-session`).   */
/*  These are also the captured bodies the client's own decoder was run   */
/*  on (WonderlandWireDecode, task3 6eb97308, built offline).              */
/* ===================================================================== */

const GOLDEN_GATES = [{ gate_id: 'approval-1', task_id: 'task-build', operation: 'EXECUTE_PROCESS', reason_code: 'CARD_APPROVAL_REQUIRED', requested_at: AT }];

const GOLDEN_HYDRATE = `{
  "data": {
    "schemaVersion": "relay-wonderland-hydration.v1",
    "projectId": "project-alpha",
    "worldSessionId": "world-session",
    "run": {
      "schemaVersion": "relay-wonderland-snapshot.v1",
      "projectId": "project-alpha",
      "juliusInstanceId": null,
      "runId": "run:0a1b2c3d",
      "missionId": "mission:alpha",
      "state": "REVIEWING",
      "revision": 9,
      "atSequence": 4,
      "observedAtIso": "2026-10-07T12:00:00.000Z",
      "activeTasks": 1,
      "pendingApprovals": 1
    },
    "visualState": "independent_review",
    "terminal": false,
    "usage": {
      "schemaVersion": "relay-wonderland-usage.v1",
      "anchor": "top_left",
      "compoundAgent": {
        "schemaVersion": "relay-wonderland-usage.v1",
        "channel": "compound_agent",
        "tierId": null,
        "tierLabel": null,
        "unitLabel": null,
        "capacityUnits": {
          "known": false,
          "value": null,
          "reason": "not_observed"
        },
        "usedUnits": {
          "known": false,
          "value": null,
          "reason": "not_observed"
        },
        "remainingUnits": {
          "known": false,
          "value": null,
          "reason": "not_observed"
        },
        "referenceCapacityUnits": {
          "known": false,
          "value": null,
          "reason": "not_observed"
        },
        "capacitySpan": {
          "known": false,
          "value": null,
          "reason": "unknown_denominator"
        },
        "fillFraction": {
          "known": false,
          "value": null,
          "reason": "unknown_denominator"
        },
        "remainingFraction": {
          "known": false,
          "value": null,
          "reason": "unknown_denominator"
        },
        "status": "unavailable",
        "unavailableReason": "No usage authority has reported capacity for this world yet.",
        "provenance": "simulated",
        "simulated": true,
        "anchor": "top_left",
        "observedAtIso": "2026-10-07T12:00:00.000Z"
      },
      "singleAgent": {
        "schemaVersion": "relay-wonderland-usage.v1",
        "channel": "single_agent",
        "tierId": null,
        "tierLabel": null,
        "unitLabel": null,
        "capacityUnits": {
          "known": false,
          "value": null,
          "reason": "not_observed"
        },
        "usedUnits": {
          "known": false,
          "value": null,
          "reason": "not_observed"
        },
        "remainingUnits": {
          "known": false,
          "value": null,
          "reason": "not_observed"
        },
        "referenceCapacityUnits": {
          "known": false,
          "value": null,
          "reason": "not_observed"
        },
        "capacitySpan": {
          "known": false,
          "value": null,
          "reason": "unknown_denominator"
        },
        "fillFraction": {
          "known": false,
          "value": null,
          "reason": "unknown_denominator"
        },
        "remainingFraction": {
          "known": false,
          "value": null,
          "reason": "unknown_denominator"
        },
        "status": "unavailable",
        "unavailableReason": "No usage authority has reported capacity for this world yet.",
        "provenance": "simulated",
        "simulated": true,
        "anchor": "top_left",
        "observedAtIso": "2026-10-07T12:00:00.000Z"
      },
      "observedAtIso": "2026-10-07T12:00:00.000Z"
    },
    "usageStatus": {
      "reading": "not_reported",
      "reason": "No usage authority has reported capacity for this world yet.",
      "ageSeconds": null,
      "revision": 0,
      "authorityId": null,
      "foreignProjectReportsRejected": 0,
      "staleRevisionsRejected": 0,
      "malformedReportsRejected": 0
    },
    "activity": {
      "schemaVersion": "relay-wonderland-activity.v1",
      "projectId": "project-alpha",
      "runId": "run:0a1b2c3d",
      "signals": [],
      "workers": [
        {
          "workerId": "worker-coder",
          "signals": []
        }
      ],
      "activeSubagents": 0,
      "subagentsDenied": 0,
      "observedAtIso": "2026-10-07T12:00:00.000Z",
      "unusedEvents": 3,
      "foreignEvents": 0
    },
    "brain": {
      "schemaVersion": "relay-wonderland-brain.v1",
      "projectId": "project-alpha",
      "runId": "run:0a1b2c3d",
      "taskId": "task-plan",
      "brainRevision": 3,
      "entryCount": 3,
      "kindCounts": {
        "OBJECTIVE": 0,
        "REQUIREMENT": 0,
        "CONSTRAINT": 1,
        "DECISION": 1,
        "FINDING": 0,
        "REPAIR": 0,
        "HANDOFF": 0,
        "ARTIFACT": 0,
        "EVIDENCE": 0
      },
      "characterCount": 2048,
      "redactionCount": 1,
      "truncated": false,
      "contentHash": "sha256:0f9e8d7c",
      "observedAtIso": "2026-10-07T12:00:00.000Z"
    },
    "card": {
      "cardRevision": "card:alpha:2",
      "hasPromptArchitect": null,
      "hasCodingAgent": null,
      "hasIndependentReviewer": null,
      "swarmEligible": null,
      "eligibleSwarmRoles": [],
      "autonomy": null
    },
    "humanGates": [
      {
        "schemaVersion": "relay-wonderland-human-gate.v1",
        "projectId": "project-alpha",
        "runId": "run:0a1b2c3d",
        "gateId": "approval-1",
        "taskId": "task-build",
        "operation": "EXECUTE_PROCESS",
        "reasonCode": "CARD_APPROVAL_REQUIRED",
        "requestedAtIso": "2026-10-07T12:00:00.000Z"
      }
    ],
    "observedAtIso": "2026-10-07T12:00:00.000Z"
  }
}`;

const GOLDEN_EVENTS = `{
  "data": {
    "deliveries": [
      {
        "envelope": {
          "schemaVersion": "relay-wonderland-envelope.v1",
          "eventId": "event-1",
          "projectId": "project-alpha",
          "worldSessionId": "world-session",
          "juliusInstanceId": null,
          "missionId": null,
          "runId": "run:0a1b2c3d",
          "taskId": null,
          "workerRole": null,
          "state": "attention",
          "stateSource": "event_type",
          "sourceState": "mission.created",
          "terminal": false,
          "sequence": 1,
          "revision": 9,
          "occurredAt": "2026-10-07T12:00:00.000Z",
          "metadata": {
            "juliusEventType": "run.created",
            "runId": "run:0a1b2c3d"
          },
          "metadataDropped": 0
        },
        "activity": {
          "schemaVersion": "relay-wonderland-activity.v1",
          "projectId": "project-alpha",
          "runId": "run:0a1b2c3d",
          "signals": [],
          "workers": [],
          "activeSubagents": 0,
          "subagentsDenied": 0,
          "observedAtIso": null,
          "unusedEvents": 1,
          "foreignEvents": 0
        }
      },
      {
        "envelope": {
          "schemaVersion": "relay-wonderland-envelope.v1",
          "eventId": "event-2",
          "projectId": "project-alpha",
          "worldSessionId": "world-session",
          "juliusInstanceId": null,
          "missionId": null,
          "runId": "run:0a1b2c3d",
          "taskId": null,
          "workerRole": null,
          "state": "coding",
          "stateSource": "julius_run_state",
          "sourceState": "EXECUTING",
          "terminal": false,
          "sequence": 2,
          "revision": 9,
          "occurredAt": "2026-10-07T12:00:00.000Z",
          "metadata": {
            "juliusEventType": "run.transitioned",
            "runId": "run:0a1b2c3d",
            "reasonCode": "PLAN_ACCEPTED",
            "juliusRunState": "EXECUTING"
          },
          "metadataDropped": 0
        },
        "activity": {
          "schemaVersion": "relay-wonderland-activity.v1",
          "projectId": "project-alpha",
          "runId": "run:0a1b2c3d",
          "signals": [],
          "workers": [],
          "activeSubagents": 0,
          "subagentsDenied": 0,
          "observedAtIso": null,
          "unusedEvents": 2,
          "foreignEvents": 0
        }
      },
      {
        "envelope": {
          "schemaVersion": "relay-wonderland-envelope.v1",
          "eventId": "event-4",
          "projectId": "project-alpha",
          "worldSessionId": "world-session",
          "juliusInstanceId": null,
          "missionId": null,
          "runId": "run:0a1b2c3d",
          "taskId": null,
          "workerRole": null,
          "state": "independent_review",
          "stateSource": "julius_run_state",
          "sourceState": "REVIEWING",
          "terminal": false,
          "sequence": 4,
          "revision": 9,
          "occurredAt": "2026-10-07T12:00:00.000Z",
          "metadata": {
            "juliusEventType": "run.transitioned",
            "runId": "run:0a1b2c3d",
            "reasonCode": "BUILD_SUBMITTED",
            "outcome": "accepted",
            "juliusRunState": "REVIEWING"
          },
          "metadataDropped": 0
        },
        "activity": {
          "schemaVersion": "relay-wonderland-activity.v1",
          "projectId": "project-alpha",
          "runId": "run:0a1b2c3d",
          "signals": [],
          "workers": [
            {
              "workerId": "worker-coder",
              "signals": []
            }
          ],
          "activeSubagents": 0,
          "subagentsDenied": 0,
          "observedAtIso": "2026-10-07T12:00:00.000Z",
          "unusedEvents": 3,
          "foreignEvents": 0
        }
      }
    ],
    "nextCursor": 4,
    "summary": {
      "unauthorized_project": 0,
      "unauthorized_run": 0,
      "unreadable": 0,
      "silent": 1,
      "no_state": 0,
      "out_of_order": 0
    }
  }
}`;

const GOLDEN_RESULT = `{
  "data": {
    "schemaVersion": "relay-wonderland-julius-result.v1",
    "runId": "run:0a1b2c3d",
    "missionId": "mission:alpha",
    "juliusState": "COMPLETED",
    "taskState": "Completed",
    "verified": true,
    "terminal": true,
    "criteria": [
      {
        "criterionId": "criterion-renders",
        "description": "The page renders the leaderboard",
        "satisfied": true,
        "basis": "EVIDENCE",
        "requiredEvidenceTypes": [
          "TEST"
        ],
        "evidenceIds": [
          "evidence-test-1"
        ]
      },
      {
        "criterionId": "criterion-complete",
        "description": "The mission is complete",
        "satisfied": true,
        "basis": "COMPLETION",
        "requiredEvidenceTypes": [],
        "evidenceIds": []
      }
    ],
    "deliverables": [
      {
        "evidenceId": "evidence-diff-1",
        "type": "DIFF",
        "summary": "Added the leaderboard component",
        "artifactRef": null,
        "integrityHash": null,
        "retained": false,
        "occurredAt": "2026-10-07T12:00:00.000Z"
      },
      {
        "evidenceId": "evidence-test-1",
        "type": "TEST",
        "summary": "12 tests passed",
        "artifactRef": null,
        "integrityHash": null,
        "retained": false,
        "occurredAt": "2026-10-07T12:00:00.000Z"
      }
    ],
    "openFindings": [],
    "review": {
      "verdict": "ACCEPT",
      "reasonCode": "MISSION_VERIFIED",
      "repairRounds": 1,
      "reReviewedAfterRepair": true,
      "decisions": 2
    },
    "failure": null,
    "cost": {
      "visible": true,
      "knownUsdMicros": 84210,
      "unknownComponents": 0,
      "complete": true,
      "billing": [
        {
          "role": "PROMPT_ARCHITECT",
          "billingPath": "UNKNOWN",
          "apiSpendUsdMicros": null,
          "unestablishedComponents": 1
        },
        {
          "role": "CODING_AGENT",
          "billingPath": "UNKNOWN",
          "apiSpendUsdMicros": null,
          "unestablishedComponents": 1
        },
        {
          "role": "INDEPENDENT_REVIEWER",
          "billingPath": "UNKNOWN",
          "apiSpendUsdMicros": null,
          "unestablishedComponents": 1
        }
      ]
    },
    "tokens": "UNKNOWN",
    "withheldDetails": 0
  }
}`;

describe('R5: golden bodies, byte for byte (key order included)', () => {
  const pretty = (body: string) => JSON.stringify(JSON.parse(body), null, 2);

  it('hydrate', async () => {
    const { status, body } = await asClient('hydrate', { world: worldOver(ledgerPool({ gates: GOLDEN_GATES })) });
    expect(status).toBe(200);
    expect(pretty(body)).toBe(GOLDEN_HYDRATE);
  });

  it('events?mode=page from cursor 0', async () => {
    const { status, body } = await asClient('events', { world: worldOver(ledgerPool()) });
    expect(status).toBe(200);
    expect(pretty(body)).toBe(GOLDEN_EVENTS);
  });

  it('result, for the owner', async () => {
    const { status, body } = await asClient('result', { world: worldOver(ledgerPool()) });
    expect(status).toBe(200);
    expect(pretty(body)).toBe(GOLDEN_RESULT);
  });

  it('every golden decodes by the client\'s rules -- a golden the client would refuse would pin the wrong contract', () => {
    expect(clientHydrate(GOLDEN_HYDRATE, ASKED).run.runId).toBe(RUN);
    expect(clientPage(GOLDEN_EVENTS, ASKED).deliveries.map((delivery) => delivery.envelope.sequence)).toEqual([1, 2, 4]);
    expect(clientResult(GOLDEN_RESULT, RUN)).toMatchObject({ runId: RUN, criteriaTotal: 2, costVisible: true });
  });
});
