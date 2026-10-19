#!/usr/bin/env node
/**
 * THE THREE WAYS `scripts/julius-reviewer-isolation-proof.sh` BREAKS THE BOOTSTRAP.
 *
 * The container proof runs `.github/julius-live-hermes.sh` unmodified, which
 * must pass, and then once per mutation below, which must each be refused for
 * the reason named. A mutation whose anchor has gone would leave the bootstrap
 * unbroken and turn a refusal case into a second passing case, so every
 * mutation checks its anchor and throws instead. `julius-reviewer-isolation.test.ts`
 * applies each one to the files as they are now, so a change that moves an
 * anchor fails in `npm test`, not in a container run nobody repeats.
 *
 * Run from the root of the copy being mutated:
 *   node scripts/julius-reviewer-isolation-proof-mutations.mjs list
 *   node scripts/julius-reviewer-isolation-proof-mutations.mjs apply <name>
 */

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The reviewer profile exactly as the bootstrap wrote it before the isolation fix. */
export const PROFILE_HEREDOC_BEFORE_ISOLATION = [
  'cat > "$HERMES_PROFILE_HOME/.hermes/config.yaml" <<CONFIG',
  'providers:',
  '  ${HERMES_PROVIDER}:',
  '    request_timeout_seconds: ${HERMES_REQUEST_TIMEOUT_SECONDS}',
  '    stale_timeout_seconds: ${HERMES_REQUEST_TIMEOUT_SECONDS}',
  'agent:',
  '  api_max_retries: 0',
  'CONFIG',
  '',
].join('\n');

const anchorMissing = (name) => new Error(`isolation_proof_mutation_anchor_missing:${name}`);

function replaceOnce(name, text, from, to) {
  if (text.split(from).length !== 2) throw anchorMissing(name);
  return text.replace(from, () => to);
}

export const ISOLATION_PROOF_MUTATIONS = Object.freeze([
  Object.freeze({
    name: 'before-this-change',
    file: '.github/julius-live-hermes.sh',
    refusal: 'reviewer_holds_tools:',
    /** The old heredoc restored verbatim, with the proof and its verdict left in place. */
    apply(text) {
      const start = text.indexOf('node scripts/julius-reviewer-isolation.mjs config');
      const end = text.indexOf('chmod 0600 "$HERMES_PROFILE_HOME/.hermes/config.yaml"');
      if (start < 0 || end < start) throw anchorMissing(this.name);
      if (!text.includes('node scripts/julius-reviewer-isolation.mjs verify')) throw anchorMissing(this.name);
      return text.slice(0, start) + PROFILE_HEREDOC_BEFORE_ISOLATION + text.slice(end);
    },
  }),
  Object.freeze({
    name: 'without-kanban',
    file: 'scripts/julius-reviewer-isolation.mjs',
    refusal: 'reviewer_toolsets_enabled:kanban',
    /** The reviewer harness's own 23-name list. */
    apply(text) {
      return replaceOnce(this.name, text, "'computer_use', 'kanban',", "'computer_use',");
    },
  }),
  Object.freeze({
    name: 'without-safe-mode',
    file: '.github/julius-live-hermes.sh',
    refusal: 'reviewer_safe_mode_off',
    /** The proof run without the flag the review passes. */
    apply(text) {
      return replaceOnce(this.name, text,
        '--safe-mode --usage-file "$isolation_cwd/relay-hermes-usage.json"',
        '--usage-file "$isolation_cwd/relay-hermes-usage.json"');
    },
  }),
]);

function main(argv) {
  const [command, name] = argv;
  if (command === 'list' && name === undefined) {
    for (const mutation of ISOLATION_PROOF_MUTATIONS) process.stdout.write(`${mutation.name}\t${mutation.refusal}\n`);
    return 0;
  }
  const mutation = ISOLATION_PROOF_MUTATIONS.find((candidate) => candidate.name === name);
  if (command === 'apply' && mutation !== undefined) {
    try {
      writeFileSync(mutation.file, mutation.apply(readFileSync(mutation.file, 'utf8')));
      return 0;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : 'isolation_proof_mutation_failed'}\n`);
      return 3;
    }
  }
  process.stderr.write('usage: julius-reviewer-isolation-proof-mutations.mjs list | apply <name>\n');
  return 2;
}

const entrypoint = (() => {
  if (!process.argv[1]) return null;
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; }
})();
if (entrypoint !== null && import.meta.url === entrypoint) {
  process.exitCode = main(process.argv.slice(2));
}
