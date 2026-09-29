// WONDERLAND — RELAY DOG SKINS.
//
// FOUNDER DIRECTIVE (2026-09-22): "Add these mascot skins too and add it in the project brain somewhere I can switch
// these mascot skins", and earlier, for the Bee family: "Create the data/runtime plumbing now for Bee Relay Dog skins:
// skin identifier, material/mesh references, equip/unequip, preview, multiplayer replication, persistence, animation
// compatibility, LOD compatibility, status-eye preservation, primary Relay Dog silhouette preservation."
//
// WHAT A SKIN IS. A change of APPEARANCE on the primary Relay Dog. That is the whole of it.
//
// WHAT A SKIN IS NOT, and these are the founder's own boundaries:
//   * NOT a change of capability. "Skins do not change agent capability."
//   * NOT a change of authority. "Do not replace Julius identity/authority based on skin." The Dog wearing Baal has
//     exactly the mission authority the Dog wearing nothing has.
//   * NOT a different creature. "The Bee skin must still clearly be a Relay Dog." Every figure in this registry is
//     built from one base dog by wonderland/Tools/relay_dog_skins.py and dressed afterwards, so the silhouette cannot
//     drift skin by skin: the generator would have to be changed to break it, and the generator builds all of them.
//   * NOT a place to hide the status eyes. The eyes are how the Dog says what it is doing. Every skin keeps them in
//     the same place at the same size and changes only their colour, and `EyeColour` here is the only latitude a skin
//     has over them.
//
// ONE FIELD REPLICATES. A remote player needs the equipped skin id and nothing else — the figure, the materials and the
// animation all follow from it, deterministically, on whichever machine draws the Dog. `FWonderlandEquippedSkin` is
// that field: small, copyable, and safe to send. Nothing here opens a network connection, because Wonderland has no
// multiplayer session yet; what exists is the seam that makes adding one a call rather than a redesign.
//
// NOTHING IS CLAIMED ABOUT OWNERSHIP. No account authority grants skins today, so every skin in this build is
// DEVELOPMENT PREVIEW and says so. When Julius's account authority exists it reports here and the access becomes
// OWNED; no surface may show a preview skin as though an account had granted it.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandRelaySkins.generated.h"

/** Whether this account may wear a skin, and on whose word. A grant with no provenance is a grant nobody can check. */
UENUM(BlueprintType)
enum class EWonderlandSkinAccess : uint8
{
	/** Granted by an account authority. Nothing does this yet. */
	Owned,
	/** Wearable in this build so the look can be judged, granted by nobody. Always shown as DEVELOPMENT PREVIEW. */
	DevelopmentPreview,
	/** Known to exist and not wearable. */
	Locked,
};

/**
 * ONE SKIN. Everything a surface needs to list it and everything the world needs to wear it.
 *
 * `FigureFile` is a .wlvox voxel figure under wonderland/RelaySkins — an engineering placeholder read as text at spawn,
 * not a cooked asset, so a correction to a look is a regeneration rather than a rebuild. `MeshAssetPath` and
 * `MaterialAssetPath` are where the Blender lane's real asset will be named when it lands; both are empty today and a
 * reader must treat empty as "no mesh asset exists yet" rather than as a missing file.
 */
USTRUCT(BlueprintType)
struct WONDERLAND_API FWonderlandRelaySkin
{
	GENERATED_BODY()

	/** The identifier. This, and only this, is what replicates and what persists. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Skins")
	FName SkinId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Skins")
	FString DisplayName;

	/** The family a skin belongs to, for surfaces that group them: RELAY, INFERNAL, CELESTIAL, SPECTRAL, SHADOW, HIVE. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Skins")
	FString Family;

	/** One line about the look. Never about power, because a skin has none. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Skins")
	FString Summary;

	/** The .wlvox figure, relative to the project directory. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Skins")
	FString FigureFile;

	/** Where the Blender lane's skeletal mesh will live. Empty until it exists; empty is not an error. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Skins")
	FString MeshAssetPath;

	/** Where the material set will live. Empty until it exists. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Skins")
	FString MaterialAssetPath;

	/** The accent a surface tints this skin's card with. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Skins")
	FLinearColor Accent = FLinearColor::White;

	/**
	 * THE STATUS EYES' COLOUR UNDER THIS SKIN, and the only thing a skin may change about them. Their place, their size
	 * and what they mean are fixed for every skin, because they are how the Dog reports state and a skin may not make
	 * the Dog harder to read.
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Skins")
	FLinearColor EyeColour = FLinearColor(1.0f, 0.78f, 0.30f);

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Skins")
	EWonderlandSkinAccess Access = EWonderlandSkinAccess::DevelopmentPreview;

	/** True for the Dog's own undressed form, which can never be taken away and is the fallback for anything broken. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Skins")
	bool bIsBaseForm = false;
};

/**
 * WHAT REPLICATES. The whole of a Relay Dog's appearance, in one small value.
 *
 * Deliberately not the figure path, the materials or the colours: those are derived from the id by the registry, which
 * every machine has, so sending them would be sending the same answer twice and inviting the two copies to disagree.
 * `ChangedAtUnix` exists so a late joiner can tell a fresh change from the state it was handed on connect.
 */
USTRUCT(BlueprintType)
struct WONDERLAND_API FWonderlandEquippedSkin
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Skins")
	FName SkinId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Skins")
	int64 ChangedAtUnix = 0;
};

DECLARE_MULTICAST_DELEGATE_OneParam(FOnWonderlandSkinChanged, FName /*SkinId*/);

/**
 * THE SKIN REGISTRY AND THE EQUIPPED SKIN.
 *
 * A GameInstance subsystem, like the entitlement holder, because which skin a player wears is a property of the session
 * rather than of a level: walking through a door must not undress the Dog.
 */
UCLASS()
class WONDERLAND_API UWonderlandRelaySkinSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;

	/** Every skin this build knows about, in the order a surface should list them. */
	const TArray<FWonderlandRelaySkin>& GetSkins() const { return Skins; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Skins")
	int32 NumSkins() const { return Skins.Num(); }

	/** One skin by id, or null. */
	const FWonderlandRelaySkin* Find(FName SkinId) const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Skins")
	FName GetEquippedSkinId() const { return Equipped.SkinId; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Skins")
	FString GetEquippedSkinName() const;

	/** The replicated value, for whatever eventually sends it. */
	const FWonderlandEquippedSkin& GetEquipped() const { return Equipped; }

	/**
	 * WEAR A SKIN. Refuses an unknown id and refuses a LOCKED one, and says so; a refusal leaves the Dog wearing
	 * whatever it already had rather than stripping it.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Skins")
	bool EquipSkin(FName SkinId);

	/** Back to the Dog's own form. Always allowed: the base form cannot be taken away. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Skins")
	bool UnequipSkin();

	/**
	 * APPLY A SKIN A REMOTE AUTHORITY REPORTED. Separate from EquipSkin because the two are different acts: this one
	 * does not persist (the remote machine's choice is not this player's preference) and it does not refuse on access
	 * (that was the other machine's business to judge). An unknown id falls back to the base form rather than leaving a
	 * Dog invisible, and logs.
	 */
	void ApplyRemoteSkin(const FWonderlandEquippedSkin& Reported);

	/** The full path of a skin's figure file, or empty when the skin or the file is unknown. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Skins")
	FString FigurePathFor(FName SkinId) const;

	/** What the equipped skin's figure file is, ready to hand to AWonderlandCompanionEmbodiment::LoadFigure. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Skins")
	FString EquippedFigurePath() const { return FigurePathFor(Equipped.SkinId); }

	/** The skins as lines, for a proof job and for `wl.Skins.List`. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Skins")
	TArray<FString> DescribeSkins() const;

	/**
	 * A RETIRED SKIN ID'S SUCCESSOR (founder, 2026-09-29): arden_infernal and arden_infernal_v1 -> jack_flame, apollo and
	 * apollo_v1 -> baal. Any other id comes back unchanged. EquipSkin, ApplyRemoteSkin and the remembered-skin load all
	 * pass ids through this; it is exposed so a proof job can check the mapping without touching the player's file.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Skins")
	FName MigrateLegacySkinId(FName SkinId) const;

	/** Raised after the equipped skin actually changed. Not raised when an equip was refused or was a no-op. */
	FOnWonderlandSkinChanged OnSkinChanged;

private:
	void BuildRegistry();
	void LoadPersisted();
	void SavePersisted() const;
	static FString PersistPath();

	TArray<FWonderlandRelaySkin> Skins;
	FWonderlandEquippedSkin Equipped;
};
