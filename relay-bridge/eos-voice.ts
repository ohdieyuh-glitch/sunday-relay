import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { PartyDeparture } from '../src/relay/social/social-parties';
import { normalizePuid, oneVoiceJoinAtATime, type VoiceBindingStore } from '../src/relay/social/voice-binding';
import type { PartyVoiceGrant, PartyVoiceTokenMinter } from './wonderland-social-routes';

/**
 * WONDERLAND PARTY VOICE ON EOS (R16, founder ruling 10-04: "USE EOS VOICE ... The backend may mint the required room/token
 * authorization"). The bridge side of CORE's FWonderlandEosVoice:
 *   - EosVoiceTokenMinter: a Trusted Server access token (client credentials), cached; createRoomToken for ONE bound PUID in the
 *     party's room; the participant token handed back as the JSON EOSVoiceChat expects.
 *   - createVoiceRemovals: after a committed party departure (leave, a leader's removal, a block's F1 separation), the departed
 *     member's PUIDs -- every one this process minted a token for there, plus the bound one -- are removed from that party's
 *     room server-side (Epic's removeParticipant also revokes their room token), retried with backoff, never blocking or
 *     failing the social change; one given up on is kept pending and tried again (EOS_PENDING_RETRY).
 * NOTHING SECRET IS LOGGED: room ids and PUIDs appear only hashed ('#' + sha1, 12 hex); never a client secret, an access token, a
 * participant token or the media server address. The HTTP is behind an injectable fetch, so tests use a recorded fake; the real
 * API is exercised only by the R16 run.
 */

/* ============================================================================================================================
 * EPIC'S VOICE WEB API, AS THIS FILE SPEAKS IT (https://dev.epicgames.com/docs/web-api-ref/voice-web-api; the EOS auth token
 * endpoint). EVERY Epic URL, form field, header and JSON field name this module uses is here, and nowhere else.
 * VERIFIED against Epic on 2026-10-04 07:34Z by a backend probe through loadEosVoiceConfig and these constants (evidence:
 * _qa_handoff/social/eos_probe/probe_status_20261004T0734Z.txt):
 *   - the token: oauth 200 with {access_token, expires_in, expires_at, ...};
 *   - the room: createRoomToken 200 with {clientBaseUrl, participants[{clientIp, hardMuted, puid, token}], roomId, roomOptions,
 *     deploymentId};
 *   - the participant: DELETE .../participants/{puid} 204.
 * STILL UNVERIFIED: that the DELETE also revokes the removed participant's room token (Epic documents it; not yet observed); the
 * room token's lifetime (the answer carries no expiry field -- roomTokenAssumedTtlMs, 10 min, is an assumption); and Epic does
 * NOT validate PUIDs, so the server-side PUID binding (migration 035) is the ONLY guard
 * on who a room token is minted for.
 * ========================================================================================================================== */
export const EPIC = Object.freeze({
  apiRoot: 'https://api.epicgames.dev',
  // client-credentials grant for the Trusted Server client, scoped to the deployment; HTTP Basic auth = clientId:clientSecret
  tokenPath: '/auth/v1/oauth/token',
  tokenForm: { grantType: 'grant_type', grantTypeValue: 'client_credentials', deploymentId: 'deployment_id' },
  tokenAnswer: { accessToken: 'access_token', expiresIn: 'expires_in', expiresAt: 'expires_at' },
  // createRoomToken: POST, creates the room if absent; one participant per call here
  roomPath: (deploymentId: string, roomId: string) => `/rtc/v1/${deploymentId}/room/${roomId}`,
  roomBody: { participants: 'participants', puid: 'puid', hardMuted: 'hardMuted' },
  roomAnswer: { clientBaseUrl: 'clientBaseUrl', participants: 'participants', puid: 'puid', token: 'token' },
  // removeParticipant: DELETE; removes the player from the room AND revokes their room token
  participantPath: (deploymentId: string, roomId: string, puid: string) => `/rtc/v1/${deploymentId}/room/${roomId}/participants/${puid}`,
  // the participant token EOSVoiceChat's JoinChannel takes (UE 5.8 EOSVoiceChatTypes.h:14-20 -- CORE's side)
  sdkToken: { clientBaseUrl: 'client_base_url', participantToken: 'participant_token' },
  // Epic's answer carries no room-token expiry as far as the reference text shows; the grant reports this ASSUMED lifetime
  roomTokenAssumedTtlMs: 10 * 60_000,
});

/**
 * THE ONLY FORM IN WHICH AN ID REACHES A LOG LINE: '#' + the first 12 lowercase hex of SHA-1(UTF-8 bytes of the value).
 * SHA-1 because the game hashes the same ids with FSHA1 (UE 5.8 has no SHA-256 on Windows: GetSHA256Signature is checkf(false)),
 * so a client log line and a bridge log line about the same room or PUID can be matched. A log correlation tag, not a secret:
 * '0123456789abcdef0123456789abcdef' -> '#b1775a785f09' (pinned in eos-voice.test.ts).
 * Inputs: a room id exactly as the client receives it (the 32-hex roomId of the grant); a PUID through hashPuid (lowercased).
 */
export const hashId = (value: string): string => `#${createHash('sha1').update(value, 'utf8').digest('hex').slice(0, 12)}`;

/** A PUID's log tag: lowercased first (normalizePuid), so 'ABC...' and 'abc...' -- one EOS account -- carry one tag. */
export const hashPuid = (puid: string): string => hashId(normalizePuid(puid) ?? puid.trim().toLowerCase());

/**
 * A FAILURE AS A LOG LINE MAY CARRY IT (MAIN's internal review a6d5842c, NOTE): its kind -- Epic's HTTP status, a SQLSTATE or system
 * error code, or the error's class -- and hashId of its message. Never the message itself, which can name a host, a path or a
 * value; the hash still lets two lines about one failure be matched.
 */
export function failureTag(error: unknown): string {
  const e = (typeof error === 'object' && error !== null ? error : {}) as { code?: unknown; name?: unknown; message?: unknown };
  const kind = error instanceof EosHttpError
    ? `http ${error.status}`
    : typeof e.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(e.code)
      ? `code ${e.code}`
      : typeof e.name === 'string' && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : 'unknown';
  return `${kind} ${hashId(typeof e.message === 'string' ? e.message : String(error))}`;
}

/* ------------------------------------------------------------------------------------------------ config */

export const EOS_VOICE_CONFIG_ENV = 'WONDERLAND_EOS_VOICE_CONFIG';
/** The room-salt file (one line, >= 32 characters): NOT a founder credential -- the R16 runner generates it. */
export const EOS_ROOM_SALT_FILE_ENV = 'WONDERLAND_EOS_ROOM_SALT_FILE';

export interface EosVoiceConfig {
  readonly productId: string;
  readonly sandboxId: string;
  readonly deploymentId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Per-deployment secret salt for the opaque room ids (HMAC). */
  readonly roomSalt: string;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
/** The room salt, in either config form: 32 to 512 characters (MAIN's internal review a6d5842c, m6: the JSON form took 16). */
const MIN_ROOM_SALT = 32;

/**
 * A config PATH variable set to this reads the SAME keys from the process environment instead of a file: for a host whose secrets
 * are variables, not files (Railway; JUJU MAIN's hosted deploy plan r3, 10-04, option (iii)). Same refusals, same name-only logs.
 */
export const EOS_FROM_ENV = 'env:';
/** With WONDERLAND_EOS_ROOM_SALT_FILE=env:, the salt itself: 32 to 512 characters, a STABLE secret of the deployment. */
export const EOS_ROOM_SALT_ENV = 'WONDERLAND_EOS_ROOM_SALT';
/** EOS_GAME_CLIENT_ID is read only to refuse a voice client that IS the game client; the game client's secret is never read here. */
const EOS_VOICE_KEYS = ['EOS_PRODUCT_ID', 'EOS_SANDBOX_ID', 'EOS_DEPLOYMENT_ID', 'EOS_SERVER_CLIENT_ID', 'EOS_SERVER_CLIENT_SECRET', 'EOS_GAME_CLIENT_ID'] as const;

/** Exactly the named keys from the process environment, as parseDotEnv gives them from a file: trimmed; empty = absent. */
function eosKeysFromEnv(env: NodeJS.ProcessEnv, names: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of names) {
    const value = env[name]?.trim() ?? '';
    if (value !== '') out.set(name, value);
  }
  return out;
}

/**
 * A .env file's KEY=VALUE lines: CRLF or LF, an optional UTF-8 BOM, blank lines and '#' comments ignored, whitespace around '='
 * trimmed, one pair of surrounding single or double quotes stripped. Every key is kept; the caller reads only the ones it knows.
 */
export function parseDotEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    out.set(key, value);
  }
  return out;
}

/**
 * The EOS config, named by WONDERLAND_EOS_VOICE_CONFIG (a path outside every repo). TWO FORMATS, told apart by the first
 * non-space character:
 *   '{'  the JSON object {productId, sandboxId, deploymentId, clientId, clientSecret, roomSalt}: clientId is the Trusted Server
 *        client's, and roomSalt holds 32 to 512 characters (as the .env form's salt does);
 *   else the founder's .env: EOS_PRODUCT_ID, EOS_SANDBOX_ID, EOS_DEPLOYMENT_ID, and the Trusted Server client --
 *        EOS_SERVER_CLIENT_ID + EOS_SERVER_CLIENT_SECRET; the room salt from the SEPARATE file named by
 *        WONDERLAND_EOS_ROOM_SALT_FILE (first line, >= 32 characters).
 * THE TRUSTED SERVER CLIENT ONLY (MAIN's internal review a6d5842c, M3). The game client's pair is handed to every signed-in desktop
 * client (GET .../voice/eos-client-config); were it the voice client, any player holding it could mint room tokens and remove
 * participants at Epic directly -- a former member included. So EOS_GAME_* is never a fallback, and a voice client whose id IS
 * the game client's is refused: in the .env form here; in either form against the game config, in eosFromEnv.
 * EITHER path variable may be `env:` (EOS_FROM_ENV): the same .env keys, or the salt as WONDERLAND_EOS_ROOM_SALT, from the process
 * environment -- a host whose secrets are variables (JUJU MAIN's hosted plan r3).
 * Any missing key, unreadable file, field out of shape or short salt: null -- party voice stays 503, with no fallback. A log line
 * names WHICH key or file is wanting (key names only); it never carries a value, and never a path ("the EOS config file", "the
 * room salt file").
 */
export function loadEosVoiceConfig(env: NodeJS.ProcessEnv, deps: { readFile?: (path: string) => string; log?: (line: string) => void } = {}): EosVoiceConfig | null {
  const log = deps.log ?? (() => undefined);
  const read = deps.readFile ?? ((p: string) => readFileSync(p, 'utf8'));
  const refuse = (why: string): null => {
    log(`eos voice: ${why} -- party voice answers 503`);
    return null;
  };
  const path = env[EOS_VOICE_CONFIG_ENV]?.trim() ?? '';
  if (path === '') return refuse(`${EOS_VOICE_CONFIG_ENV} is not set`);
  // a host whose secrets are variables: the same keys, from this process's environment (never a file)
  if (path === EOS_FROM_ENV) return configFromKeys(eosKeysFromEnv(env, EOS_VOICE_KEYS), 'the environment', env, read, refuse, log);
  let text: string;
  try {
    text = read(path).replace(/^﻿/, '');
  } catch {
    return refuse('the EOS config file could not be read');
  }
  return text.trimStart().startsWith('{') ? configFromJson(text, refuse, log) : configFromKeys(parseDotEnv(text), 'the EOS config file', env, read, refuse, log);
}

function configFromJson(text: string, refuse: (why: string) => null, log: (line: string) => void): EosVoiceConfig | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse('the EOS config file is not valid JSON');
  }
  const r = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string).trim() : '');
  const config = { productId: str('productId'), sandboxId: str('sandboxId'), deploymentId: str('deploymentId'), clientId: str('clientId'), clientSecret: str('clientSecret'), roomSalt: str('roomSalt') };
  const bad = [
    ...(['productId', 'sandboxId', 'deploymentId', 'clientId'] as const).filter((k) => !ID.test(config[k])),
    ...(config.clientSecret.length > 0 && config.clientSecret.length <= 512 ? [] : ['clientSecret']),
    ...(config.roomSalt.length >= MIN_ROOM_SALT && config.roomSalt.length <= 512 ? [] : ['roomSalt']),
  ];
  if (bad.length > 0) return refuse(`the EOS config file is missing or has out of shape: ${bad.join(', ')}`);
  log('eos voice: configured (JSON)');
  return config;
}

function configFromKeys(keys: ReadonlyMap<string, string>, source: string, env: NodeJS.ProcessEnv, read: (path: string) => string, refuse: (why: string) => null, log: (line: string) => void): EosVoiceConfig | null {
  const get = (k: string) => keys.get(k) ?? '';
  const ids = ['EOS_PRODUCT_ID', 'EOS_SANDBOX_ID', 'EOS_DEPLOYMENT_ID'] as const;
  const missingIds = ids.filter((k) => get(k) === '');
  const shapelessIds = ids.filter((k) => get(k) !== '' && !ID.test(get(k)));
  // THE CLIENT: the Trusted Server client, and only it (M3: the game client is never a fallback)
  const client = { id: get('EOS_SERVER_CLIENT_ID'), secret: get('EOS_SERVER_CLIENT_SECRET') };
  const missingClient = [...(client.id === '' ? ['EOS_SERVER_CLIENT_ID'] : []), ...(client.secret === '' ? ['EOS_SERVER_CLIENT_SECRET'] : [])];
  const missing = [...missingIds, ...missingClient];
  if (missing.length > 0) {
    return refuse(`${source} is missing ${missing.join(', ')}${missingClient.length > 0 ? ' (voice uses the Trusted Server client only; EOS_GAME_* is never used for voice)' : ''}`);
  }
  const shapeless = [...shapelessIds, ...(ID.test(client.id) ? [] : ['EOS_SERVER_CLIENT_ID']), ...(client.secret.length <= 512 ? [] : ['EOS_SERVER_CLIENT_SECRET'])];
  if (shapeless.length > 0) return refuse(`${source} has out of shape: ${shapeless.join(', ')}`);
  if (get('EOS_GAME_CLIENT_ID') === client.id) return refuse(`${source} names the game client as the voice client (EOS_SERVER_CLIENT_ID equals EOS_GAME_CLIENT_ID)`);
  // THE ROOM SALT, from its own file (not a founder credential)
  const saltPath = env[EOS_ROOM_SALT_FILE_ENV]?.trim() ?? '';
  if (saltPath === '') return refuse(`${EOS_ROOM_SALT_FILE_ENV} is not set (the room salt file)`);
  let salt: string;
  if (saltPath === EOS_FROM_ENV) {
    // the salt as a variable: a STABLE secret of the deployment, never generated here (a new salt orphans every room)
    salt = (env[EOS_ROOM_SALT_ENV] ?? '').trim();
  } else {
    try {
      salt = (read(saltPath).replace(/^﻿/, '').split(/\r?\n/)[0] ?? '').trim();
    } catch {
      return refuse('the room salt file could not be read');
    }
  }
  if (salt.length < MIN_ROOM_SALT || salt.length > 512) {
    return refuse(saltPath === EOS_FROM_ENV ? `${EOS_ROOM_SALT_ENV} must hold ${MIN_ROOM_SALT} to 512 characters` : `the room salt file must hold one line of ${MIN_ROOM_SALT} to 512 characters`);
  }
  log('eos voice: client kind server');
  return { productId: get('EOS_PRODUCT_ID'), sandboxId: get('EOS_SANDBOX_ID'), deploymentId: get('EOS_DEPLOYMENT_ID'), clientId: client.id, clientSecret: client.secret, roomSalt: salt };
}

/* ------------------------------------------------------------------------------------------------ the game client's config */

/** The founder's eos-game.env, by path: the GAME client's EOS values, which the bridge hands to signed-in desktop clients. */
export const EOS_GAME_CONFIG_ENV = 'WONDERLAND_EOS_GAME_CONFIG';
/** The client config answer's schema tag; the client checks it before reading a value (CORE's ConfigFromServer). */
export const EOS_CLIENT_CONFIG_SCHEMA = 'wonderland-eos-client-config.v1';

/** What a desktop client's EOS platform starts with: the GAME client's values, never the Trusted Server's. */
export interface EosGameClientConfig {
  readonly productId: string;
  readonly sandboxId: string;
  readonly deploymentId: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

/** The ids the game config must share with the voice config: a client started on another deployment never reaches its rooms. */
export type EosDeployment = Pick<EosVoiceConfig, 'productId' | 'sandboxId' | 'deploymentId'>;

const EOS_GAME_KEYS = ['EOS_PRODUCT_ID', 'EOS_SANDBOX_ID', 'EOS_DEPLOYMENT_ID', 'EOS_GAME_CLIENT_ID', 'EOS_GAME_CLIENT_SECRET'] as const;

/**
 * THE GAME CLIENT'S EOS CONFIG (founder, 10-04: the backend hands the EOS game-client config to the shipped client, which holds
 * it in memory only; it is never in the package). Read ONCE, at start, from the founder's eos-game.env named by
 * WONDERLAND_EOS_GAME_CONFIG: EOS_PRODUCT_ID, EOS_SANDBOX_ID, EOS_DEPLOYMENT_ID, EOS_GAME_CLIENT_ID, EOS_GAME_CLIENT_SECRET.
 * ONLY the EOS_GAME_* pair is ever read. The Trusted Server's EOS_SERVER_* pair is never a client's: a file holding only that
 * pair is refused, and a file holding both serves the game pair. Given `deployment` (the voice config's ids), a game config
 * naming another product, sandbox or deployment is refused, since its clients could never join the rooms the bridge mints.
 * WONDERLAND_EOS_GAME_CONFIG=env: reads the same five keys from the process environment instead (EOS_FROM_ENV), never EOS_SERVER_*.
 * Absent, unreadable, not the .env form, missing a key, out of shape or mismatched: null, and the route answers 503. The log
 * says "eos game config: loaded (5 keys)", "absent", or why not by key or field NAME; never a value, a length or the path.
 */
export function loadEosGameClientConfig(
  env: NodeJS.ProcessEnv,
  deps: { readFile?: (path: string) => string; log?: (line: string) => void; deployment?: EosDeployment | null } = {},
): EosGameClientConfig | null {
  const log = deps.log ?? (() => undefined);
  const read = deps.readFile ?? ((p: string) => readFileSync(p, 'utf8'));
  const refuse = (why: string): null => {
    log(`eos game config: ${why} -- the client config route answers 503`);
    return null;
  };
  const path = env[EOS_GAME_CONFIG_ENV]?.trim() ?? '';
  if (path === '') {
    log('eos game config: absent');
    return null;
  }
  let keys: ReadonlyMap<string, string>;
  let source: string;
  if (path === EOS_FROM_ENV) {
    // a host whose secrets are variables: ONLY the five game keys are looked up, so EOS_SERVER_* is never read even beside them
    keys = eosKeysFromEnv(env, EOS_GAME_KEYS);
    source = 'the environment';
  } else {
    let text: string;
    try {
      text = read(path);
    } catch {
      return refuse('the EOS game config file could not be read');
    }
    // trimStart drops a UTF-8 BOM too (U+FEFF is ECMAScript white space)
    if (text.trimStart().startsWith('{')) return refuse('the EOS game config file must be the .env form');
    keys = parseDotEnv(text);
    source = 'the EOS game config file';
  }
  const get = (k: (typeof EOS_GAME_KEYS)[number]) => keys.get(k) ?? '';
  const missing = EOS_GAME_KEYS.filter((k) => get(k) === '');
  if (missing.length > 0) return refuse(`${source} is missing ${missing.join(', ')}`);
  const secret = get('EOS_GAME_CLIENT_SECRET');
  const shapeless = [
    ...EOS_GAME_KEYS.filter((k) => k !== 'EOS_GAME_CLIENT_SECRET' && !ID.test(get(k))),
    ...(secret.length <= 512 && !/\s/.test(secret) ? [] : ['EOS_GAME_CLIENT_SECRET']),
  ];
  if (shapeless.length > 0) return refuse(`${source} has out of shape: ${shapeless.join(', ')}`);
  const config: EosGameClientConfig = Object.freeze({
    productId: get('EOS_PRODUCT_ID'),
    sandboxId: get('EOS_SANDBOX_ID'),
    deploymentId: get('EOS_DEPLOYMENT_ID'),
    clientId: get('EOS_GAME_CLIENT_ID'),
    clientSecret: secret,
  });
  const expected = deps.deployment ?? null;
  if (expected !== null) {
    const differ = (['productId', 'sandboxId', 'deploymentId'] as const).filter((k) => config[k] !== expected[k]);
    if (differ.length > 0) return refuse(`${source} names another ${differ.join(', ')} than the voice config`);
  }
  log('eos game config: loaded (5 keys)');
  return config;
}

/* ------------------------------------------------------------------------------------------------ the minter */

export type EosFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Every Epic call is given up after this long (MAIN's internal review a6d5842c, m1): removals run one at a time, so one hung
 * DELETE used to stall every removal queued behind it, and a hung createRoomToken held a join. A timed-out call is a failure
 * like any other: a removal retries it, and a join answers 503.
 */
export const EOS_REQUEST_TIMEOUT_MS = 10_000;

/**
 * A REMOVAL GIVEN UP IS NOT FORGOTTEN (MAIN's internal review af2eb058, m-a). A PUID that must leave a room -- a departed member's, a
 * token taken back from a caller no longer admitted, one replaced by a re-bind already made -- whose DELETE was given up is KEPT
 * PENDING. It is tried again before the room's next removal or mint, and by a timer: every `everyMs`, at most `maxTimed` timed
 * attempts per PUID, then abandoned (logged). The timer runs only while something is pending. Every line is hashed.
 */
export const EOS_PENDING_RETRY = Object.freeze({ everyMs: 60_000, maxTimed: 30 });

export interface EosVoiceDeps {
  readonly fetchImpl?: EosFetch;
  readonly log?: (line: string) => void;
  readonly now?: () => number;
  /** Tests only: a shorter EOS_REQUEST_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /** Tests only: another EOS_PENDING_RETRY (`everyMs` 0: no timer; tick by hand with retryPendingNow). */
  readonly pendingRetry?: { readonly everyMs: number; readonly maxTimed: number };
}

/** One PUID whose removal from a room was given up, though it must leave (m-a): whose it was, its mint serial, timed attempts so far. */
interface PendingRemoval {
  readonly userId: string;
  readonly serial: number | undefined;
  timedAttempts: number;
}

class EosHttpError extends Error {
  constructor(readonly status: number, what: string) {
    super(`${what} answered ${status}`);
  }
}

const asRecord = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export class EosVoiceTokenMinter implements PartyVoiceTokenMinter, VoiceRemovalTarget {
  readonly providerId = 'eos';
  private token: { value: string; expiresAtMs: number } | null = null;
  private readonly fetchImpl: EosFetch;
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  /**
   * EVERY ROOM TOKEN THIS PROCESS MINTED (MAIN's internal review a6d5842c, B1): player -> room -> PUID -> the serial of that PUID's
   * latest mint. A departure, and a re-bind, take out every PUID minted for that player in that room, not only the one bound now
   * (a re-bind replaces the binding, and Epic does not validate PUIDs, so the replaced one could keep listening).
   * PER PROCESS: this lives in the bridge's memory (the hosted bridge runs ONE instance, as presence does), and a restart forgets
   * it. After a restart, a departure removes the binding's PUID only (the fallback, read when the removal runs). A PUID that a
   * re-bind replaced was already taken out of the room by that re-bind (wonderland-social-routes.ts), and the binding table
   * survives a restart. What a restart can still lose: a token minted for a PUID that is neither bound now nor was the
   * replaced binding.
   */
  private readonly minted = new Map<string, Map<string, Map<string, number>>>();
  private mintSerial = 0;
  /**
   * EVERY PUID THAT MUST STILL LEAVE A ROOM (MAIN's internal review af2eb058, m-a): room -> PUID -> whose, after its removal was
   * given up. Tried again before the room's next removal or mint, and by the timer (EOS_PENDING_RETRY). Per process, as `minted`.
   */
  private readonly pending = new Map<string, Map<string, PendingRemoval>>();
  /** The retry pass running in a room, if any: one pass at a time per room. */
  private readonly pendingPasses = new Map<string, Promise<void>>();
  private pendingTimer: ReturnType<typeof setInterval> | null = null;
  private pendingTicking = false;
  private readonly pendingRetry: { readonly everyMs: number; readonly maxTimed: number };

  constructor(private readonly config: EosVoiceConfig, deps: EosVoiceDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as EosFetch);
    this.log = deps.log ?? (() => undefined);
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? EOS_REQUEST_TIMEOUT_MS;
    this.pendingRetry = deps.pendingRetry ?? EOS_PENDING_RETRY;
  }

  /** The party's room: an opaque HMAC-SHA256(roomSalt, partyId), first 32 hex -- stable, and naming nothing. */
  roomIdFor(partyId: string): string {
    return createHmac('sha256', this.config.roomSalt).update(partyId, 'utf8').digest('hex').slice(0, 32);
  }

  /** A Trusted Server access token, cached until 60 s before it expires. */
  private async accessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token !== null && this.now() < this.token.expiresAtMs - 60_000) return this.token.value;
    const form = new URLSearchParams({ [EPIC.tokenForm.grantType]: EPIC.tokenForm.grantTypeValue, [EPIC.tokenForm.deploymentId]: this.config.deploymentId });
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`, 'utf8').toString('base64');
    const answer = await this.fetchImpl(`${EPIC.apiRoot}${EPIC.tokenPath}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!answer.ok) throw new EosHttpError(answer.status, 'the EOS token endpoint');
    const body = asRecord(await answer.json());
    const value = typeof body[EPIC.tokenAnswer.accessToken] === 'string' ? (body[EPIC.tokenAnswer.accessToken] as string) : '';
    if (value === '') throw new Error('the EOS token endpoint answered without an access token');
    const expiresIn = typeof body[EPIC.tokenAnswer.expiresIn] === 'number' ? (body[EPIC.tokenAnswer.expiresIn] as number) * 1000 : null;
    const expiresAt = typeof body[EPIC.tokenAnswer.expiresAt] === 'string' ? Date.parse(body[EPIC.tokenAnswer.expiresAt] as string) : Number.NaN;
    this.token = { value, expiresAtMs: Number.isFinite(expiresAt) ? expiresAt : this.now() + (expiresIn ?? 0) };
    this.log(`eos voice: access token ${forceRefresh ? 'refreshed after a 401' : 'obtained'}`);
    return value;
  }

  /** One authorised call; a 401 refreshes the access token ONCE and tries again. */
  private async authorised(method: string, path: string, body: unknown, what: string): Promise<{ status: number; json: () => Promise<unknown> }> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const bearer = await this.accessToken(attempt === 1);
      const answer = await this.fetchImpl(`${EPIC.apiRoot}${path}`, {
        method,
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (answer.status === 401 && attempt === 0) continue;
      if (!answer.ok) throw new EosHttpError(answer.status, what);
      return answer;
    }
    throw new EosHttpError(401, what);
  }

  async mint(input: { readonly partyId: string; readonly participantId: string; readonly audience: readonly string[]; readonly nowIso: string; readonly puid?: string }): Promise<PartyVoiceGrant> {
    const puid = input.puid ?? '';
    if (!/^[0-9a-f]{32}$/.test(puid)) throw new Error('an EOS room token needs the caller\'s bound PUID');
    const roomId = this.roomIdFor(input.partyId);
    // m-a: what this room still has pending is tried first; this PUID, admitted by the route now, is no longer pending -- so no
    // timer takes the token minted here away
    await this.retryPending(roomId);
    if (this.dropPending(roomId, puid) !== undefined) this.log(`eos voice: pending removal dropped, admitted again room=${hashId(roomId)} puid=${hashPuid(puid)}`);
    const answer = await this.authorised('POST', EPIC.roomPath(this.config.deploymentId, roomId), {
      [EPIC.roomBody.participants]: [{ [EPIC.roomBody.puid]: puid, [EPIC.roomBody.hardMuted]: false }],
    }, 'createRoomToken');
    const body = asRecord(await answer.json());
    const clientBaseUrl = typeof body[EPIC.roomAnswer.clientBaseUrl] === 'string' ? (body[EPIC.roomAnswer.clientBaseUrl] as string) : '';
    const participants = Array.isArray(body[EPIC.roomAnswer.participants]) ? (body[EPIC.roomAnswer.participants] as unknown[]).map(asRecord) : [];
    const mine = participants.find((p) => p[EPIC.roomAnswer.puid] === puid);
    const token = typeof mine?.[EPIC.roomAnswer.token] === 'string' ? (mine[EPIC.roomAnswer.token] as string) : '';
    if (clientBaseUrl === '' || token === '') throw new Error('createRoomToken answered without a media endpoint or a token for the caller');
    this.recordMint(roomId, input.participantId, puid);
    this.log(`eos voice: room token minted room=${hashId(roomId)} puid=${hashPuid(puid)}`);
    return {
      providerId: this.providerId,
      roomId,
      participantToken: JSON.stringify({ [EPIC.sdkToken.clientBaseUrl]: clientBaseUrl, [EPIC.sdkToken.participantToken]: token }),
      expiresAtIso: new Date(Date.parse(input.nowIso) + EPIC.roomTokenAssumedTtlMs).toISOString(),
    };
  }

  /** Remove a PUID from a room (and revoke its token). Already absent (404) counts as removed; a removal pending for it is done. */
  async removeParticipant(roomId: string, puid: string): Promise<void> {
    try {
      await this.authorised('DELETE', EPIC.participantPath(this.config.deploymentId, roomId, puid), undefined, 'removeParticipant');
    } catch (error) {
      if (!(error instanceof EosHttpError && error.status === 404)) throw error;
    }
    const settled = this.dropPending(roomId, puid);
    if (settled !== undefined) this.forgetMinted(roomId, settled.userId, puid, settled.serial);
  }

  /**
   * KEEP IT PENDING (m-a): this PUID must leave the room, and its removal was given up. Tried again before the room's next removal
   * or mint (retryPending), and by the timer, at most EOS_PENDING_RETRY.maxTimed times. `serial`: its mint's, if this process
   * minted it (forgotten once it is out).
   */
  keepPending(roomId: string, userId: string, puid: string, serial: number | undefined): void {
    let entries = this.pending.get(roomId);
    if (entries === undefined) this.pending.set(roomId, (entries = new Map()));
    entries.set(puid, { userId, serial, timedAttempts: 0 });
    this.log(`eos voice: removal PENDING room=${hashId(roomId)} puid=${hashPuid(puid)}: retried before the room's next removal or mint, and by a timer`);
    if (this.pendingTimer === null && this.pendingRetry.everyMs > 0) {
      const timer = setInterval(() => void this.retryPendingNow(), this.pendingRetry.everyMs);
      timer.unref?.(); // never what keeps the bridge process alive
      this.pendingTimer = timer;
    }
  }

  /** The PUIDs pending in a room, each with whose it was (tests; a reviewer). */
  pendingIn(roomId: string): ReadonlyMap<string, string> {
    return new Map([...(this.pending.get(roomId) ?? new Map<string, PendingRemoval>())].map(([puid, entry]) => [puid, entry.userId]));
  }

  /**
   * One more attempt at every PUID pending in this room, after any pass already running there (passes in a room never overlap).
   * `timed`: the timer's attempt, counted against EOS_PENDING_RETRY.maxTimed. Never rejects: what fails stays pending.
   */
  async retryPending(roomId: string, timed = false): Promise<void> {
    for (let running = this.pendingPasses.get(roomId); running !== undefined; running = this.pendingPasses.get(roomId)) await running;
    if ((this.pending.get(roomId)?.size ?? 0) === 0) return;
    // a pass never fails its caller: what was not removed stays pending
    const pass = this.runPendingPass(roomId, timed).catch(() => undefined);
    this.pendingPasses.set(roomId, pass);
    try {
      await pass;
    } finally {
      // this caller awaited the pass first, so it clears it before any waiter looks again
      if (this.pendingPasses.get(roomId) === pass) this.pendingPasses.delete(roomId);
    }
  }

  /** One tick of the timer: a timed attempt at every pending PUID, room by room. Ticks never overlap. Never rejects. */
  async retryPendingNow(): Promise<void> {
    if (this.pendingTicking) return;
    this.pendingTicking = true;
    try {
      for (const roomId of [...this.pending.keys()]) await this.retryPending(roomId, true);
    } finally {
      this.pendingTicking = false;
    }
  }

  private async runPendingPass(roomId: string, timed: boolean): Promise<void> {
    for (const [puid, entry] of [...(this.pending.get(roomId) ?? [])]) {
      if (this.pending.get(roomId)?.get(puid) !== entry) continue; // out, or admitted again, meanwhile
      try {
        await this.removeParticipant(roomId, puid); // drops it from pending
        this.log(`eos voice: removed room=${hashId(roomId)} puid=${hashPuid(puid)} (a pending removal)`);
      } catch (error) {
        const status = error instanceof EosHttpError ? error.status : 'network';
        if (!timed) {
          this.log(`eos voice: pending removal failed room=${hashId(roomId)} puid=${hashPuid(puid)} (${status}); still pending`);
        } else if ((entry.timedAttempts += 1) < this.pendingRetry.maxTimed) {
          this.log(`eos voice: pending removal failed room=${hashId(roomId)} puid=${hashPuid(puid)} (${status}); timed attempt ${entry.timedAttempts} of ${this.pendingRetry.maxTimed}`);
        } else if (this.pending.get(roomId)?.get(puid) === entry) {
          this.dropPending(roomId, puid);
          this.log(`eos voice: pending removal ABANDONED room=${hashId(roomId)} puid=${hashPuid(puid)} after ${entry.timedAttempts} timed attempts`);
        }
      }
    }
  }

  /** Take a PUID off the pending record (it is out, admitted again, or abandoned); the timer stops once nothing is pending. */
  private dropPending(roomId: string, puid: string): PendingRemoval | undefined {
    const entries = this.pending.get(roomId);
    const entry = entries?.get(puid);
    if (entries === undefined || entry === undefined) return undefined;
    entries.delete(puid);
    if (entries.size === 0) this.pending.delete(roomId);
    if (this.pending.size === 0 && this.pendingTimer !== null) {
      clearInterval(this.pendingTimer);
      this.pendingTimer = null;
    }
    return entry;
  }

  private recordMint(roomId: string, userId: string, puid: string): void {
    let rooms = this.minted.get(userId);
    if (rooms === undefined) this.minted.set(userId, (rooms = new Map()));
    let puids = rooms.get(roomId);
    if (puids === undefined) rooms.set(roomId, (puids = new Map()));
    this.mintSerial += 1;
    puids.set(puid, this.mintSerial);
  }

  /** Every PUID this process minted a room token for, for this player in this room, each with the serial of its latest mint. */
  mintedIn(roomId: string, userId: string): ReadonlyMap<string, number> {
    return new Map(this.minted.get(userId)?.get(roomId) ?? []);
  }

  /** That PUID is out of the room: forget it -- unless it was minted again after `serial` (that newer token is still live). */
  forgetMinted(roomId: string, userId: string, puid: string, serial: number | undefined): void {
    const rooms = this.minted.get(userId);
    const puids = rooms?.get(roomId);
    if (rooms === undefined || puids === undefined || serial === undefined || puids.get(puid) !== serial) return;
    puids.delete(puid);
    if (puids.size === 0) rooms.delete(roomId);
    if (rooms.size === 0) this.minted.delete(userId);
  }

  /**
   * THE ROUTE'S REMOVAL (PartyVoiceTokenMinter.removeFromRoom): every PUID this process minted for the player in the party's room,
   * plus `puids` (a binding, whose token may predate a restart), one DELETE each -- after what the room has pending (m-a).
   * Resolves when every one is confirmed (an absent participant counts); otherwise rejects, after trying them all. `mustLeave`:
   * one not confirmed is KEPT PENDING (keepPending). Ids are logged hashed; the error names none.
   */
  async removeFromRoom(input: { readonly partyId: string; readonly participantId: string; readonly puids: readonly string[]; readonly mustLeave: boolean }): Promise<void> {
    const roomId = this.roomIdFor(input.partyId);
    await this.retryPending(roomId);
    const minted = this.mintedIn(roomId, input.participantId);
    const given = input.puids.map((p) => normalizePuid(p)).filter((p): p is string => p !== null);
    const targets = [...new Set([...minted.keys(), ...given])];
    let failed = 0;
    for (const puid of targets) {
      try {
        await this.removeParticipant(roomId, puid);
        this.forgetMinted(roomId, input.participantId, puid, minted.get(puid));
        this.log(`eos voice: removed room=${hashId(roomId)} puid=${hashPuid(puid)}`);
      } catch (error) {
        failed += 1;
        this.log(`eos voice: removal failed room=${hashId(roomId)} puid=${hashPuid(puid)} (${error instanceof EosHttpError ? error.status : 'network'})`);
        if (input.mustLeave) this.keepPending(roomId, input.participantId, puid, minted.get(puid));
      }
    }
    if (failed > 0) throw new Error(`${failed} of ${targets.length} participant removals failed`);
  }
}

/* ------------------------------------------------------------------------------------------------ server-side removal */

export interface VoiceRemovalTarget {
  roomIdFor(partyId: string): string;
  removeParticipant(roomId: string, puid: string): Promise<void>;
  /** Every PUID this process minted a token for, for this player in this room (EosVoiceTokenMinter's record). */
  mintedIn(roomId: string, userId: string): ReadonlyMap<string, number>;
  /** That PUID is out of the room: forget it, unless it was minted again after `serial`. */
  forgetMinted(roomId: string, userId: string, puid: string, serial: number | undefined): void;
  /** Its removal was given up, but it must leave: tried again before the room's next removal or mint, and by a timer (m-a). */
  keepPending(roomId: string, userId: string, puid: string, serial: number | undefined): void;
  /** One more attempt at what this room has pending. Never rejects. */
  retryPending(roomId: string): Promise<void>;
}

export interface VoiceRemovals {
  /** Called by the social store's after-commit hook: queues the removals and returns at once (never awaited by the change). */
  onDepartures(departures: readonly PartyDeparture[]): void;
  /** Resolves when everything queued so far has finished (tests; a graceful shutdown). */
  idle(): Promise<void>;
}

/**
 * SERVER-SIDE REMOVAL (review #3, #6): a departed member is taken out of that party's room even if their client misbehaves.
 * WHICH PUIDs (MAIN's internal review a6d5842c, B1): every PUID this process minted a token for, for that member in that room
 * (read when the removal runs, so a join racing the departure is caught too), plus the PUID bound to them now -- the fallback for
 * a token minted before a restart (see EosVoiceTokenMinter.minted for the per-process limit). In departure order, one at a time,
 * and each in its player's voice queue too (oneVoiceJoinAtATime, MAIN's internal review af2eb058 m-b): queued when the departure
 * commits, so it runs after that player's joins queued before it and before any join queued after it -- a re-bind in another
 * party can no longer move the binding before this removal reads it. Each PUID is
 * tried up to 1 + backoff.length times (default 0.25 s, 1 s, 4 s), then given up and logged. A PUID given up on is KEPT
 * PENDING (MAIN's internal review af2eb058, m-a; it used to wait for the same member's next departure, which a taken-back non-member
 * never makes): tried again before the room's next removal or mint, and by a timer (EOS_PENDING_RETRY). Every Epic call times out
 * (EOS_REQUEST_TIMEOUT_MS), so a hung one can no longer stall the removals queued behind it; the binding lookup is retried the
 * same way. A member who never joined voice has nothing to remove. Ids are logged hashed.
 */
export function createVoiceRemovals(deps: {
  readonly target: VoiceRemovalTarget;
  readonly bindings: () => VoiceBindingStore | null;
  readonly log?: (line: string) => void;
  readonly backoffMs?: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
}): VoiceRemovals {
  const log = deps.log ?? (() => undefined);
  const backoff = deps.backoffMs ?? [250, 1000, 4000];
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let chain: Promise<void> = Promise.resolve();
  /**
   * The PUID bound to the member now, if any. A lookup that fails is logged (hashed, with its reason) and retried with the same
   * backoff (MAIN's internal review a6d5842c, m1: it used to be swallowed); given up, the minted PUIDs are still removed.
   */
  const boundPuidOf = async (userId: string): Promise<string | undefined> => {
    const bindings = deps.bindings();
    if (bindings === null) return undefined;
    for (let attempt = 0; attempt <= backoff.length; attempt += 1) {
      try {
        return (await bindings.puidsOf([userId])).get(userId);
      } catch (error) {
        log(`eos voice: binding lookup failed user=${hashId(userId)} attempt ${attempt + 1} (${failureTag(error)})`);
        if (attempt < backoff.length) await sleep(backoff[attempt]);
      }
    }
    log(`eos voice: binding lookup GAVE UP user=${hashId(userId)}; removing the minted PUIDs only`);
    return undefined;
  };
  /** True once Epic confirmed it (or it was already gone); false when given up. */
  const removeWithRetries = async (roomId: string, puid: string): Promise<boolean> => {
    for (let attempt = 0; attempt <= backoff.length; attempt += 1) {
      try {
        await deps.target.removeParticipant(roomId, puid);
        log(`eos voice: removed room=${hashId(roomId)} puid=${hashPuid(puid)}${attempt > 0 ? ` after ${attempt} retr${attempt === 1 ? 'y' : 'ies'}` : ''}`);
        return true;
      } catch (error) {
        const status = error instanceof EosHttpError ? error.status : 'network';
        log(`eos voice: removal failed room=${hashId(roomId)} puid=${hashPuid(puid)} attempt ${attempt + 1} (${status})`);
        if (attempt < backoff.length) await sleep(backoff[attempt]);
      }
    }
    log(`eos voice: removal GAVE UP room=${hashId(roomId)} puid=${hashPuid(puid)}`);
    return false;
  };
  const removeOne = async (d: PartyDeparture): Promise<void> => {
    const roomId = deps.target.roomIdFor(d.partyId);
    await deps.target.retryPending(roomId); // m-a: what this room still has pending goes first
    const bound = await boundPuidOf(d.userId);
    const minted = deps.target.mintedIn(roomId, d.userId);
    for (const puid of new Set([...minted.keys(), ...(bound === undefined ? [] : [bound])])) {
      if (await removeWithRetries(roomId, puid)) deps.target.forgetMinted(roomId, d.userId, puid, minted.get(puid));
      else deps.target.keepPending(roomId, d.userId, puid, minted.get(puid));
    }
  };
  return {
    onDepartures(departures) {
      // m-b: each departure joins its player's voice queue NOW, synchronously in the commit hook, so no join of that player
      // queued later can move the binding first; and it still runs after every departure queued before it
      const bindings = deps.bindings();
      for (const d of departures) {
        const after = chain;
        const job = (): Promise<void> => after.then(() => removeOne(d));
        chain = (bindings === null ? job() : oneVoiceJoinAtATime(bindings, d.userId, job)).catch(() => undefined);
      }
    },
    idle: () => chain,
  };
}

/** The bridge's EOS voice: the minter, its removal queue, and the deployment's ids (no client, no secret). */
export interface EosVoice {
  readonly minter: EosVoiceTokenMinter;
  readonly removals: VoiceRemovals;
  readonly deployment: EosDeployment;
}

/**
 * THE BRIDGE'S EOS, from its environment (server.ts), read once at start:
 *   - voice: the minter and its removal queue, or null (party voice 503);
 *   - gameConfig: the GAME client's config handed to signed-in players, or null (the client config route 503). It must name the
 *     voice config's deployment (loadEosGameClientConfig).
 * VOICE IS REFUSED WHEN ITS CLIENT IS THE GAME CLIENT (MAIN's internal review a6d5842c, M3): the pair every signed-in player is handed
 * must never be the pair that mints room tokens and removes participants. The .env form is checked within its own file
 * (loadEosVoiceConfig); here both forms, the JSON one included, are checked against the game config. The log names keys only.
 */
export function eosFromEnv(
  env: NodeJS.ProcessEnv,
  deps: EosVoiceDeps & { readonly bindings: () => VoiceBindingStore | null; readonly readFile?: (path: string) => string },
): { voice: EosVoice | null; gameConfig: EosGameClientConfig | null } {
  const log = deps.log ?? (() => undefined);
  const config = loadEosVoiceConfig(env, { readFile: deps.readFile, log });
  // the ids only (no client, no secret): the game config handed to clients must name the same deployment
  const deployment = config === null ? null : { productId: config.productId, sandboxId: config.sandboxId, deploymentId: config.deploymentId };
  const gameConfig = loadEosGameClientConfig(env, { readFile: deps.readFile, log, deployment });
  if (config === null || deployment === null) return { voice: null, gameConfig };
  if (gameConfig !== null && gameConfig.clientId === config.clientId) {
    log('eos voice: the voice client is the game client handed to every signed-in player (the voice config\'s EOS_SERVER_CLIENT_ID or JSON clientId equals EOS_GAME_CLIENT_ID) -- party voice answers 503');
    return { voice: null, gameConfig };
  }
  const minter = new EosVoiceTokenMinter(config, deps);
  return { voice: { minter, removals: createVoiceRemovals({ target: minter, bindings: deps.bindings, log: deps.log }), deployment }, gameConfig };
}
