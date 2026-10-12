/**
 * WONDERLAND SOCIAL — LFF, the "Looking For Feed" (the private-Alpha launch gate, founder 2026-10-12).
 *
 * A player posts what they are looking for (a team, builders, AI engineers, designers, competitors, collaborators); other
 * players browse the feed and ask to join; the owner accepts or declines. Contract: _qa_handoff/lff/LFF_ALPHA_CONTRACT_r1_20261012.md,
 * as decided by MAIN in the B1 repair round (r2, after the internal security/privacy and correctness reviews).
 *
 * ONE MORE SET OF OPERATIONS ON THE ONE SOCIAL STATE (the dependency audit, §0.1). The posts, the requests and the creation
 * record live in SocialState (lffPosts, lffRequests, lffCreations); social-commands.ts parses each operation's inputs and calls
 * the rules here; the block path in social-friends.ts cancels what a block crosses. So LFF inherits the session gate, the actor
 * binding, atomicity, content-free events and the block floor like every other social operation.
 *
 * THE RULES THIS FILE KEEPS (contract, "Security and privacy", as MAIN decided them in r2):
 *   1. THE ACTOR IS THE SESSION'S PLAYER, and ownership is checked on edit, close, delete, accept and decline. Anyone else is
 *      answered EXACTLY as a missing post (lffNotFound): never a refusal that says the post exists.
 *   2. A BLOCK EITHER WAY makes the post absent for the other side -- not in the feed, not by id, not requestable, each answered
 *      as a missing post -- and CANCELS the live requests it crosses (social-friends.ts blockUser). Each side is then shown, and
 *      TOLD, exactly what the ordinary change it imitates shows and tells (SEC-M2: silence was itself the tell): to the owner the
 *      request reads as withdrawn and the owner is told lff.request.withdraw; to the requester the post reads as deleted and they
 *      are told lff.post.delete (lffBlockNotices, sent by blocks.add past the block floor). Nothing names the block.
 *   3. A POST IS SHOWN ONLY TO A VIEWER WHO MAY SEE ITS AUTHOR (SEC-M1, SEC-M4/CORR-M2; decision D-L3 = do not list): the presence
 *      audience the author chose (presenceVisibility -- the presence authority's own "may this viewer see this person") must
 *      admit the viewer, and no block may stand either way. Otherwise the post is ABSENT, answered as a missing post. There is no
 *      anonymous listing: every visible post names its author, so any viewer can report it through the existing flow,
 *      reports.file {reportedId: author.userId, subjectRef: postId}. APPEAR_OFFLINE is not asked about: it reads exactly as signed
 *      out (the presence authority's M1 rule), so it never hides a post -- hiding it would tell friends "online and hiding".
 *   4. THE GENERAL FEED IS OPEN POSTS ONLY (SEC-M3). A CLOSED or EXPIRED post is shown only to its owner (their `mine` list, and by
 *      id) and to the users accepted on it; to anyone else it is absent.
 *   5. CAPS (all PROPOSED, decision D-L2): open posts per owner; posts CREATED per rolling 24 hours, closed and deleted ones counted
 *      (lffCreations), so close-and-repost cannot flood; pending requests out per player and per post; and a cooldown before a
 *      player who withdrew from a post may ask it again.
 *   6. LFF GRANTS NOTHING. No repository, private server, agent, WonderFS, Project Brain or voice is reached from here: the
 *      imports below are the whole list (social-lff-privacy.test.ts walks the real graph), and an accept changes only the request
 *      row (and, when it fills the post, the post's status).
 * No counts or rosters leak: how many have been accepted is the owner's alone (availableSlots); the accepted list is shown to the
 * owner, and to an accepted user with only the co-accepted they may see (rule 3's test, person by person); pending requests are
 * listed to the owner only; and the post a fill closes is told to the others as an ordinary close, never as an accept.
 *
 * TIME IS THE SERVER'S: every rule takes the server's `nowMs` (the store's clock, through applySocialOperation). EXPIRED is
 * never stored; it is READ (lffPostStatusAt), as party invites expire at read. `updatedAtMs` never moves backwards (a stepped-back
 * clock), as 037's stamped() rule requires. ORDER never depends on array order: every list is sorted explicitly (time, then the
 * id's serial), so a store that loads its rows in any order (B2b) answers the same.
 *
 * KNOWN AND INTENDED FOR ALPHA: a post CLOSED by filling never reopens when a slot frees (a withdraw, a block) -- the owner posts
 * again; a repeated accept, decline or withdraw answers the uniform not-found (after a retried write, a client refreshes); a post's
 * version moves with its own fields and status only (an accept changes only the request row); a post made while appearing offline
 * carries its own fresh time, the author's own act, as a message is.
 *
 * Pure: the same state and inputs give the same result on every machine. No fixture or preview data is ever made here.
 */

import { fail, ok, relayError, type RelayError, type RelayResult } from '../protocol/errors';
import type { SocialOperationId, SocialUserId, UserProfileView } from './social-contracts';
import { resolveProfileFor } from './social-presence';
import type { SocialPersonRow } from './social-preview';
import { audienceAdmits, blockedEitherWay, lffPostById, lffRequestById, mintId, userById, type SocialState } from './social-state';

/* ------------------------------------------------------------------------------------------------------------ vocabulary */

export const LFF_CATEGORIES = ['TEAMS', 'BUILDERS', 'AI_ENGINEERS', 'DESIGNERS', 'COMPETITORS', 'COLLABORATORS'] as const;
export type LffCategory = (typeof LFF_CATEGORIES)[number];

/** The words a surface shows for a category: here, never in a widget. */
export const LFF_CATEGORY_LABELS: Readonly<Record<LffCategory, string>> = Object.freeze({
  TEAMS: 'Teams',
  BUILDERS: 'Builders',
  AI_ENGINEERS: 'AI engineers',
  DESIGNERS: 'Designers',
  COMPETITORS: 'Competitors',
  COLLABORATORS: 'Collaborators',
});

/** A post as read. EXPIRED is derived from the server's time and never stored (LffStoredPostStatus). */
export const LFF_POST_STATUSES = ['OPEN', 'CLOSED', 'EXPIRED'] as const;
export type LffPostStatus = (typeof LFF_POST_STATUSES)[number];
export type LffStoredPostStatus = Exclude<LffPostStatus, 'EXPIRED'>;

/**
 * A request as stored. CANCELLED is a request a block crossed (social-friends.ts blockUser): it stays cancelled after an unblock,
 * as a cancelled friend request and a revoked party invite do, and it is shown to nobody. There is no request version (MAIN r2,
 * CORR-M1: 038 drops the column).
 */
export const LFF_REQUEST_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'CANCELLED'] as const;
export type LffRequestStatus = (typeof LFF_REQUEST_STATUSES)[number];

/**
 * What the REQUESTER is shown of their own request. NO_LONGER_AVAILABLE: still pending, but the post is no longer open to them
 * (closed, expired, or its author no longer visible to them). A request whose post was DELETED is gone with it, and one a block
 * crossed reads exactly the same way: absent (a client shows a request it knew and no longer finds as "no longer available").
 */
export const LFF_REQUESTER_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'NO_LONGER_AVAILABLE'] as const;
export type LffRequesterStatus = (typeof LFF_REQUESTER_STATUSES)[number];

/* ------------------------------------------------------------------------------------------------------- policy numbers */

/** PROPOSED (founder decision D-L2, not yet answered): a post expires 14 days after it was created. The ONE place it lives. */
export const LFF_POST_TTL_MS = 14 * 24 * 60 * 60_000;
/** PROPOSED (D-L2): open posts one player may have at once. */
export const LFF_MAX_OPEN_POSTS_PER_USER = 5;
/** PROPOSED (MAIN r2, SEC-M3): posts one player may CREATE within any rolling LFF_CREATION_WINDOW_MS, closed and deleted ones counted. */
export const LFF_MAX_CREATED_PER_WINDOW = 10;
/**
 * The rolling window of LFF_MAX_CREATED_PER_WINDOW: 24 hours of server time. A creation exactly 24 h old still counts; one older
 * than that (24 h + 1 ms) no longer does, and is pruned on the next create.
 */
export const LFF_CREATION_WINDOW_MS = 24 * 60 * 60_000;
/** PROPOSED (D-L2): pending requests one player may have out at once (to posts still open). */
export const LFF_MAX_PENDING_OUTGOING_PER_USER = 20;
/** PROPOSED (D-L2): pending requests one post may hold at once. */
export const LFF_MAX_PENDING_PER_POST = 50;
/** PROPOSED (MAIN r2, SEC m7): a player who withdrew from a post may ask it again only this long after the withdrawal. */
export const LFF_REREQUEST_COOLDOWN_MS = 10 * 60_000;

/** Field bounds (contract, "Post fields"), in CODE POINTS -- PostgreSQL's char_length, as private-server-lifecycle.ts cleanServerName. */
export const LFF_TITLE_MAX = 80;
export const LFF_DESCRIPTION_MAX = 1000;
export const LFF_PROJECT_LABEL_MAX = 80;
export const LFF_SKILLS_MAX = 8;
export const LFF_SKILL_MAX = 32;
export const LFF_SLOTS_MIN = 1;
export const LFF_SLOTS_MAX = 20;
export const LFF_MESSAGE_MAX = 200;

/** Every LFF answer is bounded: a feed page, and the requester's own list. */
export const LFF_FEED_PAGE_DEFAULT = 20;
export const LFF_FEED_PAGE_MAX = 50;
export const LFF_MINE_MAX = 100;

/**
 * THE ONE ABSENCE. A missing post, a post the viewer may not see (a wall, an author hidden from them, a closed or expired post
 * that is not theirs), a post or request the actor does not own, a request that is not theirs, a cancelled one: every one of
 * them is this exact error, so no answer says that something is there.
 */
export const LFF_NOT_FOUND_MESSAGE = 'post not found';
export const lffNotFound = (): RelayError => relayError('not-found', LFF_NOT_FOUND_MESSAGE);

/* --------------------------------------------------------------------------------------------------------------- records */

/** One post, as stored. Every text field is the owner's, validated by social-commands.ts before it reaches here. */
export interface LffPost {
  /** `lffp_<serial>` (mintId). */
  readonly id: string;
  readonly ownerId: SocialUserId;
  readonly category: LffCategory;
  readonly title: string;
  /** '' when none. */
  readonly description: string;
  /** A free-text project or activity label, '' when none. Never a link to a project, a repository or a server (audit §3). */
  readonly projectLabel: string;
  readonly skills: readonly string[];
  /** How many people the owner is looking for (1-20). Accepting fills them; the post CLOSES when they are all filled. */
  readonly openSlots: number;
  readonly status: LffStoredPostStatus;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly expiresAtMs: number;
  /** 1 at creation; +1 on every change to the post itself (an edit, a close, the accept that fills it). */
  readonly version: number;
}

/** One request to join a post, as stored. */
export interface LffJoinRequest {
  /** `lffr_<serial>` (mintId). */
  readonly id: string;
  readonly postId: string;
  readonly requesterId: SocialUserId;
  /** The requester's optional note to the owner, '' when none. Shown to the owner only. */
  readonly message: string;
  readonly status: LffRequestStatus;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

/**
 * ONE POST CREATED, remembered for the rolling creation cap (LFF_MAX_CREATED_PER_WINDOW) after the post itself is closed or
 * deleted: recorded at create time and kept whatever becomes of the post. Persisted as relay_wonderland.lff_post_creations
 * (owner_id, post_id, created_at), PRIMARY KEY (owner_id, post_id) (038 r2, MAIN). Bounded: entries older than the window are
 * pruned on every create, and the cap stops anyone holding more than LFF_MAX_CREATED_PER_WINDOW inside it.
 */
export interface LffCreation {
  readonly userId: SocialUserId;
  /** The created post's id (`lffp_<serial>`), kept after the post is closed or deleted. */
  readonly postId: string;
  readonly atMs: number;
}

/** The fields a player writes on a post, already validated (social-commands.ts). */
export interface LffPostFields {
  readonly category: LffCategory;
  readonly title: string;
  readonly description: string;
  readonly projectLabel: string;
  readonly skills: readonly string[];
  readonly openSlots: number;
}

export type LffPostPatch = Partial<LffPostFields>;

/** A position in the feed: the last post a page held (newest first by server time, then by serial). */
export interface LffFeedCursor {
  readonly createdAtMs: number;
  readonly serial: number;
}

/** The feed's filters, already validated (social-commands.ts). Null = no filter. */
export interface LffFeedFilter {
  readonly category: LffCategory | null;
  /** A substring of the post's project/activity label, compared case-insensitively. */
  readonly projectLabel: string | null;
  /** One whole skill, compared case-insensitively. */
  readonly skill: string | null;
  /**
   * Only posts still OPEN. The general feed is OPEN posts only, so this narrows only the owner's `mine` list (an open post always
   * has a slot left: the change that fills it closes it).
   */
  readonly hasOpenSlots: boolean;
  /** Only the viewer's own posts, CLOSED and EXPIRED ones included (where an owner finds a post to close or delete). */
  readonly mine: boolean;
  readonly cursor: LffFeedCursor | null;
  readonly limit: number;
}

/* ------------------------------------------------------------------------------------------------------------- reading */

/** A post as read at `nowMs`: past its expiry it reads EXPIRED, whatever is stored. At exactly expiresAtMs it is not yet past. */
export function lffPostStatusAt(post: LffPost, nowMs: number): LffPostStatus {
  return nowMs > post.expiresAtMs ? 'EXPIRED' : post.status;
}

const serialOf = (id: string): number => {
  const match = /^lff[pr]_(\d{1,15})$/.exec(id);
  return match === null ? 0 : Number(match[1]);
};

/** The cursor that continues the feed after this post. Opaque to the client; it says nothing the post view does not. */
export const lffCursorOf = (post: LffPost): string => `${post.createdAtMs}.${serialOf(post.id)}`;

/** A cursor this feed gave, or null. */
export function parseLffCursor(raw: string): LffFeedCursor | null {
  const match = /^(\d{1,15})\.(\d{1,15})$/.exec(raw);
  return match === null ? null : { createdAtMs: Number(match[1]), serial: Number(match[2]) };
}

/** Oldest first: by creation time, then by the id's serial (a total order whatever order the rows were loaded in). */
const oldestFirst = (a: { createdAtMs: number; id: string }, b: { createdAtMs: number; id: string }): number =>
  a.createdAtMs - b.createdAtMs || serialOf(a.id) - serialOf(b.id);

const newestFirst = (a: LffPost, b: LffPost): number => oldestFirst(b, a);

const isOlderThan = (post: LffPost, cursor: LffFeedCursor): boolean =>
  post.createdAtMs < cursor.createdAtMs || (post.createdAtMs === cursor.createdAtMs && serialOf(post.id) < cursor.serial);

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * WHETHER THIS VIEWER MAY SEE THIS PERSON (rule 3): themselves; anybody else only when no block stands either way and the
 * person's own presence audience admits the viewer -- the same audience the presence authority asks (social-presence.ts).
 */
function personVisibleTo(state: SocialState, viewerId: SocialUserId, subjectId: SocialUserId): boolean {
  if (viewerId === subjectId) return true;
  const subject = userById(state, subjectId);
  return subject !== undefined && !blockedEitherWay(state, viewerId, subjectId) && audienceAdmits(state, subject.privacy.presenceVisibility, viewerId, subjectId);
}

const isAcceptedOn = (state: SocialState, postId: string, userId: SocialUserId): boolean =>
  state.lffRequests.some((r) => r.postId === postId && r.requesterId === userId && r.status === 'ACCEPTED');

/**
 * WHETHER THIS VIEWER MAY SEE THIS POST AT ALL (rules 2, 3 and 4): its owner always; anybody else only when they may see its
 * author, and then an OPEN post, or a closed or expired one they were accepted on.
 */
function postVisibleTo(state: SocialState, viewerId: SocialUserId, post: LffPost, nowMs: number): boolean {
  if (post.ownerId === viewerId) return true;
  if (!personVisibleTo(state, viewerId, post.ownerId)) return false;
  return lffPostStatusAt(post, nowMs) === 'OPEN' || isAcceptedOn(state, post.id, viewerId);
}

function visiblePost(state: SocialState, viewerId: SocialUserId, postId: string, nowMs: number): LffPost | undefined {
  const post = lffPostById(state, postId);
  return post !== undefined && postVisibleTo(state, viewerId, post, nowMs) ? post : undefined;
}

/** A post the actor OWNS, else undefined: a non-owner, a walled viewer and a missing post are one answer (lffNotFound). */
function ownedPost(state: SocialState, actorId: SocialUserId, postId: string): LffPost | undefined {
  const post = lffPostById(state, postId);
  return post !== undefined && post.ownerId === actorId ? post : undefined;
}

/** A post's requests in these statuses, oldest first (sorted, never the array's order). */
const requestsOn = (state: SocialState, postId: string, statuses: readonly LffRequestStatus[]): LffJoinRequest[] =>
  state.lffRequests.filter((r) => r.postId === postId && statuses.includes(r.status)).sort(oldestFirst);

const acceptedCount = (state: SocialState, postId: string): number => requestsOn(state, postId, ['ACCEPTED']).length;

/** The people a change to this post concerns: everyone whose request on it is still live. */
const liveRequesters = (state: SocialState, postId: string): SocialUserId[] => requestsOn(state, postId, ['PENDING', 'ACCEPTED']).map((r) => r.requesterId);

/** Open posts the owner has now (an expired one is not open). */
function openPostsOf(state: SocialState, ownerId: SocialUserId, nowMs: number): number {
  return state.lffPosts.filter((p) => p.ownerId === ownerId && lffPostStatusAt(p, nowMs) === 'OPEN').length;
}

/** A creation still inside the rolling window at `nowMs`: at most 24 h old. One stamped after `nowMs` (a stepped-back clock) is inside. */
const inCreationWindow = (c: LffCreation, nowMs: number): boolean => nowMs - c.atMs <= LFF_CREATION_WINDOW_MS;

/** Posts the player created inside the rolling window ending now, closed and deleted ones included. */
const createdInWindow = (state: SocialState, userId: SocialUserId, nowMs: number): number =>
  state.lffCreations.filter((c) => c.userId === userId && inCreationWindow(c, nowMs)).length;

/** Pending requests the player has out to posts that are still open (one to a closed or expired post holds nothing). */
function liveOutgoingOf(state: SocialState, requesterId: SocialUserId, nowMs: number): number {
  return state.lffRequests.filter((r) => {
    if (r.requesterId !== requesterId || r.status !== 'PENDING') return false;
    const post = lffPostById(state, r.postId);
    return post !== undefined && lffPostStatusAt(post, nowMs) === 'OPEN';
  }).length;
}

/** The request the actor may act on as its REQUESTER: theirs, live, its post there and not walled from them. */
function ownRequest(state: SocialState, actorId: SocialUserId, requestId: string): { request: LffJoinRequest; post: LffPost } | undefined {
  const request = lffRequestById(state, requestId);
  if (request === undefined || request.requesterId !== actorId) return undefined;
  if (request.status !== 'PENDING' && request.status !== 'ACCEPTED') return undefined;
  const post = lffPostById(state, request.postId);
  if (post === undefined || blockedEitherWay(state, actorId, post.ownerId)) return undefined;
  return { request, post };
}

/** A PENDING request on a post the actor OWNS, its requester not walled from them. Anything else is lffNotFound. */
function incomingPending(state: SocialState, actorId: SocialUserId, requestId: string): { request: LffJoinRequest; post: LffPost } | undefined {
  const request = lffRequestById(state, requestId);
  if (request === undefined || request.status !== 'PENDING') return undefined;
  const post = ownedPost(state, actorId, request.postId);
  if (post === undefined || blockedEitherWay(state, actorId, request.requesterId)) return undefined;
  return { request, post };
}

const replacePost = (state: SocialState, post: LffPost): SocialState => ({ ...state, lffPosts: state.lffPosts.map((p) => (p.id === post.id ? post : p)) });

const resolveRequest = (state: SocialState, request: LffJoinRequest, status: LffRequestStatus, nowMs: number): SocialState => ({
  ...state,
  lffRequests: state.lffRequests.map((r) => (r.id === request.id ? { ...r, status, updatedAtMs: Math.max(nowMs, r.updatedAtMs) } : r)),
});

/** What a change to a post may set: the owner's fields and the status. */
type LffPostChange = { -readonly [K in keyof LffPostFields | 'status']?: LffPost[K] };

/** A post's next version. `updatedAtMs` never moves backwards (a server clock stepped back cannot make an update precede itself). */
const bumped = (post: LffPost, fields: LffPostChange, nowMs: number): LffPost => ({
  ...post,
  ...fields,
  updatedAtMs: Math.max(nowMs, post.updatedAtMs),
  version: post.version + 1,
});

/* ----------------------------------------------------------------------------------------------------------- the rules */

/**
 * AN ORDINARY CHANGE TOLD TO SOMEBODY AS ITSELF, besides the operation's own event: the post a fill closed, told to the others as
 * a close; a request a block cancelled, told as a withdrawal or a deletion. social-commands.ts carries these as extraEvents.
 */
export interface LffNotice {
  readonly op: SocialOperationId;
  readonly audience: readonly SocialUserId[];
}

/** What a change did, and who must be told (the block floor in applySocialOperation still applies). */
export interface LffChange {
  readonly state: SocialState;
  readonly told: readonly SocialUserId[];
  readonly notices?: readonly LffNotice[];
}

/** A close told to these people, as a manual close tells them (or nothing, when there is nobody). */
const closeNotices = (audience: readonly SocialUserId[]): LffNotice[] => (audience.length === 0 ? [] : [{ op: 'lff.post.close', audience }]);

/**
 * CREATE a post, OPEN, expiring LFF_POST_TTL_MS from now. At most LFF_MAX_OPEN_POSTS_PER_USER open posts per owner, and at most
 * LFF_MAX_CREATED_PER_WINDOW created in any rolling 24 hours, closed and deleted ones counted.
 */
export function createLffPost(state: SocialState, actorId: SocialUserId, fields: LffPostFields, nowMs: number): RelayResult<LffChange & { postId: string }> {
  if (userById(state, actorId) === undefined) return fail(relayError('not-found', 'user not found'));
  if (openPostsOf(state, actorId, nowMs) >= LFF_MAX_OPEN_POSTS_PER_USER) {
    return fail(relayError('illegal-transition', `you already have ${LFF_MAX_OPEN_POSTS_PER_USER} open posts: close one first`));
  }
  if (createdInWindow(state, actorId, nowMs) >= LFF_MAX_CREATED_PER_WINDOW) {
    return fail(relayError('illegal-transition', `you have created ${LFF_MAX_CREATED_PER_WINDOW} posts in the last 24 hours: try again later`));
  }
  const minted = mintId(state, 'lffp');
  const post: LffPost = {
    id: minted.id,
    ownerId: actorId,
    category: fields.category,
    title: fields.title,
    description: fields.description,
    projectLabel: fields.projectLabel,
    skills: [...fields.skills],
    openSlots: fields.openSlots,
    status: 'OPEN',
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    expiresAtMs: nowMs + LFF_POST_TTL_MS,
    version: 1,
  };
  // the creation record keeps only the window: everyone's older entries are pruned here, on write, so it stays bounded
  const creations = [...minted.state.lffCreations.filter((c) => inCreationWindow(c, nowMs)), { userId: actorId, postId: post.id, atMs: nowMs }];
  return ok({ state: { ...minted.state, lffPosts: [...minted.state.lffPosts, post], lffCreations: creations }, postId: post.id, told: [actorId] });
}

/**
 * EDIT a post: the owner only, OPEN only. The slots may not drop below the people already accepted; dropping to exactly them
 * fills the post, which closes it -- and everyone with a live request on it is told a close, as a manual close tells them.
 */
export function editLffPost(state: SocialState, actorId: SocialUserId, postId: string, patch: LffPostPatch, nowMs: number): RelayResult<LffChange> {
  const post = ownedPost(state, actorId, postId);
  if (post === undefined) return fail(lffNotFound());
  if (lffPostStatusAt(post, nowMs) !== 'OPEN') return fail(relayError('illegal-transition', 'only an open post can be edited'));
  const accepted = acceptedCount(state, post.id);
  if (patch.openSlots !== undefined && patch.openSlots < accepted) {
    return fail(relayError('validation-failed', `openSlots cannot be fewer than the ${accepted} already accepted`));
  }
  const fields: LffPostChange = {};
  if (patch.category !== undefined) fields.category = patch.category;
  if (patch.title !== undefined) fields.title = patch.title;
  if (patch.description !== undefined) fields.description = patch.description;
  if (patch.projectLabel !== undefined) fields.projectLabel = patch.projectLabel;
  if (patch.skills !== undefined) fields.skills = [...patch.skills];
  const fills = patch.openSlots !== undefined && patch.openSlots === accepted;
  if (patch.openSlots !== undefined) fields.openSlots = patch.openSlots;
  if (fills) fields.status = 'CLOSED';
  return ok({ state: replacePost(state, bumped(post, fields, nowMs)), told: [actorId], notices: fills ? closeNotices(liveRequesters(state, post.id)) : [] });
}

/** CLOSE a post: the owner only, OPEN only. Everyone with a live request on it is told (their request no longer leads anywhere). */
export function closeLffPost(state: SocialState, actorId: SocialUserId, postId: string, nowMs: number): RelayResult<LffChange> {
  const post = ownedPost(state, actorId, postId);
  if (post === undefined) return fail(lffNotFound());
  if (lffPostStatusAt(post, nowMs) !== 'OPEN') return fail(relayError('illegal-transition', 'this post is not open'));
  return ok({ state: replacePost(state, bumped(post, { status: 'CLOSED' }, nowMs)), told: [actorId, ...liveRequesters(state, post.id)] });
}

/** DELETE a post: the owner only, in any status. A HARD delete: the post and every request to it are gone. */
export function deleteLffPost(state: SocialState, actorId: SocialUserId, postId: string): RelayResult<LffChange> {
  const post = ownedPost(state, actorId, postId);
  if (post === undefined) return fail(lffNotFound());
  return ok({
    state: { ...state, lffPosts: state.lffPosts.filter((p) => p.id !== post.id), lffRequests: state.lffRequests.filter((r) => r.postId !== post.id) },
    told: [actorId, ...liveRequesters(state, post.id)],
  });
}

/**
 * ASK TO JOIN a post. Refused: for a post the actor may not see (missing, walled, its author hidden from them, closed or expired)
 * as one answer, lffNotFound; on one's own post; on a post that is not open; while a request of one's own to it is pending or
 * accepted; within LFF_REREQUEST_COOLDOWN_MS of withdrawing from it; past the player's and the post's pending caps.
 */
export function createLffRequest(state: SocialState, actorId: SocialUserId, postId: string, message: string, nowMs: number): RelayResult<LffChange & { requestId: string }> {
  const post = visiblePost(state, actorId, postId, nowMs);
  if (post === undefined) return fail(lffNotFound());
  if (post.ownerId === actorId) return fail(relayError('validation-failed', 'you cannot ask to join your own post'));
  if (lffPostStatusAt(post, nowMs) !== 'OPEN') return fail(relayError('illegal-transition', 'this post is not open'));
  const mine = state.lffRequests.filter((r) => r.postId === post.id && r.requesterId === actorId);
  if (mine.some((r) => r.status === 'PENDING')) return fail(relayError('validation-failed', 'a request to this post is already pending'));
  if (mine.some((r) => r.status === 'ACCEPTED')) return fail(relayError('validation-failed', 'you have already been accepted on this post'));
  if (mine.some((r) => r.status === 'WITHDRAWN' && nowMs - r.updatedAtMs < LFF_REREQUEST_COOLDOWN_MS)) {
    return fail(relayError('illegal-transition', `you withdrew from this post: you can ask again ${LFF_REREQUEST_COOLDOWN_MS / 60_000} minutes after`));
  }
  if (liveOutgoingOf(state, actorId, nowMs) >= LFF_MAX_PENDING_OUTGOING_PER_USER) {
    return fail(relayError('illegal-transition', `you already have ${LFF_MAX_PENDING_OUTGOING_PER_USER} pending requests: withdraw one first`));
  }
  if (requestsOn(state, post.id, ['PENDING']).length >= LFF_MAX_PENDING_PER_POST) {
    return fail(relayError('illegal-transition', `this post already holds ${LFF_MAX_PENDING_PER_POST} pending requests`));
  }
  const minted = mintId(state, 'lffr');
  const request: LffJoinRequest = {
    id: minted.id,
    postId: post.id,
    requesterId: actorId,
    message,
    status: 'PENDING',
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
  return ok({ state: { ...minted.state, lffRequests: [...minted.state.lffRequests, request] }, requestId: request.id, told: [actorId, post.ownerId] });
}

/** WITHDRAW one's own pending or accepted request (leaving a post one was accepted on frees the slot). The requester only. */
export function withdrawLffRequest(state: SocialState, actorId: SocialUserId, requestId: string, nowMs: number): RelayResult<LffChange> {
  const found = ownRequest(state, actorId, requestId);
  if (found === undefined) return fail(lffNotFound());
  return ok({ state: resolveRequest(state, found.request, 'WITHDRAWN', nowMs), told: [actorId, found.post.ownerId] });
}

/**
 * ACCEPT a pending request: the post's owner only, the post still OPEN. This changes the request row and nothing else of
 * anybody's -- no friendship, conversation, party, world or private server (contract, "Connect after accept") -- except that
 * the accept which fills the last slot CLOSES the post. Everyone else with a live request on it is then told a CLOSE, exactly
 * as a manual close tells them: the op never says the post filled (SEC m6).
 */
export function acceptLffRequest(state: SocialState, actorId: SocialUserId, requestId: string, nowMs: number): RelayResult<LffChange & { closed: boolean }> {
  const found = incomingPending(state, actorId, requestId);
  if (found === undefined) return fail(lffNotFound());
  const { request, post } = found;
  if (lffPostStatusAt(post, nowMs) !== 'OPEN') return fail(relayError('illegal-transition', 'this post is not open'));
  const accepted = resolveRequest(state, request, 'ACCEPTED', nowMs);
  const filled = acceptedCount(accepted, post.id) >= post.openSlots;
  if (!filled) return ok({ state: accepted, told: [actorId, request.requesterId], closed: false });
  const others = liveRequesters(accepted, post.id).filter((id) => id !== request.requesterId);
  return ok({ state: replacePost(accepted, bumped(post, { status: 'CLOSED' }, nowMs)), told: [actorId, request.requesterId], notices: closeNotices(others), closed: true });
}

/** DECLINE a pending request: the post's owner only, whatever the post's status. */
export function declineLffRequest(state: SocialState, actorId: SocialUserId, requestId: string, nowMs: number): RelayResult<LffChange> {
  const found = incomingPending(state, actorId, requestId);
  if (found === undefined) return fail(lffNotFound());
  return ok({ state: resolveRequest(state, found.request, 'DECLINED', nowMs), told: [actorId, found.request.requesterId] });
}

/**
 * WHAT A BLOCK'S CANCELLATIONS MUST TELL (rule 2, SEC-M2), one notice per request the block moved from live to CANCELLED, in
 * request order: the blocker is the actor and is told the block as always; the OTHER side is told the ordinary change it now
 * sees -- an owner whose requester blocked them, a withdrawal (lff.request.withdraw); a requester whose owner blocked them, a
 * deletion of that post (lff.post.delete). blocks.add sends these past the block floor (they are addressed across it on purpose).
 */
export function lffBlockNotices(before: SocialState, after: SocialState, actorId: SocialUserId): LffNotice[] {
  const notices: LffNotice[] = [];
  const cancelled = after.lffRequests
    .filter((r) => {
      if (r.status !== 'CANCELLED') return false;
      const was = lffRequestById(before, r.id)?.status;
      return was === 'PENDING' || was === 'ACCEPTED';
    })
    .sort(oldestFirst);
  for (const r of cancelled) {
    const ownerId = lffPostById(after, r.postId)?.ownerId;
    if (ownerId === undefined) continue;
    if (r.requesterId === actorId) notices.push({ op: 'lff.request.withdraw', audience: [ownerId] });
    else if (ownerId === actorId) notices.push({ op: 'lff.post.delete', audience: [r.requesterId] });
  }
  return notices;
}

/* ------------------------------------------------------------------------------------------------------------ the views */

/**
 * A PERSON ROW, from the one presence authority: social-preview.ts `row`, handed in by social-commands.ts. Taken as a parameter so
 * this module imports nothing beyond the presence authority (the sweep in social-lff-privacy.test.ts walks the real imports).
 */
export type LffPersonRowOf = (state: SocialState, viewerId: SocialUserId, userId: SocialUserId) => SocialPersonRow | null;

/** The viewer's own request on a post, as they are shown it. */
export interface LffViewerRequest {
  readonly requestId: string;
  readonly status: LffRequesterStatus;
}

/** ONE POST AS ONE VIEWER SEES IT. Built field by field: a field added to LffPost is private until it is added here. */
export interface LffPostView {
  readonly postId: string;
  readonly category: LffCategory;
  readonly categoryLabel: string;
  readonly title: string;
  readonly description: string;
  readonly projectLabel: string;
  readonly skills: readonly string[];
  readonly openSlots: number;
  /** How many slots are still open: the OWNER's view only (a count of acceptances is a roster); null for everyone else. */
  readonly availableSlots: number | null;
  readonly status: LffPostStatus;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  readonly expiresAtIso: string;
  readonly version: number;
  /**
   * The author, always: a post is shown only to a viewer who may see its author (rule 3). To report the post, the existing flow:
   * reports.file {reportedId: author.userId, reason, subjectRef: postId}.
   */
  readonly author: SocialPersonRow;
  readonly viewerIsOwner: boolean;
  /** The viewer's own request on the post, if any is still theirs to see. */
  readonly viewerRequest: LffViewerRequest | null;
}

/** One post in detail (lff.post.get): the author's profile card as this viewer may see it, and the accepted list for those it is for. */
export interface LffPostDetail extends LffPostView {
  /** resolveProfileFor's card, exactly what profile.read would show this viewer. */
  readonly authorProfile: UserProfileView | null;
  /**
   * The people accepted on the post: to the owner, all of them; to an accepted user, those of them they may see (rule 3, person
   * by person; a co-accepted user they may not see is left out, never named); null for everyone else.
   */
  readonly accepted: readonly SocialPersonRow[] | null;
}

export interface LffFeedPage {
  readonly posts: readonly LffPostView[];
  /** Pass it back as `cursor` for the next page; null when this page is the last. */
  readonly nextCursor: string | null;
}

/** One of the requester's own requests (lff.requests.mine). */
export interface LffMyRequestView {
  readonly requestId: string;
  readonly postId: string;
  readonly status: LffRequesterStatus;
  readonly message: string;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  /** The post as the requester may see it now, or null when they may no longer see it (closed, expired, its author hidden). */
  readonly post: LffPostView | null;
}

export interface LffMyRequests {
  readonly requests: readonly LffMyRequestView[];
  /** True when older requests were left out of this answer (LFF_MINE_MAX). */
  readonly truncated: boolean;
}

/** One request to the owner's post (lff.requests.forPost). */
export interface LffIncomingRequestView {
  readonly requestId: string;
  readonly status: 'PENDING' | 'ACCEPTED';
  readonly message: string;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  readonly requester: SocialPersonRow;
}

export interface LffPostRequests {
  readonly postId: string;
  readonly requests: readonly LffIncomingRequestView[];
}

/** How the requester is shown their own request on a post they may (`visible`) or may no longer see. */
function requesterStatus(request: LffJoinRequest, post: LffPost, visible: boolean, nowMs: number): LffRequesterStatus | null {
  switch (request.status) {
    case 'PENDING':
      return visible && lffPostStatusAt(post, nowMs) === 'OPEN' ? 'PENDING' : 'NO_LONGER_AVAILABLE';
    case 'ACCEPTED':
      return 'ACCEPTED';
    case 'DECLINED':
      return 'DECLINED';
    case 'WITHDRAWN':
    case 'CANCELLED':
      return null;
  }
}

/** The viewer's request on this (visible) post that they still see: a live one first, else the newest declined one. */
function viewerRequestOn(state: SocialState, post: LffPost, viewerId: SocialUserId, nowMs: number): LffViewerRequest | null {
  const theirs = state.lffRequests.filter((r) => r.postId === post.id && r.requesterId === viewerId).sort(oldestFirst);
  const pick = theirs.find((r) => r.status === 'PENDING' || r.status === 'ACCEPTED') ?? theirs.filter((r) => r.status === 'DECLINED').pop();
  if (pick === undefined) return null;
  const status = requesterStatus(pick, post, true, nowMs);
  return status === null ? null : { requestId: pick.id, status };
}

/** The view of a post the caller has found VISIBLE to this viewer; null only if its author has no record at all. */
function postViewFor(state: SocialState, viewerId: SocialUserId, post: LffPost, nowMs: number, rowOf: LffPersonRowOf): LffPostView | null {
  const author = rowOf(state, viewerId, post.ownerId);
  if (author === null) return null;
  const owner = post.ownerId === viewerId;
  return {
    postId: post.id,
    category: post.category,
    categoryLabel: LFF_CATEGORY_LABELS[post.category],
    title: post.title,
    description: post.description,
    projectLabel: post.projectLabel,
    skills: [...post.skills],
    openSlots: post.openSlots,
    availableSlots: owner ? Math.max(0, post.openSlots - acceptedCount(state, post.id)) : null,
    status: lffPostStatusAt(post, nowMs),
    createdAtIso: iso(post.createdAtMs),
    updatedAtIso: iso(post.updatedAtMs),
    expiresAtIso: iso(post.expiresAtMs),
    version: post.version,
    author,
    viewerIsOwner: owner,
    viewerRequest: owner ? null : viewerRequestOn(state, post, viewerId, nowMs),
  };
}

/**
 * THE FEED, for one viewer: OPEN posts only, each one the viewer may see (rule 3, and never behind a wall), newest first by server
 * time, filtered, one bounded page at a time from a server cursor. `mine` lists the viewer's own posts instead, in any status.
 */
export function lffFeedFor(state: SocialState, viewerId: SocialUserId, filter: LffFeedFilter, nowMs: number, rowOf: LffPersonRowOf): LffFeedPage {
  const project = filter.projectLabel?.toLowerCase() ?? null;
  const skill = filter.skill?.toLowerCase() ?? null;
  const limit = Math.max(1, Math.min(filter.limit, LFF_FEED_PAGE_MAX));
  const matching = state.lffPosts
    .filter((p) => {
      if (filter.mine) {
        if (p.ownerId !== viewerId) return false;
      } else if (lffPostStatusAt(p, nowMs) !== 'OPEN' || !postVisibleTo(state, viewerId, p, nowMs)) {
        return false;
      }
      if (filter.category !== null && p.category !== filter.category) return false;
      if (project !== null && !p.projectLabel.toLowerCase().includes(project)) return false;
      if (skill !== null && !p.skills.some((s) => s.toLowerCase() === skill)) return false;
      if (filter.hasOpenSlots && lffPostStatusAt(p, nowMs) !== 'OPEN') return false;
      return filter.cursor === null || isOlderThan(p, filter.cursor);
    })
    .sort(newestFirst);
  const page = matching.slice(0, limit);
  return {
    posts: page.map((p) => postViewFor(state, viewerId, p, nowMs, rowOf)).filter((v): v is LffPostView => v !== null),
    nextCursor: matching.length > limit ? lffCursorOf(page[page.length - 1]) : null,
  };
}

/** One post in detail, or null when the viewer may not see it (the caller answers lffNotFound). */
export function lffPostFor(state: SocialState, viewerId: SocialUserId, postId: string, nowMs: number, rowOf: LffPersonRowOf): LffPostDetail | null {
  const post = visiblePost(state, viewerId, postId, nowMs);
  if (post === undefined) return null;
  const view = postViewFor(state, viewerId, post, nowMs, rowOf);
  if (view === null) return null;
  const owner = post.ownerId === viewerId;
  const accepted =
    owner || isAcceptedOn(state, post.id, viewerId)
      ? requestsOn(state, post.id, ['ACCEPTED'])
          // never anybody behind the owner's wall (a block cancels those; old data is held to the same rule), and to an accepted
          // user only the co-accepted they may see, themselves included (SEC m5)
          .filter((r) => !blockedEitherWay(state, post.ownerId, r.requesterId))
          .filter((r) => owner || personVisibleTo(state, viewerId, r.requesterId))
          .map((r) => rowOf(state, viewerId, r.requesterId))
          .filter((p): p is SocialPersonRow => p !== null)
      : null;
  return { ...view, authorProfile: resolveProfileFor(state, viewerId, post.ownerId), accepted };
}

/**
 * THE REQUESTER'S OWN REQUESTS, newest first. A withdrawn one is gone; a CANCELLED one (a block crossed it) and one whose post is
 * behind a wall are absent exactly as a deleted post's requests are -- so a block reads as a deletion, never as a block. A post
 * the requester may no longer see (closed, expired, its author hidden from them) is not shown: the request reads
 * NO_LONGER_AVAILABLE while pending, and keeps its ACCEPTED or DECLINED word otherwise.
 */
export function lffRequestsMineFor(state: SocialState, viewerId: SocialUserId, nowMs: number, rowOf: LffPersonRowOf): LffMyRequests {
  const shown: { request: LffJoinRequest; post: LffPost; status: LffRequesterStatus; visible: boolean }[] = [];
  for (const request of state.lffRequests) {
    if (request.requesterId !== viewerId) continue;
    const post = lffPostById(state, request.postId);
    if (post === undefined || blockedEitherWay(state, viewerId, post.ownerId)) continue;
    const visible = postVisibleTo(state, viewerId, post, nowMs);
    const status = requesterStatus(request, post, visible, nowMs);
    if (status !== null) shown.push({ request, post, status, visible });
  }
  shown.sort((a, b) => b.request.updatedAtMs - a.request.updatedAtMs || serialOf(b.request.id) - serialOf(a.request.id));
  return {
    requests: shown.slice(0, LFF_MINE_MAX).map(({ request, post, status, visible }) => ({
      requestId: request.id,
      postId: post.id,
      status,
      message: request.message,
      createdAtIso: iso(request.createdAtMs),
      updatedAtIso: iso(request.updatedAtMs),
      post: visible ? postViewFor(state, viewerId, post, nowMs, rowOf) : null,
    })),
    truncated: shown.length > LFF_MINE_MAX,
  };
}

/**
 * THE OWNER'S INBOX FOR ONE POST: its pending and accepted requests, oldest first, never one from behind the owner's wall. The
 * owner only: anyone else is answered as a missing post. Bounded by the caps (LFF_MAX_PENDING_PER_POST + LFF_SLOTS_MAX).
 */
export function lffRequestsForPost(state: SocialState, actorId: SocialUserId, postId: string, rowOf: LffPersonRowOf): RelayResult<LffPostRequests> {
  const post = ownedPost(state, actorId, postId);
  if (post === undefined) return fail(lffNotFound());
  const requests: LffIncomingRequestView[] = [];
  for (const r of requestsOn(state, post.id, ['PENDING', 'ACCEPTED'])) {
    if (blockedEitherWay(state, actorId, r.requesterId)) continue;
    const requester = rowOf(state, actorId, r.requesterId);
    if (requester === null) continue;
    requests.push({
      requestId: r.id,
      status: r.status === 'ACCEPTED' ? 'ACCEPTED' : 'PENDING',
      message: r.message,
      createdAtIso: iso(r.createdAtMs),
      updatedAtIso: iso(r.updatedAtMs),
      requester,
    });
  }
  return ok({ postId: post.id, requests });
}
