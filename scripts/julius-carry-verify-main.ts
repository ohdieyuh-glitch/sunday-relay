/**
 * The off-host carry verifier's entry point (`npm run julius:carry-verify -- <WITHOUT bundle> <WITH bundle>`).
 *
 * Split from the verifier itself so it can be imported by its test without reading argv at import time.
 */
import { JULIUS_CARRIED_KNOWLEDGE_LIMIT } from '../relay-bridge/julius/mission-knowledge';
import { runJuliusCarryVerify } from './julius-carry-verify';

const [withoutDir, withDir] = process.argv.slice(2);
if (withoutDir === undefined || withDir === undefined) {
  process.stderr.write('usage: julius-carry-verify <arm-WITHOUT bundle dir> <arm-WITH bundle dir>\n');
  process.exitCode = 2;
} else {
  // The bootstrap's own packet bound, so the re-derived carry is cut where the real one was.
  const result = runJuliusCarryVerify({ withoutDir, withDir, limit: JULIUS_CARRIED_KNOWLEDGE_LIMIT });
  process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
  process.exitCode = result.code;
}
