/**
 * Round 9 (Skywalker 6:01 PM design): process-local registry of LIVE snapshot object directories created by
 * snapshotCommitSafely (e2-safe-git.ts). The gate's isolation check accepts `.git/objects/info/alternates` only when it is a
 * regular file whose entire content is one line naming a directory registered here and not yet disposed. Nothing outside
 * this process can add to it; dispose() unregisters. Any other alternates file stays an isolation finding.
 */
const LIVE = new Set<string>();
export function registerSnapshotObjectDir(path: string): void { LIVE.add(path); }
export function unregisterSnapshotObjectDir(path: string): void { LIVE.delete(path); }
export function isLiveSnapshotObjectDir(path: string): boolean { return LIVE.has(path); }
