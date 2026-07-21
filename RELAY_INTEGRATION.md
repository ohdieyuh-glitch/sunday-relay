# Sunday Relay — Integration Requirements

How the `feature/relay-yc-demo` branch integrates with the rest of Sunday,
and what the Alcatraz/main session (or the founder) must do at merge time.
Nothing in this document is required to *run* the Relay demo — the branch is
self-contained.

## 1. Where Relay lives

- `relay.html` (repo root) — separate Vite entry page. Dev: served
  automatically at `http://localhost:5173/relay.html` with no config. Build:
  included via the `rollupOptions.input` block in `vite.config.mts`.
- `src/relay/**` — all Relay source (domain, state, components, styles,
  tests). No file outside this directory + `relay.html` +
  the `vite.config.mts` input block belongs to Relay.

## 2. Shared-file delta (exhaustive)

| File | Change | Conflict risk |
| --- | --- | --- |
| `vite.config.mts` | additive `build.rollupOptions.input` with `main` + `relay` entries | low — only conflicts if Alcatraz also edits rollup input |

If a merge conflict appears anywhere else, it is not from this branch.

## 3. Serving in production (Vercel)

- `dist/relay.html` ships with the normal frontend build; Vercel serves it
  statically at `/relay.html` with no `vercel.json` change (static files take
  precedence over SPA rewrites).
- Optional cosmetic rewrite (`/relay` → `/relay.html`) can be added to
  `vercel.json` later — NOT done on this branch (shared file).

## 4. Mounting Relay inside the main Sunday app (post-demo, optional)

Deliberately not done on this branch — it would touch four shared files. When
the founder wants Relay as a first-class workspace screen:

1. `src/state/types.ts` — extend `Screen` union with `'relay'`.
2. `src/lazy-workspaces.tsx` — add
   `relay: () => import('@/relay/RelayApp').then(m => ({ default: m.RelayApp }))`.
3. `src/components/Sidebar.tsx` — add a Relay nav entry.
4. `src/App.tsx` — no change expected (lazy workspace path already generic).
5. Delete `relay.html` + the vite input block once the in-app mount ships,
   or keep both (the standalone page is useful for demos).

`RelayApp` is exported as a plain self-contained component with no props to
make that mount trivial.

## 5. Future backend integration (agent dispatch) — requirements only

The demo operates Relay with real agent sessions driven by a human (copy the
generated brief into Claude Code / Codex, paste the structured report back).
If/when Relay dispatches agents automatically:

- Dispatch MUST go through the Railway backend (new endpoint under
  `src/fusion-engine/api/`), never from the frontend — provider keys are
  server-side only (CLAUDE.md architecture boundary).
- The endpoint MUST sit behind the existing auth gate (`verifySupabaseUser`,
  fail-closed) and the global spend breaker (migration 0008 /
  `global-breaker.ts`) like every other paid path.
- The frontend seam is `src/relay/domain/ingest.ts`: any transport that
  yields the same fenced `relay:*` JSON artifacts (paste, file upload, or a
  backend relay-run endpoint) plugs in without domain changes.
- Reviewer identity is data, not decoration: the `reviewer` field must state
  what actually ran (e.g. "OpenAI Codex (GPT-5.6 Sol)") — the UI renders
  whatever the artifact says and never invents an agent name.

## 6. Naming / branding

- "Relay" is a reserved Sunday product name (AGENTS.md §1) — user-facing copy
  says **Sunday Relay**. No renames of Sunday / Alcatraz / Aquala / Sequence /
  Ophiuchus from this branch.
- Legacy internal identifiers ("fusion") are untouched per AGENTS.md.

## 7. Worktree discipline

- This branch is built exclusively in the `../sunday-relay` worktree.
  The Alcatraz session must NOT open this folder; Relay never edits files
  claimed by Alcatraz. Merge order does not matter given the delta in §2.
