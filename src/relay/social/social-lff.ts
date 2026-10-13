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
 *      as a missing post -- and ENDS the live requests it crosses (social-friends.ts blockUser). Each side is then shown, and
 *      TOLD, exactly what the ordinary change it imitates shows and tells (SEC-M2: silence was itself the tell): to the owner the
 *      request reads as withdrawn and the owner is told lff.request.withdraw; to the requester the post reads as deleted and they
 *      are told lff.post.delete (lffBlockNotices, sent by blocks.add past the block floor). Nothing names the block.
 *      WHEN THE REQUESTER IS THE BLOCKER the request is STORED as WITHDRAWN (SEC m-a): it is then a withdrawal in every respect,
 *      the re-request cooldown included, so an owner cannot tell a lifted block from a withdrawal by how soon the requester asks
 *      again. WHEN THE OWNER IS THE BLOCKER it is CANCELLED (no cooldown: a cooldown there would tell the requester they were
 *      blocked, since to them the post was "deleted").
 *   3. A POST IS SHOWN ONLY TO A VIEWER WHO MAY SEE ITS AUTHOR (SEC-M1, SEC-M4/CORR-M2; decision D-L3 = do not list): the presence
 *      audience the author chose (presenceVisibility -- the presence authority's own "may this viewer see this person") must
 *      admit the viewer, and no block may stand either way. Otherwise the post is ABSENT, answered as a missing post. There is no
 *      anonymous listing: every visible post names its author, so any viewer can report it through the existing flow,
 *      reports.file {reportedId: author.userId, subjectRef: postId}. APPEAR_OFFLINE is not asked about: it reads exactly as signed
 *      out (the presence authority's M1 rule), so it never hides a post -- hiding it would tell friends "online and hiding".
 *   4. THE GENERAL FEED IS OPEN POSTS ONLY (SEC-M3). A CLOSED or EXPIRED post is shown only to its owner (their `mine` list, and by
 *      id) and to the users accepted on it; to anyone else it is absent.
 *   5. CAPS (all PROPOSED, decision D-L2): open posts per owner; posts CREATED per rolling 24 hours, closed and deleted ones counted
 *      (lffCreations), so close-and-repost cannot flood; pending requests out per player and per post; a cooldown before a
 *      player who withdrew from a post may ask it again; and a longer one after their request to it was DECLINED (SEC m-c).
 *   6. LFF GRANTS NOTHING. No repository, private server, agent, WonderFS, Project Brain or voice is reached from here: the
 *      imports below are the whole list (social-lff-privacy.test.ts walks the real graph), and an accept changes only the request
 *      row (and, when it fills the post, the post's status).
 *   7. RETENTION (PROPOSED, the B2b review's m3): a post that is no longer open and was created more than LFF_RETENTION_MS ago
 *      (30 days, 037's sanity bound on a post's whole life) is HARD-DELETED with every request on it, by the LFF writes that carry
 *      the server's time, at most LFF_PURGE_BATCH posts per write (purgeLffPastRetention). It is nobody's act, so it tells nobody.
 *      The creation record keeps its own 24 h prune (createLffPost). An EVIDENCE post is never purged: it is HELD (rule 8).
 *   8. A REPORTED POST IS MODERATION EVIDENCE (founder D-L5, contract r2.4 R-1..R-5). A report (reports.file, the existing flow)
 *      MAKES A POST EVIDENCE only when, at the moment it is filed (recordLffReport; MAIN's DEFAULT for the founder's FQ-1, flagged
 *      to the founder, not final): (a) its reportedId is the post's owner, (b) the post exists and the report is filed no earlier
 *      than the post was created (a report of an id not yet minted counts for nothing), and (c) the reporter may see the post
 *      (postVisibleTo, the feed's and get's own rule: a walled, hidden-from or never-shown reporter's report holds nothing). Any
 *      other report is still filed exactly as before, for moderators to read; it just holds nothing. A post becomes evidence ONCE,
 *      and that is recorded as its first SNAPSHOT: the post as it read when that report was filed (REPORTED, naming the report).
 *      Every later edit of it appends another (EDITED), so the content that was reported is never lost to an edit (MAIN r2, the
 *      security review's M-1). Snapshots are append-only, silent and read by no player surface (lffSnapshots).
 *      An evidence post is never deleted by any app path: the owner's delete (R-2) and the retention purge (R-1), reported or not
 *      when it ended, HOLD it instead -- it leaves lffPosts and its requests leave lffRequests exactly as a deletion takes them, so
 *      every rule, view, count and event reads a held post EXACTLY as a deleted one and no player surface can tell the two apart
 *      (R-3); the post as last written and every request on it (the accepted list included) move to lffHeld, which no player
 *      surface reads (removeLffPosts). The persistence keeps the rows, marked held (037's held_at), and authorized moderators --
 *      database operators until the founder names a role and a surface -- read them through 037's view
 *      relay_wonderland.lff_moderation_evidence (R-4); no route serves them. An OPEN reported post stays visible (R-5, rule 5).
 * No counts or rosters leak: how many have been accepted is the owner's alone (availableSlots); the accepted list is shown to the
 * owner, and to an accepted user with only the co-accepted they may see (rule 3's test, person by person); pending requests are
 * listed to the owner only; and the post a fill closes is told to the others as an ordinary close, never as an accept.
 *
 * TIME IS THE SERVER'S: every rule takes the server's `nowMs` (the store's clock, through applySocialOperation). EXPIRED is
 * never stored; it is READ (lffPostStatusAt), as party invites expire at read. `updatedAtMs` never moves backwards (a stepped-back
 * clock): a write stamps the later of the server's time and the row's own updatedAtMs. ORDER never depends on array order: every list is sorted explicitly (time, then the
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
import type { SocialOperationId, SocialReport, SocialUserId, UserProfileView } from './social-contracts';
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
 * A request as stored. CANCELLED is a request the OWNER's block crossed (social-friends.ts blockUser): it stays cancelled after an
 * unblock, as a cancelled friend request and a revoked party invite do, and it is shown to nobody. A request the REQUESTER's block
 * crossed is stored WITHDRAWN instead (rule 2, SEC m-a): exactly the row their own withdrawal would leave. There is no request
 * version (MAIN r2, CORR-M1: 037 drops the column).
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
/**
 * PROPOSED (MAIN r2, SEC m7): a player who withdrew from a post may ask it again only this long after the withdrawal. A requester's
 * own block stores a withdrawal (rule 2), so the same wait follows lifting it.
 */
export const LFF_REREQUEST_COOLDOWN_MS = 10 * 60_000;
/**
 * PROPOSED (SEC m-c): a player whose request to a post was DECLINED may ask it again only this long after the decline (at exactly
 * this long, they may). It reveals nothing: the requester is already shown DECLINED.
 */
export const LFF_DECLINE_COOLDOWN_MS = 60 * 60_000;
/**
 * PROPOSED (the B2b review's m3): a post no longer open is kept until it is this old (from its creation), then purged with its
 * requests. 30 days is 037's sanity bound on a post's life (lff_posts_times: expires_at at most 30 days after created_at), so a
 * post past it is past every expiry the schema admits. Exactly 30 days old it is kept; 1 ms older it is due.
 */
export const LFF_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** PROPOSED (m3): at most this many posts are purged by one write, oldest first; the rest wait for the next write. */
export const LFF_PURGE_BATCH = 50;

/** Field bounds (contract, "Post fields"), in CODE POINTS after the trim -- what PostgreSQL's char_length counts (never UTF-16 units). */
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
 * (owner_id, post_id, created_at), PRIMARY KEY (owner_id, post_id) (037, MAIN). Bounded: entries older than the window are
 * pruned on every create, and the cap stops anyone holding more than LFF_MAX_CREATED_PER_WINDOW inside it.
 */
export interface LffCreation {
  readonly userId: SocialUserId;
  /** The created post's id (`lffp_<serial>`), kept after the post is closed or deleted. */
  readonly postId: string;
  readonly atMs: number;
}

/**
 * ONE HELD POST: MODERATION EVIDENCE (rule 8, founder D-L5). An evidence post its owner deleted, or that retention reached, exactly
 * as it was last written, with every request on it in any status (the accepted list included), as they were at that moment.
 * Persisted as the same relay_wonderland.lff_posts / lff_join_requests rows, the post's held_at set (037), and never written again.
 * No player surface reads it: to every player it is a deleted post.
 */
export interface LffHeldPost {
  readonly post: LffPost;
  /** Every request on the post when it was held, in the order the state held them. */
  readonly requests: readonly LffJoinRequest[];
  /** The server's time of the delete or the purge that held it; never before the post's own updatedAtMs (a stepped-back clock). */
  readonly heldAtMs: number;
}

/** Why an evidence snapshot was taken (rule 8): the report that made the post evidence, or an edit after it. */
export const LFF_SNAPSHOT_CAUSES = ['REPORTED', 'EDITED'] as const;
export type LffSnapshotCause = (typeof LFF_SNAPSHOT_CAUSES)[number];

/**
 * ONE EVIDENCE SNAPSHOT (rule 8; MAIN r2, the security review's M-1): the post exactly as it read when the report that made it
 * evidence was filed (seq 1, REPORTED, naming that report), or right after a later edit of it (seq 2, 3, ..., EDITED). Persisted as
 * relay_wonderland.lff_post_snapshots (037), keyed (post_id, seq) -- no id is minted, so a snapshot moves no serial a player could
 * see. Append-only: the app never changes or removes one. No player surface reads it.
 */
export interface LffPostSnapshot {
  readonly postId: string;
  readonly seq: number;
  readonly cause: LffSnapshotCause;
  /** The report that made the post evidence (seq 1); null for an edit's snapshot. */
  readonly reportId: string | null;
  /** The server's time of the report or the edit; never before the post's updatedAtMs as captured. */
  readonly capturedAtMs: number;
  /** The post as it read at that moment, every field. */
  readonly post: LffPost;
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

/**
 * A post due for retention at `nowMs` (rule 7): created MORE than LFF_RETENTION_MS ago AND no longer open (CLOSED or EXPIRED, read
 * at `nowMs`). Exactly LFF_RETENTION_MS old it is kept. One stamped after `nowMs` (a stepped-back clock) is never due.
 */
const pastRetention = (post: LffPost, nowMs: number): boolean => nowMs - post.createdAtMs > LFF_RETENTION_MS && lffPostStatusAt(post, nowMs) !== 'OPEN';

/**
 * WHETHER A POST IS EVIDENCE (rule 8): a report that qualified when it was filed made it so, and that is recorded as the post's
 * first snapshot (recordLffReport). Read from the server's state at the moment of the delete or the purge, so a report filed after
 * the post closed counts -- if its reporter could still see the post then (the owner, or a user accepted on it).
 */
export const lffPostReported = (state: SocialState, postId: string): boolean => state.lffSnapshots.some((s) => s.postId === postId);

/** Held posts in one order whatever order they were held in: by the post id's serial (the order a store reads its rows back in). */
const bySerial = (a: LffHeldPost, b: LffHeldPost): number => serialOf(a.post.id) - serialOf(b.post.id);

/** Snapshots in one order whatever order they were taken in: by the post id's serial, then seq (a store's read-back order). */
const snapshotOrder = (a: LffPostSnapshot, b: LffPostSnapshot): number => serialOf(a.postId) - serialOf(b.postId) || a.seq - b.seq;

const withSnapshot = (state: SocialState, snapshot: LffPostSnapshot): SocialState => ({
  ...state,
  lffSnapshots: [...state.lffSnapshots, snapshot].sort(snapshotOrder),
});

/**
 * A REPORT, FILED (reports.file): does it make a post EVIDENCE? (rule 8; MAIN's DEFAULT for the founder's FQ-1, flagged, not
 * final.) Only a report naming a post as its subjectRef that, at this moment: (a) names the post's OWNER as reportedId, (b) is filed
 * no earlier than the post was created (a pre-report of an id not yet minted names no post here, and a stepped-back clock cannot
 * date one earlier), and (c) comes from a reporter who may see the post (postVisibleTo: the feed's and get's own rule). Then, once
 * per post, the post as it reads now is snapshotted (seq 1, REPORTED, naming the report); a later report adds nothing (every edit
 * since is snapshotted as it happens). Anything else returns the SAME state: the report is filed as before and holds nothing.
 * SILENT: the caller's answer, audience and events are the same either way, so no reporter learns whether their report counted.
 */
export function recordLffReport(state: SocialState, report: SocialReport, nowMs: number): SocialState {
  if (report.subjectRef === null) return state;
  const post = lffPostById(state, report.subjectRef);
  if (post === undefined || report.reportedId !== post.ownerId || nowMs < post.createdAtMs) return state;
  if (!postVisibleTo(state, report.reporterId, post, nowMs)) return state;
  if (lffPostReported(state, post.id)) return state;
  return withSnapshot(state, { postId: post.id, seq: 1, cause: 'REPORTED', reportId: report.reportId, capturedAtMs: Math.max(nowMs, post.updatedAtMs), post });
}

/**
 * THE ONE WAY A POST LEAVES THE STATE (the owner's delete, the retention purge). Every post in `gone` leaves lffPosts and every
 * request on it leaves lffRequests -- for EVERY post alike, evidence or not, so what any player can be shown afterwards does not
 * depend on reports (R-3). An EVIDENCE post is not lost (R-1, R-2): the post as last written, with every request on it, moves to
 * lffHeld, stamped with the server's time (never before its own updatedAtMs); any other is gone. Its snapshots stay as they are.
 * Lists nothing moved in are kept as the same objects (a store's by-reference diff then writes nothing for them).
 */
function removeLffPosts(state: SocialState, gone: ReadonlySet<string>, nowMs: number): SocialState {
  const evidence = new Set(state.lffSnapshots.map((s) => s.postId));
  const held: LffHeldPost[] = state.lffPosts
    .filter((p) => gone.has(p.id) && evidence.has(p.id))
    .map((post) => ({ post, requests: state.lffRequests.filter((r) => r.postId === post.id), heldAtMs: Math.max(nowMs, post.updatedAtMs) }));
  const requestsGo = state.lffRequests.some((r) => gone.has(r.postId));
  return {
    ...state,
    lffPosts: state.lffPosts.filter((p) => !gone.has(p.id)),
    lffRequests: requestsGo ? state.lffRequests.filter((r) => !gone.has(r.postId)) : state.lffRequests,
    lffHeld: held.length === 0 ? state.lffHeld : [...state.lffHeld, ...held].sort(bySerial),
  };
}

/**
 * RETENTION (rule 7, PROPOSED; the B2b review's m3): the posts due at `nowMs` leave the state with every request on them, oldest
 * first (creation time, then serial), at most LFF_PURGE_BATCH per call; the rest wait for the next write. A post that is not
 * evidence is HARD-DELETED; an EVIDENCE one (rule 8: a qualifying report) is HELD instead, whatever its age or status (R-1), and to
 * every player it reads exactly as a purged one. The creation record is not touched (it is pruned after 24 h by createLffPost). Nothing due: the SAME
 * state object, so a store's by-reference diff sees no change. Run by every LFF write that carries the server's time, AFTER its own
 * rule (so the operation itself answers exactly as before), never by a refusal. A purge is nobody's act and tells nobody: like
 * expiry, it is the server's time passing.
 */
export function purgeLffPastRetention(state: SocialState, nowMs: number): SocialState {
  const due = state.lffPosts.filter((p) => pastRetention(p, nowMs));
  if (due.length === 0) return state;
  return removeLffPosts(state, new Set(due.sort(oldestFirst).slice(0, LFF_PURGE_BATCH).map((p) => p.id)), nowMs);
}

/** A successful LFF write, then the retention batch (rule 7) at the same server time. */
const retained = <C extends { readonly state: SocialState }>(change: C, nowMs: number): C => ({ ...change, state: purgeLffPastRetention(change.state, nowMs) });

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
  return ok(retained({ state: { ...minted.state, lffPosts: [...minted.state.lffPosts, post], lffCreations: creations }, postId: post.id, told: [actorId] }, nowMs));
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
  const edited = bumped(post, fields, nowMs);
  // AN EVIDENCE POST'S EDIT IS SNAPSHOTTED (rule 8, M-1), silently: the answer, the people told and every view are the same
  const taken = state.lffSnapshots.filter((s) => s.postId === post.id);
  const next = taken.length === 0
    ? replacePost(state, edited)
    : withSnapshot(replacePost(state, edited), { postId: post.id, seq: Math.max(...taken.map((s) => s.seq)) + 1, cause: 'EDITED', reportId: null, capturedAtMs: edited.updatedAtMs, post: edited });
  return ok(retained({ state: next, told: [actorId], notices: fills ? closeNotices(liveRequesters(state, post.id)) : [] }, nowMs));
}

/** CLOSE a post: the owner only, OPEN only. Everyone with a live request on it is told (their request no longer leads anywhere). */
export function closeLffPost(state: SocialState, actorId: SocialUserId, postId: string, nowMs: number): RelayResult<LffChange> {
  const post = ownedPost(state, actorId, postId);
  if (post === undefined) return fail(lffNotFound());
  if (lffPostStatusAt(post, nowMs) !== 'OPEN') return fail(relayError('illegal-transition', 'this post is not open'));
  return ok(retained({ state: replacePost(state, bumped(post, { status: 'CLOSED' }, nowMs)), told: [actorId, ...liveRequesters(state, post.id)] }, nowMs));
}

/**
 * DELETE a post: the owner only, in any status. The post and every request to it are gone, for every player, the owner included:
 * a HARD delete -- unless a report made the post evidence (rule 8), when it is HELD instead (rule 8, R-2). The answer, the
 * people told and every later view are the same either way (R-3). Its clock only stamps a hold: it runs no retention batch (rule 7).
 */
export function deleteLffPost(state: SocialState, actorId: SocialUserId, postId: string, nowMs: number): RelayResult<LffChange> {
  const post = ownedPost(state, actorId, postId);
  if (post === undefined) return fail(lffNotFound());
  return ok({ state: removeLffPosts(state, new Set([post.id]), nowMs), told: [actorId, ...liveRequesters(state, post.id)] });
}

/**
 * ASK TO JOIN a post. Refused: for a post the actor may not see (missing, walled, its author hidden from them, closed or expired)
 * as one answer, lffNotFound; on one's own post; on a post that is not open; while a request of one's own to it is pending or
 * accepted; within LFF_REREQUEST_COOLDOWN_MS of withdrawing from it (a withdrawal by one's own block included); within
 * LFF_DECLINE_COOLDOWN_MS of its owner declining one's request to it; past the player's and the post's pending caps.
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
  if (mine.some((r) => r.status === 'DECLINED' && nowMs - r.updatedAtMs < LFF_DECLINE_COOLDOWN_MS)) {
    return fail(relayError('illegal-transition', `your request to this post was declined: you can ask again ${LFF_DECLINE_COOLDOWN_MS / 60_000} minutes after`));
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
  return ok(retained({ state: { ...minted.state, lffRequests: [...minted.state.lffRequests, request] }, requestId: request.id, told: [actorId, post.ownerId] }, nowMs));
}

/** WITHDRAW one's own pending or accepted request (leaving a post one was accepted on frees the slot). The requester only. */
export function withdrawLffRequest(state: SocialState, actorId: SocialUserId, requestId: string, nowMs: number): RelayResult<LffChange> {
  const found = ownRequest(state, actorId, requestId);
  if (found === undefined) return fail(lffNotFound());
  return ok(retained({ state: resolveRequest(state, found.request, 'WITHDRAWN', nowMs), told: [actorId, found.post.ownerId] }, nowMs));
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
  if (!filled) return ok(retained({ state: accepted, told: [actorId, request.requesterId], closed: false }, nowMs));
  const others = liveRequesters(accepted, post.id).filter((id) => id !== request.requesterId);
  return ok(retained({ state: replacePost(accepted, bumped(post, { status: 'CLOSED' }, nowMs)), told: [actorId, request.requesterId], notices: closeNotices(others), closed: true }, nowMs));
}

/** DECLINE a pending request: the post's owner only, whatever the post's status. */
export function declineLffRequest(state: SocialState, actorId: SocialUserId, requestId: string, nowMs: number): RelayResult<LffChange> {
  const found = incomingPending(state, actorId, requestId);
  if (found === undefined) return fail(lffNotFound());
  return ok(retained({ state: resolveRequest(state, found.request, 'DECLINED', nowMs), told: [actorId, found.request.requesterId] }, nowMs));
}

/**
 * WHAT A BLOCK'S CANCELLATIONS MUST TELL (rule 2, SEC-M2), one notice per request the block moved from live to ended -- WITHDRAWN
 * when the requester blocked, CANCELLED when the owner did (social-friends.ts blockUser) -- in request order: the blocker is the
 * actor and is told the block as always; the OTHER side is told the ordinary change it now sees -- an owner whose requester blocked
 * them, a withdrawal (lff.request.withdraw); a requester whose owner blocked them, a deletion of that post (lff.post.delete).
 * blocks.add sends these past the block floor (they are addressed across it on purpose). `before` and `after` are the block's own
 * states, so every live request that ends between them is one the block ended.
 * ONE TIME, A FIXED ORDER (SEC m-b, ACCEPTED and documented rather than changed): a block that ends two or more requests (or also
 * ends a friendship or a party) gives the far side two or more events at the block's one server time, with consecutive sequence
 * numbers, where the ordinary changes they imitate would usually come at separate times. Their ORDER is deterministic (request
 * creation time, then serial; then the block's own event, as both stores write them), so nothing varies between stores or runs;
 * what remains is the narrow "several at one instant" pattern, which needs two or more crossings between the same two people.
 * Separate times would need a clock per notice that no store has; that is a store change, not a rule, and is not made for Alpha.
 */
export function lffBlockNotices(before: SocialState, after: SocialState, actorId: SocialUserId): LffNotice[] {
  const notices: LffNotice[] = [];
  const cancelled = after.lffRequests
    .filter((r) => {
      if (r.status !== 'CANCELLED' && r.status !== 'WITHDRAWN') return false;
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
 * THE REQUESTER'S OWN REQUESTS, newest first. A withdrawn one is gone (one their own block ended is stored withdrawn); a CANCELLED
 * one (the owner's block crossed it) and one whose post is behind a wall are absent exactly as a deleted post's requests are -- so a
 * block reads as a deletion, never as a block. A post
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
