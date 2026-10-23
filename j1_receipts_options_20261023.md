# Julius J1: per-leg dollar receipts for the combined ceiling, options and xAI receipt-probe plan

Date: Fri 2026-10-23 (America/Los_Angeles, PT)
Repo: `ohdieyuh-glitch/sunday-relay`. Branch `judev/j1-combined-ceiling`. Code head **22a0a9cb** (2026-10-23 00:50 PT). The branch tip is `126b3713`, an evidence-only commit on top of it. **Deliverable B is pinned to `31bfc58b` on `judev/j1-combined-ceiling`.** The live run records the exact adapter commit SHA at run time, and Skywalker diffs that SHA against `31bfc58b` before accepting. Its only code change since 22a0a9cb is the one-line reviewer-prompt rename (`julius-xai-direct-reviewer.ts:29`), so the Deliverable A line references still hold.
Method: read-only. I used the cursor-github `get_file_contents`, `get_git_tree` and `list_commits` tools at ref 22a0a9cb, plus public provider docs. I made no code changes, no pushes, no paid calls and handled no credentials.
Status unchanged: readiness **94.520%**. The live xAI path is **UNTESTED**. The founder has approved no PR, merge or paid run.

---

## 0. Findings that change the framing

| # | Finding | Evidence (22a0a9cb) |
|---|---|---|
| F-a | **The J1 production reviewer is the direct xAI adapter, not Hermes.** `createJ1ProductionComposition` wires the reviewer to `createXaiDirectReviewerRoleProvider`. The legs with no receipt are therefore **architect (OpenAI)** and **coder (Claude Code)**. Hermes is not contacted in a J1 run. This conflicts with the "architect, Hermes and coder" wording in Skywalker's F1, which needs reconciling: F1 may describe `createReviewerRoleProvider` (Hermes), which still exists in the file but is not composed into J1. | `relay-bridge/julius-dispatch-adapters.ts:608-617` (reviewer at :615); `relay-bridge/julius-dispatch-wiring-core.ts:19` (comment: GPT architect + Claude Code coder + direct xAI reviewer), `:235-239` |
| F-b | **There is no frozen price table in the repo.** The founder rule's price-table route is closed. The accounting module says outright that none exists and that inventing one is forbidden. The only "rate" in the tree is a fictional development fixture. I listed all 2,812 tree entries and none is a price or pricing file. | `src/relay/mission/julius/julius-cost-accounting.ts:19-22, 34-37`; `src/relay/mission/economics/economics-fixtures.ts:3-6, 37-46` (FIXTURE_RATE, "FICTIONAL", trust `development_fixture`); `src/relay/mission/economics/cost-receipt-types.ts:156-180` |
| F-c | **The ceiling refuses any contacted leg that lacks an integer receipt.** In `legMicros`, a `not_contacted` leg counts as 0 and a `usage_reported` leg needs a non-empty response id plus a safe integer `costUsdMicros` ≥ 0. Anything else is `unknown_spend`, and the dispatcher turns that into 409 `julius_dispatch_repeat_spend_unknown`. | `relay-bridge/julius-dispatch-repeat-ceiling.ts:111-121, 124-150`; `relay-bridge/julius-dispatch.ts:117-123` (spendMarkerOf), `:786-815` (refusal at :799) |
| F-d | **The repeat reads run 1's receipts from the ledger.** A run 1 that was already ledgered with null architect or coder receipts cannot be repaired by any later wiring change, so the repeat stays refused for that mission. Any fix must land before a fresh run 1. I don't know whether a real run 1 exists. | `julius-dispatch-repeat-ceiling.ts:209-240` (priorSpendFromLedger) |
| F-e | A latent "round down" violation exists. `hostedCoderCost` converts `total_cost_usd` with `Math.round` in API-key mode. It is unused on the J1 success path today, because the adapter doesn't copy it, but it must not become the receipt. (`ceiling.ts:46, :88` also use `Math.round`, but only on env limits and the operator's pre-leg estimate, not on receipts.) | `relay-bridge/julius/claude-code-coding-provider.ts:82, 95-101` |
| F-f | Wording issue at 22a0a9cb: the xAI reviewer's system prompt used the old name for Julius. **Fixed at `31bfc58b`**: `J1_XAI_REVIEW_INSTRUCTIONS` now says "Julius mission". The Deliverable B probe copies the `31bfc58b` text verbatim. | `relay-bridge/julius-xai-direct-reviewer.ts:29` (fix: `31bfc58b`) |
| F-g | **Independence limits the routing options.** `composeRoleProviders` requires 3 distinct providerIds **and** 3 distinct model vendors (openai / anthropic / xai). A routed name such as `openai/gpt-…` counts as vendor openai. Moving the architect or coder onto xAI is refused while the reviewer is xAI. | `relay-bridge/julius-role-compose.ts` (`modelVendor`, `composeRoleProviders`, error `role_models_not_independent_families`) |

---

## Deliverable A: receipt options per leg

### A.1 Architect leg (OpenAI GPT, Responses API)

**Current code (22a0a9cb).** `createArchitectRoleProvider` (`julius-dispatch-adapters.ts:87-120`) returns success at :112-117 with no `costUsdMicros`. The comment at :115 reads: "OpenAI Responses usage is token counts only. There is no dollar field to copy". Usage is mapped from tokens at :129-131. The runner reads only `input_tokens`, `output_tokens` and `total_tokens` (`src/relay/connectors/gpt-architect/gpt-runner.ts:216-221`). The leg is `usage_reported` with a null cost, so the ceiling gets `unknown_spend`.

**Provider facts**
- The OpenAI Responses API `usage` object has token counts only (input, output, cached, reasoning, total). There is no cost field. https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response_usage.py
- The OpenAI Costs API (`GET /v1/organization/costs`) returns **billed** cost as a decimal `amount.value`. It is bucketed by **1 day** only, can be grouped by `project_id` / `line_item`, needs an **Admin key**, and is not linked to a response id. https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs/ and https://help.openai.com/en/articles/10478918-reviewing-api-usage-and-costs
- OpenRouter returns `usage.cost` on every response, documented as "the total amount charged to your account". It can also be fetched later by generation id (`/generation`). https://openrouter.ai/docs/cookbook/administration/usage-accounting

| Option | Smallest change | Risk | Provider-reported billed cost? | Founder decision |
|---|---|---|---|---|
| A1. Use the OpenAI response's usage | n/a | n/a | **No.** Tokens only, and pricing them would be a new estimate. | none (rejected) |
| A2. Frozen price table | n/a | n/a | **No.** None exists (F-b), and creating one is forbidden. | none (rejected) |
| A3. Exclude the leg | n/a | It would be a false claim, because the architect does make a paid call. | No | none (rejected) |
| A4. Move the architect to xAI (gets ticks) | Swap the adapter | Breaks 3-vendor independence (F-g) unless the reviewer moves off xAI, and then the reviewer loses its receipt. | Yes for the leg, but the composition is refused | Relax independence (**not recommended**) |
| **A5. Route the OpenAI model through OpenRouter** (`openai/gpt-…`) | New architect adapter (one file plus tests). OpenRouter Chat Completions with providerId e.g. `openrouter-openai`. Read `usage.cost` from the **raw JSON number text** and round **up** to integer micros with integer arithmetic. Keep the raw `usage.cost` string on the ledger row next to the computed micros, the same way the xAI adapter keeps raw ticks (`costUsdTicksRaw`). It is never rounded down. Response id is the OpenRouter generation id. Add a new key name to the J1 key store. | New intermediary and new key. Cost is in OpenRouter credits (USD-denominated) and includes OpenRouter's fee, so it may differ slightly from OpenAI list price. Upstream may be OpenAI or Azure, and served-model echo semantics need checking. Only the docs' sample has been checked so far, not a live call (same status as xAI today). | **Yes.** It is per response and is what the billing provider actually charges the account. | (1) Accept OpenRouter as the billing provider of record for the architect. (2) Authorize a new OpenRouter key placed in `JULIUS_J1_KEY_DIR` by the founder. |
| A6. Keep OpenAI direct and reconcile from the OpenAI Costs API | New post-run "settle" step plus a new ledger row type that the ceiling accepts as the architect receipt. Use a dedicated J1 OpenAI project, enforce one J1 run per UTC day, read that project's daily bucket and ceil it to micros. | Needs an **Admin key** (org-wide privilege). Daily granularity means attribution holds only if nothing else uses the project that UTC day. A repeat run requested before that day's cost figures settle is **REFUSED as unknown spend** (409 `julius_dispatch_repeat_spend_unknown`). It is not queued or allowed through. OpenAI doesn't document the settle latency. The receipt is not tied to a response id, so the ceiling's "response id + receipt" rule needs amending. | **Yes** (billed), but only per project-day, not per response. | (1) Authorize an OpenAI Admin key. (2) Approve a dedicated project and a one-run-per-UTC-day rule. (3) Accept a project-day bucket as the leg's receipt. |

**Recommendation for the architect: A5 (OpenRouter-routed OpenAI model).** It is the only option that gives a synchronous, per-response billed receipt with a response id, which matches the existing ceiling model with no change to `legMicros`. The OpenAI vendor is kept, so independence holds. If the founder won't add an intermediary, choose A6. It is billed but coarse, and it needs an Admin key plus a ceiling amendment.

### A.2 Coder leg (Claude Code via the hosted Claude Agent SDK)

**Current code (22a0a9cb)**
- The auth mode is pinned: `J1_CODER_AUTH_MODE = 'CLAUDE_SUBSCRIPTION'` (`julius-dispatch-wiring-real.ts:26-30`). The coder is built with `apiKey ''` and subscription mode (:51-63).
- Auth modes are `ANTHROPIC_API | CLAUDE_SUBSCRIPTION` (`relay-bridge/hosted-coding-agent/hosted-auth.ts:45`). The subscription token env is `CLAUDE_CODE_OAUTH_TOKEN` (:84), and `ANTHROPIC_API_KEY` takes precedence (:59).
- `hostedCoderCost` (`relay-bridge/julius/claude-code-coding-provider.ts:67-102`) behaves differently by mode. Under subscription, `costUsdMicros` is null with basis `NOT_APPLICABLE` (:84-93). In API mode, `costUsdMicros = Math.round(total_cost_usd*1e6)` with basis `PROVIDER_REPORTED` (:82, :95-101). The comment at :238-246 says total_cost_usd is a priced estimate.
- The runtime figure comes from `m.total_cost_usd` (`hosted-observation.ts:392`, source `runtime_reported` at :428).
- The adapter's success return has no `costUsdMicros` (`julius-dispatch-adapters.ts:397-415`, comment :407-409). Its failure path passes `outcome.costUsdMicros` (:333-341), which is null under subscription. It returns `providerContacted:false` only when the runtime never started (:336).
- The result: a coder that ran is `usage_reported` with a null cost, so the ceiling gets `unknown_spend`.

**Provider facts**
- Claude Agent SDK: `total_cost_usd` is a **client-side estimate** computed from tokens at list price, not a bill. https://code.claude.com/docs/en/agent-sdk/cost-tracking
- Claude Code: "Claude Code computes the dollar figure locally from token counts at list price … The figure is an estimate". For Pro/Max subscribers "the session cost figure isn't relevant for billing purposes". If **usage credits** are on, subscription work past the plan limit is billed in dollars. https://code.claude.com/docs/en/costs
- Anthropic Usage & Cost Admin API (`/v1/organizations/cost_report`): billed cost in USD decimal strings, daily buckets, groupable by `workspace_id`. It needs an **Admin key** and is unavailable to individual accounts. https://platform.claude.com/docs/en/manage-claude/usage-cost-api

So `total_cost_usd` is an **estimate under both subscription and API key**. Even API-key mode doesn't meet "provider-reported billed cost", and the current API-mode conversion also rounds to nearest (F-e).

| Option | Smallest change | Risk | Provider-reported billed cost? | Founder decision |
|---|---|---|---|---|
| C1. Copy `total_cost_usd` | One line | It's an estimate (docs above) and currently uses Math.round | **No** | none (rejected) |
| C2. Frozen price table | n/a | None exists (F-b) | **No** | none (rejected) |
| C3. Mark the leg not_contacted | n/a | False: the session does contact Anthropic | No | none (rejected) |
| C4. Move the coder to xAI | New coder runtime | Breaks independence (F-g) and loses the Claude Code coder | Yes | Relax independence (not recommended) |
| **C5. Subscription leg = unmetered, outside the dollar sum** | Narrow ceiling change in `legMicros`. Accept a contacted coder leg only when the ledgered `billingPath === 'SUBSCRIPTION'` and `costBasis === 'NOT_APPLICABLE'`, both carried from `hostedCoderCost`. Count it as **excluded, not 0**, consistent with `julius-cost-accounting.ts:46-56` ("NOT_APPLICABLE … is certainly not zero"). The adapter must put `billingPath`/`costBasis` on the row. A preflight refuses if `ANTHROPIC_API_KEY` is present in the coder env. | If usage credits are on, overage is billed in dollars and goes uncounted. Whether usage credits are off is a **founder attestation that code cannot check**. The billing path is inferred from credential configuration, not observed from a bill. | **N/A: there is no per-request bill.** It doesn't satisfy the rule as written, so it needs an explicit rule amendment. | (1) Amend the rule: "a Claude subscription leg with usage credits OFF is not metered and is excluded from the $ ceiling". (2) Attest that usage credits are off on the Claude account used by Kaisin (**founder attestation; code cannot check it**). (3) **Condition accepted only by choosing C5:** this option allows a repeat run while the coder's dollar spend is unknown. The run record must state that the $30 per run / $60 combined ceilings cover only the metered legs (architect and reviewer) and exclude the coder. (4) On every run, code checks the ledgered billing fields (`billingPath === 'SUBSCRIPTION'`, `costBasis === 'NOT_APPLICABLE'`) and refuses the run when the coder's billing fields are missing. "Usage credits OFF" stays a **founder attestation that code cannot check**: it is recorded with the run, not verified. |
| C6. Switch to an Anthropic API key in a dedicated workspace and reconcile from `cost_report` | Set `J1_CODER_AUTH_MODE` to `ANTHROPIC_API`. Add a post-run settle step that reads the workspace's daily `cost_report`, ceils it to micros and writes a settle ledger row. Amend the ceiling to accept a settled receipt. Never use `total_cost_usd`. | Needs an Admin key (organization account only). Daily granularity, so one J1 run per UTC day in an otherwise idle workspace. A repeat run requested before that day's `cost_report` figures settle is **REFUSED as unknown spend** (409 `julius_dispatch_repeat_spend_unknown`). Reverses the deliberate subscription choice. Paid per token. | **Yes** (billed, per workspace-day) | (1) Move the coder from subscription to API billing. (2) Authorize an Anthropic org Admin key. (3) Approve a dedicated workspace and one run per UTC day. (4) Accept a workspace-day receipt. |
| C7. Run Claude Code through OpenRouter's Anthropic-compatible endpoint and sum `usage.cost` per generation | Set the base URL, then fetch every request's generation id and sum it | High. The Agent SDK doesn't surface per-request OpenRouter costs. Many requests per session. Hosted-auth may refuse a base-URL override. | Yes in principle | Not recommended |

**Recommendation for the coder: C5, provided the founder amends the rule and attests that usage credits are off (**founder attestation; code cannot check it**).** It is the smallest truthful change: nothing is billed per request under subscription, and the repo already models this as `NOT_APPLICABLE`/`SUBSCRIPTION` rather than as a dollar figure. **If the founder keeps the rule strict** (a billed dollar receipt for every contacted leg), the only compliant path is **C6**, which is larger, slower to settle and needs an Admin key. **Unless the founder picks C5, the frozen $30/$60 ceilings cover every leg, coder included**, and a coder leg without a billed receipt keeps the repeat refused as unknown spend.

### A.3 Hermes (reviewer harness)

**What it is.** Hermes is Nous Research's **Hermes Agent** CLI, run as an external **harness**, not a model provider. The repo calls `hermes -z <prompt> --usage-file <f> -m <model> --provider <anthropic|xai>` (`relay-bridge/reviewer-harness/hermes/runner.ts:123-135`, `hermes-provider.ts`). Upstream `--usage-file` writes `estimated_cost_usd` plus `cost_status/source`, which the agent computes itself. https://github.com/NousResearch/hermes-agent/pull/59615 and https://hermes-agent.nousresearch.com/docs/reference/cli-commands
**Repo handling.** `parseUsageFile` reads `o.estimated_cost ?? o.cost` with `Math.round` (`runner.ts:86-117`, :102, :112). This is labelled a harness estimate, never spend (`relay-bridge/hermes-reviewer.ts:126-132`; `julius-cost-accounting.ts:19-22`; adapter comment `julius-dispatch-adapters.ts:485-486`). Side note: upstream names the field `estimated_cost_usd`, so the repo parser may read null on current Hermes builds. This is unverified.
**J1 status.** Hermes is **not in the J1 composition** (F-a).

| Option | Change | Billed? | Decision |
|---|---|---|---|
| **H1. Keep Hermes out of J1** and keep the direct xAI reviewer, which already carries `cost_in_usd_ticks` (rounded up) | none | Yes (xAI ticks, once live-proven by Deliverable B) | Confirm Hermes stays out of J1 |
| H2. Reinstate Hermes with the xAI provider and pass xAI's ticks through | Upstream harness change. Hermes does not expose provider ticks today. | Only if Hermes forwards the provider figure | Not recommended |
| H3. Use Hermes `estimated_cost_usd` | n/a | **No** (estimate) | Rejected |

**Recommendation for Hermes: H1.** No change is needed. Correct the F1 wording.

### A.4 Founder decisions needed (Deliverable A)
1. **Architect:** approve OpenRouter as the billing provider for the OpenAI architect (A5) and a new OpenRouter key placed by the founder. Otherwise choose A6, which needs an OpenAI Admin key, a dedicated project, one run per UTC day and a project-day receipt.
2. **Coder:** choose between (a) a rule amendment that excludes a Claude **subscription** leg from the dollar ceiling, with an attestation that **usage credits are OFF** (**founder attestation; code cannot check it**) (C5), accepting C5's condition (the repeat may run with the coder's spend unknown, the ceilings cover only the architect and reviewer legs, the billing fields are checked by code on every run and missing coder billing fields refuse the run), and (b) keeping the rule strict, which means API billing, an Anthropic Admin key, a dedicated workspace and a daily settle (C6).
3. **Hermes:** confirm that it stays out of J1 (H1), and accept the correction that only the architect and coder lack receipts at 22a0a9cb.
4. **Ledger:** accept that a fresh run 1 under the new wiring is needed if any run 1 is already ledgered with null legs (F-d).
5. Unchanged: $30 per run / $60 combined are frozen, env may only lower them, and never round down. This holds for every option above, with the ceilings covering every leg (coder included), **except C5**, and only under C5's stated condition: if the founder chooses C5, the ceilings cover only the metered legs (architect and reviewer), the record says so, code checks the coder's billing fields on every run and refuses a run with missing coder billing fields, and "usage credits OFF" remains a founder attestation that code cannot check. A5's adapter and C6's settle step must round up.

---

## Deliverable B: governed capture of one real xAI `/v1/responses` receipt (PLAN ONLY, NOT RUN)

### B.1 Existing entrypoint
- **Pin:** `31bfc58b` (full SHA `31bfc58b89de137670e5dbaf752c3328b31163f7`, read from GitHub) on `judev/j1-combined-ceiling`. **Before the API key is read and before any network call**, the probe verifies the checkout and refuses unless it is clean and at the pin, or descends from it with evidence-only changes (B-3 checkout gate, B.2). The live run records the exact adapter commit SHA at run time (`adapter_commit` in `summary.json`), and Skywalker diffs that SHA against `31bfc58b` before accepting (any change to `julius-xai-direct-reviewer.ts`, `julius-dispatch-repeat-ceiling.ts` or `julius-dispatch.ts` must be reviewed first). Line numbers below are the same at 22a0a9cb and 31bfc58b; only the prompt text at :29 changed.
- **There is no standalone xAI probe or live test at 31bfc58b.** `julius-xai-direct-reviewer.test.ts` uses a fake fetch only. I checked `scripts/julius-live-preflight.ts`, `scripts/julius-paid-dispatch.mjs` and `scripts/julius-live-probe-file.ts`, and none calls xAI `/responses`. The `package.json` scripts are `relay:julius:mission` and `relay:julius:preflight`. `xai-models.ts` does only a zero-token `GET /models` listing.
- The only real caller is the full J1 dispatch, which pays all three legs. It is not suitable for a one-call probe.
- The adapter's request shape to copy exactly is in `julius-xai-direct-reviewer.ts:95-100`: `POST {base}/responses`, base `https://api.x.ai/v1` (`xai-models.ts`), header `authorization: Bearer <key>`, and body `{"model":M,"store":false,"input":[{"role":"system","content":J1_XAI_REVIEW_INSTRUCTIONS},{"role":"user","content":<text>}]}`. Parsing is at :124-151 and ticks→micros (ceil, BigInt) at :56-64.

**Plan:** (1) the founder runs one guarded PowerShell call on Kaisin with the same request shape (no repo change); (2) the result is replayed **offline** through the real adapter at the recorded `adapter_commit` (after Skywalker's diff against `31bfc58b`) by feeding the captured bytes in as a fake fetch (no network, no real key). Together these prove the live field and the adapter's handling of it.

### B.2 Founder-only steps (the key never enters chat or the agents)
Prerequisites:
- the founder approves this one paid call;
- an xAI console spend limit is set;
- `JULIUS_J1_REPO_DIR` points at the sunday-relay checkout that J1 runs from. The probe gates on it before reading the key (see the B-3 checkout gate below);
- `JULIUS_J1_KEY_DIR`, `JULIUS_J1_REVIEWER_KEY_ENV` (the key *file name*, e.g. `XAI_API_KEY`) and `JULIUS_J1_REVIEWER_MODEL` are already set the way J1 uses them;
- no transcript is running (`Stop-Transcript` if unsure);
- the block is saved as a file (e.g. `j1-xai-probe.ps1`) and run with `powershell -NoProfile -ExecutionPolicy Bypass -File .\j1-xai-probe.ps1`, so a refusal exits non-zero without closing the founder's shell.

**B-3 checkout gate (runs FIRST: before the key file is read and before any network call).** The probe exits with a non-zero code (3) and reads no key and makes no call unless all of these hold:
1. `git -C $env:JULIUS_J1_REPO_DIR status --porcelain --untracked-files=no` prints nothing (tracked and staged changes are clean).
2. HEAD is exactly the pinned full SHA `31bfc58b89de137670e5dbaf752c3328b31163f7`, **or** `git merge-base --is-ancestor 31bfc58b89de137670e5dbaf752c3328b31163f7 HEAD` succeeds **and** every path from `git diff --name-only --no-renames 31bfc58b89de137670e5dbaf752c3328b31163f7 HEAD` is an evidence path.
   - **Evidence paths** are defined by a fixed prefix list, `$EvidencePrefixes = @('.github/julius-missions/review-evidence/j1-combined-ceiling/31bfc58b/')`. This is the only directory touched by the evidence-only commits `1254b0d1` and `71d9f6f8` on `judev/j1-combined-ceiling`. Each path is normalised to forward slashes and accepted only by a full-path prefix test, `$p.StartsWith($prefix, [StringComparison]::Ordinal)`. Substring, `-like` and `-match` tests are never used. `--no-renames` makes a rename out of a code path show the old path too.
   - **Empty diff output is accepted only when HEAD equals the pinned full SHA exactly.** If HEAD differs from the pin and the diff is empty, the probe refuses.
3. **Fail closed on git failures:** `$LASTEXITCODE` is checked after every git call. The probe refuses on any non-zero exit, and on any output it can't parse: an empty line, a line containing NUL, or a line that isn't a relative path (absolute, drive-qualified, quoted or containing `..` segments).
4. `summary.json` records `adapter_commit` (full HEAD SHA), `pinned_commit` (full pin SHA), `git_dirty` (always `false`, because a dirty tree is refused), `repo_toplevel` (`git rev-parse --show-toplevel`) and `evidence_paths_diffed` (the list, empty when HEAD equals the pin).

```powershell
# J1 xAI receipt probe. FOUNDER-RUN ON KAISIN ONLY, after approval. Exactly ONE paid call. Never echoes the key.
$ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
function Stop-Probe([string]$why) { [Console]::Error.WriteLine('PROBE REFUSED: ' + $why); exit 3 }
$keyDir = $env:JULIUS_J1_KEY_DIR; $keyName = $env:JULIUS_J1_REVIEWER_KEY_ENV; $model = $env:JULIUS_J1_REVIEWER_MODEL; $repoDir = $env:JULIUS_J1_REPO_DIR
if (-not $keyDir -or -not $keyName -or -not $model -or -not $repoDir) { Stop-Probe 'probe_env_missing' }
# ---- B-3 checkout gate: runs BEFORE the key is read and BEFORE any network call. Fails closed. ----
$PinnedFull = '31bfc58b89de137670e5dbaf752c3328b31163f7'
$EvidencePrefixes = @('.github/julius-missions/review-evidence/j1-combined-ceiling/31bfc58b/')
$env:GIT_OPTIONAL_LOCKS = '0'
function Test-RelPath([string]$p) { return ($p -and ($p.IndexOf([char]0) -lt 0) -and -not $p.StartsWith('/') -and -not $p.StartsWith('"') -and ($p -notmatch '^[A-Za-z]:') -and (('/' + $p + '/').IndexOf('/../') -lt 0)) }
if (-not (Test-Path -LiteralPath $repoDir -PathType Container -ErrorAction Stop)) { Stop-Probe 'probe_repo_missing' }
$top = @(git -C $repoDir rev-parse --show-toplevel); if ($LASTEXITCODE -ne 0 -or $top.Count -ne 1 -or -not $top[0]) { Stop-Probe 'probe_repo_not_git' }
$repoTop = $top[0].Trim()
$dirty = @(git -C $repoDir status --porcelain --untracked-files=no); if ($LASTEXITCODE -ne 0) { Stop-Probe 'probe_git_status_failed' }
if ($dirty.Count -gt 0) { Stop-Probe 'probe_repo_dirty' }
$headOut = @(git -C $repoDir rev-parse --verify HEAD); if ($LASTEXITCODE -ne 0 -or $headOut.Count -ne 1) { Stop-Probe 'probe_head_unreadable' }
$adapterCommit = $headOut[0].Trim(); if ($adapterCommit -notmatch '^[0-9a-f]{40}$') { Stop-Probe 'probe_head_unparseable' }
$evidencePaths = @()
if ($adapterCommit -ne $PinnedFull) {
  git -C $repoDir merge-base --is-ancestor $PinnedFull $adapterCommit; if ($LASTEXITCODE -ne 0) { Stop-Probe 'probe_head_not_descendant_of_pin' }
  $diffOut = @(git -C $repoDir -c core.quotepath=off diff --name-only --no-renames $PinnedFull $adapterCommit); if ($LASTEXITCODE -ne 0) { Stop-Probe 'probe_diff_failed' }
  if ($diffOut.Count -eq 0) { Stop-Probe 'probe_empty_diff_but_head_differs' }
  foreach ($line in $diffOut) {
    if (-not (Test-RelPath $line)) { Stop-Probe 'probe_diff_unparseable' }
    $norm = $line.Replace('\', '/')
    $ok = $false; foreach ($prefix in $EvidencePrefixes) { if ($norm.StartsWith($prefix, [StringComparison]::Ordinal)) { $ok = $true } }
    if (-not $ok) { Stop-Probe 'probe_head_has_non_evidence_changes' }
    $evidencePaths += $norm
  }
}
# ---- gate passed: only now locate the key file and make the one call ----
$keyPath = Join-Path $keyDir $keyName
if (-not (Test-Path -LiteralPath $keyPath -PathType Leaf -ErrorAction Stop)) { Stop-Probe 'probe_key_file_missing' }
$out = Join-Path $env:USERPROFILE ('julius-xai-probe-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $out -ErrorAction Stop | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding $false
# System text = J1_XAI_REVIEW_INSTRUCTIONS verbatim at 31bfc58b (julius-xai-direct-reviewer.ts:28-32, "Julius mission")
$sys  = 'You are the independent Reviewer for a Julius mission. You are shown the mission brief, the architect plan and the coder artifact. You did not write any of them. Judge whether the artifact satisfies the brief. Reply with ONE JSON object and nothing else: {"verdict":"approve"|"reject","summary":"<short reasons>"}.'
$user = "MISSION BRIEF:`nReceipt probe: the artifact must be the word ok.`n`nARCHITECT PLAN:`nWrite ok.`n`nCODER ARTIFACT:`nok"
$body = @{ model = $model; store = $false; input = @(@{ role = 'system'; content = $sys }, @{ role = 'user'; content = $user }) } | ConvertTo-Json -Depth 5 -Compress
[IO.File]::WriteAllText((Join-Path $out 'request.json'), $body, $utf8)   # contains no secret
$raw = Join-Path $out 'response.raw.json'
$key = $null
try {
  $key = ([IO.File]::ReadAllText($keyPath)).Trim()
  if ($key.Length -lt 20) { throw 'probe_key_unreadable' }
  $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'https://api.x.ai/v1/responses' -TimeoutSec 600 `
        -Headers @{ authorization = ('Bearer ' + $key) } -ContentType 'application/json' -Body $body -OutFile $raw -PassThru
  [IO.File]::WriteAllText((Join-Path $out 'status.txt'), [string]$r.StatusCode, $utf8)
} finally { $key = $null; Remove-Variable key -ErrorAction SilentlyContinue; [GC]::Collect() }
# --- Offline from here: no network, no key ---
$text = [IO.File]::ReadAllText($raw)
if ($text -match 'xai-[A-Za-z0-9]{16,}|Bearer\s') { throw 'probe_secret_in_body_DO_NOT_SHARE' }
$j = $text | ConvertFrom-Json
$m = [regex]::Match($text, '"cost_in_usd_ticks"\s*:\s*(-?\d+)(?![\d.eE])')   # integer literal only
$ticks = if ($m.Success) { [System.Numerics.BigInteger]::Parse($m.Groups[1].Value) } else { $null }
$micros = $null
if ($ticks -ne $null -and $ticks.Sign -ge 0) { $q = [System.Numerics.BigInteger]::Divide($ticks, 10000); if (($ticks % 10000) -ne 0) { $q = $q + 1 }; $micros = $q }
$summary = [ordered]@{
  captured_pt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'); captured_utc = (Get-Date).ToUniversalTime().ToString('o')
  http_status = [IO.File]::ReadAllText((Join-Path $out 'status.txt')); response_id = $j.id; model_requested = $model; model_served = $j.model
  input_tokens = $j.usage.input_tokens; output_tokens = $j.usage.output_tokens; cost_in_usd_ticks = if ($ticks -ne $null) { $ticks.ToString() } else { $null }
  cost_usd_micros_ceil = if ($micros -ne $null) { $micros.ToString() } else { $null }
  sha256_response_raw = (Get-FileHash -Algorithm SHA256 -LiteralPath $raw).Hash.ToLower()
  sha256_request = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $out 'request.json')).Hash.ToLower()
  adapter_commit = $adapterCommit; pinned_commit = $PinnedFull; git_dirty = $false; repo_toplevel = $repoTop
  evidence_paths_diffed = [string[]]$evidencePaths
}
$summary | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $out 'summary.json')
$summary | Format-List   # prints ids/ticks/hashes only, never the key
```

Notes:
- The key is read from the existing J1 key-store file (the same store `createFileKeyStore` reads, `relay-bridge/julius-key-store.ts`). It is never typed, pasted, logged, put in history or written to disk elsewhere. The request headers aren't saved, and the response body has no secret, but it is scanned anyway.
- If the response has no integer `cost_in_usd_ticks`, the founder reports that. It means the adapter's assumption (`julius-xai-direct-reviewer.ts:15-17`, "UNVERIFIED") is false, and J1 must not run.
- The checkout gate runs **before** the key file is read and before the call. A refusal exits with code 3, reads no key and makes no network request.
- Running it once means **one** call. On an error, do not retry without new approval.

### B.3 Expected cost (xAI published prices)
- Pricing: https://docs.x.ai/developers/pricing (page updated Oct 10 2026) and the model page https://docs.x.ai/developers/models/grok-4.7. grok-4.7 costs **$2.00 per 1M input tokens and $6.00 per 1M output tokens**, with reasoning tokens billed as output. Use whichever model `JULIUS_J1_REVIEWER_MODEL` names, at that model's row.
- Probe size: about 130 to 200 input tokens (the system prompt is about 90 tokens plus a short user message). The visible output is about 30 tokens of JSON plus reasoning tokens. grok-4.7 reasons by default, so assume up to a few thousand.
- Estimate for grok-4.7: input ≈ 200 × $2/1M = $0.0004. Output at 2,000 tokens ≈ $0.012, so the total is about **$0.0124 (≈ 1.24 ¢)**. A pessimistic case of 8,000 reasoning tokens is ≈ **$0.049**. Plan on **< $0.05**. The founder should set the xAI console limit for the probe at **$1** or less.
- Tick arithmetic (https://docs.x.ai/developers/cost-tracking): 1 USD = 10^10 ticks, 1 micro-USD = 10,000 ticks. Example: $0.0124 ≈ 124,000,000 ticks, which is 12,400 micros.
- Response field reference: https://docs.x.ai/developers/rest-api-reference/inference/responses (`usage.cost_in_usd_ticks`).
- The probe is **not** a J1 run. It is not ledgered and does not count against the frozen $30/$60. It still needs the founder's approval as a paid call.

### B.4 What to record (hand-off bundle; the founder copies the folder to the box or repo evidence only after the secret scan passes)
- `response.raw.json`: raw response bytes, unmodified. They contain no secret, and nothing is stripped, so the hash stays meaningful. If the scan ever flagged something, stop and do not share.
- `request.json`: the exact request body, which contains no secret.
- `summary.json`: capture time (PT and UTC), HTTP status, `id` (response id), requested and served model, tokens, **`cost_in_usd_ticks` (integer)**, **micros = ceil(ticks/10,000)**, SHA-256 of the raw response and the request, and the checkout-gate fields: `adapter_commit` (full HEAD SHA at run time), `pinned_commit` (full `31bfc58b` SHA), `git_dirty` (`false`), `repo_toplevel` and `evidence_paths_diffed`. Evidence paths are those matching the fixed prefix list `$EvidencePrefixes` by full-path ordinal prefix test after normalising to forward slashes. Git failures or unparseable git output refuse the probe. An empty diff is valid only when `adapter_commit == pinned_commit`.
- A screenshot or CSV line from the xAI console's usage for that time window, if one is available.

### B.5 What Skywalker verifies
1. `sha256(response.raw.json)` equals `summary.sha256_response_raw`, and likewise for `request.json`.
2. `usage.cost_in_usd_ticks` is present, a JSON **integer** (no decimal point or exponent) and ≥ 0.
3. `cost_usd_micros_ceil == ceil(ticks / 10000)` in integer arithmetic. Spot-check the boundary: 158,500 ticks gives 16 micros.
4. **Checkout gate fields:** `pinned_commit == 31bfc58b89de137670e5dbaf752c3328b31163f7` and `git_dirty == false`. Either `adapter_commit == pinned_commit` with `evidence_paths_diffed` empty, or `adapter_commit` descends from the pin, `evidence_paths_diffed` is non-empty and equals Skywalker's own `git diff --name-only --no-renames <pin> <adapter_commit>`, and every entry passes `StartsWith('.github/julius-missions/review-evidence/j1-combined-ceiling/31bfc58b/', Ordinal)`. A different `adapter_commit` with an empty list is a FAIL. `repo_toplevel` is the checkout J1 runs from.
5. **Offline adapter replay at the recorded `adapter_commit`**, after Skywalker diffs it against `31bfc58b` and accepts the diff: call `createXaiDirectReviewerRoleProvider({...}).call()` with a fake `fetchImpl` that returns exactly the bytes of `response.raw.json` with the captured status, a dummy non-empty `apiKey`, and the model and served-model allow-list from the probe. Check that the result has `providerResponseId == summary.response_id`, `costUsdMicros == cost_usd_micros_ceil` and `costUsdTicksRaw == ticks`. Then run `legMicros`/`verifyRun1Spend` on that leg and check that it gives the integer, not `unknown_spend`. Use no network and no real key.
6. The request body matches the adapter's shape (`model`, `store:false`, system plus user input), and the system text equals `J1_XAI_REVIEW_INSTRUCTIONS` at `31bfc58b` byte for byte ("…Reviewer for a Julius mission. …"). Windows PowerShell 5.1 `ConvertTo-Json` escapes `<` and `>` as `\u003c` / `\u003e` (the prompt contains `<short reasons>`), so compare the **JSON-decoded** `input[0].content` string, not the raw `request.json` bytes. The raw bytes are still hashed for item 1.
7. The served model is in `JULIUS_J1_REVIEWER_SERVED_MODEL_ALLOW`.
8. The bundle has no secret (a pattern scan for `xai-…` and `Bearer`), and it was produced by one call (one response id).
9. The tick total is plausible against the published price × token counts, and matches the console usage if available. This is a sanity check only, never a substitute for the receipt.
10. Skywalker's verdict covers only "the live xAI path returns an integer billed-cost field that the adapter converts correctly". It does **not** cover the architect or coder legs, and readiness stays at 94.520% until the founder decides those legs and they are implemented and verified.

### B.6 Founder decisions needed (Deliverable B)
1. Approve exactly one paid xAI call (expected < $0.05) and set an xAI spend limit of $1 or less.
2. Run the B.2 block personally on Kaisin. Confirm that the key-store file and the reviewer model env are the ones J1 uses.
3. Approve sharing the resulting bundle (raw response, request, summary) with Skywalker after the secret scan passes.
