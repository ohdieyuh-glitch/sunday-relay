import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { PartyDeparture } from '../src/relay/social/social-parties';
import type { VoiceBindingStore } from '../src/relay/social/voice-binding';
import type { PartyVoiceGrant, PartyVoiceTokenMinter } from './wonderland-social-routes';

/**
 * WONDERLAND PARTY VOICE ON EOS (R16, founder ruling 10-04: "USE EOS VOICE ... The backend may mint the required room/token
 * authorization"). The bridge side of CORE's FWonderlandEosVoice:
 *   - EosVoiceTokenMinter: a Trusted Server access token (client credentials), cached; createRoomToken for ONE bound PUID in the
 *     party's room; the participant token handed back as the JSON EOSVoiceChat expects.
 *   - createVoiceRemovals: after a committed party departure (leave, a leader's removal, a block's F1 separation), the departed
 *     PUID is removed from that party's room server-side -- Epic's removeParticipant also revokes their room token -- retried
 *     with backoff, never blocking or failing the social change.
 * NOTHING SECRET IS LOGGED: room ids and PUIDs appear only hashed (sha256, 12 hex); never a client secret, an access token, a
 * participant token or the media server address. The HTTP is behind an injectable fetch, so tests use a recorded fake; the real
 * API is exercised only by the R16 run.
 */

/* ============================================================================================================================
 * EPIC'S VOICE WEB API, AS THIS FILE SPEAKS IT -- verify against Epic's Voice Web API page at R16 run time
 * (https://dev.epicgames.com/docs/web-api-ref/voice-web-api; the EOS auth token endpoint). EVERY Epic URL, form field, header and
 * JSON field name this module uses is here, and nowhere else. As of 10-04 they come from Epic's indexed reference text
 * (SECOND_EOS_VOICE_BACKEND_NOTES.md); the live page renders client-side and was not read field by field.
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

/** sha256, first 12 hex: the only form in which an id reaches a log line. */
export const hashId = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);

/* ------------------------------------------------------------------------------------------------ config */

export const EOS_VOICE_CONFIG_ENV = 'WONDERLAND_EOS_VOICE_CONFIG';

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

/**
 * The founder's EOS file, named by WONDERLAND_EOS_VOICE_CONFIG (a path outside every repo). Missing variable, unreadable file,
 * bad JSON or any field out of shape: null -- party voice stays 503, with no fallback. The log line never carries the file's
 * content or its path.
 */
export function loadEosVoiceConfig(env: NodeJS.ProcessEnv, deps: { readFile?: (path: string) => string; log?: (line: string) => void } = {}): EosVoiceConfig | null {
  const log = deps.log ?? (() => undefined);
  const path = env[EOS_VOICE_CONFIG_ENV]?.trim() ?? '';
  if (path === '') {
    log(`eos voice: ${EOS_VOICE_CONFIG_ENV} is not set -- party voice answers 503`);
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse((deps.readFile ?? ((p) => readFileSync(p, 'utf8')))(path).replace(/^﻿/, ''));
  } catch {
    log('eos voice: the config file could not be read as JSON -- party voice answers 503');
    return null;
  }
  const r = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string).trim() : '');
  const config = { productId: str('productId'), sandboxId: str('sandboxId'), deploymentId: str('deploymentId'), clientId: str('clientId'), clientSecret: str('clientSecret'), roomSalt: str('roomSalt') };
  const valid = [config.productId, config.sandboxId, config.deploymentId, config.clientId].every((v) => ID.test(v))
    && config.clientSecret.length > 0 && config.clientSecret.length <= 512 && config.roomSalt.length >= 16 && config.roomSalt.length <= 512;
  if (!valid) {
    log('eos voice: the config file is missing a field or has one out of shape -- party voice answers 503');
    return null;
  }
  log(`eos voice: configured (deployment ${hashId(config.deploymentId)})`);
  return config;
}

/* ------------------------------------------------------------------------------------------------ the minter */

export type EosFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface EosVoiceDeps {
  readonly fetchImpl?: EosFetch;
  readonly log?: (line: string) => void;
  readonly now?: () => number;
}

class EosHttpError extends Error {
  constructor(readonly status: number, what: string) {
    super(`${what} answered ${status}`);
  }
}

const asRecord = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export class EosVoiceTokenMinter implements PartyVoiceTokenMinter {
  readonly providerId = 'eos';
  private token: { value: string; expiresAtMs: number } | null = null;
  private readonly fetchImpl: EosFetch;
  private readonly log: (line: string) => void;
  private readonly now: () => number;

  constructor(private readonly config: EosVoiceConfig, deps: EosVoiceDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as EosFetch);
    this.log = deps.log ?? (() => undefined);
    this.now = deps.now ?? Date.now;
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
    const answer = await this.authorised('POST', EPIC.roomPath(this.config.deploymentId, roomId), {
      [EPIC.roomBody.participants]: [{ [EPIC.roomBody.puid]: puid, [EPIC.roomBody.hardMuted]: false }],
    }, 'createRoomToken');
    const body = asRecord(await answer.json());
    const clientBaseUrl = typeof body[EPIC.roomAnswer.clientBaseUrl] === 'string' ? (body[EPIC.roomAnswer.clientBaseUrl] as string) : '';
    const participants = Array.isArray(body[EPIC.roomAnswer.participants]) ? (body[EPIC.roomAnswer.participants] as unknown[]).map(asRecord) : [];
    const mine = participants.find((p) => p[EPIC.roomAnswer.puid] === puid);
    const token = typeof mine?.[EPIC.roomAnswer.token] === 'string' ? (mine[EPIC.roomAnswer.token] as string) : '';
    if (clientBaseUrl === '' || token === '') throw new Error('createRoomToken answered without a media endpoint or a token for the caller');
    this.log(`eos voice: room token minted room=${hashId(roomId)} puid=${hashId(puid)}`);
    return {
      providerId: this.providerId,
      roomId,
      participantToken: JSON.stringify({ [EPIC.sdkToken.clientBaseUrl]: clientBaseUrl, [EPIC.sdkToken.participantToken]: token }),
      expiresAtIso: new Date(Date.parse(input.nowIso) + EPIC.roomTokenAssumedTtlMs).toISOString(),
    };
  }

  /** Remove a PUID from a room (and revoke its token). Already absent (404) counts as removed. */
  async removeParticipant(roomId: string, puid: string): Promise<void> {
    try {
      await this.authorised('DELETE', EPIC.participantPath(this.config.deploymentId, roomId, puid), undefined, 'removeParticipant');
    } catch (error) {
      if (error instanceof EosHttpError && error.status === 404) return;
      throw error;
    }
  }
}

/* ------------------------------------------------------------------------------------------------ server-side removal */

export interface VoiceRemovalTarget {
  roomIdFor(partyId: string): string;
  removeParticipant(roomId: string, puid: string): Promise<void>;
}

export interface VoiceRemovals {
  /** Called by the social store's after-commit hook: queues the removals and returns at once (never awaited by the change). */
  onDepartures(departures: readonly PartyDeparture[]): void;
  /** Resolves when everything queued so far has finished (tests; a graceful shutdown). */
  idle(): Promise<void>;
}

/**
 * SERVER-SIDE REMOVAL (review #3, #6): a departed member's PUID is taken out of that party's room even if their client misbehaves.
 * In departure order, one at a time; each removal tried up to 1 + backoff.length times (default 0.25 s, 1 s, 4 s), then given up
 * and logged. A departed member with no bound PUID has nothing to remove. Ids are logged hashed.
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
  const removeOne = async (d: PartyDeparture): Promise<void> => {
    const bindings = deps.bindings();
    const puid = bindings === null ? undefined : (await bindings.puidsOf([d.userId])).get(d.userId);
    const roomId = deps.target.roomIdFor(d.partyId);
    if (puid === undefined) return; // never joined voice: nothing to remove
    for (let attempt = 0; attempt <= backoff.length; attempt += 1) {
      try {
        await deps.target.removeParticipant(roomId, puid);
        log(`eos voice: removed room=${hashId(roomId)} puid=${hashId(puid)}${attempt > 0 ? ` after ${attempt} retr${attempt === 1 ? 'y' : 'ies'}` : ''}`);
        return;
      } catch (error) {
        const status = error instanceof EosHttpError ? error.status : 'network';
        log(`eos voice: removal failed room=${hashId(roomId)} puid=${hashId(puid)} attempt ${attempt + 1} (${status})`);
        if (attempt < backoff.length) await sleep(backoff[attempt]);
      }
    }
    log(`eos voice: removal GAVE UP room=${hashId(roomId)} puid=${hashId(puid)}`);
  };
  return {
    onDepartures(departures) {
      for (const d of departures) chain = chain.then(() => removeOne(d)).catch(() => undefined);
    },
    idle: () => chain,
  };
}

/** The bridge's EOS voice, from its environment: the minter and its removal queue, or null (voice 503). */
export function eosVoiceFromEnv(env: NodeJS.ProcessEnv, deps: EosVoiceDeps & { readonly bindings: () => VoiceBindingStore | null; readonly readFile?: (path: string) => string }): { minter: EosVoiceTokenMinter; removals: VoiceRemovals } | null {
  const config = loadEosVoiceConfig(env, { readFile: deps.readFile, log: deps.log });
  if (config === null) return null;
  const minter = new EosVoiceTokenMinter(config, deps);
  return { minter, removals: createVoiceRemovals({ target: minter, bindings: deps.bindings, log: deps.log }) };
}
