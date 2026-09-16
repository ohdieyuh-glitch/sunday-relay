import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import { JULIUS_BRAIN_ANCHOR_FORMAT, type JuliusBrainAnchorSink, type JuliusBrainAuditAnchor } from '../mission/julius/julius-brain-audit-anchor';

/**
 * A LOCAL ANCHOR SINK: one JSON document per line, appended.
 *
 * For proofs and for a development deployment, so the anchoring path is
 * exercised without choosing anywhere to publish to. A production sink is
 * whatever the deployment picks (an object store with a retention lock, a
 * separate account, a notary) — and it must be somewhere the Brain database's
 * owner cannot rewrite, which a file beside the database is not.
 */
export function createJuliusBrainAnchorFileSink(path: string): JuliusBrainAnchorSink {
  return {
    async append(anchor) {
      appendFileSync(path, `${JSON.stringify(anchor)}\n`, 'utf8');
    },
    async read() {
      if (!existsSync(path)) return [];
      const anchors: JuliusBrainAuditAnchor[] = [];
      for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
        if (line.trim() === '') continue;
        let parsed: unknown;
        try { parsed = JSON.parse(line); } catch { throw new Error(`julius_brain_anchor_file_line_invalid: line ${index + 1} is not JSON`); }
        if (typeof parsed !== 'object' || parsed === null || (parsed as JuliusBrainAuditAnchor).format !== JULIUS_BRAIN_ANCHOR_FORMAT) {
          throw new Error(`julius_brain_anchor_file_line_invalid: line ${index + 1} is not ${JULIUS_BRAIN_ANCHOR_FORMAT}`);
        }
        anchors.push(parsed as JuliusBrainAuditAnchor);
      }
      return anchors;
    },
  };
}
