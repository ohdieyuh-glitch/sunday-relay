/* Round 6 PILOT R5-8: secret forms that were stored verbatim with no residue flag. Each addition is one linear pass.
   Still NOT covered (stated in NOTES): spaced hex inside prose with other separators, arbitrary Unicode confusables
   outside the small map, other ciphers/encodings (base32, gzip, XOR, ROT-n for n != 13), four or more base64 levels. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { redactSecrets } from './cursor-cloud-agents-transport';

const GH = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const b64 = (s: string): string => Buffer.from(s).toString('base64');
const rot13 = (s: string) => s.replace(/[a-z]/giu, (c) => String.fromCharCode((c <= 'Z' ? 65 : 97) + ((c.toLowerCase().charCodeAt(0) - 97 + 13) % 26)));
const hex = Buffer.from(GH).toString('hex');
const FORMS: Record<string, string> = {
  armenian_vo: `gh\u0578_abcdefghijklmnopqrstuvwxyz0123456789`,
  b64x3: b64(b64(b64(GH))),
  hex_colon: hex.replace(/(..)(?!$)/gu, '$1:'),
  hex_0x: hex.replace(/(..)/gu, '0x$1,'),
  hex_0x_spaced: hex.replace(/(..)/gu, '0x$1, '),
  utf16_b64: Buffer.from(GH, 'utf16le').toString('base64'),
  rot13: rot13(GH),
};
describe('R5-8: residue for the remaining PILOT forms', () => {
  for (const [k, v] of Object.entries(FORMS)) it(`${k} is flagged as residue`, () => { expect(redactSecrets(`log: ${v} end`).residue).toBe(true); });
  it('no new false positives on this repo\'s own sources and docs', () => {
    const hits: string[] = [];
    for (const d of ['.', '..', '../../src']) {
      const dir = join(__dirname, d);
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (!/\.(ts|md|mjs)$/u.test(f) || !statSync(p).isFile() || /secret|pilot|transport|zz-|r3|r7|r9|r10|r11/u.test(f)) continue;
        if (redactSecrets(readFileSync(p, 'utf8')).residue === true) hits.push(f);
      }
    }
    expect(hits).toEqual([]);
  });
  it('1 MiB adversarial inputs stay fast (each under 2 s here) and scale linearly-ish', () => {
    const MiB = 1024 * 1024;
    for (const v of ['0x6a,'.repeat(MiB / 5), '6a:'.repeat(MiB / 3), '\u0578'.repeat(MiB / 2), 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldY '.repeat(MiB / 33), 'A'.repeat(MiB)]) {
      const t = performance.now(); redactSecrets(v); expect(performance.now() - t).toBeLessThan(2000);
    }
  });
});
