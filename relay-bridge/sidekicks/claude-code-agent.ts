import { spawn } from 'node:child_process';

import type { AgentProviderPort, AgentTask, ProviderResult } from './sidekick-ports';

/**
 * JHINN, BACKED BY THE REAL CLAUDE CODE — the official tool on this machine, driven non-interactively.
 *
 * FOUNDER DIRECTIVE (2026-09-17): Jhinn is to become a real Single AI Agent backed initially by Claude Code, able to
 * perform an actual bounded coding task through the governed connection -- and NOTHING is to be run until the founder
 * has completed the real connection himself.
 *
 * WHY THIS AUTH ROUTE. The founder's order of preference is "official supported account/auth flow where available", and
 * for Claude Code that flow is its own sign-in on this machine. So Wonderland never sees a credential: the tool holds its
 * own, and this only asks it to work. No key is read, stored, logged or passed. If the founder would rather use an
 * Anthropic API key instead, that is the tool's own ANTHROPIC_API_KEY and still never passes through Wonderland.
 *
 * TWO LOCKS, AND BOTH MUST BE OPEN:
 *   1. The tool must actually be installed and answer `claude --version`.
 *   2. WONDERLAND_SIDEKICK_LIVE must be set to 1 by the founder. Installed and signed in is NOT consent to spend: until
 *      that is set, this refuses with AUTH_REQUIRED and runs nothing at all.
 *
 * BOUNDED BY CONSTRUCTION. It runs in one directory, with only the tools the granted allowance maps to, and with
 * permission prompts answered by nobody -- anything that would have asked is denied rather than waited on. A single
 * agent that cannot be asked a question cannot be talked into widening its own scope.
 *
 * IT IS NOT JULIUS. It takes one task and reports back. It holds no mission authority, spawns no missions, and the domain
 * refuses to give it any (sidekick-runtime.ts).
 */

/** The tools each granted allowance maps to. Nothing here is a guess: read cannot write, and write cannot run. */
const TOOLS_FOR: Readonly<Record<'read' | 'write' | 'run', readonly string[]>> = Object.freeze({
  read: ['Read', 'Grep', 'Glob'],
  write: ['Edit', 'Write'],
  run: ['Bash'],
});

export interface ClaudeCodeOptions {
  /** The executable. Found on PATH by default; this machine has it from WinGet. */
  readonly executable?: string;
  /** The model alias to ask for, or none to let the tool choose as it would for a person. */
  readonly model?: string;
  /** How the founder says yes. Nothing runs until this is 1. */
  readonly liveEnvVar?: string;
}

export function createClaudeCodeAgent(options: ClaudeCodeOptions = {}): AgentProviderPort {
  const executable = options.executable ?? 'claude';
  const liveEnvVar = options.liveEnvVar ?? 'WONDERLAND_SIDEKICK_LIVE';

  const isLive = (): boolean => process.env[liveEnvVar] === '1';

  const run = (args: readonly string[], cwd: string, signal: AbortSignal, onLine?: (line: string) => void): Promise<{ code: number; out: string; err: string }> =>
    new Promise((resolve) => {
      const child = spawn(executable, [...args], { cwd, shell: false, windowsHide: true });
      let out = '';
      let err = '';
      let rest = '';
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        out += text;
        if (onLine !== undefined) {
          rest += text;
          const lines = rest.split('\n');
          rest = lines.pop() ?? '';
          for (const line of lines) {
            if (line.trim().length > 0) onLine(line);
          }
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        err += chunk.toString('utf8');
      });
      const stop = () => child.kill();
      signal.addEventListener('abort', stop, { once: true });
      child.on('error', (error) => {
        signal.removeEventListener('abort', stop);
        resolve({ code: -1, out, err: `${err}${String(error)}` });
      });
      child.on('close', (code) => {
        signal.removeEventListener('abort', stop);
        resolve({ code: code ?? -1, out, err });
      });
    });

  return {
    providerId: 'claude-code',

    async reachable() {
      // FREE AND LOCAL: asking the tool its version costs nothing and contacts no model.
      const version = await run(['--version'], process.cwd(), new AbortController().signal);
      if (version.code !== 0) {
        return {
          ok: false,
          failure: 'AUTH_REQUIRED',
          detail: `Claude Code is not answering on this machine (\`${executable} --version\`). Install it and sign in with its own flow first.`,
        };
      }
      const installed = version.out.trim().split('\n')[0] ?? 'installed';
      if (!isLive()) {
        // INSTALLED IS NOT CONSENT. The founder said no paid calls until he says so, and this is where that is kept.
        return {
          ok: false,
          failure: 'AUTH_REQUIRED',
          detail: `Claude Code is here (${installed}) but Wonderland has not been told it may use it. The founder sets ${liveEnvVar}=1 for this runtime when he is ready; until then nothing is run.`,
        };
      }
      return { ok: true, detail: `Claude Code ${installed}, and the founder has allowed live use.` };
    },

    async work(input: AgentTask): Promise<ProviderResult> {
      if (!isLive()) {
        return {
          ok: false,
          failure: 'AUTH_REQUIRED',
          detail: `Nothing was run: Wonderland has not been allowed to use Claude Code yet (${liveEnvVar} is not set).`,
        };
      }
      const started = Date.now();
      const allowed = input.allow.flatMap((grant) => TOOLS_FOR[grant] ?? []);
      const args = [
        '-p',
        input.ask,
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--verbose',
        // ANYTHING THAT WOULD ASK IS DENIED, not waited on: a bounded agent must not be able to sit on a question.
        '--permission-prompts',
        'none',
        '--permission-mode',
        'dontAsk',
        ...(allowed.length > 0 ? ['--allowedTools', ...allowed] : []),
        // WHAT IT MAY NEVER DO HERE, said explicitly as well as by omission.
        '--disallowedTools',
        'WebFetch',
        'WebSearch',
        ...(options.model !== undefined ? ['--model', options.model] : []),
      ];

      let shown = '';
      const result = await run(args, input.workingDirectory, input.signal, (line) => {
        // The tool's stream is JSON lines; what a person wants to see is the text it produces, as it produces it.
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          const text = readableText(event);
          if (text !== null) {
            shown = shown.length === 0 ? text : `${shown}${text}`;
            input.onChunk({ text: shown });
          }
        } catch {
          // A line that is not JSON is the tool talking to a person; show it as it is.
          shown = shown.length === 0 ? line : `${shown}\n${line}`;
          input.onChunk({ text: shown });
        }
      });

      if (input.signal.aborted) {
        return { ok: false, failure: 'CANCELLED', detail: 'Stopped part way through the task.' };
      }
      if (result.code !== 0) {
        const said = `${result.err}${result.out}`.trim().slice(0, 300);
        // A TOOL THAT NEEDS SIGNING IN SAYS SO, and that is an auth problem rather than a failure of the work.
        if (/log ?in|sign ?in|authenticat|unauthorized|api key/i.test(said)) {
          return { ok: false, failure: 'AUTH_REQUIRED', detail: `Claude Code needs its own sign-in first: ${said}` };
        }
        if (/rate limit|429/i.test(said)) {
          return { ok: false, failure: 'RATE_LIMITED', detail: said };
        }
        if (/credit|quota|billing/i.test(said)) {
          return { ok: false, failure: 'QUOTA_EXHAUSTED', detail: said };
        }
        return { ok: false, failure: 'PROVIDER_ERROR', detail: said.length > 0 ? said : `Claude Code exited with ${result.code}.` };
      }
      const answer = shown.trim().length > 0 ? shown.trim() : result.out.trim();
      if (answer.length === 0) {
        return { ok: false, failure: 'MALFORMED', detail: 'Claude Code finished without saying anything, so there is nothing to show.' };
      }
      return { ok: true, answer, modelId: input.modelId, ms: Date.now() - started };
    },
  };
}

/** The human-readable part of one stream event, or null when the event is bookkeeping. */
function readableText(event: Record<string, unknown>): string | null {
  const type = typeof event.type === 'string' ? event.type : '';
  if (type === 'stream_event') {
    const inner = event.event as Record<string, unknown> | undefined;
    const delta = inner?.delta as Record<string, unknown> | undefined;
    return typeof delta?.text === 'string' ? delta.text : null;
  }
  if (type === 'assistant') {
    const message = event.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (Array.isArray(content)) {
      const text = content
        .map((part) => (typeof part === 'object' && part !== null && typeof (part as Record<string, unknown>).text === 'string' ? ((part as Record<string, unknown>).text as string) : ''))
        .join('');
      return text.length > 0 ? text : null;
    }
  }
  if (type === 'result' && typeof event.result === 'string') {
    return null; // The final result repeats what was already streamed.
  }
  return null;
}
