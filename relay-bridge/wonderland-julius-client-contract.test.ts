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
import { WONDERLAND_USAGE_NOT_REPORTED_REASON } from '../src/relay/mission/wonderland/wonderland-usage-authority';

/**
 * ROW 12, R6: THE BODIES ARE CHECKED AGAINST THE CLIENT'S DECODERS, NOT THE SERVER'S
 * OWN EXPECTATION (the row-14 lesson). And R5 (one deterministic contract) and R4
 * (no secret in any body or log line) on the same fixtures.
 *
 * THE PORT BELOW IS THE CLIENT'S RULES, field for field, from CORE's final RC
 * (task3 6eb97308; its stream and decoder sources unchanged since 8327165b):
 *
 *   WonderlandJuliusStream.cpp   LinkStateForFailure (l.66), DataOf (l.103), SplitPage (l.199),
 *                                ParseResult (l.231), RunQuery (l.472), hydrate (l.684),
 *                                events (l.738), result + its run check (l.824-853), Failed (l.1011)
 *   WonderlandWireDecode.cpp     the strict reader (l.61-311), FFieldReader (l.324-492),
 *                                envelope (l.563), activity (l.664), delivery (l.785),
 *                                usage (l.893-1032), hydration (l.1058-1547)
 *   WonderlandWireDecode.tables.cpp   every token a decoder accepts
 *   WonderlandJuliusSubsystem.cpp     AdoptHydration's identity rules (l.159-200)
 *
 * TWO READERS, EACH PORTED AS IT IS (internal review a8349715, Part B):
 *   - WonderlandWireDecode, which decodes the hydration and every delivery, is the
 *     client's own STRICT reader: a duplicate key, a wrong type or an unknown token is
 *     refused by name. The port is exactly as strict.
 *   - DataOf, SplitPage and ParseResult read through Unreal's FJsonObject getters (UE
 *     5.8, the client's EngineAssociation), which COERCE: any string is a bool
 *     (FString::ToBool, never refused), a number or a bool is a string, any string is an
 *     int32 / int64 (LexFromString, never refused). The port reads through the same
 *     getters (`ue`, below), and a field the client reads with a TryGet... whose failure
 *     it ignores is never a refusal here either. Until the review this half of the port
 *     was STRICT, and its controls "refused" bodies the client accepts (`verified:'true'`,
 *     a failure without its reasonCode, review fields of another type, a numeric
 *     evidenceId). Those are now acceptance tests, and every control below refuses only
 *     what the client refuses -- an instrument that cannot fail proves nothing, and one
 *     that fails where the client does not proves the wrong thing.
 *
 * KNOWN DIVERGENCES (the review's NOTEs; no body these routes send reaches one):
 *   - AdoptHydration also refuses a hydration OLDER than the one the world already holds
 *     (WonderlandJuliusSubsystem.cpp:196). That rule needs held state, which a port of a
 *     single read does not have: clientHydrate checks the identities only.
 *   - Number limits: the C++ reader converts with std::stod, which under MSVC throws
 *     out_of_range on 1e400 -- the C++ reports out_of_range where this port reports
 *     number_not_finite -- and ALSO on 1e-400, which this port accepts (as 0). The server
 *     emits neither.
 *   - UnwrapData (JS:194-197) and SplitPage hand the strict reader UE's OWN condensed
 *     re-serialisation of the parsed object; this port re-serialises with JSON.stringify.
 *     Neither this port nor the offline C++ run exercises UE's writer (its number
 *     formatting, its escaping), so a difference there would not show here.
 *
 * THE CLIENT'S OWN DECODER, RUN OFFLINE. WonderlandWireDecode (6eb97308, built with MSVC
 * at /Od and /O2 against the offline harness's syntax stubs) was run on these routes'
 * captured hydrate and delivery bodies, beside task3's own canonical cases: 331 checks,
 * 0 failures, the two builds' outputs identical. The harness, its inputs and its outputs,
 * with a sha256 manifest, are in the QA handoff (julius_readiness/row12/
 * client-decoder-evidence). ParseResult needs UE's Json module (FJsonObject), which that
 * harness does not have: the RESULT body has been decoded by this port only, never by
 * the C++.
 *
 * THE GOLDENS (R5) are NOT captured output: each route's expected body is derived here,
 * field by field, from the fixture and the contract (internal review A6).
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

/**
 * UNREAL'S FJsonObject GETTERS, as UE 5.8 implements them (Engine/Source/Runtime/Json:
 * Private/Dom/JsonObject.cpp TryGet*Field = the field exists AND its value's TryGet*;
 * Private/Dom/JsonValue.cpp and Public/Dom/JsonValue.h for each value kind). DataOf,
 * SplitPage and ParseResult read through these, so the port does too. `undefined` is the
 * getter answering false. JSON.parse keeps the LAST of two equal keys, as FJsonObject's
 * SetField does.
 *   string   a string -> itself; a number -> FString::SanitizeFloat(n, 0); a bool -> "true" / "false"
 *   bool     a bool -> itself; a number -> n != 0; ANY string -> FString::ToBool(), never refused
 *   int32 / int64   a number or a bool -> the double, if within the type's range, rounded half away
 *            from zero (TryConvertNumber); ANY string -> LexFromString, never refused
 *   array / object  only an array / only an object
 * null answers false to every getter (FJsonValueNull overrides none of them), and an array or an
 * object answers false to the scalar ones. Only acceptance is modelled exactly: a coerced value the
 * port does not report (a cost figure, a coerced flag's truth) is not computed the engine's way.
 */
const ue = {
  string(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    // SanitizeFloat's exact spelling is not modelled; a number never spells a run id (every one holds a colon).
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return undefined;
  },
  bool(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    // FString::ToBool: "true" / "yes" / "on" in any case, else a non-zero leading integer. ALWAYS read.
    if (typeof value === 'string') return /^(?:true|yes|on)$/iu.test(value) || (Number.parseInt(value, 10) || 0) !== 0;
    return undefined;
  },
  integer(value: unknown, bits: 32 | 64): number | undefined {
    // LexFromString: whatever leading integer the text has, 0 if none -- and the getter answers TRUE either way.
    if (typeof value === 'string') return Number.parseInt(value, 10) || 0;
    const double = typeof value === 'number' ? value : typeof value === 'boolean' ? (value ? 1 : 0) : undefined;
    if (double === undefined) return undefined;
    const inRange = bits === 32 ? double >= -2_147_483_648 && double <= 2_147_483_647 : double >= -(2 ** 63) && double < 2 ** 63;
    return inRange ? Math.sign(double) * Math.round(Math.abs(double)) : undefined;
  },
  array(value: unknown): readonly unknown[] | undefined {
    return Array.isArray(value) ? value : undefined;
  },
  object(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  },
};

/** The events leg: SplitPage, then every delivery through the strict decoder (the first refusal stops the page). */
function clientPage(body: string, asked: { readonly projectId: string; readonly runId: string }) {
  const data = dataOf(body);
  // TryGetArrayField, then TryGetNumberField into an int64 (JS:206-210). The cursor is read and then IGNORED
  // (JS:790): the world resumes from its own applied cursor.
  const list = ue.array(data.deliveries);
  if (list === undefined) throw new Refused('missing_field', 'deliveries');
  const nextCursor = ue.integer(data.nextCursor, 64);
  if (nextCursor === undefined) throw new Refused('missing_field', 'nextCursor');
  const deliveries = list.map((delivery) => {
    if (delivery === null || typeof delivery !== 'object' || Array.isArray(delivery)) throw new Refused('not_object', 'delivery');
    const decoded = decodeDelivery(JSON.stringify(delivery));
    // The subsystem applies only its own project's envelopes; a foreign one is refused there.
    if (decoded.envelope.projectId !== asked.projectId) throw new Refused('foreign_project', 'apply');
    if (decoded.envelope.runId !== null && decoded.envelope.runId !== asked.runId) throw new Refused('foreign_run', 'apply');
    return decoded;
  });
  return { deliveries, nextCursor };
}

/**
 * ParseResult (JS:231-311), line for line through UE's getters, plus the run check (JS:837).
 * REQUIRED (a getter answering false refuses the result whole): schemaVersion (then compared
 * exactly), a non-empty runId, juliusState, verified, terminal, the criteria / deliverables /
 * openFindings arrays, the cost object and its `visible`; each criterion an object with
 * `satisfied`, each deliverable an object with `evidenceId`; and -- only when the cost is
 * visible -- knownUsdMicros (int64), unknownComponents (int32) and complete.
 * READ, NEVER REFUSED (JS:262, :285-298, :307-308: the getter's answer is ignored): taskState,
 * review {verdict, repairRounds, reReviewedAfterRepair} and failure {reasonCode, failureClass}
 * -- each read only when its object IS an object -- tokens and withheldDetails.
 */
function clientResult(body: string, askedRunId: string) {
  const data = dataOf(body);
  const need = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) throw new Refused('refused', name);
    return value;
  };
  const schema = need(ue.string(data.schemaVersion), 'schemaVersion');
  if (schema !== RESULT_SCHEMA) throw new Refused('refused', 'schemaVersion');
  const runId = need(ue.string(data.runId), 'runId');
  if (runId === '') throw new Refused('refused', 'runId');
  const juliusState = need(ue.string(data.juliusState), 'juliusState');
  const verified = need(ue.bool(data.verified), 'verified');
  const terminal = need(ue.bool(data.terminal), 'terminal');
  const criteria = need(ue.array(data.criteria), 'criteria');
  const deliverables = need(ue.array(data.deliverables), 'deliverables');
  const findings = need(ue.array(data.openFindings), 'openFindings');
  const cost = need(ue.object(data.cost), 'cost');
  const costVisible = need(ue.bool(cost.visible), 'cost');
  // "A null taskState is no mapping, and stays empty" -- and so does any value the getter cannot read.
  const taskState = ue.string(data.taskState) ?? '';
  const satisfied = criteria.map((criterion) => need(ue.bool(ue.object(criterion)?.satisfied), 'criteria.satisfied'));
  const deliverableIds = deliverables.map((deliverable) => need(ue.string(ue.object(deliverable)?.evidenceId), 'deliverables.evidenceId'));
  const review = ue.object(data.review);
  const failure = ue.object(data.failure);
  if (costVisible) {
    need(ue.integer(cost.knownUsdMicros, 64), 'cost.knownUsdMicros');
    need(ue.integer(cost.unknownComponents, 32), 'cost.unknownComponents');
    need(ue.bool(cost.complete), 'cost.complete');
  }
  // A result for another run is not this one's: JS:837 reads it as a failure to read the result.
  if (runId !== askedRunId) throw new Refused('refused', 'runId (asked)');
  return {
    runId,
    juliusState,
    verified,
    terminal,
    taskState,
    criteriaMet: satisfied.filter(Boolean).length,
    criteriaTotal: satisfied.length,
    deliverableIds,
    openFindings: findings.length,
    costVisible,
    verdict: ue.string(review?.verdict) ?? '',
    failureReason: ue.string(failure?.reasonCode) ?? '',
    tokens: ue.string(data.tokens) ?? '',
  };
}

/* ------------------------------------------------- the link the world shows */

/** EWonderlandLinkState, as far as a route's answer can move it. */
type ClientLinkState = 'Live' | 'SessionExpired' | 'Refused' | 'Stale';

/** WonderlandJuliusStreamLogic::LinkStateForFailure (JS:66-80), verbatim. */
function linkStateForFailure(httpStatus: number, connected: boolean): ClientLinkState {
  if (!connected) return 'Stale';
  if (httpStatus === 401) return 'SessionExpired';
  if (httpStatus === 403 || httpStatus === 404) return 'Refused';
  return 'Stale';
}

/**
 * What the world does with one answer to its hydrate or events read (JS:684-721, :738-793):
 * a 200 that decodes is Live; anything else goes through Failed (JS:1011-1031), which takes
 * LinkStateForFailure's state, invalidates the session token on SessionExpired (JS:1015-1018)
 * and hydrates again after a backoff. A 200 the decoder -- or, for a hydration, AdoptHydration
 * -- refuses is Failed(200): Stale. A DECODED delivery of another project or run is not a
 * failure: ApplyEnvelope refuses that one envelope by the subsystem's own rule and the page
 * still ends Live (JS:772-793).
 */
function clientFollowLeg(route: 'hydrate' | 'events', status: number, body: string, asked: { readonly projectId: string; readonly runId: string }) {
  const failed = (httpStatus: number) => {
    const link = linkStateForFailure(httpStatus, true);
    return { link, tokenInvalidated: link === 'SessionExpired', rehydrates: true };
  };
  if (status !== 200) return failed(status);
  try {
    if (route === 'hydrate') clientHydrate(body, asked);
    else clientPage(body, asked);
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    if (!(route === 'events' && error.field === 'apply')) return failed(status);
  }
  return { link: 'Live' as ClientLinkState, tokenInvalidated: false, rehydrates: false };
}

/**
 * What the world does with one answer to its result read (JS:824-853): "NOT A LINK FAILURE".
 * Whatever the status, the link is left alone; a body that is not a 200 ParseResult reads for
 * the asked run is counted and asked for again after a backoff, and only a good one is adopted.
 */
function clientResultLeg(status: number, body: string, askedRunId: string) {
  let adopted = false;
  if (status === 200) {
    try {
      clientResult(body, askedRunId);
      adopted = true;
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
    }
  }
  return { linkChanged: false, tokenInvalidated: false, adopted, retriesAfterBackoff: !adopted };
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

/** The run's latest Project Brain context snapshot, as the reader's statement returns it. */
const SNAPSHOT_ROW = {
  task_id: 'task-plan', project_brain_revision: '3', content_hash: 'sha256:0f9e8d7c', character_count: '2048', redaction_count: '1',
  truncated: false, created_at: AT, kinds: ['DECISION', 'CONSTRAINT', 'RESEARCH_NOTE'],
} as const;

/** The run row the hydration reads (its `at_sequence`, `pending_approvals` and `open_gates` come from the ledger). */
const RUN_ROW = { state: 'REVIEWING', version: '9', mission_id: 'mission:alpha', card_revision: 'card:alpha:2', active_tasks: '1', observed_at: AT } as const;

/** The ledger revision every page row carries (the run's version, read in the page's own statement). */
const PAGE_REVISION = '9';

/** A pg pool answering the reader's statements with rows shaped as `pg` returns them. */
function ledgerPool(ledger: Ledger = {}): Pool {
  const events = ledger.events ?? DEFAULT_EVENTS;
  const atSequence = events.reduce((max, event) => Math.max(max, Number(event.sequence)), 0);
  return {
    query: async (sql: string, values: readonly unknown[] = []) => {
      const ours = values[0] === RUN && values[1] === PROJECT;
      if (sql.includes('julius_context_snapshots')) {
        return { rows: ours ? [{ ...SNAPSHOT_ROW, kinds: [...SNAPSHOT_ROW.kinds] }] : [] };
      }
      if (sql.includes('LEFT JOIN LATERAL')) {
        if (!ours) return { rows: [] };
        const after = Number(values[2]);
        const page = events.filter((event) => Number(event.sequence) > after).slice(0, Number(values[3]));
        return { rows: page.length > 0 ? page.map((event) => ({ revision: PAGE_REVISION, ...event }))
          : [{ revision: PAGE_REVISION, event_id: null, stream_id: null, project_id: null, sequence: null, event_type: null, payload: null, occurred_at: null }] };
      }
      if (sql.includes('AS at_sequence')) {
        return { rows: ours ? [{
          ...RUN_ROW,
          at_sequence: String(atSequence), pending_approvals: String((ledger.gates ?? []).length),
          open_gates: (ledger.gates ?? []).length === 0 ? null : ledger.gates,
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
    expect(broken((d) => { d.runId = ''; })).toBe('refused at runId');
    expect(broken((d) => { delete d.cost.knownUsdMicros; })).toBe('refused at cost.knownUsdMicros');
    expect(broken((d) => { d.cost.knownUsdMicros = 1e20; })).toBe('refused at cost.knownUsdMicros'); // past int64
    expect(broken((d) => { d.cost.unknownComponents = 3e9; })).toBe('refused at cost.unknownComponents'); // past int32
    expect(broken((d) => { d.cost.complete = null; })).toBe('refused at cost.complete');
    expect(broken((d) => { delete d.criteria[0].satisfied; })).toBe('refused at criteria.satisfied');
    expect(broken((d) => { d.criteria[0].satisfied = {}; })).toBe('refused at criteria.satisfied');
    expect(broken((d) => { d.criteria[1] = 'met'; })).toBe('refused at criteria.satisfied');
    // A JSON null, an array or an object is what UE's getters refuse; a number or a bool would be READ as a string.
    expect(broken((d) => { d.deliverables[0].evidenceId = null; })).toBe('refused at deliverables.evidenceId');
    expect(broken((d) => { d.deliverables[0].evidenceId = ['evidence-diff-1']; })).toBe('refused at deliverables.evidenceId');
    // A bool field refuses null, an array and an object -- never a string (see the acceptance test below).
    expect(broken((d) => { d.verified = null; })).toBe('refused at verified');
    expect(broken((d) => { d.terminal = []; })).toBe('refused at terminal');
    expect(broken((d) => { d.juliusState = null; })).toBe('refused at juliusState');
    expect(broken((d) => { delete d.openFindings; })).toBe('refused at openFindings');
    expect(broken((d) => { d.openFindings = {}; })).toBe('refused at openFindings');
    expect(broken((d) => { d.cost = [d.cost]; })).toBe('refused at cost');
    expect(broken((d) => { d.cost.visible = null; })).toBe('refused at cost');
    expect(refusalOf(() => clientResult(JSON.stringify(body.data), RUN))).toBe('missing_field at data');
  });

  it('a result is ACCEPTED where UE\'s getters coerce or the client ignores the field -- as the client accepts it (review Part B)', async () => {
    // Each of these was "refused" by the port before the review; the client reads every one of them.
    const body = JSON.parse((await asClient('result', { world: worldOver(ledgerPool()) })).body);
    const read = (change: (data: Record<string, any>) => void) => {
      const copy = JSON.parse(JSON.stringify(body));
      change(copy.data);
      return clientResult(JSON.stringify(copy), RUN);
    };
    // THE THREE OVER-STRICT CASES: a bool as a string (FString::ToBool, never refused) ...
    expect(read((d) => { d.verified = 'true'; }).verified).toBe(true);
    expect(read((d) => { d.verified = 'FALSE'; }).verified).toBe(false);
    expect(read((d) => { d.terminal = 'not a bool at all'; }).terminal).toBe(false);
    // ... a failure without its reasonCode -- or one that is not even an object -- is read, never refused (JS:293-298) ...
    expect(read((d) => { d.failure = { failureClass: 'PROVIDER' }; }).failureReason).toBe('');
    expect(read((d) => { d.failure = { reasonCode: 7 }; }).failureReason).toBe('7');
    expect(read((d) => { d.failure = 'it failed'; }).failureReason).toBe('');
    // ... and the review's fields of another type are skipped one by one (JS:285-291).
    expect(read((d) => { d.review = { verdict: null, repairRounds: 'two', reReviewedAfterRepair: [] }; }).verdict).toBe('');
    expect(read((d) => { d.review = ['ACCEPT']; }).verdict).toBe('');
    // The rest of the coercions the client makes, on the required fields and the optional ones.
    expect(read((d) => { d.deliverables[0].evidenceId = 7; }).deliverableIds).toEqual(['7', 'evidence-test-1']);
    expect(read((d) => { d.criteria[0].satisfied = 0; }).criteriaMet).toBe(1);
    expect(read((d) => { d.juliusState = 5; }).juliusState).toBe('5');
    expect(read((d) => { d.cost.knownUsdMicros = 'eighty'; d.cost.unknownComponents = true; d.cost.complete = 1; }).costVisible).toBe(true);
    expect(read((d) => { d.cost.visible = 'no'; delete d.cost.knownUsdMicros; }).costVisible).toBe(false);
    expect(read((d) => { d.taskState = { state: 'Completed' }; }).taskState).toBe('');
    expect(read((d) => { d.taskState = null; }).taskState).toBe('');
    expect(read((d) => { d.tokens = 12; d.withheldDetails = 'some'; }).tokens).toBe('12');
    expect(read((d) => { d.extra = { anything: [1, 2] }; }).runId).toBe(RUN);
  });

  it('a page is ACCEPTED with a cursor UE reads as an int64 -- a string, a bool, a fraction it rounds (review Part B)', async () => {
    const page = JSON.parse((await asClient('events', { world: worldOver(ledgerPool()) })).body);
    const cursor = (nextCursor: unknown) => clientPage(JSON.stringify({ data: { ...page.data, nextCursor } }), ASKED).nextCursor;
    expect(cursor('4')).toBe(4);
    expect(cursor('not a number')).toBe(0);
    expect(cursor(true)).toBe(1);
    expect(cursor(3.5)).toBe(4);
    expect(cursor(-3.5)).toBe(-4);
    // What UE refuses: null, an object, an array, and a double at or past 2^63.
    for (const refused of [null, {}, [4], 2 ** 63]) {
      expect(() => cursor(refused), JSON.stringify(refused)).toThrow(/missing_field at nextCursor/u);
    }
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
      runId: RUN, juliusState: 'COMPLETED', verified: true, terminal: true, taskState: 'Completed',
      criteriaMet: 2, criteriaTotal: 2, deliverableIds: ['evidence-diff-1', 'evidence-test-1'], openFindings: 0, costVisible: true,
      verdict: 'ACCEPT', failureReason: '', tokens: 'UNKNOWN',
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

  /*
   * A PATH ON THE HOST THAT RAN THE MISSION (internal review M3; R4 forbids one in ANY body), in the shapes a
   * run can carry: Windows (a drive, and a UNC share), POSIX and macOS. Each names a user and a directory of
   * its own, so a body that kept ANY part of the directory is caught -- not only one that kept the path whole.
   * /result cuts a path back to its file name (trimHostPaths), so a file name may remain there by design.
   */
  const HOST_PATHS = {
    windows: 'C:\\Users\\winfounder\\hostdir-win\\deploy.env',
    windowsShare: '\\\\fileserver\\hostdir-share\\plan.md',
    posix: '/home/posixfounder/hostdir-posix/notes.md',
    macos: '/Users/macfounder/hostdir-mac/keys.txt',
  };
  const HOST_PRIVATE = /winfounder|posixfounder|macfounder|fileserver|hostdir-(?:win|share|posix|mac)/u;

  const hostPathLedger = (): Ledger => ({
    gates: [{ gate_id: 'approval-1', task_id: 'task-build', operation: 'EXECUTE_PROCESS', reason_code: HOST_PATHS.posix, requested_at: AT }],
    events: [
      flatEvent(1, 'run.created', { missionId: 'mission:alpha' }),
      flatEvent(2, 'run.transitioned', { to: 'EXECUTING', reasonCode: HOST_PATHS.windows, outcome: HOST_PATHS.macos }),
      flatEvent(3, 'run.transitioned', { to: 'REVIEWING', reasonCode: 'BUILD_SUBMITTED', severity: HOST_PATHS.windowsShare, role: HOST_PATHS.posix }),
    ],
  });

  const hostPathView: JuliusMissionResultView = {
    ...VIEW,
    state: 'FAILED', verified: false,
    criteria: [{ ...VIEW.criteria[0], description: `Reads ${HOST_PATHS.macos}` }, VIEW.criteria[1]],
    deliverables: [{ ...VIEW.deliverables[0], safeSummary: `Wrote ${HOST_PATHS.windows}`, artifactRef: HOST_PATHS.posix }],
    outstandingFindings: [{ findingId: 'finding-1', taskId: 'task-build', claim: `Missing ${HOST_PATHS.windowsShare}`, severity: 'HIGH' }],
    reviewDecisions: [{ taskId: 'task-build', action: 'HALT', reasonCode: HOST_PATHS.posix }],
    failure: { reasonCode: HOST_PATHS.macos, failureClass: HOST_PATHS.windows },
  };

  it('hydrate, events and result carry no seeded HOST PATH -- Windows, POSIX and macOS -- and neither does any log line (review M3)', async () => {
    const logged: string[] = [];
    const bodies: Array<[string, string]> = [];
    for (const route of ['hydrate', 'events', 'result'] as const) {
      const { status, body } = await asClient(route, {
        world: worldOver(ledgerPool(hostPathLedger()), OWNER, hostPathView),
        log: (line) => logged.push(line),
        onAuthorization: (decision) => logged.push(JSON.stringify(decision)),
      });
      expect(status, `${route}: ${body}`).toBe(200);
      bodies.push([route, body]);
    }
    for (const [route, body] of bodies) {
      expect(body, `${route} keeps part of a host path`).not.toMatch(HOST_PRIVATE);
      for (const path of Object.values(HOST_PATHS)) {
        // As JSON writes it, backslashes escaped: the form a body would hold it in.
        expect(body.includes(JSON.stringify(path).slice(1, -1)), `${route} carries ${path}`).toBe(false);
      }
    }
    for (const line of logged) expect(line, `a log line keeps part of a host path: ${line}`).not.toMatch(HOST_PRIVATE);
  });

  it('CONTROL: the host-path fields still cross -- an event\'s code beside a dropped path, /result\'s text cut back to the file name', async () => {
    const events = await asClient('events', { world: worldOver(ledgerPool(hostPathLedger()), OWNER, hostPathView) });
    const result = await asClient('result', { world: worldOver(ledgerPool(hostPathLedger()), OWNER, hostPathView) });
    const deliveries = JSON.parse(events.body).data.deliveries as Array<{ envelope: { sequence: number; metadata: Record<string, unknown>; metadataDropped: number } }>;
    const bySequence = new Map(deliveries.map((delivery) => [delivery.envelope.sequence, delivery.envelope]));
    // seq 2: both paths dropped, and counted; the transition itself still crossed.
    expect(bySequence.get(2)?.metadata).toEqual({ juliusEventType: 'run.transitioned', runId: RUN, juliusRunState: 'EXECUTING' });
    expect(bySequence.get(2)?.metadataDropped).toBe(2);
    // seq 3: the code crosses verbatim beside the two paths that did not.
    expect(bySequence.get(3)?.metadata.reasonCode).toBe('BUILD_SUBMITTED');
    expect(bySequence.get(3)?.metadataDropped).toBe(2);
    const data = JSON.parse(result.body).data as { deliverables: Array<{ summary: string }>; failure: { reasonCode: string } };
    expect(data.deliverables[0].summary).toBe('Wrote …/deploy.env');
    expect(data.failure.reasonCode).toBe('…/keys.txt');
    clientPage(events.body, ASKED);
    clientResult(result.body, RUN);
  });
});

/* ===================================================================== */
/*  R5: GOLDEN BODIES, DERIVED. Each route's expected body is built here, */
/*  field by field, from the FIXTURE above and the CONTRACT -- never      */
/*  captured from the route (internal review A6: a captured golden passes */
/*  any wrong body that is stable). The caller's random session id is     */
/*  normalised to `world-session`, as `asClient` does.                    */
/* ===================================================================== */

const GOLDEN_GATES = [{ gate_id: 'approval-1', task_id: 'task-build', operation: 'EXECUTE_PROCESS', reason_code: 'CARD_APPROVAL_REQUIRED', requested_at: AT }];
const WORLD_SESSION = 'world-session';
type FixtureEvent = ReturnType<typeof flatEvent>;

/*
 * HOW EACH FIXTURE EVENT MOVES A WORLD, by the documented tables -- stated here, not computed by them:
 *   - its drawable state (wonderland-julius-state.ts): a kernel event that names a run state (`to`) is
 *     drawn from it -- source julius_run_state, EXECUTING -> coding, REVIEWING -> independent_review;
 *     `run.created` names none, so it is drawn from its world event type, mission.created -> attention
 *     (source event_type). `worker.dispatched` has NO world event type: it is SILENT -- no delivery, one
 *     `silent` in the page's summary (wonderland-julius-normalizer.ts, wonderland-ingress.ts).
 *   - the activity (wonderland-julius-activity.ts, JULIUS_ACTIVITY_RULES): `worker.dispatched` clears
 *     retrying, switching_worker and retrieving_context, so it MOVES the fold -- its worker is registered,
 *     with no signal raised, and it stamps observedAtIso; `run.created` and `run.transitioned` raise and
 *     clear nothing, so each counts as an unused event. Nothing here raises a signal or names a subagent.
 */
const RUN_STATE_DRAWN: Readonly<Record<string, string>> = { EXECUTING: 'coding', REVIEWING: 'independent_review' };
const EVENT_TYPE_DRAWN: Readonly<Record<string, string>> = { 'mission.created': 'attention' };
const WORLD_EVENT_TYPE: Readonly<Record<string, string | null>> = { 'run.created': 'mission.created', 'run.transitioned': 'mission.stage_changed', 'worker.dispatched': null };
const MOVES_ACTIVITY: ReadonlySet<string> = new Set(['worker.dispatched']);
/** The kernel facts a world event carries (WONDERLAND_CARRIED_FACT_KEYS), each a code in this fixture. */
const CARRIED_FACTS = ['reasonCode', 'severity', 'outcome', 'role', 'attempt'] as const;

function drawn(event: FixtureEvent): { state: string; stateSource: string; sourceState: string } | null {
  if (WORLD_EVENT_TYPE[event.payload.type] === null) return null;
  const to = event.payload.facts.to;
  if (typeof to === 'string') return { state: RUN_STATE_DRAWN[to], stateSource: 'julius_run_state', sourceState: to };
  const worldType = WORLD_EVENT_TYPE[event.payload.type] as string;
  return { state: EVENT_TYPE_DRAWN[worldType], stateSource: 'event_type', sourceState: worldType };
}

/** The activity a world holds after `events`, folded from an empty reading. */
function expectedActivity(events: readonly FixtureEvent[]) {
  const workers = new Set<string>();
  let observedAtIso: string | null = null;
  let unusedEvents = 0;
  for (const event of events) {
    if (!MOVES_ACTIVITY.has(event.payload.type)) { unusedEvents += 1; continue; }
    if (event.payload.workerId !== null) workers.add(event.payload.workerId);
    observedAtIso = event.payload.occurredAt;
  }
  return {
    schemaVersion: 'relay-wonderland-activity.v1', projectId: PROJECT, runId: RUN,
    signals: [], workers: [...workers].sort().map((workerId) => ({ workerId, signals: [] })),
    activeSubagents: 0, subagentsDenied: 0, observedAtIso, unusedEvents,
    // Every row is this run's: nothing foreign was folded.
    foreignEvents: 0,
  };
}

/** One world event's metadata: the kernel type and run, the carried facts present, and the run state it names. */
function expectedMetadata(event: FixtureEvent): Record<string, unknown> {
  const facts = event.payload.facts;
  const metadata: Record<string, unknown> = { juliusEventType: event.payload.type, runId: event.payload.runId };
  for (const key of CARRIED_FACTS) if (facts[key] !== undefined) metadata[key] = facts[key];
  if (typeof facts.to === 'string') metadata.juliusRunState = facts.to;
  return metadata;
}

/** GET /events?mode=page&cursor=<after>: one delivery per drawable event after the cursor, each with the fold so far. */
function expectedPage(events: readonly FixtureEvent[], after: number) {
  const page = events.filter((event) => Number(event.sequence) > after);
  const deliveries: unknown[] = [];
  let silent = 0;
  page.forEach((event, index) => {
    const state = drawn(event);
    if (state === null) { silent += 1; return; }
    deliveries.push({
      envelope: {
        schemaVersion: 'relay-wonderland-envelope.v1',
        eventId: event.payload.eventId,
        projectId: event.payload.projectId,
        worldSessionId: WORLD_SESSION,
        // Nothing on this path names an instance, a mission (a run id is a stream key, not a mission id), a task
        // or a worker role for a drawn event: each is null, never guessed.
        juliusInstanceId: null, missionId: null, runId: event.payload.runId, taskId: null, workerRole: null,
        ...state,
        // None of attention / coding / independent_review is an end state.
        terminal: false,
        sequence: Number(event.sequence),
        revision: Number(PAGE_REVISION),
        occurredAt: event.payload.occurredAt,
        metadata: expectedMetadata(event),
        metadataDropped: 0,
      },
      // The fold AFTER this event, from an empty reading at the page's start -- silent events before it included.
      activity: expectedActivity(page.slice(0, index + 1)),
    });
  });
  return {
    data: {
      deliveries,
      // The ledger's own position: the last row read, or the cursor itself when there was none.
      nextCursor: page.length === 0 ? after : Number(page[page.length - 1].sequence),
      // Every refusal kind the ingress counts (WONDERLAND_INGRESS_REFUSALS); only the silent event is one.
      summary: { unauthorized_project: 0, unauthorized_run: 0, unreadable: 0, silent, no_state: 0, out_of_order: 0 },
    },
  };
}

/** A usage figure nobody reported: unknown, with the meter's reason (wonderland-usage-meter.ts). */
const unknownFigure = (reason: 'not_observed' | 'unknown_denominator') => ({ known: false, value: null, reason });

/**
 * One channel's meter when NO usage authority has ever reported (wonderland-usage-authority.ts:
 * readWonderlandUsageAuthority -> not_reported; statusFor -> unavailable; provenanceFor -> simulated,
 * which says so). Every count unobserved; every fraction and span without a denominator. The HUD's
 * default anchor, and the time the run was observed.
 */
const unreportedMeter = (channel: 'compound_agent' | 'single_agent') => ({
  schemaVersion: 'relay-wonderland-usage.v1', channel, tierId: null, tierLabel: null, unitLabel: null,
  capacityUnits: unknownFigure('not_observed'), usedUnits: unknownFigure('not_observed'),
  remainingUnits: unknownFigure('not_observed'), referenceCapacityUnits: unknownFigure('not_observed'),
  capacitySpan: unknownFigure('unknown_denominator'), fillFraction: unknownFigure('unknown_denominator'),
  remainingFraction: unknownFigure('unknown_denominator'),
  status: 'unavailable', unavailableReason: WONDERLAND_USAGE_NOT_REPORTED_REASON, provenance: 'simulated', simulated: true,
  anchor: 'top_left', observedAtIso: RUN_ROW.observed_at,
});

/** GET /hydrate: the run row, every event up to its atSequence, the latest Brain snapshot, the open gates. */
function expectedHydration(events: readonly FixtureEvent[], gates: readonly (typeof GOLDEN_GATES)[number][]) {
  const atSequence = Math.max(...events.map((event) => Number(event.sequence)));
  return {
    data: {
      schemaVersion: HYDRATION_SCHEMA,
      projectId: PROJECT,
      worldSessionId: WORLD_SESSION,
      run: {
        schemaVersion: 'relay-wonderland-snapshot.v1', projectId: PROJECT, juliusInstanceId: null, runId: RUN,
        missionId: RUN_ROW.mission_id, state: RUN_ROW.state, revision: Number(RUN_ROW.version), atSequence,
        observedAtIso: RUN_ROW.observed_at, activeTasks: Number(RUN_ROW.active_tasks), pendingApprovals: gates.length,
      },
      visualState: RUN_STATE_DRAWN[RUN_ROW.state],
      terminal: false,
      usage: {
        schemaVersion: 'relay-wonderland-usage.v1', anchor: 'top_left',
        compoundAgent: unreportedMeter('compound_agent'), singleAgent: unreportedMeter('single_agent'),
        observedAtIso: RUN_ROW.observed_at,
      },
      // No authority has spoken to this world: nothing accepted (revision 0), nothing rejected, no authority named.
      usageStatus: {
        reading: 'not_reported', reason: WONDERLAND_USAGE_NOT_REPORTED_REASON, ageSeconds: null, revision: 0, authorityId: null,
        foreignProjectReportsRejected: 0, staleRevisionsRejected: 0, malformedReportsRejected: 0,
      },
      activity: expectedActivity(events.filter((event) => Number(event.sequence) <= atSequence)),
      brain: {
        schemaVersion: 'relay-wonderland-brain.v1', projectId: PROJECT, runId: RUN, taskId: SNAPSHOT_ROW.task_id,
        brainRevision: Number(SNAPSHOT_ROW.project_brain_revision),
        // Every entry counts -- a kind the client does not know (RESEARCH_NOTE) included; the per-kind counts name
        // exactly the kinds the client knows (its EWonderlandBrainKind table), every one present.
        entryCount: SNAPSHOT_ROW.kinds.length,
        kindCounts: Object.fromEntries(TOKENS.EWonderlandBrainKind.map((kind) => [kind, SNAPSHOT_ROW.kinds.filter((held) => held === kind).length])),
        characterCount: Number(SNAPSHOT_ROW.character_count), redactionCount: Number(SNAPSHOT_ROW.redaction_count),
        truncated: SNAPSHOT_ROW.truncated, contentHash: SNAPSHOT_ROW.content_hash, observedAtIso: SNAPSHOT_ROW.created_at,
      },
      // The hydration reads the card's REVISION only: what the card holds is unknown here (null, never false), and the
      // client's decoder requires the swarm-role list, so it is the empty one.
      card: {
        cardRevision: RUN_ROW.card_revision, hasPromptArchitect: null, hasCodingAgent: null, hasIndependentReviewer: null,
        swarmEligible: null, eligibleSwarmRoles: [], autonomy: null,
      },
      humanGates: gates.map((gate) => ({
        schemaVersion: 'relay-wonderland-human-gate.v1', projectId: PROJECT, runId: RUN, gateId: gate.gate_id, taskId: gate.task_id,
        operation: gate.operation, reasonCode: gate.reason_code, requestedAtIso: gate.requested_at,
      })),
      observedAtIso: RUN_ROW.observed_at,
    },
  };
}

/** MissionTasks' EWonderlandTaskState for a Julius state (the verbatim C++ table, wonderland-julius-task-state.test.ts). */
const TASK_STATE_OF: Readonly<Record<string, string>> = { COMPLETED: 'Completed' };

/** GET /result for the OWNER (read_mission_cost): Julius's result view through the allow-list, with no billing record read. */
function expectedResult(view: JuliusMissionResultView) {
  const decisions = view.reviewDecisions;
  const latest = decisions[decisions.length - 1];
  const lastRepair = decisions.map((decision) => decision.action).lastIndexOf('REPAIR');
  return {
    data: {
      schemaVersion: RESULT_SCHEMA,
      runId: view.runId,
      missionId: view.missionId,
      juliusState: view.state,
      taskState: TASK_STATE_OF[view.state],
      verified: view.verified,
      terminal: view.terminal,
      criteria: view.criteria.map((criterion) => ({
        criterionId: criterion.criterionId, description: criterion.description, satisfied: criterion.satisfied, basis: criterion.basis,
        requiredEvidenceTypes: [...criterion.requiredEvidenceTypes], evidenceIds: [...criterion.evidenceIds],
      })),
      // The deliverable's task is not shown; its safe summary is; it is RETAINED only with a durable artifact reference.
      deliverables: view.deliverables.map((item) => ({
        evidenceId: item.evidenceId, type: item.type, summary: item.safeSummary, artifactRef: item.artifactRef,
        integrityHash: item.integrityHash, retained: item.artifactRef !== null, occurredAt: item.occurredAt,
      })),
      openFindings: view.outstandingFindings.map((finding) => ({ findingId: finding.findingId, severity: finding.severity, claim: finding.claim })),
      // The latest decision is the verdict; REPAIR decisions are the repair rounds; a decision after the last repair is a re-review.
      review: {
        verdict: latest.action, reasonCode: latest.reasonCode,
        repairRounds: decisions.filter((decision) => decision.action === 'REPAIR').length,
        reReviewedAfterRepair: lastRepair !== -1 && lastRepair < decisions.length - 1,
        decisions: decisions.length,
      },
      failure: view.failure,
      // No billing record was read (the fixture's result source has none), so every C.A.R.D. role's billing is
      // UNKNOWN -- one unestablished component each, no amount -- never guessed.
      cost: {
        visible: true, knownUsdMicros: view.cost.knownUsdMicros, unknownComponents: view.cost.unknownComponents, complete: view.cost.complete,
        billing: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'].map((role) => ({
          role, billingPath: 'UNKNOWN', apiSpendUsdMicros: null, unestablishedComponents: 1,
        })),
      },
      // Nothing Julius serves reports tokens; nothing in this view needed screening.
      tokens: 'UNKNOWN',
      withheldDetails: 0,
    },
  };
}

describe('R5: golden bodies, DERIVED from the fixture and the contract -- not captured (internal review A6)', () => {
  // Key ORDER is not part of the client contract (UE's FJsonObject and the strict reader both read by name), so the
  // comparison is structural; that the same run answers the same BYTES twice is pinned in "R5: a deterministic contract".
  it('hydrate', async () => {
    const { status, body } = await asClient('hydrate', { world: worldOver(ledgerPool({ gates: GOLDEN_GATES })) });
    expect(status).toBe(200);
    expect(JSON.parse(body)).toStrictEqual(expectedHydration(DEFAULT_EVENTS, GOLDEN_GATES));
  });

  it('hydrate, with two gates open -- so the open approvals (2) and the active tasks (1) cannot be mistaken for each other', async () => {
    const gates = [...GOLDEN_GATES, { ...GOLDEN_GATES[0], gate_id: 'approval-2', operation: 'ACCESS_NETWORK', reason_code: 'NETWORK_APPROVAL_REQUIRED' }];
    const { status, body } = await asClient('hydrate', { world: worldOver(ledgerPool({ gates })) });
    expect(status).toBe(200);
    expect(JSON.parse(body)).toStrictEqual(expectedHydration(DEFAULT_EVENTS, gates));
  });

  it('events?mode=page from cursor 0', async () => {
    const { status, body } = await asClient('events', { world: worldOver(ledgerPool()) });
    expect(status).toBe(200);
    expect(JSON.parse(body)).toStrictEqual(expectedPage(DEFAULT_EVENTS, 0));
  });

  it('events?mode=page resumed after 2 -- the fold starts afresh at the page, the silent event first', async () => {
    const { status, body } = await asClient('events', { world: worldOver(ledgerPool()) }, 2);
    expect(status).toBe(200);
    expect(JSON.parse(body)).toStrictEqual(expectedPage(DEFAULT_EVENTS, 2));
  });

  it('result, for the owner', async () => {
    const { status, body } = await asClient('result', { world: worldOver(ledgerPool()) });
    expect(status).toBe(200);
    expect(JSON.parse(body)).toStrictEqual(expectedResult(VIEW));
  });

  it('every derived golden decodes by the client\'s rules -- a golden the client would refuse would pin the wrong contract', () => {
    expect(clientHydrate(JSON.stringify(expectedHydration(DEFAULT_EVENTS, GOLDEN_GATES)), ASKED).run.runId).toBe(RUN);
    expect(clientPage(JSON.stringify(expectedPage(DEFAULT_EVENTS, 0)), ASKED).deliveries.map((delivery) => delivery.envelope.sequence)).toEqual([1, 2, 4]);
    expect(clientResult(JSON.stringify(expectedResult(VIEW)), RUN)).toMatchObject({ runId: RUN, criteriaMet: 2, criteriaTotal: 2, costVisible: true, taskState: 'Completed' });
  });
});

/* ===================================================================== */
/*  THE LINK THE WORLD SHOWS for every answer these routes give           */
/*  (LinkStateForFailure, internal review Part B)                         */
/* ===================================================================== */

describe('every status these routes answer, as the client reads it: its link state, its token, its retry', () => {
  const NOBODY: WonderlandProjectMembershipSource = { lookup: async () => null };

  /** One real route answer, asked as the client asks -- with the request varied the way each status needs. */
  async function answerFor(route: 'hydrate' | 'events' | 'result', vary: {
    readonly authorization?: string | null;
    readonly world?: WonderlandJuliusWorld | null;
    readonly runId?: string;
    readonly cursor?: string;
  }) {
    const store = createBrowserSessionStore();
    const token = nativeSession(store);
    const query = `projectId=${encodeURIComponent(PROJECT)}&runId=${vary.runId ?? RUN}&cursor=${vary.cursor ?? '0'}`;
    const url = route === 'events' ? `/wonderland/julius/events?mode=page&${query}` : `/wonderland/julius/${route}?${query}`;
    const authorization = vary.authorization === undefined ? `Relay-Session ${token}` : vary.authorization ?? undefined;
    const answer = await handleWonderlandJuliusRoute(
      { method: 'GET', path: `/wonderland/julius/${route}`, url, authorization, origin: undefined, now: NOW },
      { sessions: store, world: vary.world === undefined ? worldOver(ledgerPool()) : vary.world },
    );
    return { status: answer?.status ?? 0, body: JSON.stringify(answer?.body ?? null) };
  }

  const CASES: ReadonlyArray<[string, Parameters<typeof answerFor>[1], number]> = [
    ['the run, served', {}, 200],
    ['no session at all', { authorization: null }, 401],
    ['a session the bridge does not know', { authorization: 'Relay-Session not-a-session-the-bridge-minted' }, 401],
    ['a player who is not a member', { world: worldOver(ledgerPool(), NOBODY) }, 404],
    ['a run that does not exist', { runId: 'run:ffffffff' }, 404],
    ['an identified caller\'s malformed cursor', { cursor: '0x10' }, 400],
    ['a bridge with no world configured', { world: null }, 503],
  ];

  /** Failed(status) for any status LinkStateForFailure does not name: Stale, the token kept, hydrate again after a backoff. */
  const FAILED_STALE = { link: 'Stale' as ClientLinkState, tokenInvalidated: false, rehydrates: true };
  /** What the world's follow should show for each status (JS:66-80 through Failed, JS:1011-1031). */
  const FOLLOW: Readonly<Record<number, { link: ClientLinkState; tokenInvalidated: boolean; rehydrates: boolean }>> = {
    200: { link: 'Live', tokenInvalidated: false, rehydrates: false },
    401: { link: 'SessionExpired', tokenInvalidated: true, rehydrates: true },
    404: { link: 'Refused', tokenInvalidated: false, rehydrates: true },
    400: FAILED_STALE,
    503: FAILED_STALE,
  };

  for (const [label, vary, status] of CASES) {
    it(`${status}, ${label}: hydrate and events move the link as LinkStateForFailure says; the result leaves it alone`, async () => {
      for (const route of ['hydrate', 'events'] as const) {
        const answer = await answerFor(route, vary);
        expect(answer.status, `${route}: ${answer.body}`).toBe(status);
        expect(clientFollowLeg(route, answer.status, answer.body, ASKED), route).toEqual(FOLLOW[status]);
      }
      const result = await answerFor('result', vary);
      expect(result.status, result.body).toBe(status);
      // "NOT A LINK FAILURE" (JS:839-846): whatever the status, the link and the token are untouched; only a good 200 is adopted.
      expect(clientResultLeg(result.status, result.body, RUN)).toEqual({
        linkChanged: false, tokenInvalidated: false, adopted: status === 200, retriesAfterBackoff: status !== 200,
      });
    });
  }

  it('LinkStateForFailure itself, verbatim: no connection is Stale whatever the status; 401 SessionExpired; 403 and 404 Refused; anything else Stale', () => {
    expect(linkStateForFailure(401, false)).toBe('Stale');
    expect(linkStateForFailure(0, false)).toBe('Stale');
    expect(linkStateForFailure(401, true)).toBe('SessionExpired');
    expect(linkStateForFailure(403, true)).toBe('Refused');
    expect(linkStateForFailure(404, true)).toBe('Refused');
    for (const other of [200, 400, 429, 500, 502, 503, 504]) expect(linkStateForFailure(other, true), String(other)).toBe('Stale');
  });

  it('a 200 the client cannot decode is Failed(200) -- Stale, never Live -- while a DECODED foreign delivery leaves the page Live', async () => {
    const hydrate = JSON.parse((await asClient('hydrate', { world: worldOver(ledgerPool()) })).body);
    hydrate.data.visualState = 'running';
    expect(clientFollowLeg('hydrate', 200, JSON.stringify(hydrate), ASKED)).toEqual(FAILED_STALE);
    // AdoptHydration's refusal is a failure of the hydrate leg too.
    expect(clientFollowLeg('hydrate', 200, (await asClient('hydrate', { world: worldOver(ledgerPool()) })).body, { projectId: PROJECT, runId: 'run:other' }).link).toBe('Stale');
    const page = JSON.parse((await asClient('events', { world: worldOver(ledgerPool()) })).body);
    expect(clientFollowLeg('events', 200, JSON.stringify({ data: { ...page.data, deliveries: 'none' } }), ASKED).link).toBe('Stale');
    // ApplyEnvelope refuses an envelope of another run by the subsystem's rule; that is no link failure (JS:772-793).
    expect(clientFollowLeg('events', 200, (await asClient('events', { world: worldOver(ledgerPool()) })).body, { projectId: PROJECT, runId: 'run:other' }).link).toBe('Live');
  });
});
