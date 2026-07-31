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
 *
 * WHAT WAS REPAIRED (HIGH-1a). This function used to return true the moment
 * the reserved token appeared ANYWHERE in the value, before it computed a
 * residue at all. Gluing `FAKETESTNOTREAL` onto a genuine key therefore made
 * an annotation launder it — the exact laundering the docstring above says is
 * impossible. The token is now STRIPPED rather than trusted: whatever remains
 * is judged on its own character content, so a marker appended, prepended or
 * inserted mid-value all leave the same high-entropy residue and all fail.
 */
function isObviouslySynthetic(match) {
  const residue = match
    .replace(STRUCTURAL_PREFIX, '')
    .replaceAll(SYNTHETIC_TOKEN, '')
    .replace(FIXTURE_MARKERS, '');
  const core = residue.replace(/[^A-Za-z0-9]/g, '');
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

/**
 * WHERE A FIXTURE ALLOWANCE MAY BE HONOURED (HIGH-1b).
 *
 * A file qualifies by STRUCTURE, never by name: it is a `.test.`/`.spec.` file,
 * or it lives under a test/fixture directory segment.
 *
 * The removed third branch trusted a BASENAME containing "fixture", so any
 * shipping production module called `*fixtures*.ts` could carry an allowance
 * for a real credential. This repository ships ten such modules — among them
 * `src/relay/cli/product/fixtures.ts` and `src/relay/psp/psp-fixtures.ts` —
 * and every one of them is production source that the product imports at
 * runtime. A name is a claim about a file; a directory is a fact about it.
 */
const TEST_DIRECTORY_SEGMENT = /(^|\/)(tests?|__tests__|fixtures?|__fixtures__|testing)\//;
const isTestOrFixtureFile = (f) =>
  /\.(test|spec)\.[cm]?[tj]sx?$/.test(f) || TEST_DIRECTORY_SEGMENT.test(f);

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

const DEPLOY_BINARY_NAMES = new Map(DEPLOY_BINARIES);

/**
 * A DETERMINISTIC SHELL COMMENT LEXER (HIGH-2).
 *
 * `line.replace(/#.*$/, '')` erased executable content after ANY `#`, so
 *
 *     echo "#" && vercel --prod
 *
 * scanned clean while bash ran the deploy. A `#` opens a comment only when it
 * is unquoted AND begins a word — at the start of the line, or after
 * whitespace or a shell separator. A quoted `#` and a `#` inside a word are
 * DATA and the rest of the line still executes.
 *
 * Left to right, tracking single quotes, double quotes and backslash escapes.
 * A genuine unquoted trailing comment is still removed, so prose that names a
 * vendor after a real `#` stays inert exactly as before.
 */
function stripShellComment(line) {
  let single = false;
  let double = false;
  let quotedCandidate = -1; // a word-opening `#` that quote tracking called data
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && !single) { i += 1; continue; }   // escapes the next char
    if (ch === "'" && !double) { single = !single; continue; }
    if (ch === '"' && !single) { double = !double; continue; }
    if (ch !== '#') continue;
    const opensWord = i === 0 || /[\s;&|(){}]/.test(line[i - 1]);
    if (!opensWord) continue;                            // `a#b` is one word
    if (!single && !double) return line.slice(0, i);
    if (quotedCandidate < 0) quotedCandidate = i;
  }
  // An unbalanced quote at end of line means the quote tracking was reading
  // prose, not shell — an apostrophe in `Relay's policy # …` is not a quote.
  // In that case the plain word-boundary reading is the better one, so real
  // documentation keeps behaving exactly as it did before this lexer existed.
  if ((single || double) && quotedCandidate >= 0) return line.slice(0, quotedCandidate);
  return line;
}

/**
 * Splits a command line into the SEGMENTS a shell would run as separate
 * commands: at `;`, `&`, `|`, `(`, `)`, `{`, `}`, a backtick and newlines.
 *
 * WHAT WAS REPAIRED (F3 and F5 — one root cause, two opposite symptoms).
 *
 * A single or double quote used to FLUSH, making every quoted run a segment of
 * its own whose head word was then read as a command. That is not how a shell
 * reads a line, and it failed in both directions at once:
 *
 *   FALSE POSITIVE (F5) — a vendor named FIRST inside a string became a
 *     command. `grep -R "vercel" .`, `echo "vercel is never used here"` and
 *     `command -v vercel` were all reported as deployments, in a repository
 *     whose own audit scripts are exactly the thing that greps for a deploy
 *     CLI. Worse, `allow-mention` is deliberately powerless on an executable
 *     line, so those lines could not be committed AT ALL.
 *
 *   FALSE NEGATIVE (F3) — `node 'scripts/ship.mjs'` split into `node` (with no
 *     argument) and `scripts/ship.mjs`, so the wrapper was never queued and
 *     the deployment inside it passed in silence.
 *
 * A quote is now TRANSPARENT: it neither starts a segment nor hides what is
 * inside one. So a quoted string is part of the word it sits in — `grep -R
 * "vercel" .` has head word `grep` — while a separator inside a quoted run
 * still separates, which is what keeps `sh -c "… && railway up"` exposing its
 * inner command. `sh -c "vercel --prod"` has NO inner separator, and is
 * resolved instead by `sh` being a runner and `-c` being its argument.
 *
 * A BACKTICK still flushes, because it is not a quote: it is command
 * substitution, and `echo ` + backtick + `vercel --prod` + backtick genuinely
 * runs the deploy. `$(…)` keeps splitting on its parentheses as before.
 */
function commandSegments(text) {
  const segments = [];
  let current = '';
  let depth = 0;            // open `(` — a subshell or `$( )`, not a case label
  let statement = 0;        // index in `segments` where the current statement began
  const flush = () => { if (current.trim() !== '') segments.push(current); current = ''; };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') { current += ch + (text[i + 1] ?? ''); i += 1; continue; }
    if (ch === '"' || ch === "'") continue;             // transparent, not a boundary
    if (ch === '(') { flush(); depth += 1; statement = segments.length; continue; }
    if (ch === ')') {
      flush();
      // A CASE LABEL, NOT A COMMAND. An unbalanced `)` closes a `case`
      // pattern, so what precedes it in this statement is a label being
      // matched — `vercel) echo unsupported;;` runs `echo`, never `vercel`.
      // A BALANCED `)` closes a subshell or `$( )`, whose contents do run.
      if (depth === 0) segments.length = statement; else depth -= 1;
      statement = segments.length;
      continue;
    }
    // `|` does NOT begin a new statement: it continues a pipeline, and it also
    // separates the alternatives of one case label — `vercel|netlify)`.
    if (ch === '`' || /[;&{}\n]/.test(ch)) { flush(); statement = segments.length; continue; }
    if (ch === '|') { flush(); continue; }
    current += ch;
  }
  flush();
  return segments;
}

/**
 * Words that may sit in front of the REAL command without changing what runs.
 * Everything here is a runner or an environment wrapper; skipping them is what
 * makes `env VERCEL_TOKEN=… vercel`, `timeout 600 vercel`, `yarn vercel` and
 * `npm exec -- vercel` resolve to the same binary as a bare `vercel`.
 *
 * The SHELL INTERPRETERS are here for the same reason (F5). Once a quote stops
 * flushing, `sh -c "vercel --prod"` is one segment reading `sh -c vercel
 * --prod`; `sh` being a runner and `-c` one of its arguments resolves it to
 * `vercel` — a truer reading than the old accident of splitting on the quote,
 * and one that also catches `sh -c 'railway up'`, which had no separator to
 * split on and so was missed entirely.
 */
const RUNNER_WORDS = new Set([
  'env', 'nohup', 'time', 'sudo', 'doas', 'xargs', 'command', 'exec', 'timeout',
  'npx', 'bunx', 'yarn', 'stdbuf', 'nice', 'setsid',
  'sh', 'bash', 'zsh', 'dash', 'ksh',
]);
/** Two-word runners, where the second word is part of the runner, not the command. */
const RUNNER_PAIRS = new Set([
  'npm exec', 'npm run', 'pnpm exec', 'pnpm dlx', 'pnpm run', 'yarn dlx', 'bun x', 'bun run',
]);

/**
 * SHELL KEYWORDS THAT PRECEDE A COMMAND (F1).
 *
 * `resolveCommand` skipped environment assignments and runners and then took
 * the head word — but a shell keyword is neither, so `then` BECAME the
 * resolved binary and every deploy behind it was invisible:
 *
 *     if true; then vercel --prod; fi
 *     for i in 1; do railway up; done
 *     if false; then echo x; else vercel --prod; fi
 *
 * A conditional deploy is the most natural real shape there is, and all eight
 * DEPLOY_BINARIES hid behind it in workflows, `.sh` wrappers and package
 * scripts alike.
 *
 * `if`, `while` and `until` are here too, because the CONDITION of a compound
 * command is itself a command: `if vercel --prod; then …` runs the deploy just
 * as surely as `then vercel --prod` does.
 *
 * They were held back at first for a specific worry — they also open an
 * English sentence, so a step named "If vercel is configured…" resolves to
 * `vercel`. That case is real, but it is not UNSUPPRESSABLE: a `name:` value
 * is not an executable position, so `relay-boundary:allow-mention` silences
 * it, which is exactly what that annotation exists for. The positions that
 * cannot be annotated — a wrapper line, a package script — were measured
 * before widening, and the guards people actually write stay clean, because
 * none of them puts a deploy binary in command position:
 *
 *     if ! command -v vercel; then exit 1; fi     a lookup, not an invocation
 *     if [ -x vercel ]; then exit 1; fi           the head word is `[`
 *     if which vercel; then exit 1; fi            the head word is `which`
 *     if grep -q "vercel" .; then exit 1; fi      the head word is `grep`
 *
 * What DOES now report is `if vercel --version; then …`. That is consistent
 * rather than new: a bare `vercel --version` already reports, because the rule
 * is "invoking a deploy CLI at all is out of scope for Relay", not "only its
 * deploy subcommands are".
 *
 * `in` is NOT here (finding F). `for x in vercel netlify; do …` puts a LIST
 * after `in`, never a command, so skipping it made the first list item resolve
 * as a command, and a line-continued `for name \` / `  in vercel …` reported a
 * deployment. Nothing is lost by dropping it: the command a `for` runs is
 * reached through its `do` segment.
 */
const SHELL_KEYWORDS = new Set([
  'then', 'do', 'else', 'elif', 'eval', '!',
  'if', 'while', 'until',
]);

/**
 * `./node_modules/.bin/vercel` and `/usr/local/bin/vercel` are both `vercel`,
 * and so is `.\node_modules\.bin\vercel` (F8) — splitting on `/` alone left a
 * backslash path unresolved, and the whole string became the "binary".
 */
const basenameOf = (word) => word.replace(/^[\\/]+/, '').replace(/^.*[\\/]/, '');

/** Treats a value as literal text when it is interpolated into a pattern. */
const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A `VAR=value` assignment that precedes the command rather than being it. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** A runner's own option or duration argument: `-n1`, `--yes`, `600`, `10s`. */
const RUNNER_ARGUMENT = /^-|^\d+(?:\.\d+)?[smhd]?$/;

/**
 * RUNNER FLAGS THAT CONSUME THE NEXT WORD.
 *
 * `sudo -u deploy vercel --prod` evaded detection because the option's VALUE
 * (`deploy`) was mistaken for the command. Only these named flags swallow the
 * word after them; a general "skip every dashed word and the one after it"
 * rule would swallow the real command in `timeout 600 vercel --prod` and in
 * `npm exec -- vercel --prod`, which is the opposite failure.
 *
 * The `--flag=value` form is a single word and is handled by RUNNER_ARGUMENT,
 * so it must never be paired with a following word.
 */
const RUNNER_VALUE_FLAGS = new Map([
  ['sudo', new Set(['-u', '--user', '-g', '--group', '-p', '--prompt', '-r', '--role', '-t', '--type', '-h', '--host'])],
  ['doas', new Set(['-u', '-C'])],
  ['xargs', new Set(['-I', '-i', '-a', '-d', '-E', '-L', '-n', '-P', '-s',
    '--replace', '--arg-file', '--delimiter', '--max-args', '--max-procs', '--max-chars', '--max-lines'])],
  ['env', new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string'])],
  ['timeout', new Set(['-s', '--signal', '-k', '--kill-after'])],
  ['nice', new Set(['-n', '--adjustment'])],
  ['stdbuf', new Set(['-i', '-o', '-e', '--input', '--output', '--error'])],
  ['time', new Set(['-o', '--output', '-f', '--format'])],
  ['exec', new Set(['-a'])],
  ['npx', new Set(['-p', '--package'])],
  // A shell interpreter's `-o pipefail` takes a value; `-c` deliberately does
  // NOT appear, because the command it introduces is exactly what we want.
  ['sh', new Set(['-o'])],
  ['bash', new Set(['-o', '--rcfile', '--init-file'])],
  ['zsh', new Set(['-o'])],
  ['dash', new Set(['-o'])],
  ['ksh', new Set(['-o'])],
  // The PAIR runners, keyed by their first word — the only place these are
  // consulted for `npm`/`pnpm`/`bun` (F2). Nothing here is a boolean flag:
  // pairing `--yes` or `--quiet` with a following word would swallow the real
  // command, which is the failure this map exists to prevent.
  ['npm', new Set(['-p', '--package', '-c', '--call', '-w', '--workspace'])],
  ['pnpm', new Set(['-p', '--package', '-c', '--call', '-F', '--filter'])],
  ['bun', new Set(['--cwd'])],
  // nohup, setsid and command take no valued option before the command.
  // `yarn` is both a single runner and a pair head; `-p/--package` is right in
  // both readings.
  ['yarn', new Set(['-p', '--package'])],
]);

/**
 * FLAGS THAT TURN A RUNNER INTO A LOOKUP (F5).
 *
 * `command -v vercel` PRINTS a path; it starts no process. It is also the
 * single most natural line in an audit script that checks a deploy CLI is
 * absent — and because `allow-mention` is powerless on an executable line, a
 * scan that flagged it made that check impossible to commit. Only the leading
 * option is inspected, so `command vercel --prod` still resolves to `vercel`.
 */
const RUNNER_LOOKUP_FLAGS = new Map([['command', new Set(['-v', '-V'])]]);

/** Drops a runner's own arguments, pairing only the flags that take a value. */
function dropRunnerArguments(words, runner) {
  const valueFlags = RUNNER_VALUE_FLAGS.get(runner) ?? new Set();
  let rest = words;
  while (rest.length > 0) {
    const word = rest[0];
    if (word === '--') { rest = rest.slice(1); continue; }
    if (valueFlags.has(word) && rest.length > 1) { rest = rest.slice(2); continue; }
    if (RUNNER_ARGUMENT.test(word)) { rest = rest.slice(1); continue; }
    break;
  }
  return rest;
}

/**
 * NORMALIZED COMMAND-POSITION DETECTION (MEDIUM-1).
 *
 * The old rule required the binary at string start or immediately after one of
 * `; & | ( ` " '` or `$(`, behind a CLOSED runner list. Five real production
 * deploys evaded it — `env VERCEL_TOKEN=… vercel --prod`, `timeout 600 vercel
 * --prod`, `./node_modules/.bin/vercel --prod`, `yarn vercel --prod` and
 * `npm exec -- vercel --prod`.
 *
 * A segment's command is now resolved positionally: skip leading environment
 * assignments, shell keywords and runner words, then take the basename of the
 * head word. Only the HEAD of a segment is a command, which is what keeps
 * prose inert — in "Confirm no Vercel or Railway deployment is configured" the
 * head word is "Confirm", so nothing in the sentence is in command position.
 *
 * WHAT WAS ALSO REPAIRED HERE (F1, F2):
 *
 *   F1 — a shell keyword became the resolved binary, so `then vercel --prod`
 *        reported `then` and the deploy vanished. SHELL_KEYWORDS is skipped in
 *        the same loop as the runners.
 *   F2 — the RUNNER_PAIRS branch sliced two words and continued WITHOUT
 *        dropping the runner's own arguments, so `npm exec --yes -- vercel
 *        --prod` resolved to `--yes`. It now takes the same
 *        `dropRunnerArguments` path every other runner takes; the single
 *        tested form, `npm exec -- vercel --prod`, only worked because `--`
 *        happened to be handled at the top of that helper.
 */
function resolveCommand(segment) {
  let words = segment.trim().split(/\s+/).filter(Boolean);
  // THE LAST RUNNER STRIPPED, kept because some deploy behaviours are named
  // by the RUNNER PLUS ITS SUBCOMMAND rather than by a binary (finding A).
  let runner = '';
  for (let guard = 0; guard < 32 && words.length > 0; guard += 1) {
    const word = words[0];
    if (ENV_ASSIGNMENT.test(word)) { words = words.slice(1); continue; }
    const lower = word.toLowerCase();
    if (SHELL_KEYWORDS.has(lower)) { words = words.slice(1); continue; }
    if (RUNNER_PAIRS.has(`${lower} ${(words[1] ?? '').toLowerCase()}`)) {
      runner = `${lower} ${words[1].toLowerCase()}`;
      words = dropRunnerArguments(words.slice(2), lower);
      continue;
    }
    if (RUNNER_WORDS.has(lower)) {
      const rest = words.slice(1);
      // A lookup is not an invocation: nothing in this segment runs.
      const lookup = RUNNER_LOOKUP_FLAGS.get(lower);
      if (lookup && rest.length > 0 && lookup.has(rest[0])) return { binary: '', args: [], runner: '' };
      runner = lower;
      words = dropRunnerArguments(rest, lower);
      continue;
    }
    if (word === '--') { words = words.slice(1); continue; }
    return { binary: basenameOf(word).toLowerCase(), args: words.slice(1), runner };
  }
  return { binary: '', args: [], runner: '' };
}

/**
 * COMMANDS THAT TAKE THEIR ARGUMENTS AS DATA, not as a command to run.
 *
 * This is the inverse of RUNNER_WORDS, and it is what makes looking PAST an
 * unknown head word safe. `echo` and `grep` are exactly the words an audit
 * script puts in front of a vendor name, and the lookup builtins print where a
 * binary would be found without invoking it. Nothing after any of these runs.
 */
const DATA_COMMANDS = new Set([
  'echo', 'printf', 'print',
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'sed', 'awk', 'cat', 'head', 'tail',
  'sort', 'uniq', 'wc', 'tr', 'cut', 'comm', 'diff', 'tee', 'jq', 'yq', 'less', 'more',
  'test', '[', '[[', 'find', 'ls',
  'which', 'type', 'hash', 'whereis', 'whence', 'command',
  // Structural words that can end up as a segment head but never wrap a
  // command. `in` is here rather than in SHELL_KEYWORDS: a `for … in` LIST
  // must not be stepped into by the unknown-wrapper reading either.
  'for', 'in', 'case', 'esac', 'done', 'fi', 'select', 'function',
]);

/**
 * Every command any segment of `text` puts in command position, as the string
 * a shell would actually run: the resolved binary followed by its arguments,
 * with runners, environment assignments and shell keywords already stripped.
 *
 * AN UNKNOWN WRAPPER IS STILL A WRAPPER. Resolution can only skip runners it
 * has been told about, so a single unrecognised word in front of a deploy hid
 * it:
 *
 *     xvfb-run docker push x            the pattern rules saw head `xvfb-run`
 *     someunknownwrapper vercel --prod  the binary rules saw the wrapper
 *
 * Enumerating wrappers cannot close that, because the evasion is "any word not
 * on the list", which is unbounded. So each segment ALSO yields the command
 * that would run if its head word were a wrapper: ONE step, taking the first
 * non-flag argument, and only when the head is neither a deploy binary nor a
 * DATA command.
 *
 * One LITERAL step is what keeps prose inert. It is deliberately not
 * re-resolved through the keyword and runner skipping — in "Fail if vercel is
 * configured" the step lands on `if`, not on `vercel`.
 */
function resolvedCommands(text) {
  const resolved = [];
  for (const segment of commandSegments(text)) {
    const { binary, args, runner } = resolveCommand(segment);
    if (!binary) continue;
    resolved.push({ binary, commandLine: [binary, ...args].join(' ') });

    /**
     * THE RUNNER PUT BACK (finding A).
     *
     * Some deploy behaviours are named by a RUNNER PLUS ITS SUBCOMMAND, not by
     * a binary: `yarn publish` is the package publish, and `yarn` is also a
     * runner word. Resolution strips the runner first, so `yarn publish`
     * became `publish` and `\b(npm|pnpm|yarn|bun)\s+publish\b` could not match
     * it — publishing this package, a founder-authorized action, went
     * invisible in every surface while the banner still claimed coverage. Only
     * `npm publish` and `pnpm publish` were ever fixtured, and neither `npm`
     * nor `pnpm` is a runner word on its own, so the suite stayed green.
     *
     * Re-prefixing the stripped runner restores that reading without giving up
     * anything resolution gained: `sudo yarn publish`, `if true; then yarn
     * publish; fi` and `bash -c "yarn publish"` all resolve to `publish` with
     * `yarn` remembered, so all three match here.
     */
    if (runner) resolved.push({ binary, commandLine: [runner, binary, ...args].join(' ') });

    if (DEPLOY_BINARY_NAMES.has(binary) || DATA_COMMANDS.has(binary)) continue;
    const at = args.findIndex((w) => w !== '--' && !w.startsWith('-') && !ENV_ASSIGNMENT.test(w));
    if (at < 0) continue;
    const inner = args.slice(at);
    const innerBinary = basenameOf(inner[0]).toLowerCase();
    if (innerBinary) resolved.push({ binary: innerBinary, commandLine: [innerBinary, ...inner.slice(1)].join(' ') });
  }
  return resolved;
}

/** Every binary any segment of `text` puts in command position. */
function invokedBinaries(text) {
  return new Set(resolvedCommands(text).map((r) => r.binary));
}

/**
 * Strips a leading YAML key so a workflow step's COMMAND is matched as a
 * shell line: `- run: flyctl deploy` is judged as `flyctl deploy`. Without
 * this the command never sits at a command position and every workflow
 * invocation slips past.
 */
const YAML_KEY_PREFIX = /^\s*-?\s*(?:[A-Za-z_][\w-]*)\s*:\s*(?:[|>][-+]?\s*)?/;
const commandTextOf = (line) => line.replace(YAML_KEY_PREFIX, '');

const DEPLOY_PATTERNS = [
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
/**
 * A `docker://` prefix is stripped before the owner/name is read (F7). Without
 * it `uses: docker://myorg/deployer:latest` matched nothing at all: the owner
 * class is `[\w.-]+` and `docker:` carries a colon, so a container action —
 * which can run anything — was the one action form that could not be seen.
 */
const DEPLOY_ACTION = /^\s*-?\s*uses\s*:\s*['"]?(?:docker:\/\/)?([\w.-]+)\/([\w.-]+)/i;
const DEPLOY_ACTION_INTENT =
  /deploy|publish|release|vercel|netlify|railway|flyctl|superfly|heroku|cloudflare|wrangler|amplify|firebase|gh-pages|surge|now|render|fastly|azure\/webapps|aws-actions/i;

/** Same explicit, auditable shape as the fixture allowance. */
const DEPLOY_ANNOTATION = 'relay-boundary:allow-mention';

/** A YAML line whose match cannot execute: a title, a description, an `if`. */
const DOCUMENTATION_KEY = /^\s*-?\s*(name|description|title|summary|id|if|continue-on-error)\s*:/i;

/**
 * THE SAME PATTERNS, ANCHORED AT THE HEAD OF A RESOLVED COMMAND (F5, part 2).
 *
 * `DEPLOY_PATTERNS` used to be tested against the RAW LINE, so a subcommand
 * form named anywhere in it matched — including inside a quoted string. That
 * is exactly the false positive the binary rule was repaired for, surviving in
 * a different matcher, and it was WORSE there: these lines are judged
 * executable, so `allow-mention` is refused and they could not be committed at
 * all.
 *
 *     echo "docker push x"              reported as a container image push
 *     echo "we never npm publish here"  reported as a package publish
 *     grep -q "gh release create" .     reported as a GitHub release publish
 *
 * Each pattern already begins with the binary it is about, so anchoring it to
 * the start of a RESOLVED command line — runners, environment assignments and
 * shell keywords stripped — says the thing the rule always meant: this command
 * is being RUN, not named. `sudo docker push x` and `npx supabase db push`
 * still match, because resolution strips the runner first.
 *
 * THE COST, stated rather than hidden: a deploy behind a wrapper this scan
 * does not know as a runner — `xvfb-run docker push x` — no longer matches,
 * because its head word resolves to the unknown wrapper. That is the same
 * bound the binary rule has always had, and the fix for both is to name the
 * runner in RUNNER_WORDS.
 */
const DEPLOY_PATTERNS_AT_HEAD = DEPLOY_PATTERNS.map(([pattern, why]) => [
  new RegExp(`^(?:${pattern.source})`, pattern.flags.replace(/g/g, '')),
  why,
]);

function deployHits(line) {
  const hits = new Set();
  const command = commandTextOf(line);
  // Both readings are resolved, because a YAML key is not always present and
  // stripping one that is not there must not lose the command.
  const resolved = [...resolvedCommands(command), ...resolvedCommands(line)];
  for (const [pattern, why] of DEPLOY_PATTERNS_AT_HEAD) {
    if (resolved.some(({ commandLine }) => pattern.test(commandLine))) hits.add(why);
  }
  for (const binary of invokedBinaries(command)) {
    const vendor = DEPLOY_BINARY_NAMES.get(binary);
    if (vendor) hits.add(`a ${vendor} deployment command`);
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
  const code = stripShellComment(line); // only a REAL comment cannot execute
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

/* --- reachability: which files a script or a workflow step actually runs -
 *
 * WHAT WAS REPAIRED (MEDIUM-3). Only .sh/.bash/.zsh/.fish/Makefile/justfile
 * were read, so a package script `"ship": "node scripts/ship.mjs"` whose
 * wrapper called `execSync('vercel --prod')`, invoked from a workflow as
 * `npm run ship`, passed the scan from end to end.
 *
 * The repair is scoped by REACHABILITY, not by file extension. Scanning every
 * tracked .mjs/.ts instead would report this repository's own scanner, its
 * regression suite and its FROZEN, un-editable baseline as deployment paths:
 * a rule whose first act is to fail on its own evidence is not a rule. Only
 * files a package script or a workflow step names in an actual `node <file>`
 * invocation are read, plus the local modules those files statically import.
 * Bundler arguments are NOT followed — `esbuild src/relay/cli/main.ts` names a
 * source file but does not run it, and following it would drag in the whole
 * CLI graph.
 * ----------------------------------------------------------------------- */
const tracked = new Set(files);
const directoryOf = (f) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '');

/**
 * Normalizes `base` + a relative specifier to a repository-relative path.
 * Splits on `\` as well as `/` (F8), so `node .\scripts\ship.mjs` resolves to
 * the same tracked file a forward-slash path would.
 */
function repositoryPath(base, target) {
  const parts = [];
  for (const part of `${base ? `${base}/` : ''}${target}`.split(/[\\/]/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') { parts.pop(); continue; }
    parts.push(part);
  }
  return parts.join('/');
}

const SCANNABLE_SOURCE = /\.(mjs|cjs|js|jsx|mts|cts|ts|tsx)$/;
/** The frozen baseline is EVIDENCE, never a scan target. */
const BASELINE_PREFIX = 'scripts/__baseline__/';
const isScannableEntry = (p) =>
  tracked.has(p) && SCANNABLE_SOURCE.test(p) && !p.startsWith(BASELINE_PREFIX);

/**
 * Refusing to scan the frozen baseline is right — it is the evidence this
 * repair is measured against, and rescanning it would fail the scan at its own
 * proof. Refusing SILENTLY is not (F9): a path that runs the baseline copy
 * would then be a reachable entry point that produced no entry and no finding,
 * which is the same shape of quiet pass F3 was. It is reported as
 * unanalyzable instead, exactly as a runtime-built command is.
 */
function refuseBaselineEntry(where, resolved, how) {
  add(
    'deploy-analyzability',
    `${where} — ${how} ${resolved}, which is the frozen baseline copy and is never scanned as a target;`
    + ' a deployment-capable path must be analyzable',
  );
}

/**
 * Every tracked file a command text runs with `node <file>`.
 *
 * Quotes no longer need stripping here: `commandSegments` removes them, which
 * is what makes `node 'scripts/ship.mjs'` resolve at all (F3).
 */
function nodeEntriesIn(text, base, where) {
  const entries = [];
  for (const segment of commandSegments(text)) {
    const { binary, args } = resolveCommand(segment);
    if (binary !== 'node') continue;
    for (const arg of args) {
      if (arg === '--' || arg.startsWith('-')) continue;
      const resolved = repositoryPath(base, arg);
      if (isScannableEntry(resolved)) entries.push(resolved);
      else if (tracked.has(resolved) && resolved.startsWith(BASELINE_PREFIX)) {
        refuseBaselineEntry(where, resolved, 'runs');
      }
      break; // the first non-flag argument is the entry point
    }
  }
  return entries;
}

/** entry path -> the callers that reach it, and the package scripts among them. */
const reachableEntries = new Map();
const reachingScripts = new Map();
function recordEntry(path, caller, scriptName) {
  if (!reachableEntries.has(path)) reachableEntries.set(path, new Set());
  if (caller) reachableEntries.get(path).add(caller);
  if (!reachingScripts.has(path)) reachingScripts.set(path, new Set());
  if (scriptName) reachingScripts.get(path).add(scriptName);
}

/* --- 6a. package scripts, which CI and humans both run ----------------- */
const deployingScripts = new Set();
for (const f of files.filter((s2) => /(^|\/)package\.json$/.test(s2))) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  // Parsed as JSON: the body below is the script's real text, never a line to
  // be comment-stripped by a reader that does not know JSON escaping.
  for (const [name, body] of Object.entries(manifest.scripts ?? {})) {
    if (typeof body !== 'string') continue;
    const before = findings.length;
    checkDeployLine(`${f} — script "${name}"`, body, true);
    if (findings.length > before) deployingScripts.add(name);
    for (const entry of nodeEntriesIn(stripShellComment(body), directoryOf(f), `${f} — script "${name}"`)) {
      recordEntry(entry, `${f} — script "${name}"`, name);
    }
  }
}

/* --- 6b. shell wrappers and task runners ------------------------------- */
for (const f of files.filter((s2) => /\.(sh|bash|zsh|fish)$/.test(s2) || /(^|\/)(Makefile|justfile|Justfile)$/.test(s2))) {
  let lines;
  try { lines = readFileSync(f, 'utf8').split('\n'); } catch { continue; }
  for (const [index, line] of lines.entries()) {
    if (/^\s*#/.test(line)) continue; // a full-line comment cannot execute
    checkDeployLine(`${f}:${index + 1}`, line, true);
    for (const entry of nodeEntriesIn(stripShellComment(line), '', `${f}:${index + 1}`)) {
      recordEntry(entry, `${f}:${index + 1}`, null);
    }
  }
}

/* --- 6c. workflow lines, read once so entry-point discovery and the line
 *        checks share one view of which lines can execute --------------- */
const workflowLines = [];
for (const f of files.filter((s2) => s2.startsWith('.github/'))) {
  if (!/\.ya?ml$/.test(f)) continue;
  let lines;
  try { lines = readFileSync(f, 'utf8').split('\n'); } catch { continue; }

  let runBlockIndent = -1; // inside a `run: |` block scalar
  for (const [index, raw] of lines.entries()) {
    if (/^\s*#/.test(raw)) continue; // policy prose is allowed to name a vendor
    const indent = raw.length - raw.trimStart().length;
    if (runBlockIndent >= 0 && raw.trim() !== '' && indent <= runBlockIndent) runBlockIndent = -1;

    const insideRunBlock = runBlockIndent >= 0;
    if (/^\s*(-\s*)?run\s*:\s*[|>]/.test(raw)) runBlockIndent = indent;

    const isRun = /^\s*(-\s*)?run\s*:/.test(raw);
    const isUses = /^\s*(-\s*)?uses\s*:/.test(raw);
    const isDocumentation = DOCUMENTATION_KEY.test(raw);
    workflowLines.push({
      file: f,
      number: index + 1,
      raw,
      runs: insideRunBlock || isRun,
      executable: insideRunBlock || isRun || isUses || (!isDocumentation && raw.trim() !== ''),
    });
  }
}
for (const { file: f, number, raw, runs } of workflowLines) {
  if (!runs) continue;
  for (const entry of nodeEntriesIn(stripShellComment(commandTextOf(raw)), '', `${f}:${number}`)) {
    recordEntry(entry, `${f}:${number}`, null);
  }
}

/* --- 6d. the wrappers those entry points are ---------------------------- */

/** The child_process functions that start a process. */
const EXEC_FUNCTIONS = new Set(['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync']);
/** Of those, the ones whose FIRST argument is a binary and second an argv array. */
const ARGV_FUNCTIONS = new Set(['execFile', 'execFileSync', 'spawn', 'spawnSync']);

/**
 * The local names bound to child_process in this source — direct bindings
 * (`import { execSync }`) and namespaces (`import cp from …`).
 *
 * Binding to the module is what makes a call a child_process call. Matching
 * the bare word `exec(` instead would report this scanner's own
 * `re.exec(content)` as an unanalyzable deployment path, which is the class of
 * self-detonation this whole section is scoped to avoid.
 *
 * READ FROM COMMENT-MASKED SOURCE (finding B), with string bodies KEPT because
 * a binding is identified by the module name inside its own string. A binding
 * written in a comment is not a binding, and treating one as real is how a
 * commented-out example became a live finding.
 */
function childProcessBindings(source) {
  const code = maskProse(source, false);
  const direct = new Map();
  const namespaces = new Set();
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/g)) {
    for (const clause of m[1].split(',')) {
      const [imported, alias] = clause.trim().split(/\s+as\s+/);
      const canonical = (imported ?? '').trim();
      const local = (alias ?? imported ?? '').trim();
      if (local && EXEC_FUNCTIONS.has(canonical)) direct.set(local, canonical);
    }
  }
  for (const m of code.matchAll(
    /import\s+(?:\*\s*as\s+)?([A-Za-z_$][\w$]*)\s*(?:,\s*(?:\*\s*as\s+[A-Za-z_$][\w$]*|\{[^}]*\})\s*)?from\s*['"](?:node:)?child_process['"]/g,
  )) namespaces.add(m[1]);
  for (const m of code.matchAll(
    /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g,
  )) {
    for (const clause of m[1].split(',')) {
      const [imported, alias] = clause.trim().split(':');
      const canonical = (imported ?? '').trim();
      const local = (alias ?? imported ?? '').trim();
      if (local && EXEC_FUNCTIONS.has(canonical)) direct.set(local, canonical);
    }
  }
  for (const m of code.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g,
  )) namespaces.add(m[1]);
  return { direct, namespaces };
}

/**
 * Every process-starting call site, with the offset of its opening paren.
 *
 * LOCATED IN MASKED SOURCE (finding B). This is the site-finder `maskProse`
 * was written for, and it was the one that never used it: a wrapper importing
 * `execSync` that carried a COMMENT reading
 * `// never do this: execSync('vercel --prod')` was reported as a deployment.
 *
 * That was a live hazard in THIS file. `relay-ci.yml` runs this scanner, so it
 * is itself a reachable entry point, and its own comments name that exact
 * call. It passed only because it imports `execFileSync` and not `execSync` —
 * one added import, or one comment written with the other name, and the
 * scanner would have reported its own documentation.
 *
 * Arguments are still read from the RAW source at the same offsets. Masking
 * only decides WHERE a call is, never what it says.
 */
function execCallSites(source) {
  const { direct, namespaces } = childProcessBindings(source);
  const code = maskProse(source);
  const sites = [];
  const push = (fn, m) => sites.push({ fn, index: m.index, open: m.index + m[0].length - 1 });
  for (const [local, canonical] of direct) {
    const pattern = new RegExp(String.raw`(?<![.\w$])${escapeForRegExp(local)}\s*\(`, 'g');
    for (const m of code.matchAll(pattern)) push(canonical, m);
  }
  for (const namespace of namespaces) {
    const pattern = new RegExp(String.raw`(?<![.\w$])${escapeForRegExp(namespace)}\s*\.\s*(\w+)\s*\(`, 'g');
    for (const m of code.matchAll(pattern)) if (EXEC_FUNCTIONS.has(m[1])) push(m[1], m);
  }
  for (const m of code.matchAll(/require\(\s*['"](?:node:)?child_process['"]\s*\)\s*\.\s*(\w+)\s*\(/g)) {
    if (EXEC_FUNCTIONS.has(m[1])) push(m[1], m);
  }
  return sites.sort((a, b) => a.index - b.index);
}

/** The four declaration forms `childProcessBindings` reads, for blanking. */
const CHILD_PROCESS_DECLARATIONS = [
  /import\s*\{[^}]*\}\s*from\s*['"](?:node:)?child_process['"]/g,
  /import\s+(?:\*\s*as\s+)?[A-Za-z_$][\w$]*\s*(?:,\s*(?:\*\s*as\s+[A-Za-z_$][\w$]*|\{[^}]*\})\s*)?from\s*['"](?:node:)?child_process['"]/g,
  /(?:const|let|var)\s*\{[^}]*\}\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g,
  /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g,
];

/**
 * A CHILD_PROCESS BINDING USED OUTSIDE A CALL (the reviewer's F4).
 *
 * `execCallSites` recognises three shapes: a direct binding called directly, a
 * namespace property called directly, and `require('child_process').fn(…)`.
 * A binding that ESCAPES all three still starts processes, and did so with no
 * finding at all:
 *
 *     const run = promisify(exec); await run('vercel --prod');
 *     const { execSync } = cp;     execSync('vercel --prod');
 *     cp['execSync']('vercel --prod');
 *
 * Following a binding through an arbitrary alias is evaluation, not
 * extraction — the same line this section draws for a computed specifier. So
 * the escape is REPORTED rather than resolved, which is what the doctrine in
 * the banner already promises: nothing a reachable wrapper cannot be read
 * through is passed in silence.
 *
 * The declarations themselves are blanked first: the `execSync` inside
 * `import { execSync }` is where the binding is created, not a use of it.
 */
function escapingChildProcessUses(source) {
  const { direct, namespaces } = childProcessBindings(source);
  if (direct.size === 0 && namespaces.size === 0) return [];

  const chars = maskProse(source).split('');
  // Declaration spans are located in COMMENT-masked source with strings kept,
  // because a declaration is identified by the module name inside its own
  // string literal — which full masking has already blanked. Offsets are
  // preserved by both maskings, so a span found in one blanks in the other.
  const withStrings = maskProse(source, false);
  for (const pattern of CHILD_PROCESS_DECLARATIONS) {
    for (const m of withStrings.matchAll(pattern)) {
      for (let k = m.index; k < m.index + m[0].length; k += 1) if (chars[k] !== '\n') chars[k] = ' ';
    }
  }
  const code = chars.join('');
  const nextAfter = (at) => { let k = at; while (k < code.length && /\s/.test(code[k])) k += 1; return k; };

  const escapes = [];
  for (const local of direct.keys()) {
    const re = new RegExp(String.raw`(?<![.\w$])${escapeForRegExp(local)}(?![\w$])`, 'g');
    for (const m of code.matchAll(re)) {
      if (code[nextAfter(m.index + local.length)] !== '(') {
        escapes.push({ index: m.index, name: local, how: 'is passed on rather than called' });
      }
    }
  }
  for (const ns of namespaces) {
    const re = new RegExp(String.raw`(?<![.\w$])${escapeForRegExp(ns)}(?![\w$])`, 'g');
    for (const m of code.matchAll(re)) {
      const k = nextAfter(m.index + ns.length);
      if (code[k] === '[') {
        escapes.push({ index: m.index, name: `${ns}[…]`, how: 'is indexed with a computed property' });
        continue;
      }
      if (code[k] !== '.') {
        escapes.push({ index: m.index, name: ns, how: 'is passed on or destructured rather than called' });
        continue;
      }
      const p = nextAfter(k + 1);
      const property = (code.slice(p).match(/^[\w$]+/) ?? [''])[0];
      if (!EXEC_FUNCTIONS.has(property)) continue;      // `cp.fork` starts nothing this rule reads
      if (code[nextAfter(p + property.length)] !== '(') {
        escapes.push({ index: m.index, name: `${ns}.${property}`, how: 'is passed on rather than called' });
      }
    }
  }
  return escapes;
}

/** Splits an argument list at its TOP-LEVEL commas, respecting quotes and nesting. */
function splitTopLevelCommas(text) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === '\\') { current += text[i + 1] ?? ''; i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; current += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** The argument texts of the call whose `(` is at `open`, or null if unterminated. */
function callArguments(source, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth += 1; continue; }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return splitTopLevelCommas(source.slice(open + 1, i));
    }
  }
  return null;
}

const STRING_LITERAL = /^\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*$/;
/** A template literal with NO substitution is still a constant; one with `${}` is not. */
const CONSTANT_TEMPLATE = /^\s*`([^`$\\]*)`\s*$/;
function staticString(text) {
  const quoted = STRING_LITERAL.exec(text ?? '');
  if (quoted) return quoted[2];
  const template = CONSTANT_TEMPLATE.exec(text ?? '');
  return template ? template[1] : null;
}

function staticArray(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner === '') return [];
  const values = [];
  for (const part of splitTopLevelCommas(inner)) {
    const value = staticString(part);
    if (value === null) return null;
    values.push(value);
  }
  return values;
}

/**
 * The command a call statically runs, or null when it is built at runtime.
 * `null` is NOT "no deployment": an unanalyzable command in a reachable
 * wrapper is reported as an analyzability failure rather than passed over.
 */
function staticCommandOf(fn, args) {
  const head = staticString(args[0]);
  if (head === null) return null;
  if (!ARGV_FUNCTIONS.has(fn)) return head; // exec/execSync take a whole command line
  const second = args[1];
  if (second === undefined || second.trim() === '' || !second.trim().startsWith('[')) return head;
  const argv = staticArray(second);
  if (argv === null) return null;
  return [head, ...argv].join(' ');
}

/**
 * Local, relative modules a reachable wrapper statically pulls in.
 *
 * WHAT WAS REPAIRED (MEDIUM-3a). The extractor required a specifier to sit
 * behind `from`, `import(` or `require(`, so the BARE SIDE-EFFECT IMPORT — the
 * one import form that carries no binding at all — was the single edge the
 * follower could not see:
 *
 *     import { go } from './deploy.mjs';   followed
 *     import './deploy.mjs';               NOT followed
 *
 * That one line hid a whole deployment. `scripts/ship.mjs` containing nothing
 * but `import './deploy.mjs';` reached a `vercel --prod` that the scan never
 * read, and a side-effect import is exactly how a module that RUNS on load
 * — rather than exporting something — is pulled in, which is precisely the
 * shape a deploy wrapper has.
 *
 * The alternation below is ordered: `import(` and `require(` are tried before
 * the bare form, so a dynamic import is still matched as a call rather than as
 * a side-effect statement. Every alternative is anchored on a word boundary so
 * a specifier is only followed when the keyword really is a keyword.
 *
 * Covered here, each proven by its own case in the regression suite:
 *   import './x.mjs'              side effect, no binding
 *   import d, { a as b } from …   any binding form
 *   export * from './x.mjs'       a re-export reaches the module too
 *   export { a } from './x.mjs'
 *   require('./x.cjs')            .cjs/.js wrappers
 *   await import('./x.mjs')       a LITERAL dynamic specifier
 *
 * A BACKTICK SPECIFIER WITH NO SUBSTITUTION is a literal too, and is matched:
 * leaving it out would have made a single backtick an evasion of this very
 * repair. The template branch forbids `$` and `\`, so a substitution or an
 * escape is not treated as constant — the same rule `staticString` already
 * applies to a command.
 *
 * NOT covered, deliberately: a COMPUTED specifier — one built by concatenation
 * or interpolation, or read from a variable — and any indirection through
 * `createRequire`. Resolving one of those needs evaluation, not extraction,
 * and a scanner that guessed would name the wrong file. The banner says so.
 *
 * The quote is captured and back-referenced so an opening quote must be closed
 * by its own kind; the previous `['"]…['"]` accepted a mismatched pair.
 */
const LOCAL_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)(?:(['"])(\.[^'"]*)\1|`(\.[^`$\\]*)`)/g;
const EXTENSION_CANDIDATES = ['', '.mjs', '.cjs', '.js', '.mts', '.cts', '.ts', '.tsx', '.jsx',
  '/index.mjs', '/index.cjs', '/index.js', '/index.ts', '/index.tsx'];
/**
 * The repository file a relative specifier names, or null. A specifier that
 * resolves into the frozen baseline is REFUSED and reported rather than
 * dropped (F9).
 */
function resolveSpecifier(file, specifier) {
  if (!specifier.startsWith('.')) return null;   // a bare package is not a repository file
  const base = repositoryPath(directoryOf(file), specifier);
  const candidates = [...EXTENSION_CANDIDATES.map((ext) => `${base}${ext}`)];
  if (/\.js$/.test(base)) candidates.push(base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'));
  const resolved = candidates.find((c) => isScannableEntry(c));
  if (resolved) return resolved;
  const refused = candidates.find((c) => tracked.has(c) && c.startsWith(BASELINE_PREFIX));
  if (refused) refuseBaselineEntry(file, refused, 'imports');
  return null;
}

function localImportsOf(file, source) {
  const found = [];
  for (const m of source.matchAll(LOCAL_SPECIFIER)) {
    const specifier = m[2] ?? m[3];   // quoted, or a substitution-free template
    const resolved = resolveSpecifier(file, specifier);
    if (resolved) found.push(resolved);
  }
  // A `createRequire` result IS a require, so follow what it loads (ITEM A).
  const { aliases, inlineCalls } = requireAliases(source);
  for (const site of aliasCallSites(source, aliases, inlineCalls)) {
    const args = callArguments(source, site.open);
    const specifier = args === null ? null : staticString(args[0]);
    if (specifier === null) continue;   // reported by unanalyzableSpecifiersIn
    const resolved = resolveSpecifier(file, specifier);
    if (resolved) found.push(resolved);
  }
  return found;
}

/**
 * Blanks comment bodies and string bodies, PRESERVING every byte offset and
 * newline, so a call site can be located in code without finding one written
 * in prose. Only used to LOCATE calls; arguments are always read back out of
 * the original source at the same offsets.
 *
 * REGULAR-EXPRESSION LITERALS ARE MASKED TOO, and that is not a nicety.
 * Without it this masker MIS-FIRED ON THIS VERY FILE: a quote inside a
 * character class such as `['"]` opened a "string" that ran on past a `/*`,
 * so the block comment after it was never blanked and its prose was read as
 * code. It reported two findings against the scanner's own documentation —
 * the self-detonation this whole section exists to avoid. Blanking a regex
 * literal fixes that and is desirable on its own: a pattern SOURCE naming a
 * call is not a call.
 *
 * Telling a regex literal from division needs the previous significant token,
 * which is what `opensRegex` reads. It is still a masker, not a parser, and it
 * can blank more than it should — that direction only costs a call site it
 * fails to notice.
 */
const REGEX_PRECEDER = /[(,=:[!&|?{};+\-*%~^<>]/;
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else', 'yield', 'await',
]);

/** Does the `/` at `at` open a regular-expression literal rather than divide? */
function opensRegex(chars, at) {
  let k = at - 1;
  while (k >= 0 && /\s/.test(chars[k])) k -= 1;
  if (k < 0) return true;                       // start of input
  if (REGEX_PRECEDER.test(chars[k])) return true;
  if (!/[\w$]/.test(chars[k])) return false;    // after `)` or `]`, `/` divides
  let start = k;
  while (start >= 0 && /[\w$]/.test(chars[start])) start -= 1;
  return REGEX_KEYWORDS.has(chars.slice(start + 1, k + 1).join(''));
}

/**
 * Masking is memoized per source. `localImportsOf`, `unanalyzableSpecifiersIn`
 * and `requireAliases` all ask for the same two maskings of the same file in
 * the same pass; without this the scan masked every reachable entry point six
 * times over, which cost real wall time on a 70 KB source for no new
 * information. Only files already being analyzed are ever keys, so the cache
 * holds a handful of entries and is dropped with the process.
 */
const maskCache = new Map();
function maskProse(source, maskStrings = true) {
  const cached = maskCache.get(source);
  const key = maskStrings ? 'prose' : 'comments';
  if (cached?.[key] !== undefined) return cached[key];
  const masked = maskProseUncached(source, maskStrings);
  maskCache.set(source, { ...(cached ?? {}), [key]: masked });
  return masked;
}

function maskProseUncached(source, maskStrings) {
  const out = source.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < source.length) {
    const pair = source.slice(i, i + 2);
    if (pair === '//') {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? source.length : end;
      blank(i, stop); i = stop; continue;
    }
    if (pair === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      blank(i, stop); i = stop; continue;
    }
    const ch = source[i];
    if (ch === '/' && opensRegex(out, i)) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length) {
        const c = source[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '\n') break;                  // a regex literal cannot span lines
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        j += 1;
      }
      if (j < source.length && source[j] === '/') { blank(i, j + 1); i = j + 1; continue; }
      // Unterminated: it was division after all. Fall through.
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) j += source[j] === '\\' ? 2 : 1;
      const stop = Math.min(j + 1, source.length);
      // A declaration is found by the module name INSIDE its string, so the
      // caller can keep string bodies while still dropping comments.
      if (maskStrings) blank(i, stop);
      i = stop; continue;
    }
    i += 1;
  }
  return out.join('');
}

/** The index just past the `)` closing the call whose `(` is at `open`. */
function closingParen(source, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth += 1; continue; }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * `createRequire` ALIASES (ITEM A).
 *
 * A reachable wrapper could reach any module, and any command inside it,
 * through one indirection the follower did not know:
 *
 *     import { createRequire } from 'node:module';
 *     const r = createRequire(import.meta.url);
 *     r('./deploy.cjs');                        // execSync('vercel --prod')
 *
 * That is the same silent-pass class as a quoted entry path (F3), a baseline
 * entry (F9) and a computed specifier — all of which are now reported. A
 * `createRequire` result is a `require`, so the binding it is assigned to is
 * treated as one: a literal specifier is FOLLOWED, and anything this scan
 * cannot read is REPORTED.
 *
 * Declarations are read from comment-masked source with STRINGS KEPT, because
 * the import is identified by the module name inside its own string literal.
 * Call sites are located in fully masked source, so prose never becomes a
 * finding.
 */
const MODULE_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?module['"]/g;
const MODULE_REQUIRE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"](?:node:)?module['"]\s*\)/g;
const MODULE_NAMESPACE =
  /import\s+(?:\*\s*as\s+)?([A-Za-z_$][\w$]*)\s*from\s*['"](?:node:)?module['"]/g;

function requireAliases(source) {
  const code = maskProse(source, false);  // comments gone, string bodies kept
  const factories = new Set();
  const collect = (clauses, separator) => {
    for (const clause of clauses.split(',')) {
      const [imported, alias] = clause.trim().split(separator);
      if ((imported ?? '').trim() === 'createRequire') factories.add((alias ?? imported).trim());
    }
  };
  for (const m of code.matchAll(MODULE_IMPORT)) collect(m[1], /\s+as\s+/);
  for (const m of code.matchAll(MODULE_REQUIRE)) collect(m[1], ':');
  for (const m of code.matchAll(MODULE_NAMESPACE)) factories.add(`${m[1]}.createRequire`);

  const aliases = new Set();
  const declared = new Set();   // offset of each alias name in its declaration
  const inlineCalls = [];       // createRequire(…)(…) — a call with no binding
  for (const factory of factories) {
    const call = new RegExp(String.raw`(?<![.\w$])${escapeForRegExp(factory)}\s*\(`, 'g');
    for (const m of code.matchAll(call)) {
      const end = closingParen(source, m.index + m[0].length - 1);
      if (end < 0) continue;
      const after = code.slice(end).match(/^\s*\(/);
      if (after) inlineCalls.push(end + after[0].length - 1);
    }
    const binding = new RegExp(
      String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${escapeForRegExp(factory)}\s*\(`,
      'g',
    );
    for (const m of code.matchAll(binding)) {
      aliases.add(m[1]);
      declared.add(m.index + m[0].indexOf(m[1]));
    }
  }

  /**
   * A binding that is REASSIGNED no longer stands for the require it was built
   * from, so what it loads stops being knowable from this file.
   *
   * A DECLARATION IS NOT A REASSIGNMENT, AND A SHADOW IS NOT THE BINDING
   * (finding G). `export function f() { let r = 0; r = r + 1; }` neither
   * declares nor rebinds the outer require — it assigns to a different `r`
   * entirely — and counting it reported an innocent file, twice, through a
   * message template that did not fit.
   *
   * Each write is attributed to the NEAREST PRECEDING DECLARATION of that
   * name. Only a write whose nearest declaration is the createRequire one is a
   * reassignment of the require. That is not full scope analysis, but it is
   * the fact the finding actually turns on, and it costs nothing.
   */
  const reassigned = [];
  for (const alias of aliases) {
    const name = escapeForRegExp(alias);
    const declarations = [];
    for (const m of code.matchAll(new RegExp(String.raw`(?:const|let|var)\s+${name}(?![\w$])`, 'g'))) {
      declarations.push({ index: m.index, isRequire: declared.has(m.index + m[0].indexOf(alias)) });
    }
    const write = new RegExp(String.raw`(?<![.\w$])${name}\s*=(?!=)`, 'g');
    for (const m of code.matchAll(write)) {
      const nearest = declarations.filter((d) => d.index < m.index).pop();
      if (!nearest?.isRequire) continue;          // a declaration, or a shadowed local
      if (declared.has(m.index)) continue;        // the createRequire declaration itself
      reassigned.push({ name: alias, index: m.index });
      break;                                      // one finding per alias, not one per write
    }
  }
  return { aliases, inlineCalls, reassigned };
}

/** Every `<alias>(<literal>)` and `<alias>(<computed>)` call in a source. */
function aliasCallSites(source, aliases, inlineCalls) {
  const code = maskProse(source);
  const sites = [];
  for (const alias of aliases) {
    const call = new RegExp(String.raw`(?<![.\w$])${escapeForRegExp(alias)}\s*\(`, 'g');
    for (const m of code.matchAll(call)) sites.push({ open: m.index + m[0].length - 1, index: m.index });
  }
  for (const open of inlineCalls) sites.push({ open, index: open });
  return sites;
}

/**
 * DYNAMIC MODULE LOADS WHOSE SPECIFIER IS NOT STATIC.
 *
 * `execSync(c)` with a computed `c` was already reported as unanalyzable, but
 * `await import(m)` with a computed `m` PASSED IN SILENCE — hiding a whole
 * module subtree, and every command inside it, behind one variable. That is
 * the same silent-pass class as a quoted entry path (F3) and a baseline entry
 * (F9), and it contradicted this section's own doctrine that an unanalyzable
 * deployment-capable path is reported rather than waved through.
 *
 * A LITERAL specifier is not reported: it is resolved and FOLLOWED by
 * `localImportsOf`, which is the better outcome and is proven by its own
 * control. Only a specifier this scan cannot read is reported.
 */
const DYNAMIC_MODULE_CALL = /(?<![.\w$])(import|require)\s*\(/g;
function unanalyzableSpecifiersIn(source) {
  const sites = [];
  const masked = maskProse(source);
  const unreadable = (open) => {
    const args = callArguments(source, open);      // read from the REAL source
    return !(args !== null && args.length > 0 && staticString(args[0]) !== null);
  };
  for (const m of masked.matchAll(DYNAMIC_MODULE_CALL)) {
    if (unreadable(m.index + m[0].length - 1)) sites.push({ fn: m[1], index: m.index });
  }
  // A `createRequire` alias loads modules exactly as `require` does, so a
  // specifier it cannot be read through is unanalyzable for the same reason.
  const { aliases, inlineCalls, reassigned } = requireAliases(source);
  for (const site of aliasCallSites(source, aliases, inlineCalls)) {
    if (unreadable(site.open)) sites.push({ fn: 'createRequire', index: site.index });
  }
  // Its own sentence, not the `${fn}()` template — that produced the
  // malformed "a reassigned createRequire binding() builds its module
  // specifier at runtime" (finding G).
  for (const { name, index } of reassigned) {
    sites.push({
      index,
      reason: `the require binding \`${name}\` is reassigned after createRequire built it,`
        + ' so what it loads can no longer be read from this file',
    });
  }
  return sites;
}

const analyzedEntries = new Set();
const entryQueue = [...reachableEntries.keys()];
while (entryQueue.length > 0) {
  const file = entryQueue.shift();
  if (analyzedEntries.has(file)) continue;
  analyzedEntries.add(file);

  let source;
  try { source = readFileSync(file, 'utf8'); } catch { continue; }
  const callers = [...(reachableEntries.get(file) ?? [])].join(', ') || 'a package script';

  /** A module this file reaches inherits its callers and its scripts. */
  const reach = (target) => {
    // Inheritance runs UNCONDITIONALLY, before the analyzed check (finding H).
    // The comment here used to claim "a helper reached by two scripts is
    // attributed to both" while the `continue` above it skipped the
    // inheritance for an already-analyzed helper — the code did not do what
    // the comment said. It does now, with one honest limit: a finding already
    // EMITTED keeps the caller list known at the moment it was written.
    for (const caller of reachableEntries.get(file) ?? []) recordEntry(target, caller, null);
    for (const script of reachingScripts.get(file) ?? []) recordEntry(target, null, script);
    // CYCLE PROTECTION. `a` reaching `b` reaching `a` is ordinary; a follower
    // that re-queued an analyzed module would spin forever. Nothing is ever
    // analyzed twice, so a cycle terminates.
    if (!analyzedEntries.has(target)) entryQueue.push(target);
  };

  for (const imported of localImportsOf(file, source)) reach(imported);

  for (const site of unanalyzableSpecifiersIn(source)) {
    const where = `${file}:${lineAtIndex(source, site.index).number}`;
    const why = site.reason
      ?? `${site.fn}() builds its module specifier at runtime, so the module it loads,`
        + ' and every command inside it, cannot be read';
    add(
      'deploy-analyzability',
      `${where} — ${why}; this file is run by ${callers},`
      + ' and a deployment-capable path must be statically analyzable',
    );
  }

  for (const escape of escapingChildProcessUses(source)) {
    add(
      'deploy-analyzability',
      `${file}:${lineAtIndex(source, escape.index).number} — the child_process binding \`${escape.name}\``
      + ` ${escape.how}, so what it runs cannot be read; this file is run by ${callers},`
      + ' and a deployment-capable path must be statically analyzable',
    );
  }

  for (const site of execCallSites(source)) {
    const where = `${file}:${lineAtIndex(source, site.index).number}`;
    const args = callArguments(source, site.open);
    const command = args === null ? null : staticCommandOf(site.fn, args);
    if (command === null) {
      add(
        'deploy-analyzability',
        `${where} — ${site.fn}() builds its command at runtime, and this file is run by ${callers};`
        + ' a deployment-capable path must be statically analyzable',
      );
      continue;
    }
    // A WRAPPER THAT RUNS ANOTHER NODE SCRIPT (finding C). The command is
    // static and names a tracked, scannable file, so the path CAN be read
    // through — and the banner says nothing readable is passed in silence.
    // The queue and the cycle guard handle the rest.
    for (const entry of nodeEntriesIn(command, '', where)) reach(entry);
    for (const why of deployHits(command)) {
      add('ci-deploy', `${where} — ${why} in ${site.fn}(), run by ${callers}`);
      for (const script of reachingScripts.get(file) ?? []) deployingScripts.add(script);
    }
  }
}

/* --- 6e. workflows: active behaviour and executable configuration ------ */
for (const { file: f, number, raw, executable } of workflowLines) {
  const where = `${f}:${number}`;
  checkDeployLine(where, raw, executable);

  // A workflow that runs a deploying package script deploys, however
  // innocent the step line looks.
  if (!executable) continue;
  for (const script of deployingScripts) {
    // The name is DATA, not pattern source. `build:prod(fast)` is a legal npm
    // script name; interpolated raw it becomes a capture group that matches
    // something else entirely, and `deploy[all` is not a valid regular
    // expression at all — it would throw and abort the scan mid-run.
    const name = escapeForRegExp(script);
    // A trailing `\b` cannot follow a name that ends in `)`, so the boundary is
    // expressed as "no character that could continue a script name".
    const invocation = new RegExp(
      String.raw`\b(?:npm|pnpm|bun)\s+run\s+${name}(?![\w.:@/-])|\byarn\s+${name}(?![\w.:@/-])`,
    );
    if (invocation.test(raw)) {
      add('ci-deploy', `${where} — runs the deploying package script "${script}"`);
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
  console.log('      per occurrence, only in test/fixture files — a `.test.`/`.spec.` file or a test/fixture');
  console.log('      DIRECTORY, never a production module merely named "fixtures" — and only for obviously');
  console.log('      synthetic values, judged on the residue left after every marker word is stripped)');
  console.log('  no production-shaped PSP Agent ID literal');
  console.log('  no .only test');
  console.log(
    `  no active deployment command in package scripts, shell wrappers or .github workflows`
    + ` (${DEPLOY_PATTERNS.length + DEPLOY_BINARIES.length} behaviours + any deployment action)`,
  );
  console.log(
    `     (plus the ${analyzedEntries.size} Node entry point(s) those scripts and steps actually run with`
    + ' `node <file>`,',
  );
  console.log('      and the local modules those files reach — by a binding import, a BARE SIDE-EFFECT');
  console.log('      import, a re-export, a require(), a createRequire alias,');
  console.log('      or a dynamic import with a literal specifier;');
  console.log('      plus any further `node <file>` a wrapper itself runs.');
  console.log('      child_process commands there are read as commands.');
  console.log('      NOT scanned: every other tracked source file. Nothing a reachable wrapper cannot be');
  console.log('      read through is passed in silence: a command it builds at runtime, a COMPUTED');
  console.log('      specifier whose module therefore cannot be read, a child_process binding that escapes');
  console.log('      its call form, and a path into the frozen baseline are each');
  console.log('      reported as unanalyzable rather than passed)');
  process.exit(0);
}

console.error('RELAY REPOSITORY BOUNDARY: FAIL');
for (const { rule, detail } of findings) console.error(`  [${rule}] ${detail}`);
console.error(`\n${findings.length} finding(s).`);
process.exit(1);
