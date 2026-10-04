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
// Its own presence (connected, exploring) is reported when it connects.
#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Interfaces/IHttpRequest.h"
#include "WonderlandSocialService.h"
#include "WonderlandWorldPresence.h"

class FJsonObject;

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

	/** True once the first snapshot has arrived. Until then the surfaces show an empty, connected view. */
	bool HasSnapshot() const { return bHasSnapshot; }
	/** Read the snapshot again now. */
	void Refresh();
	/** Report this player's own presence (the client's part of the presence authority's input). */
	void ReportPresence(bool bConnected);
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

	/** QA ONLY (wl.Qa.WorldRemoval): put this service in a world, feed a world report's answer as if the server sent it, and read the
	 *  automatic-join plan it left. Never called outside the QA command. */
	struct FQaAutoJoinPlan
	{
		bool bPending = false;
		FString Target;
		FString Arg;
		double InSeconds = 0.0;
		int32 Attempts = 0;
		FString RejoinContextId;
	};
	void QaSetWorld(const FWonderlandWorldView& View, bool bWanted);
	void QaFeedWorldReport(int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem) { HandleWorldReport(Status, Data, Problem); }
	void QaClearPendingJoin() { bAutoJoinPending = false; }
	FQaAutoJoinPlan QaAutoJoinPlan() const;

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
	FWonderlandWorldView WorldView;
	FSimpleMulticastDelegate WorldChanged;
	bool bWorldWanted = false;
	bool bWorldBusy = false;
	double NextWorldAt = 0.0;
	/** Plans the next automatic join: at once the first time, then on a 2/5/15/30 s backoff until a world report is answered again. */
	void ScheduleAutoJoin(const FString& Target, const FString& Arg);
	/** Every join's number: only the LATEST join's answer moves anything (Second's review m1). */
	int32 JoinSeq = 0;
	/** The world a 404 rejoin must land back in; a FRIEND rejoin that lands elsewhere is not followed (m2). */
	FString RejoinContextId;
	/** The last world joined (target + argument): a forgotten player is put back into the SAME one. */
	FString WorldTarget = TEXT("PUBLIC");
	FString WorldArg = TEXT("golden_arrival");
	bool bAutoJoinInFlight = false;
	bool bAutoJoinPending = false;
	int32 AutoJoinAttempts = 0;
	double NextAutoJoinAt = 0.0;
	FString AutoJoinTarget;
	FString AutoJoinArg;
	TArray<TSharedRef<IHttpRequest, ESPMode::ThreadSafe>> InFlight;
	/** Callbacks hold a weak copy: a service replaced or destroyed mid-request is never called back into. */
	TSharedRef<bool> Alive = MakeShared<bool>(true);
};
