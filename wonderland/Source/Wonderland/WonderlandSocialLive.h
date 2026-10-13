// WONDERLAND SOCIAL — the live social service: real people, through the social routes (relay-bridge/wonderland-social-routes.ts).
//
// The surfaces cannot tell it from the preview: it is an IWonderlandSocialService. Underneath:
//   - the VIEW is the server's `snapshot.read`, made for this player by the presence authority, parsed by the same code as
//     the preview but held to the opposite rule (a live view that says it is a preview is refused);
//   - CHANGES are learned by polling `events?after=<seq>` (Unreal does not hold a stream open), and any event -- or a
//     reset -- reads the snapshot again. An event never carries content, so nothing is shown that the authority did not
//     put in a view for this player;
//   - every ACTION is a request to the server: Request() answers "pending" at once and the server's answer arrives through
//     OnAnswered, with the snapshot refreshed after it;
//   - the session is a native session (`Relay-Session <token>`) holding the `social` capability, and no Origin header is
//     ever sent.
// Its own presence (connected, exploring) is reported when it connects, and what the player is doing is reported again whenever
// it changes (R16 CF-1, FWonderlandPresenceReporter below).
#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Interfaces/IHttpRequest.h"
#include "WonderlandSocialService.h"
#include "WonderlandWorldPresence.h"

class FJsonObject;

// ---- R16 CF-1: WHAT THIS PLAYER IS DOING, reported on CHANGE (sunday-relay src/relay/social/social-presence.ts deriveActivity: the
// authority derives ONE activity from these signals, by one precedence -- a mission over creating over exploring over a party -- and
// takes "in a party" from its own party record, never from the client: social-commands.ts updateOwnPresence / readSignals). The
// client sends only what it knows. It NEVER sends inGveBattle, inPrivateServer or juliusWorking as true (founder 10-13: GVE and private
// servers are DEFERRED; WORKING WITH JULIUS is representation only), and every activity this build can only SIMULATE says so in its
// activityDetail, which the authority shows after the activity's label ("Running a mission · simulated").

/** What the client knows about its player this moment, sampled by the owner (the social subsystem) every tick. */
struct FWonderlandActivitySample
{
	/** The player's Dog moved this tick (walking, running, falling). */
	bool bMoving = false;
	/** Wonder Web's CREATION window is on screen: in this build its sample creation is SIMULATED (WonderlandWonderWebPanel.cpp:343). */
	bool bCreating = false;
	/** A mission is running: a fixture playing, or a Mission Contract manifested. */
	bool bRunningMission = false;
	/** That mission is a SIMULATION (the mission subsystem's own IsDevelopmentPreview, which asks rather than asserts). */
	bool bMissionSimulated = true;
};

/** The honest words a simulated activity carries (the activityDetail: <= 80 characters, no control character, as displayText takes it).
 *  r2 (the privacy review's F3): they say WHAT is simulated -- the CONTENT is a development-preview simulation, as the player's own screens
 *  say ("DEVELOPMENT PREVIEW · SAMPLE DATA · SIMULATED CREATION", "DEVELOPMENT PREVIEW - SIMULATED JULIUS EXECUTION") -- never that the
 *  presence is. ASCII, no comma and no middle dot: the log token (Describe) is comma-separated. */
namespace WonderlandPresenceDetail
{
	inline const TCHAR* SimulatedCreation() { return TEXT("simulated sample (development preview)"); }
	inline const TCHAR* SimulatedMission() { return TEXT("simulated (development preview)"); }
}

/** The signals one presence.update_self carries. Empty Detail is sent as null: it CLEARS a detail left by an earlier activity. */
struct FWonderlandPresenceSignals
{
	bool bExploring = false;
	/** Sent as creating "SOFTWARE" (Wonder Web is where a player builds and runs software), else null. */
	bool bCreating = false;
	bool bRunningMission = false;
	FString Detail;

	bool operator==(const FWonderlandPresenceSignals& Other) const
	{
		return bExploring == Other.bExploring && bCreating == Other.bCreating && bRunningMission == Other.bRunningMission
			&& Detail.Equals(Other.Detail, ESearchCase::CaseSensitive);
	}
	bool operator!=(const FWonderlandPresenceSignals& Other) const { return !(*this == Other); }
	/** One token, no spaces, for the log ("exploring=0,creating=SOFTWARE,runningMission=0,detail=simulated_sample_(development_preview)"). */
	FString Describe() const
	{
		return FString::Printf(TEXT("exploring=%d,creating=%s,runningMission=%d,detail=%s"), bExploring ? 1 : 0, bCreating ? TEXT("SOFTWARE") : TEXT("null"),
			bRunningMission ? 1 : 0, Detail.IsEmpty() ? TEXT("null") : *Detail.Replace(TEXT(" "), TEXT("_")));
	}
};

/** presence.update_self's body: connected, the signals (the three the client never claims set false), and the detail (null when empty). */
WONDERLAND_API TSharedRef<FJsonObject> WonderlandPresenceBody(bool bConnected, const FWonderlandPresenceSignals& Signals);

/**
 * THE SNAPSHOT LINE, logged once per view read. R16 CF-4 (B11): the Recent Players count is said too -- the client reads Recent inside
 * snapshot.read, so this line is where "the recent list was answered" shows. APPENDED as " | recent <n>" after the party, so a reader of
 * the earlier form ("…, <n> conversations, party <name>") still matches; a party name is a player's text, so a reader takes the LAST
 * " | recent ".
 */
WONDERLAND_API FString WonderlandSocialSnapshotLine(const FWonderlandSocialSnapshot& View);

/**
 * WHEN THE CLIENT REPORTS AGAIN: a pure, clock-driven decision (no I/O; wl.Qa.SocialR16Client drives it with a fake clock).
 *   - exploring = the Dog moved within ExploringHoldSeconds (a pause to look around is still exploring; standing at a surface is not);
 *   - a report is due when what is wanted, or the player's party, differs from what the server last ACCEPTED -- the party because the
 *     authority re-derives "in a party" only when signals are reported (social-commands.ts:235);
 *   - never while one is in flight, never sooner than MinGapSeconds after the last one, and after a refusal not before RetrySeconds (or a
 *     429's Retry-After); a LOST answer (no answer, a 5xx) re-sends the current state after that wait. Worst case ~20 a minute: a third of the write budget's steady rate (wonderland-social-routes.ts SOCIAL_BUDGETS.write,
 *     a burst of 60 then one a second), which every other write shares.
 */
class WONDERLAND_API FWonderlandPresenceReporter
{
public:
	static constexpr double ExploringHoldSeconds = 8.0;
	static constexpr double MinGapSeconds = 3.0;
	static constexpr double RetrySeconds = 6.0;

	explicit FWonderlandPresenceReporter(double InStartedAt = 0.0) : LastMovedAt(InStartedAt) {}

	/** What this sample means now. The detail follows the activity the authority's precedence will show (a mission over creating). */
	FWonderlandPresenceSignals Want(const FWonderlandActivitySample& Sample, double Now);
	bool IsDue(const FWonderlandPresenceSignals& Wanted, const FString& PartyKey, double Now) const;
	void NoteSent(const FWonderlandPresenceSignals& Sent, const FString& PartyKey, double Now);
	/** The server's answer to the report in flight. RetryAfterSeconds: a 429's, else 0. bOutcomeUnknown (r2, the correctness review's F3):
	 *  no answer, or a 5xx -- the report may have been APPLIED, so what the server holds is unknown and the current state is sent again
	 *  after the retry wait, changed or not (a lost answer must not leave a stale activity shown to friends). A refusal the server
	 *  answered (4xx) changed nothing there: only a change is sent. */
	void NoteAnswered(bool bAccepted, int32 RetryAfterSeconds, double Now, bool bOutcomeUnknown = false);

	bool IsInFlight() const { return bInFlight; }
	bool HasAccepted() const { return bHasAccepted; }
	const FWonderlandPresenceSignals& GetAccepted() const { return Accepted; }
	double GetNotBefore() const { return NotBefore; }

private:
	double LastMovedAt = 0.0;
	bool bInFlight = false;
	FWonderlandPresenceSignals InFlightSignals;
	FString InFlightParty;
	bool bHasAccepted = false;
	FWonderlandPresenceSignals Accepted;
	FString AcceptedParty;
	double NotBefore = 0.0;
};

class WONDERLAND_API FWonderlandSocialLiveService final : public IWonderlandSocialService
{
public:
	/** BaseUrl: the bridge (or the dev social server), e.g. "http://127.0.0.1:8796". Token: a native session's. */
	FWonderlandSocialLiveService(const FString& InBaseUrl, const FString& InToken);
	virtual ~FWonderlandSocialLiveService() override;

	virtual const FWonderlandSocialSnapshot& GetSnapshot() const override { return Snapshot; }
	virtual FString GetSourceLine() const override;
	virtual bool IsDevelopmentPreview() const override { return false; }
	virtual FString GetLastError() const override { return LastError; }
	virtual FWonderlandSocialActionResult Request(const FString& OperationId, const FString& SubjectId) override;
	virtual FWonderlandSocialActionResult SendMessage(const FString& ConversationId, const FString& Body) override;
	// LFF, THE LOOKING FOR FEED (the lff.* rows): ids only in a path, filters percent-encoded (WonderlandLffFeedPath), bodies as the
	// routes take them; answers parsed strictly. Logged by operation, id and status -- never a title, a description, a label or a note.
	virtual void ReadLffFeed(const FWonderlandLffFeedQuery& Query, FWonderlandLffFeedDone Done) override;
	virtual void ReadLffPost(const FString& PostId, FWonderlandLffPostDone Done) override;
	virtual void ReadLffPostRequests(const FString& PostId, FWonderlandLffPostRequestsDone Done) override;
	virtual void ReadLffMyRequests(FWonderlandLffMyRequestsDone Done) override;
	virtual void CreateLffPost(const FWonderlandLffPostFields& Fields, FWonderlandLffWriteDone Done) override;
	virtual void EditLffPost(const FString& PostId, const FWonderlandLffPostFields& Fields, FWonderlandLffWriteDone Done) override;
	virtual void SendLffRequest(const FString& PostId, const FString& Message, FWonderlandLffWriteDone Done) override;
	virtual void ActOnLff(const FString& OperationId, const FString& SubjectId, FWonderlandLffWriteDone Done) override;
	virtual void ReportLffPost(const FString& AuthorId, const FString& PostId, FWonderlandLffWriteDone Done) override;
	virtual void ReadProfile(const FString& UserId, FWonderlandLffProfileDone Done) override;

	/** True once the first snapshot has arrived. Until then the surfaces show an empty, connected view. */
	bool HasSnapshot() const { return bHasSnapshot; }
	/** Read the snapshot again now. */
	void Refresh();
	/** Report this player's own presence (the client's part of the presence authority's input): connected (and exploring, as on arrival),
	 *  or leaving. What the player is DOING after that is reported on change from the activity source (SetActivitySource). */
	void ReportPresence(bool bConnected);
	/** R16 CF-1: what the player is doing, asked every tick (false: nothing to read this tick, nothing changes). */
	void SetActivitySource(TFunction<bool(FWonderlandActivitySample&)> Source) { ActivitySource = MoveTemp(Source); }
	const FWonderlandPresenceReporter& GetPresenceReporter() const { return PresenceReporter; }
	/** For QA and the log: "live http://… as usr_kai | events 12 | snapshot 3 s old | last error …". */
	FString Describe() const;
	/** The server refused the session (HTTP 401), once: it expired, was revoked, or the bridge restarted. Polling stops. */
	FSimpleMulticastDelegate& OnSessionEnded() { return SessionEndedEvent; }
	bool HasSessionEnded() const { return bSessionEnded; }

	// ---- MULTIPLAYER PHASE 1: the shared presence layer
	/** Where this player's own representation is, asked each report (false: nothing to report this tick). */
	void SetAvatarSource(TFunction<bool(FWonderlandAvatarReport&)> Source) { AvatarSource = MoveTemp(Source); }
	/** Join a world context: PUBLIC (Arg = place id), PRIVATE (Arg = name), FRIEND (Arg = user id), INVITE (Arg = invite
	 *  id), PARTY. The answer arrives through OnAnswered ("world.join"); the view through OnWorldChanged. */
	FWonderlandSocialActionResult JoinWorld(const FString& Target, const FString& Arg);
	/** The same join, made by the client ITSELF when bAutomatic (the sign-in's public world, a removal, a forgotten world): it answers as
	 *  "world.join.auto", which no screen shows, and a refusal is retried on a backoff (Second's reviews of 4d31c524 / 804b528d / aabfb10c). */
	FWonderlandSocialActionResult JoinWorldAs(const FString& Target, const FString& Arg, bool bAutomatic);
	FWonderlandSocialActionResult LeaveWorld();
	FWonderlandSocialActionResult InviteToWorld(const FString& UserId);
	const FWonderlandWorldView& GetWorldView() const { return WorldView; }

	/** R16 VOICE: ask the authority for this party's voice room (POST /parties/:id/voice/join) for this player's EOS ProductUserId.
	 *  Done(status, the grant {providerId, roomId, participantToken, audience}, problem) on the game thread. */
	void JoinVoice(const FString& PartyId, const FString& EosProductUserId,
		TFunction<void(int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)> Done);
	/** R16 SHIPPED VOICE (founder 10-04: "the backend hands it out"): GET /voice/eos-client-config for this signed-in session -- the EOS
	 *  GAME-client config, {schema "wonderland-eos-client-config.v1", productId, sandboxId, deploymentId, clientId, clientSecret} inside
	 *  the usual {data}. The caller holds it in memory only: never logged, never persisted. 503 = the server has no voice. */
	void GetEosClientConfig(TFunction<void(int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)> Done);
	FSimpleMulticastDelegate& OnWorldChanged() { return WorldChanged; }

	/** QA ONLY (wl.Qa.WorldRemoval): put this service in a world, feed a world report's or a join's answer as if the server sent it, and
	 *  read the automatic-join plan it left. Never called outside the QA command. */
	struct FQaAutoJoinPlan
	{
		bool bPending = false;
		FString Target;
		FString Arg;
		double InSeconds = 0.0;
		int32 Attempts = 0;
		FString RejoinContextId;
		bool bJoinInFlight = false;
	};
	void QaSetWorld(const FWonderlandWorldView& View, bool bWanted);
	void QaFeedWorldReport(int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem) { HandleWorldReport(Status, Data, Problem); }
	void QaClearPendingJoin() { bAutoJoinPending = false; }
	/** QA ONLY (wl.Qa.SocialReach): feed one answer's transport outcome as Call would. */
	void QaNoteTransport(int32 Status, bool bReached) { NoteTransport(Status, bReached); }
	/** The server could not be reached on the last two answers in a row (GetSourceLine says OFFLINE). */
	bool IsUnreachable() const { return bUnreachable; }
	/** The state a join puts the service in before its request leaves (the same BeginJoin a real join runs), with no request sent. */
	int32 QaBeginJoin() { return BeginJoin(); }
	void QaFeedJoinAnswer(int32 Seq, const FString& Target, const FString& Arg, bool bAutomatic, const TSharedPtr<FJsonObject>& Data, const FString& Problem)
	{
		HandleJoinAnswer(Seq, Target, Arg, bAutomatic, Data, Problem);
	}
	FQaAutoJoinPlan QaAutoJoinPlan() const;
	/** QA ONLY (wl.Qa.SocialR16Client): hold this view as if the server had sent it (messages.read reads its sequences from it). */
	void QaSetSnapshot(const FWonderlandSocialSnapshot& View) { Snapshot = View; bHasSnapshot = true; }
	/** QA ONLY: how many "WLWORLD population" lines this service logged, and the last one. */
	int32 QaPopulationLines() const { return PopulationLineCount; }
	const FString& QaLastPopulationLine() const { return LastPopulationLine; }

private:
	bool Tick(float DeltaSeconds);
	void PollEvents();
	bool bSessionEnded = false;
	FSimpleMulticastDelegate SessionEndedEvent;
	/** One call to the social routes. Done(status, data object or null, problem text) runs on the game thread. */
	void Call(const FString& Verb, const FString& Path, const TSharedPtr<FJsonObject>& Body,
		TFunction<void(int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)> Done);
	/** An action's call, its answer broadcast, and the view read again after it. */
	FWonderlandSocialActionResult Ask(const FString& OperationId, const FString& SubjectId, const FString& Verb, const FString& Path,
		const TSharedPtr<FJsonObject>& Body);
	/** An LFF call: Call's answer as an FWonderlandLffAnswer (a 429's Retry-After included) with the answer's data, logged without content. */
	void CallLff(const FString& OperationId, const FString& SubjectId, const FString& Verb, const FString& Path, const TSharedPtr<FJsonObject>& Body,
		TFunction<void(const FWonderlandLffAnswer& Answer, const TSharedPtr<FJsonObject>& Data)> Done);
	/** A write's call: its answer and, for a create, the new id read from the answer's data (IdField). */
	void WriteLff(const FString& OperationId, const FString& SubjectId, const FString& Path, const TSharedPtr<FJsonObject>& Body, const TCHAR* IdField,
		FWonderlandLffWriteDone Done);
	/** The last answer's Retry-After (a 429's), set by Call just before its Done runs; 0 for every other answer. */
	int32 LastRetryAfterSeconds = 0;
	/**
	 * CAN THE SERVER BE REACHED (Second's review of e48a5b3e, MAJOR for R9/R7: an outage left "LIVE · signed in" over a frozen view). Every
	 * answer passes here from Call: no connection, status 0 or a 5xx is a TRANSPORT failure; anything the server answered (2xx, 4xx, a 401)
	 * means it was reached. Two failures in a row = unreachable; one reached answer = reachable again. Each change is broadcast once.
	 */
	void NoteTransport(int32 Status, bool bReached);
	int32 TransportFailures = 0;
	bool bUnreachable = false;

	FString BaseUrl;
	FString Token;
	FWonderlandSocialSnapshot Snapshot;
	bool bHasSnapshot = false;
	double SnapshotAt = 0.0;
	FString LastError;
	int64 LatestEvent = 0;
	int32 EventsSeen = 0;
	double NextPollAt = 0.0;
	/** The next periodic re-read of the view (changes this viewer is never told about, such as a block of them). */
	double NextResyncAt = 0.0;
	bool bPolling = false;
	bool bRefreshing = false;
	bool bRefreshAgain = false;
	FTSTicker::FDelegateHandle TickerHandle;
	void TickWorld();
	/** A world report's answer: a 404 rejoins quietly, any other refusal stays, a private server's no-context ok is a removal. */
	void HandleWorldReport(int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem);
	TFunction<bool(FWonderlandAvatarReport&)> AvatarSource;
	/** R16 CF-1: sample the activity, and report it when the reporter says it is due. */
	void TickActivity();
	/** One presence.update_self: the reporter is told it left, and told the answer. Logged by its signals, never by anything a player wrote. */
	void SendPresence(bool bConnected, const FWonderlandPresenceSignals& Signals, const FString& PartyKey);
	TFunction<bool(FWonderlandActivitySample&)> ActivitySource;
	FWonderlandPresenceReporter PresenceReporter;
	/** The last presence refusal said in the log (each new reason is said once; a success clears it). */
	FString PresenceProblem;
	/** R16 CF-4: "WLWORLD population <n> in <context> (<name>)" each time the population this viewer is shown changes (or a world is
	 *  entered); not in a world, the next one is said again. Called wherever the world view changes (before each OnWorldChanged). */
	void NotePopulation();
	int32 LoggedPopulation = -1;
	FString LoggedPopulationContext;
	FString LastPopulationLine;
	int32 PopulationLineCount = 0;
	FWonderlandWorldView WorldView;
	FSimpleMulticastDelegate WorldChanged;
	bool bWorldWanted = false;
	bool bWorldBusy = false;
	double NextWorldAt = 0.0;
	/** Plans the next automatic join: at once the first time, then on a 2/5/15/30 s backoff until a world report is answered again.
	 *  bNow: at once and no backoff step -- a planned move that is not a failure (a FRIEND rejoin that landed elsewhere). */
	void ScheduleAutoJoin(const FString& Target, const FString& Arg, bool bNow = false);
	/** A join leaving (automatic or the player's own): it owns the in-flight flag, ends any planned retry, and takes the next number. */
	int32 BeginJoin();
	/** A join's answer: only the LATEST join's moves anything; extracted from JoinWorldAs's callback so the QA can feed it. */
	void HandleJoinAnswer(int32 Seq, const FString& Target, const FString& Arg, bool bAutomatic, const TSharedPtr<FJsonObject>& Data, const FString& Problem);
	/** Every join's number: only the LATEST join's answer moves anything (Second's review m1). */
	int32 JoinSeq = 0;
	/** The world a 404 rejoin must land back in; a FRIEND rejoin that lands elsewhere is not followed (m2). */
	FString RejoinContextId;
	/** The last world joined (target + argument): a forgotten player is put back into the SAME one. */
	FString WorldTarget = TEXT("PUBLIC");
	FString WorldArg = TEXT("golden_arrival");
	/** ANY join in flight, automatic or the player's own (Second's review of b7740150, minor 3): while one is, no automatic join is
	 *  planned from a 404 and no planned one leaves -- that join's answer decides where the player is. */
	bool bJoinInFlight = false;
	bool bAutoJoinPending = false;
	int32 AutoJoinAttempts = 0;
	double NextAutoJoinAt = 0.0;
	FString AutoJoinTarget;
	FString AutoJoinArg;
	TArray<TSharedRef<IHttpRequest, ESPMode::ThreadSafe>> InFlight;
	/** Callbacks hold a weak copy: a service replaced or destroyed mid-request is never called back into. */
	TSharedRef<bool> Alive = MakeShared<bool>(true);
};
