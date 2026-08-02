import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';
import type { SafeToolActivity } from './stream-parser';

/**
 * TOOL-SCOPE AUDITOR — what the agent actually reached for.
 *
 * Relay restricts the Coding Agent to Read/Glob/Grep/Edit and pins its cwd to
 * the isolated workspace, but this CLI cannot ENFORCE a path scope on a read:
 * the permission compiler says so itself (`editPathScopingEnforced: false`),
 * and the adapter descriptor advertises edit-path-scoping as `advisory`. An
 * advisory control that nothing measures is a claim, not a boundary.
 *
 * So Relay measures it. The stream parser already records every tool target
 * the runtime reported; this module classifies each one against the workspace
 * root and reports, separately:
 *
 *   - `filesInspected` — the paths the run touched, which is evidence the
 *     live proof is required to record;
 *   - `escapes` — targets that resolve OUTSIDE the workspace, which is a
 *     containment failure the caller must stop on.
 *
 * Two honesty rules shape it. A target Relay cannot classify is an escape,
 * never a pass — an unparseable path is exactly the case an attacker would
 * aim for. And this audits what the RUNTIME REPORTED it used; it is a
 * detection boundary layered under the process-level ones (filtered
 * environment, no Bash, no network tools, cwd pinning), never a claim that
 * the read was prevented.
 */

/** Bound the recorded evidence so a noisy run cannot balloon a receipt. */
const MAX_RECORDED = 100;

export interface ScopeAuditResult {
  /** Workspace-relative paths the run reported touching. Sorted, deduped. */
  readonly filesInspected: readonly string[];
  /** Targets resolving outside the workspace — any entry fails the proof. */
  readonly escapes: readonly string[];
  /** Distinct tool names observed, in first-seen order. */
  readonly toolsUsed: readonly string[];
  /** True when nothing escaped: the only value that may pass the gate. */
  readonly contained: boolean;
}

/**
 * A glob PATTERN (Grep/Glob) is not a filesystem path: `**` and `*` never
 * resolve to a real location, so a relative pattern is recorded as inspected
 * scope rather than treated as an escape. An ABSOLUTE pattern is still
 * resolved and checked — `/etc/**` must not slip through as "just a glob".
 */
const isRelativePattern = (target: string): boolean =>
  !isAbsolute(target) && (target.includes('*') || target.includes('?'));

/**
 * Classify one reported target against the workspace root.
 * Returns the workspace-relative path when contained, or null when it escapes.
 */
export function classifyTarget(target: string, workspacePath: string): string | null {
  const trimmed = target.trim();
  // An empty or NUL-bearing target cannot be classified, so it is an escape.
  if (trimmed === '' || trimmed.includes('\0')) return null;
  // A tilde path is NOT relative. `node:path` never expands `~`, so
  // `~/.claude/.credentials.json` would otherwise resolve against the
  // workspace and be recorded as contained — the exact target this gate
  // exists to catch. Relay cannot know what a shell would expand it to, so
  // it is unclassifiable, and unclassifiable is an escape.
  if (trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return null;
  if (isRelativePattern(trimmed)) return normalize(trimmed);

  const root = resolve(workspacePath);
  const absolute = isAbsolute(trimmed) ? resolve(trimmed) : resolve(root, trimmed);
  if (absolute === root) return '.';

  const rel = relative(root, absolute);
  // `..` prefix or an absolute remainder both mean the target left the root.
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

/** Audit every reported tool target against the isolated workspace root. */
export function auditToolScope(
  activity: readonly SafeToolActivity[],
  workspacePath: string,
): ScopeAuditResult {
  const inspected = new Set<string>();
  const escapes: string[] = [];
  const toolsUsed: string[] = [];

  for (const entry of activity) {
    if (!toolsUsed.includes(entry.tool)) toolsUsed.push(entry.tool);
    for (const target of entry.targets) {
      const classified = classifyTarget(target, workspacePath);
      if (classified === null) {
        // Record the tool alongside the target so the receipt says which
        // capability reached out, not merely that something did.
        const note = `${entry.tool}: ${target}`;
        if (!escapes.includes(note) && escapes.length < MAX_RECORDED) escapes.push(note);
      } else {
        inspected.add(classified);
      }
    }
  }

  return {
    filesInspected: [...inspected].sort().slice(0, MAX_RECORDED),
    escapes,
    toolsUsed,
    contained: escapes.length === 0,
  };
}
