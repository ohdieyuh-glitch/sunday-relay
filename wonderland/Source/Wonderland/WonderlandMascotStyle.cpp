#include "WonderlandMascotStyle.h"

#include "RelayDogCharacter.h"
#include "WonderlandCompanionEmbodiment.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "EngineUtils.h"

#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/Texture.h"
#include "Engine/Texture2D.h"
#include "TextureResource.h"
#include "UObject/Package.h"
#include "HAL/PlatformTime.h"
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

	bool ReadNumberTriple(const FString& Text, float MaxChannel, FLinearColor& Out);

	/** THREE NUMBERS IN 0..1, or nothing. A hand edit, a corrupted file or a NaN is not a colour; it is the designed fire. */
	bool ReadFlameColourText(const FString& Text, FLinearColor& Out)
	{
		return ReadNumberTriple(Text, 1.0f, Out);
	}

	/**
	 * THREE NUMBERS IN 0..MaxChannel, or nothing (B65.6, Second's round-5 review: the DarkVeinTint "0.90 0.96 1.10" is a TINT -- a
	 * multiplier, so a channel above 1 is its whole point -- and the 0..1 colour reader refused it, so every console value with a
	 * channel over 1 was silently replaced by the hard-coded default while the look line printed the refused string).
	 */
	bool ReadNumberTriple(const FString& Text, float MaxChannel, FLinearColor& Out)
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
			if (!FMath::IsFinite(Values[Index]) || Values[Index] < 0.0f || Values[Index] > MaxChannel)
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
	TAutoConsoleVariable<FString> CVarSmokeNormalTex(TEXT("wl.Shadow.NormalTex"), TEXT("smoke"),
		TEXT("Shadow smoke look: 'smoke' = the smoke maps this file draws (B65.1, the default); or a cooked normal texture (/Game/Wonderland/Textures/<name>); 'none' for none."));
	TAutoConsoleVariable<float> CVarSmokeTexScale(TEXT("wl.Shadow.TexScale"), 0.022f,
		TEXT("Shadow smoke look: the relief's world projection scale (1 / uu per repeat)."));
	TAutoConsoleVariable<float> CVarSmokeDetailAmp(TEXT("wl.Shadow.DetailAmp"), 0.0f,
		TEXT("Shadow smoke look: the master's procedural normal noise (DetailAmp) on top of the relief; 0 = none (it scatters light into grey)."));
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
	TAutoConsoleVariable<float> CVarSmokeRimGain(TEXT("wl.Shadow.RimGain"), 0.80f,
		TEXT("Shadow smoke look: the rim's emissive gain (RimColor = tint x gain, at grazing angles)."));
	TAutoConsoleVariable<float> CVarSmokeRimFloor(TEXT("wl.Shadow.RimFloor"), 0.14f,
		TEXT("Shadow smoke look: the darkest the rim's tint may be, so black keeps readable dark-grey highlights."));
	TAutoConsoleVariable<float> CVarSmokeStripRimGain(TEXT("wl.Shadow.StripRimGain"), 0.25f,
		TEXT("Shadow smoke look: the STRIPS' rim gain when a strip colour is chosen -- low, as the founder asked the strips' edges to be subtle."));
	TAutoConsoleVariable<int32> CVarSmokeStripRelief(TEXT("wl.Shadow.StripRelief"), 1,
		TEXT("Shadow smoke look: 1 = the strips take the relief too when recoloured, 0 = only their tinted edge."));
	TAutoConsoleVariable<int32> CVarSmokeOnDefault(TEXT("wl.Shadow.OnDefault"), 1,
		TEXT("Shadow smoke look: 1 = the DEFAULT colours wear the smoke's detail too, with their own colours and rim (the founder's reference photo shows the default marbled); 0 = the designed look exactly (RC11)."));

	// ---- THE SMOKE MAPS (B65.1): wl.Shadow.NormalTex "smoke", the default. Every setting below draws a new pair when changed.
	TAutoConsoleVariable<int32> CVarSmokeCells(TEXT("wl.Shadow.SmokeCells"), 3,
		TEXT("Shadow smoke maps: billows across one tile (a tile is 1/TexScale uu)."));
	TAutoConsoleVariable<float> CVarSmokeWarp(TEXT("wl.Shadow.SmokeWarp"), 0.32f,
		TEXT("Shadow smoke maps: how far the billows are swirled, in tiles."));
	TAutoConsoleVariable<int32> CVarSmokeSeed(TEXT("wl.Shadow.SmokeSeed"), 7,
		TEXT("Shadow smoke maps: the pattern's seed."));
	TAutoConsoleVariable<int32> CVarSmokeTone(TEXT("wl.Shadow.SmokeTone"), 1,
		TEXT("Shadow smoke maps: 1 = the tone map (AlbedoTex) is worn with the drawn relief; 0 = the relief only."));
	TAutoConsoleVariable<float> CVarSmokeDark(TEXT("wl.Shadow.SmokeDark"), 0.45f,
		TEXT("Shadow smoke maps: the tone in the billows' hearts, as a fraction of the colour (1 = no tonal variation)."));
	TAutoConsoleVariable<float> CVarSmokeTonePower(TEXT("wl.Shadow.SmokeTonePower"), 1.3f,
		TEXT("Shadow smoke maps: how quickly the tone falls from the creases into the billows."));
	TAutoConsoleVariable<int32> CVarSmokeToneOctaves(TEXT("wl.Shadow.SmokeToneOctaves"), 4,
		TEXT("Shadow smoke maps: the tone's octaves (more = finer wisps)."));
	TAutoConsoleVariable<float> CVarSmokeToneGain(TEXT("wl.Shadow.SmokeToneGain"), 0.45f,
		TEXT("Shadow smoke maps: each finer octave's share of the tone."));
	TAutoConsoleVariable<float> CVarSmokeBump(TEXT("wl.Shadow.SmokeBump"), 0.10f,
		TEXT("Shadow smoke maps: the relief's strength (0 = flat)."));
	TAutoConsoleVariable<int32> CVarSmokeBumpOctaves(TEXT("wl.Shadow.SmokeBumpOctaves"), 2,
		TEXT("Shadow smoke maps: the relief's octaves (few, so it reads as billows and not as a crumple)."));
	TAutoConsoleVariable<float> CVarSmokeBumpGain(TEXT("wl.Shadow.SmokeBumpGain"), 0.35f,
		TEXT("Shadow smoke maps: each finer octave's share of the relief."));
	// ---- B65.3 THE PROFILES (founder, 2026-10-03: white must READ white at noon, the default needs the reference's bright blue
	// ---- marbling, black needs readable grey smoke). A colour's profile decides the base it is painted with and the depth of
	// ---- its tone map; the pattern (the field above) is shared, so every colourway is one material identity.
	// ---- B65.4 (Second, 10-03 after round 3b's frames: CORE's pixel read of the noon head gave DEFAULT (29,31,43) "dark navy
	// ---- streaks, not bright blue marbling", WHITE (157,135,113) "warm beige", BLACK (11,7,6) "no readable grey highlights").
	// ---- The founder's sheet shows a near-black body whose blue is LIGHT -- glowing edges and cracks -- not paint. So the
	// ---- designed body gets wider, brighter veins AND a blue edge glow (the rim term, which the master already carries), the
	// ---- light pick's glow is given in the scene's own units (B65.3 wrote 0.10 where the noon white is ~25,000: invisible), and
	// ---- the dark pick's smoke is a readable grey. Every value is a console variable: tune by eye, no rebuild.
	TAutoConsoleVariable<FString> CVarSmokeDefaultVein(TEXT("wl.Shadow.DefaultVein"), TEXT("0.28 0.55 1.00"),
		TEXT("Shadow smoke, the DESIGNED body: the colour of its bright veins (its cells are this x DefaultFloor)."));
	TAutoConsoleVariable<float> CVarSmokeDefaultFloor(TEXT("wl.Shadow.DefaultFloor"), 0.16f,
		TEXT("Shadow smoke, the DESIGNED body: the tone in the cells (B65.3's 0.045 photographed as near-black navy; B65.5 0.16 from variant VA)."));
	TAutoConsoleVariable<float> CVarSmokeDefaultPower(TEXT("wl.Shadow.DefaultPower"), 2.2f,
		TEXT("Shadow smoke, the DESIGNED body: how thin the bright veins are (higher = thinner; B65.3's 4 was too thin to read)."));
	TAutoConsoleVariable<FString> CVarSmokeDefaultRim(TEXT("wl.Shadow.DefaultRim"), TEXT("0.25 0.55 1.00"),
		TEXT("Shadow smoke, the DESIGNED body: the colour of its edge glow (the founder's sheet: blue light along every edge)."));
	// B65.5 (Second, round 4's variant VA): the rim term draws in SCENE units -- RimColor x RimAmp x Fresnel, no x1000 inside: 12 drew
	// nothing against the ~25,000 noon white, and B65.4's clamp at 40 kept every console value from reaching a visible edge
	TAutoConsoleVariable<float> CVarSmokeDefaultRimGain(TEXT("wl.Shadow.DefaultRimGain"), 6000.0f,
		TEXT("Shadow smoke, the DESIGNED body: the edge glow's strength in SCENE units (RimColor = the edge colour, 0..1 per channel, times this; the noon white is "
		     "~25,000 and the Fresnel weights it toward the silhouette). 0 keeps the designed rim exactly as before B65.4."));
	TAutoConsoleVariable<float> CVarSmokeDefaultGlow(TEXT("wl.Shadow.DefaultGlow"), 0.0f,
		TEXT("Shadow smoke, the DESIGNED body: a uniform glow in the edge-glow colour, in scene units (the founder's sheet glows blue "
		     "all over at night); 0 = none."));
	TAutoConsoleVariable<float> CVarSmokeLightValue(TEXT("wl.Shadow.LightValue"), 0.85f,
		TEXT("Shadow smoke: a pick whose strongest channel is at least this, and ..."));
	TAutoConsoleVariable<float> CVarSmokeLightSat(TEXT("wl.Shadow.LightSat"), 0.15f,
		TEXT("Shadow smoke: ... whose saturation is at most this, is LIGHT (white kept bright, soft marbling)."));
	TAutoConsoleVariable<float> CVarSmokeLightFloor(TEXT("wl.Shadow.LightFloor"), 0.85f,
		TEXT("Shadow smoke, a LIGHT pick: the tone in the billows (high, so white stays white)."));
	TAutoConsoleVariable<float> CVarSmokeLightPower(TEXT("wl.Shadow.LightPower"), 1.3f,
		TEXT("Shadow smoke, a LIGHT pick: how the tone falls from the creases into the billows."));
	TAutoConsoleVariable<float> CVarSmokeLightGlow(TEXT("wl.Shadow.LightGlow"), 0.22f,
		TEXT("Shadow smoke, a LIGHT pick: a NEUTRAL glow as a share of the noon white (~25,000 scene units), so white reads white in "
		     "shade and under the warm sun; 0 = none. B65.3 wrote this share straight into EmissiveStrength, which drew nothing."));
	TAutoConsoleVariable<float> CVarSmokeDarkValue(TEXT("wl.Shadow.DarkValue"), 0.06f,
		TEXT("Shadow smoke: a pick whose strongest channel is at most this is DARK (black cells, grey smoke veins)."));
	TAutoConsoleVariable<float> CVarSmokeDarkVein(TEXT("wl.Shadow.DarkVein"), 0.28f,
		TEXT("Shadow smoke, a DARK pick: the grey of its smoke veins (its cells are this x DarkFloor; B65.3's 0.08 did not read)."));
	TAutoConsoleVariable<FString> CVarSmokeDarkVeinTint(TEXT("wl.Shadow.DarkVeinTint"), TEXT("0.90 0.96 1.10"),
		TEXT("Shadow smoke, a DARK pick: the smoke grey's tint (round 4: the grey read BROWN under the warm sandstone bounce; a little cool "
		     "makes it read neutral grey). \"1 1 1\" = plain grey."));
	TAutoConsoleVariable<float> CVarSmokeDarkFloor(TEXT("wl.Shadow.DarkFloor"), 0.0f,
		TEXT("Shadow smoke, a DARK pick: the tone in the cells (0 = black)."));
	TAutoConsoleVariable<float> CVarSmokeDarkPower(TEXT("wl.Shadow.DarkPower"), 2.0f,
		TEXT("Shadow smoke, a DARK pick: how thin the grey veins are (B65.3's 3 was too thin)."));

	/**
	 * THE TINT AND THE EDGE COLOUR THAT ARE ACTUALLY DRAWN (B65.6). One reader each, used by the paint AND by the look line, so the line
	 * can never print a value the paint refused: a console value that does not parse keeps the designed default and says so.
	 */
	FLinearColor SmokeDarkTint(bool* bOutRefused = nullptr)
	{
		FLinearColor Parsed;
		const bool bRead = ReadNumberTriple(CVarSmokeDarkVeinTint.GetValueOnGameThread(), 2.0f, Parsed);
		if (bOutRefused != nullptr)
		{
			*bOutRefused = !bRead;
		}
		return bRead ? FLinearColor(Parsed.R, Parsed.G, Parsed.B, 1.0f) : FLinearColor(0.90f, 0.96f, 1.10f, 1.0f);
	}

	FLinearColor SmokeEdgeColour(bool* bOutRefused = nullptr)
	{
		FLinearColor Parsed;
		const bool bRead = ReadFlameColourText(CVarSmokeDefaultRim.GetValueOnGameThread(), Parsed);
		if (bOutRefused != nullptr)
		{
			*bOutRefused = !bRead;
		}
		return bRead ? FLinearColor(Parsed.R, Parsed.G, Parsed.B, 1.0f) : FLinearColor(0.25f, 0.55f, 1.00f, 1.0f);
	}

	/** "r g b" as drawn, plus "(console 'x' refused: the default)" when the console's value did not parse. */
	FString DescribeTriple(const FLinearColor& Drawn, bool bRefused, const FString& Raw)
	{
		const FString Values = FString::Printf(TEXT("%.2f %.2f %.2f"), Drawn.R, Drawn.G, Drawn.B);
		return bRefused ? FString::Printf(TEXT("%s (console '%s' refused: the default)"), *Values, *Raw.Left(40)) : Values;
	}

	TAutoConsoleVariable<float> CVarSmokeBumpSoft(TEXT("wl.Shadow.SmokeBumpSoft"), 0.06f,
		TEXT("Shadow smoke maps: how rounded the relief's creases are (0 = sharp)."));

	// WHY DRAWN AND NOT COOKED. B65's frames tried the project's cooked normal maps on Shadow's coat, and none of them reads
	// as smoke: ripple's water came out as corrugated stripes, cobble's stones as facets, metal's cells as crumpled foil,
	// plaster as grit. A new cooked texture is an editor import and a cook, and the test beds reuse RC11's content. So the
	// smoke is drawn here, once, from a tileable field of swirled turbulence -- soft billows parted by creases, the marbling
	// of the founder's reference photo -- into TWO maps that line up texel for texel (the master projects AlbedoTex and
	// NormalTex through the same world UVs):
	//   - the TONE (AlbedoTex): a neutral grey, white along the creases and darker in the billows (wl.Shadow.SmokeDark). The
	//     master multiplies it into the base, so the variation stays INSIDE the chosen colour -- "White genuinely white but
	//     detailed (white/light-gray tonal variation) ... Crimson/Azure/Jade darker/brighter same-hue variation" -- never a
	//     second colour, never the old navy;
	//   - the BUMP (NormalTex): the same billows, smoother (fewer octaves, rounded creases), so the sun and the grazing rim
	//     catch the cloud's shape.
	// Transient objects and plain C++ only (the Niagara FName rule): nothing reflected holds them, so they are rooted here,
	// and a changed setting draws a new pair while the old one is let go (an instance still wearing it keeps it until it is
	// repainted). _qa_handoff/shadow_flame/b65/smoke/smoke_proto.py draws the same maps for a look without a boot.
	constexpr int32 SmokeMapSize = 256;

	uint32 SmokeHash(uint32 X, uint32 Y, uint32 Seed)
	{
		uint32 H = (X * 0x8DA6B343u) ^ (Y * 0xD8163841u) ^ (Seed * 0x9E3779B1u);
		H ^= H >> 15;
		H *= 0x2C1B3C6Du;
		H ^= H >> 12;
		H *= 0x297A2D39u;
		H ^= H >> 15;
		return H;
	}

	/** Gradient noise whose lattice wraps every Period cells, so the tile repeats with no seam (about -0.7..0.7). */
	float SmokeNoise(float X, float Y, int32 Period, uint32 Seed)
	{
		struct FGradients
		{
			float X[256];
			float Y[256];
			FGradients()
			{
				for (int32 Index = 0; Index < 256; ++Index)
				{
					X[Index] = FMath::Cos(Index * (2.0f * PI / 256.0f));
					Y[Index] = FMath::Sin(Index * (2.0f * PI / 256.0f));
				}
			}
		};
		static const FGradients Gradients;
		const float X0 = FMath::FloorToFloat(X);
		const float Y0 = FMath::FloorToFloat(Y);
		const float Fx = X - X0;
		const float Fy = Y - Y0;
		const int32 Ix = (int32)X0;
		const int32 Iy = (int32)Y0;
		auto Corner = [Period, Seed](int32 Cx, int32 Cy, float Dx, float Dy)
		{
			const uint32 Wx = (uint32)(((Cx % Period) + Period) % Period);
			const uint32 Wy = (uint32)(((Cy % Period) + Period) % Period);
			const uint32 G = SmokeHash(Wx, Wy, Seed) & 255u;
			return Gradients.X[G] * Dx + Gradients.Y[G] * Dy;
		};
		const float Sx = Fx * Fx * Fx * (Fx * (Fx * 6.0f - 15.0f) + 10.0f);
		const float Sy = Fy * Fy * Fy * (Fy * (Fy * 6.0f - 15.0f) + 10.0f);
		const float Near = FMath::Lerp(Corner(Ix, Iy, Fx, Fy), Corner(Ix + 1, Iy, Fx - 1.0f, Fy), Sx);
		const float Far = FMath::Lerp(Corner(Ix, Iy + 1, Fx, Fy - 1.0f), Corner(Ix + 1, Iy + 1, Fx - 1.0f, Fy - 1.0f), Sx);
		return FMath::Lerp(Near, Far, Sy);
	}

	/** Octaves of SmokeNoise, each twice as fine and half as strong, normalised. Still tileable: the periods double too. */
	float SmokeFbm(float U, float V, int32 Cells, int32 Octaves, uint32 Seed)
	{
		float Sum = 0.0f;
		float Amp = 1.0f;
		float Norm = 0.0f;
		int32 Period = Cells;
		for (int32 Octave = 0; Octave < Octaves; ++Octave)
		{
			Sum += Amp * SmokeNoise(U * Period, V * Period, Period, Seed + 101u * (uint32)Octave);
			Norm += Amp;
			Amp *= 0.5f;
			Period *= 2;
		}
		return Sum / Norm;
	}

	/** Turbulence: the octaves' MAGNITUDES, so every zero of the noise becomes a crease between two billows. Soft rounds the
	 *  crease (sqrt(n^2 + s^2) - s), which keeps a relief soft enough to read as smoke. */
	float SmokeTurbulence(float U, float V, int32 Cells, int32 Octaves, float Gain, float Soft, uint32 Seed)
	{
		float Sum = 0.0f;
		float Amp = 1.0f;
		float Norm = 0.0f;
		int32 Period = Cells;
		for (int32 Octave = 0; Octave < Octaves; ++Octave)
		{
			const float N = SmokeNoise(U * Period, V * Period, Period, Seed + 101u * (uint32)Octave);
			Sum += Amp * (FMath::Sqrt(N * N + Soft * Soft) - Soft);
			Norm += Amp;
			Amp *= Gain;
			Period *= 2;
		}
		return Sum / FMath::Max(Norm, 1e-6f);
	}

	struct FSmokeSettings
	{
		int32 Cells = 3;
		float Warp = 0.32f;
		int32 Seed = 7;
		float Dark = 0.45f;
		float TonePower = 1.3f;
		int32 ToneOctaves = 4;
		float ToneGain = 0.45f;
		float Bump = 0.10f;
		int32 BumpOctaves = 2;
		float BumpGain = 0.35f;
		float BumpSoft = 0.06f;

		static FSmokeSettings Read()
		{
			FSmokeSettings S;
			S.Cells = FMath::Clamp(CVarSmokeCells.GetValueOnGameThread(), 1, 16);
			S.Warp = FMath::Clamp(CVarSmokeWarp.GetValueOnGameThread(), 0.0f, 1.0f);
			S.Seed = CVarSmokeSeed.GetValueOnGameThread();
			S.Dark = FMath::Clamp(CVarSmokeDark.GetValueOnGameThread(), 0.0f, 1.0f);
			S.TonePower = FMath::Clamp(CVarSmokeTonePower.GetValueOnGameThread(), 0.1f, 8.0f);
			S.ToneOctaves = FMath::Clamp(CVarSmokeToneOctaves.GetValueOnGameThread(), 1, 6);
			S.ToneGain = FMath::Clamp(CVarSmokeToneGain.GetValueOnGameThread(), 0.0f, 1.0f);
			S.Bump = FMath::Clamp(CVarSmokeBump.GetValueOnGameThread(), 0.0f, 1.0f);
			S.BumpOctaves = FMath::Clamp(CVarSmokeBumpOctaves.GetValueOnGameThread(), 1, 6);
			S.BumpGain = FMath::Clamp(CVarSmokeBumpGain.GetValueOnGameThread(), 0.0f, 1.0f);
			S.BumpSoft = FMath::Clamp(CVarSmokeBumpSoft.GetValueOnGameThread(), 0.0f, 1.0f);
			return S;
		}

		FString Describe() const
		{
			return FString::Printf(TEXT("cells %d warp %.2f seed %d | tone dark %.2f power %.2f octaves %d gain %.2f | bump %.3f octaves %d gain %.2f soft %.3f"),
				Cells, Warp, Seed, Dark, TonePower, ToneOctaves, ToneGain, Bump, BumpOctaves, BumpGain, BumpSoft);
		}
	};

	uint8 SmokeByte(float Value)
	{
		return (uint8)FMath::Clamp(FMath::RoundToInt(Value * 255.0f), 0, 255);
	}

	/** Halve a square map of floats (Channels per texel) by averaging each 2x2 block. */
	TArray<float> SmokeHalve(const TArray<float>& Source, int32 Side, int32 Channels)
	{
		const int32 Half = FMath::Max(Side / 2, 1);
		TArray<float> Out;
		Out.SetNumZeroed(Half * Half * Channels);
		for (int32 J = 0; J < Half; ++J)
		{
			for (int32 I = 0; I < Half; ++I)
			{
				for (int32 C = 0; C < Channels; ++C)
				{
					float Sum = 0.0f;
					for (int32 Dj = 0; Dj < 2; ++Dj)
					{
						for (int32 Di = 0; Di < 2; ++Di)
						{
							Sum += Source[(FMath::Min(J * 2 + Dj, Side - 1) * Side + FMath::Min(I * 2 + Di, Side - 1)) * Channels + C];
						}
					}
					Out[(J * Half + I) * Channels + C] = Sum * 0.25f;
				}
			}
		}
		return Out;
	}

	/** One tone map's mips from the shared field (0 in the billows' hearts .. 1 along the creases, already normalised):
	 *  Floor + (1 - Floor) x crease^Power, so a low floor and a high power give dark cells parted by thin bright veins
	 *  (the designed body's marble) and a high floor gives a light pick soft, shallow clouds (B65.3). */
	TArray<TArray<FColor>> MakeToneMips(const TArray<float>& Field01, float Floor, float Power)
	{
		TArray<float> Tone;
		Tone.SetNumUninitialized(Field01.Num());
		for (int32 K = 0; K < Field01.Num(); ++K)
		{
			Tone[K] = Floor + (1.0f - Floor) * FMath::Pow(Field01[K], Power);
		}
		TArray<TArray<FColor>> Mips;
		for (int32 Side = SmokeMapSize; Side >= 1; Side /= 2)
		{
			TArray<FColor>& Mip = Mips.AddDefaulted_GetRef();
			Mip.SetNumUninitialized(Side * Side);
			for (int32 K = 0; K < Side * Side; ++K)
			{
				const uint8 G = SmokeByte(Tone[K]);
				Mip[K] = FColor(G, G, G, 255);
			}
			if (Side > 1)
			{
				Tone = SmokeHalve(Tone, Side, 1);
			}
		}
		return Mips;
	}

	/** The relief's mips (every one down to 1x1: averages, so a far Dog's smoke flattens instead of sparkling) and the tone
	 *  FIELD every profile's tone map is drawn from (B65.3: one pattern, several depths). */
	void DrawSmokeMaps(const FSmokeSettings& S, TArray<float>& OutToneField, TArray<TArray<FColor>>& OutBump)
	{
		const int32 N = SmokeMapSize;
		const uint32 Seed = (uint32)S.Seed;
		TArray<float> Tone;
		TArray<float> Field;
		Tone.SetNumUninitialized(N * N);
		Field.SetNumUninitialized(N * N);
		for (int32 J = 0; J < N; ++J)
		{
			for (int32 I = 0; I < N; ++I)
			{
				const float U = (float)I / N;
				const float V = (float)J / N;
				// swirled first, by two more fields of the same noise, so the billows curl like smoke instead of sitting in a grid
				const float Wu = U + S.Warp * SmokeFbm(U, V, S.Cells, 4, Seed + 11u);
				const float Wv = V + S.Warp * SmokeFbm(U, V, S.Cells, 4, Seed + 23u);
				Tone[J * N + I] = SmokeTurbulence(Wu, Wv, S.Cells, S.ToneOctaves, S.ToneGain, 0.0f, Seed);
				Field[J * N + I] = SmokeTurbulence(Wu, Wv, S.Cells, S.BumpOctaves, S.BumpGain, S.BumpSoft, Seed);
			}
		}
		// THE TONE FIELD: 1 along the creases, 0 in the billows' hearts; each profile maps it to its own depth (MakeToneMips)
		float Lo = TNumericLimits<float>::Max();
		float Hi = TNumericLimits<float>::Lowest();
		for (const float T : Tone)
		{
			Lo = FMath::Min(Lo, T);
			Hi = FMath::Max(Hi, T);
		}
		const float Range = FMath::Max(Hi - Lo, 1e-6f);
		for (float& T : Tone)
		{
			T = 1.0f - (T - Lo) / Range;
		}
		OutToneField = Tone;
		// THE BUMP: the field's slope, wrapping so the tile's edges meet, as a tangent-space normal's x and y
		TArray<float> Slope;
		Slope.SetNumUninitialized(N * N * 2);
		for (int32 J = 0; J < N; ++J)
		{
			for (int32 I = 0; I < N; ++I)
			{
				const float Dx = (Field[J * N + (I + 1) % N] - Field[J * N + (I + N - 1) % N]) * 0.5f * N;
				const float Dy = (Field[((J + 1) % N) * N + I] - Field[((J + N - 1) % N) * N + I]) * 0.5f * N;
				const FVector3f Normal = FVector3f(-Dx * S.Bump, -Dy * S.Bump, 1.0f).GetSafeNormal();
				Slope[(J * N + I) * 2] = Normal.X;
				Slope[(J * N + I) * 2 + 1] = Normal.Y;
			}
		}
		for (int32 Side = N; Side >= 1; Side /= 2)
		{
			TArray<FColor>& BumpMip = OutBump.AddDefaulted_GetRef();
			BumpMip.SetNumUninitialized(Side * Side);
			for (int32 K = 0; K < Side * Side; ++K)
			{
				const float X = Slope[K * 2];
				const float Y = Slope[K * 2 + 1];
				const float Z = FMath::Sqrt(FMath::Max(0.0f, 1.0f - X * X - Y * Y));
				BumpMip[K] = FColor(SmokeByte(X * 0.5f + 0.5f), SmokeByte(Y * 0.5f + 0.5f), SmokeByte(Z * 0.5f + 0.5f), 255);
			}
			if (Side > 1)
			{
				Slope = SmokeHalve(Slope, Side, 2);
			}
		}
	}

	/** One transient BGRA8 map with its whole mip chain: linear (never sRGB), never streamed, wrapping, rooted. */
	UTexture2D* MakeSmokeTexture(const TCHAR* Base, const TArray<TArray<FColor>>& Mips)
	{
		UTexture2D* Texture = UTexture2D::CreateTransient(SmokeMapSize, SmokeMapSize, PF_B8G8R8A8,
			MakeUniqueObjectName(GetTransientPackage(), UTexture2D::StaticClass(), FName(Base)));
		FTexturePlatformData* Data = Texture != nullptr ? Texture->GetPlatformData() : nullptr;
		if (Data == nullptr || Data->Mips.Num() != 1)
		{
			return nullptr;
		}
		for (int32 Level = 0; Level < Mips.Num(); ++Level)
		{
			const int32 Side = FMath::Max(SmokeMapSize >> Level, 1);
			if (Level > 0)
			{
				Data->Mips.Add(new FTexture2DMipMap(Side, Side, 1));
			}
			FTexture2DMipMap& Mip = Data->Mips[Level];
			Mip.BulkData.Lock(LOCK_READ_WRITE);
			void* Dest = Mip.BulkData.Realloc((int64)Side * Side * sizeof(FColor));
			FMemory::Memcpy(Dest, Mips[Level].GetData(), (SIZE_T)Side * Side * sizeof(FColor));
			Mip.BulkData.Unlock();
		}
		Texture->SRGB = false;
		Texture->NeverStream = true;
		Texture->AddressX = TA_Wrap;
		Texture->AddressY = TA_Wrap;
		Texture->UpdateResource();
		Texture->AddToRoot();
		return Texture;
	}

	struct FSmokeMaps
	{
		FString Signature;
		TWeakObjectPtr<UTexture2D> Bump;
		TWeakObjectPtr<UTexture2D> Tone;
		/** The tone field every profile's tone map is drawn from, and those maps by "floor|power" (B65.3). */
		TArray<float> ToneField;
		TMap<FString, TWeakObjectPtr<UTexture2D>> Tones;
		double DrawMs = 0.0;
		bool bFailed = false;
	};
	FSmokeMaps GSmokeMaps;

	/** A tone map of the current field at this depth, drawn once and kept until the field is redrawn. */
	UTexture2D* SmokeToneFor(float Floor, float Power)
	{
		if (GSmokeMaps.ToneField.Num() != SmokeMapSize * SmokeMapSize)
		{
			return nullptr;
		}
		const FString Key = FString::Printf(TEXT("%.3f|%.2f"), Floor, Power);
		if (const TWeakObjectPtr<UTexture2D>* Found = GSmokeMaps.Tones.Find(Key))
		{
			if (Found->IsValid())
			{
				return Found->Get();
			}
		}
		UTexture2D* Made = MakeSmokeTexture(TEXT("WLSmokeTone"), MakeToneMips(GSmokeMaps.ToneField, Floor, Power));
		GSmokeMaps.Tones.Add(Key, Made);
		UE_LOG(LogTemp, Display, TEXT("WLMASCOT smoke tone drawn: floor %.3f power %.2f -> %s"), Floor, Power,
			Made != nullptr ? *Made->GetName() : TEXT("FAILED"));
		return Made;
	}

	/** A two-colour marble map's record (COLOR 2, ApplySmokeMarble): what it was drawn for and what its bytes came out as. */
	struct FSmokeMarbleRecord
	{
		FLinearColor Cells = FLinearColor::Black;
		FLinearColor Veins = FLinearColor::Black;
		float Scale = 1.0f;
		FLinearColor DrawnCells = FLinearColor::Black;
		FLinearColor DrawnVeins = FLinearColor::Black;
	};
	/** By the texture's name; let go with the maps whenever the field is redrawn (EnsureSmokeMaps). */
	TMap<FString, FSmokeMarbleRecord> GSmokeMarbleRecords;

	/** The marble's mips: each texel the cells' colour toward the veins' by the profile's own crease share (field^Power -- the
	 *  share MakeToneMips lifts a one-colour map by), divided by Scale. The deepest cell and the brightest vein are read back
	 *  off the bytes of the top mip, so the record says what was DRAWN. */
	TArray<TArray<FColor>> MakeSmokeMarbleMips(const TArray<float>& Field01, const FLinearColor& Cells, const FLinearColor& Veins, float Power,
		float Scale, FLinearColor& OutDrawnCells, FLinearColor& OutDrawnVeins)
	{
		TArray<float> Rgb;
		Rgb.SetNumUninitialized(Field01.Num() * 3);
		float LowShare = 2.0f;
		float HighShare = -1.0f;
		int32 LowAt = 0;
		int32 HighAt = 0;
		for (int32 K = 0; K < Field01.Num(); ++K)
		{
			const float Share = FMath::Pow(FMath::Clamp(Field01[K], 0.0f, 1.0f), Power);
			Rgb[K * 3 + 0] = FMath::Lerp(Cells.R, Veins.R, Share) / Scale;
			Rgb[K * 3 + 1] = FMath::Lerp(Cells.G, Veins.G, Share) / Scale;
			Rgb[K * 3 + 2] = FMath::Lerp(Cells.B, Veins.B, Share) / Scale;
			if (Share < LowShare)
			{
				LowShare = Share;
				LowAt = K;
			}
			if (Share > HighShare)
			{
				HighShare = Share;
				HighAt = K;
			}
		}
		TArray<TArray<FColor>> Mips;
		for (int32 Side = SmokeMapSize; Side >= 1; Side /= 2)
		{
			TArray<FColor>& Mip = Mips.AddDefaulted_GetRef();
			Mip.SetNumUninitialized(Side * Side);
			for (int32 K = 0; K < Side * Side; ++K)
			{
				Mip[K] = FColor(SmokeByte(Rgb[K * 3 + 0]), SmokeByte(Rgb[K * 3 + 1]), SmokeByte(Rgb[K * 3 + 2]), 255);
			}
			if (Mips.Num() == 1 && Mip.IsValidIndex(LowAt) && Mip.IsValidIndex(HighAt))
			{
				const FColor& Cell = Mip[LowAt];
				const FColor& Vein = Mip[HighAt];
				OutDrawnCells = FLinearColor(Cell.R / 255.0f * Scale, Cell.G / 255.0f * Scale, Cell.B / 255.0f * Scale, 1.0f);
				OutDrawnVeins = FLinearColor(Vein.R / 255.0f * Scale, Vein.G / 255.0f * Scale, Vein.B / 255.0f * Scale, 1.0f);
			}
			if (Side > 1)
			{
				Rgb = SmokeHalve(Rgb, Side, 3);
			}
		}
		return Mips;
	}

	void EnsureSmokeMaps();

	/** A marble of the current field for these cells and veins, drawn once per pair and kept until the field is redrawn. */
	UTexture2D* SmokeMarbleFor(const FLinearColor& Cells, const FLinearColor& Veins, float Power, float& OutScale)
	{
		OutScale = 1.0f;
		EnsureSmokeMaps();
		if (GSmokeMaps.ToneField.Num() != SmokeMapSize * SmokeMapSize)
		{
			return nullptr;
		}
		const float Peak = FMath::Max(FMath::Max3(Cells.R, Cells.G, Cells.B), FMath::Max3(Veins.R, Veins.G, Veins.B));
		const float Scale = FMath::Max(Peak, 1.0f / 255.0f);
		OutScale = Scale;
		const FString Key = FString::Printf(TEXT("marble|%.4f %.4f %.4f|%.4f %.4f %.4f|%.2f"), Cells.R, Cells.G, Cells.B, Veins.R, Veins.G, Veins.B, Power);
		if (const TWeakObjectPtr<UTexture2D>* Found = GSmokeMaps.Tones.Find(Key))
		{
			if (Found->IsValid())
			{
				return Found->Get();
			}
		}
		// A BOUNDED SET: every pair a player tries draws one (256x256, ~350 KB with its mips); past a dozen they are all let go
		// at once (an instance still wearing one keeps it alive until it is repainted)
		int32 Marbles = 0;
		for (const TPair<FString, TWeakObjectPtr<UTexture2D>>& Pair : GSmokeMaps.Tones)
		{
			Marbles += Pair.Key.StartsWith(TEXT("marble|")) ? 1 : 0;
		}
		if (Marbles >= 12)
		{
			for (auto It = GSmokeMaps.Tones.CreateIterator(); It; ++It)
			{
				if (!It.Key().StartsWith(TEXT("marble|")))
				{
					continue;
				}
				if (UTexture2D* Old = It.Value().Get())
				{
					GSmokeMarbleRecords.Remove(Old->GetName());
					Old->RemoveFromRoot();
				}
				It.RemoveCurrent();
			}
		}
		FSmokeMarbleRecord Record;
		Record.Cells = Cells;
		Record.Veins = Veins;
		Record.Scale = Scale;
		// named as a tone map ("WLSmokeTone..."): it IS the surface's tone, and the readers that name a worn tone see it as one
		UTexture2D* Made = MakeSmokeTexture(TEXT("WLSmokeToneMarble"),
			MakeSmokeMarbleMips(GSmokeMaps.ToneField, Cells, Veins, Power, Scale, Record.DrawnCells, Record.DrawnVeins));
		GSmokeMaps.Tones.Add(Key, Made);
		if (Made != nullptr)
		{
			GSmokeMarbleRecords.Add(Made->GetName(), Record);
		}
		UE_LOG(LogTemp, Display, TEXT("WLMASCOT smoke marble drawn: cells %s veins %s power %.2f peak %.4f -> %s (drawn cells %s veins %s)"),
			*Cells.ToString(), *Veins.ToString(), Power, Scale, Made != nullptr ? *Made->GetName() : TEXT("FAILED"),
			*Record.DrawnCells.ToString(), *Record.DrawnVeins.ToString());
		return Made;
	}

	bool SmokeIsDrawn()
	{
		return CVarSmokeNormalTex.GetValueOnGameThread().TrimStartAndEnd().Equals(TEXT("smoke"), ESearchCase::IgnoreCase);
	}

	/** Draw the pair if the settings changed (or it was never drawn), once per setting even if it fails. */
	void EnsureSmokeMaps()
	{
		const FSmokeSettings Settings = FSmokeSettings::Read();
		const FString Signature = Settings.Describe();
		if (Signature == GSmokeMaps.Signature && (GSmokeMaps.bFailed || (GSmokeMaps.Bump.IsValid() && GSmokeMaps.Tone.IsValid())))
		{
			return;
		}
		const double Start = FPlatformTime::Seconds();
		TArray<TArray<FColor>> BumpMips;
		DrawSmokeMaps(Settings, GSmokeMaps.ToneField, BumpMips);
		if (UTexture2D* Old = GSmokeMaps.Bump.Get())
		{
			Old->RemoveFromRoot();
		}
		// every tone map belonged to the old field: let them all go (an instance still wearing one keeps it until repainted)
		for (TPair<FString, TWeakObjectPtr<UTexture2D>>& Pair : GSmokeMaps.Tones)
		{
			if (UTexture2D* Old = Pair.Value.Get())
			{
				Old->RemoveFromRoot();
			}
		}
		GSmokeMaps.Tones.Reset();
		GSmokeMarbleRecords.Reset();
		GSmokeMaps.Bump = MakeSmokeTexture(TEXT("WLSmokeBump"), BumpMips);
		// the colour profile's map is drawn up front (the B65.1 tone): every other profile draws its own on first use
		GSmokeMaps.Tone = SmokeToneFor(Settings.Dark, Settings.TonePower);
		GSmokeMaps.Signature = Signature;
		GSmokeMaps.DrawMs = (FPlatformTime::Seconds() - Start) * 1000.0;
		GSmokeMaps.bFailed = !GSmokeMaps.Bump.IsValid() || !GSmokeMaps.Tone.IsValid();
		UE_LOG(LogTemp, Display, TEXT("WLMASCOT smoke maps drawn: %s | %dx%d, %d mips, %.1f ms | bump %s, tone %s"), *Signature,
			SmokeMapSize, SmokeMapSize, BumpMips.Num(), GSmokeMaps.DrawMs,
			GSmokeMaps.Bump.IsValid() ? *GSmokeMaps.Bump->GetName() : TEXT("FAILED"), GSmokeMaps.Tone.IsValid() ? *GSmokeMaps.Tone->GetName() : TEXT("FAILED"));
	}

	/** The tone map, worn only with the drawn relief (it is drawn to line up with it), or nullptr. */
	UTexture* SmokeToneMap()
	{
		if (!SmokeIsDrawn() || CVarSmokeTone.GetValueOnGameThread() == 0)
		{
			return nullptr;
		}
		EnsureSmokeMaps();
		return GSmokeMaps.Tone.Get();
	}

	/** Put one texture parameter back to the parent material's own default. */
	void RestoreParentTexture(UMaterialInstanceDynamic* Instance, const TCHAR* Name)
	{
		UTexture* Default = nullptr;
		if (Instance != nullptr && Instance->Parent != nullptr
			&& Instance->Parent->GetTextureParameterValue(FMaterialParameterInfo(Name), Default) && Default != nullptr)
		{
			Instance->SetTextureParameterValue(Name, Default);
		}
	}

	/**
	 * The glow (M_WLMaster: Emissive x EmissiveStrength) back to what every figure surface is BUILT with: the colour the parent
	 * says and a strength of 0 (AWonderlandCompanionEmbodiment's build loop writes 0 on every Rim instance). B65.4: B65.3 put
	 * the PARENT's strength back, which is not the built state and could light a surface the designed look kept dark.
	 */
	void RestoreParentGlow(UMaterialInstanceDynamic* Instance)
	{
		if (Instance == nullptr)
		{
			return;
		}
		FLinearColor Colour = FLinearColor::Black;
		if (Instance->Parent != nullptr && Instance->Parent->GetVectorParameterValue(FMaterialParameterInfo(TEXT("Emissive")), Colour))
		{
			Instance->SetVectorParameterValue(TEXT("Emissive"), Colour);
		}
		Instance->SetScalarParameterValue(TEXT("EmissiveStrength"), 0.0f);
	}

	/** The noon white in scene units: the post-process holds noon at EV100 14.2, where a sunlit ivory wall is ~20,000-25,000
	 *  (see WonderlandSceneUnits in WonderlandCompanionEmbodiment.cpp). The light pick's glow is a share of THIS. */
	constexpr float SmokeNoonWhite = 25000.0f;

	enum class ESmokeProfile : uint8
	{
		Designed,   // the designed body: navy cells, bright blue veins (the founder's reference)
		Light,      // white and near-white picks: kept bright, soft marbling, a small neutral glow
		Dark,       // black and near-black picks: black cells, grey smoke veins
		Colour      // every other pick: the pick exactly, marbled with darker shades of itself
	};

	ESmokeProfile SmokeProfileFor(const FLinearColor& Pick, bool bDesignedBody)
	{
		if (bDesignedBody)
		{
			return ESmokeProfile::Designed;
		}
		const float Top = FMath::Max3(Pick.R, Pick.G, Pick.B);
		const float Low = FMath::Min3(Pick.R, Pick.G, Pick.B);
		const float Saturation = Top > 1e-6f ? (Top - Low) / Top : 0.0f;
		if (Top <= CVarSmokeDarkValue.GetValueOnGameThread())
		{
			return ESmokeProfile::Dark;
		}
		if (Top >= CVarSmokeLightValue.GetValueOnGameThread() && Saturation <= CVarSmokeLightSat.GetValueOnGameThread())
		{
			return ESmokeProfile::Light;
		}
		return ESmokeProfile::Colour;
	}

	FLinearColor SmokeDefaultVein()
	{
		FLinearColor Vein(0.28f, 0.55f, 1.00f, 1.0f);
		FLinearColor Parsed;
		if (ReadFlameColourText(CVarSmokeDefaultVein.GetValueOnGameThread(), Parsed))
		{
			Vein = FLinearColor(Parsed.R, Parsed.G, Parsed.B, 1.0f);
		}
		return Vein;
	}

	/** The depth a profile's tone is drawn at -- its floor and power of the shared field -- for its one-colour map and for its
	 *  two-colour marble alike, so COLOR 1's cells are the same whether or not COLOR 2 paints the veins. */
	void SmokeToneDepthFor(ESmokeProfile Profile, float& OutFloor, float& OutPower)
	{
		switch (Profile)
		{
		case ESmokeProfile::Designed:
			OutFloor = FMath::Clamp(CVarSmokeDefaultFloor.GetValueOnGameThread(), 0.0f, 1.0f);
			OutPower = FMath::Clamp(CVarSmokeDefaultPower.GetValueOnGameThread(), 0.1f, 12.0f);
			break;
		case ESmokeProfile::Light:
			OutFloor = FMath::Clamp(CVarSmokeLightFloor.GetValueOnGameThread(), 0.0f, 1.0f);
			OutPower = FMath::Clamp(CVarSmokeLightPower.GetValueOnGameThread(), 0.1f, 12.0f);
			break;
		case ESmokeProfile::Dark:
			OutFloor = FMath::Clamp(CVarSmokeDarkFloor.GetValueOnGameThread(), 0.0f, 1.0f);
			OutPower = FMath::Clamp(CVarSmokeDarkPower.GetValueOnGameThread(), 0.1f, 12.0f);
			break;
		default:
		{
			// the colour profile's B65.1 tone, drawn up front by EnsureSmokeMaps at exactly this depth
			const FSmokeSettings Settings = FSmokeSettings::Read();
			OutFloor = Settings.Dark;
			OutPower = Settings.TonePower;
			break;
		}
		}
	}

	/** The tone map a profile wears: its own depth of the shared field. */
	UTexture* SmokeToneForProfile(ESmokeProfile Profile)
	{
		if (!SmokeIsDrawn() || CVarSmokeTone.GetValueOnGameThread() == 0)
		{
			return nullptr;
		}
		EnsureSmokeMaps();
		if (Profile == ESmokeProfile::Colour)
		{
			return GSmokeMaps.Tone.Get();
		}
		float Floor = 0.0f;
		float Power = 1.0f;
		SmokeToneDepthFor(Profile, Floor, Power);
		return SmokeToneFor(Floor, Power);
	}

	UTexture* SmokeTexture()
	{
		// LOADED ONCE PER NAME, and only from the project's own texture folder: the name is a console value, never a path.
		static FString LoadedName;
		static TWeakObjectPtr<UTexture> Loaded;
		if (SmokeIsDrawn())
		{
			EnsureSmokeMaps();
			return GSmokeMaps.Bump.Get();
		}
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
		// THE TONE rides with the drawn relief only: it is drawn to line up with it, texel for texel
		if (UTexture* Tone = SmokeToneMap())
		{
			Instance->SetTextureParameterValue(TEXT("AlbedoTex"), Tone);
		}
		else
		{
			RestoreParentTexture(Instance, TEXT("AlbedoTex"));
		}
		Instance->SetScalarParameterValue(TEXT("TexScale"), FMath::Clamp(CVarSmokeTexScale.GetValueOnGameThread(), 0.0005f, 0.5f));
		Instance->SetScalarParameterValue(TEXT("DetailAmp"), FMath::Clamp(CVarSmokeDetailAmp.GetValueOnGameThread(), 0.0f, 0.6f));
		Instance->SetScalarParameterValue(TEXT("RoughVary"), FMath::Clamp(CVarSmokeRoughVary.GetValueOnGameThread(), 0.0f, 3.5f));
		Instance->SetScalarParameterValue(TEXT("Roughness"), FMath::Clamp(CVarSmokeRoughness.GetValueOnGameThread(), 0.05f, 1.0f));
		Instance->SetScalarParameterValue(TEXT("Specular"), FMath::Clamp(CVarSmokeSpecular.GetValueOnGameThread(), 0.0f, 1.0f));
		// RimAmp is NOT written here: the night's rim boost owns it too (AWonderlandCompanionEmbodiment::SetRimBoost), so the
		// embodiment writes boost x SmokeRimAmp() in both places.
	}

	FLinearColor SmokeBaseFor(const FLinearColor& Pick, bool bDesignedBody)
	{
		switch (SmokeProfileFor(Pick, bDesignedBody))
		{
		case ESmokeProfile::Designed:
			// the VEINS' blue: the tone map's floor brings the cells down to the designed navy
			return SmokeDefaultVein();
		case ESmokeProfile::Dark:
		{
			// the smoke's grey: the tone map's floor of 0 keeps the cells black. B65.5: a little cool, so the grey reads GREY and not
			// brown under the warm sandstone bounce (round 4's frames)
			const float Grey = FMath::Clamp(CVarSmokeDarkVein.GetValueOnGameThread(), 0.0f, 1.0f);
			// B65.6: a TINT, read as one (channels up to 2) -- the colour reader refused "0.90 0.96 1.10" itself
			const FLinearColor Tint = SmokeDarkTint();
			return FLinearColor(FMath::Clamp(Grey * Tint.R, 0.0f, 1.0f), FMath::Clamp(Grey * Tint.G, 0.0f, 1.0f),
				FMath::Clamp(Grey * Tint.B, 0.0f, 1.0f), 1.0f);
		}
		default:
			// the pure-colour rule: a light or any other pick is painted with EXACTLY itself
			return FLinearColor(Pick.R, Pick.G, Pick.B, 1.0f);
		}
	}

	bool SmokeDesignedRim(FLinearColor& OutRim)
	{
		// THE FOUNDER'S SHEET LIGHTS EVERY EDGE BLUE: the designed body's rim takes the edge-glow colour at the given strength, IN SCENE
		// UNITS (B65.5: the rim draws RimColor x RimAmp x Fresnel with no x1000 inside -- round 4's variant VA at 12 drew nothing at
		// noon, and B65.4's clamp at 40 kept every console value below visibility). 0 = the designed rim.
		const float Gain = FMath::Clamp(CVarSmokeDefaultRimGain.GetValueOnGameThread(), 0.0f, 30000.0f);
		if (!(Gain > 0.0f))
		{
			return false;
		}
		const FLinearColor Rim = SmokeEdgeColour();
		OutRim = FLinearColor(Rim.R * Gain, Rim.G * Gain, Rim.B * Gain, 1.0f);
		return true;
	}

	FString SmokeProfileName(const FLinearColor& Pick, bool bDesignedBody)
	{
		switch (SmokeProfileFor(Pick, bDesignedBody))
		{
		case ESmokeProfile::Designed: return TEXT("designed");
		case ESmokeProfile::Light:    return TEXT("light");
		case ESmokeProfile::Dark:     return TEXT("dark");
		default:                      return TEXT("colour");
		}
	}

	void ApplySmokeLook(UMaterialInstanceDynamic* Instance, const FLinearColor& Pick, bool bDesignedBody)
	{
		if (Instance == nullptr)
		{
			return;
		}
		const ESmokeProfile Profile = SmokeProfileFor(Pick, bDesignedBody);
		Instance->SetVectorParameterValue(TEXT("BaseColor"), SmokeBaseFor(Pick, bDesignedBody));
		ApplySmokeDetail(Instance);
		// THE PROFILE'S OWN TONE (ApplySmokeDetail bound the colour profile's): the designed body's thin bright veins, a light
		// pick's shallow clouds, a dark pick's black cells with grey smoke
		if (UTexture* Tone = SmokeToneForProfile(Profile))
		{
			Instance->SetTextureParameterValue(TEXT("AlbedoTex"), Tone);
		}
		// A LIGHT PICK'S NEUTRAL GLOW: white lit by the warm noon sun, or standing in warm shade, reads cream; neutral self-light
		// lifts it toward the tonemapper's white without tinting it (the founder: "WHITE must read genuinely WHITE at noon").
		// IN SCENE UNITS (B65.4): the share times the noon white. B65.3 wrote the bare share (0.10) -- a ten-thousandth of white.
		const float Glow = FMath::Clamp(CVarSmokeLightGlow.GetValueOnGameThread(), 0.0f, 1.0f);
		const float DesignedGlow = FMath::Clamp(CVarSmokeDefaultGlow.GetValueOnGameThread(), 0.0f, 30000.0f);
		if (Profile == ESmokeProfile::Light && Glow > 0.0f)
		{
			Instance->SetVectorParameterValue(TEXT("Emissive"), FLinearColor::White);
			Instance->SetScalarParameterValue(TEXT("EmissiveStrength"), Glow * SmokeNoonWhite);
		}
		else if (Profile == ESmokeProfile::Designed && DesignedGlow > 0.0f)
		{
			// B65.5: the designed body's optional uniform glow, in the edge-glow colour (normalised: its brightest channel = 1)
			const FLinearColor Rim = SmokeEdgeColour();
			const float Top = FMath::Max(FMath::Max3(Rim.R, Rim.G, Rim.B), 1e-4f);
			Instance->SetVectorParameterValue(TEXT("Emissive"), FLinearColor(Rim.R / Top, Rim.G / Top, Rim.B / Top, 1.0f));
			Instance->SetScalarParameterValue(TEXT("EmissiveStrength"), DesignedGlow);
		}
		else
		{
			RestoreParentGlow(Instance);
		}
	}

	FLinearColor SmokeMarbleCellsFor(const FLinearColor& Pick, bool bDesignedBody)
	{
		float Floor = 0.0f;
		float Power = 1.0f;
		SmokeToneDepthFor(SmokeProfileFor(Pick, bDesignedBody), Floor, Power);
		const FLinearColor Base = SmokeBaseFor(Pick, bDesignedBody);
		return FLinearColor(FMath::Clamp(Base.R * Floor, 0.0f, 1.0f), FMath::Clamp(Base.G * Floor, 0.0f, 1.0f), FMath::Clamp(Base.B * Floor, 0.0f, 1.0f), 1.0f);
	}

	void ApplySmokeMarble(UMaterialInstanceDynamic* Instance, const FLinearColor& Pick, bool bDesignedBody, const FLinearColor& Veins)
	{
		if (Instance == nullptr)
		{
			return;
		}
		// EVERYTHING THE ONE-COLOUR LOOK WRITES FIRST -- the relief, the roughness, a light pick's glow -- so the marble changes the
		// veins' colour and nothing else about the material
		ApplySmokeLook(Instance, Pick, bDesignedBody);
		// no drawn field (wl.Shadow.NormalTex not `smoke`) or no tone worn (wl.Shadow.Tone 0): there is no marble to paint, and the
		// one-colour look stands
		if (!SmokeIsDrawn() || CVarSmokeTone.GetValueOnGameThread() == 0)
		{
			return;
		}
		float Floor = 0.0f;
		float Power = 1.0f;
		SmokeToneDepthFor(SmokeProfileFor(Pick, bDesignedBody), Floor, Power);
		const FLinearColor Cells = SmokeMarbleCellsFor(Pick, bDesignedBody);
		const FLinearColor Vein(FMath::Clamp(Veins.R, 0.0f, 1.0f), FMath::Clamp(Veins.G, 0.0f, 1.0f), FMath::Clamp(Veins.B, 0.0f, 1.0f), 1.0f);
		float Scale = 1.0f;
		if (UTexture2D* Marble = SmokeMarbleFor(Cells, Vein, Power, Scale))
		{
			Instance->SetTextureParameterValue(TEXT("AlbedoTex"), Marble);
			Instance->SetVectorParameterValue(TEXT("BaseColor"), FLinearColor(Scale, Scale, Scale, 1.0f));
		}
	}

	bool SmokeMarbleOf(const UTexture* Texture, FLinearColor& OutCells, FLinearColor& OutVeins, float& OutScale,
		FLinearColor& OutDrawnCells, FLinearColor& OutDrawnVeins)
	{
		const FSmokeMarbleRecord* Record = Texture != nullptr ? GSmokeMarbleRecords.Find(Texture->GetName()) : nullptr;
		if (Record == nullptr)
		{
			return false;
		}
		OutCells = Record->Cells;
		OutVeins = Record->Veins;
		OutScale = Record->Scale;
		OutDrawnCells = Record->DrawnCells;
		OutDrawnVeins = Record->DrawnVeins;
		return true;
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
		if (Relief == nullptr)
		{
			return FString(TEXT("none"));
		}
		// the tone is named with the relief, as AWonderlandCompanionEmbodiment::QaReadPaint reads them back off an instance
		return SmokeToneMap() != nullptr ? Relief->GetName() + TEXT("+tone") : Relief->GetName();
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
		RestoreParentTexture(Instance, TEXT("NormalTex"));
		RestoreParentTexture(Instance, TEXT("AlbedoTex"));
		RestoreParentGlow(Instance);
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
		// B65.6: the line prints what is DRAWN -- the parsed edge colour and tint (or the default, saying the console's value was
		// refused) and the clamped strengths -- never a raw console string the paint did not use
		bool bEdgeRefused = false;
		const FLinearColor Edge = SmokeEdgeColour(&bEdgeRefused);
		const FString EdgeLine = DescribeTriple(Edge, bEdgeRefused, CVarSmokeDefaultRim.GetValueOnGameThread());
		bool bTintRefused = false;
		const FLinearColor Tint = SmokeDarkTint(&bTintRefused);
		const FString TintLine = DescribeTriple(Tint, bTintRefused, CVarSmokeDarkVeinTint.GetValueOnGameThread());
		const float EdgeGain = FMath::Clamp(CVarSmokeDefaultRimGain.GetValueOnGameThread(), 0.0f, 30000.0f);
		const float BodyGlow = FMath::Clamp(CVarSmokeDefaultGlow.GetValueOnGameThread(), 0.0f, 30000.0f);
		const FString Drawn = SmokeIsDrawn()
			? FString::Printf(TEXT(" | smoke maps drawn (%s), %.1f ms, tone %s | profiles: designed vein %s floor %.3f power %.1f edge glow %s x %.0f units, body glow %.0f units; light >= %.2f sat <= %.2f floor %.2f power %.1f glow %.2f of the noon white (%.0f units); dark <= %.2f vein %.2f tint %s floor %.2f power %.1f"),
				*GSmokeMaps.Signature, GSmokeMaps.DrawMs, SmokeToneMap() != nullptr ? TEXT("worn") : TEXT("off"),
				*SmokeDefaultVein().ToString(), CVarSmokeDefaultFloor.GetValueOnGameThread(), CVarSmokeDefaultPower.GetValueOnGameThread(),
				*EdgeLine, EdgeGain, BodyGlow,
				CVarSmokeLightValue.GetValueOnGameThread(), CVarSmokeLightSat.GetValueOnGameThread(), CVarSmokeLightFloor.GetValueOnGameThread(),
				CVarSmokeLightPower.GetValueOnGameThread(), CVarSmokeLightGlow.GetValueOnGameThread(),
				FMath::Clamp(CVarSmokeLightGlow.GetValueOnGameThread(), 0.0f, 1.0f) * SmokeNoonWhite, CVarSmokeDarkValue.GetValueOnGameThread(),
				CVarSmokeDarkVein.GetValueOnGameThread(), *TintLine, CVarSmokeDarkFloor.GetValueOnGameThread(), CVarSmokeDarkPower.GetValueOnGameThread())
			: FString();
		return FString::Printf(TEXT("relief %s at TexScale %.4f, DetailAmp %.2f, RoughVary %.2f, Roughness %.2f, Specular %.2f, RimAmp %.2f, rim top %.2f lift %.2f gain %.2f floor %.2f, strips rim gain %.2f relief %s, on DEFAULT %s%s"),
			Relief != nullptr ? *Relief->GetName() : TEXT("none"), CVarSmokeTexScale.GetValueOnGameThread(), CVarSmokeDetailAmp.GetValueOnGameThread(),
			CVarSmokeRoughVary.GetValueOnGameThread(), CVarSmokeRoughness.GetValueOnGameThread(), CVarSmokeSpecular.GetValueOnGameThread(),
			CVarSmokeRimAmp.GetValueOnGameThread(), CVarSmokeRimTop.GetValueOnGameThread(), CVarSmokeRimLift.GetValueOnGameThread(),
			CVarSmokeRimGain.GetValueOnGameThread(), CVarSmokeRimFloor.GetValueOnGameThread(), CVarSmokeStripRimGain.GetValueOnGameThread(),
			SmokeStripRelief() ? TEXT("yes") : TEXT("no"), SmokeOnDefault() ? TEXT("yes (the designed body's marble; the designed strips kept)") : TEXT("no (designed look kept)"), *Drawn);
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
