/**
 * WONDERFS: WHAT A PLAYER'S DESKTOP SESSION MAY CALL -- one table, least privilege (contract r1.4 §8.2, §17; the routes plan §2).
 *
 * The same `native_social` session the desktop client's own sign-in mints (browser-session/grants.ts: the bridge-verified GitHub
 * device flow, `ghu-<id>`, 8 h, memory-only) is admitted here holding ONE capability of its own, `wonderfs`. That capability admits
 * exactly the operations in WONDERFS_OPERATIONS -- method and an ANCHORED path pattern, every line one a reviewer can read -- and
 * nothing else under any prefix. It is the shape of founder decision A for social (wonderland-social-scope.ts l.4-7), applied to a
 * second capability without a second identity system.
 *
 * R1 = READS ONLY. Writes (blob upload, commit) are R2 and are appended here then. NOT in R1, on purpose:
 *   - the change feed (`changes`, plan H8) and the conflict list / record (H10): one commit or conflict record can exceed the
 *     contract's 1 MiB page and the client's 2 MiB cap (REVIEW_WONDERFS_R0B MAJOR-1, C2); they wait for contract r1.5;
 *   - long-poll (`wait` > 0, R4), snapshots and presence (R4), project create / delete / members (R3), every agent route (A1-A5).
 *
 * IDS ONLY IN PATHS (plan §2): a file PATH never travels in a URL or a query string, so a file is addressed by its stable id.
 * Every id segment is anchored: a project as grants.ts PROJECT_ID_PATTERN, a file id as the engine's ids, a blob as 64 lowercase
 * hex. Any path holding '..', '%' or '//' is refused before the table is read (as wonderland-social-scope.ts l.125).
 * Only `main`'s tree, files and content are listed for a human in R1: agent branches belong to the agent phase. H7 (a blob by its
 * address) is wider by design: it serves a blob that ANYTHING of the project names -- a version, an entry or a fork base on any
 * branch, or a retained conflict -- which §8.2 allows an editor (R1 security MINOR-3). Before A1 creates mission branches, record
 * whether a human may fetch an unmerged mission branch's bytes by address.
 */

export const NATIVE_WONDERFS_CAPABILITY = 'wonderfs' as const;

export const WONDERFS_ROUTE_PREFIX = '/wonderfs';

export type WonderfsOperationId = 'projects.list' | 'project.read' | 'tree.read' | 'file.history' | 'file.content' | 'blob.read' | 'events.read';

/** The query keys an operation reads; any other key is refused (400), so a misspelt cursor never silently restarts a listing. */
export type WonderfsQueryKey = 'after' | 'before' | 'limit' | 'rev' | 'wait';

export interface WonderfsOperation {
  readonly id: WonderfsOperationId;
  readonly method: 'GET';
  /** Anchored; its capture groups are the ids named in `params`, in order. */
  readonly pattern: RegExp;
  readonly template: string;
  readonly params: readonly ('projectId' | 'fileId' | 'sha256')[];
  readonly query: readonly WonderfsQueryKey[];
  /**
   * What the caller's role in the project must allow (§8.2's table, through `authorizeHuman`), read NOW, per request. `null`: the
   * operation names no project (H1 lists the caller's OWN memberships, so there is nothing to authorize against).
   */
  readonly action: 'read' | null;
  /** The routes plan's id and the contract clause it serves, for a reviewer. */
  readonly plan: string;
  readonly contract: string;
}

/** grants.ts PROJECT_ID_PATTERN, as a capture group. */
const PROJECT = '([A-Za-z0-9][A-Za-z0-9._:-]{0,127})';
/** The engine's id format (wonderfs-engine.ts ID_RE): files, branches, conflicts, snapshots. */
const FILE = '([A-Za-z0-9_.:-]{1,128})';
const SHA256 = '([0-9a-f]{64})';
const route = (path: string): RegExp =>
  new RegExp(`^${WONDERFS_ROUTE_PREFIX}/v1${path.replace(':project', PROJECT).replace(':file', FILE).replace(':sha256', SHA256)}$`, 'u');

/** THE TABLE. Anything not here is refused (403), whatever its prefix. */
export const WONDERFS_OPERATIONS: readonly WonderfsOperation[] = Object.freeze([
  { id: 'projects.list', method: 'GET', template: '/v1/projects', pattern: route('/projects'), params: [], query: ['after', 'limit'], action: null, plan: 'H1', contract: '§8.2 (project_members), §9.1' },
  { id: 'project.read', method: 'GET', template: '/v1/projects/:project', pattern: route('/projects/:project'), params: ['projectId'], query: [], action: 'read', plan: 'H4', contract: '§6.1, §11, §19.M7' },
  { id: 'tree.read', method: 'GET', template: '/v1/projects/:project/branches/main/tree', pattern: route('/projects/:project/branches/main/tree'), params: ['projectId'], query: ['rev', 'after', 'limit'], action: 'read', plan: 'H5', contract: '§6.1 tree(branch, rev?)' },
  { id: 'file.history', method: 'GET', template: '/v1/projects/:project/branches/main/files/:file', pattern: route('/projects/:project/branches/main/files/:file'), params: ['projectId', 'fileId'], query: ['before', 'limit'], action: 'read', plan: 'H6', contract: '§6.1 file(file_id) + paged history' },
  { id: 'file.content', method: 'GET', template: '/v1/projects/:project/branches/main/files/:file/content', pattern: route('/projects/:project/branches/main/files/:file/content'), params: ['projectId', 'fileId'], query: ['rev'], action: 'read', plan: 'H6 + H7', contract: '§6.1 blob(sha256), Range' },
  { id: 'blob.read', method: 'GET', template: '/v1/projects/:project/blobs/:sha256', pattern: route('/projects/:project/blobs/:sha256'), params: ['projectId', 'sha256'], query: [], action: 'read', plan: 'H7', contract: '§6.1 blob(sha256), Range; §9.1' },
  { id: 'events.read', method: 'GET', template: '/v1/projects/:project/events', pattern: route('/projects/:project/events'), params: ['projectId'], query: ['after', 'limit', 'wait'], action: 'read', plan: 'H9 (wait=0)', contract: '§7 D-5 events(project, after_seq)' },
]);

/** What the table needs of a verified session. */
export interface WonderfsSessionCapabilities {
  /** The player the session was minted for: the ONLY actor it can ever be. */
  readonly participantId: string | null;
  readonly capabilities: readonly string[];
}

export interface WonderfsAdmitted {
  readonly op: WonderfsOperation;
  readonly projectId: string | null;
  readonly fileId: string | null;
  readonly sha256: string | null;
}

/**
 * MAY THIS SESSION CALL THIS? The operation and the ids it names, or null. Refused unless the session is bound to a player and
 * holds `wonderfs`, and the path (no query string) is exactly one operation's: no '..', '%' or '//', no trailing slash, no prefix
 * match.
 */
export function wonderfsMayCall(method: string, pathname: string, session: WonderfsSessionCapabilities): WonderfsAdmitted | null {
  if (session.participantId === null || !session.capabilities.includes(NATIVE_WONDERFS_CAPABILITY)) return null;
  if (pathname.includes('..') || pathname.includes('%') || pathname.includes('//')) return null;
  for (const op of WONDERFS_OPERATIONS) {
    if (op.method !== method) continue;
    const m = op.pattern.exec(pathname);
    if (m === null) continue;
    const named = (key: 'projectId' | 'fileId' | 'sha256'): string | null => {
      const at = op.params.indexOf(key);
      return at < 0 ? null : m[at + 1] ?? null;
    };
    return { op, projectId: named('projectId'), fileId: named('fileId'), sha256: named('sha256') };
  }
  return null;
}

/** Whether a path (without /relay-api; a query string allowed) is WonderFS's: the whole `/wonderfs` family, so nothing else answers it. */
export function isWonderfsRoute(path: string): boolean {
  const pathname = path.split('?')[0];
  return pathname === WONDERFS_ROUTE_PREFIX || pathname.startsWith(`${WONDERFS_ROUTE_PREFIX}/`);
}
