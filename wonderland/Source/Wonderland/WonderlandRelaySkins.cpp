#include "WonderlandRelaySkins.h"

#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

namespace
{
	/** Where the equipped skin is remembered between sessions. One line, so a person can read and fix it. */
	const TCHAR* const PersistRelative = TEXT("Wonderland/RelaySkin.txt");

	FLinearColor Rgb(uint8 R, uint8 G, uint8 B)
	{
		return FLinearColor(FColor(R, G, B));
	}
}

void UWonderlandRelaySkinSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	BuildRegistry();
	Equipped.SkinId = TEXT("relay_og");
	LoadPersisted();
}

void UWonderlandRelaySkinSubsystem::BuildRegistry()
{
	Skins.Reset();

	const auto Add = [this](const TCHAR* Id, const TCHAR* Name, const TCHAR* Family, const TCHAR* Summary,
		const TCHAR* Figure, FLinearColor Accent, FLinearColor Eye, bool bBase)
	{
		FWonderlandRelaySkin Skin;
		Skin.SkinId = Id;
		Skin.DisplayName = Name;
		Skin.Family = Family;
		Skin.Summary = Summary;
		Skin.FigureFile = Figure;
		// NO MESH ASSET EXISTS YET. The Blender lane owns detailed asset creation and has not shipped these; an empty
		// path is the truthful answer and a surface must not read it as a broken reference.
		Skin.MeshAssetPath = FString();
		Skin.MaterialAssetPath = FString();
		Skin.Accent = Accent;
		Skin.EyeColour = Eye;
		// EVERY SKIN IS A DEVELOPMENT PREVIEW, because no account authority has granted anything. The base form is the
		// exception: the Dog's own appearance is not a grant and cannot be withdrawn.
		Skin.Access = bBase ? EWonderlandSkinAccess::Owned : EWonderlandSkinAccess::DevelopmentPreview;
		Skin.bIsBaseForm = bBase;
		Skins.Add(MoveTemp(Skin));
	};

	Add(TEXT("relay_og"), TEXT("RELAY OG"), TEXT("RELAY"),
		TEXT("The Dog as it is. Bone coat, black visor, warm gold status eyes."),
		TEXT("RelayOg.wlvox"), Rgb(0xE5, 0xDE, 0xCB), Rgb(0xFF, 0xC7, 0x4D), true);

	// ---- V1 AND V2, BOTH IN THE WORLD.
	//
	// FOUNDER, 2026-09-27: "Call the previous one V1 and keep them in the Wonderland world and make the new
	// ones called V2." The three premium skins were redone from the founder's reference sheets; the designs
	// that stood before are not retired but worn as V1 beside them. The ids the rest of the project already
	// uses -- arden_infernal, apollo, skeleton_flame -- stay and now mean the V2 (the redo is the default a
	// player gets), and each has a _v1 twin pointing at the previous figure. The generator writes both from
	// one file: V1 verbatim from the pre-redo builders, V2 fresh from the sheets.
	Add(TEXT("arden_infernal_v1"), TEXT("ARDEN INFERNAL V1"), TEXT("INFERNAL"),
		TEXT("The previous Arden: a flaming halo, gold chains, a demonic arm and an infernal tail, no robe."),
		TEXT("ArdenInfernalV1.wlvox"), Rgb(0xFF, 0x4C, 0x1E), Rgb(0xFF, 0x8C, 0x1F), false);
	Add(TEXT("arden_infernal"), TEXT("ARDEN INFERNAL V2"), TEXT("INFERNAL"),
		TEXT("From the sheet: a gem-set flaming halo, six chains over a bare chest, a robe of cream, crimson and black to the floor, the demonic arm and the infernal tail."),
		TEXT("ArdenInfernalV2.wlvox"), Rgb(0xFF, 0x4C, 0x1E), Rgb(0xFF, 0x8C, 0x1F), false);

	Add(TEXT("apollo_v1"), TEXT("APOLLO V1"), TEXT("CELESTIAL"),
		TEXT("The previous Apollo: a sunburst of rays, baroque winged pauldrons, gold armour, no drapery."),
		TEXT("ApolloV1.wlvox"), Rgb(0xE6, 0xB8, 0x4C), Rgb(0xFF, 0xD6, 0x52), false);
	Add(TEXT("apollo"), TEXT("APOLLO V2"), TEXT("CELESTIAL"),
		TEXT("From the sheet: a plain gold ring enclosing a crown of fire, winged cherub pauldrons, a sun on the chest, lamp-orbs at the hips, white drapery to the floor."),
		TEXT("ApolloV2.wlvox"), Rgb(0xE6, 0xB8, 0x4C), Rgb(0xFF, 0xD6, 0x52), false);

	Add(TEXT("skeleton_flame_v1"), TEXT("SKELETON FLAME V1"), TEXT("SPECTRAL"),
		TEXT("The previous Skeleton Flame: a ribcage cut into the chest, tall ghostfire, jointed bone limbs."),
		TEXT("SkeletonFlameV1.wlvox"), Rgb(0x6E, 0xD8, 0xFF), Rgb(0x73, 0xEA, 0xFF), false);
	Add(TEXT("skeleton_flame"), TEXT("SKELETON FLAME V2"), TEXT("SPECTRAL"),
		TEXT("From the sheet: a broad figure in stepped bone plates, skulls at brow, temples and sternum, ghostfire at ears, elbows and spine, feet of pale blue light."),
		TEXT("SkeletonFlameV2.wlvox"), Rgb(0x6E, 0xD8, 0xFF), Rgb(0x73, 0xEA, 0xFF), false);

	Add(TEXT("celestial_light"), TEXT("CELESTIAL LIGHT"), TEXT("CELESTIAL"),
		TEXT("A coat of light, a star at the brow, a marked banner, and a halo standing behind."),
		TEXT("CelestialLight.wlvox"), Rgb(0x8C, 0xCC, 0xFF), Rgb(0x8C, 0xE6, 0xFF), false);

	// BEE AND HAGOROMO ARE OUT OF THE LINEUP (founder, 2026-09-23): "REMOVE THE BEE / BUMBLEBEE SKIN... REMOVE
	// HAGOROMO from the active mascot lineup as well. Same rule: no Wardrobe entry, no active selection, no
	// preview entry, no runtime choice."
	//
	// UNREGISTERED, NOT DELETED. Bee.wlvox and Hagoromo.wlvox stay on disk and the forge still builds them, so
	// nothing reusable is destroyed and either can come back by restoring one Add() call. Anyone who had one
	// equipped lands softly: LoadPersisted already drops a remembered skin the registry no longer knows and
	// leaves the Dog in its base form, so no stored data is invalidated and no id is broken.
	//
	// The active lineup is Relay OG, Arden Infernal, Apollo, Skeleton Flame and Celestial Light.
}

const FWonderlandRelaySkin* UWonderlandRelaySkinSubsystem::Find(FName SkinId) const
{
	return Skins.FindByPredicate([SkinId](const FWonderlandRelaySkin& Skin) { return Skin.SkinId == SkinId; });
}

FString UWonderlandRelaySkinSubsystem::GetEquippedSkinName() const
{
	const FWonderlandRelaySkin* Skin = Find(Equipped.SkinId);
	return Skin != nullptr ? Skin->DisplayName : FString(TEXT("RELAY OG"));
}

bool UWonderlandRelaySkinSubsystem::EquipSkin(FName SkinId)
{
	const FWonderlandRelaySkin* Skin = Find(SkinId);
	if (Skin == nullptr)
	{
		UE_LOG(LogTemp, Warning, TEXT("WLSKIN refused: no skin named '%s'"), *SkinId.ToString());
		return false;
	}
	if (Skin->Access == EWonderlandSkinAccess::Locked)
	{
		UE_LOG(LogTemp, Warning, TEXT("WLSKIN refused: '%s' is locked"), *SkinId.ToString());
		return false;
	}
	if (Equipped.SkinId == SkinId)
	{
		return true;
	}
	Equipped.SkinId = SkinId;
	Equipped.ChangedAtUnix = FDateTime::UtcNow().ToUnixTimestamp();
	SavePersisted();
	OnSkinChanged.Broadcast(SkinId);
	return true;
}

bool UWonderlandRelaySkinSubsystem::UnequipSkin()
{
	return EquipSkin(TEXT("relay_og"));
}

void UWonderlandRelaySkinSubsystem::ApplyRemoteSkin(const FWonderlandEquippedSkin& Reported)
{
	FName Wanted = Reported.SkinId;
	if (Find(Wanted) == nullptr)
	{
		// A DOG IN A SKIN THIS BUILD DOES NOT KNOW still has to be drawn. The base form is the answer; an invisible
		// Dog would be a worse lie than an undressed one, and the log says which machine is behind.
		UE_LOG(LogTemp, Warning, TEXT("WLSKIN remote skin '%s' is unknown here; drawing the base form"), *Wanted.ToString());
		Wanted = TEXT("relay_og");
	}
	if (Equipped.SkinId == Wanted)
	{
		return;
	}
	Equipped.SkinId = Wanted;
	Equipped.ChangedAtUnix = Reported.ChangedAtUnix;
	// DELIBERATELY NOT PERSISTED: what another machine's player wears is not this player's preference.
	OnSkinChanged.Broadcast(Wanted);
}

FString UWonderlandRelaySkinSubsystem::FigurePathFor(FName SkinId) const
{
	const FWonderlandRelaySkin* Skin = Find(SkinId);
	if (Skin == nullptr || Skin->FigureFile.IsEmpty())
	{
		return FString();
	}
	return FPaths::ConvertRelativePathToFull(FPaths::ProjectDir() / TEXT("RelaySkins") / Skin->FigureFile);
}

TArray<FString> UWonderlandRelaySkinSubsystem::DescribeSkins() const
{
	TArray<FString> Lines;
	for (const FWonderlandRelaySkin& Skin : Skins)
	{
		const TCHAR* Access =
			Skin.Access == EWonderlandSkinAccess::Owned ? TEXT("OWNED") :
			Skin.Access == EWonderlandSkinAccess::Locked ? TEXT("LOCKED") : TEXT("DEVELOPMENT PREVIEW");
		Lines.Add(FString::Printf(TEXT("%s %-16s %-10s %-20s %s"),
			Skin.SkinId == Equipped.SkinId ? TEXT("*") : TEXT(" "),
			*Skin.SkinId.ToString(), *Skin.Family, Access, *Skin.FigureFile));
	}
	return Lines;
}

FString UWonderlandRelaySkinSubsystem::PersistPath()
{
	return FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / PersistRelative);
}

void UWonderlandRelaySkinSubsystem::LoadPersisted()
{
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *PersistPath()))
	{
		return;
	}
	const FName Remembered(*Text.TrimStartAndEnd());
	const FWonderlandRelaySkin* Skin = Find(Remembered);
	// A REMEMBERED SKIN THAT NO LONGER EXISTS, or that has since been locked, is not worn. Silently keeping the base
	// form is right here: the player did nothing wrong, and a startup error about a cosmetic is noise.
	if (Skin != nullptr && Skin->Access != EWonderlandSkinAccess::Locked)
	{
		Equipped.SkinId = Remembered;
	}
}

void UWonderlandRelaySkinSubsystem::SavePersisted() const
{
	FFileHelper::SaveStringToFile(Equipped.SkinId.ToString(), *PersistPath());
}

// ---------------------------------------------------------------------------------------------------------------
// Console. A skin is cosmetic, so these are conveniences rather than authority: nothing here can change what the Dog
// is allowed to do, and `wl.Skins.Wear` refuses exactly what the panel's cards refuse.

namespace
{
	UWonderlandRelaySkinSubsystem* SkinsFor(UWorld* World)
	{
		return World != nullptr && World->GetGameInstance() != nullptr
			? World->GetGameInstance()->GetSubsystem<UWonderlandRelaySkinSubsystem>()
			: nullptr;
	}

	FAutoConsoleCommandWithWorldAndArgs GListSkins(
		TEXT("wl.Skins.List"),
		TEXT("List the Relay Dog skins this build knows, and which one is worn."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			UWonderlandRelaySkinSubsystem* Skins = SkinsFor(World);
			if (Skins == nullptr)
			{
				UE_LOG(LogTemp, Warning, TEXT("WLSKIN no skin subsystem"));
				return;
			}
			for (const FString& Line : Skins->DescribeSkins())
			{
				UE_LOG(LogTemp, Display, TEXT("WLSKIN %s"), *Line);
			}
		}));

	FAutoConsoleCommandWithWorldAndArgs GWearSkin(
		TEXT("wl.Skins.Wear"),
		TEXT("Wear a Relay Dog skin by id, e.g. wl.Skins.Wear apollo"),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			UWonderlandRelaySkinSubsystem* Skins = SkinsFor(World);
			if (Skins == nullptr || Args.Num() < 1)
			{
				UE_LOG(LogTemp, Warning, TEXT("WLSKIN usage: wl.Skins.Wear <skin id>"));
				return;
			}
			const FName Wanted(*Args[0]);
			UE_LOG(LogTemp, Display, TEXT("WLSKIN wear %s: %s"), *Wanted.ToString(),
				Skins->EquipSkin(Wanted) ? TEXT("worn") : TEXT("REFUSED"));
		}));
}
