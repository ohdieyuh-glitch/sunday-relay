# Governed landing

The historical lander (`.github/workflows/julius-land.yml`) refuses every founder-governed path, with or without a clearance. This path is a second workflow, `.github/workflows/julius-governed-land.yml`. It can land those paths only when a `JULIUS-CLEARANCE-V1` clearance signed by the pinned reviewer key lists each of them on a `protected-paths` line. That line is part of the signed text. A clearance that omits it, or lists a different path, is refused. The historical lander's `checkPullRequest` does not read `protected-paths` and still refuses the same paths.

The workflow runs only when `github.ref` is `refs/heads/main`, `github.workflow_ref` is this file at `refs/heads/main`, and `github.job_workflow_sha` is `github.sha`. It then runs `requireTrustedVerifier` before any App token exists. The job `GITHUB_TOKEN` has `contents: read` and `statuses: read`, and the checkout does not persist credentials.

## What the signature has to bind

Repo `ohdieyuh-glitch/sunday-relay`, pull request, head, tree, and base. The base has to be current `main`. The live bot-comment digest has to match. The clearance has to be inside its validity window at landing time. The nonce has to be unused. Required checks for that exact head have to have succeeded, including the app id in `required-checks.txt`. A draft pull request is refused unless the clearance says `binds-draft: yes`. An unknown draft flag is the same refusal. The default is refuse.

Optional lines, after `expires`, in this order, each omitted or present once:

```
protected-paths: .github/workflows/julius-governed-land.yml
landing-method: squash
binds-draft: yes
depends: 417,451
```

`protected-paths: -` lists nothing. Paths are a sorted comma-separated list with no globs. `landing-method` is `squash` or `fast-forward`; this workflow requires the line. `binds-draft` is `yes` or omitted. `depends: -` lists nothing. Numbers are sorted numerically.

`squash` creates one new commit. Its tree is the cleared tree and its only parent is the cleared base, whatever the pull request head's own parents are. A multi-commit head lands when the clearance binds that exact head and that exact tree: the squash result tree is the signed tree. Historical clearances that omit `landing-method` still require the cleared head to be one commit on the signed base, authored by the coding worker. `fast-forward` moves `main` to the cleared head with `force: false`, and only when GitHub reports the head strictly ahead of the base and the diff is a checkpoint or bootstrap diff that includes a checkpoint attestation file. An ordinary pull request that asks for `fast-forward` is refused. A change to a trusted file, including `governed-land.mjs`, is refused unless that same diff carries a checkpoint attestation file.

Neither method force-pushes. A fast-forward does not invent a landing commit. A squash landing is accepted by the verifier only when the landing block binds this repo, pull request, head, tree and base, the committer time is inside the clearance window, and the nonce was unused. A direct push with no landing block stays unprovenanced.

A protected path or a trusted file on a signed landing is accepted only when the commits API says the landing commit's committer user id is `vars.JULIUS_GOVERNED_LANDER_BOT_ID` and `commit.verification.verified` is true with reason `valid`. A matching name is not that proof. The lander reads the commit it just created and refuses to move `main` when that metadata is missing, including when GitHub has not verified the new commit yet. A hand-pushed signed commit stays unprovenanced, including one whose committer date is backdated into the clearance window or whose clearance is expired against the wall clock. The window for a landing block is still the commit's committer time. Ordinary historical landings that do not touch a protected or trusted path do not need this bot.

The queue is `.github/julius-landing/governed-queue.txt`. The hourly schedule walks it. A dispatch may name one queued pull request. A refusal stops the run when a later line depends on that pull request. A refusal of a pull request nothing later depends on does not. A dependency is satisfied by an audit record that is an ancestor of `main`, or by another landing in the same run. The lander does not scan commit messages for `Landed PR #N`.

Before `main` moves, the lander writes an append-only audit record with `status: pending` and creates `refs/julius-governed-audit/<nonce>` pointing at it. For a squash, that object is the landing commit and `main:` is `pending`, because the commit cannot contain its own sha. For a fast-forward, it is a side commit whose parent and tree are `main` before the move and whose `main:` line is the cleared head. After the ref update is read back and matches, a pull request comment may repeat the record with `status: final`. That comment is not authority. If the comment or the close fails after `main` has moved, the run reports `landed, audit finalize failed` and does not call the landing a refusal. A failure before the ref update does not move `main`.

## GitHub App

This workflow uses a dedicated App. It does not use the historical lander App, `vars.JULIUS_LANDER_APP_ID`, or `secrets.JULIUS_LANDER_PRIVATE_KEY`.

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
| Administration | read |

The lander mints a second token for the pull request it is about to write. That token is:

| Permission | Access |
|---|---|
| Contents | write |
| Pull requests | write |
| Checks | read |
| Actions | read |
| Metadata | read |
| Statuses | read |
| Workflows | write, only when a changed path is under `.github/workflows/` |

`vars.JULIUS_REVIEWER_KEY_SHA256` is the external anchor the trusted verifier requires. An unset or different value fails closed before a token is minted.

## Environment and ruleset

Environment name: `governed-landing`. Deployment branches: `main` only. The private key is stored on that environment. Required reviewers on the environment are optional.

An active ruleset on `main` is a hard prerequisite, checked at runtime through the rulesets API before any landing decision. The lander fails closed when the list cannot be read. One active branch ruleset that includes `main` must contain the rules `deletion`, `non_fast_forward`, and `update`, and its only bypass actor must be this App (`Integration`, this App id, bypass mode `always`). Every other applicable ruleset on `main` must bypass nobody else. The App's own bypass can technically force-push; this workflow still sends `force: false`.

GitHub is not what makes the signature true. The ruleset is what stops every other identity from moving `main` around the signature. The environment's branch limit is what stops a workflow file from another ref from reaching the private key: a job `if` cannot do that on its own, because a replacement of this file on another branch can delete the `if`.

`governed-land.mjs`, `governed-queue.txt`, and `julius-governed-land.yml` are in the trusted computing base. The signed checkpoint attestation does not list them until the founder regenerates it. Until that attestation is signed, `requireTrustedVerifier` refuses this tree, and this workflow cannot land.
