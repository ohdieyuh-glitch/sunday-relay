import { createInterface } from 'node:readline';

/**
 * HOW A KEY GETS IN, WITHOUT TOUCHING ANY OF THE PLACES IT MUST NOT.
 *
 * FOUNDER RULE (2026-09-17), verbatim: never ask him to paste secrets into Julius chat, Wonder Web ordinary text, the
 * Unreal console, logs, Project Brain, source files or screenshots. Every one of those is a surface something else reads
 * or records. So the key is typed ONCE, by him, into his OWN terminal, with the characters hidden, and goes straight
 * into the runtime's memory.
 *
 * WHAT IS AND IS NOT STORED:
 *   - IN MEMORY ONLY, for the life of this process. Nothing is written to disk. An earlier rule of the founder's stands:
 *     "Do not invent insecure local plaintext storage." A key therefore does not survive a restart, and that is said
 *     plainly rather than worked around.
 *   - WONDERLAND NEVER RECEIVES IT. The view Wonderland reads carries states, provider names and model names. The key is
 *     resolved inside the runtime at the moment of a call and is never logged, echoed, or put in an audit line.
 *   - A REFERENCE IS WHAT ANYTHING ELSE SEES: `vault://sidekick/openai`, which resolves nowhere but here.
 *
 * WHY NOT AN ENVIRONMENT VARIABLE. It would work, and it is what many tools do, but a variable set in a shell is
 * inherited by everything that shell starts and shows up in process listings and crash dumps. This is one keystroke more
 * and one exposure fewer.
 */

export interface CredentialIntake {
  /** Put a key in, from a prompt the person answers themselves. Returns the reference, never the material. */
  put(providerId: string, material: string): { readonly credentialRef: string };
  /** Resolve at the moment of a call. Null when nothing has been connected in this process. */
  resolve(providerId: string): string | null;
  /** Forget it. Called on disconnect, and on the way out. */
  forget(providerId: string): void;
  /** Which providers have something connected right now. Names only -- never material. */
  connected(): readonly string[];
}

export function createCredentialIntake(): CredentialIntake {
  const held = new Map<string, string>();
  return {
    put(providerId, material) {
      const trimmed = material.trim();
      if (trimmed.length === 0) {
        throw new Error('nothing was given');
      }
      held.set(providerId, trimmed);
      return { credentialRef: `vault://sidekick/${providerId}` };
    },
    resolve(providerId) {
      return held.get(providerId) ?? null;
    },
    forget(providerId) {
      held.delete(providerId);
    },
    connected() {
      return [...held.keys()];
    },
  };
}

/**
 * ASK FOR A KEY IN THE PERSON'S OWN TERMINAL, with the characters hidden as they type. Used by the connect script; it is
 * not reachable from Wonderland, from the HTTP door, or from anything a page could call.
 */
export async function askForSecret(question: string): Promise<string> {
  const input = process.stdin;
  const output = process.stdout;
  const rl = createInterface({ input, output, terminal: true });
  return new Promise<string>((resolve) => {
    // HIDDEN WHILE TYPED: nothing appears on screen, so nothing appears in a screenshot or over a shoulder either.
    const wasRaw = input.isTTY ? input.isRaw : false;
    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (text === '\r' || text === '\n' || text === '') {
        return;
      }
      // Rewrite the line with nothing on it, so the terminal shows the prompt and no characters.
      output.write(`[2K[G${question}`);
    };
    input.on('data', onData);
    rl.question(question, (answer) => {
      input.off('data', onData);
      if (input.isTTY && !wasRaw) {
        input.setRawMode?.(false);
      }
      output.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}
