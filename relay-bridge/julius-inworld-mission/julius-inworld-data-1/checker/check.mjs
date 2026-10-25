// HIDDEN DETERMINISTIC CHECKER for julius-inworld-data-1. Input: the coder's final message (the artifact) as a string.
// It recomputes the expected document from the seed files with oracle.mjs and compares by deep equality, section by section.
// Pure: no network, no clock, no randomness, no process spawn. Output text names failed SECTIONS only (never the artifact's values).
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalize } from './oracle.mjs';

export const MAX_ARTIFACT_CHARS = 8000;
const here = dirname(fileURLToPath(import.meta.url));
const seedData = join(here, '..', 'seed', 'data');

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};

export function expectedDocument(dataDir = seedData) {
  return normalize(readFileSync(join(dataDir, 'legacy_ledger.csv'), 'utf8'), JSON.parse(readFileSync(join(dataDir, 'posts.json'), 'utf8')));
}

/**
 * Compact JSON only. JSON.parse accepts `1250.0` (same number as `1250`), duplicate keys (last wins) and
 * insignificant whitespace. None of those is the canonical document JSON.stringify emits, so each is a refusal
 * of its own, before any section comparison.
 */
function strictParse(text) {
  let i = 0;
  const n = text.length;
  const fail = (code) => { const e = new Error(code); e.code = code; throw e; };
  const ws = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t';
  const ch = () => text[i];
  const parseValue = () => {
    if (i >= n) fail('not_json');
    const c = ch();
    if (ws(c)) fail('whitespace');
    if (c === '{') return parseObject();
    if (c === '[') return parseArray();
    if (c === '"') return parseString();
    if (c === 't' || c === 'f' || c === 'n') return parseLiteral();
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
    fail('not_json');
  };
  function parseObject() {
    i += 1;
    const obj = Object.create(null);
    if (i >= n) fail('not_json');
    if (ws(ch())) fail('whitespace');
    if (ch() === '}') { i += 1; return obj; }
    for (;;) {
      if (i >= n || ch() !== '"') fail('not_json');
      const key = parseString();
      if (i >= n || ws(ch())) fail(i < n && ws(ch()) ? 'whitespace' : 'not_json');
      if (ch() !== ':') fail('not_json');
      i += 1;
      if (i >= n) fail('not_json');
      if (ws(ch())) fail('whitespace');
      const value = parseValue();
      if (Object.prototype.hasOwnProperty.call(obj, key)) fail('duplicate_key');
      obj[key] = value;
      if (i >= n) fail('not_json');
      if (ws(ch())) fail('whitespace');
      if (ch() === '}') { i += 1; return obj; }
      if (ch() !== ',') fail('not_json');
      i += 1;
      if (i >= n) fail('not_json');
      if (ws(ch())) fail('whitespace');
    }
  }
  function parseArray() {
    i += 1;
    const arr = [];
    if (i >= n) fail('not_json');
    if (ws(ch())) fail('whitespace');
    if (ch() === ']') { i += 1; return arr; }
    for (;;) {
      arr.push(parseValue());
      if (i >= n) fail('not_json');
      if (ws(ch())) fail('whitespace');
      if (ch() === ']') { i += 1; return arr; }
      if (ch() !== ',') fail('not_json');
      i += 1;
      if (i >= n) fail('not_json');
      if (ws(ch())) fail('whitespace');
    }
  }
  function parseString() {
    i += 1;
    let out = '';
    while (i < n) {
      const c = ch();
      if (c === '"') { i += 1; return out; }
      if (c === '\\') {
        i += 1;
        if (i >= n) fail('not_json');
        const e = ch();
        const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (Object.prototype.hasOwnProperty.call(map, e)) { out += map[e]; i += 1; continue; }
        if (e === 'u') {
          const hex = text.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('not_json');
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 5;
          continue;
        }
        fail('not_json');
      }
      if (c < ' ') fail('not_json');
      out += c;
      i += 1;
    }
    fail('not_json');
  }
  function parseLiteral() {
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    if (text.startsWith('null', i)) { i += 4; return null; }
    fail('not_json');
  }
  function parseNumber() {
    const start = i;
    if (ch() === '-') i += 1;
    if (i >= n || ch() < '0' || ch() > '9') fail('not_json');
    if (ch() === '0') i += 1;
    else while (i < n && ch() >= '0' && ch() <= '9') i += 1;
    if (i < n && ch() === '.') {
      i += 1;
      if (i >= n || ch() < '0' || ch() > '9') fail('not_json');
      while (i < n && ch() >= '0' && ch() <= '9') i += 1;
    }
    if (i < n && (ch() === 'e' || ch() === 'E')) {
      i += 1;
      if (i < n && (ch() === '+' || ch() === '-')) i += 1;
      if (i >= n || ch() < '0' || ch() > '9') fail('not_json');
      while (i < n && ch() >= '0' && ch() <= '9') i += 1;
    }
    const lexeme = text.slice(start, i);
    let value;
    try { value = JSON.parse(lexeme); } catch { fail('not_json'); }
    if (typeof value !== 'number' || Number.isFinite(value) !== true) fail('not_json');
    /* `1250.0`, `1250.00` and `1.25e3` are the same number as `1250` and are not the canonical spelling. */
    if (JSON.stringify(value) !== lexeme) fail('noncanonical_number');
    return value;
  }
  const value = parseValue();
  if (i !== n) fail(ws(ch()) ? 'whitespace' : 'not_json');
  return value;
}

function wantDocument(dataDir) {
  if (dataDir !== null && typeof dataDir === 'object' && typeof dataDir.ledgerPath === 'string' && typeof dataDir.postsPath === 'string') {
    return normalize(readFileSync(dataDir.ledgerPath, 'utf8'), JSON.parse(readFileSync(dataDir.postsPath, 'utf8')));
  }
  return expectedDocument(dataDir);
}

export function checkArtifact(artifactText, dataDir = seedData) {
  const failed = [];
  if (typeof artifactText !== 'string' || artifactText.length === 0) return { pass: false, output: 'artifact_missing', failed: ['artifact'] };
  if (artifactText.length > MAX_ARTIFACT_CHARS) failed.push('artifact_too_long');
  if (artifactText !== artifactText.trim() || artifactText.includes('\n')) failed.push('not_a_single_compact_line');
  let doc;
  try { doc = strictParse(artifactText); } catch (e) {
    const code = e instanceof Error && (e.code === 'whitespace' || e.code === 'noncanonical_number' || e.code === 'duplicate_key') ? e.code : 'not_json';
    return { pass: false, output: code, failed: [...failed, code] };
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return { pass: false, output: 'not_an_object', failed: ['not_an_object'] };
  const want = wantDocument(dataDir);
  const wantKeys = Object.keys(want).sort().join(',');
  if (Object.keys(doc).sort().join(',') !== wantKeys) failed.push('top_level_keys');
  for (const section of ['schema', 'records', 'rejects', 'totals', 'counts']) {
    if (stable(doc[section]) !== stable(want[section])) failed.push(section);
  }
  /* Order matters for records and rejects (the rules sort them), and stable() preserves array order. */
  const pass = failed.length === 0;
  return { pass, output: pass ? 'pass' : `fail:${failed.join(',')}`, failed };
}

/* CLI contract of the frozen reviewer checker. Runs only when this file is the process entry, so a test import does not grade. */
function runningAsMain() {
  const arg = process.argv[1];
  if (typeof arg !== 'string' || arg === '') return false;
  try { return import.meta.url === pathToFileURL(realpathSync(arg)).href; } catch { return false; }
}

if (runningAsMain()) {
  const args = process.argv.slice(2);
  const shaOk = typeof args[4] === 'string' && /^[0-9a-f]{64}$/.test(args[4]);
  if (args.length !== 5 || args[3] !== '--expect-self-sha256' || !shaOk) process.exit(2);
  const selfBytes = readFileSync(fileURLToPath(import.meta.url));
  const selfSha = createHash('sha256').update(selfBytes).digest('hex');
  if (selfSha !== args[4]) {
    process.stdout.write(`checker_sha256=${selfSha}\n`);
    process.exit(3);
  }
  const artifact = readFileSync(args[0], 'utf8');
  const judged = createHash('sha256').update(artifact.trim(), 'utf8').digest('hex');
  const result = checkArtifact(artifact, { ledgerPath: args[1], postsPath: args[2] });
  process.stdout.write(`checker_sha256=${selfSha}\njudged_trimmed_sha256=${judged}\n`);
  if (result.pass === true) {
    process.stdout.write('PASS\n');
    process.exit(0);
  }
  process.stdout.write(`FAILED_SECTIONS: ${result.failed.join(',')}\nFAIL\n`);
  process.exit(1);
}
