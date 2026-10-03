// Copyright Wonderland. THE ANGELIC TWIN SWORDS: the first Mission Handoff form, as boxes, and how they are shown.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandMissionHandoff.h"

class AActor;
class USceneComponent;
class UInstancedStaticMeshComponent;
class UMaterialInstanceDynamic;

/**
 * THE FOUNDER'S SHEET (`_qa_handoff/mission_handoff/reference/ANGELIC_TWIN_SWORDS_founder_sheet.png`, 2026-10-02) IS THE
 * AUTHORITY: a matched, mirrored pair of long slender swords -- a star-rayed compass pommel, a white grip in a lattice of the
 * sword's metal, an ornate crossguard with thorn flares and a GLOWING ORB core, a pair of white feathered wings spreading
 * from the guard, a long white luminous blade with a fuller in the sword's energy colour -- GOLD for the LLM Companion
 * (gold metal, a sun orb, gold engraving) and CYAN for Jhinn (silver metal, a cyan ring orb, crystalline cyan runes and
 * diamond gems). They differ only in their energy colour.
 *
 * BUILT IN WONDERLAND'S OWN LANGUAGE: boxes, the way the Relay Dog's mission props are (the book, the brush, the lens),
 * on the same engine materials -- so there is no new asset, no new reflected name (the Niagara FName rule) and nothing new
 * to stage into a package. The emissive levels are calibrated by frames against the 25,000 white point, never asserted.
 */
namespace WonderlandHandoffSwords
{
	/** Which of the ISM groups a box belongs to: each is one material, one colour. */
	enum class ESwordPart : uint8
	{
		/** The luminous white blade. Emissive. */
		Blade,
		/** The fuller: gold engraving, or cyan crystal runes. Emissive. */
		Fuller,
		/** The guard, the flares, the lattice, the pommel's rays: gold or silver. Lit. */
		Metal,
		/** The white grip under the lattice. Lit. */
		Grip,
		/** The angel wings' feathers: white, faintly warm or cool. Lit. */
		Feather,
		/** The orb core, the gems, the pommel's heart: the brightest things on the sword. Emissive. */
		Core,
		Count
	};

	/** One box of a sword, in SWORD SPACE: the origin is the middle of the grip, where the hand closes; +Z runs up the blade to
	 *  its point; +Y spans the crossguard (the wings spread along it); +X is out of the blade's flat. Sizes in uu at a head
	 *  width of 60 (the canon's), scaled with the Dog. */
	struct FSwordBox
	{
		ESwordPart Part = ESwordPart::Blade;
		FVector Centre = FVector::ZeroVector;
		FVector Size = FVector(1.0);
		FRotator Turn = FRotator::ZeroRotator;
	};

	/** The colour of each part on the gold (LLM Companion) or the cyan (Jhinn) sword. Emissive parts' colours are relative
	 *  levels (multiplied by the scene's exposure when shown). */
	FLinearColor PartColour(ESwordPart Part, bool bGold);
	bool IsEmissive(ESwordPart Part);
	const TCHAR* PartName(ESwordPart Part);

	/** The whole sword, box by box. The two swords share every dimension; only the fuller's language (engraving vs runes) and
	 *  the gems differ, as on the sheet. */
	TArray<FSwordBox> BuildSword(bool bGold);

	/** How long the sword is from the pommel's end to the point, uu at head width 60, and where along +Z its point is. */
	inline constexpr float GripHalfUU = 11.0f;
	inline constexpr float BladeRootZ = 16.0f;
	inline constexpr float BladeLengthUU = 100.0f;
	inline constexpr float TipZ = BladeRootZ + BladeLengthUU + 6.0f;
	inline constexpr float PommelZ = -GripHalfUU - 5.0f;

	/** Every input the presentation needs from the world this frame. Read, never written. */
	struct FShowInput
	{
		EWonderlandHandoffState State = EWonderlandHandoffState::Idle;
		/** Seconds into the current phase (FWonderlandMissionHandoff::GetPhaseSeconds). */
		float PhaseSeconds = 0.0f;
		/** Where each sword is held: the LEFT hand's grip (the gold, the LLM Companion's) and the RIGHT's (the cyan, Jhinn's). */
		FTransform LeftGrip = FTransform::Identity;
		FTransform RightGrip = FTransform::Identity;
		/** Where each companion is: the swords form there and return there. */
		FVector LeftCompanion = FVector::ZeroVector;
		FVector RightCompanion = FVector::ZeroVector;
		/** The Dog's scale unit (head width / 60). */
		float Scale = 1.0f;
		float TimeSeconds = 0.0f;
		float DeltaSeconds = 0.0f;
		/** A dash is under way: each sword draws its trail (gold LEFT, cyan RIGHT). */
		bool bDashing = false;
	};

	/** The effects' sizes: how many boxes each carries. The trails are thin and short so a dash never fills the screen. */
	inline constexpr int32 RibbonBoxesPerSword = 48;
	inline constexpr int32 MotesPerSword = 12;
	inline constexpr int32 TrailSamples = 18;

	/**
	 * THE SWORDS IN THE WORLD: two sets of instanced boxes on the Dog, moved in world space every frame. Plain C++ (no
	 * reflected type): the components it makes belong to the owning actor, which keeps them alive; this holds them weakly.
	 *
	 * HIDDEN unless a handoff is under way. TRANSFORMING: each sword forms over its companion, growing out of its light.
	 * DELIVERING: each flies on a curve to its hand. HELD: in the hands. RETURNING: back to the companions, fading into them.
	 * The gold one is always the LEFT hand's, the cyan the RIGHT's: the founder's sides never swap.
	 */
	class WONDERLAND_API FPresentation
	{
	public:
		/** Makes the components (hidden) on Owner. Safe to call again: it builds once. */
		void Build(AActor* Owner, float Scale);
		bool IsBuilt() const { return bBuilt; }
		/** Places, shows or hides both swords for this frame. */
		void Show(const FShowInput& In);
		/** How visible the swords are right now (0 hidden .. 1 fully formed), and where each is. */
		float GetPresence() const { return Presence; }
		FTransform GetSwordWorld(bool bGold) const;
		/** The number of sword boxes drawn right now, for the QA (0 when hidden). */
		int32 CountVisibleBoxes() const;
		/** The effects drawn right now, for the QA: spiral ribbon boxes, floating particles, and trail segments. */
		int32 CountVisibleRibbons() const;
		int32 CountVisibleMotes() const;
		int32 CountVisibleTrail() const;
		/** Removes every component it made (the owner going away, or a rebuild). */
		void Destroy();

	private:
		struct FSword
		{
			TWeakObjectPtr<USceneComponent> Root;
			TWeakObjectPtr<UInstancedStaticMeshComponent> Parts[static_cast<int32>(ESwordPart::Count)];
			TWeakObjectPtr<UMaterialInstanceDynamic> Materials[static_cast<int32>(ESwordPart::Count)];
			/** THE LIVING LIGHT (the sheet): two ribbons spiralling round the blade, and floating particles -- gold feathers and
			 *  stars on the gold sword, small glowing squares and a feather on the cyan. In the sword's own space. */
			TWeakObjectPtr<UInstancedStaticMeshComponent> Ribbons;
			TWeakObjectPtr<UInstancedStaticMeshComponent> Motes;
			/** THE DASH'S TRAIL, in the world: where the blade has just been, fading behind it. */
			TWeakObjectPtr<UInstancedStaticMeshComponent> Trail;
			TArray<FVector> TrailTips;
			TArray<FVector> TrailRoots;
			TArray<float> TrailAges;
			float TrailWeight = 0.0f;
			int32 Boxes = 0;
		};
		void BuildOne(AActor* Owner, FSword& Sword, bool bGold, float Scale);
		void Place(FSword& Sword, const FTransform& World, float Grow, bool bVisible);
		void Animate(FSword& Sword, bool bGold, bool bVisible, const FShowInput& In);

		FSword Gold;
		FSword Cyan;
		bool bBuilt = false;
		float Presence = 0.0f;
		float BuiltScale = 1.0f;
	};
}
