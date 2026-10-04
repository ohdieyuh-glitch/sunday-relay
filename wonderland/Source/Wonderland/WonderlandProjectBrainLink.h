// WONDERLAND -- THE PROJECT BRAIN LINK: THE EXISTING PANEL, ON THE REAL PROJECT BRAIN.
//
// The panel (SWonderlandProjectBrainPanel) and its model (UWonderlandProjectBrainSubsystem) are unchanged in shape:
// the same twenty-nine surfaces, the same access per surface, the same Propose and Accept/Decline actions. This is
// the missing half that feeds them from the bridge instead of the development preview:
//
//   READ    GET /relay-api/wonderland/brain?projectId=<paired>  -- the bridge's relay-wonderland-project-brain.v1
//           view, built from Julius's own durable rows and served only to project members, by the panel's surface
//           ids -> UWonderlandProjectBrainSubsystem::AdoptLive.
//   FOLLOW  GET /relay-api/wonderland/brain/events?...&cursor=&waitMs=20000 -- a long poll the bridge answers the
//           moment Julius or a person changes the project's Brain (LISTEN/NOTIFY on its side), never on a timer
//           here. Any event means "read the view again"; the view carries the cursor to resume from.
//   WRITE   POST /relay-api/wonderland/brain/proposals and /reviews -- the panel's own two actions. Each carries an
//           idempotency key minted once per action and REUSED on a retry, so a lost answer can never save twice.
//           The answer is shown in the bridge's own words; nothing is shown as saved before the bridge says so.
//
// THE SESSION IS THE STREAM'S. This link never holds a token: it asks UWonderlandJuliusStreamSubsystem for a request
// already carrying this client's native session, for the project that session was paired for -- never a project
// the player names. A 401 is handed back to the stream, which forgets the session and says "pair again".
//
// PLAIN C++, NO UCLASS, NO UFUNCTION, NO LOG CATEGORY. A new early FName can shift the name table under Niagara's
// type hash and crash a packaged UE 5.8 boot (RC1, 2026-10-01); this adds none. It logs to LogTemp.
#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Interfaces/IHttpRequest.h"
#include "Templates/SharedPointer.h"
#include "UObject/WeakObjectPtrTemplates.h"
#include "WonderlandProjectBrain.h"

class UGameInstance;
class UWonderlandJuliusStreamSubsystem;
class UWonderlandProjectBrainSubsystem;

/** The parts with no HTTP and no UObject, so they can be read -- and checked -- on their own. */
namespace WonderlandProjectBrainLinkLogic
{
	/** A `{ "data": <relay-wonderland-project-brain.v1> }` body -> the view, or false (and Out untouched) when it is not one. */
	WONDERLAND_API bool ParseView(const FString& Body, FWonderlandBrainLiveView& Out);

	/** A `{ "data": { "events": [...], "cursor": "..." } }` page -> how many events it carried and the cursor after them. */
	WONDERLAND_API bool ParseEventsPage(const FString& Body, int32& OutEvents, FString& OutCursor);

	/** What an answer to a write means, in a sentence a player can read: saved, or why not, in the bridge's own words. */
	WONDERLAND_API FString WriteSentence(const FString& Body, int32 HttpStatus, bool bConnected, const FString& What);

	/** Condensed JSON for a request body. */
	WONDERLAND_API bool SerializeBody(const TSharedPtr<class FJsonObject>& Object, FString& Out);

	/** Whether a failed write may be sent again with the same key: no connection, or a server that saved nothing for sure. */
	WONDERLAND_API bool WriteMayRetry(const FString& Body, int32 HttpStatus, bool bConnected);
}

class WONDERLAND_API FWonderlandProjectBrainLink : public TSharedFromThis<FWonderlandProjectBrainLink>
{
public:
	FWonderlandProjectBrainLink(UGameInstance* InGameInstance, UWonderlandProjectBrainSubsystem* InBrain);
	~FWonderlandProjectBrainLink();

	void Start();
	void Stop();

	/** The panel's Propose on a YOURS surface. True when the request was sent. */
	bool SendProposal(FName SurfaceId, const FString& Text);
	/** The panel's Accept / Decline on a REVIEW surface, naming the memory by its Project Brain reference. */
	bool SendReview(FName SurfaceId, const FString& EntryRef, bool bAccept);
	/** `/brain adopt|withdraw <n>`: SET_STATUS on a Project Brain record, naming the version the player saw (stale = 409). */
	bool SendStatus(const FString& RecordRef, int32 ExpectedVersion, const FString& Status);

	/** Read the view again now, whatever the feed says. */
	void Refresh();

	/** One line for the console: what this link is doing and why. */
	FString Describe() const;

	int32 GetViewsAdopted() const { return ViewsAdopted; }
	int32 GetWritesSaved() const { return WritesSaved; }

private:
	bool Tick(float DeltaSeconds);
	void RequestView();
	void RequestEvents();
	void SendWrite(const FString& Path, const FString& Payload, const FString& What, int32 Attempt);
	UWonderlandJuliusStreamSubsystem* Stream() const;

	TWeakObjectPtr<UGameInstance> GameInstance;
	TWeakObjectPtr<UWonderlandProjectBrainSubsystem> Brain;
	FTSTicker::FDelegateHandle Ticker;
	TArray<FHttpRequestPtr> InFlight;

	/** The project the stream's session is bound to when the view was last read. */
	FString ProjectId;
	FString Cursor;
	bool bHaveView = false;
	bool bDirty = true;
	bool bViewInFlight = false;
	bool bEventsInFlight = false;
	double NextAttemptAt = 0.0;
	int32 Failures = 0;
	int32 ViewsAdopted = 0;
	int32 WritesSaved = 0;
	FString LastProblem;
};
