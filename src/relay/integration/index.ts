/**
 * THE RELAY ↔ JULIUS INTEGRATION BOUNDARY — the Claude-owned barrel.
 *
 * WHAT LIVES UNDER `src/relay/integration/**`:
 *
 *   how Relay CONFIGURES, REQUESTS, VALIDATES, PRESENTS and ADAPTS TO Julius.
 *
 * WHAT DOES NOT, AND WHY. How Julius EXECUTES — persistence, the scheduler,
 * leases, task claiming, recovery, the C.A.R.D. policy evaluator, budget
 * reservations, provider routing, provider health, the verification runtime,
 * repair state machines, sub-agent spawn authorization, the gauntlet state
 * machine, Unchained enforcement, trajectories and evals — is Julius core and
 * lives under `src/relay/mission/julius/**` and `src/relay/persistence/julius*`.
 * This namespace imports TYPES from there and never reaches into behaviour.
 *
 * The dependency runs one way only: Relay integration depends on the Julius
 * public surface; Julius core never depends on a Relay UI concern.
 */

export * from './compound-agent';
export * from './registry';
export * from './julius';
export * from './commands';
export * from './terminal';
