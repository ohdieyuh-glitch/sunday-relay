// REVIEWER TOOLS (run by the Independent Reviewer only, on the reviewer's side). This file holds NO key and writes NO key into the repository.
//   node reviewer-tools.mjs keygen  <private-key-path> [--passphrase-env NAME]   creates an ed25519 key pair; the private key (optionally passphrase-encrypted, the passphrase read
//                                                                                from an environment variable that exists only in the reviewer's session) goes to the path the
//                                                                                reviewer chose, mode 600; prints ONLY the public key PEM to commit.
//   node reviewer-tools.mjs digest  <pr>                                         prints the bot-comments digest of the live PR (needs GH_TOKEN) for the clearance text.
//   node reviewer-tools.mjs sign    <private-key-path> <pr> <head> <tree> <base> <CLEARED|CLEARED-TREE> <bot-digest> <hours<=24> [--exceptions a,b] [--passphrase-env NAME]
//                                                                                prints the clearance text and its signature as base64 (two labelled blocks) for the dispatcher.
import { createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { REPO, botCommentsDigest } from './land-lib.mjs';

const [, , command, ...rest] = process.argv;
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const passphrase = () => { const n = flag('--passphrase-env'); return n ? process.env[n] : undefined; };
const die = (m) => { console.error(m); process.exit(1); };

if (command === 'keygen') {
  const path = rest[0];
  if (!path) die('usage: keygen <private-key-path> [--passphrase-env NAME]');
  if (existsSync(path)) die(`refusing to overwrite ${path}`);
  const pass = passphrase();
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem', ...(pass ? { cipher: 'aes-256-cbc', passphrase: pass } : {}) });
  writeFileSync(path, pem, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort on Windows */ }
  process.stdout.write(publicKey.export({ type: 'spki', format: 'pem' }));
} else if (command === 'digest') {
  const pr = rest[0];
  const gh = async (p) => { const r = await fetch(`https://api.github.com${p}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' } }); if (!r.ok) die(`${p} -> ${r.status}`); return r.json(); };
  const [issueComments, inlineComments, reviews] = await Promise.all([gh(`/repos/${REPO}/issues/${pr}/comments?per_page=100`), gh(`/repos/${REPO}/pulls/${pr}/comments?per_page=100`), gh(`/repos/${REPO}/pulls/${pr}/reviews?per_page=100`)]);
  console.log(botCommentsDigest({ issueComments, inlineComments, reviews }));
} else if (command === 'sign') {
  const [path, pr, head, tree, base, kind, digest, hours] = rest;
  if (!path || !hours) die('usage: sign <private-key-path> <pr> <head> <tree> <base> <CLEARED|CLEARED-TREE> <bot-digest> <hours<=24> [--exceptions a,b] [--passphrase-env NAME]');
  const exceptions = flag('--exceptions') ?? '-';
  const h = Number(hours);
  if (!(h > 0 && h <= 24)) die('hours must be in (0, 24]');
  const issued = new Date(); issued.setMilliseconds(0);
  const expires = new Date(issued.getTime() + h * 3600_000);
  const iso = (d) => d.toISOString().replace('.000Z', 'Z');
  const text = ['JULIUS-CLEARANCE-V1', `repo: ${REPO}`, `pr: ${pr}`, `head: ${head}`, `tree: ${tree}`, `base: ${base}`, `kind: ${kind}`, `bot-comments-sha256: ${digest}`, `governed-exceptions: ${exceptions}`, `nonce: ${randomBytes(16).toString('hex')}`, 'by: INDEPENDENT_REVIEW', `issued: ${iso(issued)}`, `expires: ${iso(expires)}`, ''].join('\n');
  const key = createPrivateKey({ key: readFileSync(path), ...(passphrase() ? { passphrase: passphrase() } : {}) });
  const signature = sign(null, Buffer.from(text, 'utf8'), key).toString('base64');
  console.log('CLEARANCE_B64=' + Buffer.from(text, 'utf8').toString('base64'));
  console.log('SIGNATURE_B64=' + signature);
  console.log('--- clearance text (for the mailbox record) ---\n' + text);
} else {
  die('commands: keygen | digest | sign');
}
