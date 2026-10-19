/**
 * SUNDAY RELAY — LOOP BRIDGE CLIENT (barrel).
 *
 * The adapter behind `LoopExecutionClient`. One implementation, shared by the
 * CLI and by any future trusted surface, so a Loop command cannot come to mean
 * two different things depending on which client sent it.
 */

export { createLoopBridgeClient } from './loop-bridge-client';
export type { LoopBridgeClientOptions } from './loop-bridge-client';
