# Which GPU provider is active

| provider | status | where |
|---|---|---|
| Google Compute Engine | **DESIGNATED — has never provisioned anything** | `gcp/wonderland-gcp.sh` |
| Vast.ai | the only provider that has ever worked; new rentals disabled | `vast/wonderland-vast.sh` |
| AWS EC2 | deferred, untouched since before Vast | `terraform/`, `wonderland.sh` |

> **Read that first row carefully.** GCP is where new work is *pointed*, not
> where anything has *run*. It has never created a VM, never booted one, never
> seen a GPU and never served a frame — the migration is stopped at Phase 3
> waiting on authentication, a project, billing and a GPU quota grant.
>
> The brief this was built from says Vast stays until GCP has **passed migration
> testing**. It has not. `gcp/gcp-migration-verify.sh` is the thing that decides
> when that sentence changes, and steps 5-11 of it have never run. Until they
> do, the honest description of GCP is *designated*, and the honest description
> of Vast is *the one that works*.

All three take the same subcommands on purpose (`preflight`, `create`, `status`,
`start`, `stop`, `destroy`, `logs`, `ssh`, `health`), and all three draw the same
authorization boundary: read-only commands run freely, **`create` is plan-only**
and prints the command for a human to run, and lifecycle commands execute
directly because typing them is the authorization.

## What "legacy fallback" means for Vast, exactly

`vast/wonderland-vast.sh create` — renting **new** capacity — is refused unless
you opt in with `WONDERLAND_PROVIDER=vast`. That is the one action that would
quietly re-establish the provider this project is migrating off.

The guard is a *direction* marker, not a verdict on which provider works. If GCP
fails its migration test, opting back in is one environment variable and is
supposed to be.

Everything else still works with no ceremony: `start`, `stop`, `destroy`,
`status`, `ssh`, `logs`, `health`. Guarding those would make the fallback
useless in the exact emergency it exists for — and instance **48078961** still
holds the built UE engine, the packaged Wonderland and the only rendered
captures of the world. See `gcp/VAST-DATA-INVENTORY.md` before touching it.

## Why the abstraction is here and not in Relay

Relay's product code contains no reference to any compute provider. The only
seam between Relay and a GPU machine is one browser env var,
`VITE_WONDERLAND_SIGNALLING_URL`. Putting a `ComputeProvider` interface inside
`src/relay/` would create a coupling that does not currently exist — so the
provider boundary lives here, at the shell, which is also where it already lived
for AWS and Vast before GCP arrived.

## Lightning AI — the current path (2026-08-19)

The founder moved GPU compute to Lightning AI Studios. `wonderland/infra/lightning/`
holds a complete runner: CPU preparation, build/cook, streaming stack, hero-frame
capture and a clean shutdown, driven by one command.

**Claude Code does not run inside Lightning.** It stays on the founder's machine;
the Studio only executes these scripts.

Status: **WRITTEN, NEVER RUN.** No Lightning Studio has executed it and no
Lightning GPU has rendered a Wonderland frame. Its offline tests pass 18/18
(syntax, storage detection, port reader, frame verifier, no-Vast-paths, no-GPU
refusal) — that is coverage of what can be checked without hardware, and it is
not the same as working.

One non-obvious constraint is recorded in its README and worth repeating here:
**A100 and H100 have no NVENC encoder**, so they are the wrong choice for Pixel
Streaming despite being the strongest cards on offer. L4 or A10G.

