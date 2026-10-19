import { parseSlashCommand } from '../mission';
import { createLoopBridgeClient } from '../loop-bridge-client';
import {
  executeLoopControl, executeLoopHistory, executeLoopInspect, executeLoopStatus,
  type LoopExecutionClient, type LoopExecutionResult,
} from './loop-execution';
import { slashCommandFromArgv } from './loop-cli';

/**
 * ARGV → A REAL LOOP RUN.
 *
 * `loop-execution.ts` has held every execution command since the runtime
 * landed — status, inspect, history, pause, resume, stop — behind an injected
 * `LoopExecutionClient`, with its own tests. Nothing implemented that client
 * and nothing in argv reached it. So `relay loop status lpr_x` printed a
 * PREVIEW of the command it had parsed, which is a reasonable thing for a
 * grammar that has no runtime and a misleading thing for one that does.
 *
 * This module is the seam. It decides which parsed commands are READS of a live
 * run and routes exactly those to the bridge; everything else keeps going to
 * the preview, because a draft is still a draft.
 *
 * WHAT IT WILL NOT DO.
 *
 * It never starts a Loop. `loop_create` reaches the composer preview and stops
 * there: starting one spends money, and a command that spends money is a
 * separate, confirmed step (`executeLoopCreation` requires `confirmed: true`
 * and a confirmation request id the caller minted). Making `relay loop "fix
 * the parser"` start a run because the engine happened to be enabled is the
 * accident this file exists not to have.
 *
 * It never invents a state. A bridge that cannot be reached produces a sentence
 * about the BRIDGE. Relay does not know what the run is doing, and says so,
 * rather than printing a plausible status.
 */

/** Actions that address a live run, and are therefore server questions. */
const RUN_ACTIONS = new Set(['status', 'inspect', 'history', 'pause', 'resume', 'stop']);

/** Actions that CHANGE a run. Operator-only on the server; confirmed here. */
const CONTROL_ACTIONS = new Set(['pause', 'resume', 'stop']);

export interface LoopRunCliInput {
  /** argv positionals AFTER the `relay` binary name. */
  readonly positionals: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  /** The caller said yes. Required for anything that changes a run. */
  readonly confirmed: boolean;
  /** Injected in tests. Absent means "build one from the environment". */
  readonly client?: LoopExecutionClient;
  /** A request id the CALLER minted. A retry reuses it; a new decision does not. */
  readonly requestId: string;
  readonly reason?: string | null;
}

export type LoopRunCliOutcome =
  | { readonly handled: false }
  | { readonly handled: true; readonly result: LoopExecutionResult };

/**
 * Is this argv a live-run command? Pure, and deliberately separate from
 * running it, so `main.ts` can decide routing without opening a connection.
 */
/**
 * A LOOP id names the standing instruction; a RUN id names one execution of it.
 * `status`, `inspect`, `pause`, `resume` and `stop` are questions about a RUN,
 * and `history` is a question about a LOOP. Passing the wrong kind is refused
 * here rather than sent to a route that would answer about the wrong thing.
 */
const RUN_ID_PREFIX = 'lpr_';
const LOOP_ID_PREFIX = 'lpe_';

const addressesRun = (action: string, id: string): boolean =>
  (action === 'history' ? id.startsWith(LOOP_ID_PREFIX) : id.startsWith(RUN_ID_PREFIX));

export function isLoopRunCommand(positionals: readonly string[]): boolean {
  const parsed = parseSlashCommand(slashCommandFromArgv(positionals));
  if (!parsed.ok) return false;
  const command = parsed.value.command;
  if (command.kind !== 'loop_action') return false;
  // A bare `relay loop status` with no id addresses "the caller's current
  // Loop", which nothing client-side can resolve — there is no local notion of
  // a current run. That stays with the preview, which explains itself.
  if (!RUN_ACTIONS.has(command.action) || command.loopId === null) return false;
  return addressesRun(command.action, command.loopId);
}

export async function runLoopRunCli(input: LoopRunCliInput): Promise<LoopRunCliOutcome> {
  const parsed = parseSlashCommand(slashCommandFromArgv(input.positionals));
  if (!parsed.ok) return { handled: false };
  const command = parsed.value.command;
  if (command.kind !== 'loop_action' || command.loopId === null) return { handled: false };
  const { action, loopId } = command;
  if (!RUN_ACTIONS.has(action)) return { handled: false };
  if (!addressesRun(action, loopId)) {
    // A Loop id where a run id belongs (or the reverse). The preview explains
    // the grammar; answering about the wrong object would be worse than not
    // answering.
    return { handled: false };
  }

  if (CONTROL_ACTIONS.has(action)) {
    // Pausing, resuming and stopping all change what a run does with money and
    // with a workspace. Resuming in particular is an authorization of more
    // work, not a resumption of something already paid for.
    if (!input.confirmed) {
      return {
        handled: true,
        result: {
          lines: [
            `This Loop was not ${action === 'stop' ? 'stopped' : `${action}d`}, because the command was not authorized.`,
            `Run the same command again with --authorize to ${action} run ${loopId}.`,
          ],
          failed: false,
        },
      };
    }
    // AND THE CALLER MUST NAME THE DECISION. A request id minted here would be
    // new on every attempt, so a retry after a timeout would arrive as a second
    // decision with nothing for the server's idempotency to match — which is
    // how one intended stop becomes two recorded ones.
    if (input.requestId.trim() === '') {
      return {
        handled: true,
        result: {
          lines: [
            `This Loop was not ${action === 'stop' ? 'stopped' : `${action}d`}, because the request was not identified.`,
            'Pass --idempotency-key <id> so a retry can be told apart from a second decision.',
            'Reuse the SAME key when retrying; mint a new one only for a new decision.',
          ],
          failed: true,
        },
      };
    }
  }

  const client = input.client ?? createLoopBridgeClient({
    bridgeUrl: input.env.RELAY_BRIDGE_URL,
    token: input.env.RELAY_BRIDGE_TOKEN,
  });

  /*
   * A MALFORMED SERVER RESPONSE IS A MESSAGE, NOT A CRASH.
   *
   * The client validates the envelope; it does not validate every field each
   * renderer reaches for. `{"data":{}}` therefore reaches `renderLoopStatusLines`
   * and throws on `.state.replace` — inside a promise `main.ts` does not catch,
   * so the process dies with an unhandled rejection instead of saying anything.
   * A bridge that answers nonsense is a bridge problem, and the user should be
   * told which one it is.
   *
   * THE CATCH IS UNCONDITIONAL, AND THAT IS A TRADE. A Relay-side bug thrown
   * anywhere under here is also reported as "the bridge answered in a shape
   * Relay could not read", which blames the wrong party. It is still strictly
   * better than the alternative it replaces — an unhandled rejection that kills
   * the process and says nothing — because the caller gets a non-zero exit and
   * a sentence that claims nothing about the run. Narrowing it would mean
   * enumerating every field each renderer reaches for, which is the check the
   * client deliberately does not do.
   */
  const guarded = async (run: () => Promise<LoopExecutionResult>): Promise<LoopRunCliOutcome> => {
    try {
      return { handled: true, result: await run() };
    } catch {
      return {
        handled: true,
        result: {
          lines: [
            'The Relay Bridge answered in a shape Relay could not read.',
            'Nothing is claimed about the Loop run; the response was not usable.',
          ],
          failed: true,
        },
      };
    }
  };

  if (action === 'status') return guarded(() => executeLoopStatus(client, loopId));
  if (action === 'inspect') return guarded(() => executeLoopInspect(client, loopId));
  if (action === 'history') return guarded(() => executeLoopHistory(client, loopId));
  return guarded(() => executeLoopControl(client, {
    runId: loopId,
    action: action as 'pause' | 'resume' | 'stop',
    requestId: input.requestId,
    reason: input.reason ?? null,
  }));
}
