# Wonderland QA event line

One JSON object per event. The log message is that object and nothing else (`LogTemp`, Display). A category prefix the engine adds in front of the message is not part of the object. Another branch can parse the same object.

## Keys, in this order

1. `ts_utc_ms` — UTC epoch milliseconds. Not time since launch.
2. `client_role` — `sender` on the pawn's own client, `observer` on a client drawing someone else.
3. `net_id` — `local` for this client's pawn. An observer uses the other player's id. Empty is JSON `null`, never `""`.
4. `build_sha` — JSON `null` until a build stamps one. Never `""`.
5. `corr_id` — JSON `null` when the event has no correlation id. Never `""`.
6. `event` — one of the names below.
7. Event fields, after those six.

Numbers are finite decimals. A missing number is JSON `null`. A real zero stays `0`. A ground trace that misses sets `ground_hit` to `false` and `ground_distance` to `null`.

## Events

| `event` | When |
|---|---|
| `activation_started` | The presentation enters Acknowledged. Fields: `anim_asset` `handoff_twin_swords`, `vfx_asset` `WonderlandHandoffTransform`. |
| `activation_ended` | The presentation enters Idle after a start was recorded for that corr. Same asset fields. |
| `movement_sample` | One sample per pawn, at most 10 Hz (100 ms). Fields: `x`, `y`, `z`, `vx`, `vy`, `vz`, `ground_hit`, `ground_distance`, `hover`. |
| `disconnect` | `wl.Qa.Net.Drop` recorded a local drop. |
| `reconnect_attempt` | Same command, immediately after `disconnect`. |
| `reconnected` | Same command, after the requested gap (immediately when the gap is 0). |
| `state_restored` | Same command, after `reconnected`. |

`state_restored` is a snapshot this client already had. `restored_by` is `local_snapshot`. `server_restored` is `false`. It does not mean the server resumed the session. The line also carries `session_id` (`null` when unknown), `session_source` (`world_context`, `viewer`, or `none`), pose (`x`, `y`, `z`, `yaw`, `null` when no pawn), `activation_phase` (`null` when the handoff object is absent), `activation_corr`, and the three reconnect-policy readings `rejoin_404_replan`, `rejoin_keep_target`, `leave_retry`. A reading that is not registered is `null`, not `0`. `leave_retry_would_apply` is `WonderlandSocialReconnectPolicy::ShouldRetryLeave(0, false, leave_retry)` and is only a recorded fact. The command does not send a leave retry and does not replace that policy.

## Correlation

The sender mints `local1`, `local2`, … when its own handoff enters Acknowledged while QA is on. Observers copy a corr from the world view when one is present: `e{epoch}n{n}` if both `epoch` and `n` are on the event, otherwise `seq{seq}` if `seq` is present, otherwise `null`. Those two clients share a corr only when the view echoes `epoch` and `n`. This client does not add a field to the report. A view that omits the event leaves the last stored corr in place.

A duplicate observer start with the same corr is ignored. An end for a corr that never started does not emit a start. Entering Held, including a restored Held, does not emit a start. A late joiner still sees the sustained pose the existing handoff track already draws; that settle is not a start event.

The first movement sample has `vx`, `vy`, and `vz` `null`. The next sample uses the position change over the sample clock. A gap produces one sample, not a burst. A clock that moves backwards does not sample and does not move the sample clock. Samples are taken only while QA is on, so a disabled stretch does not advance the clock.

`hover` is the local armed hold, or a remote handoff track that is not idle. `ground_distance` is the pawn-channel trace distance from the actor origin 20000 units straight down, ignoring the actor itself. The sample does not move the actor.

## Commands

Shipping builds do not register these.

- `wl.Qa.Enabled` — no argument prints `QA instrumentation on` or `off` and changes nothing. `1` turns it on. `0` turns it off. While it is off, the other two commands print `QA instrumentation is off` and do not emit a JSON event.
- `wl.Qa.Mission.Handoff` — no argument calls `WonderlandHandoffDirector::Equip`. `end` calls `Return`. Same presentation as `wl.Handoff.Equip` / `wl.Handoff.Return`. It does not dispatch a Julius mission.
- `wl.Qa.Net.Drop [seconds]` — records the four reconnect events above. The gap defaults to 2 seconds and is clamped to 0–30. Zero emits all four immediately. The gap is a ticker delay, not a sleep of the game thread, and not a new session state machine.

Turning QA on also turns handoff replication on for this process. Turning QA off turns that replication back off. The default of the replication switch stays 0.

## Scored runs

A scored run must not run `wl.Qa.Enabled`, and must leave `wl.Handoff.Replicate` at 0. Extra `wl.*` lines in a scored control log void the run. The whitelist outside this QA session stays `wl.Remote.InterpEaseZ`, `ReportTimeSamples`, `RttClock`, and `wl.Remote.LogPeriod=0.1`.
