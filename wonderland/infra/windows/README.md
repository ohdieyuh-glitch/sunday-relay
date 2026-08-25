# The Wonderland Windows GPU workstation

Aura runs here because it cannot run anywhere else we have. Lightning AI is
Linux-only at the host level — its Studio image picker offers "available Ubuntu
versions" and nothing else, its machine API has no OS dimension at all, its
container registry is `linux/amd64`, and BYOC provisions *your* cloud with
*Lightning's* Ubuntu image. Aura is a Windows `.exe` installer with a prebuilt
Windows DLL engine plugin and an Electron app that must sit on the same machine
as the editor. Those two facts do not meet.

So: **Lightning keeps the Linux cook/package/capture farm** and this box runs
the interactive Unreal editor with Aura in it. GitHub is the only thing that
moves between them.

    Chromebook (browser) → Amazon DCV → EC2 Windows Server 2022 → UE 5.8 → Aura
                                              ↓ git ↑
                                    ohdieyuh-glitch/sunday-relay
                                    relay/wonderland-hd-rebuild
                                              ↓ git ↑
                                Lightning L4 Studio → cook / package / capture

## The choice, and what it cost to reject the others

| | verdict |
|---|---|
| **AWS `g6.2xlarge`, us-west-2** | chosen to start. L4 24 GB — the same GPU family already proven on this project — 8 vCPU, 32 GB, $1.35/h. Oregon measured 35–75 ms from the Chromebook; us-east is 68–97 ms and us-west-1 has no g6. |
| `g6e.2xlarge` (L40S 48 GB, 64 GB RAM, $2.61/h) | the upgrade, not the start. The first job is proving Aura runs on Windows Server with UE 5.8 at all; that needs no L40S. **The same EBS root re-types between them** — stop, change type, start. |
| Shadow PC Pro (~$60/mo flat, real Windows 11) | no API, no automation, no snapshot; a person clicks. Keep as the fallback if Windows *Server* turns out to block the Epic Launcher or Aura. |
| Azure NV / GCP L4 | comparable silicon, no free browser desktop equal to DCV, and the founder's budget already sits with AWS. |
| Lightning | impossible. See above. |

## Cost

Stopped, it is **$24/month** — the 300 GB gp3 root, which is the whole point of
stopping rather than terminating. Running: **$47/mo at 8 h/week**, **$117/mo at
20 h/week**. Forgetting it running for a day costs **$32**. Storage persists
across stop/start; the 450 GB instance-store NVMe does not (cryptographically
erased on stop) so it is scratch only.

## What is automated and what is not

`bootstrap.ps1` runs unattended as EC2 user data and installs: the NVIDIA GRID
driver (free on EC2), Amazon DCV (the browser desktop — no client install on
ChromeOS), Media Foundation (Server omits it and the editor needs it), Git,
Git LFS, VS 2022 Build Tools with the C++ workload and Windows 11 SDK, the Epic
Games Launcher, and the repository clone via a single-repo deploy key.

**Two steps cannot be automated, and both are Epic's and Aura's doing:**

1. **Epic Launcher sign-in and the UE 5.8 install.** There is no CLI and no URL
   scheme that installs an engine; the launcher's login is an embedded
   interactive browser. Legendary and Heroic handle games, not the engine.
2. **The Aura sign-in.** The installer is silent-capable but the account login
   is in-app.

Both happen in the DCV browser desktop from the Chromebook — no Windows laptop,
no local install.

## Build Tools, not the full IDE

Wonderland has one Runtime C++ module. A launcher **binary** engine ships a
precompiled UnrealBuildTool that locates the toolchain through `vswhere`, so
the VS 2022 Build Tools C++ workload is sufficient; the full IDE is only needed
for the Visual Studio Tools for Unreal experience. Epic's UE 5.8 table wants
MSVC ≥ 14.38 and Windows SDK ≥ 10.0.22621 — 17.14's 14.44 and SDK 26100 clear
both.

## Security

Inbound is TCP/UDP **8443 only, from one /32**. Port 3389 is never opened; SSM
Session Manager is the break-glass path. IMDSv2 required. GitHub access is a
**deploy key scoped to this one repository**, generated on the box, public half
added through the API from elsewhere — no account-wide token, no browser login,
revocable in one click.

## The known risk, stated plainly

Epic does not officially support the Launcher on Windows Server, and Aura's
requirements say Windows 10/11. AWS's own Cloud Game Development Toolkit builds
a Windows Server workstation with the Epic Launcher on it, and Microsoft shipped
Server-based game-dev VMs with UE preinstalled, so it works in practice — but
this is the plan's real risk. It is cheap to disprove: Aura has a two-week
trial, and the box costs about $2.70 for two hours. If Server blocks it, Shadow
PC Pro is genuine Windows 11 at a flat $60/month.

## Running it

    ./launch-workstation.sh              # plan only — creates nothing
    ./launch-workstation.sh --confirm    # creates the instance
    ./launch-workstation.sh --status     # id, state, public IP
    ./launch-workstation.sh --stop       # $24/mo storage only
    ./launch-workstation.sh --start

Then `https://<public-ip>:8443` in Chrome on the Chromebook.

The Claude ↔ Aura handoff rules live in `wonderland/GAUNTLET.md`; the Git LFS
policy is in the repository root `.gitattributes`.
