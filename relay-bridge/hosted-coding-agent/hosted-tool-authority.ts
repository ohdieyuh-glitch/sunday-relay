/**
 * JULIUS'S AUTHORITY OVER EVERY FILE TOOL THE HOSTED CODING AGENT CALLS.
 *
 * WHY A HOOK, AND NOT `canUseTool`. The SDK evaluates, in order: hooks, deny
 * rules, ask rules, the permission mode, allow rules, and only then the
 * `canUseTool` callback. Its documentation is explicit that "auto-approved tools
 * never reach canUseTool": the envelope's bare `allowedTools` entries (`Read`,
 * `Edit`) and its `acceptEdits` mode approve those calls long before any callback
 * is asked. A creation authority installed as `canUseTool` beside `Write` in the
 * allow list -- the first design, relay/julius-task-generality -- would therefore
 * never have been consulted. A `PreToolUse` hook runs FIRST, for every call, and
 * its deny holds in every permission mode. That is the only seam that is an
 * authority rather than a suggestion.
 *
 * WHAT IT CLOSES THAT WAS OPEN. A bare `Read` or `Edit` allow rule approves every
 * call to that tool, and `acceptEdits` only confines its OWN approvals to the
 * working directory. So the hosted agent -- a child process on the bridge host --
 * could read or edit any path its user can reach: the repository the bridge runs
 * from, the reviewer's own code, `/proc/<parent>/environ`. The child environment
 * is built from nothing so the agent holds no provider key; reading the parent's
 * environment from `/proc` would have undone that without touching the child's.
 * From now on every file tool is confined to the workspace by REAL path, so a
 * symlink planted inside the workspace cannot point a write or a read outside it.
 *
 * WHAT IT DECIDES, AND WHO DECIDES IT. The decisions are the kernel's
 * (`julius-file-creation.ts`): this module only maps a runtime's tool call --
 * which carries an ABSOLUTE `file_path`, the form Claude Code's file tools always
 * use -- onto the workspace-relative shape the kernel judges, and observes the
 * two filesystem facts the kernel may not: whether a path exists, and where it
 * really resolves.
 *
 * WHAT IT RECORDS. Every write decision, allowed ones included, and every
 * refusal of any tool; allowed reads are counted rather than listed. A record
 * names a WORKSPACE-RELATIVE path or none: a request that pointed outside the
 * workspace is recorded as outside, never by the host path it named, so the
 * record cannot leak the host's layout.
 */

import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  juliusFileCreationDecision,
  juliusFileEditDecision,
  type JuliusFileCreationPolicy,
} from '../../src/relay/mission/julius/julius-file-creation';
import { juliusWorkspaceRelativePath } from '../../src/relay/mission/julius/julius-workspace-paths';
import { HOSTED_CREATION_TOOL } from './hosted-envelope';

/** Tools that change a file that already exists. */
const EDIT_TOOLS: readonly string[] = Object.freeze(['Edit', 'MultiEdit', 'NotebookEdit']);
/** Tools that read, whose target is confined but never refused for its location inside the workspace. */
const READ_TOOLS: readonly string[] = Object.freeze(['Read', 'NotebookRead', 'LS']);
/** Search tools: a directory to search from, and a glob that must not climb out of it. */
const SEARCH_TOOLS: readonly string[] = Object.freeze(['Glob', 'Grep']);
/** Input keys that name a file or directory, for a file tool this module does not know by name. */
const PATH_KEYS: readonly string[] = Object.freeze(['file_path', 'notebook_path', 'path']);

export interface HostedToolAuthorityPolicy {
  /** Present only when the mission granted creation. Null means `Write` is refused. */
  readonly creation: JuliusFileCreationPolicy | null;
  /** The locked contract's out-of-scope paths, refused for edits as well as creations. */
  readonly outOfScope: readonly string[];
}

/** One decision, for the record. Never a host path. */
export interface HostedToolDecision {
  readonly tool: string;
  readonly allowed: boolean;
  /** The workspace-relative path, or null when the request was outside the workspace or named none. */
  readonly path: string | null;
  readonly refusal: string | null;
  readonly because: string;
}

/** The filesystem facts the authority observes. Injectable only so a test can supply a failure. */
export interface HostedToolFs {
  /** The real path of an EXISTING entry, or null when nothing is there. */
  realpath(path: string): string | null;
  /** Whether any entry, a dangling symlink included, is at the path. */
  exists(path: string): boolean;
}

export const NODE_HOSTED_TOOL_FS: HostedToolFs = Object.freeze({
  realpath: (path: string) => { try { return realpathSync.native(path); } catch { return null; } },
  exists: (path: string) => { try { lstatSync(path); return true; } catch { return false; } },
});

/** What a `PreToolUse` hook returns. `{}` is "no opinion": the envelope's own rules then apply unchanged. */
export type HostedHookOutput =
  | Record<string, never>
  | {
    readonly hookSpecificOutput: {
      readonly hookEventName: 'PreToolUse';
      readonly permissionDecision: 'deny';
      readonly permissionDecisionReason: string;
    };
  };

/**
 * THE SAME CONTAINMENT RULE AS THE SANDBOX ADAPTER'S `workspaceContained`: a
 * candidate is inside when `relative` from the root neither climbs (`..`) nor
 * crosses to another root (an absolute answer -- a different drive on Windows).
 */
const contained = (root: string, candidate: string): boolean => {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('/') && !isAbsolute(rel) && !rel.split(/[\\/]/u).includes('..'));
};

type Located =
  | { readonly inside: true; readonly relativePath: string; readonly absolute: string }
  | { readonly inside: false; readonly refusal: 'path_outside_workspace' | 'path_unreadable'; readonly because: string };

/**
 * Where a requested path REALLY is. Resolves the nearest existing ancestor and
 * appends what does not exist yet, so a file about to be created is judged by
 * where its directory really is -- a symlinked directory inside the workspace
 * that points outside it is outside.
 */
function locate(raw: unknown, root: string, fs: HostedToolFs): Located {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { inside: false, refusal: 'path_unreadable', because: 'The tool named no path.' };
  }
  const requested = raw.trim();
  // ".." IS REFUSED BEFORE ANYTHING RESOLVES IT. `resolve` collapses it
  // lexically, and the operating system does not: `link/../secret` is
  // `secret` inside the workspace to `resolve`, and the parent of wherever
  // `link` POINTS to the kernel. A decision made on the lexical answer would
  // wave through the one path that escapes.
  if (requested.split(/[\\/]+/u).includes('..')) {
    return { inside: false, refusal: 'path_outside_workspace', because: 'A path containing ".." is refused; name the file by its path inside the workspace.' };
  }
  // No lexical containment check against the RESOLVED root: comparing an
  // unresolved spelling to a resolved path is not containment in either
  // direction (a workspace reached through `/tmp` -> `/private/tmp`, or a
  // junction, would refuse every legitimate path). Only the real path decides.
  const lexical = isAbsolute(requested) || /^[A-Za-z]:/u.test(requested) ? resolve(requested) : resolve(root, requested);
  let ancestor = lexical;
  const pending: string[] = [];
  for (let guard = 0; guard < 256; guard += 1) {
    const real = fs.realpath(ancestor);
    if (real !== null) {
      const target = pending.length === 0 ? real : join(real, ...pending.reverse());
      if (!contained(root, target)) {
        return { inside: false, refusal: 'path_outside_workspace', because: 'That path resolves outside the mission workspace through a link; use a path inside it.' };
      }
      return { inside: true, relativePath: relative(root, target).split(/[\\/]+/u).join('/'), absolute: target };
    }
    // A DANGLING LINK is not a missing file: writing through it creates the file
    // wherever it points, which nothing here can see. Refused.
    if (fs.exists(ancestor)) {
      return { inside: false, refusal: 'path_outside_workspace', because: 'That path is a link whose target cannot be resolved; it is refused rather than guessed.' };
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    pending.push(ancestor.slice(parent.length).replace(/^[\\/]+/u, ''));
    ancestor = parent;
  }
  return { inside: false, refusal: 'path_unreadable', because: 'That path could not be resolved against the workspace.' };
}

/** A glob that must not climb out of the directory it searches from, nor name an absolute root. */
function unsafeGlob(pattern: unknown): string | null {
  if (pattern === undefined || pattern === null) return null;
  if (typeof pattern !== 'string') return 'A glob must be text.';
  const text = pattern.trim();
  if (text.startsWith('/') || text.startsWith('\\') || /^[A-Za-z]:/u.test(text) || text.startsWith('~')) {
    return 'A glob may not name an absolute or home-relative root; search inside the workspace.';
  }
  if (text.split(/[\\/]+/u).includes('..')) return 'A glob may not contain ".." -- it would search outside the workspace.';
  return null;
}

/**
 * THE HOOK. Installed for every hosted run, whether or not creation is granted,
 * because confinement is not an optional feature of containment.
 *
 * `workspacePath` is resolved once, before the session starts; a workspace that
 * cannot be resolved fails CLOSED -- every file tool is refused.
 */
export function juliusHostedToolAuthority(input: {
  readonly workspacePath: string;
  readonly policy: HostedToolAuthorityPolicy;
  readonly record: (decision: HostedToolDecision) => void;
  readonly fs?: HostedToolFs;
}): (hookInput: unknown, toolUseId?: string, options?: { readonly signal?: AbortSignal }) => Promise<HostedHookOutput> {
  const fs = input.fs ?? NODE_HOSTED_TOOL_FS;
  const root = fs.realpath(resolve(input.workspacePath));

  const deny = (tool: string, path: string | null, refusal: string, because: string): HostedHookOutput => {
    input.record({ tool, allowed: false, path, refusal, because });
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        // The model reads this: it says what to do differently, not only that something was refused.
        permissionDecisionReason: `${refusal}: ${because}`,
      },
    };
  };
  const allow = (tool: string, path: string, because: string, recordIt: boolean): HostedHookOutput => {
    if (recordIt) input.record({ tool, allowed: true, path, refusal: null, because });
    return {};
  };

  return async (hookInput, _toolUseId, options) => {
    const payload = (hookInput !== null && typeof hookInput === 'object' ? hookInput : {}) as Record<string, unknown>;
    const tool = typeof payload.tool_name === 'string' ? payload.tool_name : '';
    const args = (payload.tool_input !== null && typeof payload.tool_input === 'object' ? payload.tool_input : {}) as Record<string, unknown>;

    const isWrite = tool === HOSTED_CREATION_TOOL;
    const isEdit = EDIT_TOOLS.includes(tool);
    const isRead = READ_TOOLS.includes(tool);
    const isSearch = SEARCH_TOOLS.includes(tool);
    const namesPath = PATH_KEYS.some((key) => typeof args[key] === 'string');
    if (!isWrite && !isEdit && !isRead && !isSearch && !namesPath) return {};

    // A CANCELLED DISPATCH MAKES NO FURTHER CHANGE. The abort also reaches the
    // session, but a call already in flight must not land after Julius stopped it.
    if (options?.signal?.aborted === true) {
      return deny(tool, null, 'dispatch_cancelled', 'This dispatch was cancelled; no further file operation is permitted.');
    }
    if (root === null) {
      return deny(tool, null, 'workspace_unresolvable', 'The mission workspace could not be resolved, so no file operation is permitted.');
    }

    if (isSearch) {
      const glob = unsafeGlob(tool === 'Glob' ? args.pattern : args.glob);
      if (glob !== null) return deny(tool, null, 'glob_outside_workspace', glob);
      if (args.path === undefined || args.path === null || args.path === '') return allow(tool, '.', 'Searches the workspace.', false);
    }

    const raw = isWrite || isEdit || isRead ? (args.file_path ?? args.notebook_path ?? args.path) : args.path;
    const where = locate(raw, root, fs);
    if (!where.inside) return deny(tool, null, where.refusal, where.because);

    if (isWrite) {
      if (input.policy.creation === null) {
        return deny(tool, where.relativePath, 'creation_not_granted', 'This mission does not grant file creation; edit an existing file instead.');
      }
      const content = args.content;
      const bytes = typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : 0;
      const decision = juliusFileCreationDecision(
        { path: where.relativePath, bytes, exists: fs.exists(where.absolute) },
        input.policy.creation,
      );
      if (!decision.allowed) return deny(tool, where.relativePath, decision.refusal, decision.because);
      return allow(tool, decision.path, decision.overwrites ? `Permitted, replacing ${decision.path}.` : `Permitted, creating ${decision.path}.`, true);
    }
    if (isEdit) {
      const decision = juliusFileEditDecision({ path: where.relativePath }, { outOfScope: input.policy.outOfScope });
      if (!decision.allowed) return deny(tool, where.relativePath, decision.refusal, decision.because);
      return allow(tool, decision.path, `Permitted edit of ${decision.path}.`, true);
    }
    // A read or search inside the workspace, or an unknown tool naming a path
    // inside it: confined, and not otherwise judged. The spelling is still the
    // kernel's to refuse.
    const spelled = where.relativePath === '' ? { ok: true as const } : juliusWorkspaceRelativePath(where.relativePath);
    if (!spelled.ok) return deny(tool, null, spelled.refusal, spelled.because);
    return allow(tool, where.relativePath === '' ? '.' : where.relativePath, 'Inside the workspace.', false);
  };
}

/* --------------------------------------------------------------- summary */

/** What a dispatch's file tools did, as bounded scalars a diagnostics record can carry. */
export interface HostedToolAuthoritySummary {
  readonly writesAllowed: number;
  readonly writesRefused: number;
  readonly editsAllowed: number;
  readonly editsRefused: number;
  readonly othersRefused: number;
  /** The first refusal's NAME, which is a closed vocabulary -- never its text or its path. */
  readonly firstRefusal: string | null;
  /** Workspace-relative paths this dispatch was permitted to create or replace, in order. */
  readonly created: readonly string[];
}

export function summariseHostedToolDecisions(decisions: readonly HostedToolDecision[]): HostedToolAuthoritySummary {
  let writesAllowed = 0; let writesRefused = 0; let editsAllowed = 0; let editsRefused = 0; let othersRefused = 0;
  let firstRefusal: string | null = null;
  const created: string[] = [];
  for (const decision of decisions) {
    if (!decision.allowed && firstRefusal === null) firstRefusal = decision.refusal;
    if (decision.tool === HOSTED_CREATION_TOOL) {
      if (decision.allowed) { writesAllowed += 1; if (decision.path !== null && !created.includes(decision.path)) created.push(decision.path); }
      else writesRefused += 1;
    } else if (EDIT_TOOLS.includes(decision.tool)) {
      if (decision.allowed) editsAllowed += 1; else editsRefused += 1;
    } else if (!decision.allowed) {
      othersRefused += 1;
    }
  }
  return Object.freeze({ writesAllowed, writesRefused, editsAllowed, editsRefused, othersRefused, firstRefusal, created: Object.freeze(created) });
}
