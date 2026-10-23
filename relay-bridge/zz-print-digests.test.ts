import { readFileSync, readdirSync } from 'node:fs';
import { it } from 'vitest';

import { compileBootstrapRequest, parseLiveMissionContract } from './julius/mission-contract';

// THROWAWAY (never committed; pristine main 2528ac5c code): prints the binding digest of EVERY committed contract.
const SOURCE = 'C:/dev/iwonder/_qa_handoff/julius_readiness/followon_100/work/v6pm/.github/julius-missions';

it('prints', () => {
  const lines: string[] = [];
  for (const name of readdirSync(SOURCE).sort()) {
    let raw: string;
    try { raw = readFileSync(`${SOURCE}/${name}/contract.json`, 'utf8'); } catch { continue; }
    const parsed = parseLiveMissionContract(raw);
    if (!parsed.ok) throw new Error(`${name}: ${parsed.problem}`);
    lines.push(`DIGEST ${name} ${compileBootstrapRequest(parsed.contract, [], 'card:julius-live:1').missionBindingDigest}`);
  }
  console.log(lines.join('\n'));
});
