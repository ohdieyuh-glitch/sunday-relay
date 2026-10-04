// WONDERLAND JULIUS STREAM -- THE TRANSPORT BETWEEN THE BRIDGE AND THE WORLD.
//
// UWonderlandJuliusSubsystem is deliberately passive: "no tick, no polling, no socket -- pushed to and read from".
// Until 2026-09-27 nothing pushed to it. Every HTTP client in this module talked to the local Connect service;
// none talked to the bridge, so no real Julius state could reach the world. This is that missing half.
//
// WHAT IT DOES, AND ONLY THROUGH THE SUBSYSTEM'S OWN PUBLIC API:
//
//   AUTHENTICATE   with a NATIVE session. A signed-in player pairs this client from the website and it redeems the
//                  code (POST /relay-api/wonderland/native/session). The session is held in memory only; a bridge
//                  restart or its 8-hour expiry (founder decision 2) means pairing again. Where the token comes from is behind
//                  IWonderlandJuliusTokenSource, so a device-code flow can replace pairing without touching this.
//   HYDRATE        GET /relay-api/wonderland/julius/hydrate -> WonderlandDecodeHydrationBytes -> AdoptHydration.
//   FOLLOW         GET /relay-api/wonderland/julius/events?mode=page from the subsystem's OWN cursor
//                  (GetResumeAfterSequence) -> WonderlandDecodeDeliveryBytes -> ApplyEnvelope, page after page.
//                  mode=page, not SSE: this module's HTTP client has no first-class SSE, and a cursor read is
//                  simpler to make correct. The deliveries are identical to the stream's.
//   RECONNECT      on any failure: mark the link STALE, back off, and HYDRATE AGAIN from durable state before reading
//                  on from the cursor. It never marks a mission failed or complete, never resets it, never creates a
//                  run -- it cannot: it only calls AdoptHydration, ApplyEnvelope and SetLinkStatus, and the subsystem
//                  refuses anything that would let a dropped link produce an ending.
//
// THE RUN IS THE RUN IT WAS GIVEN. Follow() takes the exact runId Julius returned. A missionId can own several runs
// (Julius confirmed a changed contract is a new run), so a missionId is never used to choose one.
//
// NO USTRUCT, NO UENUM. Nothing here is a document that crosses the seam, so nothing here enters the
// TypeScript/C++ parity table; every type on the wire is the existing decoder's.
#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Engine/DeveloperSettings.h"
#include "Interfaces/IHttpRequest.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandEnvelope.h"
#include "WonderlandJuliusState.h"
#include "WonderlandTypes.h"
#include "WonderlandJuliusStream.generated.h"

class UWonderlandJuliusSubsystem;

/**
 * WHERE A BUILD FINDS THE BRIDGE -- founder decision 1 (2026-09-27): a PACKAGED Development build, whose Julius
 * bridge address is CONFIGURATION, never hard-coded localhost, so one build switches endpoints through approved
 * configuration rather than C++ changes.
 *
 *   [/Script/Wonderland.WonderlandJuliusLinkSettings]   in DefaultGame.ini (what the build ships), overridable per
 *   BridgeUrl=https://relay.example.invalid              deployment by the packaged build's Game.ini or by
 *                                                        -ini:Game:[/Script/Wonderland.WonderlandJuliusLinkSettings]:BridgeUrl=...
 *
 * `wl.Julius.Bridge.Url` still overrides it: a developer's switch, and a Shipping build has no console to use it.
 * Empty everywhere is honest -- the world follows nothing and says so.
 *
 * THE SESSION TRAVELS ONLY WHERE IT CANNOT BE READ ON THE WAY: https anywhere, plain http only to this machine
 * (127.0.0.1, localhost, [::1] -- the local dev bridge). A plain-http bridge elsewhere is refused and the link says
 * why, because the native session token would otherwise cross the network in the clear. The transport reads pages
 * over HTTP(S) (mode=page), so a hosted bridge needs HTTPS and nothing else -- no socket, no WSS.
 */
UCLASS(Config = Game, DefaultConfig, BlueprintType, meta = (DisplayName = "Wonderland Julius Link"))
class WONDERLAND_API UWonderlandJuliusLinkSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	/** The Relay bridge this world follows Julius runs on, e.g. https://relay.example.invalid. `wl.Julius.Bridge.Url` overrides it. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Bridge")
	FString BridgeUrl;
};

/**
 * Where the transport gets the player's identity. Pairing today; a device-code flow can implement this later and the
 * transport will not notice.
 */
class WONDERLAND_API IWonderlandJuliusTokenSource
{
public:
	virtual ~IWonderlandJuliusTokenSource() = default;
	/** The session token, or an empty string when there is none. */
	virtual FString CurrentToken() const = 0;
	/** The bridge refused the token -- expired, revoked, or the bridge restarted. Forget it. */
	virtual void Invalidate() = 0;
};

/** A native session redeemed from a pairing code. In memory only: it never reaches disk. */
class WONDERLAND_API FWonderlandPairedTokenSource final : public IWonderlandJuliusTokenSource
{
public:
	virtual FString CurrentToken() const override { return Token; }
	virtual void Invalidate() override { Token.Reset(); }
	void Adopt(const FString& InToken) { Token = InToken; }

private:
	FString Token;
};

/**
 * THE RUN'S USER RESULT, as the bridge projected it for this player -- GET /wonderland/julius/result, founder
 * decision 5: what the run made, whether each criterion was met, what is still open, why it ended, and its exact
 * cost only when this player's role may see it.
 *
 * PLAIN C++, like everything else in this file: it is read, shown and replaced -- never saved, never replicated --
 * so it is not a document that crosses the seam and has no place in the parity table. Every field is the
 * projection's own; nothing here re-derives a verdict.
 */
struct WONDERLAND_API FWonderlandJuliusResultReading
{
	/** A result has been read for RunId. */
	bool bKnown = false;
	FString RunId;
	/** Julius's own word for the run's state when this was read, verbatim. */
	FString JuliusState;
	/** The Mission Contract state it maps to, or empty where it maps to none. */
	FString TaskState;
	bool bVerified = false;
	bool bTerminal = false;
	int32 CriteriaTotal = 0;
	int32 CriteriaMet = 0;
	/** What the run MADE, by evidence id -- products, never judgements. */
	TArray<FString> DeliverableIds;
	int32 OpenFindings = 0;
	/** The latest verification decision (ACCEPT, REPAIR, HALT ...), or empty before any. */
	FString Verdict;
	int32 RepairRounds = 0;
	bool bReReviewedAfterRepair = false;
	/** Why it is not verified, when Julius named a reason; empty otherwise. */
	FString FailureReason;
	FString FailureClass;
	/** Whether this player's role may see the exact cost. When false, the cost fields below mean nothing. */
	bool bCostVisible = false;
	/** A FLOOR unless bCostComplete. */
	int64 CostKnownUsdMicros = 0;
	int32 CostUnknownComponents = 0;
	bool bCostComplete = false;
	/** "UNKNOWN" today, as the bridge says it; never a number standing in for one. */
	FString Tokens;
	/** How many texts or references the bridge withheld, redacted or cut back on the way out. */
	int32 WithheldDetails = 0;
};

/**
 * The parts with no HTTP and no UObject, so they can be reasoned about -- and checked -- on their own.
 */
namespace WonderlandJuliusStreamLogic
{
	/**
	 * A `{ "data": <result> }` body -> the reading, or false when it is not a v1 result. A body missing a field the
	 * projection always carries is refused whole rather than read as a partial result.
	 */
	WONDERLAND_API bool ParseResult(const FString& Body, FWonderlandJuliusResultReading& Out);

	/**
	 * THE BRIDGE THIS BUILD MAY TALK TO, from the cvar (a developer's override) or the project setting, trimmed and
	 * without a trailing slash -- or empty. Empty with OutProblem empty means nothing is configured; empty with a
	 * problem means something was configured and refused (a plain-http bridge off this machine, or not a URL).
	 */
	WONDERLAND_API FString ResolveBridgeUrl(const FString& CvarValue, const FString& SettingValue, FString& OutProblem);

	/** One line a player can read, e.g. "not final · 0 of 1 criteria met". Empty when unknown. */
	WONDERLAND_API FString ResultHeadline(const FWonderlandJuliusResultReading& Result);

	/** The line under it: what was made, what is open, the review, tokens, and the cost only when visible. */
	WONDERLAND_API FString ResultDetail(const FWonderlandJuliusResultReading& Result);

	/**
	 * A creation refusal in words a PLAYER can act on, from the bridge's own kind (or the client's, for a refusal
	 * made before anything was sent). An unknown kind is shown as itself rather than guessed at.
	 */
	WONDERLAND_API FString CreationRefusalSentence(const FString& Kind);

	/**
	 * The embodiment for one envelope, by the SAME recipe UWonderlandJuliusSubsystem::AdoptHydration uses for a
	 * snapshot: the envelope already carries Relay's decision (State, StateSource, SourceState, bTerminal), and the
	 * Dog's activity, motion, animation and whether it asks for a human come from the existing mapping functions.
	 * Nothing is re-decided, and the fields an envelope cannot know stay at their zero members, which read as
	 * "Relay has not said".
	 */
	WONDERLAND_API FWonderlandJuliusEmbodiment EmbodimentFromEnvelope(const FWonderlandEnvelope& Envelope);

	/**
	 * What an answer from the bridge means for the link. 401 is an identity the bridge no longer accepts
	 * (SessionExpired: pair again); 403 and 404 are a refusal of THIS player for THIS run (Refused); anything else --
	 * no connection, a 5xx, a 503 because the bridge cannot reach durable state -- is a world that cannot currently
	 * see the run (Stale). None of them is a statement about the MISSION, and none is treated as one.
	 */
	WONDERLAND_API EWonderlandLinkState LinkStateForFailure(int32 HttpStatus, bool bConnected);

	/** Seconds before the next attempt after this many consecutive failures: 1, 2, 4, 8, 16, then 30 at most. */
	WONDERLAND_API float BackoffSeconds(int32 ConsecutiveFailures);

	/** `{ "data": X }` -> X, re-serialized, or false when the body is not that shape. */
	WONDERLAND_API bool UnwrapData(const FString& Body, FString& OutData);

	/**
	 * A mode=page body -> each delivery (re-serialized, ready for WonderlandDecodeDeliveryBytes) and the ledger
	 * position to read on from. False when the body is not a page; OutNextCursor is then untouched.
	 */
	WONDERLAND_API bool SplitPage(const FString& Body, TArray<FString>& OutDeliveries, int64& OutNextCursor);
}

UCLASS()
class WONDERLAND_API UWonderlandJuliusStreamSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/*
	 * THE CONTROLS, reachable without a console. The `wl.Julius.*` commands are a developer's path; a Shipping build
	 * has no console, so a HUD entry for the pairing code calls these instead. Same behaviour either way.
	 */

	/** Redeem a pairing code for this client's native session. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Julius")
	void Pair(const FString& Code);

	/** Follow exactly this run of this project. Switching runs clears what the world held. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Julius")
	void Follow(const FString& InProjectId, const FString& InRunId);

	/** Stop following. The world keeps what it last knew and says the link is stale. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Julius")
	void Stop();

	/** The bridge this build would talk to right now, or empty -- with why, when something configured was refused. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString GetBridgeUrl() const { return BridgeUrl(); }

	/**
	 * DIAGNOSTIC (`wl.Julius.ContractFollow`): point this player's Mission Contract task for a mission at a run
	 * WITHOUT reading the run -- FollowJuliusRun only, no reset and no report -- so what the task keeps across a run
	 * change is decided by the task set's OWN rule and can be watched holding or failing on its own. The transport
	 * never shows a run it has not hydrated; the acceptance uses this to prove the rule it would otherwise mask.
	 */
	void ContractFollowOnly(const FString& MissionId, const FString& InRunId);

	/** Replace where identity comes from -- the seam a device-code flow will use. */
	void SetTokenSource(const TSharedRef<IWonderlandJuliusTokenSource>& InSource) { TokenSource = InSource; }

	/** One line for the console: what this is doing and why. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString Describe() const;

	/*
	 * READ-ONLY FACTS FOR A PROOF. Each reads the WORLD's state, not this transport's intent: the adopted run comes
	 * from UWonderlandJuliusSubsystem's own cursor, so a proof that asked to follow run X checks that the world is
	 * showing run X rather than comparing the request with itself.
	 */

	/** The run the world ADOPTED -- empty until a hydration for it was accepted. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString GetAdoptedRunId() const;

	/** The run this transport was asked to follow. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString GetFollowedRunId() const { return RunId; }

	/** Julius's own run state as the world holds it, or empty when the world's state did not come from the run row. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString GetJuliusRunState() const;

	/** The Mission Contract state for that run, by the engine's table -- or empty when it is not known. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString GetMissionContractState() const;

	/** Whether this client currently holds a native session. The token itself is never exposed. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	bool IsPaired() const { return TokenSource.IsValid() && !TokenSource->CurrentToken().IsEmpty(); }

	/**
	 * A REQUEST TO THIS BUILD'S BRIDGE, AS THIS CLIENT -- for the Project Brain link, which reads and writes the
	 * Project Brain of the project this session was paired for. Null when no usable bridge is configured or the
	 * client is not paired. The session goes on the request and nowhere else; it is never returned.
	 */
	TSharedPtr<IHttpRequest, ESPMode::ThreadSafe> NewBridgeRequest(const FString& Verb, const FString& PathAndQuery) const;

	/**
	 * The bridge refused this client's session (HTTP 401) on a request this subsystem did not make. Forget it, as the
	 * stream does, so every surface says "pair again" instead of retrying a session that cannot work.
	 */
	void NoteSessionRefused();

	/*
	 * THE RUN'S USER RESULT (founder decision 5), read after each hydration and each change of Julius's state. For
	 * surfaces and proofs; each reads the result for the run being FOLLOWED, and says nothing about any other.
	 */

	/** The result for the followed run, when one has been read. */
	const FWonderlandJuliusResultReading& GetResultReading() const { return Result; }

	/** A result has been read for the run being followed. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Result")
	bool HasResult() const { return Result.bKnown && !RunId.IsEmpty() && Result.RunId == RunId; }

	/** Julius's state when the result was read. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Result")
	FString GetResultJuliusState() const { return HasResult() ? Result.JuliusState : FString(); }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Result")
	bool IsResultVerified() const { return HasResult() && Result.bVerified; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Result")
	int32 GetResultCriteriaMet() const { return HasResult() ? Result.CriteriaMet : 0; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Result")
	int32 GetResultCriteriaTotal() const { return HasResult() ? Result.CriteriaTotal : 0; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Result")
	int32 GetResultDeliverableCount() const { return HasResult() ? Result.DeliverableIds.Num() : 0; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Result")
	int32 GetResultOpenFindingCount() const { return HasResult() ? Result.OpenFindings : 0; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Result")
	FString GetResultVerdict() const { return HasResult() ? Result.Verdict : FString(); }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Result")
	FString GetResultFailureReason() const { return HasResult() ? Result.FailureReason : FString(); }

	/** Whether THIS player's role may see the exact cost (the OWNER; an authorised ADMIN). */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Result")
	bool IsResultCostVisible() const { return HasResult() && Result.bCostVisible; }

	/** The known cost in millionths of a dollar -- a FLOOR unless complete. Zero, and meaningless, when not visible. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Result")
	int64 GetResultCostKnownUsdMicros() const { return IsResultCostVisible() ? Result.CostKnownUsdMicros : 0; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Result")
	bool IsResultCostComplete() const { return IsResultCostVisible() && Result.bCostComplete; }

	/** What the bridge said about tokens: "UNKNOWN" today. Empty before a result. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Result")
	FString GetResultTokens() const { return HasResult() ? Result.Tokens : FString(); }

	/** The result's two lines, as the terminal shows them, "\n"-joined. Empty before a result. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Result")
	FString DescribeResult() const;

	/*
	 * CREATE A MISSION FROM INSIDE WONDERLAND (founder priority 9). POST /relay-api/wonderland/julius/missions as
	 * THIS client's native session, in the project that session was PAIRED for (never a project the caller names) --
	 * the player's four fields and nothing else; the bridge composes the rest from the project's operator-written
	 * execution profile and creates the run through Julius's own path. Asynchronous. A refusal, from the bridge or
	 * from this client before anything is sent, creates nothing, follows nothing, and leaves the world as it was.
	 * On 201 the world FOLLOWS the run Julius created, so the Mission Contract, the strip and the terminal show the
	 * mission the player just made. Nothing is dispatched: the run lands READY.
	 *
	 * The criteria arrive as three parallel arrays (id, text, blocking) because a script can build those, and a
	 * criterion's fields are read-only outside C++. Mismatched lengths are refused before anything is sent.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Julius|Create")
	void CreateMission(const FString& IdempotencyKey, const FString& Objective,
		const TArray<FString>& Requirements, const TArray<FString>& Constraints,
		const TArray<FString>& CriterionIds, const TArray<FString>& CriterionTexts, const TArray<bool>& CriterionBlocking);

	/**
	 * THE PROJECT THIS CLIENT WAS PAIRED FOR, as the bridge stated it when the session was redeemed -- or empty. A
	 * mission is created in this project and no other: the scope comes from pairing, never from a parameter.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString GetPairedProjectId() const { return IsPaired() ? PairedProjectId : FString(); }

	/** How many creation answers (accepted or refused) this client has had. A surface shows each one once. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Create")
	int32 GetCreationGeneration() const { return CreationGeneration; }

	/** Why a configured bridge was refused (a plain-http bridge off this machine, or not a URL), or empty. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString GetBridgeProblem() const { return BridgeProblem(); }

	/** The last creation's HTTP status: 0 before any (or no connection), -1 while one is in flight. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Create")
	int32 GetLastCreationStatus() const { return LastCreationStatus; }

	/** The run Julius created, or empty. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Create")
	FString GetLastCreatedRunId() const { return LastCreatedRunId; }

	/** The mission id the bridge derived, or empty. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Create")
	FString GetLastCreatedMissionId() const { return LastCreatedMissionId; }

	/** Why the last creation was refused, in the bridge's own word (execution_not_configured, forbidden_field ...), or empty. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius|Create")
	FString GetLastCreationRefusal() const { return LastCreationRefusal; }

private:
	enum class EPhase : uint8
	{
		Idle,
		Hydrating,
		Following
	};

	bool Tick(float DeltaSeconds);
	void Hydrate();
	void ReadPage();
	/**
	 * READ THE RESULT when the world holds a run and Julius's state for it is not the one the last result was read
	 * at -- so once after the hydration, and once per change of state. Its own request and its own backoff: a result
	 * that cannot be read never marks the LINK stale, because the run is still being followed perfectly well.
	 */
	void TickResult();
	void RequestResult(const FString& ReadFor);
	/**
	 * THE MISSION CONTRACT, TOLD WHAT THE WORLD NOW HOLDS -- through the task set's own mutators and nothing else:
	 * FollowJuliusRun (a Julius-sourced task, by mission id), ResetJuliusCarriers after a hydration (a snapshot is a
	 * correction), then ApplySchedulerState with Julius's RAW state beside the mapped one. Tokens and evidence go as
	 * UNKNOWN: no read route serves tokens, and the world does not hold an evidence total.
	 */
	void ShowOnMissionContract(bool bAfterHydration);
	/** This player's task set, or null before there is a local player. */
	class UWonderlandMissionTaskSubsystem* MissionTasks() const;
	void Failed(int32 HttpStatus, bool bConnected, const TCHAR* During);
	void SetLink(EWonderlandLinkState State, const FString& Explanation);
	UWonderlandJuliusSubsystem* World() const;
	FString BridgeUrl() const;
	/** Why a configured bridge was refused, or empty. */
	FString BridgeProblem() const;
	FString RunQuery(int64 Cursor) const;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> NewRequest(const FString& Verb, const FString& Url) const;

	EPhase Phase = EPhase::Idle;
	FString ProjectId;
	FString RunId;
	TSharedPtr<FWonderlandPairedTokenSource> Paired;
	TSharedPtr<IWonderlandJuliusTokenSource> TokenSource;
	int32 Failures = 0;
	double NextAttemptAt = 0.0;
	bool bInFlight = false;
	int64 PagesRead = 0;
	int64 EnvelopesOffered = 0;
	/** Why the followed run is, or is not, on the Mission Contract -- for Describe(), never a failure of the follow. */
	FString ContractNote = TEXT("not yet shown");
	/** The result last read, and the "run|state" it was read for. */
	FWonderlandJuliusResultReading Result;
	FString ResultReadFor;
	bool bResultInFlight = false;
	double NextResultAt = 0.0;
	int32 ResultFailures = 0;
	/** The last creation, as the bridge answered it. */
	int32 LastCreationStatus = 0;
	FString LastCreatedRunId;
	FString LastCreatedMissionId;
	FString LastCreationRefusal;
	int32 CreationGeneration = 0;
	/** The project the bridge bound this client's session to when it was redeemed. */
	FString PairedProjectId;
	FTSTicker::FDelegateHandle Ticker;
	TArray<FHttpRequestPtr> InFlight;
};
