# Addendum 1 to PLAN r3 and CLIENT_PACKAGE_SPEC r1 (JUDEV, 2026-10-22). Design only. r3 and spec r1 are left unedited; where they differ, THIS addendum wins. Source: REVIEWDEV message on spec r1 plus C2\INWORLD_ACCEPTANCE_PROTOCOL.md (read in full).

## A. Decisions taken (all reviewer-accepted in his message; none run)
1. U2: client lines use the prefix WLJMISSION (not WLMISSION). The prefix is pinned in j1\DESIGN.md 5.5 and in crosscheck.py as an EXACT LINE-ANCHORED match (start of the message after the UE log category). j1\DESIGN.md is a working design file, not a hashed submission: I will update it in the next DESIGN revision, not now.
2. State in every handoff: client log lines are corroboration only, because they are forgeable. The unforgeable witnesses are the video with a UTC clock, the bridge ledger timestamps, and provider console response ids.
3. U6 order, with the reviewer's addition: (i) log a "UI action" line with local UTC (the click or key, NO run id) BEFORE the mission POST is sent; (ii) mission POST; (iii) log a "run id received" line; (iv) dispatch POST. The bridge ledger must show run creation attributed to the game client's own key hash and player hash. Rule: UI-action utc < ledger run-created utc < dispatch/pre_call utc < result. This blocks a pre-created run that the game merely follows.
4. Client prints exe hash and pid at boot; the bridge writes an instance id in run_start (already requested by C3 "Binding").

## B. Where the acceptance protocol and these decisions do not yet match (for the reviewer to reconcile; I do not edit his files)
- Protocol section 0 still names the prefix WLMISSION and has one `trigger` line carrying run=<id>; with decision 3 there are two lines (UI action without run id, then run id received). C1 ("exactly one in-game trigger; its utc < first ledger pre_call") needs to say which of the two lines it uses and add the new inequality UI-action < ledger run-created.
- Protocol section 0 lists ledger events run_start / pre_call / result / final; the ledger "run-created" timestamp and the attribution to the client key hash and player hash must be a named field. J1 does not yet emit it as specified: UNVERIFIED, to be checked against wt_j1 when it is committed.
- N9 (bridge restart mid-run) accepts "refuses" as an outcome. J1 refuses a repeat (not resumable, j1 OPEN_ITEMS 8), so J1 can only satisfy the refuse branch; it must not claim recovery.
- M2 says the client must REFUSE to send while LogHttp VeryVerbose is on. Spec r1 lists a leak sweep but I have not confirmed that it specifies the refuse-to-send behaviour: UNVERIFIED, to be added to the spec if missing.
- B4/C0: rehearsal lines carry rehearsal=fake. Spec r1 uses a "REHEARSAL (fake provider)" row prefix and says log lines are stamped; format to be aligned to the protocol token `rehearsal=fake`.

## C. Still not mine to resolve
U1 (world strip/orb reaction), U4 (frozen mission record), U14 (Wonderland owner and window): the founder and a Wonderland session. Both Wonderland sessions were offline at the last check; the reviewer will not relay, so this goes to the founder in one consolidated note after the J1 route is committed.
