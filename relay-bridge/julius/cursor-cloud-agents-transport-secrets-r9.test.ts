/* Round 4 R3-7/R3-8/M4: more secret forms, fewer false stops. Fake tokens only (generated shapes, never real). */
import { describe, expect, it } from 'vitest';

import { redactSecrets } from './cursor-cloud-agents-transport';

const SK = `sk-${'A1b2C3d4E5'.repeat(4)}`;
const ANT = `sk-ant-api03-${'Zz9Yy8Xx7W'.repeat(4)}`;
const hex = (s: string): string => Buffer.from(s, 'latin1').toString('hex');
const b64 = (s: string): string => Buffer.from(s, 'latin1').toString('base64');
const full = (s: string): string => [...s].map((c) => (c >= '!' && c <= '~' ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c)).join('');

describe('M4: no false stops', () => {
  it('a URL password is redacted completely and does not leave a residue stop', () => {
    expect(redactSecrets('clone https://bob:hunter2pass@git.example.invalid/x.git now')).toEqual({ text: 'clone https://bob:[REDACTED:secret]@git.example.invalid/x.git now', count: 1 });
  });
  it('text ending in "-ks" (reversed sk-) of ordinary length is not a stop', () => {
    expect(redactSecrets('cleaned my_long_cache_dir-ks and done')).toEqual({ text: 'cleaned my_long_cache_dir-ks and done', count: 0 });
  });
  it('a reversed real-length sk- key still stops', () => {
    expect(redactSecrets(`x ${[...SK].reverse().join('')} y`).residue).toBe(true);
  });
});

describe('R3-7/R3-8: forms redacted in place', () => {
  for (const [name, s] of [
    ['lowercase PEM', '-----begin private key-----\nMIIabcdef\n-----end private key-----'],
    ['npm token', `npm_${'aB3dE5gH7j'.repeat(4)}`],
    ['stripe rk_live_', `rk_live_${'aB3dE5gH7j'.repeat(3)}`],
    ['stripe sk_live_', `sk_live_${'aB3dE5gH7j'.repeat(3)}`],
    ['JSON SecretAccessKey', `"SecretAccessKey": "${'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'}"`],
  ] as const) {
    it(name, () => {
      const r = redactSecrets(`before ${s} after`);
      expect(r.count, name).toBeGreaterThan(0);
      expect(r.residue, name).toBeUndefined();
      expect(r.text.includes('[REDACTED:secret]'), name).toBe(true);
    });
  }
});

describe('R3-7/R3-8: forms that cannot be rewritten in place fail closed (residue)', () => {
  for (const [name, s] of [
    ['fullwidth sk-', full(SK)],
    ['HTML hex entities', [...SK].map((c) => `&#x${c.charCodeAt(0).toString(16)};`).join('')],
    ['HTML decimal entities', [...SK].map((c) => `&#${c.charCodeAt(0)};`).join('')],
    ['hex sk-ant', hex(ANT)],
    ['double base64', b64(b64(SK))],
  ] as const) {
    it(name, () => { expect(redactSecrets(`before ${s} after`).residue, name).toBe(true); });
  }
  it('ordinary hex and base64 are not stops', () => {
    expect(redactSecrets(`commit ${'0123456789abcdef'.repeat(2)}deadbeef and ${b64('hello world, nothing secret here')}`).residue).toBeUndefined();
  });
});
