# Live Claude Code Proof (Prompt 8)

> The optional live proof for the video. It does NOT replace
> `npm run relay:yc` (the guaranteed full simulated product demo). The live
> proof shows ONE real Claude Code coding agent working inside Relay's
> isolated-worktree boundary; the simulated cross-agent workflow (with the
> independent Codex reviewer and bounded repair) stays the central demo.
> Label them separately on camera.

## Commands

```bash
relay claude doctor                 # truthful capability + auth report (no model call)
npm run relay:claude:contract-verify  # offline adapter proof (no provider call)
npm run relay:claude:live           # the REAL Claude Code proof (explicit)
```

`npm run relay:claude:live` is NOT part of `npm test`, the Relay suite, the
full suite, any build, doctor, YC/Manual/workspace verification, or CI. It
is the ONLY command that makes a real Claude call, and only with
`--confirm-live` (approval is never inferred from a TTY).

## What the live proof does

1. Build a throwaway fixture repo under the OS temp dir (never the real
   Sunday repository): one claimed file `src/normalize.js` with a failing
   `node --test` baseline; `test/` read-only; `package.json`, `README.md`,
   `.git` protected. No dependencies, no installation.
2. Create a Relay isolated worktree from the pinned baseline; one owned
   task.
3. Compile the Claude responsibility package (claimed file, protected
   paths, tools, the Relay verification command, hard rules, report marker).
4. Show the live approval screen; proceed only on `--confirm-live`.
5. Start the real Claude Code adapter (`-p --output-format stream-json
   --safe-mode …`), stream safe normalized events, capture the session id.
6. Receive the Agent Execution Report — a claim, not proof.
7. Relay independently inspects: only the claimed file changed; zero
   protected changes; source worktree unchanged.
8. Relay — not Claude — runs `node --test test/normalize.test.js`, creating
   live EvidenceRecords.
9. Evaluate the low-risk CompletionPolicy and produce a live Final Audit.
10. Clean the fixture; confirm the source fixture is unchanged.

The audit states: **Independent reviewer: Not required by the selected
low-risk CompletionPolicy.** It never claims Codex reviewed the result.

## On-camera progression (real events, never hardcoded)

```
SUNDAY RELAY — LIVE LOCAL PROOF
[LIVE] LIVE CLAUDE CODE AGENT · ISOLATED WORKTREE · SOURCE PROTECTED
       DEPLOYMENT DISABLED · GIT PUSH PROHIBITED · DURABLE RESUME UNAVAILABLE
OBJECTIVE  Implement the missing project-name normalizer.
TASK OWNER Claude Code
CLAUDE CODE  Live session started → editing the claimed file → report received (a claim, not proof)
RELAY INSPECTION  1 claimed file changed · 0 protected files changed · source unchanged
RELAY VERIFICATION  [PASS] Tests · [PASS] File-claim · [PASS] Protected-path · [PASS] Source protection
FINAL AUDIT  Live Claude Code execution verified. Independent reviewer: not required (low-risk policy).
RELAY COMPLETE
```

A failed live run renders an honest `RELAY STOPPED SAFELY` — success is
never hardcoded.

## Running it (separate terminal)

Nested Claude-in-Claude execution is not assumed safe, so run the live
proof in its OWN terminal:

```bash
cd /home/kaisinrogodfree5/sunday-relay
npm run relay:claude:live
```

## Truthfulness

- Live Claude Code execution: live local.
- Isolated worktree, workspace inspection, Relay verification: live local.
- Independent Codex reviewer: unavailable (not claimed).
- Durable resume: unavailable.
- Provider credentials / API key: never read; API-key env stripped.
- Subscription usage: uses the existing local Claude account; any reported
  cost is provider-reported, not an invoice.
- Deployment disabled; Git push prohibited; source repository never
  modified.

## Limits

Max 2 live calls per run, at most 1 bounded repair, 6-minute runtime, bounded
output. During Prompt 8 development the live smoke is limited to 2 attempts.
