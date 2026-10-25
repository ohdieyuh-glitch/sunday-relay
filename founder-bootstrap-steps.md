# Founder Bootstrap Steps

> **DO NOT RUN ANY BOOTSTRAP OR SIGNING COMMAND YET.**
>
> This file exists so the founder procedure is present in the repository and reviewable. The procedure becomes executable only after independent REVIEW clears the **current exact PR #463 head**, publishes a fresh `JULIUS-CHECKPOINT-V1` attestation for that exact head/tree, and all required exact-head checks are green.

## Current safety state

- `main` must remain unchanged until the governed bootstrap completes.
- The older checkpoint attestation for target `01ffd5eb0a8702ae83da802fed36eafa8da05437` is superseded and must not be signed or reused.
- The founder's existing passphrase-encrypted Ed25519 key remains the founder key. Do not regenerate it.
- The existing `julius-governed-lander` GitHub App and PEM remain in use. Do not recreate or broaden the App installation.
- The App installation remains scoped to this repository only.
- A failed bootstrap execute must never be blindly retried. If execute exits with ambiguity or any indication that main may have moved, verify live `main` before any further action.

## Gate before founder signing

Independent REVIEW must publish, for the current exact PR #463 head:

1. Full target commit SHA.
2. Full target tree SHA.
3. Fresh checkpoint attestation bytes (`CLEARANCE_B64` or equivalent exact-byte transport).
4. Attestation SHA-256 and byte length.
5. REVIEW's Ed25519 signature over those exact attestation bytes.
6. Confirmation that the required exact-head checks are green.
7. Confirmation that the governed bootstrap identity repair was reviewed against the real GitHub App commit shape and remains fail-closed for unexpected shapes.

If any one of those is missing, **STOP**.

## Founder signing

After the gate above is satisfied, the founder:

1. Uses the existing founder-only directory outside agent worktrees.
2. Reconstructs the fresh attestation bytes exactly as published by REVIEW.
3. Verifies the exact byte length and SHA-256 against REVIEW's published values.
4. Signs those exact bytes with the existing passphrase-encrypted founder Ed25519 private key.
5. Verifies the founder signature locally with the founder public key.
6. Never shares the private key or passphrase. Only the public key, fingerprint, and signature are non-secret inputs to the governed bootstrap.

## Bootstrap preparation

After both signatures exist for the fresh exact-head attestation:

1. Use a fresh clean checkout of the exact reviewed target.
2. Verify `HEAD` equals the reviewed target SHA.
3. Verify `HEAD^{tree}` equals the reviewed target tree SHA.
4. Verify the checkout is clean, including untracked files.
5. Verify live `main` is still the expected pre-bootstrap SHA.
6. Verify the reviewer and founder fingerprint repository anchors.
7. Use the existing local App PEM path only to mint the short-lived installation token; never print or paste the PEM or token.
8. Run the repository's reviewed `scripts/julius-governed-bootstrap.mjs` in dry-run mode first.

## Founder execution checkpoint

The dry run must explicitly report that every check passed and nothing was written, and its planned diff must contain only the expected checkpoint installer files.

Only then may the founder type the exact `EXECUTE <12-char target prefix>` confirmation requested by the reviewed bootstrap script.

The execute path must:

- create one installer commit on the reviewed target;
- verify the installer tree, parent, message, exact checkpoint-only diff, App identity/provenance, and GitHub signature;
- re-read `main` immediately before updating it;
- update `main` with `force:false`;
- verify the resulting `main` and trust chain;
- revoke the installation token on exit.

## Stop conditions

Immediately stop and do not retry if:

- REVIEW supersedes the attestation;
- PR #463 head changes after REVIEW signs;
- any required exact-head check is not green;
- live `main` differs from the expected pre-bootstrap SHA;
- attestation bytes, hash, byte length, reviewer signature, founder signature, target SHA, or tree SHA do not match;
- the bootstrap reports an unexpected App identity/provenance shape;
- the execute path reports that the state of `main` is in doubt.

In any stop condition, re-read live state and obtain a fresh exact-head REVIEW decision before continuing.

## Landing sequence after successful bootstrap

The governed queue controls subsequent landings. Do not GitHub-UI merge #463 or manually bypass the governed landing path. Preserve queue dependency ordering and exact-head review/CI requirements for each queued PR.
