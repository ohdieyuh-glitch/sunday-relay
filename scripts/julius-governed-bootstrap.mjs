// Installs a signed checkpoint attestation on main with the governed App.
//
// julius-governed-land.yml runs only from main, so the first move from the
// current main cannot be that workflow. Gatekeeper runs this on a checkout of
// the target, with an App installation token in JULIUS_GOVERNED_LANDER_TOKEN.
// Dry-run is the default. --execute is the only arm.
// There is no re-enable flag and no skip.
//
// The target argument R is the commit the Independent Reviewer attested, and
// --target-tree is required. This script creates installer commit I on top of
// R. I removes every attestation file already in R's checkpoint directory and
// adds only <R>.txt and its signature, so main carries exactly one
// attestation. It reads I back and moves main only when I's tree is the tree
// it created, I's single parent is R, I's message is the installer message,
// the R...I diff is exactly those attestation paths, the committer is the App
// bot and GitHub reports the signature verified. The update is force:false.
//
// Recovery. The same script, with R equal to main, replaces an expired or
// expiring attestation on main with a fresh signed one. That is the recovery
// for every expiry, including the window this script installs, so the window
// may be as long as ATTESTATION_MAX_WINDOW_MS. It must still have
// BOOTSTRAP_MIN_REMAINING_MS left when it is installed. Keep this file: it is
// the only path that can re-attest main once an attestation has expired,
// because every gate, including the governed lander, refuses an expired one.

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { branchRulesProblems, governedCommitBody, readGovernedEnvironment } from '../.github/julius-landing/governed-land.mjs';
import {
  CHECKPOINT_ATTESTATION_DIR,
  FOUNDER_APPROVAL_KEY_PATH,
  FOUNDER_REFUSAL,
  PINNED_REVIEWER_SPKI_SHA256,
  TRUSTED_CHECKPOINT_SHA,
  TRUSTED_COMPUTING_BASE,
  attestationShapeProblem,
  checkpointAttestationProblems,
  founderApprovalProblem,
  isCheckpointInstallerDiff,
  parseAnchor,
  landingIdentityProblem,
  parseCheckpointAttestation,
  reviewerKeyMaterial,
  reviewerKeyPinRefusal,
} from './julius-main-provenance-trust.mjs';

export const GOVERNED_LANDER_APP_ID = '5457712';
export const GOVERNED_LANDER_BOT_ID = '347502603';

/**
 * The inline token mint in the founder block. It runs on the founder's machine,
 * reads the PEM path the founder sets, and writes the token only to stdout,
 * which the block captures into a shell variable. This script never runs it,
 * never reads a PEM, and never prints a token.
 */
export const WORKFLOWS_PERMISSION_MESSAGE = 'the julius-governed-lander App lacks Workflows: Read and write; enable it in the App\'s settings and accept the updated permissions on the installation, then rerun';

export const FOUNDER_MINT_JS = [
  'import { createSign } from "node:crypto"; import { readFileSync } from "node:fs";',
  `const WORKFLOWS = ${JSON.stringify(WORKFLOWS_PERMISSION_MESSAGE)};`,
  'const now = Math.floor(Date.now() / 1000); const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");',
  'const unsigned = b64({ alg: "RS256", typ: "JWT" }) + "." + b64({ iat: now - 60, exp: now + 540, iss: process.env.JULIUS_GOVERNED_LANDER_APP_ID });',
  'const jwt = unsigned + "." + createSign("RSA-SHA256").update(unsigned).sign(readFileSync(process.env.JULIUS_APP_PEM_FILE)).toString("base64url");',
  'const h = { Authorization: "Bearer " + jwt, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };',
  'const inst = await fetch("https://api.github.com/repos/ohdieyuh-glitch/sunday-relay/installation", { headers: h });',
  'if (!inst.ok) { console.error("installation lookup answered " + inst.status); process.exit(1); }',
  'const installed = await inst.json(); const id = installed.id; const have = installed.permissions ?? {};',
  // HIGH-1: the target changes workflow files, so the installer commit needs workflows:write. The anchors are
  // read from the variables API. Refuse here, before any write, when the App was not granted those permissions.
  'const need = { contents: "write", metadata: "read", actions: "read", workflows: "write", actions_variables: "read" };',
  'const rank = (v) => (v === "write" ? 2 : v === "read" ? 1 : 0);',
  'const missing = Object.entries(need).filter(([k, v]) => rank(have[k]) < rank(v)).map(([k, v]) => k + ":" + v);',
  'if (missing.includes("workflows:write")) { console.error(WORKFLOWS); process.exit(1); }',
  'if (missing.length > 0) { console.error("the julius-governed-lander App lacks " + missing.join(", ") + "; enable it in the App\'s settings and accept the updated permissions on the installation, then rerun"); process.exit(1); }',
  'const body = JSON.stringify({ repositories: ["sunday-relay"], permissions: need });',
  'const res = await fetch("https://api.github.com/app/installations/" + id + "/access_tokens", { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body });',
  // GitHub answers 422 when a requested permission was not granted to the App. Nothing has been written yet.
  // Only the status is printed, never the response body, the token or the PEM.
  'if (res.status === 422) { console.error(WORKFLOWS + " (or Variables: Read-only is missing)"); process.exit(1); }',
  'if (!res.ok) { console.error("token mint answered " + res.status); process.exit(1); }',
  'process.stdout.write((await res.json()).token);',
];

/** F4: every required-checks.txt entry is one green check run from its App on TARGET. Reads gh, prints only names. */
export const FOUNDER_CI_GATE_JS = [
  'const { execFileSync } = require("node:child_process"); const { readFileSync } = require("node:fs");',
  'const target = process.argv[1];',
  'const required = readFileSync(".github/julius-landing/required-checks.txt", "utf8").split("\\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))',
  '  .map((l) => { const m = /^(.*\\S)\\s+@([0-9]+)$/u.exec(l); return m ? { name: m[1], app: Number(m[2]) } : { name: l, app: undefined }; });',
  'const body = JSON.parse(execFileSync("gh", ["api", "repos/ohdieyuh-glitch/sunday-relay/commits/" + target + "/check-runs?per_page=100"], { encoding: "utf8" }));',
  'const runs = Array.isArray(body.check_runs) && body.total_count === body.check_runs.length ? body.check_runs : null;',
  'if (runs === null) { console.error("the check runs on the target could not be read completely"); process.exit(1); }',
  'const bad = required.filter(({ name, app }) => { const hits = runs.filter((r) => r.name === name); return hits.length !== 1 || hits[0].status !== "completed" || hits[0].conclusion !== "success" || (app !== undefined && hits[0].app?.id !== app); });',
  'if (required.length === 0 || bad.length > 0) { console.error("required checks are not all green on the target: " + (bad.map((r) => r.name).join(", ") || "required-checks.txt is empty")); process.exit(1); }',
];

/** F5d: the live branch rules still match the committed snapshot after the move. */
const FOUNDER_RULES_JS = [
  'const { execFileSync } = require("node:child_process"); const { readFileSync } = require("node:fs");',
  'const snap = JSON.parse(readFileSync(".github/julius-landing/main-ruleset.json", "utf8"));',
  'const live = JSON.parse(execFileSync("gh", ["api", "repos/ohdieyuh-glitch/sunday-relay/rules/branches/main"], { encoding: "utf8" }));',
  'const same = Array.isArray(live) && live.length === snap.rules.length && live.every((r) => r.ruleset_id === snap.id) && snap.rules.every((r) => live.some((l) => l.type === r.type));',
  'if (!same) { console.error("the live main branch rules no longer match main-ruleset.json"); process.exit(1); }',
];

/** Revokes the token through node, so it never sits on a command line. Exits non-zero when the revoke fails. */
const FOUNDER_REVOKE_JS = 'fetch("https://api.github.com/installation/token", { method: "DELETE", headers: { Authorization: "Bearer " + process.env.JULIUS_GOVERNED_LANDER_TOKEN, Accept: "application/vnd.github+json" } }).then((r) => process.exit(r.status === 204 ? 0 : 1), () => process.exit(1))';

/**
 * The one command block the founder runs, on the founder's own machine, from a
 * clean checkout of the target. No workflow on main can mint the App token
 * before this bootstrap, and no agent may handle the App private key, so the
 * founder mints a one-hour installation token from the PEM they hold. The PEM
 * path reaches only the mint process; the token reaches only the bootstrap and
 * the revoke, never a command line, and is revoked on exit with a loud warning
 * if that fails. The block stops at the first failed check (set -euo pipefail).
 * The founder's own lines (the .founder.sig path, the fingerprint, the PEM
 * path) are never pre-filled from arguments (F2).
 */
export function founderCommandBlock({ mainSha, target, targetTree, attestation, signature } = {}) {
  const value = (text, placeholder) => (typeof text === 'string' && text !== '' ? text : placeholder);
  const q = (text) => `'${String(text).replace(/'/gu, "'\\''")}'`;
  return [
    '# ---- FOUNDER: run this whole block in bash on your own machine, from a clean checkout of the target. ----',
    '# Nothing in it prints the token or the PEM. It stops at the first failed check.',
    '(',
    'set -euo pipefail',
    '# 1. The values this landing is bound to. Fill in the three founder lines yourself.',
    `MAIN_SHA=${q(value(mainSha, '<main sha>'))}`,
    `TARGET=${q(value(target, '<target sha>'))}`,
    `TARGET_TREE=${q(value(targetTree, '<target tree>'))}`,
    `ATTESTATION=${q(value(attestation, '<path to the signed attestation .txt>'))}`,
    `SIGNATURE=${q(value(signature, '<path to the reviewer .sig>'))}`,
    `FOUNDER_SIGNATURE=${q('<path to the .founder.sig you wrote on the offline device>')}`,
    `FOUNDER_FINGERPRINT=${q('<the SPKI-DER sha256 of your founder-approval key, from your offline record>')}`,
    `APP_PEM_FILE=${q('<path to the App private key file you hold>')}`,
    `export JULIUS_GOVERNED_LANDER_APP_ID=${GOVERNED_LANDER_APP_ID} JULIUS_GOVERNED_LANDER_BOT_ID=${GOVERNED_LANDER_BOT_ID}`,
    `REVIEWER_PIN=${PINNED_REVIEWER_SPKI_SHA256}`,
    '# 2. Prerequisites. Each line fails the block if it does not hold.',
    'command -v node >/dev/null; command -v git >/dev/null; command -v gh >/dev/null',
    'node -e \'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)\'',
    'test -z "$(git status --porcelain --untracked-files=all)"',
    'test "$(git rev-parse HEAD)" = "$TARGET"',
    'test "$(git rev-parse "HEAD^{tree}")" = "$TARGET_TREE"',
    'test -s "$ATTESTATION"; test -s "$SIGNATURE"; test -s "$FOUNDER_SIGNATURE"; test -r "$APP_PEM_FILE"',
    `test "$(gh api repos/${REPO}/git/ref/heads/main --jq .object.sha)" = "$MAIN_SHA"`,
    `test "$(gh api repos/${REPO}/actions/variables/JULIUS_REVIEWER_KEY_SHA256 --jq .value)" = "$REVIEWER_PIN"`,
    `test "$(gh api repos/${REPO}/actions/variables/JULIUS_FOUNDER_APPROVAL_KEY_SHA256 --jq .value)" = "$FOUNDER_FINGERPRINT"`,
    `test "$(node -e 'const c=require("node:crypto");process.stdout.write(c.createHash("sha256").update(c.createPublicKey(require("node:fs").readFileSync(process.argv[1])).export({type:"spki",format:"der"})).digest("hex"))' ${FOUNDER_APPROVAL_KEY_PATH})" = "$FOUNDER_FINGERPRINT"`,
    '# 3. CI gate: every entry of required-checks.txt is one green check run from its App on the target.',
    `node -e ${q(FOUNDER_CI_GATE_JS.join('\n'))} "$TARGET"`,
    '# 4. Mint a one-hour installation token for this repository only. Only this process sees the PEM path.',
    `JULIUS_GOVERNED_LANDER_TOKEN="$(JULIUS_APP_PEM_FILE="$APP_PEM_FILE" node --input-type=module -e ${q(FOUNDER_MINT_JS.join('\n'))})"`,
    'export JULIUS_GOVERNED_LANDER_TOKEN',
    `revoke() { node -e ${q(FOUNDER_REVOKE_JS)} || echo "WARNING: THE INSTALLATION TOKEN WAS NOT REVOKED. It expires within one hour; revoke it from a trusted shell now." >&2; }`,
    'trap revoke EXIT',
    'ARGS=(--main-sha "$MAIN_SHA" --target "$TARGET" --target-tree "$TARGET_TREE" --attestation "$ATTESTATION" --signature "$SIGNATURE" --founder-signature "$FOUNDER_SIGNATURE" --founder-fingerprint "$FOUNDER_FINGERPRINT")',
    '# 5. Dry run. It only reads, prints the planned target..installer diff, and must exit 0.',
    'node scripts/julius-governed-bootstrap.mjs "${ARGS[@]}"',
    '# 6. Your checkpoint: read the planned diff above, then type the confirmation.',
    'read -r -p "Type EXECUTE ${TARGET:0:12} to move main: " CONFIRM </dev/tty',
    'test "$CONFIRM" = "EXECUTE ${TARGET:0:12}"',
    '# 7. Execute. Creates the installer commit as the App and moves main with force:false. Exit 2 means main is in doubt: stop and check main.',
    'node scripts/julius-governed-bootstrap.mjs "${ARGS[@]}" --execute',
    '# 8. Verify: main has exactly one parent, the target; the tree differs only in the checkpoint directory; the rules still match; the verifier accepts main.',
    'git fetch -q origin main',
    'test "$(git rev-list --parents -n 1 origin/main)" = "$(git rev-parse origin/main) $TARGET"',
    `test -z "$(git diff --name-only "$TARGET" origin/main | grep -v '^[.]github/julius-landing/checkpoints/' || true)"`,
    `diff <(git ls-tree -r "$TARGET" | grep -v '	[.]github/julius-landing/checkpoints/') <(git ls-tree -r origin/main | grep -v '	[.]github/julius-landing/checkpoints/')`,
    `node -e ${q(FOUNDER_RULES_JS.join('\n'))}`,
    'VERIFY="$(mktemp -d)/main"; git worktree add -q --detach "$VERIFY" origin/main',
    '(cd "$VERIFY" && env -u GH_TOKEN -u JULIUS_GOVERNED_LANDER_TOKEN JULIUS_REVIEWER_KEY_SHA256="$REVIEWER_PIN" JULIUS_FOUNDER_APPROVAL_KEY_SHA256="$FOUNDER_FINGERPRINT" node scripts/julius-main-provenance-trust.mjs --require-trusted-verifier)',
    'git worktree remove --force "$VERIFY"',
    'echo "bootstrap verified: main is $(git rev-parse origin/main)"',
    ')',
    '# ---- end of founder block ----',
    '',
  ].join('\n');
}

/** The longest window this script installs: 90 days. Recovery re-attests before or after expiry. */
export const ATTESTATION_MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** Kept for callers of the earlier name. It is the same ceiling. */
export const BOOTSTRAP_MAX_WINDOW_MS = ATTESTATION_MAX_WINDOW_MS;
/** An attestation that expires sooner than this after it is installed is refused: it would need recovery at once. */
export const BOOTSTRAP_MIN_REMAINING_MS = 7 * 24 * 60 * 60 * 1000;
/** The first-parent walk from the target back to the attestation prior stops here and refuses. */
export const ATTESTED_RANGE_CAP = 250;
export const INSTALLER_COMMIT_MESSAGE = [
  'Add the signed checkpoint attestation.',
  '',
  'Parent is the attested checkpoint. This commit replaces the checkpoint directory with only that attestation, its reviewer signature and its founder-approval signature.',
  '',
].join('\n');

const SHA = /^[0-9a-f]{40}$/u;
const REPO = 'ohdieyuh-glitch/sunday-relay';
const ROOT = dirname(fileURLToPath(import.meta.url));
const PUB_PATH = '.github/julius-landing/reviewer-ed25519.pub';
const SNAPSHOT_PATH = '.github/julius-landing/main-ruleset.json';

export function attestationRelPaths(targetSha) {
  return {
    txt: `${CHECKPOINT_ATTESTATION_DIR}/${targetSha}.txt`,
    sig: `${CHECKPOINT_ATTESTATION_DIR}/${targetSha}.sig`,
    founder: `${CHECKPOINT_ATTESTATION_DIR}/${targetSha}.founder.sig`,
  };
}

/** The installer diff: every existing checkpoint file removed, the new attestation files added. Sorted, exact. */
export function installerDiffPlan(targetSha, existingNames) {
  const added = Object.values(attestationRelPaths(targetSha));
  const removed = (Array.isArray(existingNames) ? existingNames : [])
    .map((name) => `${CHECKPOINT_ATTESTATION_DIR}/${name}`)
    .filter((path) => !added.includes(path));
  return {
    added: [...added].sort(),
    removed: [...removed].sort(),
  };
}

export function bootstrapAuditRecord({ status, main, parent, target, tree, installer }) {
  return [
    'JULIUS GOVERNED BOOTSTRAP',
    `status: ${status}`,
    `main: ${main}`,
    `parent: ${parent}`,
    `target: ${target}`,
    `tree: ${tree}`,
    `installer: ${installer}`,
    'method: fast-forward',
    '',
  ].join('\n');
}

/** The installer read back from GitHub, against exactly what was asked for. Any problem means main does not move. */
export function installerReadBackProblems({ commit, compare, expectedTree, target, plan }) {
  const problems = [];
  if (commit?.tree?.sha !== expectedTree) problems.push(`the installer tree is ${commit?.tree?.sha ?? 'unreadable'}, not the created tree ${expectedTree}`);
  const parents = Array.isArray(commit?.parents) ? commit.parents.map((row) => row?.sha) : [];
  if (parents.length !== 1 || parents[0] !== target) problems.push(`the installer parents are ${parents.join(',') || 'unreadable'}, not the target ${target}`);
  const stored = commit?.message;
  if (stored !== INSTALLER_COMMIT_MESSAGE && stored !== INSTALLER_COMMIT_MESSAGE.replace(/\n$/u, '')) problems.push('the installer message is not the installer message');
  const files = Array.isArray(compare?.files) ? compare.files : null;
  if (compare?.status !== 'ahead' || compare?.ahead_by !== 1 || compare?.behind_by !== 0 || files === null) {
    problems.push('the target...installer diff is not one commit ahead');
  } else {
    const rows = files.map((file) => `${file?.status}:${file?.filename}`).sort();
    const wanted = [...plan.added.map((path) => `added:${path}`), ...plan.removed.map((path) => `removed:${path}`)].sort();
    if (rows.length !== wanted.length || rows.some((row, index) => row !== wanted[index])) {
      problems.push(`the target...installer diff is ${rows.join(', ') || 'empty'}, not exactly ${wanted.join(', ')}`);
    }
  }
  return problems;
}

/** Pure decision. Network and disk stay in runBootstrap. */
export function evaluateGovernedBootstrap(input) {
  const problems = [];
  const expected = input?.expectedMainSha;
  const main = input?.mainSha;
  const target = input?.targetSha;
  const targetTree = input?.targetTree;
  if (typeof expected !== 'string' || !SHA.test(expected)) problems.push('the expected main sha is not a full 40-hex sha');
  if (typeof main !== 'string' || !SHA.test(main)) problems.push('main could not be read');
  else if (typeof expected === 'string' && SHA.test(expected) && main !== expected) {
    problems.push(`main is ${main}, not the expected ${expected}`);
  }
  if (typeof target !== 'string' || !SHA.test(target)) problems.push('the target sha is not a full 40-hex sha');
  if (typeof targetTree !== 'string' || !SHA.test(targetTree)) problems.push('the target tree is not a full 40-hex sha');
  if (input?.liveTargetTree !== targetTree) problems.push(`the target tree is ${input?.liveTargetTree ?? 'unreadable'}, not ${targetTree}`);
  const compare = input?.compare;
  const recovery = typeof main === 'string' && main === target;
  const descends = recovery || (compare?.behind_by === 0 && compare?.status === 'ahead' && Number(compare?.ahead_by) > 0);
  if (!descends) problems.push('the target is not main and does not descend from main');
  const pin = reviewerKeyPinRefusal(input?.publicKeyPem, input?.externalAnchor);
  if (pin) problems.push(pin.reason);
  // HIGH-2: the founder types the founder-approval key fingerprint computed on the offline
  // device. The key file in the target and the repository variable must both be that key,
  // so neither an agent-set variable nor a key file in the target authorizes itself.
  const typed = input?.founderFingerprint;
  if (typeof typed !== 'string' || !/^[0-9a-f]{64}$/u.test(typed)) {
    problems.push(`${FOUNDER_REFUSAL.anchorMismatch}: --founder-fingerprint is required: the lowercase-hex SPKI-DER sha256 of the founder-approval key, computed on the offline device`);
  } else {
    if (reviewerKeyMaterial(input?.founderPublicKeyPem).spkiSha256 !== typed) {
      problems.push(`${FOUNDER_REFUSAL.anchorMismatch}: the founder-approval key file in the target is not the key in --founder-fingerprint`);
    }
    if (input?.founderAnchor !== typed) problems.push(`${FOUNDER_REFUSAL.anchorMismatch}: the repository variable JULIUS_FOUNDER_APPROVAL_KEY_SHA256 is not the key in --founder-fingerprint`);
  }
  // BLOCKER-1: once main carries an attestation or a founder pin, the target cannot bring its
  // own keys. The attestation must verify under main's current reviewer and founder keys too,
  // and each of those must still equal its anchor. A target that changes either key file can
  // then never pass, because one signature cannot verify under two different keys.
  const mainFounderPem = typeof input?.mainFounderPem === 'string' ? input.mainFounderPem : '';
  const mainPinned = input?.mainHasAttestation === true || mainFounderPem !== '';
  if (mainPinned) {
    const mainReviewer = reviewerKeyMaterial(input?.mainReviewerPem);
    if (!mainReviewer.key || mainReviewer.spkiSha256 !== input?.externalAnchor) {
      problems.push('main\'s reviewer key is not the key in JULIUS_REVIEWER_KEY_SHA256; a bootstrap cannot change keys');
    } else if (founderApprovalProblem({ text: input?.attestationText, signatureB64: input?.attestationSignatureB64, pem: input?.mainReviewerPem, pinned: false })) {
      problems.push('the attestation is not signed by main\'s current reviewer key; a bootstrap cannot change keys');
    }
    if (mainFounderPem === '') {
      problems.push(`${FOUNDER_REFUSAL.keyUnpinned}: main carries a checkpoint attestation but no founder-approval pin; a bootstrap cannot add one over it`);
    } else {
      const current = founderApprovalProblem({ text: input?.attestationText, signatureB64: input?.attestationFounderSignatureB64, pem: mainFounderPem, anchor: input?.founderAnchor });
      if (current) problems.push(`the attestation is not founder-approved under main's current founder-approval key (a bootstrap cannot change keys): ${current}`);
    }
  }
  const allowedPriors = [TRUSTED_CHECKPOINT_SHA, ...(typeof input?.mainCheckpoint === 'string' && SHA.test(input.mainCheckpoint) ? [input.mainCheckpoint] : [])];
  const text = input?.attestationText;
  const parsed = typeof text === 'string' && text !== '' ? parseCheckpointAttestation(text) : null;
  const existing = Array.isArray(input?.existingCheckpointNames) ? input.existingCheckpointNames : null;
  if (existing === null) problems.push('the checkpoint directory at the target could not be read');
  else if (existing.some((name) => !/^[0-9a-f]{40}\.(txt|sig|founder\.sig)$/u.test(name))) {
    problems.push(`the checkpoint directory at the target holds files that are not attestations: ${existing.join(', ')}`);
  }
  if (!parsed || parsed.problems.length > 0) problems.push('the checkpoint attestation was not verified');
  else {
    const verified = checkpointAttestationProblems({
      text,
      signatureB64: input?.attestationSignatureB64,
      pem: input?.publicKeyPem,
      treeHashes: input?.treeHashes,
      now: input?.now,
      founderSignatureB64: input?.attestationFounderSignatureB64,
      founderPem: input?.founderPublicKeyPem,
      founderAnchor: input?.founderAnchor,
    });
    // H1: the attestation needs the reviewer and the founder-approval signature over the same bytes.
    if (verified.length > 0) problems.push('the checkpoint attestation was not verified', ...verified.slice(1));
    if (typeof target === 'string' && SHA.test(target)) {
      const plan = installerDiffPlan(target, existing ?? []);
      const after = plan.added.map((path) => path.slice(CHECKPOINT_ATTESTATION_DIR.length + 1));
      const shape = attestationShapeProblem({ names: after, text, allowedPriors });
      if (shape) problems.push(`the installed checkpoint directory would be refused: ${shape}`);
      if (isCheckpointInstallerDiff([...plan.added, ...plan.removed]) !== true) problems.push('the installer diff is not a checkpoint attestation');
    }
    const issued = Date.parse(parsed.fields.issued ?? '');
    const expires = Date.parse(parsed.fields.expires ?? '');
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || !(expires > issued) || expires - issued > ATTESTATION_MAX_WINDOW_MS) {
      problems.push('the attestation window is longer than the 90-day ceiling');
    } else if (typeof input?.now === 'number' && expires - input.now < BOOTSTRAP_MIN_REMAINING_MS) {
      problems.push('the attestation expires within seven days of being installed');
    }
    const last = parsed.fields.commits?.[parsed.fields.commits.length - 1];
    if (parsed.fields.checkpoint !== target || last?.sha !== target) problems.push('the attestation checkpoint is not the target commit');
    if (last?.tree !== targetTree) problems.push('the attestation does not bind the target tree');
    const chain = input?.attestedRange;
    const prior = parsed.fields.prior;
    if (!Array.isArray(chain)) problems.push(`the first-parent chain from ${prior} to the target could not be read`);
    else {
      const listed = (parsed.fields.commits ?? []).map((row) => `${row.sha} ${row.tree}`);
      const actual = chain.map((row) => `${row.sha} ${row.tree}`);
      if (listed.length !== actual.length || listed.some((row, index) => row !== actual[index])) {
        problems.push(`the attestation does not list the first-parent chain ${prior}..target exactly`);
      }
    }
  }
  if (input?.snapshotSha256 && input?.treeHashes?.[SNAPSHOT_PATH] !== input.snapshotSha256) {
    problems.push('the main ruleset snapshot is not the blob on the target');
  }
  if (input?.publicKeySha256 && input?.treeHashes?.[PUB_PATH] !== input.publicKeySha256) {
    problems.push('the reviewer key is not the blob on the target');
  }
  if (input?.founderPublicKeySha256 && input?.treeHashes?.[FOUNDER_APPROVAL_KEY_PATH] !== input.founderPublicKeySha256) {
    problems.push('the founder-approval key is not the blob on the target');
  }
  problems.push(...branchRulesProblems(input?.liveRules, input?.snapshot, input?.appId));
  const botId = typeof input?.botId === 'string' ? input.botId.trim() : '';
  if (!/^[1-9][0-9]{0,16}$/u.test(botId)) problems.push('JULIUS_GOVERNED_LANDER_BOT_ID is unset');
  return { ok: problems.length === 0, problems, recovery };
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || index + 1 >= argv.length) return undefined;
  return argv[index + 1];
}

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function github(request, token, path, init = {}) {
  const response = await request(path, {
    method: init.method ?? 'GET',
    body: init.body,
    token,
  });
  return response ?? { status: 0, body: null };
}

function contentSha256(body) {
  if (body?.encoding !== 'base64' || typeof body?.content !== 'string') return null;
  return createHash('sha256').update(Buffer.from(body.content.replace(/\n/g, ''), 'base64')).digest('hex');
}

/** The first-parent chain after `floor` up to and including `tip`, oldest first, or null. */
async function readAttestedRange(request, token, tip, floor) {
  const reversed = [];
  let sha = tip;
  for (let step = 0; step < ATTESTED_RANGE_CAP; step += 1) {
    const response = await github(request, token, `/repos/${REPO}/commits/${sha}`);
    const tree = response.body?.commit?.tree?.sha;
    const parent = response.body?.parents?.[0]?.sha;
    if (response.status !== 200 || typeof tree !== 'string' || typeof parent !== 'string') return null;
    reversed.push({ sha, tree });
    if (parent === floor) return reversed.reverse();
    sha = parent;
  }
  return null;
}

/**
 * @param {object} options
 * @param {string[]} options.argv
 * @param {NodeJS.ProcessEnv} options.env
 * @param {(path: string, init: { method: string, body?: string, token: string }) => Promise<{ status: number, body: unknown }>} [options.request]
 * @param {(path: string) => string} [options.readFile]
 * @param {number} [options.now]
 */
export async function runBootstrap({ argv = [], env = {}, request, readFile, now = Date.now() } = {}) {
  const execute = argv.includes('--execute');
  const read = readFile ?? ((path) => readFileSync(path, 'utf8'));
  const token = typeof env.JULIUS_GOVERNED_LANDER_TOKEN === 'string' ? env.JULIUS_GOVERNED_LANDER_TOKEN : '';
  const problems = [];
  if (token === '') problems.push('JULIUS_GOVERNED_LANDER_TOKEN is unset');
  const expectedMainSha = argValue(argv, '--main-sha');
  const targetSha = argValue(argv, '--target');
  const targetTreeArg = argValue(argv, '--target-tree');
  if (typeof targetTreeArg !== 'string' || !SHA.test(targetTreeArg)) problems.push('--target-tree is required and must be the full 40-hex tree of the target');
  const attestationPath = argValue(argv, '--attestation');
  const signaturePath = argValue(argv, '--signature');
  const founderSignaturePath = argValue(argv, '--founder-signature');
  const founderFingerprint = argValue(argv, '--founder-fingerprint');
  let attestationText = '';
  let attestationSignatureB64 = '';
  let attestationFounderSignatureB64 = '';
  if (typeof attestationPath !== 'string' || typeof signaturePath !== 'string' || typeof founderSignaturePath !== 'string') {
    problems.push('the attestation, signature and founder-signature paths are required');
  } else {
    try {
      attestationText = read(attestationPath);
      attestationSignatureB64 = read(signaturePath).trim();
      attestationFounderSignatureB64 = read(founderSignaturePath).trim();
    } catch {
      problems.push('the attestation files could not be read');
    }
  }
  let publicKeyPem = '';
  let snapshotText = '';
  let snapshot = null;
  try { publicKeyPem = read(join(ROOT, '..', PUB_PATH)); } catch { problems.push('the reviewer key could not be read'); }
  let founderPublicKeyPem = '';
  try { founderPublicKeyPem = read(join(ROOT, '..', FOUNDER_APPROVAL_KEY_PATH)); } catch { founderPublicKeyPem = ''; }
  try {
    snapshotText = read(join(ROOT, '..', SNAPSHOT_PATH));
    snapshot = JSON.parse(snapshotText);
  } catch { problems.push('the main ruleset snapshot could not be read'); }
  const instructions = founderCommandBlock({
    mainSha: expectedMainSha,
    target: targetSha,
    targetTree: targetTreeArg,
    attestation: attestationPath,
    signature: signaturePath,
    founderSignature: founderSignaturePath,
  });
  if (token === '' || typeof request !== 'function' || problems.length > 0) {
    if (typeof request !== 'function' && token !== '') problems.push('the GitHub client is unavailable');
    // Without a token, say exactly what the founder runs instead of a bare refusal.
    return { ok: false, execute, problems, record: null, instructions: token === '' ? instructions : null };
  }
  const mainResponse = await github(request, token, `/repos/${REPO}/git/ref/heads/main`);
  const mainSha = mainResponse.status === 200 ? mainResponse.body?.object?.sha : undefined;
  const compareResponse = SHA.test(String(mainSha)) && SHA.test(String(targetSha)) && mainSha !== targetSha
    ? await github(request, token, `/repos/${REPO}/compare/${mainSha}...${targetSha}`)
    : { status: 0, body: null };
  const commitResponse = SHA.test(String(targetSha))
    ? await github(request, token, `/repos/${REPO}/commits/${targetSha}`)
    : { status: 0, body: null };
  const liveTree = commitResponse.status === 200 ? commitResponse.body?.commit?.tree?.sha : undefined;
  // BLOCKER-1: the anchors come from the repository variables API, never from this process's environment.
  const variable = async (name) => {
    const response = await github(request, token, `/repos/${REPO}/actions/variables/${name}`);
    return response.status === 200 && typeof response.body?.value === 'string' ? response.body.value : undefined;
  };
  const rawReviewerAnchor = await variable('JULIUS_REVIEWER_KEY_SHA256');
  const rawFounderAnchor = await variable('JULIUS_FOUNDER_APPROVAL_KEY_SHA256');
  const reviewerParsed = parseAnchor(rawReviewerAnchor, 'reviewer_anchor_not_sha256');
  const founderParsed = parseAnchor(rawFounderAnchor, 'founder_anchor_not_sha256');
  if (reviewerParsed.problem) problems.push(`${reviewerParsed.problem} (JULIUS_REVIEWER_KEY_SHA256)`);
  if (founderParsed.problem) problems.push(`${founderParsed.problem} (JULIUS_FOUNDER_APPROVAL_KEY_SHA256)`);
  const externalAnchor = reviewerParsed.value ?? (rawReviewerAnchor === undefined ? undefined : '');
  const founderAnchor = founderParsed.value ?? (rawFounderAnchor === undefined ? undefined : '');
  if (externalAnchor === undefined) problems.push('the repository variable JULIUS_REVIEWER_KEY_SHA256 could not be read');
  if (founderAnchor === undefined) problems.push(`${FOUNDER_REFUSAL.anchorMismatch}: the repository variable JULIUS_FOUNDER_APPROVAL_KEY_SHA256 could not be read`);
  // Main's current pins, read from main, not from the target checkout.
  const fileAt = async (path, ref) => {
    const response = await github(request, token, `/repos/${REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`);
    if (response.status === 404) return '';
    if (response.status !== 200 || response.body?.encoding !== 'base64' || typeof response.body?.content !== 'string') return null;
    return Buffer.from(response.body.content.replace(/\n/gu, ''), 'base64').toString('utf8');
  };
  let mainReviewerPem = null;
  let mainFounderPem = null;
  let mainHasAttestation = null;
  let mainCheckpoint;
  if (SHA.test(String(mainSha))) {
    mainReviewerPem = await fileAt(PUB_PATH, mainSha);
    mainFounderPem = await fileAt(FOUNDER_APPROVAL_KEY_PATH, mainSha);
    const mainListing = await github(request, token, `/repos/${REPO}/contents/${CHECKPOINT_ATTESTATION_DIR}?ref=${mainSha}`);
    if (mainListing.status === 404) mainHasAttestation = false;
    else if (mainListing.status === 200 && Array.isArray(mainListing.body)) {
      const texts = mainListing.body.map((row) => row?.name).filter((name) => typeof name === 'string' && /^[0-9a-f]{40}[.]txt$/u.test(name));
      mainHasAttestation = texts.length > 0;
      if (texts.length === 1) {
        const mainText = await fileAt(`${CHECKPOINT_ATTESTATION_DIR}/${texts[0]}`, mainSha);
        mainCheckpoint = typeof mainText === 'string' ? parseCheckpointAttestation(mainText).fields.checkpoint : undefined;
      }
    }
  }
  if (mainReviewerPem === null || mainFounderPem === null || mainHasAttestation === null) problems.push('main\'s current keys or checkpoint directory could not be read');
  // M2: the range runs from the attestation's own prior, which is 2528ac5c or main's current checkpoint.
  const claimedPrior = parseCheckpointAttestation(attestationText).fields.prior;
  const rangeFloor = claimedPrior === mainCheckpoint && SHA.test(String(mainCheckpoint)) ? mainCheckpoint : TRUSTED_CHECKPOINT_SHA;
  const treeHashes = {};
  let existingCheckpointNames = null;
  let attestedRange = null;
  if (SHA.test(String(targetSha))) {
    for (const path of TRUSTED_COMPUTING_BASE) {
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      const blob = await github(request, token, `/repos/${REPO}/contents/${encoded}?ref=${targetSha}`);
      const digest = blob.status === 200 ? contentSha256(blob.body) : null;
      if (digest === null) problems.push(`the blob ${path} at the target could not be read`);
      else treeHashes[path] = digest;
    }
    const listing = await github(request, token, `/repos/${REPO}/contents/${CHECKPOINT_ATTESTATION_DIR}?ref=${targetSha}`);
    if (listing.status === 404) existingCheckpointNames = [];
    else if (listing.status === 200 && Array.isArray(listing.body) && listing.body.every((row) => row?.type === 'file' && typeof row?.name === 'string')) {
      existingCheckpointNames = listing.body.map((row) => row.name).sort();
    }
    attestedRange = await readAttestedRange(request, token, targetSha, rangeFloor);
  }
  const rulesResponse = await github(request, token, `/repos/${REPO}/rules/branches/main`);
  const decision = evaluateGovernedBootstrap({
    expectedMainSha,
    mainSha,
    targetSha,
    targetTree: targetTreeArg,
    liveTargetTree: liveTree,
    compare: compareResponse.status === 200 ? compareResponse.body : null,
    attestationText,
    attestationSignatureB64,
    attestationFounderSignatureB64,
    publicKeyPem,
    founderPublicKeyPem,
    founderAnchor,
    founderFingerprint,
    mainReviewerPem,
    mainFounderPem: mainFounderPem ?? '',
    mainHasAttestation: mainHasAttestation === true,
    mainCheckpoint,
    founderPublicKeySha256: founderPublicKeyPem === '' ? undefined : sha256Text(founderPublicKeyPem),
    externalAnchor,
    treeHashes,
    existingCheckpointNames,
    attestedRange,
    liveRules: rulesResponse.status === 200 ? rulesResponse.body : null,
    snapshot,
    snapshotSha256: snapshotText === '' ? undefined : sha256Text(snapshotText),
    publicKeySha256: publicKeyPem === '' ? undefined : sha256Text(publicKeyPem),
    appId: env.JULIUS_GOVERNED_LANDER_APP_ID,
    botId: env.JULIUS_GOVERNED_LANDER_BOT_ID,
    now,
  });
  problems.push(...decision.problems);
  // H2: the App key this token came from lives on governed-landing; that environment must deploy from main only.
  const environment = await readGovernedEnvironment((path) => github(request, token, path));
  problems.push(...environment.problems);
  if (problems.length > 0) return { ok: false, execute, problems, record: null };
  const pending = bootstrapAuditRecord({
    status: 'pending',
    main: 'pending',
    parent: mainSha,
    target: targetSha,
    tree: targetTreeArg,
    installer: 'pending',
  });
  if (!execute) {
    const plan = installerDiffPlan(targetSha, existingCheckpointNames);
    const summary = [
      'DRY RUN: every check passed and nothing was written.',
      `main ${mainSha} -> one installer commit on target ${targetSha} (tree ${targetTreeArg})${decision.recovery ? ' [recovery: the target is main]' : ''}`,
      ...plan.removed.map((path) => `  remove ${path}`),
      ...plan.added.map((path) => `  add    ${path}`),
      'Next: step 5 of the founder block below, the same command with --execute.',
    ].join('\n');
    return { ok: true, execute: false, problems: [], record: pending, summary, instructions };
  }
  const paths = attestationRelPaths(targetSha);
  const plan = installerDiffPlan(targetSha, existingCheckpointNames);
  const blobFor = async (content) => {
    const response = await github(request, token, `/repos/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content, encoding: 'utf-8' }),
    });
    if (response.status !== 201 || typeof response.body?.sha !== 'string') throw new Error(`blob create answered ${response.status}`);
    return response.body.sha;
  };
  let installerSha = '';
  let landedNote = null;
  try {
    const txtBlob = await blobFor(attestationText);
    const sigBlob = await blobFor(`${attestationSignatureB64}\n`);
    const founderBlob = await blobFor(`${attestationFounderSignatureB64}\n`);
    const treeResponse = await github(request, token, `/repos/${REPO}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: targetTreeArg,
        tree: [
          ...plan.removed.map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
          { path: paths.txt, mode: '100644', type: 'blob', sha: txtBlob },
          { path: paths.sig, mode: '100644', type: 'blob', sha: sigBlob },
          { path: paths.founder, mode: '100644', type: 'blob', sha: founderBlob },
        ],
      }),
    });
    if (treeResponse.status !== 201 || typeof treeResponse.body?.sha !== 'string') throw new Error(`tree create answered ${treeResponse.status}`);
    const createdTree = treeResponse.body.sha;
    const commitResponseWrite = await github(request, token, `/repos/${REPO}/git/commits`, {
      method: 'POST',
      body: JSON.stringify(governedCommitBody({
        message: INSTALLER_COMMIT_MESSAGE,
        tree: createdTree,
        parents: [targetSha],
      })),
    });
    if (commitResponseWrite.status !== 201 || typeof commitResponseWrite.body?.sha !== 'string') throw new Error(`commit create answered ${commitResponseWrite.status}`);
    installerSha = commitResponseWrite.body.sha;
    const gitCommit = await github(request, token, `/repos/${REPO}/git/commits/${installerSha}`);
    const diff = await github(request, token, `/repos/${REPO}/compare/${targetSha}...${installerSha}`);
    const shape = gitCommit.status === 200 && diff.status === 200
      ? installerReadBackProblems({ commit: gitCommit.body, compare: diff.body, expectedTree: createdTree, target: targetSha, plan })
      : ['the installer commit could not be read back'];
    if (shape.length > 0) return { ok: false, execute: true, problems: [...shape, 'main was not moved'], record: null };
    const readBack = await github(request, token, `/repos/${REPO}/commits/${installerSha}`);
    const identity = landingIdentityProblem({
      committerId: readBack.body?.committer?.id,
      verificationVerified: readBack.body?.commit?.verification?.verified === true,
      verificationReason: typeof readBack.body?.commit?.verification?.reason === 'string' ? readBack.body.commit.verification.reason : '',
      botId: env.JULIUS_GOVERNED_LANDER_BOT_ID,
    });
    if (readBack.status !== 200 || identity) {
      return { ok: false, execute: true, problems: [identity ?? 'the installer commit could not be read back'], record: null };
    }
    const again = await github(request, token, `/repos/${REPO}/git/ref/heads/main`);
    if (again.body?.object?.sha !== expectedMainSha) {
      return { ok: false, execute: true, problems: [`main moved before the update; it is ${again.body?.object?.sha ?? 'unreadable'}`], record: null };
    }
    // F3, as in the governed lander: only a clean 4xx (not 408 or 429) with main still at the
    // expected sha is a refusal. Anything else may have been applied with its answer lost, so
    // main is re-read: the installer means landed, anything else is in doubt (exit 2).
    let patched;
    try {
      patched = await github(request, token, `/repos/${REPO}/git/refs/heads/main`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: installerSha, force: false }),
      });
    } catch (error) {
      patched = { status: 0, body: null, why: error instanceof Error ? error.message : 'unknown' };
    }
    let tip;
    try { tip = (await github(request, token, `/repos/${REPO}/git/ref/heads/main`)).body?.object?.sha; } catch { tip = undefined; }
    const clean = patched.status >= 400 && patched.status < 500 && patched.status !== 408 && patched.status !== 429;
    if (tip === installerSha) {
      landedNote = patched.status === 200 ? null : `LANDED (the PATCH response was lost: ${patched.why ?? patched.status})`;
    } else if (clean && tip === expectedMainSha) {
      return { ok: false, execute: true, problems: [`the ref update was refused; no retry and no force: ${patched.status}`], record: null };
    } else {
      return {
        ok: false,
        execute: true,
        ambiguous: true,
        problems: [`ALERT: the update of main is in doubt (${patched.why ?? patched.status}); main is ${tip ?? 'unreadable'}, neither the installer ${installerSha} nor, for certain, ${expectedMainSha}. No retry, no force. Check main before anything else.`],
        record: null,
      };
    }
  } catch (error) {
    return { ok: false, execute: true, problems: [`the installer commit was not created; main was not moved: ${error instanceof Error ? error.message : 'unknown'}`], record: null };
  }
  return {
    ok: true,
    execute: true,
    problems: [],
    ...(landedNote ? { summary: landedNote } : {}),
    record: bootstrapAuditRecord({
      status: 'final',
      main: installerSha,
      parent: mainSha,
      target: targetSha,
      tree: targetTreeArg,
      installer: installerSha,
    }),
  };
}

const entrypoint = (() => {
  if (!process.argv[1]) return null;
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; }
})();

if (entrypoint !== null && import.meta.url === entrypoint) {
  const result = await runBootstrap({
    argv: process.argv.slice(2),
    env: process.env,
    request: async (path, init) => {
      const response = await fetch(`https://api.github.com${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${init.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body,
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      let body = null;
      if (text !== '') {
        try { body = JSON.parse(text); } catch { body = null; }
      }
      return { status: response.status, body };
    },
  });
  const lines = [...result.problems, result.summary ?? '', result.record ?? '', result.instructions ?? ''].filter((line) => line !== '');
  const stream = result.ok ? process.stdout : process.stderr;
  stream.write(`${lines.join('\n')}\n`);
  // 0 landed, 1 refused and main did not move, 2 the state of main is in doubt.
  process.exitCode = result.ok ? 0 : (result.ambiguous ? 2 : 1);
}
