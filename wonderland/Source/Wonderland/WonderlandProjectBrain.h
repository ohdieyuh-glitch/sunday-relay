// WONDERLAND — PROJECT BRAIN, AS THE WORLD SHOWS IT TO ITS OWNER.
//
// THE HIERARCHY THIS SURFACE SERVES (founder roadmap, 2026-09-15): Project Brain is the durable mission and
// project memory; Julius acts and decides; Python computes; GVE proves, later. Wonderland is the embodied
// interface to all of it and the record of none of it.
//
// THE WORLD IS NOT THE RECORD, and that is already a boundary in code, not a preference. What this subsystem holds
// is a PRESENTATION MODEL: which surfaces exist, who may change each one, what each holds, and the brain revision.
//
// LIVE, WHEN PAIRED (founder directive, 2026-10-01). The owner-scoped read the paragraph above used to wait for
// now exists: the bridge's /relay-api/wonderland/brain serves a project's Project Brain to that project's MEMBERS
// only (not found and not yours look the same), by the panel's own surface ids, and UWonderlandProjectBrainLinkSubsystem
// adopts it here with AdoptLive. Every line then comes from Julius's durable store -- an empty surface is empty --
// and a proposal or review is SENT to Project Brain, saved there, and shown only once the bridge says so. Unpaired,
// the labelled development preview remains, exactly as before.
//
// WHO MAY CHANGE WHAT, which is the point of the surface. Every surface carries one access:
//
//   YOURS    the owner authored it and may add to it: facts, preferences, identity, instructions, workflows,
//            scratchpads, shared context, requirements, constraints.
//   REVIEW   Project Brain proposed it; the owner accepts or declines, and does not rewrite it.
//   SYSTEM   Julius and Project Brain own it: history, handoffs, agent state, accepted decisions, evidence,
//            evaluations, trace, governance. Shown, never offered for editing.
//
// EDITS ARE PROPOSALS. In the preview, a line added in the world is recorded in this session as PROPOSED and NOT
// SAVED (it is gone after a restart), and says so. Live, the same action is a proposal to Project Brain itself: the
// bridge records it with this player as its author and this client as its deliverer, and Julius reads it as a
// person's statement -- never as a term of the contract until an owner adopts it.
//
// PLAIN TYPES ON PURPOSE: none of this crosses to Relay, so none of it belongs in the C++ <-> TypeScript
// parity table.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandProjectBrain.generated.h"

class FWonderlandProjectBrainLink;

enum class EWonderlandBrainAccess : uint8
{
	Yours,
	Review,
	System
};

enum class EWonderlandBrainGroup : uint8
{
	SemanticMemory,
	EpisodicMemory,
	ProceduralMemory,
	Systems,
	Components,
	Mission
};

struct FWonderlandBrainSurface
{
	FName Id;
	FString Title;
	EWonderlandBrainGroup Group = EWonderlandBrainGroup::SemanticMemory;
	EWonderlandBrainAccess Access = EWonderlandBrainAccess::System;
	/** One sentence: what this surface is, in the owner's terms. */
	FString Purpose;
	/** Entries Project Brain reports. Always shown; it is the one thing a live world may know. */
	int32 EntryCount = 0;
	/** The entry lines: sample lines in the preview, Project Brain's own lines when live. */
	TArray<FString> SampleLines;
	/** Preview: lines the owner added in this session, not saved. Live: proposals Project Brain holds, saved. */
	TArray<FString> Proposals;
	/** Preview only: review decisions made in this session, as "Accepted: ..." or "Declined: ...", not saved. */
	TArray<FString> Reviews;
	/** Live only: the Project Brain reference of each entry line, index for index -- what a review names. */
	TArray<FString> EntryRefs;
};

/** One line of a live surface, as the bridge sent it. */
struct FWonderlandBrainLiveEntry
{
	FString Ref;
	FString Line;
	FString Status;
	/** ACCEPTED, DECLINED, or empty when no person has reviewed it. */
	FString Review;
};

/** One surface of the live view, by the panel's own id. */
struct FWonderlandBrainLiveSurface
{
	FName Id;
	int32 EntryCount = 0;
	TArray<FWonderlandBrainLiveEntry> Entries;
	TArray<FWonderlandBrainLiveEntry> Proposals;
};

/** The bridge's relay-wonderland-project-brain.v1 view, decoded. Nothing in it is invented on this side. */
struct FWonderlandBrainLiveView
{
	FString ProjectId;
	FString Cursor;
	int32 BrainRevision = 0;
	FString MissionTitle;
	FString SourceLine;
	TArray<FWonderlandBrainLiveSurface> Surfaces;
};

struct FWonderlandBrainModel
{
	FString ProjectName;
	FString MissionTitle;
	int32 BrainRevision = 0;
	bool bDevelopmentPreview = true;
	/** The honest one-line source of everything on the surface. */
	FString SourceLine;
	/** 1 Root red ... 7 Crown violet: the rank the brain glows with. */
	int32 ChakraRank = 7;
	TArray<FWonderlandBrainSurface> Surfaces;
	/** True once a live view from the bridge has been adopted. */
	bool bLive = false;
	/** Live only: what the last write said -- saving, saved, or why it was refused. Empty before any. */
	FString WriteNote;
};

UCLASS()
class WONDERLAND_API UWonderlandProjectBrainSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	const FWonderlandBrainModel& GetModel() const { return Model; }
	const FWonderlandBrainSurface* FindSurface(FName SurfaceId) const;

	/** Record a line on a YOURS surface. False, and nothing recorded, anywhere else or for an empty line. */
	bool Propose(FName SurfaceId, const FString& Text);

	/** Accept or decline one line of a REVIEW surface. False on any other surface or a line that does not exist. */
	bool Review(FName SurfaceId, int32 LineIndex, bool bAccept);

	DECLARE_MULTICAST_DELEGATE(FOnWonderlandBrainChanged);
	FOnWonderlandBrainChanged OnBrainChanged;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Project Brain")
	int32 GetSurfaceCount() const { return Model.Surfaces.Num(); }

	/** "YOURS", "REVIEW", "SYSTEM", or empty for a surface that does not exist. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Project Brain")
	FString GetSurfaceAccess(FName SurfaceId) const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Project Brain")
	int32 GetProposalCount(FName SurfaceId) const;

	UFUNCTION(BlueprintCallable, Category = "Wonderland|Project Brain")
	bool ProposeEntry(FName SurfaceId, const FString& Text) { return Propose(SurfaceId, Text); }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Project Brain")
	int32 GetBrainRevision() const { return Model.BrainRevision; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Project Brain")
	bool IsDevelopmentPreview() const { return Model.bDevelopmentPreview; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Project Brain")
	bool IsLive() const { return Model.bLive; }

	/**
	 * REPLACE THE MODEL'S CONTENT WITH THE BRIDGE'S VIEW. Titles, groups, access and purpose stay the panel's own; the
	 * lines, counts, proposals and revision become Project Brain's. A surface the view does not name is shown empty --
	 * never a sample line, once live.
	 */
	void AdoptLive(const FWonderlandBrainLiveView& View);

	/** Live: the outcome of the last write, for the panel to say. */
	void SetWriteNote(const FString& Note);

	/**
	 * WHERE A LIVE WRITE GOES. Bound by UWonderlandProjectBrainLinkSubsystem; each returns true when the request was
	 * sent. Unbound (no link), a live model refuses rather than pretending to record anything locally.
	 */
	DECLARE_DELEGATE_RetVal_TwoParams(bool, FWonderlandBrainLivePropose, FName /*SurfaceId*/, const FString& /*Text*/);
	DECLARE_DELEGATE_RetVal_ThreeParams(bool, FWonderlandBrainLiveReview, FName /*SurfaceId*/, const FString& /*EntryRef*/, bool /*bAccept*/);
	FWonderlandBrainLivePropose LivePropose;
	FWonderlandBrainLiveReview LiveReview;

	/** `wl.Brain.Link`: what the link to the bridge's Project Brain is doing. Plain C++ on purpose (no new FNames). */
	FString DescribeLink() const;
	/** `wl.Brain.Refresh`: read the view again now. */
	void RefreshLink();

private:
	void BuildDevelopmentPreview();
	FWonderlandBrainSurface* FindMutable(FName SurfaceId);

	FWonderlandBrainModel Model;
	/** The bridge link that makes this model live once the client is paired; see WonderlandProjectBrainLink.h. */
	TSharedPtr<FWonderlandProjectBrainLink> Link;
};

namespace WonderlandBrainText
{
	WONDERLAND_API const TCHAR* AccessWord(EWonderlandBrainAccess Access);
	WONDERLAND_API const TCHAR* GroupWord(EWonderlandBrainGroup Group);
}
