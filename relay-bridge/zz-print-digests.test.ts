import { readFileSync } from 'node:fs';
import { it } from 'vitest';

import { compileBootstrapRequest, parseLiveMissionContract } from './julius/mission-contract';

// THROWAWAY (never committed): prints the binding digest PRISTINE main's own mission-contract.ts computes for contracts that main does not yet contain.
const SOURCE = 'C:/dev/iwonder/_qa_handoff/julius_readiness/followon_100/work/m4r/.github/julius-missions';

it('prints', () => {
  const lines: string[] = [];
  for (const name of ['julius-diag-audit-fixes-1', 'julius-diag-digest-evidence-1']) {
    const parsed = parseLiveMissionContract(readFileSync(`${SOURCE}/${name}/contract.json`, 'utf8'));
    if (!parsed.ok) throw new Error(`${name}: ${parsed.problem}`);
    lines.push(`PIN ${name} ${compileBootstrapRequest(parsed.contract, [], 'card:julius-live:1').missionBindingDigest}`);
  }
  console.log(lines.join('\n'));
});
