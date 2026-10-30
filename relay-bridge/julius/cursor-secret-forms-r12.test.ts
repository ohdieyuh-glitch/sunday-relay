/* Round 7 R6-5: two cheap linear additions only: base32 runs (RFC 4648, upper or lower case, optional padding) and the
   HTML named entities for `_`, `-`, `:` and `/` (`&lowbar;`, `&UnderBar;`, `&hyphen;`, `&dash;`, `&colon;`, `&sol;`).
   Everything else stays documented as not covered (NOTES). */
import { describe, expect, it } from 'vitest';

import { redactSecrets } from './cursor-cloud-agents-transport';

const GH = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
function base32(s: string): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; let out = '';
  for (const b of Buffer.from(s)) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out.padEnd(Math.ceil(out.length / 8) * 8, '=');
}
describe('R6-5: base32 and named-entity forms', () => {
  for (const [k, v] of Object.entries({ base32: base32(GH), base32_lower_nopad: base32(GH).toLowerCase().replace(/=+$/u, ''), lowbar: GH.replace('_', '&lowbar;'), UnderBar: GH.replace('_', '&UnderBar;') })) {
    it(`${k} is flagged as residue`, () => { expect(redactSecrets(`log: ${v} end`).residue).toBe(true); });
  }
  it('controls: ordinary base32-alphabet words and entities are not residue', () => {
    expect(redactSecrets('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567 &lowbar; &colon; MZXW6YTBOI======').residue).not.toBe(true);
  });
  it('1 MiB base32-alphabet input stays fast', () => {
    const t0 = Date.now(); redactSecrets('ABCDEFGH'.repeat(128 * 1024)); redactSecrets('&lowbar;'.repeat(128 * 1024));
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});
