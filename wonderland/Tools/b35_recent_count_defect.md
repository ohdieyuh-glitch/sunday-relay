# B35 — open hub can keep "recent 2" after a player hides

Build `6347e19b` arms the hub gate on every open and withholds people until a read issued after the open is fresh (`MaxShownAgeSeconds` 3, resync 0.75). That part holds. The count can still be the snapshot the panel was constructed with.

## What happens

1. `UWonderlandUiSubsystem` builds `SWonderlandSocialHubPanel` from `GetSnapshot()` before `Open` becomes Social (`WonderlandUiSubsystem.cpp`, the Social branch of overlay open). That copy can still list two recent players.
2. A read that drops the hidden player broadcasts `OnChanged` only when the view digest changes (`WonderlandSocialLive.cpp`, the landed-read path). `HandleSocialChanged` returns immediately unless `Open` is already Social, so that broadcast does not call `SetSnapshot`.
3. The confirming read is digest-identical, so `OnChanged` does not fire again. `OnReadLanded` has no hub subscriber.
4. The gate ticker then calls `JudgeSocialSurfaceGate`. `MayDraw` becomes true and `SetAwaitingFresh(false)` releases the panel onto the construction snapshot. Describe still prints `| recent 2 |`.

The server already removes a hidden or blocked player at read time. The client's cached copy is what the hub paints.

## What the fix checks

Before the gate releases the hub, if the live service digest is non-empty and differs from the digest the panel last applied, the panel copies the current snapshot once. An empty service digest does not count as stale. An unchanged read does not rebuild. Withheld surfaces still draw no recent count.
