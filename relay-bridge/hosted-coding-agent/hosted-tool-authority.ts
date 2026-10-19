/**
 * JULIUS'S AUTHORITY OVER EVERY FILE TOOL THE HOSTED CODING AGENT CALLS.
 *
 * WHY A HOOK, AND NOT `canUseTool`. The SDK evaluates, in order: hooks, deny
 * rules, ask rules, the permission mode, allow rules, and only then the
 * `canUseTool` callback. Its documentation is explicit that "auto-approved tools
 * never reach canUseTool": the envelope's bare `allowedTools` entries (`Read`,
 * `Edit`) and its `acceptEdits` mode approve those calls long before any callback
 * is asked. A `PreToolUse` hook runs FIRST, for every call, and its deny holds in
 * every permission mode. That is the only seam that is an authority rather than
 * a suggestion.
 *
 * WHAT IT CLOSES THAT WAS OPEN. A bare `Read` or `Edit` allow rule approves every
 * call to that tool, and `acceptEdits` only confines its OWN approvals to the
 * working directory. So the hosted agent -- a child process on the bridge host --
 * could read or edit any path its user can reach: the checkout the bridge runs
 * from, including the reviewer and the evidence scripts that run after it, and
 * `/proc/<parent>/environ`. The child environment is built from nothing so the
 * agent holds no provider key; reading the parent's environment from `/proc`
 * would have undone that without touching the child's. From now on every file
 * tool is confined to the workspace by REAL path, so a symlink or junction inside
 * the workspace cannot point a read or an edit outside it, and an edit inside it
 * is refused in a control, credential or workflow location.
 *
 * WHAT IT DECIDES, AND WHO DECIDES IT. The decisions are the kernel's
 * (`julius-file-authority.ts`): this module only maps a runtime's tool call --
 * which carries an ABSOLUTE `file_path`, the form Claude Code's file tools always
 * use -- onto the workspace-relative shape the kernel judges, and observes the
 * two filesystem facts the kernel may not: whether a path exists, and where it
 * really resolves.
 *
 * WHAT IT RECORDS. Every edit decision, allowed ones included, and every refusal
 * of any tool; allowed reads are not recorded. A record names a
 * WORKSPACE-RELATIVE path or none: a request that pointed outside the workspace
 * is recorded as outside, never by the host path it named, so neither a record
 * nor the reason the model is shown can leak the host's layout.
 */

import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  juliusFileEditDecision,
  type JuliusFileAuthorityRefusal,
} from '../../src/relay/mission/julius/julius-file-authority';
import { juliusWorkspaceRelativePath } from '../../src/relay/mission/julius/julius-workspace-paths';

/**
 * The tool that creates files. The envelope disallows it on every hosted run
 * (`HOSTED_DISALLOWED_TOOLS`); it is refused here as well, so a runtime that
 * offered it anyway would still create nothing.
 */
const CREATION_TOOL = 'Write';
/** Tools that change a file that already exists. */
const EDIT_TOOLS: readonly string[] = Object.freeze(['Edit', 'MultiEdit', 'NotebookEdit']);
/** Tools that read, whose target is confined but never refused for its location inside the workspace. */
const READ_TOOLS: readonly string[] = Object.freeze(['Read', 'NotebookRead', 'LS']);
/** Search tools: a directory to search from, and a glob that must not climb out of it. */
const SEARCH_TOOLS: readonly string[] = Object.freeze(['Glob', 'Grep']);
/**
 * Input keys that name a file or directory, in the order a file tool uses them.
 * EVERY one a call carries is located, not only the first: a call that names two
 * paths is judged by both.
 */
const PATH_KEYS: readonly string[] = Object.freeze(['file_path', 'notebook_path', 'path']);
/** A character that makes a glob segment a pattern rather than a directory name. */
const GLOB_MAGIC = /[*?[\]{}]/u;

/** One decision, for the record. Never a host path. */
export interface HostedToolDecision {
  readonly tool: string;
  readonly allowed: boolean;
  /** The workspace-relative path, or null when the request was outside the workspace or named none. */
  readonly path: string | null;
  readonly refusal: JuliusFileAuthorityRefusal | null;
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

type Inside = { readonly inside: true; readonly relativePath: string };
type Located =
  | Inside
  | { readonly inside: false; readonly refusal: 'path_outside_workspace' | 'path_unreadable'; readonly because: string };

/**
 * Where a requested path REALLY is. Resolves the nearest existing ancestor and
 * appends what does not exist yet, so a path is judged by where its directory
 * really is -- a symlinked directory inside the workspace that points outside it
 * is outside.
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
        return { inside: false, refusal: 'path_outside_workspace', because: 'That path resolves outside the mission workspace; use a path inside it.' };
      }
      return { inside: true, relativePath: relative(root, target).split(/[\\/]+/u).join('/') };
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

/**
 * WHETHER A GLOB SEARCHES ONLY THE WORKSPACE. A relative pattern is searched from
 * the workspace, or from the call's own `path`, which is located like any other.
 * An ABSOLUTE pattern is judged by its literal leading directories, which must
 * really be inside the workspace: a model that writes `<workspace>/src/**` is
 * searching the workspace, and refusing it would spend a paid turn on nothing.
 * `..` and a home-relative root are refused outright.
 */
function globRefusal(pattern: unknown, root: string, fs: HostedToolFs): string | null {
  if (pattern === undefined || pattern === null) return null;
  if (typeof pattern !== 'string') return 'A glob must be text.';
  const text = pattern.trim();
  if (text.startsWith('~')) return 'A glob may not name a home-relative root; search inside the workspace.';
  if (text.split(/[\\/]+/u).includes('..')) return 'A glob may not contain ".." -- it would search outside the workspace.';
  if (!(text.startsWith('/') || text.startsWith('\\') || /^[A-Za-z]:/u.test(text))) return null;
  const magic = text.search(GLOB_MAGIC);
  // The directories before the first pattern character, without the partial segment it sits in.
  const literal = magic < 0 ? text : text.slice(0, magic).replace(/[^\\/]*$/u, '');
  const where = locate(literal === '' ? text : literal, root, fs);
  return where.inside ? null : 'A glob may not search outside the workspace; use a pattern relative to it.';
}

/**
 * THE HOOK. Installed on EVERY hosted run, because confining the agent to its
 * workspace is containment, not an option a caller may forget.
 *
 * `workspacePath` is resolved once, before the session starts; a workspace that
 * cannot be resolved fails CLOSED -- every file tool is refused.
 */
export function juliusHostedToolAuthority(input: {
  readonly workspacePath: string;
  /** Where decisions go. Absent, none is kept -- a refusal still reaches the model. */
  readonly record?: (decision: HostedToolDecision) => void;
  /**
   * The RUN's own cancellation, beside the signal the SDK hands each hook call,
   * so a stopped or timed-out dispatch is refused whichever of the two a runtime
   * version propagates.
   */
  readonly signal?: AbortSignal;
  readonly fs?: HostedToolFs;
}): (hookInput: unknown, toolUseId?: string, options?: { readonly signal?: AbortSignal }) => Promise<HostedHookOutput> {
  const fs = input.fs ?? NODE_HOSTED_TOOL_FS;
  const root = fs.realpath(resolve(input.workspacePath));
  const record = input.record ?? (() => undefined);

  const deny = (tool: string, path: string | null, refusal: JuliusFileAuthorityRefusal, because: string): HostedHookOutput => {
    record({ tool, allowed: false, path, refusal, because });
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        // The model reads this: it says what to do differently, not only that something was refused.
        permissionDecisionReason: `${refusal}: ${because}`,
      },
    };
  };

  return async (hookInput, _toolUseId, options) => {
    const payload = (hookInput !== null && typeof hookInput === 'object' ? hookInput : {}) as Record<string, unknown>;
    const tool = typeof payload.tool_name === 'string' ? payload.tool_name : '';
    const args = (payload.tool_input !== null && typeof payload.tool_input === 'object' ? payload.tool_input : {}) as Record<string, unknown>;

    const isWrite = tool === CREATION_TOOL;
    const isEdit = EDIT_TOOLS.includes(tool);
    const isRead = READ_TOOLS.includes(tool);
    const isSearch = SEARCH_TOOLS.includes(tool);
    const named = PATH_KEYS.filter((key) => typeof args[key] === 'string');
    if (!isWrite && !isEdit && !isRead && !isSearch && named.length === 0) return {};

    // A CANCELLED DISPATCH MAKES NO FURTHER CHANGE. The abort also reaches the
    // session, but a call already in flight must not land after Julius stopped it.
    if (options?.signal?.aborted === true || input.signal?.aborted === true) {
      return deny(tool, null, 'dispatch_cancelled', 'This dispatch was cancelled; no further file operation is permitted.');
    }
    if (root === null) {
      return deny(tool, null, 'workspace_unresolvable', 'The mission workspace could not be resolved, so no file operation is permitted.');
    }

    if (isSearch) {
      const glob = globRefusal(tool === 'Glob' ? args.pattern : args.glob, root, fs);
      if (glob !== null) return deny(tool, null, 'glob_outside_workspace', glob);
    }

    // EVERY PATH THE CALL NAMES, BY WHERE IT REALLY IS. One outside refuses the call.
    const located: Inside[] = [];
    for (const key of named) {
      const where = locate(args[key], root, fs);
      if (!where.inside) return deny(tool, null, where.refusal, where.because);
      located.push(where);
    }
    // Inside is necessary, not sufficient: the spelling is still the kernel's to
    // refuse -- `~/x` resolved against the workspace lands inside it, and is
    // still not a workspace path.
    for (const where of located) {
      if (where.relativePath === '') continue;
      const spelled = juliusWorkspaceRelativePath(where.relativePath);
      if (!spelled.ok) return deny(tool, null, spelled.refusal, spelled.because);
    }

    if (isWrite || isEdit || isRead) {
      // A file tool acts on the first path it names; one that named none cannot be judged.
      const target = located[0];
      if (target === undefined) return deny(tool, null, 'path_unreadable', 'The tool named no path.');
      if (isWrite) {
        return deny(tool, target.relativePath, 'creation_not_granted', 'This mission does not grant file creation; edit an existing file instead.');
      }
      if (isEdit) {
        const decision = juliusFileEditDecision({ path: target.relativePath });
        if (!decision.allowed) return deny(tool, target.relativePath, decision.refusal, decision.because);
        record({ tool, allowed: true, path: decision.path, refusal: null, because: `Permitted edit of ${decision.path}.` });
        return {};
      }
    }
    // A read or a search inside the workspace, or another tool naming paths
    // inside it: confined, and not otherwise judged.
    return {};
  };
}
