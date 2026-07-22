/** Stable Relay CLI exit codes. 0 is NEVER used for failed, blocked, or
 * incomplete work. */
export const EXIT = {
  completed: 0,
  internalError: 1,
  usage: 2,
  runFailed: 3,
  blocked: 4,
  checkpointRequired: 5,
  cancelled: 6,
  budgetExceeded: 7,
  doctorFailure: 8,
  protocolFailure: 9,
} as const;

export function exitCodeForFinalStatus(status: string, checkpointReason?: string | null): number {
  switch (status) {
    case 'completed':
      return EXIT.completed;
    case 'failed':
      return EXIT.runFailed;
    case 'cancelled':
      return EXIT.cancelled;
    case 'checkpoint_required':
      return checkpointReason && /budget/i.test(checkpointReason) ? EXIT.budgetExceeded : EXIT.checkpointRequired;
    case 'paused':
      return EXIT.checkpointRequired;
    default:
      return EXIT.blocked;
  }
}
