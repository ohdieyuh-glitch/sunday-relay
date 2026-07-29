# Development Contracts — what was carried across the separation, and what was not

When Sunday Relay moved out of the Alcatraz repository, a small amount of Relay
work existed only in the *working trees* of the old Alcatraz worktrees and had
never been committed anywhere. The bulk of it was preserved on
`relay/integration-worktree-state` (commit `d0d5d65`) and integrated by the
Milestones 1–5 integration PR.

This document accounts for the remainder. **Nothing is silently omitted**: each
item below is either carried into this repository, or excluded with a stated
reason. Every source worktree was read only and none was modified.

---

## 1. Environment contract — CARRIED

The Relay bridge's environment variables (`RELAY_BRIDGE_*`,
`RELAY_PROMPT_ARCHITECT_*`, `RELAY_HERMES_*`, `VITE_RELAY_*`) were documented
only in the Alcatraz repository's `.env.example`, which is Alcatraz's file and
does not belong here. A fresh clone of Relay therefore shipped `relay-bridge/`
with no environment documentation at all.

**Carried** as this repository's own [`.env.example`](../../.env.example),
rewritten Relay-first:

- every variable the bridge and the browser build actually read, verified
  against the source rather than copied verbatim;
- **example and empty values only** — no real value was copied, and no
  credential exists in the file;
- `.env` and `.env.*` remain gitignored; `.env.example` is the only tracked one;
- the `VITE_` section states plainly that those values are inlined into the
  public bundle and must never hold a secret.

One item deserves explicit attention: **`FUSION_BASE_URL`**. The bridge's
architect leg can route a brief through a running Sunday Alcatraz backend,
addressed **by URL only** — no Alcatraz code is imported, no Alcatraz secret is
read, and leaving the variable empty disables it. Governance §11 permits a typed
integration contract but not an implementation dependency, and this is on the
permitted side of that line. It is nonetheless recorded as an open item in the
integration PR so the founder can decide whether Relay should keep an
Alcatraz-shaped architect leg at all.

---

## 2. Standalone preview harnesses — EXCLUDED, obsolete

Four files existed only in the two Codex worktrees:

| File | Worktree |
| --- | --- |
| `relay-home-preview.html` | `sunday-relay-codex-home-v2` |
| `src/relay/ui/home/preview.tsx` | `sunday-relay-codex-home-v2` |
| `relay-landing-preview.html` | `sunday-relay-codex-landing` |
| `src/relay/ui/landing/preview.tsx` | `sunday-relay-codex-landing` |

**Excluded, with reason.** Each is a one-screen dev harness that mounts a
component this repository no longer has:

- `src/relay/ui/home/RelayHomePage` and `src/relay/ui/home/fixtures` do not
  exist here — that screen was superseded by `src/relay/ui/entry-home/`
  (`RelayEntryHome`), which is the screen the product actually ships.
- `src/relay/ui/landing/RelayLanding` does not exist here — the landing
  exploration was not carried into the product; Relay opens on the authenticated
  entry home, not a marketing page.

Importing them would mean re-adding two deleted component trees to satisfy two
preview shells, and both harnesses are already superseded in function by
`src/relay/ui/preview/RelayPreviewApp.tsx`, which routes the **whole** flow
(entry home → project settings → workspace → terminal → console) behind one
dev-only entry rather than one screen each.

The originals remain on disk in their worktrees and in the safety bundle
(`/tmp/sunday-relay-before-integration-stabilization.bundle`); nothing was
deleted. If either screen is ever revived, the harness is recoverable from
there.

---

## 3. Development-only boundary

The surviving preview shell is now explicitly dev-only rather than dev-only by
comment:

- `RelayPreviewApp` renders its development switcher and the `DEV PREVIEW` chip
  **only when `import.meta.env.DEV` is true**, so the production bundle contains
  neither;
- the production build mounts the same shell as the Relay application shell,
  with no development labelling;
- `src/relay/ui/preview/production-entry.test.tsx` fails if a development-only
  label reaches a production build, and equally if the development tooling
  disappears from the dev build.

Preview tooling is preserved. It simply cannot define production semantics any
more.
