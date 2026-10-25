# Governed landing

The historical lander (`.github/workflows/julius-land.yml`) refuses every founder-governed path, with or without a clearance. This path is a second workflow, `.github/workflows/julius-governed-land.yml`. It can land those paths only when a `JULIUS-CLEARANCE-V1` clearance signed by the pinned reviewer key lists each of them on a `protected-paths` line. That line is part of the signed text. A clearance that omits it, or lists a different path, is refused. The historical lander's `checkPullRequest` does not read `protected-paths` and still refuses the same paths.

The workflow runs only when `github.ref` is `refs/heads/main`, `github.workflow_ref` is this file at `refs/heads/main`, and `github.workflow_sha` is `github.sha`. Actions sets `GITHUB_WORKFLOW_REF` and `GITHUB_WORKFLOW_SHA` from those contexts. The job does not override them. It then runs `requireTrustedVerifier` before any App token exists. That step, the same step in `julius-land.yml`, and the trusted-verifier step in `julius-accept-main.yml` each set `GH_TOKEN: ${{ github.token }}` and `JULIUS_GOVERNED_LANDER_BOT_ID: ${{ vars.JULIUS_GOVERNED_LANDER_BOT_ID }}`. The provenance step in `julius-accept-main.yml` receives the same bot id. The job token has `contents: read`, which is what `GET /repos/{owner}/{repo}/commits/{sha}` needs. Without `GH_TOKEN` the verifier cannot read a protected landing's committer and returns "the GitHub commit verification could not be read", which locks the next protected landing out of all three workflows. The verifier fails closed when the bot id is missing only once a protected or trusted landing is on the first-parent chain. An ordinary historical landing that does not touch those paths still passes without it. The job `GITHUB_TOKEN` has `contents: read` and `statuses: read`, and the checkout does not persist credentials.

## What the signature has to bind

Repo `ohdieyuh-glitch/sunday-relay`, pull request, head, tree, and base. The base has to be current `main`. The live bot-comment digest has to match, under the signed rule `comments-digest: excludes-delivery`: every issue comment that only delivers this exact clearance is left out, because a comment cannot hash itself. A governed clearance without that line is refused. The clearance has to be inside its validity window at landing time. The nonce has to be unused. Required checks for that exact head have to have succeeded, including the app id in `required-checks.txt`. A draft pull request is refused unless the clearance says `binds-draft: yes`. An unknown draft flag is the same refusal. The default is refuse.

Optional lines, after `expires`, in this order, each omitted or present once:

```
protected-paths: .github/workflows/julius-governed-land.yml
landing-method: squash
binds-draft: yes
depends: 417,451
comments-digest: excludes-delivery
```

`protected-paths: -` lists nothing. Paths are a sorted comma-separated list with no globs. `landing-method` is `squash` or `fast-forward`; this workflow requires the line. `binds-draft` is `yes` or omitted. `depends: -` lists nothing. Numbers are sorted numerically. `comments-digest` must be `excludes-delivery`; the governed lander requires the line.

`squash` creates one new commit. Its tree is the cleared tree and its only parent is the cleared base, whatever the pull request head's own parents are. The head must descend from that base: `compare` of `base...head` reports `behind_by == 0` and status `ahead` or `identical`. A stale head is refused, including one whose pull-request file list looks ordinary while the base-tree to head-tree diff would revert a file on `main`. Path and protected-file checks use that tree diff. A missing file list, or one of 300 or more files, is a refusal. The create-commit request omits `author` and `committer`. GitHub signs an App commit only when both are omitted. The lander then reads the commit back and moves `main` only when the committer user id is the bot and `verification.verified` is true with reason `valid`. A multi-commit head lands when the clearance binds that exact head and that exact tree: the squash result tree is the signed tree. Historical clearances that omit `landing-method` still require the cleared head to be one commit on the signed base, authored by the coding worker. `fast-forward` moves `main` to the cleared head with `force: false`, and only when GitHub reports the head strictly ahead of the base and the diff is a checkpoint or bootstrap diff that includes a checkpoint attestation file. An ordinary pull request that asks for `fast-forward` is refused. A change to a trusted file, including `governed-land.mjs`, is refused unless that same diff carries a checkpoint attestation file. Before `main` moves, the lander verifies that attestation's ed25519 signature against the pinned key and checks that its trusted-file hashes are the post-landing tree. A missing or bogus attestation is refused.

Neither method force-pushes. A fast-forward does not invent a landing commit. A squash landing is accepted by the verifier only when the landing block binds this repo, pull request, head, tree and base, the committer time is inside the clearance window, and the nonce was unused. A direct push with no landing block stays unprovenanced.

A protected path or a trusted file on a signed landing is accepted only when the commits API says the landing commit's committer user id is `vars.JULIUS_GOVERNED_LANDER_BOT_ID` and `commit.verification.verified` is true with reason `valid`. A matching name is not that proof. The lander reads the commit it just created and refuses to move `main` when that metadata is missing, including when GitHub has not verified the new commit yet. A hand-pushed signed commit stays unprovenanced, including one whose committer date is backdated into the clearance window or whose clearance is expired against the wall clock. The window for a landing block is still the commit's committer time. Ordinary historical landings that do not touch a protected or trusted path do not need this bot.

Several signed clearances may be on the pull request. The lander keeps the ones whose head, tree, and base are the live head, the live head tree, and current `main`, and ignores every other head. Among those, the newest signed `issued` wins. Comment time is not the order. Two different texts that share that `issued` are a refusal.

The queue is `.github/julius-landing/governed-queue.txt`. The hourly schedule walks it. A dispatch may name one queued pull request. A refusal stops the run when a later line depends on that pull request. A refusal of a pull request nothing later depends on does not. A dependency is satisfied by an audit record that is an ancestor of `main`, or by another landing in the same run. The lander does not scan commit messages for `Landed PR #N`. It does not list the audit namespace. It reads `GET /repos/{owner}/{repo}/git/ref/heads/julius-governed-audit/pr/<number>` for the pull requests named in queue `depends` and, once a clearance is in hand, in that clearance's `depends`. A missing ref is not a landing. The audit commit counts only when the commits API says its committer id is `vars.JULIUS_GOVERNED_LANDER_BOT_ID` and the signature is verified and valid. A `main:` line in any other object is not a sha.

The audit object is written before `main` moves. The branch ref `refs/heads/julius-governed-audit/pr/<number>` is created only after the ref update of `main` is read back and matches. A retry that finds that same sha is success. A different sha is not force-updated. For a squash, the audit object is the landing commit and `main:` is `pending`, because the commit cannot contain its own sha. Proof that it landed is that this App-verified commit is an ancestor of `main`. For a fast-forward, it is a side commit whose parent and tree are `main` before the move and whose `main:` line is the cleared head. That line is trusted only after the same App identity check, and the named sha must then be an ancestor of `main`. After the move, a pull request comment may repeat the record with `status: final`. That comment is not authority. If the comment, the close, or the audit ref fails after `main` has moved, the run reports `landed, audit finalize failed`, does not set the decision to a refusal, and exits 3. A later run re-creates a missing audit ref from the nonce tag (see "Exit codes and recovery"). A failure before the ref update of `main` does not move `main` and does not leave an audit ref behind. A governed audit branch is refused as a pull request head or base by the governed lander, the historical lander's `checkPullRequest`, and `evaluateMainProvenance`.

Branch rulesets cannot cover `refs/julius-governed-audit/*`. The namespace is `refs/heads/julius-governed-audit/<...>`, which ruleset 25792058 can include. GitHub matches ref patterns with `FNM_PATHNAME`: `*` does not cross `/`, and a trailing `**` acts like `*`. `refs/julius-governed-audit/**` does not match `refs/julius-governed-audit/pr/1`. The include that does match `refs/heads/julius-governed-audit/pr/1` is `refs/heads/julius-governed-audit/**/*`. The lander checks that the snapshot covers that sample ref. The live branch-rules response does not return include patterns, so a live include that still says `refs/heads/julius-governed-audit/**` is not detected here. The operator sets the live ruleset's include to the snapshot's include. Push-triggered workflows that would otherwise run on every branch skip `julius-governed-audit/**`: Relay CI pushes only `main` and its verify job also refuses an audit ref, and the Julius real-infra jobs carry the same guard.

## Nonce tags

`refs/tags/julius-landing-nonce-<nonce>` is how a clearance nonce is spent. Ruleset 25739940 (`landing-nonce-tags`, include `refs/tags/julius-landing-nonce-*`) is enforcement `disabled`, so anyone who can push can create the tag. The disabled ruleset is not a control. The lander trusts the tag's target commit, by App identity:

- A missing tag (404) is unused.
- An existing tag whose target commit's committer id is `vars.JULIUS_GOVERNED_LANDER_BOT_ID`, with `verification.verified` true and reason `valid`, means this clearance nonce was already used on `main`.
- An existing tag whose target is anything else is a different refusal: `the nonce tag refs/tags/julius-landing-nonce-<nonce> already exists and was not created by the governed lander app`. That is not recorded as a real spend. The lander does not delete or move tags, so the pre-created tag blocks that nonce until someone deletes it.
- An unreadable tag is `the nonce tag could not be read`. An unset bot id is `JULIUS_GOVERNED_LANDER_BOT_ID is unset`, not the forgery message.

The tag is created before the `PATCH` of `main`. If the move fails after that, the tag's target is an App commit, so a retry of the same nonce is refused as already used. The lander does not delete the tag.

## GitHub App

This workflow uses the dedicated App `julius-governed-lander` (App id 5457712, bot user id 347502603, installation 174890170, installed only on `sunday-relay`). Those numbers are facts for operators and for tests. The verifier reads `JULIUS_GOVERNED_LANDER_APP_ID` and `JULIUS_GOVERNED_LANDER_BOT_ID`. It does not hard-code them. This workflow does not use the historical lander App, `vars.JULIUS_LANDER_APP_ID`, or `secrets.JULIUS_LANDER_PRIVATE_KEY`.

| Name | Where |
|---|---|
| `JULIUS_GOVERNED_LANDER_APP_ID` | repository variable, the App id |
| `JULIUS_GOVERNED_LANDER_BOT_ID` | repository variable, the App bot's numeric user id |
| `JULIUS_GOVERNED_LANDER_PRIVATE_KEY` | secret on the `governed-landing` environment, not a repository secret |

The read token is minted by `actions/create-github-app-token` after the verifier passes:

| Permission | Access |
|---|---|
| Contents | read |
| Pull requests | read |
| Checks | read |
| Actions | read |
| Metadata | read |
| Statuses | read |

Administration is not a permission this workflow requests. Administration: read will be removed from the App. The App must not be given Administration: write. `bypass_actors` is not readable without that write permission, and this design does not use it.

The lander mints a second token for the pull request it is about to write, for the `sunday-relay` repository only (`repositories: ["sunday-relay"]`). That token is:

| Permission | Access |
|---|---|
| Contents | write |
| Pull requests | write |
| Checks | read |
| Actions | read |
| Metadata | read |
| Statuses | read |
| Workflows | write, only when a changed path is under `.github/workflows/` and both the reviewer and the founder-approval signatures verified |

`vars.JULIUS_REVIEWER_KEY_SHA256` is the external anchor the trusted verifier requires. An unset or different value fails closed before a token is minted.

## Environment and ruleset

Environment name: `governed-landing`. Deployment branches: `main` only. The private key is stored on that environment. Required reviewers on the environment are optional. The workflow's first step after checkout, `governed-land.mjs --require-environment` with the job token, refuses unless the environment exists with a custom branch policy that is exactly `main`; the lander repeats that check before it signs a JWT, and the bootstrap before it writes.

`.github/julius-landing/main-ruleset.json` is the intended state of ruleset 25792058 (`main-lander-only`). It is not proof of the live ruleset. The lander reads `GET /repos/ohdieyuh-glitch/sunday-relay/rules/branches/main`, which metadata can read, and compares rule types and parameters only, for rules whose `ruleset_id` is the snapshot's id. That response has no bypass actors and no include patterns. Without Administration the token cannot see an admin-added bypass actor. The snapshot's `bypass_actors` stay in the trusted computing base so the signed attestation covers the intended actor list. A null snapshot id still fails closed with "the main ruleset snapshot has no pinned ruleset id". This tree's snapshot id is 25792058. Any live rule whose `ruleset_id` is not that id fails closed ("an active ruleset other than the pinned main ruleset applies to main"), whether the source is the repository or an organization. A disabled ruleset is absent from the branch-rules response and is not a refusal. These five are disabled and must stay absent: 25741874 `julius-run-spent-tags` (tag), 25739940 `landing-nonce-tags` (tag), 25740049 `main-flow` (branch), 25740161 `main-writers` (branch), 25740269 `main-immutable` (branch).

The snapshot must be enforcement `active`, must include `~DEFAULT_BRANCH` and `refs/heads/julius-governed-audit/**/*`, must carry the rules `deletion`, `non_fast_forward`, `creation`, and `update`, and must name one bypass actor: `Integration`, bypass mode `always`, actor id equal to `JULIUS_GOVERNED_LANDER_APP_ID`. A pattern the lander cannot evaluate (`[`, `]`, or `\`) is a refusal. The App's own bypass can technically force-push; this workflow still sends `force: false`.

The live include list to set on ruleset 25792058, matching the snapshot, is:

```
~DEFAULT_BRANCH
refs/heads/julius-governed-audit/**/*
```

Residual risk: an administrator can add a bypass actor, or change the include, without this job noticing. The branch-rules endpoint does not return `bypass_actors` or conditions. Those fields are true only because they were signed into the checkpoint attestation. A change that leaves the live rule types, parameters, and ruleset id the same is invisible until the next signed snapshot.

GitHub is not what makes the signature true. The ruleset is what stops every other identity from moving `main` around the signature. The environment's branch limit is what stops a workflow file from another ref from reaching the private key: a job `if` cannot do that on its own, because a replacement of this file on another branch can delete the `if`.

`governed-land.mjs`, `governed-queue.txt`, `main-ruleset.json`, `julius-governed-land.yml`, and `scripts/julius-governed-bootstrap.mjs` are in the trusted computing base. The signed checkpoint attestation on the historical tree does not list them. Until the founder signs a new attestation over this tree, `requireTrustedVerifier` refuses it, and the governed workflow cannot land.

## Founder approval (the second safeguard)

A reviewer signature alone does not land a founder-governed path. Any hard-forbidden path, any trusted file, any `.github/workflows/**` path, any checkpoint attestation file, and anything a clearance lists in `protected-paths` also needs an ed25519 signature over the exact same clearance bytes from the founder-approval key. Ordinary paths land on the reviewer signature alone, as before.

- The key is `.github/julius-landing/founder-approval-ed25519.pub` (in the trusted computing base), the constants `PINNED_FOUNDER_APPROVAL_SPKI_SHA256` and `PINNED_FOUNDER_APPROVAL_RAW_KEY` in `scripts/julius-main-provenance-trust.mjs`, and the repository variable `JULIUS_FOUNDER_APPROVAL_KEY_SHA256`. All three must agree, and the key must not be the reviewer key.
- No founder-approval key exists yet. The file is a placeholder and the constants are `null`, so every check that needs the founder refuses with `founder approval: no founder-approval key is pinned`. The founder generates the key on a machine where no Claude, Cursor or Grok session runs, and the public key and constants are committed into the bootstrap target before it is attested.
- Delivery: the founder signature block follows the reviewer block in the same comment, as `-----BEGIN JULIUS FOUNDER APPROVAL SIGNATURE-----` / one base64 line / `-----END JULIUS FOUNDER APPROVAL SIGNATURE-----`. The squash landing carries it as an optional last line of the landing block, `founder-signature-b64: <base64>`, so the verifier and accept-main can check it again.
- A checkpoint attestation needs `<checkpoint>.founder.sig` beside `<checkpoint>.sig`. The shape rule, `requireTrustedVerifier`, the governed lander and the bootstrap all verify it.
- `workflows: write` is minted only after both signatures verified. The hourly schedule takes the same path and gets no exception.
- Rotation: a change to either key file is a trusted-file change. Its clearance must verify under both keys pinned on main (the old keys). Its attestation is checked against the keys in the post-landing tree, whose bytes the attestation hashes, because that is what the verifier reads after the move. The verifier then refuses until `JULIUS_REVIEWER_KEY_SHA256` or `JULIUS_FOUNDER_APPROVAL_KEY_SHA256` is changed to the new key by a party other than the signer.

## Landing sequence

None of #417, #451, #452, #453 or this repair is merged through GitHub. Under ruleset 25792058 (bypass: App 5457712 only) no GitHub merge of them is possible, and the earlier "fast-forward, do not squash" and "squash-merge" instructions in those pull requests are superseded by this sequence.

1. Build target R: it descends from current `main` (`f539cab2`), and its tree is this repaired tree plus the founder-approval public key and its pinned constants. R carries no checkpoint attestation file.
2. Run Relay CI and the five real-infra checks on R.
3. The Independent Reviewer signs a `JULIUS-CHECKPOINT-V1` over R: `prior` 2528ac5c, `commits` exactly the first-parent chain 2528ac5c..R (the bootstrap checks this list against GitHub), the trusted-file hashes of R, and a window of at most 184 days. The founder signs the same bytes with the founder-approval key.
4. A party other than the signers sets `JULIUS_REVIEWER_KEY_SHA256` and `JULIUS_FOUNDER_APPROVAL_KEY_SHA256` to the pinned values. `governed-landing` (deployments from `main` only), `JULIUS_GOVERNED_LANDER_APP_ID=5457712` and `JULIUS_GOVERNED_LANDER_BOT_ID=347502603` already exist.
5. The founder runs the founder block the bootstrap prints (below): prerequisites, a one-hour token, the dry run, `--execute`, and verification.
6. Later changes, including checkpoint refreshes, are governed landings with both signatures.

## Bootstrap

`julius-governed-land.yml` runs only from `main`, so the first move cannot be that workflow, and no workflow on `main` uses `governed-landing` before it. No agent may handle the App private key. So the founder runs `scripts/julius-governed-bootstrap.mjs` on their own machine with a one-hour installation token they mint from the PEM they hold. Run the script once with no token: it prints the complete founder command block for the given arguments and exits 1. A passing dry run prints what it checked and the exact installer diff, then the same block. The script never opens the PEM and never prints the token; the block keeps the token in a subshell variable and revokes it on exit.

The script refuses unless all of these hold. `--target-tree` is required, so the created tree can never lose its base. `main` is `--main-sha`. The target is `main` (recovery) or descends from it. The live target tree is `--target-tree`. The reviewer pin and its anchor match. The attestation verifies under the reviewer key and the founder-approval key, names the target and its tree, lists exactly the first-parent chain from 2528ac5c to the target (walk cap 250), binds a nonce, hashes every trusted file of the target, has a window of at most 184 days, and has at least 7 days left. The checkpoint directory it would install passes the same shape rule as the gates. The live branch rules match `main-ruleset.json`. `governed-landing` deploys from `main` only.

`--execute` creates installer commit I on the target with the App, omitting `author` and `committer`. I removes every file already in the target's checkpoint directory and adds `<target>.txt`, `.sig` and `.founder.sig`, so `main` carries exactly one attestation. Before moving `main` the script reads I back and requires its tree to be the created tree, its single parent to be the target, its message to be the installer message, the target...I diff to be exactly the planned paths, the committer to be the App bot and the signature verified. It re-reads `main`, then `PATCH`es with `{ sha, force: false }`.

Recovery. With `--target` equal to `main` the same script replaces an expired or expiring attestation on `main` with a fresh dual-signed one. That is the recovery for every expiry, including the window this script installs, which is why the script stays in the tree and why it may install a long window directly. Every gate, including the governed lander, refuses an expired attestation, so nothing else can re-attest `main` once one has expired.

## Exit codes and recovery of the governed lander

`0` landed or nothing to do. `1` refused, and `main` did not move. `2` the state of `main` is in doubt: the `PATCH` timed out, failed with a 5xx, 408 or 429, or `main` could not be re-read or is neither the signed base nor the landing afterwards. No retry, no force; the clearance is spent; the queue stops. A lost `PATCH` answer with `main` equal to the landing is `LANDED (the PATCH response was lost)` and continues. `3` landed, but the audit ref, the comment or the close failed.

The nonce tag names the App-signed audit commit (the landing commit for a squash, the side record for a fast-forward). A later run that finds `refs/heads/julius-governed-audit/pr/<n>` missing reads the nonce tags, accepts a target only through the same App identity, audit record and ancestry checks as the ref, re-creates the ref at that commit, and treats the pull request as already on `main` instead of landing it again.

## Limits that stay

- `requireTrustedVerifier` walks at most 30 first-parent commits from `HEAD` to the attested checkpoint, so at most 29 landings fit between checkpoint refreshes. A refresh is a governed landing with both signatures, or the bootstrap in recovery mode.
- The governed lander does not compare an attestation's listed commit range to the real chain; the bootstrap does. A checkpoint refresh through the lander relies on the signers for that list.
- The reviewer key was rotated from 7eacf984 to 12c9b185 without a signature from the outgoing key, because that key is not available. The anchor variable, set by a non-signer, is the only out-of-band confirmation.
- The branch-rules endpoint does not return bypass actors or include patterns; see the ruleset section.

## Reviewer evidence

`.github/workflows/julius-governed-evidence.yml` prints, unmasked, `vars.JULIUS_REVIEWER_KEY_SHA256`, the head sha and tree, and the JSON of the ruleset list, each ruleset, and `rules/branches/main`. It triggers on `pull_request` and `workflow_dispatch`, uses `contents: read` and `github.token`, and does not read or print a secret. The log notes that `bypass_actors` may be omitted for a non-admin token. It is not in the trusted computing base. It does not gate a landing, and the landing workflows never read its log. Signing a diagnostic printer would couple it to the trust root.
