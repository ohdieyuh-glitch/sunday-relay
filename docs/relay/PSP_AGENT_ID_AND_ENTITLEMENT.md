# PSP AGENT ID AND ENTITLEMENT

How a user brings a purchased or traded PSP compound agent into their Relay
Workspace — on the website **and** in the CLI, through one shared domain.

> **Ship on Sunday's purchase and trading backend is NOT implemented.**
> There is no live marketplace, no live purchase, no live trade and no payment
> provider integration. What exists today is the typed domain, the secure
> import boundary, deterministic development fixtures, and both surfaces' UI
> and CLI states. The production entitlement service refuses every credential
> until a real backend exists. Nothing in this document should be read as
> describing live commerce.

---

## 1. Product language

The user-facing term is **PSP Agent ID**.

It behaves like an API key: possessing a valid, authorized one lets an entitled
user import a specific PSP compound agent. It is sensitive — it is never shown
after entry, never logged, never traced, and never stored in plaintext.

A user can obtain one only by:

1. **purchasing** the PSP agent,
2. receiving it through an **authorized trade or transfer**,
3. an explicit **creator or admin grant** (development/testing).

A user cannot invent an arbitrary PSP Agent ID and gain access.

---

## 2. Public identity vs. secret import credential

A PSP Agent ID is **not** one flat identifier. It carries a public part and a
secret part, and the two are never conflated.

```
PSP-AGENT-<version>-<publicPrefix>-<secret>-<checksum>
\_______ public product identity ________/ \__ import authority __/
```

| Segment | Field | Sensitivity |
|---|---|---|
| `version` | `credentialVersion` | public — also separates production from fixtures |
| `publicPrefix` | **`pspAgentId`** | **public** — safe to display, log and trace |
| `secret` | **`pspAgentImportCredential`** | **secret** — never displayed, persisted, logged or traced |
| `checksum` | — | public — typo detection only, not a forgery control |

Knowing `pspAgentId` tells you *which product* an ID refers to and nothing
about whether you may import it. A publicly visible marketplace identifier can
therefore never function as the whole bearer secret.

User-facing copy still simply says **"Enter your PSP Agent ID."**

---

## 3. Format

| Property | Value |
|---|---|
| Alphabet | Crockford Base32 — `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no `I`, `L`, `O`, `U`) |
| Public prefix | 6 characters |
| Secret | 26 characters = **130 bits of entropy** |
| Checksum | 4 characters, domain-separated SHA-256 over the normalized body |
| Case | **Upper case is canonical.** Lower case input is accepted and normalized. |
| Normalization | whitespace stripped; `I`/`L` → `1`; `O` → `0`; en/em dash → `-` |
| Mutation | validation **never mutates its input** |

Excluding `I`, `L`, `O`, `U` and applying the Crockford substitutions removes
the classic `1`/`I`/`l` and `0`/`O` transcription errors. Note the consequence:
a canonical ID never contains the letter `L`.

**Example shape only** (not a production credential):
`PSP-AGENT-1-RY8K2Z-••••••••••••••••`

### Versions

| Version | Meaning |
|---|---|
| `1` | production credential format (`PSP_AGENT_ID_PRODUCTION_VERSIONS`) |
| `0` | **reserved for development fixtures — production validation rejects it outright** |

### No production credentials are minted here

The domain owns **no randomness**: `composePspAgentId` requires caller-supplied
secret material. Nothing in this codebase can mint a production credential on a
surface that has no secure backend.

---

## 4. Storage: fingerprint, verifier, and never the credential

This mirrors the repository's existing credential architecture, where
`src/relay/mission/credential-handle.ts` never contains a credential value:
scope, expiration and revocation live in the domain; secret material does not.
The same rule is applied here to a bearer credential, with the verifier
isolated in its own record.

| Record | Contains | Never contains |
|---|---|---|
| `PSPAgentEntitlement` | business facts + `credentialFingerprint` | the credential, the verifier |
| `PSPAgentCredentialRecord` | per-entitlement `salt` + salted `verifier` | the credential |
| `PSPAgentImportRecord` | the imported agent's identity | any credential material |

- **Fingerprint** — `pspfp_` + 128 bits of a domain-separated digest. Stable and
  non-reversible. Safe for records, traces and support conversations.
- **Verifier** — `sha256(domain | salt | normalized credential)`, compared in
  **constant time**.

### Why salted SHA-256 and not an iterated KDF

The secret carries 130 bits of entropy from a uniform, machine-generated
alphabet, so it is not brute-forceable and an iterated KDF buys nothing. **This
reasoning holds only because the credential is machine-generated at full
entropy** — it must never be relaxed to accept a user-chosen secret.

`crypto.subtle` is asynchronous and `node:crypto` is unavailable to a
browser-safe shared domain, so the domain carries a pure, synchronous,
dependency-free FIPS 180-4 SHA-256 (`psp-crypto.ts`), verified against known
answers.

---

## 5. Entitlement model

```ts
type PSPAgentEntitlement = {
  entitlementId; pspAgentId; pspId; pspVersionId;
  acquisitionType: 'purchase' | 'trade' | 'transfer'
                 | 'creator_grant' | 'admin_grant' | 'development_fixture';
  status: 'issued' | 'active' | 'redeemed' | 'transferred'
        | 'revoked' | 'expired' | 'disputed';
  issuedToUserId?; currentHolderUserId?;
  issuedAt; redeemedAt?; transferredAt?; revokedAt?; expiresAt?;
  credentialVersion; credentialFingerprint;
  marketplaceTransactionId?; tradeTransactionId?;
  // one-time redemption binding + ownership history
  redeemedByUserId?; redeemedIntoWorkspaceId?; supersededByEntitlementId?;
};
```

`evaluateEntitlement` answers "is this usable right now, by this actor?" The
order is deliberate: revoked/expired/disputed/transferred/redeemed status
first, then expiry, then ownership — so an expired credential never reports as
someone else's.

Authenticity (does the secret match?) and usability (may it still be used?) are
separate questions. That separation is why a replayed credential is reported as
**ALREADY REDEEMED** — true and actionable — rather than as an unrecognized ID.

---

## 6. Redemption policy

**One-time redemption, bound to an account and a workspace.**

This is the safer of the two policies in the specification and is chosen
deliberately:

- a PSP Agent ID may be redeemed **once**;
- redemption binds the entitlement to the redeeming user and workspace and
  retires the credential;
- a replay is rejected with `PSP_AGENT_ID_ALREADY_REDEEMED`;
- an intercepted ID is useless after first use;
- unlimited anonymous sharing is impossible.

---

## 7. Purchase, trade and transfer

### Purchase

After a successful purchase the entitlement is issued, the purchaser becomes
the current holder, an import credential is created, the transaction id may be
referenced, and the raw credential remains private.

### Trade / transfer — **the credential rotates**

`transferEntitlement` does all of this atomically:

| | |
|---|---|
| Old entitlement | `status: 'transferred'`, `transferredAt`, `supersededByEntitlementId` |
| Old credential | **retired** — the old holder loses import authority immediately |
| New entitlement | issued to the new holder, `acquisitionType: 'trade' \| 'transfer'` |
| New credential | **a new secret**, with a new salt and a new verifier |
| Public identity | **stable** — `pspAgentId` names the product, not the holder |
| History | auditable through `supersededByEntitlementId` |

The same active bearer credential is **never** handed between users.

---

## 8. Import flow

Identical on both surfaces, in this order:

```
enter ID → validate FORMAT locally → verify ENTITLEMENT through the authorized
service boundary → show a SAFE preview → require CONFIRMATION → import into the
selected workspace → report the agent identity
```

### Safe preview

Shows only publishable facts: PSP agent name, creator, PSP version, included
agent roles, supported models, required permissions, required tools, review
policy, default budget policy, Relay Dog colorway, provenance, compatibility,
warnings, and **what confirming will do to the credential**.

It never shows the raw credential, another user's identity, private transaction
data, creator secrets, provider credentials, or hidden prompts.

### States

`empty` · `validating` · `valid` · `confirmation_required` · `imported` ·
`invalid` · `expired` · `revoked` · `already_redeemed` · `transferred` ·
`disputed` · `incompatible` · `service_unavailable`

`phaseForError()` is the single mapping from an error meaning to the state a
surface shows — neither surface invents its own.

### Website

`Relay Workspace → Agents → Import PSP Agent`
(`src/relay/ui/psp-import/RelayPspAgentImport.tsx`, mounted through the
workspace's optional `agentsPanel` prop).

- `type="password"` input — masked as typed, `autocomplete="off"`,
  `spellcheck="false"`;
- the typed value lives in a **ref, never in React state**, so it is never in a
  render tree or a devtools/state snapshot;
- cleared as soon as the flow ends, success or failure.

### CLI

`relay agent import` (also `relay psp-agent import`).

- interactive entry reads the ID with **terminal echo disabled** (raw mode,
  restored on every exit path including Ctrl+C and thrown errors);
- if echo cannot be suppressed the command **refuses to ask** rather than
  asking for a credential in the clear;
- non-interactive: `--stdin` (secure stdin) or `--credential-env NAME` (a
  **named** environment reference — the name, never the value);
- **a credential is never accepted as a command argument.** Passing one is
  refused with guidance, because argv lands in shell history and the process
  table. There is deliberately no `--psp-agent-id` flag;
- every emitted line passes through a final redaction gate;
- the credential is cleared from local state in a `finally` on every path.

---

## 9. Security policy

| Rule | Where it is enforced |
|---|---|
| Masked display | `maskPspAgentId` — the only renderable form |
| No raw persistence | no domain record has a credential field |
| No raw logging | redaction gate on CLI output; no `console.*` in the UI |
| No trace inclusion | `buildPspTraceEvent` refuses unsafe events |
| No capsule inclusion | the domain emits no capsule metadata |
| No analytics inclusion | the domain makes no analytics call |
| No error echo | errors are fixed strings; a credential passed as an id is dropped |
| No URL / route parameters | the flow never writes to the URL |
| No localStorage plaintext | the component touches no storage |
| No console output | asserted by spying on all five console methods |
| No clipboard copy after redemption | the imported view shows identity only |
| Constant-time comparison | `pspConstantTimeEqual` for verifier and checksum |
| Revocation / rotation / expiration | `revokeEntitlement`, `transferEntitlement`, `expiresAt` |
| Rate-limited validation | `isRateLimited` — 5 failures / 10 minutes, injected clock |
| Ownership validation | `evaluateEntitlement` |
| Workspace compatibility | `validatePspAgentImport` (Relay version + grantable permissions) |

`redactPspAgentIds()` and `containsPspAgentId()` are the last line of defence:
even if a credential reaches a string it should not have reached, it does not
survive to an output, and tests assert that.

---

## 10. Trace policy

The Aquala Trace Ledger is a completed, hash-chained domain. **This milestone
does not modify it** — no new event kinds are registered and no ledger file is
touched. `psp-trace.ts` is the typed **future adapter boundary** the PSP domain
will hand events through once trace gains an extension registry.

Safe event kinds: `psp_agent_import_requested`,
`psp_agent_entitlement_verified`, `psp_agent_import_completed`,
`psp_agent_import_rejected`, `psp_agent_entitlement_revoked`,
`psp_agent_entitlement_transferred`.

Allowed metadata: public `pspAgentId`, `pspId`, `pspVersionId`,
`entitlementFingerprint`, `transactionReference`, `importResult`,
`workspaceId`, `actorId`, `errorCode`.

Never: a raw PSP Agent ID, a raw secret segment, a plaintext access token, a
payment credential, a provider credential. `buildPspTraceEvent` returns `null`
rather than emitting an event that would carry any of these — a hard boundary,
not a best effort.

---

## 11. Errors

Twenty typed codes (`PSPAgentImportErrorCode`), each carrying a `code`, a safe
`message`, the affected **public** identifier when attributable, a safe
`nextAction`, `humanActionRequired` and `retryable`. Messages are fixed strings
from the module — never interpolated input — and a credential passed where a
public identifier belongs is **dropped, not echoed**.

---

## 12. Marketplace boundary and current limitations

| | Status |
|---|---|
| Typed entitlement + import domain | **implemented** |
| Secure import boundary | **implemented** |
| Deterministic development fixtures | **implemented** |
| Website + CLI states | **implemented** |
| Production entitlement backend | **does not exist** |
| Live purchase / trade / payment provider | **does not exist — none is called** |
| PSP dog colorway customization | **not implemented** (field surfaced only) |

`createUnavailableEntitlementService()` is the production adapter today. It
reports `production: true` and refuses every credential with
`PSP_AGENT_IMPORT_SERVICE_UNAVAILABLE`. It never fabricates ownership, never
pretends a purchase occurred and never invents an entitlement. **Replacing it
is the single integration point for the future Ship on Sunday backend.**

### Development fixtures

`psp-fixtures.ts` provides deterministic scenarios (purchased, traded, creator
grant, admin grant, expired, revoked, already redeemed, transferred, disputed,
not owned, incompatible). They are safe by construction:

- every fixture credential uses the reserved **version 0**, which production
  validation rejects outright;
- the fixture service reports `production: false`;
- the secret material is a visible repeating `DEVFXTR` pattern — free of
  realistic secret material;
- no production module imports the fixture file (asserted by test); the CLI
  reaches it only behind `RELAY_PSP_FIXTURES=1`, and the website only from the
  dev preview.

---

## 13. Tests

| Repository | Suite |
|---|---|
| Both | `src/relay/psp/psp-domain.test.ts` (35 tests — shared domain) |
| Website | `src/relay/ui/psp-import/psp-import-ui.test.tsx` (16 tests) |
| CLI | `src/relay/cli/product/psp-agent-import.test.ts` (22 tests) |

All credentials in tests are synthetic version-0 fixtures with deterministic
clocks and id factories. No real purchase, trade or customer identity is used,
and no network call exists in this domain.
