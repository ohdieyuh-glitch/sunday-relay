#include "WonderlandMascotStyle.h"

#include "RelayDogCharacter.h"
#include "WonderlandCompanionEmbodiment.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "EngineUtils.h"

#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/Texture.h"
#include "Misc/ConfigCacheIni.h"
#include "HAL/IConsoleManager.h"
#include "GameFramework/PlayerController.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "WonderlandBeta.h"

namespace WonderlandMascotStyle
{
	bool NamesAnEye(const FString& Name)
	{
		// MATCHED ON THE NAMES THE PROJECT ALREADY USES, rather than on a list this file invents: the canon
		// body's components, the figures' materials and the skins' parts all spell it the same way.
		return Name.Contains(TEXT("eye"), ESearchCase::IgnoreCase)
			|| Name.Contains(TEXT("visor"), ESearchCase::IgnoreCase)
			|| Name.Contains(TEXT("pupil"), ESearchCase::IgnoreCase);
	}

	EWonderlandColorChannel ChannelFor(const FString& MaterialName)
	{
		const FString Name = MaterialName.ToLower();
		// THE EYES FIRST, because "eye" is the narrower claim and the visor is NOT one of them: it is the black
		// face the whole lineup is recognised by, and a secondary colour painted onto it would erase that.
		if (Name.Contains(TEXT("eye")) || Name.Contains(TEXT("pupil")))
		{
			return EWonderlandColorChannel::Eye;
		}
		// THE SHELL. Every skin in the lineup declares exactly these two and builds its own art on top of them,
		// so they are the one channel a colourway can move without touching anything authored.
		if (Name == TEXT("bone") || Name == TEXT("bonedeep"))
		{
			return EWonderlandColorChannel::Body;
		}
		return EWonderlandColorChannel::None;
	}

	FLinearColor AccentColour(const FLinearColor& Authored, const FLinearColor& Chosen, bool bLight)
	{
		// DEFAULT is White and means "the colours it was designed in".
		if (Chosen.R >= 0.995f && Chosen.G >= 0.995f && Chosen.B >= 0.995f)
		{
			return Authored;
		}
		const float Peak = FMath::Max3(Authored.R, Authored.G, Authored.B);
		FLinearColor Hue(FMath::Clamp(Chosen.R, 0.0f, 1.0f), FMath::Clamp(Chosen.G, 0.0f, 1.0f), FMath::Clamp(Chosen.B, 0.0f, 1.0f), 1.0f);
		if (bLight)
		{
			// the pale core: the same hue, lifted 40% of the way toward white at the hue's own peak
			const float Top = FMath::Max3(Hue.R, Hue.G, Hue.B);
			Hue = FLinearColor(Hue.R + (Top - Hue.R) * 0.40f, Hue.G + (Top - Hue.G) * 0.40f, Hue.B + (Top - Hue.B) * 0.40f, 1.0f);
		}
		return FLinearColor(Hue.R * Peak, Hue.G * Peak, Hue.B * Peak, Authored.A);
	}

	FLinearColor DeepAccentColour(const FLinearColor& Authored, const FLinearColor& Chosen)
	{
		if (Chosen.R >= 0.995f && Chosen.G >= 0.995f && Chosen.B >= 0.995f)
		{
			return Authored;
		}
		// A THIRD OF THE CHOSEN COLOUR. The suit's own detail is the pinstripe at 0.78, so even the brightest swatch in the
		// palette (BONE, luminance 0.87 -> 0.29) leaves the stripes 2.6 times the cloth; the tie and the fire are emissive
		// and read against any lit cloth. A quarter (the first cut) read as near-black navy in daylight -- right for a
		// suit, too shy for "visibly recolor". A dark swatch still gives a dark suit: OBSIDIAN lands back near the design.
		constexpr float ClothShare = 0.33f;
		return FLinearColor(FMath::Clamp(Chosen.R, 0.0f, 1.0f) * ClothShare, FMath::Clamp(Chosen.G, 0.0f, 1.0f) * ClothShare,
			FMath::Clamp(Chosen.B, 0.0f, 1.0f) * ClothShare, Authored.A);
	}

	const TArray<TPair<FName, FLinearColor>>& Palette()
	{
		// ONE SET, OFFERED IN BOTH PLACES. Chosen to read against Wonderland's ivory stone and against black:
		// a swatch that vanishes in the Wardrobe's preview square is not a choice, it is a trap. DEFAULT is
		// first and is how a player puts a skin back to the colours it was designed in.
		static const TArray<TPair<FName, FLinearColor>> Swatches = {
			{TEXT("DEFAULT"),  FLinearColor::White},
			{TEXT("BONE"),     FLinearColor(0.898f, 0.871f, 0.800f)},
			{TEXT("GOLD"),     FLinearColor(1.000f, 0.780f, 0.260f)},
			{TEXT("EMBER"),    FLinearColor(1.000f, 0.420f, 0.160f)},
			{TEXT("CRIMSON"),  FLinearColor(0.820f, 0.140f, 0.180f)},
			{TEXT("VIOLET"),   FLinearColor(0.560f, 0.340f, 0.960f)},
			{TEXT("AZURE"),    FLinearColor(0.260f, 0.560f, 1.000f)},
			{TEXT("CYAN"),     FLinearColor(0.300f, 0.900f, 1.000f)},
			{TEXT("JADE"),     FLinearColor(0.200f, 0.860f, 0.600f)},
			{TEXT("ROSE"),     FLinearColor(1.000f, 0.520f, 0.680f)},
			{TEXT("SLATE"),    FLinearColor(0.420f, 0.460f, 0.540f)},
			{TEXT("OBSIDIAN"), FLinearColor(0.140f, 0.150f, 0.190f)},
		};
		return Swatches;
	}

	FSimpleMulticastDelegate& OnChanged()
	{
		static FSimpleMulticastDelegate Changed;
		return Changed;
	}

	void Tint(UMaterialInstanceDynamic* Instance, const FLinearColor& Colour)
	{
		if (Instance == nullptr)
		{
			return;
		}
		static const TCHAR* const Names[] = {
			TEXT("Color"), TEXT("BaseColor"), TEXT("Tint"), TEXT("EmissiveColor"), TEXT("RimColor"),
		};
		for (const TCHAR* Name : Names)
		{
			Instance->SetVectorParameterValue(Name, Colour);
		}
	}
}

namespace
{
	// WHETHER THE MASCOT PRIMARY IS A REAL CHOICE (see WonderlandMascotStyle::PrimaryPalette). -1: no readable file (the
	// colour decides, as before the file), 0: DEFAULT, 1: CHOSEN.
	int32 GPrimaryChoice = -1;
	bool GPrimaryChoiceLoaded = false;

	FString PrimaryChoicePath()
	{
		return FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Wonderland"), TEXT("PrimaryChoice.txt"));
	}

	/** "CHOSEN" or "DEFAULT", or nothing: a hand edit or a corrupted file is not a choice. */
	bool ReadPrimaryChoiceText(const FString& Text, bool& bOutChosen)
	{
		const FString Word = Text.TrimStartAndEnd();
		if (Word == TEXT("CHOSEN")) { bOutChosen = true; return true; }
		if (Word == TEXT("DEFAULT")) { bOutChosen = false; return true; }
		return false;
	}

	void LoadPrimaryChoice()
	{
		if (GPrimaryChoiceLoaded)
		{
			return;
		}
		GPrimaryChoiceLoaded = true;
		const FString Path = PrimaryChoicePath();
		WonderlandBeta::RecoverInterruptedSave(Path);
		IFileManager& Files = IFileManager::Get();
		if (!Files.FileExists(*Path))
		{
			return;
		}
		// A SIZE CAP BEFORE THE READ: the file holds one short word.
		FString Text;
		bool bChosen = false;
		const int64 Size = Files.FileSize(*Path);
		if (Size > 0 && Size <= 32 && FFileHelper::LoadFileToString(Text, *Path) && ReadPrimaryChoiceText(Text, bChosen))
		{
			GPrimaryChoice = bChosen ? 1 : 0;
			return;
		}
		UE_LOG(LogTemp, Warning, TEXT("WLMASCOT the saved primary choice could not be read (%lld bytes); the colour decides"), Size);
	}

	void SavePrimaryChoice(bool bChosen)
	{
		LoadPrimaryChoice();
		GPrimaryChoice = bChosen ? 1 : 0;
		// SAVED THE MOMENT IT IS PICKED, whole or not at all, like the flame colour beside it.
		WonderlandBeta::SaveTextAtomically(PrimaryChoicePath(), bChosen ? TEXT("CHOSEN") : TEXT("DEFAULT"));
	}

	// THE FLAME COLOUR'S ONE COPY (see WonderlandMascotStyle::FlameColour). White is the designed fire.
	FLinearColor GFlameColour = FLinearColor::White;
	bool GFlameColourLoaded = false;

	FString FlameColourPath()
	{
		return FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Wonderland"), TEXT("FlameColour.txt"));
	}

	/** THREE NUMBERS IN 0..1, or nothing. A hand edit, a corrupted file or a NaN is not a colour; it is the designed fire. */
	bool ReadFlameColourText(const FString& Text, FLinearColor& Out)
	{
		if (Text.Len() > 64)
		{
			return false;
		}
		TArray<FString> Parts;
		Text.TrimStartAndEnd().ParseIntoArrayWS(Parts);
		if (Parts.Num() != 3)
		{
			return false;
		}
		float Values[3] = { 0.0f, 0.0f, 0.0f };
		for (int32 Index = 0; Index < 3; ++Index)
		{
			// IsNumeric takes digits, one point and a sign -- no exponent, no "nan", no "inf"
			if (!Parts[Index].IsNumeric())
			{
				return false;
			}
			Values[Index] = FCString::Atof(*Parts[Index]);
			if (!FMath::IsFinite(Values[Index]) || Values[Index] < 0.0f || Values[Index] > 1.0f)
			{
				return false;
			}
		}
		Out = FLinearColor(Values[0], Values[1], Values[2], 1.0f);
		return true;
	}

	void LoadFlameColour()
	{
		if (GFlameColourLoaded)
		{
			return;
		}
		GFlameColourLoaded = true;
		const FString Path = FlameColourPath();
		WonderlandBeta::RecoverInterruptedSave(Path);
		IFileManager& Files = IFileManager::Get();
		if (!Files.FileExists(*Path))
		{
			return;
		}
		// A SIZE CAP BEFORE THE READ: the file holds three short numbers, so anything past a few hundred bytes is not one.
		FString Text;
		FLinearColor Colour = FLinearColor::White;
		const int64 Size = Files.FileSize(*Path);
		if (Size > 0 && Size <= 256 && FFileHelper::LoadFileToString(Text, *Path) && ReadFlameColourText(Text, Colour))
		{
			GFlameColour = Colour;
			return;
		}
		UE_LOG(LogTemp, Warning, TEXT("WLMASCOT the saved flame colour could not be read (%lld bytes); the fire is as designed until one is picked"), Size);
	}

	// THE STRIPS COLOUR'S ONE COPY (see WonderlandMascotStyle::HasChosenStrip). DEFAULT -- the strips as designed -- unless
	// the file says otherwise; unlike the fire, WHITE is a real choice here, so the word DEFAULT is kept, not a colour.
	bool GStripChosen = false;
	FLinearColor GStripColour = FLinearColor::Black;
	bool GStripLoaded = false;

	FString StripColourPath()
	{
		return FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Wonderland"), TEXT("StripColour.txt"));
	}

	/** "DEFAULT", or three numbers in 0..1 (the flame file's rule), or nothing: a hand edit or a corrupted file is no choice. */
	bool ReadStripText(const FString& Text, bool& bOutChosen, FLinearColor& OutColour)
	{
		const FString Word = Text.TrimStartAndEnd();
		if (Word == TEXT("DEFAULT"))
		{
			bOutChosen = false;
			OutColour = FLinearColor::Black;
			return true;
		}
		FLinearColor Colour;
		if (ReadFlameColourText(Word, Colour))
		{
			bOutChosen = true;
			OutColour = Colour;
			return true;
		}
		return false;
	}

	void LoadStripColour()
	{
		if (GStripLoaded)
		{
			return;
		}
		GStripLoaded = true;
		const FString Path = StripColourPath();
		WonderlandBeta::RecoverInterruptedSave(Path);
		IFileManager& Files = IFileManager::Get();
		if (!Files.FileExists(*Path))
		{
			return;
		}
		// A SIZE CAP BEFORE THE READ: one word or three short numbers.
		FString Text;
		bool bChosen = false;
		FLinearColor Colour = FLinearColor::Black;
		const int64 Size = Files.FileSize(*Path);
		if (Size > 0 && Size <= 256 && FFileHelper::LoadFileToString(Text, *Path) && ReadStripText(Text, bChosen, Colour))
		{
			GStripChosen = bChosen;
			GStripColour = Colour;
			return;
		}
		UE_LOG(LogTemp, Warning, TEXT("WLMASCOT the saved strip colour could not be read (%lld bytes); the strips are as designed until one is picked"), Size);
	}

	void SaveStripColour(bool bChosen, const FLinearColor& Colour)
	{
		LoadStripColour();
		GStripChosen = bChosen;
		GStripColour = FLinearColor(FMath::Clamp(Colour.R, 0.0f, 1.0f), FMath::Clamp(Colour.G, 0.0f, 1.0f), FMath::Clamp(Colour.B, 0.0f, 1.0f), 1.0f);
		// SAVED THE MOMENT IT IS PICKED, whole or not at all, like the flame colour beside it.
		WonderlandBeta::SaveTextAtomically(StripColourPath(), bChosen
			? FString::Printf(TEXT("%.4f %.4f %.4f"), GStripColour.R, GStripColour.G, GStripColour.B) : FString(TEXT("DEFAULT")));
	}

	// ---- THE SMOKE LOOK'S SETTINGS (see WonderlandMascotStyle::IsSmokeLook), one place, console variables only (the FName
	// ---- rule: never a reflected property). Read every time a smoke surface is painted, so a change shows on the next paint.
	TAutoConsoleVariable<FString> CVarSmokeNormalTex(TEXT("wl.Shadow.NormalTex"), TEXT("T_ripple_n"),
		TEXT("Shadow smoke look: the cooked normal texture (/Game/Wonderland/Textures/<name>) its relief is drawn with; 'none' for none."));
	TAutoConsoleVariable<float> CVarSmokeTexScale(TEXT("wl.Shadow.TexScale"), 0.030f,
		TEXT("Shadow smoke look: the relief's world projection scale (1 / uu per repeat)."));
	TAutoConsoleVariable<float> CVarSmokeDetailAmp(TEXT("wl.Shadow.DetailAmp"), 0.10f,
		TEXT("Shadow smoke look: the master's procedural normal relief (DetailAmp); 0 = none."));
	TAutoConsoleVariable<float> CVarSmokeRoughVary(TEXT("wl.Shadow.RoughVary"), 1.6f,
		TEXT("Shadow smoke look: how far the roughness wanders (RoughVary), so highlights travel across the surface."));
	TAutoConsoleVariable<float> CVarSmokeRoughness(TEXT("wl.Shadow.Roughness"), 0.42f,
		TEXT("Shadow smoke look: the base roughness."));
	TAutoConsoleVariable<float> CVarSmokeSpecular(TEXT("wl.Shadow.Specular"), 0.55f,
		TEXT("Shadow smoke look: the specular level."));
	TAutoConsoleVariable<float> CVarSmokeRimAmp(TEXT("wl.Shadow.RimAmp"), 1.0f,
		TEXT("Shadow smoke look: the grazing-angle rim's amplitude (RimAmp)."));
	TAutoConsoleVariable<float> CVarSmokeRimLift(TEXT("wl.Shadow.RimLift"), 0.30f,
		TEXT("Shadow smoke look: how far a LIGHT colour's rim tint is lifted toward white (scaled by how light it is)."));
	TAutoConsoleVariable<float> CVarSmokeRimTop(TEXT("wl.Shadow.RimTop"), 0.85f,
		TEXT("Shadow smoke look: the rim tint's strongest channel, reached by scaling the colour up (hue and saturation kept)."));
	TAutoConsoleVariable<float> CVarSmokeRimGain(TEXT("wl.Shadow.RimGain"), 0.60f,
		TEXT("Shadow smoke look: the rim's emissive gain (RimColor = tint x gain, at grazing angles)."));
	TAutoConsoleVariable<float> CVarSmokeRimFloor(TEXT("wl.Shadow.RimFloor"), 0.10f,
		TEXT("Shadow smoke look: the darkest the rim's tint may be, so black keeps readable dark-grey highlights."));
	TAutoConsoleVariable<float> CVarSmokeStripRimGain(TEXT("wl.Shadow.StripRimGain"), 0.25f,
		TEXT("Shadow smoke look: the STRIPS' rim gain when a strip colour is chosen -- low, as the founder asked the strips' edges to be subtle."));
	TAutoConsoleVariable<int32> CVarSmokeStripRelief(TEXT("wl.Shadow.StripRelief"), 1,
		TEXT("Shadow smoke look: 1 = the strips take the relief too when recoloured, 0 = only their tinted edge."));
	TAutoConsoleVariable<int32> CVarSmokeOnDefault(TEXT("wl.Shadow.OnDefault"), 0,
		TEXT("Shadow smoke look: 0 = the DEFAULT colours keep the designed look exactly (RC11); 1 = they wear the smoke look too (for comparison)."));

	UTexture* SmokeTexture()
	{
		// LOADED ONCE PER NAME, and only from the project's own texture folder: the name is a console value, never a path.
		static FString LoadedName;
		static TWeakObjectPtr<UTexture> Loaded;
		const FString Name = CVarSmokeNormalTex.GetValueOnGameThread().TrimStartAndEnd();
		if (Name.IsEmpty() || Name.Equals(TEXT("none"), ESearchCase::IgnoreCase) || !WonderlandBeta::IsSafeId(Name))
		{
			return nullptr;
		}
		if (Name != LoadedName || !Loaded.IsValid())
		{
			LoadedName = Name;
			Loaded = LoadObject<UTexture>(nullptr, *FString::Printf(TEXT("/Game/Wonderland/Textures/%s.%s"), *Name, *Name));
			if (!Loaded.IsValid())
			{
				UE_LOG(LogTemp, Warning, TEXT("WLMASCOT smoke look: no cooked texture '%s'; the relief is procedural only"), *Name);
			}
		}
		return Loaded.Get();
	}
}

namespace WonderlandMascotStyle
{
	FLinearColor FlameColour()
	{
		LoadFlameColour();
		return GFlameColour;
	}

	bool ParseFlameColour(const FString& Text, FLinearColor& Out)
	{
		return ReadFlameColourText(Text, Out);
	}

	bool HasChosenFlame()
	{
		const FLinearColor Colour = FlameColour();
		return !(Colour.R >= 0.995f && Colour.G >= 0.995f && Colour.B >= 0.995f);
	}

	const TArray<TPair<FName, FLinearColor>>& PrimaryPalette()
	{
		// made on the first call, at run time: never names created during static initialisation (WonderlandBeta.h)
		static const TArray<TPair<FName, FLinearColor>> Swatches = []()
		{
			TArray<TPair<FName, FLinearColor>> Out;
			const TArray<TPair<FName, FLinearColor>>& Shared = Palette();
			Out.Add(Shared[0]);   // DEFAULT, first, as in every row
			Out.Add({FName(TEXT("WHITE")), FLinearColor(1.0f, 1.0f, 1.0f, 1.0f)});
			Out.Add({FName(TEXT("BLACK")), FLinearColor(0.0f, 0.0f, 0.0f, 1.0f)});
			for (int32 Index = 1; Index < Shared.Num(); ++Index)
			{
				Out.Add(Shared[Index]);
			}
			return Out;
		}();
		return Swatches;
	}

	bool ParsePrimaryChoice(const FString& Text, bool& bOutChosen)
	{
		return ReadPrimaryChoiceText(Text, bOutChosen);
	}

	bool HasChosenPrimary()
	{
		const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
		if (!Style.bChosen)
		{
			return false;
		}
		LoadPrimaryChoice();
		if (GPrimaryChoice >= 0)
		{
			return GPrimaryChoice == 1;
		}
		// NO FILE: what the colourway meant before it -- white was "as designed", anything else a choice
		return !(Style.Primary.R >= 0.995f && Style.Primary.G >= 0.995f && Style.Primary.B >= 0.995f);
	}

	void PickMascotPrimary(FName Key, const FLinearColor& Colour)
	{
		static const FName Default(TEXT("DEFAULT"));
		if (UWonderlandMascotStyleSettings* Style = GetMutableDefault<UWonderlandMascotStyleSettings>())
		{
			Style->Primary = FLinearColor(FMath::Clamp(Colour.R, 0.0f, 1.0f), FMath::Clamp(Colour.G, 0.0f, 1.0f), FMath::Clamp(Colour.B, 0.0f, 1.0f), 1.0f);
			Style->bChosen = true;
			SavePrimaryChoice(Key != Default);
			// THROUGH THE ONE DOOR, like every other row: the Dog, the Wardrobe's mannequin and both rows' rings move together.
			SaveAndApply();
			UE_LOG(LogTemp, Display, TEXT("WLMASCOT PRIMARY %s = %s (%s)"), *Key.ToString(), *Style->Primary.ToString(),
				Key == Default ? TEXT("as designed") : TEXT("chosen, pure on `primary` surfaces"));
		}
	}

	bool IsMascotPrimaryOn(FName Key, const FLinearColor& Colour)
	{
		static const FName Default(TEXT("DEFAULT"));
		if (Key == Default)
		{
			return !HasChosenPrimary();
		}
		return HasChosenPrimary() && UWonderlandMascotStyleSettings::Get().Primary.Equals(Colour, 0.01f);
	}

	bool IsPrimaryChannel(FName Channel)
	{
		// made on the first call, at run time (see IsFlameChannel)
		static const FName Primary(TEXT("primary"));
		return Channel == Primary;
	}

	void SetFlameColour(const FLinearColor& Colour)
	{
		LoadFlameColour();
		GFlameColour = FLinearColor(FMath::Clamp(Colour.R, 0.0f, 1.0f), FMath::Clamp(Colour.G, 0.0f, 1.0f), FMath::Clamp(Colour.B, 0.0f, 1.0f), 1.0f);
		// SAVED THE MOMENT IT IS PICKED, whole or not at all, like every other choice the player makes here.
		WonderlandBeta::SaveTextAtomically(FlameColourPath(),
			FString::Printf(TEXT("%.4f %.4f %.4f"), GFlameColour.R, GFlameColour.G, GFlameColour.B));
	}

	bool IsFlameChannel(FName Channel)
	{
		// made on the first call, at run time: never a name created during static initialisation (WonderlandBeta.h)
		static const FName Flame(TEXT("flame"));
		static const FName FlameLight(TEXT("flame_light"));
		return Channel == Flame || Channel == FlameLight;
	}

	bool WornSkinHasFlame()
	{
		if (GEngine == nullptr)
		{
			return false;
		}
		for (const FWorldContext& Context : GEngine->GetWorldContexts())
		{
			const UWorld* World = Context.World();
			if (World == nullptr || !World->IsGameWorld())
			{
				continue;
			}
			// THE PLAYER'S OWN DOG. Relay OG wears no costume (WearSkin destroys it), so its answer is no.
			const APlayerController* Controller = World->GetFirstPlayerController();
			const ARelayDogCharacter* Dog = Controller != nullptr ? Cast<ARelayDogCharacter>(Controller->GetPawn()) : nullptr;
			if (Dog != nullptr)
			{
				const AWonderlandCompanionEmbodiment* Costume = Dog->GetCostume();
				return Costume != nullptr && Costume->DeclaresFlame();
			}
		}
		return false;
	}

	bool HasChosenStrip()
	{
		LoadStripColour();
		return GStripChosen;
	}

	FLinearColor StripColour()
	{
		LoadStripColour();
		return GStripColour;
	}

	void PickMascotStrip(FName Key, const FLinearColor& Colour)
	{
		static const FName Default(TEXT("DEFAULT"));
		SaveStripColour(Key != Default, Colour);
		// THROUGH THE ONE DOOR, like every other row: the Dog, the Wardrobe's mannequin and both rows' rings move together.
		SaveAndApply();
		UE_LOG(LogTemp, Display, TEXT("WLMASCOT STRIPS %s = %s (%s)"), *Key.ToString(), *GStripColour.ToString(),
			GStripChosen ? TEXT("chosen, the strips only") : TEXT("as designed"));
	}

	bool IsMascotStripOn(FName Key, const FLinearColor& Colour)
	{
		static const FName Default(TEXT("DEFAULT"));
		if (Key == Default)
		{
			return !HasChosenStrip();
		}
		return HasChosenStrip() && StripColour().Equals(Colour, 0.01f);
	}

	bool ParseStripColour(const FString& Text, bool& bOutChosen, FLinearColor& OutColour)
	{
		return ReadStripText(Text, bOutChosen, OutColour);
	}

	bool IsStripChannel(FName Channel)
	{
		// made on the first call, at run time (see IsFlameChannel)
		static const FName Strip(TEXT("strip"));
		return Channel == Strip;
	}

	bool WornSkinHasStrips()
	{
		if (GEngine == nullptr)
		{
			return false;
		}
		for (const FWorldContext& Context : GEngine->GetWorldContexts())
		{
			const UWorld* World = Context.World();
			if (World == nullptr || !World->IsGameWorld())
			{
				continue;
			}
			const APlayerController* Controller = World->GetFirstPlayerController();
			const ARelayDogCharacter* Dog = Controller != nullptr ? Cast<ARelayDogCharacter>(Controller->GetPawn()) : nullptr;
			if (Dog != nullptr)
			{
				const AWonderlandCompanionEmbodiment* Costume = Dog->GetCostume();
				return Costume != nullptr && Costume->DeclaresStrips();
			}
		}
		return false;
	}

	void ResetChoiceFiles()
	{
		SavePrimaryChoice(false);
		SaveStripColour(false, FLinearColor::Black);
	}

	bool IsSmokeLook(FName Look)
	{
		// made on the first call, at run time (see IsFlameChannel)
		static const FName Smoke(TEXT("smoke"));
		return Look == Smoke;
	}

	FLinearColor SmokeRimTint(const FLinearColor& Base)
	{
		// THE SAME HUE, BRIGHTER -- never a multiply by another colour. The colour is scaled up until its strongest channel
		// reaches wl.Shadow.RimTop, which keeps its hue AND its saturation (the designed navy's edges come out a clear
		// blue, crimson's a brighter crimson, not pink), then lifted toward white only in proportion to how light and how
		// unsaturated it already is (white and pale colours separate by a paler edge; dark ones never wash to pastel).
		const float Top = FMath::Max3(Base.R, Base.G, Base.B);
		const float Floor = FMath::Clamp(CVarSmokeRimFloor.GetValueOnGameThread(), 0.0f, 0.5f);
		if (Top < 0.0001f)
		{
			// BLACK: readable dark-grey highlights, not nothing (founder: "retain readable dark-gray highlights ... details
			// cannot disappear into a completely crushed black surface")
			return FLinearColor(Floor, Floor, Floor, 1.0f);
		}
		const float Target = FMath::Max(Top, FMath::Clamp(CVarSmokeRimTop.GetValueOnGameThread(), 0.05f, 1.0f));
		FLinearColor Tint = Base * (Target / Top);
		// pale and unsaturated colours separate by a paler edge; a saturated one (crimson, azure, jade) keeps its saturation, so
		// its highlight is a brighter crimson rather than pink
		const float Saturation = (Top - FMath::Min3(Base.R, Base.G, Base.B)) / Top;
		const float Lift = FMath::Clamp(CVarSmokeRimLift.GetValueOnGameThread(), 0.0f, 1.0f) * Top * (1.0f - Saturation);
		Tint = FLinearColor(Tint.R + (1.0f - Tint.R) * Lift, Tint.G + (1.0f - Tint.G) * Lift, Tint.B + (1.0f - Tint.B) * Lift, 1.0f);
		// and never darker than the floor, raised as a grey so the hue is kept
		const float NewTop = FMath::Max3(Tint.R, Tint.G, Tint.B);
		if (NewTop < Floor)
		{
			const float Raise = Floor - NewTop;
			Tint = FLinearColor(Tint.R + Raise, Tint.G + Raise, Tint.B + Raise, 1.0f);
		}
		return FLinearColor(FMath::Min(Tint.R, 1.0f), FMath::Min(Tint.G, 1.0f), FMath::Min(Tint.B, 1.0f), 1.0f);
	}

	float SmokeRimGain()
	{
		return FMath::Clamp(CVarSmokeRimGain.GetValueOnGameThread(), 0.0f, 8.0f);
	}

	void ApplySmokeDetail(UMaterialInstanceDynamic* Instance)
	{
		if (Instance == nullptr)
		{
			return;
		}
		// EVERYTHING BUT THE COLOURS AND THE RIM'S AMPLITUDE: the relief, the roughness that wanders, the specular. The base and
		// the rim tint are the caller's (ApplyColourway), so the pure-colour rule is decided in exactly one place.
		if (UTexture* Relief = SmokeTexture())
		{
			Instance->SetTextureParameterValue(TEXT("NormalTex"), Relief);
		}
		Instance->SetScalarParameterValue(TEXT("TexScale"), FMath::Clamp(CVarSmokeTexScale.GetValueOnGameThread(), 0.0005f, 0.5f));
		Instance->SetScalarParameterValue(TEXT("DetailAmp"), FMath::Clamp(CVarSmokeDetailAmp.GetValueOnGameThread(), 0.0f, 0.6f));
		Instance->SetScalarParameterValue(TEXT("RoughVary"), FMath::Clamp(CVarSmokeRoughVary.GetValueOnGameThread(), 0.0f, 3.5f));
		Instance->SetScalarParameterValue(TEXT("Roughness"), FMath::Clamp(CVarSmokeRoughness.GetValueOnGameThread(), 0.05f, 1.0f));
		Instance->SetScalarParameterValue(TEXT("Specular"), FMath::Clamp(CVarSmokeSpecular.GetValueOnGameThread(), 0.0f, 1.0f));
		// RimAmp is NOT written here: the night's rim boost owns it too (AWonderlandCompanionEmbodiment::SetRimBoost), so the
		// embodiment writes boost x SmokeRimAmp() in both places.
	}

	float SmokeRimAmp()
	{
		return FMath::Clamp(CVarSmokeRimAmp.GetValueOnGameThread(), 0.0f, 4.0f);
	}

	float SmokeStripRimGain()
	{
		return FMath::Clamp(CVarSmokeStripRimGain.GetValueOnGameThread(), 0.0f, 8.0f);
	}

	bool SmokeStripRelief()
	{
		return CVarSmokeStripRelief.GetValueOnGameThread() != 0;
	}

	bool SmokeOnDefault()
	{
		return CVarSmokeOnDefault.GetValueOnGameThread() != 0;
	}

	FString SmokeTextureName()
	{
		const UTexture* Relief = SmokeTexture();
		return Relief != nullptr ? Relief->GetName() : FString(TEXT("none"));
	}

	void RestoreSmokeDetail(UMaterialInstanceDynamic* Instance)
	{
		// BACK TO THE DESIGNED LOOK: every parameter ApplySmokeDetail wrote, put back to what the parent material says --
		// the parent's own defaults, read from it rather than remembered here -- and DetailAmp to the 0 every figure rim is
		// built with (AWonderlandCompanionEmbodiment's build loop). Picking DEFAULT after a colour leaves nothing behind.
		if (Instance == nullptr || Instance->Parent == nullptr)
		{
			return;
		}
		UTexture* Relief = nullptr;
		if (Instance->Parent->GetTextureParameterValue(FMaterialParameterInfo(TEXT("NormalTex")), Relief) && Relief != nullptr)
		{
			Instance->SetTextureParameterValue(TEXT("NormalTex"), Relief);
		}
		static const TCHAR* const Scalars[] = { TEXT("TexScale"), TEXT("RoughVary"), TEXT("Roughness"), TEXT("Specular") };
		for (const TCHAR* Name : Scalars)
		{
			float Value = 0.0f;
			if (Instance->Parent->GetScalarParameterValue(FMaterialParameterInfo(Name), Value))
			{
				Instance->SetScalarParameterValue(Name, Value);
			}
		}
		Instance->SetScalarParameterValue(TEXT("DetailAmp"), 0.0f);
	}

	FString DescribeSmokeLook()
	{
		const UTexture* Relief = SmokeTexture();
		return FString::Printf(TEXT("relief %s at TexScale %.4f, DetailAmp %.2f, RoughVary %.2f, Roughness %.2f, Specular %.2f, RimAmp %.2f, rim top %.2f lift %.2f gain %.2f floor %.2f, strips rim gain %.2f relief %s, on DEFAULT %s"),
			Relief != nullptr ? *Relief->GetName() : TEXT("none"), CVarSmokeTexScale.GetValueOnGameThread(), CVarSmokeDetailAmp.GetValueOnGameThread(),
			CVarSmokeRoughVary.GetValueOnGameThread(), CVarSmokeRoughness.GetValueOnGameThread(), CVarSmokeSpecular.GetValueOnGameThread(),
			CVarSmokeRimAmp.GetValueOnGameThread(), CVarSmokeRimTop.GetValueOnGameThread(), CVarSmokeRimLift.GetValueOnGameThread(),
			CVarSmokeRimGain.GetValueOnGameThread(), CVarSmokeRimFloor.GetValueOnGameThread(), CVarSmokeStripRimGain.GetValueOnGameThread(),
			SmokeStripRelief() ? TEXT("yes") : TEXT("no"), SmokeOnDefault() ? TEXT("yes") : TEXT("no (designed look kept)"));
	}
}

namespace
{
	/** Repaint every Relay Dog standing in a live world, and say how many there were.
	 *
	 * WHY THIS EXISTS. zc_mascot_persist read the colour back off the Dog's own material instances and found
	 * none at all -- not the wrong colour, no dynamic materials whatsoever. PaintCanonBody had exactly one
	 * caller, inside WearSkin on the canon branch, so choosing a colour saved a setting and touched nothing:
	 * the Dog already in the world kept its old materials until the player happened to re-wear Relay OG. The
	 * photographs missed it because opening the Wardrobe re-wears a skin, which repaints on the way past.
	 *
	 * Every world is walked rather than just the first: PIE can have more than one, and a console command
	 * the founder types should mean the same thing in all of them.
	 */
	int32 RepaintLiveDogs(bool bEvenIfUnchosen = false)
	{
		int32 Painted = 0;
		if (GEngine == nullptr)
		{
			return 0;
		}
		for (const FWorldContext& Context : GEngine->GetWorldContexts())
		{
			UWorld* World = Context.World();
			if (World == nullptr || !World->IsGameWorld())
			{
				continue;
			}
			for (TActorIterator<ARelayDogCharacter> It(World); It; ++It)
			{
				It->PaintCanonBody(bEvenIfUnchosen);
				++Painted;
			}
		}
		return Painted;
	}

	/** Parse "R,G,B" or "#RRGGBB" so the founder can try a colour without a rebuild. */
	bool ReadColour(const FString& Text, FLinearColor& Out)
	{
		FString Clean = Text.TrimStartAndEnd();
		if (Clean.StartsWith(TEXT("#")))
		{
			Out = FLinearColor(FColor::FromHex(Clean));
			return true;
		}
		TArray<FString> Parts;
		Clean.ParseIntoArray(Parts, TEXT(","), true);
		if (Parts.Num() < 3)
		{
			return false;
		}
		Out = FLinearColor(FCString::Atof(*Parts[0]), FCString::Atof(*Parts[1]), FCString::Atof(*Parts[2]), 1.0f);
		return true;
	}

	void SetAndSave(const TArray<FString>& Args, bool bPrimary)
	{
		UWonderlandMascotStyleSettings* Settings = GetMutableDefault<UWonderlandMascotStyleSettings>();
		if (Settings == nullptr || Args.Num() < 1)
		{
			UE_LOG(LogTemp, Warning, TEXT("WLMASCOT usage: wl.Mascot.%s <r,g,b | #RRGGBB>"),
				bPrimary ? TEXT("Primary") : TEXT("Secondary"));
			return;
		}
		FLinearColor Colour;
		if (!ReadColour(FString::Join(Args, TEXT("")), Colour))
		{
			UE_LOG(LogTemp, Warning, TEXT("WLMASCOT could not read a colour from '%s'"), *FString::Join(Args, TEXT(" ")));
			return;
		}
		(bPrimary ? Settings->Primary : Settings->Secondary) = Colour;
		Settings->bChosen = true;
		Settings->bSecondaryChosen |= !bPrimary;
		if (bPrimary)
		{
			SavePrimaryChoice(true);   // a colour typed at the console is a real choice, white included
		}
		// THROUGH THE SAME DOOR AS THE WARDROBE AND THE MENU. This used to save and repaint by itself, which
		// made the console a third writer of a state the founder asked to have exactly one of.
		WonderlandMascotStyle::SaveAndApply();
		UE_LOG(LogTemp, Display, TEXT("WLMASCOT %s = %s (saved and applied)"),
			bPrimary ? TEXT("PRIMARY") : TEXT("SECONDARY"), *Colour.ToString());
	}

	/** Repaint every AI Companion body standing in a live world. Cubs are NOT touched: they are not companions. */
	int32 RepaintLiveCompanions()
	{
		int32 Painted = 0;
		if (GEngine == nullptr)
		{
			return 0;
		}
		for (const FWorldContext& Context : GEngine->GetWorldContexts())
		{
			UWorld* World = Context.World();
			if (World == nullptr || !World->IsGameWorld())
			{
				continue;
			}
			for (TActorIterator<AWonderlandCompanionEmbodiment> It(World); It; ++It)
			{
				// EVERY BODY, INCLUDING THE DOG'S COSTUME AND THE WARDROBE'S MANNEQUIN, because all three wear
				// a colourway -- but each reads the colourway meant for it, which the embodiment decides from
				// what it is. A Sub-Agent Cub's body is left exactly as it is: the founder asked that companion
				// colour never reach a Cub, and a Cub is told apart here by the actor that owns it.
				It->RepaintColourway();
				++Painted;
			}
		}
		return Painted;
	}

	FAutoConsoleCommand GMascotPrimary(
		TEXT("wl.Mascot.Primary"),
		TEXT("The mascot's main colourway: wl.Mascot.Primary <r,g,b | #RRGGBB>. Saved."),
		FConsoleCommandWithArgsDelegate::CreateStatic(&SetAndSave, true));

	FAutoConsoleCommand GMascotSecondary(
		TEXT("wl.Mascot.Secondary"),
		TEXT("The Relay Dog's eyes and a skin's secondary accents (Jack Flame's tie and suit): wl.Mascot.Secondary <r,g,b | #RRGGBB>. Saved."),
		FConsoleCommandWithArgsDelegate::CreateStatic(&SetAndSave, false));

	FAutoConsoleCommand GMascotFlame(
		TEXT("wl.Mascot.Flame"),
		TEXT("A flame skin's fire, on its own -- Jack Flame, Skeleton Flame, Baal: wl.Mascot.Flame <r,g,b | #RRGGBB | default>. Saved."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			FLinearColor Colour = FLinearColor::White;
			const FString Text = FString::Join(Args, TEXT(""));
			if (Text.IsEmpty() || (!Text.Equals(TEXT("default"), ESearchCase::IgnoreCase) && !ReadColour(Text, Colour)))
			{
				UE_LOG(LogTemp, Warning, TEXT("WLMASCOT usage: wl.Mascot.Flame <r,g,b | #RRGGBB | default>"));
				return;
			}
			WonderlandMascotStyle::SetFlameColour(Colour);
			WonderlandMascotStyle::SaveAndApply();
			UE_LOG(LogTemp, Display, TEXT("WLMASCOT FLAME = %s (saved and applied)"), *WonderlandMascotStyle::FlameColour().ToString());
		}));

	FAutoConsoleCommand GMascotStrips(
		TEXT("wl.Mascot.Strips"),
		TEXT("Shadow's strips, on their own (COLOR 3): wl.Mascot.Strips <PRIMARY-row swatch name, e.g. CYAN | r,g,b | #RRGGBB | default>. Saved."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString Text = FString::Join(Args, TEXT(""));
			if (Text.Equals(TEXT("default"), ESearchCase::IgnoreCase))
			{
				WonderlandMascotStyle::PickMascotStrip(FName(TEXT("DEFAULT")), FLinearColor::Black);
				return;
			}
			// a swatch by its name first (the rows' own words), then a colour typed out
			for (const TPair<FName, FLinearColor>& Swatch : WonderlandMascotStyle::PrimaryPalette())
			{
				if (Swatch.Key.ToString().Equals(Text, ESearchCase::IgnoreCase))
				{
					WonderlandMascotStyle::PickMascotStrip(Swatch.Key, Swatch.Value);
					return;
				}
			}
			FLinearColor Colour = FLinearColor::White;
			if (Text.IsEmpty() || !ReadColour(Text, Colour))
			{
				UE_LOG(LogTemp, Warning, TEXT("WLMASCOT usage: wl.Mascot.Strips <swatch name | r,g,b | #RRGGBB | default>"));
				return;
			}
			WonderlandMascotStyle::PickMascotStrip(FName(TEXT("TYPED")), Colour);
		}));

	FAutoConsoleCommand GMascotReset(
		TEXT("wl.Mascot.Reset"),
		TEXT("Put the mascot back to the colours its skins were designed in."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			if (UWonderlandMascotStyleSettings* Settings = GetMutableDefault<UWonderlandMascotStyleSettings>())
			{
				Settings->Primary = FLinearColor::White;
				Settings->Secondary = FLinearColor(1.00f, 0.78f, 0.16f, 1.0f);
				Settings->bChosen = false;
				Settings->bSecondaryChosen = false;
			}
			// THE SMALL FILES: the primary back to DEFAULT and the strips (COLOR 3) back to the designed black
			WonderlandMascotStyle::ResetChoiceFiles();
			// AND THE FIRE: the designed flames are part of "the colours its skins were designed in".
			WonderlandMascotStyle::SetFlameColour(FLinearColor::White);
			// THROUGH THE ONE DOOR. SaveAndApply repaints even when nothing is chosen, which is exactly what a
			// reset needs: a paint that returned early on bChosen is what once left magenta on the Dog.
			WonderlandMascotStyle::SaveAndApply();
			UE_LOG(LogTemp, Display, TEXT("WLMASCOT colours reset to the designed ones"));
		}));
}

namespace WonderlandMascotStyle
{
	void SaveAndApply()
	{
		if (UWonderlandMascotStyleSettings* Settings = GetMutableDefault<UWonderlandMascotStyleSettings>())
		{
			// SAVED IMMEDIATELY, because a colour the player picks and loses on exit is not a preference.
			Settings->SaveConfig();
		}
		// TRUE even when nothing has been chosen: this is also the path RESET takes, and a repaint that
		// returned early on bChosen is exactly what once left magenta on the Dog after a reset.
		RepaintLiveDogs(true);
		RepaintLiveCompanions();
		// THE SLATE SURFACES TOO. A terminal's accent is baked into brushes when its panel is constructed, so a
		// running terminal keeps the old gold until it is asked to build again -- which is what makes a colour
		// picked in the Menu look like it did nothing. Rebuilding the HUD is what "live" means for those.
		if (GEngine != nullptr)
		{
			GEngine->Exec(nullptr, TEXT("wl.Hud.Refresh"));
		}
		OnChanged().Broadcast();
	}
}

// ---------------------------------------------------------------------------------------------------------
// THE TERMINAL AND ACCENT THEME.
//
// Kept beside the mascot's colours because it is the same idea applied to the other half of the screen: one
// value, saved, that every surface reads rather than each remembering its own.
#include "WonderlandUiStyle.h"

namespace
{
	/** The gold that was hard-coded in WonderlandUiStyle.h, which is what an untouched install must still show. */
	FLinearColor GThemeAccent = FLinearColor(FColor(0xD9, 0xA4, 0x41));
	bool GThemeAccentLoaded = false;
}

namespace WonderlandUi
{
	FLinearColor ThemeAccent()
	{
		if (!GThemeAccentLoaded)
		{
			GThemeAccentLoaded = true;
			if (const UWonderlandMascotStyleSettings* Settings = GetDefault<UWonderlandMascotStyleSettings>())
			{
				if (Settings->bTerminalAccentChosen)
				{
					GThemeAccent = Settings->TerminalAccent;
				}
			}
		}
		return GThemeAccent;
	}

	/**
	 * THE TWO TERMINALS, SEPARATELY (founder, 2026-09-25: "real color customization in the MENU tab for (A)
	 * Julius Live Terminal, (B) AI Companion terminals").
	 *
	 * Each falls back to the shared accent until it has been chosen, so an install that has asked for nothing
	 * still shows Wonderland's own gold everywhere and the two cannot silently drift apart.
	 *
	 * READ EVERY TIME rather than cached like ThemeAccent above: these are chosen from a panel the player has
	 * open, and the cached one needs a HUD rebuild to take -- which is fine for a console command and wrong for
	 * a swatch the player just clicked.
	 */
	FLinearColor JuliusAccent()
	{
		const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
		return Style.bJuliusTerminalAccentChosen ? Style.JuliusTerminalAccent : ThemeAccent();
	}

	FLinearColor CompanionAccent()
	{
		const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
		return Style.bCompanionTerminalAccentChosen ? Style.CompanionTerminalAccent : ThemeAccent();
	}

	/**
	 * THE WORDS INSIDE EACH TERMINAL -- the secondary colour, read by the lettering and by nothing structural.
	 *
	 * Falls back to Cream(), which is what the lettering has always been, so this is invisible until the
	 * founder chooses something. Read every time for the same reason the accents are: it is chosen from a
	 * panel that is open while it is being chosen.
	 */
	FLinearColor JuliusText()
	{
		const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
		return Style.bJuliusTerminalTextChosen ? Style.JuliusTerminalTextColor : Cream();
	}

	/**
	 * ONE SECONDARY FOR EVERY TERMINAL. FOUNDER, 2026-09-28 (correction pass): "The same Secondary terminal color
	 * customization must change the LETTER COLORS of the companion terminals as well ... Secondary must propagate
	 * consistently to: Julius Live Terminal text, Claude Code companion terminal text, ChatGPT companion terminal
	 * text."
	 *
	 * So the companions follow the Julius Live Terminal's Secondary. Their own row still exists and still wins
	 * when it was picked more recently -- picking the Live Terminal's Secondary clears it (see the Colors page and
	 * PickTerminalTextColour), so the last colour the founder picked for the terminals is the one all three wear.
	 */
	FLinearColor CompanionText()
	{
		const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
		return Style.bCompanionTerminalTextChosen ? Style.CompanionTerminalTextColor : JuliusText();
	}

	/**
	 * THE SAME LETTERING, DIMMED: resting lines, sub-lines, notes. Before anything is chosen this is the Dim()
	 * those lines have always been drawn in, so an untouched install is unchanged. Once a Secondary is chosen the
	 * dimmed lines wear it too, at reduced opacity over the dark plate -- otherwise an idle terminal, which is
	 * almost all resting lines, would show no change at all when the Secondary moves.
	 */
	FLinearColor JuliusTextDim()
	{
		const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
		const FLinearColor Words = JuliusText();
		return Style.bJuliusTerminalTextChosen ? FLinearColor(Words.R, Words.G, Words.B, 0.62f) : Dim();
	}

	FLinearColor CompanionTextDim()
	{
		const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
		const FLinearColor Words = CompanionText();
		return (Style.bCompanionTerminalTextChosen || Style.bJuliusTerminalTextChosen)
			? FLinearColor(Words.R, Words.G, Words.B, 0.62f) : Dim();
	}

	/**
	 * THE MENU'S OWN ACCENT, and only its accent.
	 *
	 * FOUNDER: "Update the intentional accent surfaces WITHOUT making text unreadable. Do not indiscriminately
	 * tint every element." So this is read by headings, key hints and the chosen tab. Nothing reads it for a
	 * background or for body text, which is what makes every choice in the palette safe.
	 */
	FLinearColor MenuAccent()
	{
		const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
		return Style.bMenuAccentChosen ? Style.MenuAccent : ThemeAccent();
	}
}

namespace
{
	FAutoConsoleCommand GTerminalAccent(
		TEXT("wl.Theme.Accent"),
		TEXT("The colour every terminal, preset command and accent is drawn in: wl.Theme.Accent <r,g,b | #RRGGBB>. Saved."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			UWonderlandMascotStyleSettings* Settings = GetMutableDefault<UWonderlandMascotStyleSettings>();
			// Initialised for the same reason as the rect above: unread unless ReadColour succeeded, but a
			// colour read off the stack would be a real bug rather than a warning.
			FLinearColor Colour = FLinearColor::White;
			if (Settings == nullptr || Args.Num() < 1 || !ReadColour(FString::Join(Args, TEXT("")), Colour))
			{
				UE_LOG(LogTemp, Warning, TEXT("WLTHEME usage: wl.Theme.Accent <r,g,b | #RRGGBB>"));
				return;
			}
			Settings->TerminalAccent = Colour;
			Settings->bTerminalAccentChosen = true;
			Settings->SaveConfig();
			GThemeAccent = Colour;
			GThemeAccentLoaded = true;
			// REBUILT, NOT WAITED FOR. The brushes that carry this colour are made once when a panel is
			// constructed, so a running terminal keeps the old gold until it is asked to build again.
			if (GEngine != nullptr)
			{
				GEngine->Exec(nullptr, TEXT("wl.Hud.Refresh"));
			}
			UE_LOG(LogTemp, Display, TEXT("WLTHEME accent = %s (saved)"), *Colour.ToString());
		}));

	FAutoConsoleCommand GTerminalAccentReset(
		TEXT("wl.Theme.Reset"),
		TEXT("Put every terminal and accent back to Wonderland's own gold."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			if (UWonderlandMascotStyleSettings* Settings = GetMutableDefault<UWonderlandMascotStyleSettings>())
			{
				Settings->bTerminalAccentChosen = false;
				Settings->SaveConfig();
			}
			GThemeAccent = FLinearColor(FColor(0xD9, 0xA4, 0x41));
			GThemeAccentLoaded = true;
			if (GEngine != nullptr) { GEngine->Exec(nullptr, TEXT("wl.Hud.Refresh")); }
			UE_LOG(LogTemp, Display, TEXT("WLTHEME accent reset to Wonderland gold"));
		}));
}
