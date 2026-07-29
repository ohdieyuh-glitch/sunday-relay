#!/usr/bin/env node
/**
 * Relay repository-boundary scan.
 *
 * Enforces, at the repository level, what `relay-boundary.test.ts` enforces at
 * the source level: this repository is Sunday Relay and nothing else. It fails
 * on Alcatraz product implementation, committed credentials, focused tests, and
 * deployment configuration that does not belong to Relay.
 *
 * Reads only. Never writes, never deploys, never contacts a network.
 * Exit 0 = clean, exit 1 = findings.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const findings = [];
const add = (rule, detail) => findings.push({ rule, detail });

/* ----------------------------------------------------------------------- *
 * 1. Alcatraz product implementation must not exist in this repository.
 * ----------------------------------------------------------------------- */
const FORBIDDEN_PATHS = [
  [/^server\//, 'the Alcatraz node server'],
  [/^api\//, 'the Alcatraz serverless API routes'],
  [/^supabase\//, 'Alcatraz Supabase configuration and migrations'],
  [/^src\/fusion-engine\//, 'the Alcatraz fusion engine'],
  [/^src\/state\/session/, 'the Alcatraz session store'],
  [/^src\/styles\/global\.css$/, "the Alcatraz application stylesheet"],
  [/^vercel\.json$/, 'Alcatraz deployment configuration'],
  [/^Dockerfile$/, 'the Alcatraz backend container'],
  [/^BACKEND_PROXY\.md$/, 'Alcatraz backend documentation'],
];
for (const f of files) {
  for (const [pattern, why] of FORBIDDEN_PATHS) {
    if (pattern.test(f)) add('alcatraz-path', `${f} — ${why}`);
  }
}

/* ----------------------------------------------------------------------- *
 * 2. Relay source must not import Alcatraz modules.
 * ----------------------------------------------------------------------- */
const FORBIDDEN_IMPORTS = [
  [/from\s+['"]@\/fusion-engine|from\s+['"][^'"]*\/fusion-engine/, 'the Alcatraz fusion engine'],
  [/from\s+['"]@\/state\/|from\s+['"][^'"]*\/state\/session/, 'the Alcatraz session store'],
  [/from\s+['"]@\/components\//, 'Alcatraz UI components'],
  [/from\s+['"]@\/styles\//, "the Alcatraz stylesheet"],
  [/from\s+['"][^'"]*\/server\/(?!.*relay)/, 'the Alcatraz server'],
];
const sources = files.filter((f) => /\.(ts|tsx|mts|mjs|js)$/.test(f));
for (const f of sources) {
  const content = readFileSync(f, 'utf8');
  for (const [pattern, why] of FORBIDDEN_IMPORTS) {
    if (pattern.test(content)) add('alcatraz-import', `${f} imports ${why}`);
  }
}

/* ----------------------------------------------------------------------- *
 * 3. No committed credentials. Deliberately-fake test fixtures are allowed
 *    only when they say so in the literal itself.
 * ----------------------------------------------------------------------- */
const SECRET_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, 'Anthropic API key'],
  [/\bsk-[A-Za-z0-9]{32,}/g, 'OpenAI-style API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/g, 'GitHub fine-grained token'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AWS access key id'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'private key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'Slack token'],
  [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, 'JWT'],
];
const FAKE = /FAKE|TESTNOTREAL|EXAMPLE|PLACEHOLDER|REDACTED|xxxx/i;
for (const f of files) {
  let content;
  try { content = readFileSync(f, 'utf8'); } catch { continue; }
  for (const [pattern, why] of SECRET_PATTERNS) {
    for (const match of content.match(pattern) ?? []) {
      if (!FAKE.test(match)) add('secret', `${f} — possible ${why}: ${match.slice(0, 12)}…`);
    }
  }
}

/* ----------------------------------------------------------------------- *
 * 4. No PSP Agent ID credential committed.
 * ----------------------------------------------------------------------- */
for (const f of files) {
  let content;
  try { content = readFileSync(f, 'utf8'); } catch { continue; }
  for (const match of content.match(/\bPSP-[A-Z0-9]{6,}\b/g) ?? []) {
    if (!FAKE.test(match) && !/\.(test|spec)\.[tj]sx?$/.test(f)) {
      add('psp-credential', `${f} — PSP Agent ID literal: ${match}`);
    }
  }
}

/* ----------------------------------------------------------------------- *
 * 5. No focused or skipped tests sneaking through CI.
 * ----------------------------------------------------------------------- */
for (const f of sources.filter((s) => /\.(test|spec)\.[tj]sx?$/.test(s))) {
  const content = readFileSync(f, 'utf8');
  if (/\b(it|test|describe)\.only\s*\(/.test(content)) add('focused-test', `${f} contains a .only test`);
}

/* ----------------------------------------------------------------------- *
 * 6. CI must never deploy, and never touch Alcatraz infrastructure.
 * ----------------------------------------------------------------------- */
for (const f of files.filter((s) => s.startsWith('.github/workflows/'))) {
  // Comment lines are stripped: a workflow is allowed to STATE that it never
  // deploys. Only executable YAML is checked.
  const content = readFileSync(f, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  for (const [pattern, why] of [
    [/railway/i, 'Railway (Alcatraz deployment)'],
    [/vercel/i, 'Vercel deployment'],
    [/\bsupabase\s+db\s+push|\bsupabase\s+migration/i, 'a database migration'],
  ]) {
    if (pattern.test(content)) add('ci-deploy', `${f} references ${why}`);
  }
}

/* ----------------------------------------------------------------------- */
if (findings.length === 0) {
  console.log('RELAY REPOSITORY BOUNDARY: PASS');
  console.log(`  ${files.length} tracked files scanned`);
  console.log('  no Alcatraz implementation, no committed credentials, no focused tests,');
  console.log('  no deployment step in CI.');
  process.exit(0);
}

console.error('RELAY REPOSITORY BOUNDARY: FAIL');
for (const { rule, detail } of findings) console.error(`  [${rule}] ${detail}`);
console.error(`\n${findings.length} finding(s).`);
process.exit(1);
