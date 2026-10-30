import { describe, expect, it } from 'vitest';

import { createCursorCloudAgentsTransport, cursorKeyResidue, openCursorRunStream, redactSecrets, type CursorFetch } from './cursor-cloud-agents-transport';

/*
 * PILOT 43b93a4e N-2 (PEM ReDoS), M-6 leftovers, and Skywalker 43b93a4e L1 (secret forms). Fake fetch, sentinel key,
 * fake token shapes only (none of these strings is a real credential).
 */
const KEY = 'SENTINEL-KEY-0123456789-never-print';
const REF = { agentId: 'bc-00000000-0000-4000-8000-000000000001', runId: 'run-abc' };
async function scrubber() {
  const fetch: CursorFetch = async () => ({ ok: true, status: 200, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'text/event-stream' : null) }, body: null, text: async () => '' });
  const r = await openCursorRunStream(createCursorCloudAgentsTransport({ fetch, getApiKey: () => KEY }), REF, null, { deadlineAtMs: Date.now() + 60_000 });
  if (r.kind !== 'opened') throw new Error('not opened');
  return r.scrub;
}
const ANT = `sk-ant-api03-${'Ab1'.repeat(10)}`;
const XAI = `xai-${'Zq9'.repeat(8)}`;

describe('PILOT N-2: the secret scrub runs in linear time', () => {
  it('1 MiB of unterminated PEM BEGIN markers is scrubbed in well under a second', () => {
    const text = '-----BEGIN RSA PRIVATE KEY-----'.repeat(Math.ceil((1024 * 1024) / 31)).slice(0, 1024 * 1024);
    const t0 = performance.now();
    redactSecrets(text);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  it('other adversarial 1 MiB inputs (JWT prefixes, BEGIN without END, Bearer runs) also stay under a second', () => {
    for (const unit of ['eyJ', 'eyJaaaaaaaaa.', '-----BEGIN ', 'Bearer ', 'xai-', 'sk-', '%2D', '\\u002d']) {
      const text = unit.repeat(Math.ceil((1024 * 1024) / unit.length));
      const t0 = performance.now();
      redactSecrets(text);
      expect(performance.now() - t0, unit).toBeLessThan(1000);
    }
  });
  it('a PEM block with an END line is still redacted, and a BEGIN with no END redacts to the end of the text', () => {
    expect(redactSecrets('a -----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY----- b').text).toBe('a [REDACTED:secret] b');
    expect(redactSecrets('a -----BEGIN EC PRIVATE KEY-----\nMIIabc').text).toBe('a [REDACTED:secret]');
  });
});

describe('PILOT M-6 / Skywalker L1: more secret forms are redacted or fail closed', () => {
  it('short ghp_ and sk- tokens, lower-case akia, embedded myxai-, AWS secret keys and URL passwords are redacted', () => {
    for (const s of ['ghp_abcdEFGH1234', 'sk-abcd1234wxyz', 'akiaabcdefghijklmnop', `my${XAI}`, `ms${ANT}`,
      'aws_secret_access_key = wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY12', 'https://bob:hunter2pass@example.invalid/x']) {
      const r = redactSecrets(`before ${s} after`);
      expect(r.count, s).toBeGreaterThan(0);
      expect(r.text, s).not.toContain(s.includes('hunter2') ? 'hunter2' : s.slice(-8));
    }
  });
  it('a zero-width space inside an sk-ant key does not leave its tail behind', async () => {
    const s = await scrubber();
    const r = s(`x ${ANT.slice(0, 20)}\u200b${ANT.slice(20)} y`);
    expect(r.kind === 'clean' ? r.text : '').not.toContain(ANT.slice(-10));
    expect(r.kind === 'clean' || r.kind === 'secret_residue').toBe(true);
  });
  it('JSON-escaped, URL-encoded, base64, reversed and line-split secrets fail closed (secret_residue), never stored', async () => {
    const s = await scrubber();
    const forms = [
      ANT.replace('sk-ant', 'sk\\u002dant'),
      ANT.replace('sk-ant', 'sk%2Dant'),
      Buffer.from(XAI).toString('base64'),
      [...XAI].reverse().join(''),
      `${ANT.slice(0, 18)}\n${ANT.slice(18)}`,
    ];
    for (const f of forms) expect(s(`data ${f} end`), f).toEqual({ kind: 'secret_residue' });
  });
  it('the Cursor key as 0x bytes or as UTF-16 hex is key residue', () => {
    const bytes = [...Buffer.from(KEY)];
    expect(cursorKeyResidue(bytes.map((b) => `0x${b.toString(16)}`).join(', '), KEY)).toBe(true);
    expect(cursorKeyResidue(Buffer.from(KEY, 'utf16le').swap16().toString('hex'), KEY)).toBe(true);
    expect(cursorKeyResidue(Buffer.from(KEY, 'utf16le').toString('hex').toUpperCase(), KEY)).toBe(true);
  });
  it('ordinary text is untouched', () => {
    expect(redactSecrets('task-runner finished; see https://example.invalid/a:b and sk-8 notes')).toEqual({ text: 'task-runner finished; see https://example.invalid/a:b and sk-8 notes', count: 0 });
  });
});
