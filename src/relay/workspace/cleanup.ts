import type { CleanupPolicy, WorkspaceStatus } from './contracts';

/**
 * Conservative cleanup decisions (Prompt 7) — pure policy. Removal happens
 * ONLY when explicitly authorized AND the workspace's cleanup policy
 * permits removal for its current status. Everything doubtful is
 * preserved; failure, checkpoint, and cancellation states default to
 * preservation so a human can inspect the workspace.
 */

export type CleanupDecision =
  | { action: 'preserve'; reason: string }
  | { action: 'remove'; reason: string };

export function decideCleanup(input: {
  policy: CleanupPolicy;
  status: WorkspaceStatus;
  authorizeRemoval: boolean;
}): CleanupDecision {
  const { policy, status, authorizeRemoval } = input;

  if (policy === 'preserve_always') {
    return { action: 'preserve', reason: 'cleanup policy preserve_always' };
  }
  if (!authorizeRemoval) {
    return { action: 'preserve', reason: 'removal not explicitly authorized — preserved for inspection' };
  }
  const troubled: WorkspaceStatus[] = ['failed', 'cancelled', 'checkpoint_required', 'dirty'];
  if (policy === 'preserve_on_failure' && (status === 'failed' || status === 'cancelled')) {
    return { action: 'preserve', reason: `preserve_on_failure keeps a ${status} workspace` };
  }
  if (policy === 'preserve_on_checkpoint' && (status === 'checkpoint_required' || status === 'failed' || status === 'cancelled')) {
    return { action: 'preserve', reason: `preserve_on_checkpoint keeps a ${status} workspace` };
  }
  if (policy === 'remove_on_success' && status !== 'completed' && status !== 'ready' && status !== 'active') {
    return { action: 'preserve', reason: `remove_on_success does not remove a ${status} workspace` };
  }
  if (policy === 'manual_cleanup' && troubled.includes(status)) {
    return { action: 'preserve', reason: `manual cleanup of a ${status} workspace requires inspection first — preserved` };
  }
  return { action: 'remove', reason: `authorized removal permitted by ${policy} for status ${status}` };
}
