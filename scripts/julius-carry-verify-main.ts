/**
 * The off-host carry verifier's entry point:
 *   npm run julius:carry-verify -- <WITHOUT bundle> <WITH bundle>
 *   npm run julius:carry-verify -- --preview <WITHOUT bundle> <WITH run id>
 *
 * Split from the verifier itself so it can be imported by its test without reading argv at import time.
 */
import { JULIUS_CARRIED_KNOWLEDGE_LIMIT } from '../relay-bridge/julius/mission-knowledge';
import { juliusCarryVerifyCommandOf, runJuliusCarryPreview, runJuliusCarryVerify } from './julius-carry-verify';

const command = juliusCarryVerifyCommandOf(process.argv.slice(2));
if (command === null) {
  process.stderr.write('usage: julius-carry-verify <arm-WITHOUT bundle dir> <arm-WITH bundle dir>\n'
    + '       julius-carry-verify --preview <arm-WITHOUT bundle dir> <arm-WITH run id>\n');
  process.exitCode = 2;
} else {
  // The bootstrap's own packet bound, so the re-derived carry is cut where the real one was (or will be).
  const result = command.mode === 'preview'
    ? runJuliusCarryPreview({ withoutDir: command.withoutDir, withRunId: command.withRunId, limit: JULIUS_CARRIED_KNOWLEDGE_LIMIT })
    : runJuliusCarryVerify({ withoutDir: command.withoutDir, withDir: command.withDir, limit: JULIUS_CARRIED_KNOWLEDGE_LIMIT });
  process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
  process.exitCode = result.code;
}
