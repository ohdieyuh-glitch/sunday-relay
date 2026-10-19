# Julius autonomous landing (founder-governed directory)

Everything in this directory, and `.github/workflows/julius-land.yml`, is founder-governed: the lander refuses to land any PR that touches it. The main-provenance gate and the module it imports are also hard-forbidden by PREFIX, case-insensitively: any path starting with `scripts/julius-main-provenance` or `scripts/julius-review-currency` (the `.mjs`, `.d.mts`, test, and any sibling name). An autonomous landing can never change what the gate trusts. The same prefix rule covers the gate and secret-handling scripts that workflows run: `scripts/julius-main-monotonicity`, `scripts/julius-paid-slot`, `scripts/julius-subscription-check`, `scripts/julius-live-preflight-gates`, `scripts/julius-accept`, `scripts/relay-repository-boundary`, `scripts/export-julius-harness`, `.github/julius-live-` (the `julius-live-*.sh` boundary scripts and helpers), `.github/actions/`, `.github/julius-mission-slice/` and `.github/julius-learning-registrations/`. `relay-bridge/**`, `src/**`, the mission directories (`.github/julius-missions/**`), `JULIUS_HARNESS_MANIFEST.md` and every other path stay allowed.

Operation: the Independent Reviewer signs a clearance (`reviewer-tools.mjs sign`), MAIN JULIUS dispatches `Julius land` with the clearance and signature. The job verifies the clearance, waits for CI, then performs ONE FINAL READ (PR, files, bot-comment digest, main's tip and the whole CI state, all paginated fail-closed) and decides from that read alone. `dry_run` defaults to true; only the exact string `false` lands.

## How a landing happens (no merge endpoint)

The lander does NOT use `PUT /pulls/N/merge` (it pins only the PR head, not the base). It uses the git data API:

1. `POST /repos/{r}/git/commits` with `tree` = the cleared tree, `parents` = `[the cleared base]`, `message` = the landing commit message below, `author` = `committer` = `github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>`.
2. Read the created commit back (`GET /repos/{r}/commits/{sha}`) and require: the cleared tree, exactly one parent which is the cleared base, the exact message, the bot identity.
3. `PATCH /repos/{r}/git/refs/heads/main` with `{ "sha": <created>, "force": false }`. A non-forced ref update is a fast-forward compare-and-swap: GitHub refuses it if main moved. Any failure refuses and reports; there is never a retry and never `force`. Only a clean HTTP 4xx answer (other than 408 and 429) counts as "GitHub refused and main did not move". On ANY other outcome (timeout, 5xx, network error, an unreadable answer) the update may have been applied with its answer lost, so the lander re-reads main's tip: main == the created commit is treated as landed (`LANDED (the PATCH response was lost)`, then the post-checks); main == the cleared base is "Nothing was landed"; anything else is an ALERT (exit 2) naming the tip. If the tip cannot be re-read the job also exits 2.
4. Comment on the PR naming the landed commit, then close it. **The PR will show as CLOSED, not MERGED**: the landed commit is not the PR head. That is expected.

A dry run performs every read and every check and computes the commit body, but sends no write at all (no commit, no ref update, no comment, no close); it prints what the live run would send, including the full landing commit message.

## The landing commit message (format "JULIUS LANDING v1")

The one definition is `buildLandingCommitMessage` / `parseLandingCommitMessage` in `land-lib.mjs`; the specification for other implementers (the provenance gate) is:

```
<free text: subject, blank line, body>
<blank line>
-----BEGIN JULIUS LANDING-----
v: 1
clearance-nonce: <32 hex, equal to the clearance's nonce>
clearance-b64: <standard base64 (RFC 4648 section 4, alphabet A-Za-z0-9+/, padded), ONE line, of the EXACT signed clearance text bytes>
signature-b64: <standard base64, padded, ONE line, of the 64-byte ed25519 signature over those exact bytes>
-----END JULIUS LANDING-----
```

- The block is the FINAL lines of the message; one trailing newline after the END line, nothing after it.
- Exactly one BEGIN and one END marker; each marker is a whole line. The uppercase phrase `JULIUS LANDING` appears EXACTLY TWICE in the whole message, once in each marker line, and nowhere else: the free text must not contain it at all (a reader that counts mentions answers indeterminate otherwise); lower and mixed case, such as "Julius landing", is fine. The parser rejects any other count, and the lander refuses to build such a message; the lander's own free text is built from the PR number, head, kind and dates only, never the PR title).
- Exactly the four keys above, in that order, each once, no extras; values on one line; base64 must be canonical (decode and re-encode gives the same text).
- The clearance text is the `JULIUS-CLEARANCE-V1` text (see `parseClearance`). **The PR number, head, tree and base are read ONLY from the signed clearance text**, never from free text. The block nonce must equal the clearance nonce.
- A reader verifies the signature against the reviewer key committed at the landed commit's PARENT (the tree the landing was authorized under), then requires: clearance `tree` == the landed commit's tree, clearance `base` == the landed commit's single parent, and the clearance `head` is a worker-authored commit.

## Facts to remember

- A ref update made with the workflow's GITHUB_TOKEN triggers NO further workflows. Accept-main, the hold check, ledger rows and paid dispatch are run by MAIN JULIUS after each landing, as before.
- Exit codes. 0 = landed (or a dry run that passed). 1 = REFUSED, nothing landed; this includes ANY unexpected error before the ref update is sent, which ends with ONE `REFUSED: unexpected error before anything was landed: ...` line, never a stack trace. 2 = ALERT: main is not the created commit after the update, the read of main after the update failed (`ALERT AFTER LANDING: main was updated to <sha> but ...`, the PR comment and close are still attempted), the outcome of an ambiguous update was neither the created commit nor the base, or any unexpected error after the ref update was sent; it is never exit 1 once the update may have applied. 3 = the commit LANDED but the PR comment or the PR close failed (each is attempted on its own; do them by hand). An ALERT is not an undo.
- `required-checks.txt`: one check per line, `Name` or `Name @15368`. With `@id` the single check run of that name must also have been produced by that GitHub App id (15368 = GitHub Actions), so a look-alike check from another app cannot stand in for the real job; the first live dry run proves the ids. Only the conclusion `success` is green: `neutral` and `skipped` are refused. Manual rollback of a landing: `git revert <landed sha>` through the normal founder-governed path, then accept-main at the revert commit.
- The GitHub App `julius-worker` must NOT have the `workflows` permission; the founder confirms this when installing, and the permission list is recorded in the installing PR.
- The reviewer's key: only the PUBLIC key is committed (`reviewer-ed25519.pub`). A placeholder is refused until the reviewer replaces it.
- `governed-exceptions` in a clearance lets the reviewer permit a change to `scripts/julius-live-contract-check.mjs` (spend ceilings) or `relay-bridge/julius/role-effort.test.ts` (effort tripwire) for one PR; every other governed path is refused with or without a clearance.
- The digest of bot comments, inline comments and reviews covers, per row, the author, id, the edit timestamp (`updated_at`, else `created_at`; `submitted_at` for a review) and `sha256(body)`. A clearance signed under the earlier digest (no body, no timestamp for reviews) no longer matches: the reviewer re-runs `reviewer-tools.mjs digest` and signs a new clearance.
- A refused or failed landing can leave the created commit as an unreferenced git object (the commit is created before main is touched). That residue is harmless: nothing points at it, and the ref update is the ONLY thing that lands a change.
- The landed commit has no CI of its own (it is a new commit on main with the cleared, already-checked tree); the checks that count are those on the cleared head.
