# Governed landing

The historical lander (`.github/workflows/julius-land.yml`) refuses every founder-governed path, with or without a clearance. This path is a second workflow, `.github/workflows/julius-governed-land.yml`. It can land those paths only when a `JULIUS-CLEARANCE-V1` clearance signed by the pinned reviewer key lists each of them on a `protected-paths` line. That line is part of the signed text. A clearance that omits it, or lists a different path, is refused. The historical lander's `checkPullRequest` does not read `protected-paths` and still refuses the same paths.

The workflow runs only from `main`, inside the GitHub environment `governed-landing`, and only after `requireTrustedVerifier` has passed. The App token is minted after that check. The job's own `GITHUB_TOKEN` has `contents: read` and is used for the checkout alone.

## What the signature has to bind

Repo `ohdieyuh-glitch/sunday-relay`, pull request, head, tree, and base. The base has to be current `main`. The live bot-comment digest has to match. The clearance has to be inside its validity window at landing time. The nonce has to be unused. Required checks for that exact head have to have succeeded, including the app id in `required-checks.txt`. Declared dependencies have to already be on `main`. A draft pull request is refused unless the clearance says `binds-draft: yes`.

Optional lines, after `expires`, in this order, each omitted or present once:

```
protected-paths: .github/workflows/julius-governed-land.yml
landing-method: squash
binds-draft: yes
depends: 417,451
```

`protected-paths: -` lists nothing. Paths are a sorted comma-separated list with no globs. `landing-method` is `squash` or `fast-forward`; this workflow requires the line. `depends: -` lists nothing. Numbers are sorted numerically.

`squash` creates one commit, the cleared tree with the cleared base as its only parent, and the landing block in the message, then moves `main` with `force: false`. The cleared head has to be that one commit. `fast-forward` moves `main` to the cleared head with `force: false` and only when GitHub reports the head strictly ahead of the base. A checkpoint or bootstrap pull request, such as an installer branch, uses `fast-forward`. Neither method force-pushes. A fast-forward does not invent a landing commit and does not make an ordinary commit provenant: those commits stay subject to the installer walk. A squash landing is accepted only when the landing block binds this repo, pull request, head, tree and base, the committer time is inside the clearance window, and the nonce was unused. A direct push with no landing block stays unprovenanced.

The queue is `.github/julius-landing/governed-queue.txt`. The hourly schedule walks it. A dispatch may name one queued pull request. A refusal stops the run when a later line depends on that pull request. A refusal of a pull request nothing later depends on does not.

A landing record (pull request, head, tree, base, clearance sha256, check run ids, resulting main sha, method) is written to the job summary and as a pull request comment. The same record is how a later pull request sees that a dependency is on `main`.

A direct push of a commit that is not a signed landing, and a signed landing whose protected paths are not the ones in the clearance, stay `unprovenanced`. Historical clearances without `landing-method` still require the coding worker as the cleared head.

## GitHub App

The App is the pinned lander, id `5444986` (`julius-lander[bot]`). `vars.JULIUS_LANDER_APP_ID` has to be that id. The private key is `secrets.JULIUS_LANDER_PRIVATE_KEY`, passed to `actions/create-github-app-token` and scoped to this repository.

App permissions:

| Permission | Access |
|---|---|
| Contents | write |
| Pull requests | write |
| Workflows | write |
| Checks | read |
| Actions | read |
| Metadata | read |

`vars.JULIUS_REVIEWER_KEY_SHA256` is the external anchor the trusted verifier requires. An unset or different value fails closed before a token is minted.

## Environment and ruleset

Environment name: `governed-landing`. Limit deployments to `main`. Store `JULIUS_LANDER_PRIVATE_KEY` on that environment.

Recommended ruleset on `main`:

- Block force pushes.
- Block deletion.
- The bypass list is only the lander App. No person, and no other app, can push or bypass.

GitHub is not what makes the signature true. The ruleset is what stops every other identity from moving `main` around the signature.
