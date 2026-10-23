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
 * The board talks to an {@link LffBoardStore}. The default store is memory.
 * A file store in `src/relay/persistence/wonderland-lff-file-store.ts` keeps
 * the same snapshot across a process restart. There is no SQL migration.
 */

export const LFF_SCHEMA_V1 = 'relay-wonderland-lff.v1' as const;

export const LFF_CATEGORIES = ['teams', 'builders', 'ai_engineers', 'designers', 'competitors'] as const;
export type LffCategory = (typeof LFF_CATEGORIES)[number];

/**
 * The desktop client at f1fbb264 sends these tokens (social-lff.ts LFF_CATEGORIES).
 * The first five are the v1 categories under different spelling. COLLABORATORS is the sixth.
 */
export const LFF_DESKTOP_CATEGORY_TOKENS = ['TEAMS', 'BUILDERS', 'AI_ENGINEERS', 'DESIGNERS', 'COMPETITORS', 'COLLABORATORS'] as const;
export type LffDesktopCategoryToken = (typeof LFF_DESKTOP_CATEGORY_TOKENS)[number];
export type LffStoredCategory = LffCategory | 'collaborators';

export const LFF_DESKTOP_CATEGORY_BY_TOKEN: Readonly<Record<LffDesktopCategoryToken, LffStoredCategory>> = Object.freeze({
  TEAMS: 'teams',
  BUILDERS: 'builders',
  AI_ENGINEERS: 'ai_engineers',
  DESIGNERS: 'designers',
  COMPETITORS: 'competitors',
  COLLABORATORS: 'collaborators',
});

/** Labels the f1fbb264 view shows (WonderlandLffCategoryLabel). */
export const LFF_DESKTOP_CATEGORY_LABELS: Readonly<Record<LffStoredCategory, string>> = Object.freeze({
  teams: 'Teams',
  builders: 'Builders',
  ai_engineers: 'AI engineers',
  designers: 'Designers',
  competitors: 'Competitors',
  collaborators: 'Collaborators',
});

const DESKTOP_TOKEN_OF: Readonly<Record<LffStoredCategory, LffDesktopCategoryToken>> = Object.freeze({
  teams: 'TEAMS',
  builders: 'BUILDERS',
  ai_engineers: 'AI_ENGINEERS',
  designers: 'DESIGNERS',
  competitors: 'COMPETITORS',
  collaborators: 'COLLABORATORS',
});

export interface LffDesktopPerson {
  readonly userId: string;
  readonly displayName: string;
  readonly handle: string;
  readonly avatarRef: string;
  readonly presence: {
    readonly userId: string;
    readonly onlineState: string;
    readonly availability: string;
    readonly headline: string;
    readonly partyId: string;
    readonly lastSeenAtIso: string;
    readonly restrictedReason: string;
  };
}

export interface LffDesktopPost {
  readonly postId: string;
  readonly category: LffDesktopCategoryToken;
  readonly categoryLabel: string;
  readonly title: string;
  readonly description: string;
  readonly projectLabel: string;
  readonly skills: readonly string[];
  readonly openSlots: number;
  readonly availableSlots: number | null;
  readonly status: 'OPEN' | 'CLOSED' | 'EXPIRED';
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  readonly expiresAtIso: string;
  readonly version: number;
  readonly author: LffDesktopPerson;
  readonly viewerIsOwner: boolean;
  readonly viewerRequest: { readonly requestId: string; readonly status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'NO_LONGER_AVAILABLE' } | null;
}

export interface LffDesktopPostDetail extends LffDesktopPost {
  readonly authorProfile: null;
  readonly accepted: readonly LffDesktopPerson[] | null;
}

export interface LffDesktopFeedQuery {
  readonly category?: string;
  readonly projectLabel?: string;
  readonly skill?: string;
  readonly mine?: boolean;
  readonly hasOpenSlots?: boolean;
  readonly cursor?: string;
  readonly limit?: string;
}

export interface LffDesktopFeedPage {
  readonly posts: readonly LffDesktopPost[];
  readonly nextCursor: string | null;
}

export interface LffDesktopMyRequests {
  readonly requests: readonly {
    readonly requestId: string;
    readonly postId: string;
    readonly status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'NO_LONGER_AVAILABLE';
    readonly message: string;
    readonly createdAtIso: string;
    readonly updatedAtIso: string;
    readonly post: LffDesktopPost | null;
  }[];
  readonly truncated: boolean;
}

export interface LffDesktopInbox {
  readonly postId: string;
  readonly requests: readonly {
    readonly requestId: string;
    readonly status: 'PENDING' | 'ACCEPTED';
    readonly message: string;
    readonly createdAtIso: string;
    readonly updatedAtIso: string;
    readonly requester: LffDesktopPerson;
  }[];
}

function desktopPerson(userId: string, displayName: string): LffDesktopPerson {
  const headline = displayName.length > 0 ? displayName : 'Offline';
  return {
    userId,
    displayName,
    handle: '',
    avatarRef: '',
    presence: {
      userId,
      onlineState: 'OFFLINE',
      availability: '',
      headline,
      partyId: '',
      lastSeenAtIso: '',
      restrictedReason: '',
    },
  };
}

function desktopRequesterStatus(
  request: { status: LffRequestStatus },
  row: { status: LffListingStatus },
): 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'NO_LONGER_AVAILABLE' | null {
  if (request.status === 'withdrawn') return null;
  if (request.status === 'accepted') return 'ACCEPTED';
  if (request.status === 'declined') return 'DECLINED';
  return row.status === 'open' ? 'PENDING' : 'NO_LONGER_AVAILABLE';
}

function newestFirst(a: ListingRecord, b: ListingRecord): number {
  const byTime = b.createdAt.localeCompare(a.createdAt);
  if (byTime !== 0) return byTime;
  return b.serial - a.serial;
}

function desktopCursorOf(row: ListingRecord): string {
  return `${parseLffUtc(row.createdAt) ?? 0}.${row.serial}`;
}

function isOlderThanCursor(row: ListingRecord, cursor: { ms: number; serial: number }): boolean {
  const ms = parseLffUtc(row.createdAt) ?? 0;
  if (ms < cursor.ms) return true;
  if (ms > cursor.ms) return false;
  return row.serial < cursor.serial;
}

function parseDesktopCursor(value: string | undefined): LffResult<{ ms: number; serial: number } | null> {
  if (value === undefined || value === '') return pass(null);
  const match = /^(\d{1,15})\.(\d{1,15})$/.exec(value);
  if (match === null) return fail('invalid_body', 'cursor must be the feed position the server returned');
  return pass({ ms: Number(match[1]), serial: Number(match[2]) });
}

function parseDesktopLimit(value: string | undefined): LffResult<number> {
  if (value === undefined || value === '') return pass(20);
  if (!/^\d{1,2}$/.test(value)) return fail('invalid_body', 'limit must be a whole number from 1 to 50');
  const limit = Number(value);
  if (limit < 1 || limit > 50) return fail('invalid_body', 'limit must be a whole number from 1 to 50');
  return pass(limit);
}

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
  'store_corrupt',
  'store_unavailable',
] as const;
export type LffErrorCode = (typeof LFF_ERROR_CODES)[number];

export type LffResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: LffErrorCode; readonly message: string };

const PLAYER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const GENERATED_ID = /^[A-Za-z0-9_-]{1,80}$/;
const OUT_OF_SCOPE_KEYS = ['privateServer', 'privateServerId', 'gve', 'gveId', 'serverKind', 'serverId'] as const;
const ACTOR_KEYS = ['actorId', 'authorId', 'fromUserId', 'ownerId', 'posterId', 'requesterId'] as const;
const CREATE_KEYS = ['title', 'body', 'category', 'displayName', 'contactMethod', 'contactValue', 'lifetimeHours', 'description', 'projectLabel', 'skills', 'openSlots'] as const;
const EDIT_KEYS = ['title', 'body', 'category', 'displayName', 'contactMethod', 'contactValue', 'lifetimeHours', 'description', 'projectLabel', 'skills', 'openSlots'] as const;
const REQUEST_KEYS = ['message', 'displayName'] as const;

export type LffListingStatus = 'open' | 'withdrawn' | 'expired';
export type LffRequestStatus = 'open' | 'withdrawn' | 'accepted' | 'declined';

export interface LffListingView {
  readonly schemaVersion: typeof LFF_SCHEMA_V1;
  readonly listingId: string;
  readonly category: LffStoredCategory;
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
  readonly category: LffStoredCategory | null;
  readonly listings: readonly LffListingView[];
}

export interface LffRequestView {
  readonly schemaVersion: typeof LFF_SCHEMA_V1;
  readonly requestId: string;
  readonly listingId: string;
  readonly category: LffStoredCategory;
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

export interface LffStoredListing {
  readonly listingId: string;
  readonly category: LffStoredCategory;
  readonly title: string;
  readonly body: string;
  readonly description: string;
  readonly projectLabel: string;
  readonly skills: readonly string[];
  readonly openSlots: number;
  readonly serial: number;
  readonly version: number;
  readonly authorId: string;
  readonly authorDisplayName: string;
  readonly contactMethod: LffContactMethod;
  readonly contactValue: string;
  readonly status: LffListingStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

export interface LffStoredRequest {
  readonly requestId: string;
  readonly listingId: string;
  readonly requesterId: string;
  readonly requesterDisplayName: string;
  readonly message: string;
  readonly status: LffRequestStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LffBoardSnapshot {
  readonly schemaVersion: typeof LFF_SCHEMA_V1;
  readonly listings: readonly LffStoredListing[];
  readonly requests: readonly LffStoredRequest[];
}

export type LffStoreLoad =
  | { readonly status: 'empty' }
  | { readonly status: 'ok'; readonly snapshot: LffBoardSnapshot }
  | { readonly status: 'corrupt'; readonly reason: string };

/** What the board reads and writes. Memory is the default. A file store is the durable one. */
export interface LffBoardStore {
  load(): LffStoreLoad;
  save(snapshot: LffBoardSnapshot): void;
}

export class MemoryLffBoardStore implements LffBoardStore {
  private snapshot: LffBoardSnapshot | null = null;

  load(): LffStoreLoad {
    if (this.snapshot === null) return { status: 'empty' };
    return { status: 'ok', snapshot: structuredClone(this.snapshot) };
  }

  save(snapshot: LffBoardSnapshot): void {
    this.snapshot = structuredClone(snapshot);
  }
}

function isListingStatus(value: unknown): value is LffListingStatus {
  return value === 'open' || value === 'withdrawn' || value === 'expired';
}

function isRequestStatus(value: unknown): value is LffRequestStatus {
  return value === 'open' || value === 'withdrawn' || value === 'accepted' || value === 'declined';
}

function isContactMethod(value: unknown): value is LffContactMethod {
  return typeof value === 'string' && (LFF_CONTACT_METHODS as readonly string[]).includes(value);
}

function storedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || hasControl(value) || value.trim() !== value) return null;
  return value;
}

function storedTime(value: unknown): string | null {
  if (typeof value !== 'string' || parseLffUtc(value) === null) return null;
  return value;
}

function storedCategory(value: unknown): LffStoredCategory | null {
  if (value === 'collaborators') return 'collaborators';
  return isLffCategory(value) ? value : null;
}

function storedPlain(value: unknown, max: number, fallback: string | undefined): string | null {
  if (value === undefined) return fallback === undefined ? null : fallback;
  if (typeof value !== 'string' || value.length > max || hasControl(value) || value.trim() !== value) return null;
  return value;
}

function storedSkills(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) return null;
  const skills: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 32 || hasControl(item) || item.trim() !== item) return null;
    skills.push(item);
  }
  return skills;
}

function storedWhole(value: unknown, fallback: number, max: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) return null;
  return value;
}

function parseStoredListing(value: unknown): LffStoredListing | null {
  if (value === null || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const category = storedCategory(row.category);
  if (category === null || !isContactMethod(row.contactMethod) || !isListingStatus(row.status)) return null;
  const listingId = storedText(row.listingId, 80);
  const title = storedText(row.title, LFF_LIMITS.titleMax);
  const body = storedText(row.body, LFF_LIMITS.bodyMax);
  const authorId = typeof row.authorId === 'string' && PLAYER_ID.test(row.authorId) ? row.authorId : null;
  const authorDisplayName = storedText(row.authorDisplayName, LFF_LIMITS.displayNameMax);
  const contactValue = storedText(row.contactValue, LFF_LIMITS.contactValueMax);
  const createdAt = storedTime(row.createdAt);
  const updatedAt = storedTime(row.updatedAt);
  const expiresAt = storedTime(row.expiresAt);
  const description = storedPlain(row.description, 1000, body ?? undefined);
  const projectLabel = storedPlain(row.projectLabel, 80, '');
  const skills = storedSkills(row.skills);
  const openSlots = storedWhole(row.openSlots, 1, 20);
  const serial = storedWhole(row.serial, 0, 1_000_000_000);
  const version = storedWhole(row.version, 1, 1_000_000_000);
  if (listingId === null || title === null || body === null || authorId === null || authorDisplayName === null
    || contactValue === null || createdAt === null || updatedAt === null || expiresAt === null
    || description === null || projectLabel === null || skills === null || openSlots === null
    || openSlots < 1 || serial === null || version === null || version < 1) return null;
  if (row.contactMethod === 'profile' && contactValue !== authorId) return null;
  return {
    listingId, category, title, body, description, projectLabel, skills, openSlots, serial, version,
    authorId, authorDisplayName, contactMethod: row.contactMethod, contactValue, status: row.status,
    createdAt, updatedAt, expiresAt,
  };
}

function parseStoredRequest(value: unknown): LffStoredRequest | null {
  if (value === null || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (!isRequestStatus(row.status)) return null;
  const requestId = storedText(row.requestId, 80);
  const listingId = storedText(row.listingId, 80);
  const requesterId = typeof row.requesterId === 'string' && PLAYER_ID.test(row.requesterId) ? row.requesterId : null;
  const requesterDisplayName = storedText(row.requesterDisplayName, LFF_LIMITS.displayNameMax);
  const message = storedPlain(row.message, LFF_LIMITS.requestMessageMax, undefined);
  const createdAt = storedTime(row.createdAt);
  const updatedAt = storedTime(row.updatedAt);
  if (requestId === null || listingId === null || requesterId === null || requesterDisplayName === null
    || message === null || createdAt === null || updatedAt === null) return null;
  return { requestId, listingId, requesterId, requesterDisplayName, message, status: row.status, createdAt, updatedAt };
}

/** A snapshot the board can load. Anything doubtful is rejected whole, not treated as empty. */
export function parseLffBoardSnapshot(value: unknown): LffBoardSnapshot | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== LFF_SCHEMA_V1 || !Array.isArray(record.listings) || !Array.isArray(record.requests)) return null;
  const listings: LffStoredListing[] = [];
  const requests: LffStoredRequest[] = [];
  const listingIds = new Set<string>();
  const requestIds = new Set<string>();
  for (const item of record.listings) {
    const listing = parseStoredListing(item);
    if (listing === null || listingIds.has(listing.listingId)) return null;
    listingIds.add(listing.listingId);
    listings.push(listing);
  }
  for (const item of record.requests) {
    const request = parseStoredRequest(item);
    if (request === null || requestIds.has(request.requestId) || !listingIds.has(request.listingId)) return null;
    requestIds.add(request.requestId);
    requests.push(request);
  }
  return { schemaVersion: LFF_SCHEMA_V1, listings, requests };
}

interface ListingRecord {
  listingId: string;
  category: LffStoredCategory;
  title: string;
  body: string;
  description: string;
  projectLabel: string;
  skills: string[];
  openSlots: number;
  serial: number;
  version: number;
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

function readCategory(value: unknown): LffResult<LffStoredCategory> {
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(LFF_DESKTOP_CATEGORY_BY_TOKEN, value)) {
    return pass(LFF_DESKTOP_CATEGORY_BY_TOKEN[value as LffDesktopCategoryToken]);
  }
  if (value === 'collaborators') return pass('collaborators');
  if (!isLffCategory(value)) return fail('invalid_category', 'category must be one of the Looking for Feed categories');
  return pass(value);
}

function categoryLabel(category: LffStoredCategory): string {
  if (category === 'collaborators') return 'Looking for Collaborators';
  return LFF_CATEGORY_LABELS[category];
}

function readOptionalText(field: string, value: unknown, max: number): LffResult<string> {
  if (typeof value !== 'string') return fail('invalid_text', `${field} must be a string`);
  if (value.length > LFF_LIMITS.maxTextUnits) return fail('invalid_text', `${field} is too long`);
  if (hasControl(value)) return fail('invalid_text', `${field} must not contain a control character or a line break`);
  const trimmed = value.trim();
  if (trimmed.length > max) return fail('invalid_text', `${field} must be at most ${max} characters`);
  return pass(trimmed);
}

function readDesktopFields(
  record: Record<string, unknown>,
  prior?: { description: string; projectLabel: string; skills: readonly string[]; openSlots: number },
): LffResult<{ description: string; projectLabel: string; skills: string[]; openSlots: number }> {
  const description = record.description === undefined
    ? pass(prior?.description ?? '')
    : readOptionalText('description', record.description, 1000);
  if (!description.ok) return description;
  const projectLabel = record.projectLabel === undefined
    ? pass(prior?.projectLabel ?? '')
    : readOptionalText('projectLabel', record.projectLabel, 80);
  if (!projectLabel.ok) return projectLabel;
  let skills: string[];
  if (record.skills === undefined) skills = prior ? [...prior.skills] : [];
  else if (!Array.isArray(record.skills) || record.skills.length > 8) return fail('invalid_body', 'skills must be a list of at most 8 strings');
  else {
    skills = [];
    for (const item of record.skills) {
      const skill = readOptionalText('skill', item, 32);
      if (!skill.ok) return skill;
      if (skill.value.length === 0) return fail('invalid_text', 'skill must not be blank');
      skills.push(skill.value);
    }
  }
  let openSlots: number;
  if (record.openSlots === undefined) openSlots = prior?.openSlots ?? 1;
  else if (typeof record.openSlots !== 'number' || !Number.isInteger(record.openSlots) || record.openSlots < 1 || record.openSlots > 20) {
    return fail('invalid_body', 'openSlots must be a whole number from 1 to 20');
  } else openSlots = record.openSlots;
  return pass({ description: description.value, projectLabel: projectLabel.value, skills, openSlots });
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
    categoryLabel: categoryLabel(row.category),
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
  private readonly store: LffBoardStore;
  private readonly loadFailure: LffErrorCode | null;
  private serialCounter = 1;

  constructor(private readonly newId: () => string, store?: LffBoardStore) {
    this.store = store ?? new MemoryLffBoardStore();
    const loaded = this.store.load();
    if (loaded.status === 'corrupt') {
      this.loadFailure = 'store_corrupt';
      return;
    }
    this.loadFailure = null;
    if (loaded.status === 'empty') return;
    for (const row of loaded.snapshot.listings) {
      this.listings.set(row.listingId, { ...row, skills: [...row.skills] });
      if (row.serial >= this.serialCounter) this.serialCounter = row.serial + 1;
    }
    for (const row of loaded.snapshot.requests) this.requests.set(row.requestId, { ...row });
  }

  create(actorId: string, body: unknown, nowIso: string): LffResult<LffListingView> {
    const ready = this.prepare(actorId, body, nowIso, CREATE_KEYS);
    if (!ready.ok) return ready;
    const category = readCategory(ready.value.record.category);
    if (!category.ok) return category;
    const title = readText('title', ready.value.record.title, LFF_LIMITS.titleMax);
    if (!title.ok) return title;
    const desktop = readDesktopFields(ready.value.record);
    if (!desktop.ok) return desktop;
    const text = ready.value.record.body === undefined
      ? pass(desktop.value.description.length > 0 ? desktop.value.description.slice(0, LFF_LIMITS.bodyMax) : title.value)
      : readText('body', ready.value.record.body, LFF_LIMITS.bodyMax);
    if (!text.ok) return text;
    const displayName = ready.value.record.displayName === undefined
      ? pass(actorId.slice(0, LFF_LIMITS.displayNameMax))
      : readText('displayName', ready.value.record.displayName, LFF_LIMITS.displayNameMax);
    if (!displayName.ok) return displayName;
    const contact = ready.value.record.contactMethod === undefined && ready.value.record.contactValue === undefined
      ? pass({ method: 'in_world_message' as const, value: actorId.slice(0, LFF_LIMITS.contactValueMax) })
      : this.readContactPair(actorId, ready.value.record.contactMethod, ready.value.record.contactValue);
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
      description: ready.value.record.description === undefined && ready.value.record.body !== undefined
        ? text.value
        : desktop.value.description,
      projectLabel: desktop.value.projectLabel,
      skills: desktop.value.skills,
      openSlots: desktop.value.openSlots,
      serial: this.serialCounter++,
      version: 1,
      contactMethod: contact.value.method,
      contactValue: contact.value.value,
      status: 'open',
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: formatUtc(ready.value.nowMs + lifetime.value * 60 * 60 * 1000),
    };
    this.listings.set(row.listingId, row);
    return this.saved(listingView(row));
  }

  list(actorId: string, category: unknown, nowIso: string): LffResult<LffFeed> {
    const player = readPlayer(actorId);
    if (!player.ok) return player;
    const clock = readClock(nowIso);
    if (!clock.ok) return clock;
    let selected: LffStoredCategory | null = null;
    if (category !== undefined && category !== null) {
      const parsed = readCategory(category);
      if (!parsed.ok) return parsed;
      selected = parsed.value;
    }
    const settled = this.persistSettle(clock.value, nowIso);
    if (!settled.ok) return settled;
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
    const settled = this.persistSettle(clock.value, nowIso);
    if (!settled.ok) return settled;
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
    const desktop = readDesktopFields(record, row);
    if (!desktop.ok) return desktop;
    if (record.description !== undefined || record.projectLabel !== undefined || record.skills !== undefined || record.openSlots !== undefined) {
      row.description = desktop.value.description;
      row.projectLabel = desktop.value.projectLabel;
      row.skills = desktop.value.skills;
      row.openSlots = desktop.value.openSlots;
      if (record.body === undefined && record.description !== undefined) {
        row.body = desktop.value.description.length > 0 ? desktop.value.description.slice(0, LFF_LIMITS.bodyMax) : row.title;
      }
    }
    row.version += 1;
    row.updatedAt = nowIso;
    return this.saved(listingView(row));
  }

  /** Author withdraw. The route that calls this is POST /lff/posts/:id/close. */
  close(actorId: string, listingId: string, body: unknown, nowIso: string): LffResult<LffListingView> {
    const ready = this.prepare(actorId, body, nowIso, []);
    if (!ready.ok) return ready;
    const open = this.requireAuthorOpen(actorId, listingId, ready.value.nowMs, nowIso);
    if (!open.ok) return open;
    open.value.status = 'withdrawn';
    open.value.updatedAt = nowIso;
    return this.saved(listingView(open.value));
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
    return this.saved({ schemaVersion: LFF_SCHEMA_V1, listingId, deleted: true });
  }

  createRequest(actorId: string, listingId: string, body: unknown, nowIso: string): LffResult<LffRequestView> {
    const ready = this.prepare(actorId, body, nowIso, REQUEST_KEYS);
    if (!ready.ok) return ready;
    const open = this.requireOpen(listingId, ready.value.nowMs, nowIso);
    if (!open.ok) return open;
    if (open.value.authorId === actorId) return fail('cannot_request_own', 'the author connects through the listing contact');
    const message = ready.value.record.message === undefined
      ? pass('')
      : readText('message', ready.value.record.message, LFF_LIMITS.requestMessageMax);
    if (!message.ok) return message;
    const displayName = ready.value.record.displayName === undefined
      ? pass(actorId.slice(0, LFF_LIMITS.displayNameMax))
      : readText('displayName', ready.value.record.displayName, LFF_LIMITS.displayNameMax);
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
    return this.saved(this.requestView(request, open.value));
  }

  listPostRequests(actorId: string, listingId: string, nowIso: string): LffResult<LffRequestList> {
    const player = readPlayer(actorId);
    if (!player.ok) return player;
    const clock = readClock(nowIso);
    if (!clock.ok) return clock;
    const settled = this.persistSettle(clock.value, nowIso);
    if (!settled.ok) return settled;
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
    const settled = this.persistSettle(clock.value, nowIso);
    if (!settled.ok) return settled;
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

  /** The feed page the f1fbb264 desktop client reads (`data.posts` / `data.nextCursor`). */
  desktopFeed(actorId: string, query: LffDesktopFeedQuery, nowIso: string): LffResult<LffDesktopFeedPage> {
    const player = readPlayer(actorId);
    if (!player.ok) return player;
    const clock = readClock(nowIso);
    if (!clock.ok) return clock;
    const settled = this.persistSettle(clock.value, nowIso);
    if (!settled.ok) return settled;
    const category = query.category === undefined || query.category === ''
      ? pass(null)
      : readCategory(query.category);
    if (!category.ok) return category;
    const project = query.projectLabel === undefined ? pass('') : readOptionalText('projectLabel', query.projectLabel, 80);
    if (!project.ok) return project;
    const skill = query.skill === undefined ? pass('') : readOptionalText('skill', query.skill, 32);
    if (!skill.ok) return skill;
    const cursor = parseDesktopCursor(query.cursor);
    if (!cursor.ok) return cursor;
    const limit = parseDesktopLimit(query.limit);
    if (!limit.ok) return limit;
    const projectNeedle = project.value.toLowerCase();
    const skillNeedle = skill.value.toLowerCase();
    const matching = [...this.listings.values()].filter((row) => {
      if (query.mine) {
        if (row.authorId !== actorId) return false;
      } else if (row.status !== 'open') return false;
      if (query.hasOpenSlots && row.status !== 'open') return false;
      if (category.value !== null && row.category !== category.value) return false;
      if (projectNeedle.length > 0 && !row.projectLabel.toLowerCase().includes(projectNeedle)) return false;
      if (skillNeedle.length > 0 && !row.skills.some((item) => item.toLowerCase() === skillNeedle)) return false;
      return cursor.value === null || isOlderThanCursor(row, cursor.value);
    }).sort(newestFirst);
    const page = matching.slice(0, limit.value);
    const last = page[page.length - 1];
    return pass({
      posts: page.map((row) => this.desktopPostView(row, actorId)),
      nextCursor: matching.length > limit.value && last !== undefined ? desktopCursorOf(last) : null,
    });
  }

  /** One post as the desktop detail read (`data` of GET /lff/posts/:id). */
  desktopPost(actorId: string, listingId: string, nowIso: string): LffResult<LffDesktopPostDetail> {
    const seen = this.get(actorId, listingId, nowIso);
    if (!seen.ok) return seen;
    const row = this.listings.get(listingId);
    if (!row) return fail('not_found', 'listing not found');
    const accepted = this.acceptedPeople(row, actorId);
    return pass({ ...this.desktopPostView(row, actorId), authorProfile: null, accepted });
  }

  /** GET /lff/requests as the desktop client parses it. */
  desktopMine(actorId: string, nowIso: string): LffResult<LffDesktopMyRequests> {
    const player = readPlayer(actorId);
    if (!player.ok) return player;
    const clock = readClock(nowIso);
    if (!clock.ok) return clock;
    const settled = this.persistSettle(clock.value, nowIso);
    if (!settled.ok) return settled;
    const mine = [...this.requests.values()]
      .filter((request) => request.requesterId === actorId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.requestId.localeCompare(a.requestId));
    const visible = mine.flatMap((request) => {
      const row = this.listings.get(request.listingId);
      if (!row) return [];
      const status = desktopRequesterStatus(request, row);
      if (status === null) return [];
      const post = row.status === 'open' ? this.desktopPostView(row, actorId) : null;
      return [{
        requestId: request.requestId,
        postId: request.listingId,
        status,
        message: request.message,
        createdAtIso: request.createdAt,
        updatedAtIso: request.updatedAt,
        post,
      }];
    });
    const capped = visible.slice(0, 100);
    return pass({ requests: capped, truncated: visible.length > 100 });
  }

  /** GET /lff/posts/:id/requests as the owner's inbox. */
  desktopInbox(actorId: string, listingId: string, nowIso: string): LffResult<LffDesktopInbox> {
    const listed = this.listPostRequests(actorId, listingId, nowIso);
    if (!listed.ok) return listed;
    const row = this.listings.get(listingId);
    if (!row || row.authorId !== actorId) return fail('not_author', 'only the player who posted can read these requests');
    const requests = this.requestsFor(listingId)
      .filter((request) => request.status === 'open' || request.status === 'accepted')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.requestId.localeCompare(b.requestId))
      .map((request) => ({
        requestId: request.requestId,
        status: request.status === 'accepted' ? 'ACCEPTED' as const : 'PENDING' as const,
        message: request.message,
        createdAtIso: request.createdAt,
        updatedAtIso: request.updatedAt,
        requester: desktopPerson(request.requesterId, request.requesterDisplayName),
      }));
    return pass({ postId: listingId, requests });
  }

  private desktopPostView(row: ListingRecord, actorId: string): LffDesktopPost {
    const owner = row.authorId === actorId;
    const accepted = this.requestsFor(row.listingId).filter((request) => request.status === 'accepted').length;
    return {
      postId: row.listingId,
      category: DESKTOP_TOKEN_OF[row.category],
      categoryLabel: LFF_DESKTOP_CATEGORY_LABELS[row.category],
      title: row.title,
      description: row.description,
      projectLabel: row.projectLabel,
      skills: [...row.skills],
      openSlots: row.openSlots,
      availableSlots: owner ? Math.max(0, row.openSlots - accepted) : null,
      status: row.status === 'open' ? 'OPEN' : row.status === 'expired' ? 'EXPIRED' : 'CLOSED',
      createdAtIso: row.createdAt,
      updatedAtIso: row.updatedAt,
      expiresAtIso: row.expiresAt,
      version: row.version,
      author: desktopPerson(row.authorId, row.authorDisplayName),
      viewerIsOwner: owner,
      viewerRequest: owner ? null : this.viewerRequest(row, actorId),
    };
  }

  private viewerRequest(row: ListingRecord, actorId: string): LffDesktopPost['viewerRequest'] {
    const theirs = this.requestsFor(row.listingId).filter((request) => request.requesterId === actorId);
    const pick = theirs.find((request) => request.status === 'open' || request.status === 'accepted')
      ?? [...theirs].reverse().find((request) => request.status === 'declined');
    if (pick === undefined) return null;
    const status = desktopRequesterStatus(pick, row);
    return status === null ? null : { requestId: pick.requestId, status };
  }

  private acceptedPeople(row: ListingRecord, actorId: string): readonly LffDesktopPerson[] | null {
    const accepted = this.requestsFor(row.listingId).filter((request) => request.status === 'accepted');
    const viewerAccepted = accepted.some((request) => request.requesterId === actorId);
    if (row.authorId !== actorId && !viewerAccepted) return null;
    return accepted.map((request) => desktopPerson(request.requesterId, request.requesterDisplayName));
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
    const settled = this.persistSettle(clock.value, nowIso);
    if (!settled.ok) return settled;
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

  private settle(nowMs: number, nowIso: string): boolean {
    let changed = false;
    for (const row of this.listings.values()) {
      const expires = parseLffUtc(row.expiresAt);
      if (row.status === 'open' && (expires === null || expires <= nowMs)) {
        row.status = 'expired';
        row.updatedAt = nowIso;
        changed = true;
      }
    }
    return changed;
  }

  private blocked(): LffResult<never> | null {
    if (this.loadFailure === null) return null;
    return fail(this.loadFailure, 'the looking for feed store could not be read');
  }

  private toSnapshot(): LffBoardSnapshot {
    const listings = [...this.listings.values()]
      .map((row) => ({ ...row }))
      .sort((a, b) => a.listingId.localeCompare(b.listingId));
    const requests = [...this.requests.values()]
      .map((row) => ({ ...row }))
      .sort((a, b) => a.requestId.localeCompare(b.requestId));
    return { schemaVersion: LFF_SCHEMA_V1, listings, requests };
  }

  private checkpoint(): LffResult<true> {
    try {
      this.store.save(this.toSnapshot());
      return pass(true);
    } catch {
      return fail('store_unavailable', 'the looking for feed store could not be written');
    }
  }

  private persistSettle(nowMs: number, nowIso: string): LffResult<true> {
    const blocked = this.blocked();
    if (blocked !== null) return blocked;
    if (!this.settle(nowMs, nowIso)) return pass(true);
    return this.checkpoint();
  }

  private saved<T>(value: T): LffResult<T> {
    const blocked = this.blocked();
    if (blocked !== null) return blocked;
    const wrote = this.checkpoint();
    if (!wrote.ok) return wrote;
    return pass(value);
  }

  private openListings(actorId: string, category?: LffStoredCategory): ListingRecord[] {
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
      categoryLabel: categoryLabel(row.category),
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
    return this.saved(this.requestView(request, row));
  }
}
