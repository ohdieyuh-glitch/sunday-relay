# Which GPU provider is active

| provider | status | where |
|---|---|---|
| **Google Compute Engine** | **ACTIVE** | `gcp/wonderland-gcp.sh` |
| Vast.ai | legacy fallback — new rentals disabled | `vast/wonderland-vast.sh` |
| AWS EC2 | deferred, untouched since before Vast | `terraform/`, `wonderland.sh` |

All three take the same subcommands on purpose (`preflight`, `create`, `status`,
`start`, `stop`, `destroy`, `logs`, `ssh`, `health`), and all three draw the same
authorization boundary: read-only commands run freely, **`create` is plan-only**
and prints the command for a human to run, and lifecycle commands execute
directly because typing them is the authorization.

## What "legacy fallback" means for Vast, exactly

`vast/wonderland-vast.sh create` — renting **new** capacity — is refused unless
you opt in with `WONDERLAND_PROVIDER=vast`. That is the one action that would
quietly re-establish the provider this project has migrated off.

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
