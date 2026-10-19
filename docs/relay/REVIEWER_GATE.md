# Sunday Relay — Reviewer Entitlement and Release Gate (authoritative)

> **Implementation sync (Prompt 8.3, 2026-07-22):** the gate now has a REAL
> independent reviewer. `evaluateReviewerGate` (`mission/reviewer-gate.ts`) is
> the single Relay-owned composite that computes structural independence,
> projects the finding/repair ledger, and derives the output-visibility state —
> the live Codex reviewer adapter asks Relay for this decision and never makes
> it itself. On a live Pro/Max review, coding output is held_for_verification,
> then held_for_review; the REAL Codex reviewer receives the package, its
> Execution Attestation and structured report must validate, and independence
> must hold before the verdict maps to the gate: `approved` → approved_for_
> release (then CompletionPolicy); `changes_required` → first-class findings +
> linked repairs → revision_required; `blocked` → blocked; `needs_human` →
> Manual Task, held. When Codex fails to launch, actual reviewer is unavailable,
> NO fallback runs, output stays held_for_review, and the mission cannot become
> verified_complete. See CODEX_REVIEWER_ADAPTER.md.

> Added in Prompt 8.2 (2026-07-22). The release gate is the structural
> guarantee that **output cannot reach the user before the review Relay
> requires has actually happened** — regardless of mode, entitlement, or an
> agent's claim. Source: `src/relay/mission/entitlement.ts`; owned by Relay
> Core, boundary-tested.

## Entitlement is separate from mode

`RelayEntitlement` (`free`, `pro`, `max`, `enterprise`) is a **billing tier**
and is entirely separate from the operational **mode** (MODES.md). Mode
governs how much Relay does without asking; entitlement governs whether an
**independent Reviewer** is available.

`entitlementPolicy(entitlement)`:

| Entitlement | Independent reviewer |
| --- | --- |
| free | none — reviewer `entitlement_locked` |
| pro | required, independent |
| max | required, independent |
| enterprise | required, independent |

On **Free**, `assignReviewer` returns `entitlement_locked` and output holds at
verification; there is no reviewer to approve release. **Pro/Max** unlock an
independent Reviewer whose approval is required before release.

## Output visibility is a Relay-Core state machine

`computeOutputVisibility(input)` owns the lifecycle. Output moves only
forward through required gates and is **never** released early:

```
working → held_for_verification → held_for_review → revision_required
        → approved_for_release → released
                     (blocked)  ← any unsafe condition
```

Release (`released`) requires **all** of: substantive coding reported,
Relay-run verification passed, the required review actually occurred, the
review approved, no blocking finding open, the reviewer was independent, and
the CompletionPolicy is satisfied. A missing or failed required review holds
output at `held_for_review`; a blocking finding forces `revision_required`.

**Autonomous cannot bypass the reviewer.** The mode never appears as a
release condition — an autonomous run reaches `released` only by clearing the
exact same gates. This is asserted structurally, not by convention.

## Reviewer independence is structural

`reviewerIsIndependent(input)` is true only when the reviewer differs from the
implementer along **every** lineage axis: agent id, session id, adapter id,
and independence group. A reviewer that shares any axis with the implementer
is not independent, and `computeOutputVisibility` will not release on its
approval. An adapter **cannot mark itself independent** — independence is
computed by Relay from the descriptors (boundary-tested).

## Reviewer package excludes secrets and transcripts

`buildReviewerPackage` compiles what the reviewer sees: the mission contract,
the change summary, and the verification evidence — **never** the raw
transcript, hidden reasoning, credentials, or streams. The reviewer judges
bounded artifacts, exactly like the Prompt-8.1 handoff discipline.

## CLI

`/reviewer` shows the entitlement, reviewer availability/independence, and the
output-visibility state; `/access` shows the credential-handle summary
(names/scopes only — see SECURITY_BOUNDARIES.md). Both print the truthful
label **"SIMULATED — external Codex not active"** in this phase.

## Truthfulness — status of each part

- **Functional now:** the entitlement policy, the output-visibility state
  machine, structural independence, the reviewer-package redaction, and the
  CLI/graphical projections. All pure and browser-safe.
- **Simulated until real Codex:** the Reviewer is a **deterministic
  simulation** in every demo — external Codex is **not active**. A real
  independent reviewer arrives with the *Real Codex Independent Reviewer
  Adapter* (the next prompt); only then does approval come from a live agent
  with its own Execution Attestation.
- **No billing this phase:** entitlements are policy inputs — there is **no
  Stripe, no billing, no paid provider call**. Verification makes no provider
  call.
- **Unavailable until persistence:** visibility state and reviewer verdicts
  are volatile.

See MISSION_CONTROL.md for placement, MODES.md for the mode separation, and
EXECUTION_ATTESTATION.md for why a reviewer approval never substitutes for a
required test.
