// WONDERLAND JULIUS SUBSYSTEM — WHAT THE WORLD KNOWS ABOUT A RUN.
//
// The counterpart to UWonderlandUsageSubsystem, and the two are deliberately
// separate. Usage is a REPORT: Relay projects it, pushes it already decided,
// and the client's only job is to hold the newest one. This is a STREAM: the
// client receives envelopes out of order, must decide which to apply, and
// carries a cursor that is its own state and nobody else's.
//
// Merging them would have meant one subsystem with two unrelated staleness
// rules and one delegate firing for both, so a HUD redrew whenever a mission
// state moved and a dog re-evaluated whenever a figure did.
//
// WHAT IT HOLDS:
//
//   THE CURSOR       where this client is in the stream, and what it refused on
//                    the way. Its own state — Relay cannot know it.
//   THE EMBODIMENT   which phase the run is in, and everything the reducer
//                    derived from that. Relay's, held verbatim.
//   THE ACTIVITY     what else is true: retrying, swarming, awaiting approval.
//                    A SET, not a value. See EWonderlandActivitySignal.
//
// THE ORDERING RULE IS NOT IN THIS FILE. `WonderlandOrdering.h` owns it as a
// free function, held numerically against a table generated from the real
// TypeScript, because the rule is the part that can silently diverge and a
// subsystem method could never be run against that table.
//
// A DISCONNECTION IS NEVER A COMPLETION, kept structurally. Nothing here can
// set `bTerminal`: the embodiment arrives whole, from Relay, and the only way
// the world learns a run ended is an envelope that says so. There is no path on
// which a dropped link, a gap or a reconnect produces `Complete`.
//
// NO TICK. NO POLLING. NO SOCKET. Pushed to and read from, like its sibling.

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandEnvelope.h"
#include "WonderlandJuliusState.h"
#include "WonderlandOrdering.h"
#include "WonderlandTypes.h"
#include "WonderlandJuliusSubsystem.generated.h"

/**
 * Fired after an envelope was APPLIED. Carries nothing, for the reason the
 * usage delegate carries nothing: a payload can be cached, and a listener
 * caching it would be holding state this subsystem exists to own.
 *
 * NOT fired for a refusal. A world that redrew on every duplicate the wire
 * retried would redraw constantly on a healthy stream.
 */
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FWonderlandJuliusChanged);

UCLASS()
class WONDERLAND_API UWonderlandJuliusSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/* ------------------------------------------------------------ binding */

	/**
	 * Open a cursor on one project.
	 *
	 * The Julius instance and run are LEARNED from the first envelope rather
	 * than declared here, because a world entering a project does not
	 * necessarily know which run it is about to watch — and a cursor that
	 * demanded to be told would refuse the envelope that would have told it.
	 * Once learned, a conflicting identity is refused as foreign.
	 *
	 * Binding a DIFFERENT project drops everything held. A world that switched
	 * and kept the previous run's state would animate one mission under
	 * another's name until the first envelope arrived.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Julius")
	void BindProject(const FString& ProjectId);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	bool IsBound() const { return !Cursor.ProjectId.IsEmpty(); }

	/* -------------------------------------------------------------- stream */

	/**
	 * Offer an envelope. Returns what happened to it.
	 *
	 * The embodiment and activity travel WITH the envelope rather than being
	 * derived here: `wonderland-julius-state.ts` owns the reduction, it is
	 * tested there, and a second reduction in C++ would be a second answer to
	 * "what is this run doing". This subsystem decides only WHETHER to adopt
	 * what it was handed.
	 */
	EWonderlandOrderingVerdict ApplyEnvelope(
		const FWonderlandEnvelope& Envelope,
		const FWonderlandJuliusEmbodiment& Embodiment,
		const FWonderlandActivityReading& Activity);

	/**
	 * Adopt an authoritative snapshot — `inspectRun`'s answer, after a reconnect.
	 *
	 * SETS THE REVISION AND NOT THE SEQUENCE, which is the whole subtlety. A
	 * snapshot says what is true NOW without saying which events produced it, so
	 * the world knows its state and still has a tail to replay. Marking the
	 * revision as snapshot-sourced makes a replayed event AT that revision stale
	 * — it has already been absorbed — while an event at a higher one is not.
	 */
	void AdoptSnapshot(
		const FWonderlandRunSnapshot& Snapshot,
		const FWonderlandJuliusEmbodiment& Embodiment);

	/**
	 * Adopt a whole hydration — what `GET /wonderland/julius/hydrate` answers.
	 *
	 * THE JOIN, AND THE RECONNECT, IN ONE ACT. `AdoptSnapshot` sets the run and
	 * nothing else, so a world that had just joined held a correct phase beside
	 * an EMPTY ACTIVITY: no signals, no subagent counts, no gate. A run genuinely
	 * waiting on a person drew as a calm run until the next event happened to
	 * arrive — and for a run that has stopped, for ever. The server folds the
	 * activity precisely so a rejoining client need not replay the transcript,
	 * and until now nothing applied what it folded.
	 *
	 * IT TAKES NO EMBODIMENT, unlike `AdoptSnapshot` and `ApplyEnvelope`. Both of
	 * those are handed one because their payload carries only the KERNEL's word
	 * for the state and the mapping to a drawable one is Relay's. A hydration
	 * carries `VisualState` and `bTerminal` already, so asking a caller for an
	 * embodiment would be asking it to answer a question the payload answers —
	 * and an engine-side answer would be a second authority for it.
	 *
	 * IT RETURNS A VERDICT, unlike `AdoptSnapshot`, because a JOIN is a moment a
	 * caller waits on: "may I draw this world yet?" has an answer here and only
	 * counters elsewhere. False means nothing was applied — not partly applied.
	 *
	 * The decoder has already refused a hydration that is internally
	 * inconsistent or names another project than its own parts. This refuses one
	 * that is foreign to the project THIS world is bound to, or older than what
	 * is already held; the decoder cannot know either.
	 */
	bool AdoptHydration(const FWonderlandHydration& Hydration);

	/**
	 * Tell the subsystem what the world's own link is doing.
	 *
	 * The client's fact, beside Relay's. Nothing here touches the embodiment:
	 * losing a link does not change what the run was last known to be doing, and
	 * a subsystem that blanked the state on disconnect would be turning a
	 * transport event into a mission verdict.
	 */
	void SetLinkStatus(const FWonderlandLinkStatus& Status);

	/* --------------------------------------------------------------- reads */

	/** False until an envelope has been APPLIED. Never-told is not idle. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	bool HasState() const { return bStateApplied; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	const FWonderlandJuliusEmbodiment& GetEmbodiment() const { return Embodiment; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	const FWonderlandActivityReading& GetActivity() const { return Activity; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	const FWonderlandLinkStatus& GetLinkStatus() const { return LinkStatus; }

	/**
	 * What this run is waiting for a PERSON to do. Empty until a hydration
	 * says otherwise, and empty is NOT "nobody looked" — a world that has been
	 * told nothing reports `HasState()` false, which is the different fact.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	const TArray<FWonderlandHumanGate>& GetHumanGates() const { return HumanGates; }

	/** Where this client is in the stream, and what it refused. */
	const FWonderlandCursor& GetCursor() const { return Cursor; }

	/** What to ask a replay for: everything strictly after this. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	int64 GetResumeAfterSequence() const { return Cursor.Sequence; }

	/* ------------------------------------------------------- notification */

	UPROPERTY(BlueprintAssignable, Category = "Wonderland|Julius")
	FWonderlandJuliusChanged OnJuliusChanged;

private:
	void ClearHeldState();

	FWonderlandCursor Cursor;
	FWonderlandJuliusEmbodiment Embodiment;
	FWonderlandActivityReading Activity;
	FWonderlandLinkStatus LinkStatus;
	TArray<FWonderlandHumanGate> HumanGates;
	bool bStateApplied = false;
};
