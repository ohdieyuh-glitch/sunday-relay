# Julius autonomous landing (founder-governed directory)

Everything in this directory, and `.github/workflows/julius-land.yml`, is founder-governed: the lander refuses to land any PR that touches it. The main-provenance gate (`scripts/julius-main-provenance.mjs`, its `.d.mts` and its test) is also hard-forbidden: an autonomous landing can never change it.

Operation: the Independent Reviewer signs a clearance (`reviewer-tools.mjs sign`), MAIN JULIUS dispatches `Julius land` with the clearance and signature. The job verifies the clearance, waits for CI, then performs ONE FINAL READ (PR, files, bot-comment digest, main's tip and the whole CI state, all paginated fail-closed) and decides from that read alone. `dry_run` defaults to true; only the exact string `false` lands.

## How a landing happens (no merge endpoint)

The lander does NOT use `PUT /pulls/N/merge` (it pins only the PR head, not the base). It uses the git data API:

1. `POST /repos/{r}/git/commits` with `tree` = the cleared tree, `parents` = `[the cleared base]`, `message` = the landing commit message below, `author` = `committer` = `github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>`.
2. Read the created commit back (`GET /repos/{r}/commits/{sha}`) and require: the cleared tree, exactly one parent which is the cleared base, the exact message, the bot identity.
3. `PATCH /repos/{r}/git/refs/heads/main` with `{ "sha": <created>, "force": false }`. A non-forced ref update is a fast-forward compare-and-swap: GitHub refuses it if main moved. Any failure refuses and reports; there is never a retry and never `force`.
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
- Exactly one BEGIN and one END marker; each marker is a whole line. No line of the free text may contain the words `BEGIN JULIUS LANDING` or `END JULIUS LANDING` (the lander refuses to build such a message, and the lander's own free text is built from the PR number, head, kind and dates only, never the PR title).
- Exactly the four keys above, in that order, each once, no extras; values on one line; base64 must be canonical (decode and re-encode gives the same text).
- The clearance text is the `JULIUS-CLEARANCE-V1` text (see `parseClearance`). **The PR number, head, tree and base are read ONLY from the signed clearance text**, never from free text. The block nonce must equal the clearance nonce.
- A reader verifies the signature against the reviewer key committed at the landed commit's PARENT (the tree the landing was authorized under), then requires: clearance `tree` == the landed commit's tree, clearance `base` == the landed commit's single parent, and the clearance `head` is a worker-authored commit.

## Facts to remember

- A ref update made with the workflow's GITHUB_TOKEN triggers NO further workflows. Accept-main, the hold check, ledger rows and paid dispatch are run by MAIN JULIUS after each landing, as before.
- Exit code 2 means main is not the created commit after the update: an ALERT, not an undo. Exit code 3 means the commit LANDED but closing the PR failed (close it by hand). Manual rollback of a landing: `git revert <landed sha>` through the normal founder-governed path, then accept-main at the revert commit.
- The GitHub App `julius-worker` must NOT have the `workflows` permission; the founder confirms this when installing, and the permission list is recorded in the installing PR.
- The reviewer's key: only the PUBLIC key is committed (`reviewer-ed25519.pub`). A placeholder is refused until the reviewer replaces it.
- `governed-exceptions` in a clearance lets the reviewer permit a change to `scripts/julius-live-contract-check.mjs` (spend ceilings) or `relay-bridge/julius/role-effort.test.ts` (effort tripwire) for one PR; every other governed path is refused with or without a clearance.
- The digest of bot comments, inline comments and reviews covers, per row, the author, id, the edit timestamp (`updated_at`, else `created_at`; `submitted_at` for a review) and `sha256(body)`. A clearance signed under the earlier digest (no body, no timestamp for reviews) no longer matches: the reviewer re-runs `reviewer-tools.mjs digest` and signs a new clearance.
- The landed commit has no CI of its own (it is a new commit on main with the cleared, already-checked tree); the checks that count are those on the cleared head.
