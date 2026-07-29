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
/**
 * Paths that are ALWAYS Relay's own, whatever they are named. Checked first,
 * so a legitimate Relay backend is never rejected: the boundary is PRODUCT
 * PURITY, not "no backend forever". `relay-bridge/server.ts` is Relay's local
 * bridge server and belongs here; `server/` at the repository root is
 * Alcatraz's node server and does not.
 */
const RELAY_OWNED_PREFIXES = ['relay-bridge/', 'src/relay/', 'scripts/relay-', 'docs/relay/'];
const isRelayOwned = (f) => RELAY_OWNED_PREFIXES.some((prefix) => f.startsWith(prefix));

const FORBIDDEN_PATHS = [
  // Alcatraz product implementation, wherever it is rooted.
  [/^server\//, 'the Alcatraz node server'],
  [/^src\/server\//, 'an Alcatraz server implementation under src/'],
  [/^api\//, 'the Alcatraz serverless API routes'],
  [/^src\/api\//, 'Alcatraz API routes under src/'],
  [/^supabase\//, 'Alcatraz Supabase configuration and migrations'],
  [/^src\/supabase\//, 'Alcatraz Supabase configuration under src/'],
  [/(^|\/)migrations\//, 'database migrations (Relay owns no database)'],
  [/^src\/fusion-engine\//, 'the Alcatraz fusion engine'],
  [/^(packages|apps)\/[^/]*(fusion|alcatraz)/i, 'an Alcatraz/Fusion package or app'],
  [/^src\/state\/session/, 'the Alcatraz session store'],
  [/^src\/styles\/global\.css$/, 'the Alcatraz application stylesheet'],
  [/^BACKEND_PROXY\.md$/, 'Alcatraz backend documentation'],
  // Deployment configuration, at ANY depth — Relay deploys from nowhere yet,
  // and never from this repository (governance §9).
  [/^vercel\.json$|(^|\/)vercel\.json$/, 'Vercel deployment configuration'],
  [/(^|\/)\.vercel\//, 'a Vercel project directory'],
  [/(^|\/)netlify\.toml$/, 'Netlify deployment configuration'],
  [/(^|\/)fly\.toml$/, 'Fly.io deployment configuration'],
  [/(^|\/)render\.yaml$/, 'Render deployment configuration'],
  [/(^|\/)railway\.(json|toml)$/, 'Railway deployment configuration'],
  [/(^|\/)Dockerfile(\.[\w-]+)?$/, 'a container build file'],
  [/(^|\/)docker-compose(\.[\w-]+)?\.ya?ml$/, 'a container orchestration file'],
  [/(^|\/)(k8s|kubernetes)\//, 'Kubernetes manifests'],
];
for (const f of files) {
  if (isRelayOwned(f)) continue;   // Relay's own code is never a boundary hit
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
 * 3. No committed credentials.
 *
 * Coverage is deliberate and BOUNDED — see the banner, which names exactly
 * what was checked. This is a committed-credential tripwire for the shapes
 * below, not a general secret scanner, and it does not claim to be one.
 * ----------------------------------------------------------------------- */
const SECRET_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, 'Anthropic API key'],
  // Modern OpenAI keys carry hyphenated prefixes (sk-proj-, sk-svcacct-), so
  // the legacy `sk-[A-Za-z0-9]{32,}` class alone missed every current key.
  [/\bsk-(proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/g, 'OpenAI project/service key'],
  [/\bsk-[A-Za-z0-9]{32,}/g, 'OpenAI-style API key'],
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{16,}/g, 'Stripe key'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, 'Google API key'],
  [/\bnpm_[A-Za-z0-9]{30,}/g, 'npm access token'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/g, 'GitHub fine-grained token'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AWS access key id'],
  [/\b(aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}/g, 'AWS secret access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'private key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'Slack token'],
  [/\bhooks\.slack\.com\/services\/T[A-Za-z0-9_/]{20,}/g, 'Slack webhook URL'],
  [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, 'JWT (incl. Supabase service-role)'],
  [/\b(SUPABASE_SERVICE_ROLE_KEY|service_role_key)\s*[:=]\s*['"]?[A-Za-z0-9._-]{20,}/g, 'Supabase service-role assignment'],
  // A database URL that embeds a password in the userinfo component.
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s:/@]{6,}@[^\s/]+/g, 'connection URL with inline credentials'],
  [/\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|GROQ_API_KEY|MISTRAL_API_KEY)\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/g,
    'provider key environment assignment'],
];

/**
 * SYNTHETIC-FIXTURE ALLOWANCE.
 *
 * The repository convention is that a deliberately-fake credential says so IN
 * THE LITERAL, canonically `FAKETESTNOTREAL`. The previous rule tested a
 * generic marker word against the greedy match, which meant appending `-FAKE`
 * to a REAL key silenced the finding while the usable key stayed committed.
 *
 * So a marker is necessary but NOT sufficient: after removing every marker
 * word, whatever REMAINS must itself still look synthetic. Real key material
 * is long and character-diverse; a placeholder is short, repetitive, or a
 * sequential run. A genuine key with a marker glued on keeps its high-entropy
 * residue and is still reported.
 */
const FIXTURE_MARKERS = /FAKETESTNOTREAL|FAKETEST|NOTREAL|PLACEHOLDER|REDACTED|EXAMPLE|SAMPLE|DUMMY|FAKE|TEST|X{4,}|x{4,}/g;

const SEQUENTIAL = 'abcdefghijklmnopqrstuvwxyz0123456789';
const isSequentialRun = (value) => {
  const lower = value.toLowerCase();
  if (lower.length < 4) return true;
  return SEQUENTIAL.includes(lower) || SEQUENTIAL.repeat(2).includes(lower);
};

/** Does the residue left after stripping markers still look like real key
 * material? Long AND character-diverse AND not a sequential/repeating run. */
function residueLooksReal(residue) {
  const core = residue.replace(/[^A-Za-z0-9]/g, '');
  if (core.length < 16) return false;
  if (isSequentialRun(core)) return false;
  const distinct = new Set(core).size;
  return distinct >= 10;
}

/**
 * Structural prefixes are NOT secret material: `sk-`, `AKIA`, an env-var
 * assignment head. They are stripped before the residue is judged, so a short
 * placeholder is not mistaken for a real key just because its vendor prefix
 * pushed it over the length threshold.
 */
const STRUCTURAL_PREFIX = new RegExp(
  '^(?:[A-Z_][A-Z0-9_]*\\s*[:=]\\s*[\'"]?)?'
  + '(?:sk-ant-|sk-(?:proj|svcacct|admin)-|sk-|(?:sk|rk|pk)_(?:live|test)_|AIza|npm_'
  + '|gh[pousr]_|github_pat_|AKIA|xox[baprs]-|PSP-AGENT-[A-Za-z0-9]+-[A-Za-z0-9]+-)?',
);

/**
 * An EXPLICIT, auditable allowance for a synthetic fixture whose value cannot
 * carry a marker without changing what the test proves. It must be written on
 * the same line as the literal, so it is impossible to apply accidentally and
 * trivial to grep for in review.
 */
const FIXTURE_ANNOTATION = 'relay-boundary:allow-fixture';

/**
 * A match is an allowed synthetic fixture when it is explicitly annotated, or
 * when it is MARKED and its marker-stripped, prefix-stripped residue is not
 * real-looking. The residue test is what closes the laundering hole: gluing
 * `-FAKE` onto a genuine key leaves high-entropy material behind, so the
 * finding still fires.
 */
function isSyntheticFixture(match, line) {
  if (line && line.includes(FIXTURE_ANNOTATION)) return true;
  FIXTURE_MARKERS.lastIndex = 0;
  if (!FIXTURE_MARKERS.test(match)) return false;
  const residue = match.replace(STRUCTURAL_PREFIX, '').replace(FIXTURE_MARKERS, '');
  return !residueLooksReal(residue);
}

/** The source line a match sits on, so an annotation can be honoured. */
function lineOf(content, match) {
  const index = content.indexOf(match);
  if (index < 0) return '';
  const start = content.lastIndexOf('\n', index) + 1;
  const end = content.indexOf('\n', index);
  return content.slice(start, end < 0 ? undefined : end);
}

for (const f of files) {
  let content;
  try { content = readFileSync(f, 'utf8'); } catch { continue; }
  for (const [pattern, why] of SECRET_PATTERNS) {
    for (const match of content.match(pattern) ?? []) {
      if (!isSyntheticFixture(match, lineOf(content, match))) {
        add('secret', `${f} — possible ${why}: ${match.slice(0, 12)}…`);
      }
    }
  }
}

/* ----------------------------------------------------------------------- *
 * 4. No PSP Agent ID credential committed.
 *
 * The product's Agent IDs are shaped `PSP-AGENT-<version>-<prefix>-<secret>`,
 * so the old `PSP-[A-Z0-9]{6,}` class (no hyphens) never matched a real one.
 * Test files are no longer blanket-exempt — a real credential in a test file
 * is still a committed credential; it must carry a fixture marker like any
 * other synthetic value.
 * ----------------------------------------------------------------------- */
const PSP_PATTERNS = [
  /\bPSP-AGENT-[A-Za-z0-9]+-[A-Za-z0-9]+-[A-Za-z0-9_-]{8,}/g,
  /\bPSP-[A-Z0-9]{6,}\b/g,
];
for (const f of files) {
  let content;
  try { content = readFileSync(f, 'utf8'); } catch { continue; }
  for (const pattern of PSP_PATTERNS) {
    for (const match of content.match(pattern) ?? []) {
      if (!isSyntheticFixture(match, lineOf(content, match))) {
        add('psp-credential', `${f} — PSP Agent ID literal: ${match.slice(0, 24)}…`);
      }
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
 *
 * Matched against ACTIVE DEPLOYMENT BEHAVIOUR — a verb, an action, a
 * credential — not against the mere mention of a vendor. Naming Vercel in a
 * step title or stating that a workflow never deploys is policy prose and
 * must not fail the scan; running `vercel deploy` must.
 * ----------------------------------------------------------------------- */
const DEPLOY_PATTERNS = [
  [/\bnpx\s+vercel\b|\bvercel\s+(deploy|build|pull|link|env)\b/i, 'a Vercel deployment command'],
  [/\brailway\s+(up|deploy|run|link|service)\b/i, 'a Railway deployment command'],
  [/\bflyctl\s+\w|\bfly\s+(deploy|launch|secrets)\b/i, 'a Fly.io deployment command'],
  [/\bnetlify\s+(deploy|build|link|env)\b/i, 'a Netlify deployment command'],
  [/\bwrangler\s+(deploy|publish|secret)\b/i, 'a Cloudflare Wrangler deployment command'],
  [/\baws\s+(s3\s+sync|cloudformation|ecs|lambda\s+update|elasticbeanstalk|amplify)\b/i, 'an AWS deployment command'],
  [/\bgcloud\s+(app\s+deploy|run\s+deploy|functions\s+deploy|builds\s+submit)\b/i, 'a Google Cloud deployment command'],
  [/\bdocker\s+push\b|\bdocker\s+buildx\s+build[^\n]*--push/i, 'a container image push'],
  [/\bkubectl\s+(apply|rollout|set\s+image)\b/i, 'a Kubernetes deployment command'],
  [/\bhelm\s+(install|upgrade)\b/i, 'a Helm release'],
  [/\bsupabase\s+db\s+push\b|\bsupabase\s+migration\b|\bsupabase\s+link\b/i, 'a database migration or project link'],
  [/\bcurl[^\n]*(deploy[-_]?hook|hooks\.(vercel|netlify|render)\.com|api\.render\.com\/deploy)/i, 'a deployment webhook call'],
  [/^\s*-?\s*uses:\s*(amondnet\/vercel-action|nwtgck\/actions-netlify|superfly\/flyctl|cloudflare\/wrangler-action|akhileshns\/heroku-deploy|bervProject\/railway-deployment)/i,
    'a third-party deployment action'],
  [/\bgit\s+push\b[^\n]*\bturbo-broccoli\b|\bgh\s+workflow\s+run\b[^\n]*turbo-broccoli/i, 'an Alcatraz repository operation'],
];

/** Same explicit, auditable shape as the fixture allowance. */
const DEPLOY_ANNOTATION = 'relay-boundary:allow-mention';

for (const f of files.filter((s2) => s2.startsWith('.github/workflows/'))) {
  // Full-line comments are stripped: a workflow is allowed to STATE that it
  // never deploys. Only executable YAML is checked.
  const lines = readFileSync(f, 'utf8').split('\n').filter((line) => !/^\s*#/.test(line));
  for (const [index, line] of lines.entries()) {
    if (line.includes(DEPLOY_ANNOTATION)) continue;
    for (const [pattern, why] of DEPLOY_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) add('ci-deploy', `${f}:${index + 1} — ${why}`);
    }
  }
}

/* ----------------------------------------------------------------------- */
if (findings.length === 0) {
  // The banner states exactly what was checked. It deliberately does NOT
  // claim universal credential detection: this is a tripwire for the shapes
  // enumerated above, and a determined committer of an unlisted secret format
  // will not be caught by it.
  console.log('RELAY REPOSITORY BOUNDARY: PASS');
  console.log(`  ${files.length} tracked files scanned`);
  console.log(`  no Alcatraz implementation or deployment config at ${FORBIDDEN_PATHS.length} forbidden path patterns`);
  console.log(`  no Relay source importing Alcatraz modules (${FORBIDDEN_IMPORTS.length} import rules)`);
  console.log(`  no committed credential matching ${SECRET_PATTERNS.length} known key/token shapes`);
  console.log(`     (shape tripwire, NOT universal secret detection; ${'`'}${FIXTURE_ANNOTATION}${'`'} marks reviewed fixtures)`);
  console.log('  no production-shaped PSP Agent ID literal');
  console.log('  no .only test');
  console.log(`  no active deployment command in any workflow (${DEPLOY_PATTERNS.length} behaviours checked)`);
  process.exit(0);
}

console.error('RELAY REPOSITORY BOUNDARY: FAIL');
for (const { rule, detail } of findings) console.error(`  [${rule}] ${detail}`);
console.error(`\n${findings.length} finding(s).`);
process.exit(1);
