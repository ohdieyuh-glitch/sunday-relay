/**
 * WONDERLAND LOOKING FOR FEED (LFF) — proposed discovery board.
 *
 * PROPOSED, pending acceptance. The numbered criteria and the test that proves
 * each one live in docs/relay/WONDERLAND_LFF.md. This file is the pure domain:
 * no Node, no network, no clock. The caller injects `nowIso`.
 *
 * A listing is a public note that one player wants a team, builders, AI
 * engineers, designers, or competitors, plus a way to contact them. Closing a
 * listing withdraws it. A read at or after `expiresAt` expires it. Neither
 * outcome is a match, a private server, or a GVE session.
 *
 * The board is in memory on purpose. A restart drops it. Durable storage would
 * be a migration, and this change does not add one.
 */

export const LFF_SCHEMA_V1 = 'relay-wonderland-lff.v1' as const;

export const LFF_CATEGORIES = ['teams', 'builders', 'ai_engineers', 'designers', 'competitors'] as const;
export type LffCategory = (typeof LFF_CATEGORIES)[number];

export const LFF_CATEGORY_LABELS: Readonly<Record<LffCategory, string>> = Object.freeze({
  teams: 'Looking for Teams',
  builders: 'Looking for Builders',
  ai_engineers: 'Looking for AI Engineers',
  designers: 'Looking for Designers',
  competitors: 'Looking for Competitors',
});

export const LFF_CONTACT_METHODS = ['in_world_message', 'party_invite', 'profile'] as const;
export type LffContactMethod = (typeof LFF_CONTACT_METHODS)[number];

export const LFF_CONTACT_LABELS: Readonly<Record<LffContactMethod, string>> = Object.freeze({
  in_world_message: 'In-world message',
  party_invite: 'Party invite',
  profile: 'Profile',
});

export const LFF_LIMITS = Object.freeze({
  maxOpenListingsPerPlayer: 3,
  maxOpenListingsPerPlayerPerCategory: 1,
  titleMax: 80,
  bodyMax: 400,
  displayNameMax: 32,
  contactValueMax: 120,
  requestMessageMax: 200,
  maxOpenRequestsPerPlayer: 10,
  defaultLifetimeHours: 72,
  maxLifetimeHours: 168,
  minLifetimeHours: 1,
  maxTextUnits: 10_000,
  maxBodyKeys: 16,
});

export const LFF_ERROR_CODES = [
  'invalid_category',
  'invalid_text',
  'invalid_contact',
  'invalid_player',
  'invalid_lifetime',
  'invalid_time',
  'invalid_body',
  'invalid_id',
  'actor_mismatch',
  'out_of_scope',
  'listing_cap',
  'category_cap',
  'not_found',
  'not_author',
  'not_open',
  'not_involved',
  'request_cap',
  'request_exists',
  'cannot_request_own',
  'not_requester',
  'request_not_open',
] as const;
export type LffErrorCode = (typeof LFF_ERROR_CODES)[number];

export type LffResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: LffErrorCode; readonly message: string };

const PLAYER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const GENERATED_ID = /^[A-Za-z0-9_-]{1,80}$/;
const OUT_OF_SCOPE_KEYS = ['privateServer', 'privateServerId', 'gve', 'gveId', 'serverKind', 'serverId'] as const;
const ACTOR_KEYS = ['actorId', 'authorId', 'fromUserId', 'ownerId', 'posterId', 'requesterId'] as const;
const CREATE_KEYS = ['title', 'body', 'category', 'displayName', 'contactMethod', 'contactValue', 'lifetimeHours'] as const;
const EDIT_KEYS = ['title', 'body', 'category', 'displayName', 'contactMethod', 'contactValue', 'lifetimeHours'] as const;
const REQUEST_KEYS = ['message', 'displayName'] as const;

export type LffListingStatus = 'open' | 'withdrawn' | 'expired';
export type LffRequestStatus = 'open' | 'withdrawn' | 'accepted' | 'declined';

export interface LffListingView {
  readonly schemaVersion: typeof LFF_SCHEMA_V1;
  readonly listingId: string;
  readonly category: LffCategory;
  readonly categoryLabel: string;
  readonly title: string;
  readonly body: string;
  readonly authorId: string;
  readonly authorDisplayName: string;
  readonly contactMethod: LffContactMethod;
  readonly contactLabel: string;
  readonly contactValue: string;
  readonly status: LffListingStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

export interface LffFeed {
  readonly schemaVersion: typeof LFF_SCHEMA_V1;
  readonly category: LffCategory | null;
  readonly listings: readonly LffListingView[];
}

export interface LffRequestView {
  readonly schemaVersion: typeof LFF_SCHEMA_V1;
  readonly requestId: string;
  readonly listingId: string;
  readonly category: LffCategory;
  readonly categoryLabel: string;
  readonly listingTitle: string;
  readonly authorId: string;
  readonly requesterId: string;
  readonly requesterDisplayName: string;
  readonly message: string;
  readonly status: LffRequestStatus;
  readonly contactMethod: LffContactMethod;
  readonly contactLabel: string;
  readonly contactValue: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LffRequestList {
  readonly schemaVersion: typeof LFF_SCHEMA_V1;
  readonly requests: readonly LffRequestView[];
}

export interface LffDeleted {
  readonly schemaVersion: typeof LFF_SCHEMA_V1;
  readonly listingId: string;
  readonly deleted: true;
}

interface ListingRecord {
  listingId: string;
  category: LffCategory;
  title: string;
  body: string;
  authorId: string;
  authorDisplayName: string;
  contactMethod: LffContactMethod;
  contactValue: string;
  status: LffListingStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

interface RequestRecord {
  requestId: string;
  listingId: string;
  requesterId: string;
  requesterDisplayName: string;
  message: string;
  status: LffRequestStatus;
  createdAt: string;
  updatedAt: string;
}

const fail = (code: LffErrorCode, message: string): LffResult<never> => ({ ok: false, code, message });
const pass = <T>(value: T): LffResult<T> => ({ ok: true, value });

export function isLffCategory(value: unknown): value is LffCategory {
  return typeof value === 'string' && (LFF_CATEGORIES as readonly string[]).includes(value);
}

function hasControl(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code === undefined || code <= 0x1f || code === 0x7f || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

function readText(field: string, value: unknown, max: number): LffResult<string> {
  if (typeof value !== 'string') return fail('invalid_text', `${field} must be a string`);
  if (value.length > LFF_LIMITS.maxTextUnits) return fail('invalid_text', `${field} is too long`);
  if (hasControl(value)) return fail('invalid_text', `${field} must not contain a control character or a line break`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return fail('invalid_text', `${field} must not be blank`);
  if (trimmed.length > max) return fail('invalid_text', `${field} must be at most ${max} characters`);
  return pass(trimmed);
}

/** Parse an injected UTC timestamp. This does not read a clock. */
export function parseLffUtc(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(iso);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const ms = match[7] === undefined ? 0 : Number(match[7]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const stamp = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const date = new Date(stamp);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
    || date.getUTCSeconds() !== second
  ) return null;
  return stamp;
}

function formatUtc(ms: number): string {
  return new Date(ms).toISOString();
}

function readClock(nowIso: string): LffResult<number> {
  const now = parseLffUtc(nowIso);
  if (now === null) return fail('invalid_time', 'nowIso must be a UTC timestamp');
  return pass(now);
}

function readPlayer(actorId: string): LffResult<string> {
  if (!PLAYER_ID.test(actorId)) return fail('invalid_player', 'player id must be 1-64 letters, digits, "_" or "-"');
  return pass(actorId);
}

function readRecord(body: unknown): LffResult<Record<string, unknown>> {
  if (body === undefined || body === null) return pass({});
  if (typeof body !== 'object' || Array.isArray(body)) return fail('invalid_body', 'the body must be an object');
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length > LFF_LIMITS.maxBodyKeys) return fail('invalid_body', 'the body has too many fields');
  for (const key of OUT_OF_SCOPE_KEYS) {
    if (key in record) return fail('out_of_scope', `${key} is not part of Looking for Feed`);
  }
  return pass(record);
}

function actorAgrees(actorId: string, record: Record<string, unknown>): LffResult<true> {
  for (const key of ACTOR_KEYS) {
    if (record[key] !== undefined && record[key] !== actorId) return fail('actor_mismatch', `${key} must be the caller`);
  }
  return pass(true);
}

function onlyKeys(record: Record<string, unknown>, allowed: readonly string[]): LffResult<true> {
  const permitted = new Set<string>([...allowed, ...ACTOR_KEYS]);
  for (const key of Object.keys(record)) {
    if (!permitted.has(key)) return fail('invalid_body', `unexpected field ${key}`);
  }
  return pass(true);
}

function readLifetime(value: unknown, fallback: number): LffResult<number> {
  if (value === undefined) return pass(fallback);
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fail('invalid_lifetime', 'lifetimeHours must be a whole number of hours');
  }
  if (value < LFF_LIMITS.minLifetimeHours || value > LFF_LIMITS.maxLifetimeHours) {
    return fail('invalid_lifetime', `lifetimeHours must be from ${LFF_LIMITS.minLifetimeHours} to ${LFF_LIMITS.maxLifetimeHours}`);
  }
  return pass(value);
}

function readCategory(value: unknown): LffResult<LffCategory> {
  if (!isLffCategory(value)) return fail('invalid_category', 'category must be one of the five Looking for Feed categories');
  return pass(value);
}

function readContact(value: unknown): LffResult<LffContactMethod> {
  if (typeof value !== 'string' || !(LFF_CONTACT_METHODS as readonly string[]).includes(value)) {
    return fail('invalid_contact', 'contactMethod must be in_world_message, party_invite, or profile');
  }
  return pass(value as LffContactMethod);
}

function listingView(row: ListingRecord): LffListingView {
  return {
    schemaVersion: LFF_SCHEMA_V1,
    listingId: row.listingId,
    category: row.category,
    categoryLabel: LFF_CATEGORY_LABELS[row.category],
    title: row.title,
    body: row.body,
    authorId: row.authorId,
    authorDisplayName: row.authorDisplayName,
    contactMethod: row.contactMethod,
    contactLabel: LFF_CONTACT_LABELS[row.contactMethod],
    contactValue: row.contactValue,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * One in-memory feed shared by every caller of this instance. Two players see
 * the same listings because they call the same board, not because a copy is pushed.
 */
export class WonderlandLffBoard {
  private readonly listings = new Map<string, ListingRecord>();
  private readonly requests = new Map<string, RequestRecord>();

  constructor(private readonly newId: () => string) {}

  create(actorId: string, body: unknown, nowIso: string): LffResult<LffListingView> {
    const ready = this.prepare(actorId, body, nowIso, CREATE_KEYS);
    if (!ready.ok) return ready;
    const category = readCategory(ready.value.record.category);
    if (!category.ok) return category;
    const title = readText('title', ready.value.record.title, LFF_LIMITS.titleMax);
    if (!title.ok) return title;
    const text = readText('body', ready.value.record.body, LFF_LIMITS.bodyMax);
    if (!text.ok) return text;
    const displayName = readText('displayName', ready.value.record.displayName, LFF_LIMITS.displayNameMax);
    if (!displayName.ok) return displayName;
    const contact = this.readContactPair(actorId, ready.value.record.contactMethod, ready.value.record.contactValue);
    if (!contact.ok) return contact;
    const lifetime = readLifetime(ready.value.record.lifetimeHours, LFF_LIMITS.defaultLifetimeHours);
    if (!lifetime.ok) return lifetime;
    if (this.openListings(actorId).length >= LFF_LIMITS.maxOpenListingsPerPlayer) {
      return fail('listing_cap', `a player may have ${LFF_LIMITS.maxOpenListingsPerPlayer} open listings`);
    }
    if (this.openListings(actorId, category.value).length >= LFF_LIMITS.maxOpenListingsPerPlayerPerCategory) {
      return fail('category_cap', 'a player may have one open listing in a category');
    }
    const listingId = this.allocateId();
    if (!listingId.ok) return listingId;
    const row: ListingRecord = {
      listingId: listingId.value,
      category: category.value,
      title: title.value,
      body: text.value,
      authorId: actorId,
      authorDisplayName: displayName.value,
      contactMethod: contact.value.method,
      contactValue: contact.value.value,
      status: 'open',
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: formatUtc(ready.value.nowMs + lifetime.value * 60 * 60 * 1000),
    };
    this.listings.set(row.listingId, row);
    return pass(listingView(row));
  }

  list(actorId: string, category: unknown, nowIso: string): LffResult<LffFeed> {
    const player = readPlayer(actorId);
    if (!player.ok) return player;
    const clock = readClock(nowIso);
    if (!clock.ok) return clock;
    let selected: LffCategory | null = null;
    if (category !== undefined && category !== null) {
      const parsed = readCategory(category);
      if (!parsed.ok) return parsed;
      selected = parsed.value;
    }
    this.settle(clock.value, nowIso);
    const listings = [...this.listings.values()]
      .filter((row) => row.status === 'open' && (selected === null || row.category === selected))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.listingId.localeCompare(b.listingId))
      .map(listingView);
    return pass({ schemaVersion: LFF_SCHEMA_V1, category: selected, listings });
  }

  get(actorId: string, listingId: string, nowIso: string): LffResult<LffListingView> {
    const player = readPlayer(actorId);
    if (!player.ok) return player;
    const clock = readClock(nowIso);
    if (!clock.ok) return clock;
    this.settle(clock.value, nowIso);
    const row = this.listings.get(listingId);
    if (!row || (row.status !== 'open' && row.authorId !== actorId)) return fail('not_found', 'listing not found');
    return pass(listingView(row));
  }

  edit(actorId: string, listingId: string, body: unknown, nowIso: string): LffResult<LffListingView> {
    const ready = this.prepare(actorId, body, nowIso, EDIT_KEYS);
    if (!ready.ok) return ready;
    const open = this.requireAuthorOpen(actorId, listingId, ready.value.nowMs, nowIso);
    if (!open.ok) return open;
    const record = ready.value.record;
    const contentKeys = EDIT_KEYS.filter((key) => record[key] !== undefined);
    if (contentKeys.length === 0) return fail('invalid_body', 'no fields to update');
    const title = record.title === undefined ? null : readText('title', record.title, LFF_LIMITS.titleMax);
    if (title !== null && !title.ok) return title;
    const text = record.body === undefined ? null : readText('body', record.body, LFF_LIMITS.bodyMax);
    if (text !== null && !text.ok) return text;
    const displayName = record.displayName === undefined ? null : readText('displayName', record.displayName, LFF_LIMITS.displayNameMax);
    if (displayName !== null && !displayName.ok) return displayName;
    const category = record.category === undefined ? null : readCategory(record.category);
    if (category !== null && !category.ok) return category;
    const lifetime = record.lifetimeHours === undefined ? null : readLifetime(record.lifetimeHours, LFF_LIMITS.defaultLifetimeHours);
    if (lifetime !== null && !lifetime.ok) return lifetime;
    let contact: { method: LffContactMethod; value: string } | null = null;
    if (record.contactMethod !== undefined || record.contactValue !== undefined) {
      if (record.contactMethod === undefined || record.contactValue === undefined) {
        return fail('invalid_contact', 'contactMethod and contactValue are updated together');
      }
      const parsed = this.readContactPair(actorId, record.contactMethod, record.contactValue);
      if (!parsed.ok) return parsed;
      contact = parsed.value;
    }
    const row = open.value;
    if (category !== null && category.ok && category.value !== row.category
      && this.openListings(actorId, category.value).length >= LFF_LIMITS.maxOpenListingsPerPlayerPerCategory) {
      return fail('category_cap', 'a player may have one open listing in a category');
    }
    if (title !== null && title.ok) row.title = title.value;
    if (text !== null && text.ok) row.body = text.value;
    if (displayName !== null && displayName.ok) row.authorDisplayName = displayName.value;
    if (category !== null && category.ok) row.category = category.value;
    if (contact !== null) {
      row.contactMethod = contact.method;
      row.contactValue = contact.value;
    }
    if (lifetime !== null && lifetime.ok) row.expiresAt = formatUtc(ready.value.nowMs + lifetime.value * 60 * 60 * 1000);
    row.updatedAt = nowIso;
    return pass(listingView(row));
  }

  /** Author withdraw. The route that calls this is POST /lff/posts/:id/close. */
  close(actorId: string, listingId: string, body: unknown, nowIso: string): LffResult<LffListingView> {
    const ready = this.prepare(actorId, body, nowIso, []);
    if (!ready.ok) return ready;
    const open = this.requireAuthorOpen(actorId, listingId, ready.value.nowMs, nowIso);
    if (!open.ok) return open;
    open.value.status = 'withdrawn';
    open.value.updatedAt = nowIso;
    return pass(listingView(open.value));
  }

  delete(actorId: string, listingId: string, body: unknown, nowIso: string): LffResult<LffDeleted> {
    const ready = this.prepare(actorId, body, nowIso, []);
    if (!ready.ok) return ready;
    this.settle(ready.value.nowMs, nowIso);
    const row = this.listings.get(listingId);
    if (!row || (row.authorId !== actorId && row.status !== 'open')) return fail('not_found', 'listing not found');
    if (row.authorId !== actorId) return fail('not_author', 'only the player who posted can change this listing');
    this.listings.delete(listingId);
    for (const [requestId, request] of this.requests) {
      if (request.listingId === listingId) this.requests.delete(requestId);
    }
    return pass({ schemaVersion: LFF_SCHEMA_V1, listingId, deleted: true });
  }

  createRequest(actorId: string, listingId: string, body: unknown, nowIso: string): LffResult<LffRequestView> {
    const ready = this.prepare(actorId, body, nowIso, REQUEST_KEYS);
    if (!ready.ok) return ready;
    const open = this.requireOpen(listingId, ready.value.nowMs, nowIso);
    if (!open.ok) return open;
    if (open.value.authorId === actorId) return fail('cannot_request_own', 'the author connects through the listing contact');
    const message = readText('message', ready.value.record.message, LFF_LIMITS.requestMessageMax);
    if (!message.ok) return message;
    const displayName = readText('displayName', ready.value.record.displayName, LFF_LIMITS.displayNameMax);
    if (!displayName.ok) return displayName;
    if (this.openRequestFrom(listingId, actorId)) return fail('request_exists', 'this player already has an open request on the listing');
    if (this.openRequestCount(actorId) >= LFF_LIMITS.maxOpenRequestsPerPlayer) {
      return fail('request_cap', `a player may have ${LFF_LIMITS.maxOpenRequestsPerPlayer} open requests`);
    }
    const requestId = this.allocateId();
    if (!requestId.ok) return requestId;
    const request: RequestRecord = {
      requestId: requestId.value,
      listingId,
      requesterId: actorId,
      requesterDisplayName: displayName.value,
      message: message.value,
      status: 'open',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.requests.set(request.requestId, request);
    return pass(this.requestView(request, open.value));
  }

  listPostRequests(actorId: string, listingId: string, nowIso: string): LffResult<LffRequestList> {
    const player = readPlayer(actorId);
    if (!player.ok) return player;
    const clock = readClock(nowIso);
    if (!clock.ok) return clock;
    this.settle(clock.value, nowIso);
    const row = this.listings.get(listingId);
    if (!row) return fail('not_found', 'listing not found');
    const own = this.requestsFor(listingId).filter((request) => row.authorId === actorId || request.requesterId === actorId);
    if (row.authorId !== actorId && own.length === 0) {
      if (row.status !== 'open') return fail('not_found', 'listing not found');
      return fail('not_involved', 'requests are visible to the author and the requester');
    }
    return pass({ schemaVersion: LFF_SCHEMA_V1, requests: own.map((request) => this.requestView(request, row)) });
  }

  listRequests(actorId: string, nowIso: string): LffResult<LffRequestList> {
    const player = readPlayer(actorId);
    if (!player.ok) return player;
    const clock = readClock(nowIso);
    if (!clock.ok) return clock;
    this.settle(clock.value, nowIso);
    const requests = [...this.requests.values()]
      .filter((request) => {
        const row = this.listings.get(request.listingId);
        return row !== undefined && (row.authorId === actorId || request.requesterId === actorId);
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.requestId.localeCompare(b.requestId))
      .map((request) => this.requestView(request, this.listings.get(request.listingId)!));
    return pass({ schemaVersion: LFF_SCHEMA_V1, requests });
  }

  withdrawRequest(actorId: string, requestId: string, body: unknown, nowIso: string): LffResult<LffRequestView> {
    return this.decideRequest(actorId, requestId, body, nowIso, 'requester', 'withdrawn', false);
  }

  acceptRequest(actorId: string, requestId: string, body: unknown, nowIso: string): LffResult<LffRequestView> {
    return this.decideRequest(actorId, requestId, body, nowIso, 'author', 'accepted', true);
  }

  declineRequest(actorId: string, requestId: string, body: unknown, nowIso: string): LffResult<LffRequestView> {
    return this.decideRequest(actorId, requestId, body, nowIso, 'author', 'declined', false);
  }

  private prepare(
    actorId: string,
    body: unknown,
    nowIso: string,
    keys: readonly string[],
  ): LffResult<{ nowMs: number; record: Record<string, unknown> }> {
    const player = readPlayer(actorId);
    if (!player.ok) return player;
    const clock = readClock(nowIso);
    if (!clock.ok) return clock;
    const record = readRecord(body);
    if (!record.ok) return record;
    const actor = actorAgrees(actorId, record.value);
    if (!actor.ok) return actor;
    const fields = onlyKeys(record.value, keys);
    if (!fields.ok) return fields;
    this.settle(clock.value, nowIso);
    return pass({ nowMs: clock.value, record: record.value });
  }

  private readContactPair(actorId: string, method: unknown, value: unknown): LffResult<{ method: LffContactMethod; value: string }> {
    const contact = readContact(method);
    if (!contact.ok) return contact;
    const text = readText('contactValue', value, LFF_LIMITS.contactValueMax);
    if (!text.ok) return text;
    if (contact.value === 'profile' && text.value !== actorId) {
      return fail('invalid_contact', 'a profile contact must be the caller');
    }
    return pass({ method: contact.value, value: text.value });
  }

  private allocateId(): LffResult<string> {
    const id = this.newId();
    if (!GENERATED_ID.test(id) || this.listings.has(id) || this.requests.has(id)) {
      return fail('invalid_id', 'the id generator returned an id this board cannot store');
    }
    return pass(id);
  }

  private settle(nowMs: number, nowIso: string): void {
    for (const row of this.listings.values()) {
      const expires = parseLffUtc(row.expiresAt);
      if (row.status === 'open' && (expires === null || expires <= nowMs)) {
        row.status = 'expired';
        row.updatedAt = nowIso;
      }
    }
  }

  private openListings(actorId: string, category?: LffCategory): ListingRecord[] {
    return [...this.listings.values()].filter((row) =>
      row.status === 'open' && row.authorId === actorId && (category === undefined || row.category === category));
  }

  private requireOpen(listingId: string, nowMs: number, nowIso: string): LffResult<ListingRecord> {
    this.settle(nowMs, nowIso);
    const row = this.listings.get(listingId);
    if (!row) return fail('not_found', 'listing not found');
    if (row.status !== 'open') return fail('not_open', 'the listing is not open');
    return pass(row);
  }

  private requireAuthorOpen(actorId: string, listingId: string, nowMs: number, nowIso: string): LffResult<ListingRecord> {
    this.settle(nowMs, nowIso);
    const row = this.listings.get(listingId);
    if (!row || (row.authorId !== actorId && row.status !== 'open')) return fail('not_found', 'listing not found');
    if (row.authorId !== actorId) return fail('not_author', 'only the player who posted can change this listing');
    if (row.status !== 'open') return fail('not_open', 'the listing is not open');
    return pass(row);
  }

  private openRequestFrom(listingId: string, requesterId: string): boolean {
    for (const request of this.requests.values()) {
      if (request.listingId === listingId && request.requesterId === requesterId && request.status === 'open') return true;
    }
    return false;
  }

  private openRequestCount(requesterId: string): number {
    let count = 0;
    for (const request of this.requests.values()) {
      if (request.requesterId === requesterId && request.status === 'open') count += 1;
    }
    return count;
  }

  private requestsFor(listingId: string): RequestRecord[] {
    return [...this.requests.values()]
      .filter((request) => request.listingId === listingId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.requestId.localeCompare(b.requestId));
  }

  private requestView(request: RequestRecord, row: ListingRecord): LffRequestView {
    return {
      schemaVersion: LFF_SCHEMA_V1,
      requestId: request.requestId,
      listingId: request.listingId,
      category: row.category,
      categoryLabel: LFF_CATEGORY_LABELS[row.category],
      listingTitle: row.title,
      authorId: row.authorId,
      requesterId: request.requesterId,
      requesterDisplayName: request.requesterDisplayName,
      message: request.message,
      status: request.status,
      contactMethod: row.contactMethod,
      contactLabel: LFF_CONTACT_LABELS[row.contactMethod],
      contactValue: row.contactValue,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  private decideRequest(
    actorId: string,
    requestId: string,
    body: unknown,
    nowIso: string,
    who: 'author' | 'requester',
    next: LffRequestStatus,
    listingMustBeOpen: boolean,
  ): LffResult<LffRequestView> {
    const ready = this.prepare(actorId, body, nowIso, []);
    if (!ready.ok) return ready;
    const request = this.requests.get(requestId);
    if (!request) return fail('not_found', 'request not found');
    const row = this.listings.get(request.listingId);
    if (!row) return fail('not_found', 'listing not found');
    const involved = row.authorId === actorId || request.requesterId === actorId;
    if (!involved) return fail('not_found', 'request not found');
    if (who === 'author' && row.authorId !== actorId) return fail('not_author', 'only the author can answer a request');
    if (who === 'requester' && request.requesterId !== actorId) return fail('not_requester', 'only the requester can withdraw a request');
    if (request.status !== 'open') return fail('request_not_open', 'the request is not open');
    if (listingMustBeOpen && row.status !== 'open') return fail('not_open', 'the listing is not open');
    request.status = next;
    request.updatedAt = nowIso;
    return pass(this.requestView(request, row));
  }
}
