// WONDERLAND — PROJECT BRAIN, AS THE WORLD SHOWS IT TO ITS OWNER.
//
// THE HIERARCHY THIS SURFACE SERVES (founder roadmap, 2026-09-15): Project Brain is the durable mission and
// project memory; Julius acts and decides; Python computes; GVE proves, later. Wonderland is the embodied
// interface to all of it and the record of none of it.
//
// THE WORLD IS NOT THE RECORD, and that is already a boundary in code, not a preference. The Wonderland brain
// scope (src/relay/mission/wonderland/wonderland-brain-scope.ts) lets a world receive counts, revisions and
// flags about Project Brain and never an entry's text, because the game client is the least trusted process in
// the system. So what this subsystem holds is a PRESENTATION MODEL: which surfaces exist, who may change each
// one, how many entries each holds, and the brain revision. Sample lines exist only in the development preview,
// so the interface can be judged before anything is connected; a live source of entry text needs an
// owner-scoped read contract that the founder has not yet decided, and until it exists a live brain shows
// counts only.
//
// WHO MAY CHANGE WHAT, which is the point of the surface. Every surface carries one access:
//
//   YOURS    the owner authored it and may add to it: facts, preferences, identity, instructions, workflows,
//            scratchpads, shared context, requirements, constraints.
//   REVIEW   Project Brain proposed it; the owner accepts or declines, and does not rewrite it.
//   SYSTEM   Julius and Project Brain own it: history, handoffs, agent state, accepted decisions, evidence,
//            evaluations, trace, governance. Shown, never offered for editing.
//
// EDITS ARE PROPOSALS. Nothing typed here changes Project Brain; a line added in the world is recorded in this
// session as PROPOSED and NOT SAVED (it is gone after a restart), and says so, until a Project Brain authority exists
// to receive it.
//
// PLAIN TYPES ON PURPOSE: none of this crosses to Relay, so none of it belongs in the C++ <-> TypeScript
// parity table.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandProjectBrain.generated.h"

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
	/** Development preview only. Never populated from a live source until an owner-scoped read contract exists. */
	TArray<FString> SampleLines;
	/** Lines the owner added in this session. Proposed, not synced. */
	TArray<FString> Proposals;
	/** Review decisions made in this session, as "Accepted: ..." or "Declined: ...". Proposed, not synced. */
	TArray<FString> Reviews;
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
};

UCLASS()
class WONDERLAND_API UWonderlandProjectBrainSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;

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

private:
	void BuildDevelopmentPreview();
	FWonderlandBrainSurface* FindMutable(FName SurfaceId);

	FWonderlandBrainModel Model;
};

namespace WonderlandBrainText
{
	WONDERLAND_API const TCHAR* AccessWord(EWonderlandBrainAccess Access);
	WONDERLAND_API const TCHAR* GroupWord(EWonderlandBrainGroup Group);
}
