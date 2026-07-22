import type { CleanupPolicy, RelayWorkspace, WorkspaceStatus } from './contracts';

/**
 * Conservative cleanup decisions (Prompt 7) — PURE. Removal ALWAYS
 * requires explicit authorization; the policy can only make preservation
 * stricter, never looser. Failure, checkpoint, cancellation, and dirty
 * states preserve by default so a human can inspect what happened.
 */

export type CleanupDecision =
  | { action: 'preserve'; reason: string }
  | { action: 'remove'; reason: string }
  | { action: 'refuse'; reason: string };

const PRESERVE_ON_TROUBLE: WorkspaceStatus[] = ['failed', 'cancelled', 'dirty', 'checkpoint_required'];
const REMOVABLE_WHEN_AUTHORIZED: WorkspaceStatus[] = ['ready', 'active', 'completed', 'preserved'];

export function evaluateCleanup(
  workspace: Pick<RelayWorkspace, 'status' | 'cleanupPolicy'>,
  options: { authorizeRemoval: boolean },
): CleanupDecision {
  const { status, cleanupPolicy } = workspace;
  if (status === 'removed') return { action: 'refuse', reason: 'workspace is already removed.' };
  if (!options.authorizeRemoval) {
    return { action: 'preserve', reason: 'removal was not explicitly authorized — preserving conservatively.' };
  }
  const policyPreserves = policyMandatesPreservation(cleanupPolicy, status);
  if (policyPreserves) return { action: 'preserve', reason: policyPreserves };
  if (!REMOVABLE_WHEN_AUTHORIZED.includes(status)) {
    return { action: 'preserve', reason: `status "${status}" is preserved for inspection.` };
  }
  return { action: 'remove', reason: `authorized removal permitted by policy ${cleanupPolicy}.` };
}

function policyMandatesPreservation(policy: CleanupPolicy, status: WorkspaceStatus): string | null {
  switch (policy) {
    case 'preserve_always':
      return 'policy preserve_always keeps every workspace.';
    case 'preserve_on_failure':
      return PRESERVE_ON_TROUBLE.includes(status)
        ? `policy preserve_on_failure keeps a ${status} workspace for inspection.`
        : null;
    case 'preserve_on_checkpoint':
      return status === 'checkpoint_required'
        ? 'policy preserve_on_checkpoint keeps a checkpoint workspace for inspection.'
        : null;
    case 'remove_on_success':
      return status === 'completed' || status === 'ready' || status === 'active'
        ? null
        : `policy remove_on_success preserves a ${status} workspace.`;
    case 'manual_cleanup':
      return null; // explicit authorization is the manual decision
  }
}
