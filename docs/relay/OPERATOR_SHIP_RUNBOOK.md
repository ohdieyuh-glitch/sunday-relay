# Relay live-ship operator runbook

The complete ship path — register → target a mission → verify → **ship (commit →
push → PR → merge → deploy → live-verify)** — is built and tested in the
ship-wiring change (branch `relay/ship-wiring`, three independent reviews, all
0 Critical / 0 High). This runbook is the exact sequence an **operator** runs to
take a verified mission all the way to a live GitHub change. Three points are
founder-gated, flagged 🔒. Relay infers none of them.

> Authority model: every route below is **operator-only** (Bearer
> `RELAY_BRIDGE_API_TOKEN`). A browser/control session — even one bound to a
> beta participant — may start a *fixture* mission but may **not** name a
> repository, register one, or ship. The credential that could mint any session
> is the same one that gates these.

---

## 0. Prerequisites (🔒 founder)

| # | Prerequisite | Why | Where |
|---|---|---|---|
| 0a | 🔒 A **durable state root** mounted on the bridge | registrations must survive a restart; without it every route below is `503` | Railway env `RELAY_DATA_DIR` (or `RELAY_STATE_HOME`), an absolute path on a mounted volume |
| 0b | 🔒 A **GitHub repository Relay may write to**, and the decision to let it | Relay never infers a target repo | founder chooses owner/name/defaultBranch |
| 0c | 🔒 A **push credential** in a **named** env var on the bridge | remote ops need a credential; Relay stores only the env var NAME, never the value | Railway env, e.g. `GITHUB_TOKEN` = `<PAT with repo scope>` |
| 0d | 🔒 The ship-wiring change **merged and deployed** | the ship route must exist in the running bridge | PR #127 |

As of this writing, a direct Railway read (project `265bbb82`) confirms **no**
push credential and **no** target repo are configured. Steps 0b/0c are the
founder's to provide; do not assume a value.

---

## 1. Register the repository (operator)

`POST /relay-api/repository/register` — `Authorization: Bearer $RELAY_BRIDGE_API_TOKEN`

The body is a **draft**; the domain (`createRepositoryRegistration`) is the only
validator and derives the canonical key — the body cannot name its own key.

```jsonc
{
  "identity": {
    "provider": "github",
    "host": "github.com",
    "owner": "<owner>",
    "name": "<repo>",
    "defaultBranch": "main"
  },
  "location": { "kind": "remote_clone", "cloneUrl": "https://github.com/<owner>/<repo>.git" },
  "scope":  { "read": ["**"], "write": ["src/**"] },      // write=[] means read-only; "**" is opt-in, by a human
  "credential": { "envVarName": "GITHUB_TOKEN" },          // the NAME of 0c, never the value
  "grants": [                                              // the permission ladder this repo may ever grant
    { "permission": "read",                "authorizedBy": "founder", "authorizedAt": "<ISO>", "expiresAt": null, "note": null },
    { "permission": "write_worktree",      "authorizedBy": "founder", "authorizedAt": "<ISO>", "expiresAt": null, "note": null },
    { "permission": "commit",              "authorizedBy": "founder", "authorizedAt": "<ISO>", "expiresAt": null, "note": null },
    { "permission": "push_feature_branch", "authorizedBy": "founder", "authorizedAt": "<ISO>", "expiresAt": null, "note": null },
    { "permission": "create_pr",           "authorizedBy": "founder", "authorizedAt": "<ISO>", "expiresAt": null, "note": null }
    // add "merge_pr" / "deploy_staging" / "deploy_production" ONLY when the founder means it
  ],
  "ceilings": { "maxFilesChanged": 5, "maxLinesRemoved": 100, "allowDeletions": false },
  "registeredBy": "founder"                               // required; a registration nobody authorized is refused
}
```

`200 → { registered: true, key: "github:github.com/<owner>/<repo>", credentialEnvVarName: "GITHUB_TOKEN" }`.
Protected-by-default paths (`.git` unconditionally; CI/workflow files, lockfiles,
manifests by default) cannot be written even inside `write` scope unless the
founder explicitly `unprotect`s them one by one.

Verify: `GET /relay-api/repository/list` (operator) → names, grants, revoked
flag, credential env-var NAME. No secret value, ever.

## 2. Start a mission against the target (operator)

`POST /relay-api/mission/start` — Bearer operator. Naming `repositoryKey` is
**operator-only** (a control session gets `403 operator_required` — tested).

```jsonc
{
  "missionId": "<id>",
  "objective": "<what to build>",
  "repositoryKey": "github:github.com/<owner>/<repo>",   // resolved from the store, never accepted pre-built
  "workingBranch": "relay/<mission>",                    // required with a target; NEVER the base branch
  "intendedWritePaths": ["src/<file>"]                   // narrows; must sit inside write scope
}
```

The three-role pipeline runs (architect → coding-in-isolated-worktree → Hermes
review), Relay observes the worktree against the resolved baseline SHA, and — on
a passing verification — **retains** the worktree for shipping. The source repo
is left untouched whatever the outcome.

## 3. Ship the verified mission (operator, 🔒 authorization in the body)

Only a mission at `verified_complete` **with a real target and a retained
worktree** is shippable (`shipContext`, mutation-proven). The ship re-observes
and re-judges the worktree *now*, from disk, against the resolved baseline SHA —
against scope, protected paths and ceilings; it is not re-compared against the
reviewer's artifact digest. A stored judgement is never trusted.

`POST /relay-api/mission/:id/ship` — Bearer operator. A second concurrent ship
for the same mission is refused `409 ship_in_progress`.

```jsonc
{
  // COMMIT is always part of a ship. The two optional tails are separately authorized:
  "remote": {                                            // omit to keep the change local-only
    "provider": "github",
    "credentialEnvVarName": "GITHUB_TOKEN",              // must be NAMED, else the seam refuses
    "pullRequestTitle": "<title>",
    "pullRequestBody": { /* PullRequestEvidence: objective, digests, reviewer verdict, attestations, baselineSha */ }
  },
  "deploy": {                                            // omit to stop after PR/merge
    "environment": "staging",                            // "production" needs the deploy_production grant AND a real provider
    "deployRoot": "<dir the provider deploys into>",
    "baseUrl": "<url the live probe checks>"             // null → deploy recorded, live-verify not claimed
  }
}
```

Lifecycle it walks, each stage doing only what was authorized and granted:
`verified_complete → ready_to_ship → committed → pushed → pull_request_open →
merged → deploying → deployed → live_verified → shipped`. A missing grant or a
missing authorization stops the ship at the last honest stage — it never invents
a later one, and a failed optional stage blocks only its dependents (independent
stage progression). A simulated provider can never emit a `shipped` production
record (environment gate on the acting path). Once a ship is recorded the
mission stops presenting as shippable.

---

## Stop conditions / invariants (these hold; do not weaken to get past a gate)

- **Never infer** the target repo or the production authorization. If the cheapest
  way past a refusal is a less-safe config, the guard is right.
- **Fail-closed**: no state root → `503`; unregistered key → `404`; unresolved
  baseline → `422`; non-operator naming a repo → `403`; a ship already in flight
  → `409`.
- **Never redeploy the bridge while a paid mission is in flight** (in-memory registry).
- The runbook does not itself authorize anything. It is the sequence; 0b, 0c, and
  the ship-body authorization remain the founder's explicit acts.
