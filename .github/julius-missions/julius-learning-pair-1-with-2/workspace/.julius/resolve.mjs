/**
 * RESOLVES RELAY'S OWN IMPORT STYLE, SO THE SLICED FILES STAY BYTE-IDENTICAL.
 *
 * Relay writes relative imports without an extension (`from './julius-runtime'`)
 * because its build resolves them. Node does not: in ESM a relative specifier is
 * a URL, and `./julius-runtime` names a file that is not there. Without this
 * hook a slice of real Relay source cannot be imported at all.
 *
 * THE ALTERNATIVE WAS REWRITING THE SPECIFIERS ON THE WAY IN, and it is worse
 * for the only reason that matters here: a mission's whole output is
 * `git diff` over the slice. If provisioning edited every import line, the
 * diff would carry those edits, would not apply to the repository the slice came
 * from, and nobody could tell a worker's change from the harness's. Ten lines of
 * resolution buys a patch that applies cleanly to Sunday Relay.
 *
 * IT RESOLVES NOTHING ELSE. A bare specifier ('node:test', a package name) and
 * anything already carrying an extension go straight to the next hook. The
 * candidate must exist on disk before it is used, so a missing module still
 * fails as a missing module rather than as a confusing extension error.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CARRIES_EXTENSION = /\.[cm]?[jt]sx?$/;

export function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !CARRIES_EXTENSION.test(specifier) && context.parentURL !== undefined) {
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      try {
        if (existsSync(fileURLToPath(new URL(candidate, context.parentURL)))) return next(candidate, context);
      } catch { /* a specifier that is not a resolvable URL is not ours to fix */ }
    }
  }
  return next(specifier, context);
}
