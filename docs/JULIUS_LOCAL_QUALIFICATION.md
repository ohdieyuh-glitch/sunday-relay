# Local live qualification — Mission 6 on the founder's laptop

**Launcher:** `scripts/julius-local-qualification.sh` (bash, run inside WSL).
**Drift test:** `scripts/julius-local-qualification.test.ts`.

The founder decided on 2026-09-28 that the first Claude-subscription-backed representative
qualification runs **locally**. It does not run on the GitHub-hosted workflow, and no self-hosted
runner is set up yet:

- this laptop holds the supported first-party Claude Max login;
- the hosted runner has no such login, and its workflow resolves the Coding Agent to `ANTHROPIC_API`
  and bills the Anthropic key;
- personal Claude OAuth or session credentials must never move to GitHub infrastructure.

**Nothing in this document authorises the live mission.** `run` is gated on the founder's
explicit, separate authorization and on the literal `--confirm "RUN LIVE MISSION"`.

## The same mission, launched from another place

The launcher runs the `first-live-mission` job of `.github/workflows/julius-first-live-mission.yml`
through the **same** components:

- the shared scripts (`.github/julius-live-images.sh`, `-identity`, `-workspace`, `-executor`,
  `-key-boundary`, `-receipt-boundary`, `-hermes`, `-evidence-dump`);
- the same entrypoint bundle (`dist-relay-bridge/julius-live-mission.cjs`);
- the same contract;
- the same three roles: OpenAI architect, Anthropic Coding Agent through the Claude Agent SDK,
  and xAI/Hermes reviewer.

The drift test holds the launcher's job environment equal to the workflow's. Every difference is
named, and each one is stated here:

| What | Workflow | Local | Why |
|---|---|---|---|
| Coding Agent auth | `ANTHROPIC_API` (key from secrets) | `JULIUS_CLAUDE_AUTH=CLAUDE_SUBSCRIPTION` | The subscription login lives here. Any `ANTHROPIC_*` route in the launch environment is **refused**, not dropped. |
| PostgreSQL | `127.0.0.1:5432`, db `julius` | `127.0.0.1:55432`, db `julius_qualification` | Inside WSL2, `127.0.0.1:5432` is Docker Desktop's forward to Julius's **live** store, because all WSL2 distros share one network namespace. |
| Docker | the runner's engine | this distro's own engine | Docker Desktop's `julius-postgres` IS the live store. The launcher refuses any daemon that reports itself as Docker Desktop, before any container command. |
| Provider readiness (`/v1/models`) | probed | **not run** | It contacts the providers. The launch fails fast at `run` if a key is bad. |
| Paid-slot queue, trusted verifier, main provenance, artifact markers | GitHub | commit pin, clean checkout, local attempt marker, typed confirmation | These gates have no runner to live on locally, so each is replaced by a local one that refuses the same things. |
| Privilege | runner's passwordless sudo | **the founder's own sudo, typed at launch** | No passwordless account is created or assumed. |
| Reviewer billing declaration | not set: reviewer rows read `UNKNOWN` | `RELAY_HERMES_BILLING_MODE=api_billed` | This launcher writes an xAI **API key** into Hermes's profile, so every review is API-billed. The ledger then says `API_BILLED` for the reviewer, as it does for the architect by construction. |
| Live step ceiling | job `timeout-minutes: 120` | `timeout 120m` on the live step | Same number (`JOB_BUDGET_MS`). |

Two shared scripts gained optional switches. Each defaults to CI's exact behaviour, and the
workflow sets none of them:

- `JULIUS_LIVE_PG_PORT` in `julius-live-executor.sh`;
- `HERMES_PHASE`, `HERMES_PYTHON`, `HERMES_VENV_DIR` and `HERMES_SRC_DIR` in `julius-live-hermes.sh`.

## One-time provisioning (founder commands, in the WSL `Ubuntu` terminal)

These change the WSL system, so they are the founder's to run and to approve. `provision-check`
reports each gap and names the command that closes it. It changes nothing.

1. **A checkout on the Linux filesystem.** The executor bind-mounts it and runs its
   `node_modules`, so it must be a Linux clone with a Linux `npm ci`, not the Windows worktree:

   ```bash
   git clone --no-checkout file:///mnt/c/dev/iwonder/sunday-relay ~/sunday-relay
   git -C ~/sunday-relay checkout --detach <landed commit>
   git -C ~/sunday-relay config core.autocrlf false
   ```

   A paid run requires the checkout to be clean and exactly at the `--commit` given to `run`.

2. **This distro's own Docker engine.** Docker Desktop's WSL integration must stay **off** for
   this distro.

   ```bash
   sudo apt-get install -y docker.io docker-buildx
   sudo systemctl start docker          # per session; `enable` would make it start at boot
   ```

   The shared scripts call `docker` as the invoking user, which needs the socket. This is a
   founder decision, with two options:

   - persistent: `sudo usermod -aG docker "$USER"`, then `wsl --shutdown` from Windows and reopen.
     Docker group membership is root-equivalent inside the distro.
   - per session: `sudo apt-get install -y acl && sudo setfacl -m "u:$USER:rw" /var/run/docker.sock`.
     This resets whenever the engine restarts.

3. **Node 22 and npm:** `sudo apt-get install -y nodejs npm` (Ubuntu 26.04 ships 22.22).
4. **Python 3.12 for the Hermes engine** (user-level; CI's runner python is 3.12):
   `curl -LsSf https://astral.sh/uv/install.sh | sh && uv python install 3.12`.
5. **The Claude CLI and the Max login** (user-level). Install with
   `curl -fsSL https://claude.ai/install.sh | bash`, then run `claude` and complete `/login` in
   the browser. This is the official first-party flow. **Nothing is copied from Windows.** The
   Agent SDK's own runtime reads the same login from this user's `~/.claude`.

## The sequence (all from `~/sunday-relay`, as your own WSL user)

```bash
bash scripts/julius-local-qualification.sh provision-check   # read-only
bash scripts/julius-local-qualification.sh secrets           # OPENAI_API_KEY, XAI_API_KEY: typed, hidden, stored 0600
bash scripts/julius-local-qualification.sh rig-up            # asks for your sudo once
bash scripts/julius-local-qualification.sh preflight         # no provider contacted; READY or NOT READY
# ---- STOP: the founder authorises the paid run separately ----
bash scripts/julius-local-qualification.sh run --confirm "RUN LIVE MISSION" --commit <40-hex HEAD>
bash scripts/julius-local-qualification.sh evidence
bash scripts/julius-local-qualification.sh rig-down
```

`preflight` reports each area the founder listed:

- **CLAUDE:** mode, `api_key_used=false`, plan.
- **ARCHITECT:** OpenAI credential present or missing.
- **REVIEWER:** xAI credential present or missing, and the Hermes runtime present or missing.
- **DATABASE:** reachable, which port and database, and migrations current through
  `028_julius_criteria_per_run`. They are applied to the disposable database by the repository's
  own `migrate()`.
- **MISSION:** Mission 6's tree and slice blobs equal their frozen pins.
- **EXECUTOR and BOUNDARIES:** the sandbox round trip, the key boundary and the receipt boundary.
- **CONTRACT:** the workflow's checker.
- **ROLES:** the entrypoint without `--confirm-live`. Only exit 5 means ready.
- **ACCOUNTING:** the Coding Agent's API billing basis is `NOT_APPLICABLE`; the architect and
  reviewer bill their own API accounts; the execution budget is still enforced.
- **PROVENANCE:** three distinct providers; no secret found in the logs.
- **PROVIDER DISPATCHES:** 0.

When something is blocked only by a human step, the preflight says which:

- the Claude `/login`;
- `secrets` for `OPENAI_API_KEY` or `XAI_API_KEY`.

## Things to know

- **The attempt marker is local.** It lives under `~/.julius-local/markers/<contract sha256>/` and
  is written before `--confirm-live`. A GitHub-hosted dispatch cannot see it, so after a local
  paid run of Mission 6, a hosted dispatch of the same contract would not be refused by the
  workflow's own marker gate. Record the local run before anyone dispatches the hosted workflow.
- **The identity script's stdout is discarded.** On a runner it prints `::add-mask::<value>` for
  every credential it mints, and GitHub turns those lines into masks. In a terminal they would
  simply be the secrets.
- **Run only from landed code.** The qualification ceremony runs the mission from the landed
  commit: PR #288 squash-merged first, then the follow-up. `run` refuses a dirty checkout and any
  commit but the one pinned on its command line.
- **Evidence** is written under `~/.julius-local/evidence/`. It is scanned with the workflow's own
  credential shapes and with every value the rig holds. On any hit the bundle is deleted.
