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
//            scratchpads, shared context.
//   REVIEW   Project Brain proposed it; the owner accepts or declines, and does not rewrite it.
//   SYSTEM   Julius and Project Brain own it: history, handoffs, agent state, prompt systems, learned skills, and the
//            skills & mods surfaces this build has no source for yet. Shown, never offered for editing.
//
// THE FIVE SECTIONS (founder, 2026-10-06; SECOND JUJU's contract PB_UI_CONTRACT_04_05.r1): 01 MEMORY CORE, 02 PROJECT BRAIN
// SYSTEMS, 03 LARGE LANGUAGE MODEL COMPONENTS (where the compound agent is CONFIGURED), 04 SKILLS & MODS (what EXTENDS the
// configured agent; it never configures it), 05 C.A.R.D. (the loadout, and MASCOT & VISUAL MODS: how it all LOOKS). Mission
// context is no Project Brain panel section any more: it travels with the Mission Contract.
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
	/** 04 SKILLS & MODS (founder, 2026-10-06: it replaces 04 MISSION CONTEXT). */
	SkillsMods
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
	/** Live only: each proposal's record reference (pbr:<uuid>) and current version, index for index with Proposals -- what an
	 *  adopt or a withdraw names (the bridge refuses a stale version with 409, so a change is never applied to what was not seen). */
	TArray<FString> ProposalRefs;
	TArray<int32> ProposalVersions;
	/** A surface the panel names for the architecture but this build has NO source for (04's skills & mods in Beta): empty in the
	 *  preview too, never proposable, and the inspector says "Nothing here in this build." -- never an install / enable / buy control. */
	bool bNotInThisBuild = false;
};

/** One line of a live surface, as the bridge sent it. */
struct FWonderlandBrainLiveEntry
{
	FString Ref;
	FString Line;
	FString Status;
	/** ACCEPTED, DECLINED, or empty when no person has reviewed it. */
	FString Review;
	/** The record's version when it is a Project Brain record (0 when the line is not one: a Julius row, a claim). */
	int32 Version = 0;
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
	/**
	 * Live, then CUT OFF: the bridge refused this client's session (401) or the session ended. What is shown is what was last
	 * read, and says so; nothing is sent until the next live view (Second, 10-03: a stale view must never read as live).
	 */
	bool bLinkLost = false;
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

	/** Plain C++, not a UFUNCTION: a new reflected name can shift the FName table under Niagara's type hash (RC1, 10-01). */
	bool IsLive() const { return Model.bLive && !Model.bLinkLost; }

	/**
	 * REPLACE THE MODEL'S CONTENT WITH THE BRIDGE'S VIEW. Titles, groups, access and purpose stay the panel's own; the
	 * lines, counts, proposals and revision become Project Brain's. A surface the view does not name is shown empty --
	 * never a sample line, once live.
	 */
	void AdoptLive(const FWonderlandBrainLiveView& View);

	/** Live: the outcome of the last write, for the panel to say. */
	void SetWriteNote(const FString& Note);

	/** Live, then cut off: keep the last view, label it NOT CONNECTED with the reason, refuse writes until a live view is read again. */
	void MarkLinkLost(const FString& Why);

	/**
	 * `/brain` IN THE LIVE TERMINAL -- the player's own path to Project Brain (Second, 10-03; until now only the console command
	 * wl.Julius.Pair could pair): `/brain` or `/brain status` says where things stand; `/brain pair <code>` redeems the website's
	 * pairing code through the stream (the code is never logged or echoed); `/brain refresh` reads the view again.
	 * Live: `/brain proposals` numbers every pending proposal on the player's own surfaces; `/brain adopt <n>` asks Project Brain to
	 * ADOPT it (the owner's decision: it becomes a term Julius reads, at a new version) and `/brain withdraw <n>` to WITHDRAW it.
	 * The bridge decides who may (an adopt is the owner's; a withdraw the author's or the owner's) and refuses a stale version.
	 */
	void HandleTerminalLine(const FString& Argument, FString& OutSaid);

	/** One pending proposal as `/brain proposals` numbers it (1-based, in surface order). */
	struct FPendingProposal
	{
		FName SurfaceId;
		FString SurfaceTitle;
		FString Line;
		FString Ref;
		int32 Version = 0;
	};
	TArray<FPendingProposal> ListPendingProposals() const;
	/** The line as the terminal may echo it: a pairing code is never shown back. */
	static FString MaskTerminalEcho(const FString& Line);

	/** wl.Qa.BrainLink only: put back the model it saved before its fixtures, so a QA boot ends where it began. */
	void ReplaceModelForQa(const FWonderlandBrainModel& InModel) { Model = InModel; OnBrainChanged.Broadcast(); }

	/** wl.Qa.BrainLink only: whether a live view's surface this panel does not define was logged (once per id per session), and how
	 *  many such log lines were written in all. Plain C++, no reflection. */
	bool WasUnplacedLogged(FName SurfaceId) const { return UnplacedLogged.Contains(SurfaceId); }
	int32 UnplacedLogLines() const { return UnplacedLogCount; }

	/**
	 * WHERE A LIVE WRITE GOES. Bound by UWonderlandProjectBrainLinkSubsystem; each returns true when the request was
	 * sent. Unbound (no link), a live model refuses rather than pretending to record anything locally.
	 */
	DECLARE_DELEGATE_RetVal_TwoParams(bool, FWonderlandBrainLivePropose, FName /*SurfaceId*/, const FString& /*Text*/);
	DECLARE_DELEGATE_RetVal_ThreeParams(bool, FWonderlandBrainLiveReview, FName /*SurfaceId*/, const FString& /*EntryRef*/, bool /*bAccept*/);
	FWonderlandBrainLivePropose LivePropose;
	FWonderlandBrainLiveReview LiveReview;
	/** A status change on a Project Brain record the player can see: ADOPTED or WITHDRAWN, naming the version it changes. */
	DECLARE_DELEGATE_RetVal_ThreeParams(bool, FWonderlandBrainLiveSetStatus, const FString& /*RecordRef*/, int32 /*ExpectedVersion*/, const FString& /*Status*/);
	FWonderlandBrainLiveSetStatus LiveSetStatus;

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
	/** Live view surfaces this panel does not define: ignored, never rendered or defaulted, and logged ONCE per id (contract r1 §5). */
	TSet<FName> UnplacedLogged;
	int32 UnplacedLogCount = 0;
};

namespace WonderlandBrainText
{
	WONDERLAND_API const TCHAR* AccessWord(EWonderlandBrainAccess Access);
	/** The section (and memory card) a group is shown under. Never a real section by default: an unplaced group reads UNPLACED. */
	WONDERLAND_API const TCHAR* GroupWord(EWonderlandBrainGroup Group);
	/** The stable machine key of a group's section: memory_core, brain_systems, llm_components or skills_mods (05 C.A.R.D. holds no
	 *  Project Brain surface). Empty for a group no section holds. */
	WONDERLAND_API const TCHAR* SectionKey(EWonderlandBrainGroup Group);
}
