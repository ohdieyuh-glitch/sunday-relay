# Agent Reach — evaluation for Relay Live Reach

Written 2026-08-10 against `Panniantong/Agent-Reach` at `main`, last pushed
2026-08-06. MIT, Python, 69.7k stars, not archived. Every claim below cites a
file in that repository or in this one. Nothing here is inferred from the
README alone, because the README and the code disagree about what the project
is.

---

## 1. The finding that decides everything

**Agent Reach does not retrieve anything.**

Its own module docstring says so:

> `agent_reach/core.py` — "AgentReach — installer, doctor, and configuration
> tool. Agent Reach helps AI agents install and configure upstream platform
> tools (twitter-cli, yt-dlp, mcporter, gh CLI, etc.). **After installation,
> agents call the upstream tools directly — no wrapper layer needed.**"

And its MCP server exposes exactly one tool:

> `agent_reach/integrations/mcp_server.py` — `Tool(name="get_status", …)`,
> with the same note: "For actual reading/searching, agents should call
> upstream tools directly."

So the shape of the product is:

```
Agent Reach installs third-party CLIs and reports their health.
The AGENT then runs those CLIs itself, from SKILL.md, in a shell,
with platform cookies and tokens in its environment.
```

That execution model is the one thing the Relay direction forbids in its own
words: agents must not get direct unrestricted access to shell, browser
cookies, social sessions, platform credentials or API keys. Adopting Agent
Reach's *runtime* would mean adopting exactly the boundary violation Relay
exists to prevent.

Its *architecture*, on the other hand, contains two ideas Relay should take.

## 2. There are no write capabilities, anywhere

The repository is read and search only. Its own description: "Read & search
Twitter, Reddit, YouTube, GitHub, Bilibili, XiaoHongShu". Every channel in
`agent_reach/channels/` implements `can_handle(url)` and `check(config)` — a
URL matcher and a health probe. There is no post, reply, comment, message,
follow, like, delete or apply operation in the project.

This matters directly for the product decision that publishing and action
capabilities default enabled where the integration genuinely supports them:

> **Agent Reach supports none of them.** A Relay social action capability
> cannot be delivered "via Agent Reach", and presenting one as available on
> that basis would be a fabricated integration.

Relay may still build action capabilities — through a platform's own API, with
its own credentials and its own audit record — but that is Relay-native work
with a different provider, and it must not be attributed to this project.

## 3. What Relay should take: ordered backends with real fallback

`agent_reach/channels/base.py` is the good idea, stated plainly:

> "`backends` is an ORDERED candidate list: backends[0] is the preferred
> backend, the rest are fallbacks. 'Switching backends' for a platform means
> reordering this list (or a user override) — not rewriting code."

`TwitterChannel` declares `backends = ["twitter-cli", "OpenCLI", "bird CLI
(legacy)"]` and probes them in order, and its own comment records the defect
that shaped the rule: a two-phase scan where any `ok` beats every `warn`,
because otherwise "installed but not logged in" `twitter-cli` would mask a
fully working OpenCLI sitting behind it.

That is worth adapting, with one Relay correction the direction already
demands: **fallback is safe for reads and dangerous for writes.** Agent Reach
never had to make that distinction because it has no writes.

## 4. What Relay should take: readiness that had to actually run something

`agent_reach/probe.py` is the second good idea, and it is the same rule Relay
already holds elsewhere under a different name:

> "Distinguishes the three failure modes that look identical to
> `shutil.which()`: **missing** — not on PATH; **broken** — exists but cannot
> execute, most commonly a stale venv shebang after a system Python upgrade;
> **timeout/error** — runs but misbehaves."

And, in `base.py`: "`shutil.which()` alone is NOT proof of health — a stale
venv shim passes `which()` but cannot execute. Channels should really execute
a lightweight command before claiming a backend active."

It also carries a caveat Relay must keep: `probe_command` retries "re-run the
command verbatim with no backoff, so a non-idempotent command would repeat its
effect" — probes must be side-effect-free.

Relay's readiness taxonomy takes the same shape: installed + configured +
authenticated + reachable + capability verified = READY, and anything less
says which part is missing.

## 5. What Relay must NOT take: cookie extraction

`agent_reach/cookie_extract.py` reads live session cookies out of the local
Chrome, Firefox, Edge, Brave and Opera profiles — `auth_token` and `ct0` for
X, `SESSDATA` and `bili_jct` for Bilibili, and so on. It is careful within its
own frame: one explicitly requested platform at a time, and
`twitter_cli_child_env` passes credentials to a single child process without
mutating `os.environ`.

It is still the founder's browser session, lifted onto disk and handed to a
subprocess. In Relay that belongs nowhere near the control plane, and nowhere
near an agent's context. If a Relay source ever needs an authenticated
session, it goes through a Relay connection with its own scoped credential and
its own account identity — not by reading the founder's browser.

## 6. What Relay already does better

Agent Reach's `agent_reach/utils/url.py` is a competent SSRF guard: it rejects
non-public hosts (`localhost`, `.internal`, `.lan`, `metadata.google.internal`,
`instance-data`), parses legacy IPv4 spellings via `inet_aton` so
`http://2130706433/` cannot slip through, and rejects control characters and
backslashes.

Relay's `src/relay/mcp/policy/mcp-network-policy.ts` already covers all of that
**and two things Agent Reach does not**:

| | Agent Reach | Relay |
|---|---|---|
| URL literal validation | yes | `checkUrlPolicy` |
| Legacy IPv4 spellings | yes | `classifyIpv4` |
| IPv6 classification | partial | `classifyIpv6` |
| **Post-DNS resolved address check** | no | `checkResolvedAddresses` |
| **Redirect target re-check** | no | `checkRedirect` |
| Response content-type allowlist | no | `MCP_ACCEPTED_RESPONSE_TYPES` |

A URL that passes a literal check can still resolve to `169.254.169.254`.
Relay checks after resolution and after every redirect. **There is nothing to
adopt here**; the existing policy is the stronger one and Live Reach uses it
unchanged.

## 7. Verdict, by the direction's own five categories

| Category | What |
|---|---|
| **A. Used directly** | Nothing. The MCP server offers only `get_status`, and the retrieval path is "the agent runs a CLI", which Relay forbids. |
| **B. Wrapped** | Nothing yet. `doctor` could become a readiness signal, but only for a deployment that has already installed the Python package and the third-party CLIs — a host mutation Relay should not require of the control plane. |
| **C. Adapted** | Two patterns: **ordered backend candidates with fallback** (`channels/base.py`) and **probe-based readiness that distinguishes missing / broken / timeout / error** (`probe.py`), including the rule that probes must be side-effect-free. |
| **D. Rewritten Relay-natively** | The capability and readiness model, the provider seam, evidence normalization, permissions, requested-vs-actual backend identity, the audit record, and every retrieval implementation. |
| **E. Rejected** | The execution model (agent runs raw CLI with tokens in its environment); browser cookie extraction; the installer that mutates the host; treating `SKILL.md` shell commands as the retrieval path; and any claim of write/action support, which does not exist in the project. |

## 8. What this means for the Relay slice

Live Reach is Relay-native code that borrows two ideas and one caution from
Agent Reach. It is not a vendored dependency, and the repository is not
installed by Relay.

The honest consequence, stated before anything is built: **the sources Relay
can genuinely reach at first are the ones that need no stolen session** — the
public web and public GitHub, through Relay's existing network policy. X,
Reddit, LinkedIn, Instagram and Facebook all require either an authenticated
session or a paid API, and each will report the state it is actually in
(`AUTHENTICATION REQUIRED`, `CONFIGURATION REQUIRED`) rather than READY.

That is the difference between a capability and a claim, and it is the whole
reason for reading this repository before importing it.
