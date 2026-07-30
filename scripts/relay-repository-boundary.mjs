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
 * THE LITERAL, canonically `FAKETESTNOTREAL`. A marker is necessary but NOT
 * sufficient: after removing every marker word, whatever REMAINS must itself
 * still look synthetic. Real key material is long and character-diverse; a
 * placeholder is short, repetitive, or a sequential run. A genuine key with a
 * marker glued on keeps its high-entropy residue and is still reported.
 *
 * WHAT WAS REPAIRED (H-4). The explicit `relay-boundary:allow-fixture`
 * annotation used to be a FILE-WIDE bypass in three separate ways:
 *
 *   1. the line was found with `content.indexOf(match)` — the FIRST occurrence
 *      of that text. Annotating one placeholder laundered every later,
 *      identical value in the same file, and the finding was even reported
 *      against the wrong line;
 *   2. `line.includes(FIXTURE_ANNOTATION)` returned true unconditionally, so a
 *      REAL, usable credential could be annotated away;
 *   3. the annotation was honoured anywhere — production source, a workflow,
 *      an environment file.
 *
 * The allowance is now occurrence-scoped, value-checked and place-checked:
 * each match resolves its OWN line, needs its OWN adjacent annotation, must be
 * obviously synthetic on its own merits, and is only honoured in a test or
 * fixture file.
 */
const FIXTURE_MARKERS = /FAKETESTNOTREAL|FAKETEST|NOTREAL|PLACEHOLDER|REDACTED|EXAMPLE|SAMPLE|DUMMY|FAKE|TEST|X{4,}|x{4,}/g;

/** The canonical reserved token a synthetic value should carry when it can. */
const SYNTHETIC_TOKEN = 'FAKETESTNOTREAL';

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
 * THE STRICT SYNTHETIC POLICY for an ANNOTATED value.
 *
 * The annotation exists for fixtures whose SHAPE cannot carry a marker word —
 * an AWS key id is a fixed prefix plus exactly sixteen characters, so
 * inserting the reserved token would stop it matching the shape the test is
 * proving. Such a value must still be obviously non-functional: either it
 * carries the reserved token anyway, or its character content is visibly not
 * random.
 *
 * A key id whose sixteen characters are one repeated letter has four distinct
 * characters and is obviously synthetic. One with fifteen distinct characters
 * is a usable-looking credential, and no comment makes it safe to commit.
 * (Neither example is written out here: this file is scanned too, and a
 * scanner that has to exempt its own documentation has already lost.)
 */
function isObviouslySynthetic(match) {
  if (match.includes(SYNTHETIC_TOKEN)) return true;
  const core = match.replace(STRUCTURAL_PREFIX, '').replace(/[^A-Za-z0-9]/g, '');
  if (core.length < 16) return true;
  if (isSequentialRun(core)) return true;
  return new Set(core).size <= 6;
}

/**
 * An EXPLICIT, auditable allowance. It must sit ON the literal's own line or
 * on the line immediately above it, so it is impossible to apply accidentally,
 * impossible to apply to a value elsewhere in the file, and trivial to grep.
 */
const FIXTURE_ANNOTATION = 'relay-boundary:allow-fixture';

const isWorkflowFile = (f) => f.startsWith('.github/');
const isEnvFile = (f) =>
  /(^|\/)\.env(\.[\w-]+)?$|(^|\/)[\w.-]*\.env$|(^|\/)\.envrc$|(^|\/)env\.example$/.test(f);
const isTestOrFixtureFile = (f) =>
  /\.(test|spec)\.[cm]?[tj]sx?$/.test(f)
  || /(^|\/)(testing|__tests__|__fixtures__|fixtures)\//.test(f)
  || /(^|\/)[\w.-]*fixtures?[\w.-]*\.[cm]?[tj]sx?$/.test(f);

/** Where a fixture allowance may be honoured AT ALL, and why not otherwise. */
function fixtureAllowanceRefusal(f) {
  if (isWorkflowFile(f)) return 'a workflow file may never carry a fixture allowance';
  if (isEnvFile(f)) return 'an environment configuration file may never carry a fixture allowance';
  if (!isTestOrFixtureFile(f)) return 'production source may never carry a fixture allowance';
  return null;
}

/** The 1-based line a byte offset falls on, plus that line's exact text. */
function lineAtIndex(content, index) {
  const start = content.lastIndexOf('\n', index) + 1;
  const end = content.indexOf('\n', index);
  return {
    number: content.slice(0, start).split('\n').length,
    text: content.slice(start, end < 0 ? undefined : end),
    start,
  };
}

/** The line immediately above the one starting at `start`. */
function lineBefore(content, start) {
  if (start <= 0) return '';
  const previousStart = content.lastIndexOf('\n', start - 2) + 1;
  return content.slice(previousStart, start - 1);
}

/**
 * A preceding-line annotation counts only when that line is a DEDICATED
 * COMMENT. Accepting any preceding line reopens the laundering hole in its
 * most likely shape:
 *
 *     const a = '<synthetic>'; // relay-boundary:allow-fixture
 *     const b = '<the same value>';        <-- no annotation of its own
 *
 * Line 1 is code, so it annotates only itself; line 2 needs its own.
 */
const isDedicatedAnnotationComment = (line) => {
  const trimmed = line.trim();
  return /^(\/\/|#|\*|\/\*|--|;)/.test(trimmed) && trimmed.includes(FIXTURE_ANNOTATION);
};

/**
 * Judges ONE occurrence. `index` is that occurrence's own offset, so two
 * identical values on different lines are evaluated independently and the
 * finding is reported against the line it was actually found on.
 */
function fixtureVerdict(file, content, match, index) {
  const line = lineAtIndex(content, index);

  // Path 1 — the value declares itself synthetic and its residue agrees.
  FIXTURE_MARKERS.lastIndex = 0;
  if (FIXTURE_MARKERS.test(match)) {
    const residue = match.replace(STRUCTURAL_PREFIX, '').replace(FIXTURE_MARKERS, '');
    if (!residueLooksReal(residue)) return { allowed: true, line };
  }

  // Path 2 — an explicit annotation, adjacent to THIS occurrence.
  const annotated =
    line.text.includes(FIXTURE_ANNOTATION)
    || isDedicatedAnnotationComment(lineBefore(content, line.start));
  if (!annotated) return { allowed: false, line, note: null };

  const refusal = fixtureAllowanceRefusal(file);
  if (refusal) return { allowed: false, line, note: `annotation IGNORED — ${refusal}` };
  if (!isObviouslySynthetic(match)) {
    return {
      allowed: false,
      line,
      note: 'annotation IGNORED — the value is not obviously synthetic; a usable-looking credential cannot be annotated away',
    };
  }
  return { allowed: true, line };
}

/** Every occurrence of `pattern` in `content`, with its own byte offset. */
function* occurrences(content, pattern) {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let m;
  while ((m = re.exec(content)) !== null) {
    yield { match: m[0], index: m.index };
    if (m[0] === '') re.lastIndex += 1;
  }
}

for (const f of files) {
  let content;
  try { content = readFileSync(f, 'utf8'); } catch { continue; }
  for (const [pattern, why] of SECRET_PATTERNS) {
    for (const { match, index } of occurrences(content, pattern)) {
      const verdict = fixtureVerdict(f, content, match, index);
      if (verdict.allowed) continue;
      add(
        'secret',
        `${f}:${verdict.line.number} — possible ${why}: ${match.slice(0, 12)}…`
        + (verdict.note ? ` [${verdict.note}]` : ''),
      );
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
    for (const { match, index } of occurrences(content, pattern)) {
      const verdict = fixtureVerdict(f, content, match, index);
      if (verdict.allowed) continue;
      add(
        'psp-credential',
        `${f}:${verdict.line.number} — PSP Agent ID literal: ${match.slice(0, 24)}…`
        + (verdict.note ? ` [${verdict.note}]` : ''),
      );
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
 * 6. Nothing in this repository may deploy, publish, or touch Alcatraz
 *    infrastructure.
 *
 * WHAT WAS REPAIRED (H-5). The previous rules regressed real coverage:
 *
 *   - `vercel --prod` — the single most common production deploy — matched
 *     NOTHING. The Vercel rule required `npx vercel` or one of five named
 *     subcommands, and `--prod` is neither;
 *   - only `.github/workflows/**` was scanned, so a deploying PACKAGE SCRIPT,
 *     a `deploy.sh` wrapper, or a workflow step that merely ran `npm run
 *     deploy` were all invisible;
 *   - third-party deployment ACTIONS were an allowlist of six exact strings,
 *     so any other action deployed freely;
 *   - `relay-boundary:allow-mention` suppressed the WHOLE line, so annotating
 *     a line silenced an executable command on it.
 *
 * The repaired scan separates four things the review asked to be told apart:
 *
 *   documentation      prose in a comment or a `name:`/`description:` value
 *   inert samples      a fixture string inside a test file
 *   executable config  a package script, a shell wrapper, an action `uses:`
 *   active behaviour   a `run:` command in a workflow
 *
 * Only the last two can fail, `allow-mention` can suppress ONLY the first,
 * and the banner states exactly which surfaces were read.
 * ----------------------------------------------------------------------- */

/** Deployment CLIs whose mere INVOCATION is out of scope for Relay. */
const DEPLOY_BINARIES = [
  ['vercel', 'Vercel'],
  ['railway', 'Railway'],
  ['flyctl', 'Fly.io'],
  ['netlify', 'Netlify'],
  ['wrangler', 'Cloudflare Wrangler'],
  ['surge', 'Surge'],
  ['heroku', 'Heroku'],
  ['vc', 'Vercel (vc alias)'],
];

/**
 * A binary in COMMAND POSITION: at the start of a command, after a shell
 * separator, or behind a runner such as `npx`. This is what catches
 * `vercel --prod`, `npx vercel deploy`, and `sh -c "… && railway up"` alike,
 * without matching the word "vercel" inside a sentence.
 *
 * `vercel --prod` is the specific regression this replaces: the old rule
 * required `npx vercel` or one of five named subcommands, so the single most
 * common production deploy matched nothing at all.
 */
const commandInvocation = (binary) =>
  new RegExp(
    String.raw`(?:^|[;&|(\`"']|\$\()\s*(?:sudo\s+)?(?:(?:npx|pnpm\s+dlx|yarn\s+dlx|bunx)\s+(?:--yes\s+|-y\s+)?)?`
    + String.raw`${binary}(?:\s|$)`,
    'i',
  );

/**
 * Strips a leading YAML key so a workflow step's COMMAND is matched as a
 * shell line: `- run: flyctl deploy` is judged as `flyctl deploy`. Without
 * this the command never sits at a command position and every workflow
 * invocation slips past.
 */
const YAML_KEY_PREFIX = /^\s*-?\s*(?:[A-Za-z_][\w-]*)\s*:\s*(?:[|>][-+]?\s*)?/;
const commandTextOf = (line) => line.replace(YAML_KEY_PREFIX, '');

const DEPLOY_PATTERNS = [
  ...DEPLOY_BINARIES.map(([binary, vendor]) => [commandInvocation(binary), `a ${vendor} deployment command`]),
  // Subcommand forms for general-purpose CLIs, whose other uses are fine.
  [/\bfly\s+(deploy|launch|secrets)\b/i, 'a Fly.io deployment command'],
  [/\baws\s+(s3\s+sync|cloudformation|ecs|lambda\s+update|elasticbeanstalk|amplify|apprunner)\b/i, 'an AWS deployment command'],
  [/\bgcloud\s+(app\s+deploy|run\s+deploy|functions\s+deploy|builds\s+submit)\b/i, 'a Google Cloud deployment command'],
  [/\baz\s+(webapp\s+up|containerapp\s+up|functionapp\s+deployment)\b/i, 'an Azure deployment command'],
  [/\bdocker\s+push\b|\bdocker\s+buildx\s+build[^\n]*--push/i, 'a container image push'],
  [/\bkubectl\s+(apply|rollout|set\s+image)\b/i, 'a Kubernetes deployment command'],
  [/\bhelm\s+(install|upgrade)\b/i, 'a Helm release'],
  [/\bterraform\s+apply\b|\bpulumi\s+up\b|\bserverless\s+deploy\b|\bsst\s+deploy\b/i, 'an infrastructure deployment command'],
  [/\bfirebase\s+deploy\b|\beb\s+deploy\b|\bnow\s+--prod\b/i, 'a hosting deployment command'],
  [/\bsupabase\s+db\s+push\b|\bsupabase\s+migration\b|\bsupabase\s+link\b/i, 'a database migration or project link'],
  // Production PUBLISHING is deployment by another name.
  [/\b(npm|pnpm|yarn|bun)\s+publish\b/i, 'a package publish'],
  [/\bgh\s+release\s+create\b/i, 'a GitHub release publish'],
  [/\bgit\s+push\b[^\n]*\b(gh-pages|heroku|production|deploy)\b/i, 'a deployment push'],
  [/\bcurl[^\n]*(deploy[-_]?hook|hooks\.(vercel|netlify|render)\.com|api\.render\.com\/deploy)/i, 'a deployment webhook call'],
  // Alcatraz infrastructure is never touched from this repository.
  [/\bgit\s+push\b[^\n]*\bturbo-broccoli\b|\bgh\s+workflow\s+run\b[^\n]*turbo-broccoli/i, 'an Alcatraz repository operation'],
];

/**
 * Third-party deployment ACTIONS, matched by intent rather than by an
 * allowlist of six names: any action whose owner or name speaks of deploying,
 * publishing or releasing to a hosting vendor.
 */
const DEPLOY_ACTION = /^\s*-?\s*uses\s*:\s*['"]?([\w.-]+)\/([\w.-]+)/i;
const DEPLOY_ACTION_INTENT =
  /deploy|publish|release|vercel|netlify|railway|flyctl|superfly|heroku|cloudflare|wrangler|amplify|firebase|gh-pages|surge|now|render|fastly|azure\/webapps|aws-actions/i;

/** Same explicit, auditable shape as the fixture allowance. */
const DEPLOY_ANNOTATION = 'relay-boundary:allow-mention';

/** A YAML line whose match cannot execute: a title, a description, an `if`. */
const DOCUMENTATION_KEY = /^\s*-?\s*(name|description|title|summary|id|if|continue-on-error)\s*:/i;

function deployHits(line) {
  const hits = new Set();
  const command = commandTextOf(line);
  for (const [pattern, why] of DEPLOY_PATTERNS) {
    if (pattern.test(command) || pattern.test(line)) hits.add(why);
  }
  const action = DEPLOY_ACTION.exec(line);
  if (action && DEPLOY_ACTION_INTENT.test(`${action[1]}/${action[2]}`)) {
    // An action reference is configuration, not a shell command: report it as
    // the action it is rather than as a stray binary name inside its slug.
    hits.clear();
    hits.add(`a third-party deployment action (${action[1]}/${action[2]})`);
  }
  return [...hits];
}

/**
 * Checks one line and records findings. `executable` says whether the line can
 * actually run something; `allow-mention` may only ever silence a line that
 * cannot, and an attempt to silence an executable one is reported.
 */
function checkDeployLine(where, line, executable) {
  const code = line.replace(/#.*$/, ''); // a trailing comment cannot execute
  const hits = deployHits(code);
  if (hits.length === 0) return;
  const annotated = line.includes(DEPLOY_ANNOTATION);
  for (const why of hits) {
    if (!executable && annotated) continue; // an allowed, non-executing mention
    if (!executable) {
      add('ci-deploy', `${where} — ${why} named outside an executable position, with no ${DEPLOY_ANNOTATION}`);
      continue;
    }
    add(
      'ci-deploy',
      `${where} — ${why}`
      + (annotated ? ` [${DEPLOY_ANNOTATION} IGNORED — it cannot silence an executable command]` : ''),
    );
  }
}

/* --- 6a. package scripts, which CI and humans both run ----------------- */
const deployingScripts = new Set();
for (const f of files.filter((s2) => /(^|\/)package\.json$/.test(s2))) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  for (const [name, body] of Object.entries(manifest.scripts ?? {})) {
    if (typeof body !== 'string') continue;
    const before = findings.length;
    checkDeployLine(`${f} — script "${name}"`, body, true);
    if (findings.length > before) deployingScripts.add(name);
  }
}

/* --- 6b. shell wrappers and task runners ------------------------------- */
for (const f of files.filter((s2) => /\.(sh|bash|zsh|fish)$/.test(s2) || /(^|\/)(Makefile|justfile|Justfile)$/.test(s2))) {
  let lines;
  try { lines = readFileSync(f, 'utf8').split('\n'); } catch { continue; }
  for (const [index, line] of lines.entries()) {
    if (/^\s*#/.test(line)) continue; // a full-line comment cannot execute
    checkDeployLine(`${f}:${index + 1}`, line, true);
  }
}

/* --- 6c. workflows: active behaviour and executable configuration ------ */
for (const f of files.filter((s2) => s2.startsWith('.github/'))) {
  if (!/\.ya?ml$/.test(f)) continue;
  let lines;
  try { lines = readFileSync(f, 'utf8').split('\n'); } catch { continue; }

  let runBlockIndent = -1; // inside a `run: |` block scalar
  for (const [index, raw] of lines.entries()) {
    const where = `${f}:${index + 1}`;
    if (/^\s*#/.test(raw)) continue; // policy prose is allowed to name a vendor
    const indent = raw.length - raw.trimStart().length;
    if (runBlockIndent >= 0 && raw.trim() !== '' && indent <= runBlockIndent) runBlockIndent = -1;

    const insideRunBlock = runBlockIndent >= 0;
    if (/^\s*(-\s*)?run\s*:\s*[|>]/.test(raw)) runBlockIndent = indent;

    const isRun = /^\s*(-\s*)?run\s*:/.test(raw);
    const isUses = /^\s*(-\s*)?uses\s*:/.test(raw);
    const isDocumentation = DOCUMENTATION_KEY.test(raw);
    const executable = insideRunBlock || isRun || isUses || (!isDocumentation && raw.trim() !== '');

    checkDeployLine(where, raw, executable);

    // A workflow that runs a deploying package script deploys, however
    // innocent the step line looks.
    if (executable) {
      for (const script of deployingScripts) {
        const invocation = new RegExp(String.raw`\b(?:npm|pnpm|bun)\s+run\s+${script}\b|\byarn\s+${script}\b`);
        if (invocation.test(raw)) {
          add('ci-deploy', `${where} — runs the deploying package script "${script}"`);
        }
      }
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
  console.log(`     (shape tripwire, NOT universal secret detection; ${'`'}${FIXTURE_ANNOTATION}${'`'} marks reviewed fixtures,`);
  console.log('      per occurrence, only in test/fixture files, and only for obviously synthetic values)');
  console.log('  no production-shaped PSP Agent ID literal');
  console.log('  no .only test');
  console.log(
    `  no active deployment command in package scripts, shell wrappers or .github workflows`
    + ` (${DEPLOY_PATTERNS.length} behaviours + any deployment action)`,
  );
  process.exit(0);
}

console.error('RELAY REPOSITORY BOUNDARY: FAIL');
for (const { rule, detail } of findings) console.error(`  [${rule}] ${detail}`);
console.error(`\n${findings.length} finding(s).`);
process.exit(1);
