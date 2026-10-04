// wl.Qa.ShadowColour3 -- SHADOW FLAME'S THREE COLOURS THROUGH THE REAL PROJECT BRAIN / C.A.R.D. PATH (founder, 2026-10-04).
//
// FOUNDER: "The black strips/ribbons/tendrils around the Shadow Flame mascot are STILL not independently color-customizable inside
// Project Brain ... COLOR 1 = body/base, COLOR 2 = secondary/accent/marbling, COLOR 3 = strips/ribbons/tendrils ... body white +
// marbling blue + strips red -> ONLY the strips go red ... Do not fake this by changing the strip material directly in-editor ...
// set Color 1, 2, 3 -> apply/save naturally -> ONLY the strips changed -> clean exit -> restart -> reload the same configuration ->
// exact persistence; then change ONLY Color 3 again and prove Colors 1 and 2 unchanged."
//
// Every pick goes through the door the Project Brain's own rows use (WonderlandMascotStyle::PickMascotPrimary, the Wardrobe's
// SECONDARY write + SaveAndApply, PickMascotStrip), every save and reload through the C.A.R.D. section's own buttons
// (WonderlandCardDirector::SaveLiveToActive, Select), and every claim is read back off what the worn costume is PAINTED with --
// each surface's own material instance (QaReadPaint, QaReadMarble) -- never off what was asked. The QA never writes Cards.sav or
// the colour files itself: it reads Cards.sav through the product's own sealed loader.
//
// Two boots: `wl.Qa.ShadowColour3` (SC3.0-SC3.7, quits cleanly), then `wl.Qa.ShadowColour3 restart` (SC3.8-SC3.12, quits).
// Frames into Saved/Screenshots/WLSHADOWCOLOR3. Plain C++ (the FName rule): no reflected names, no log category, LogTemp.
#include "CoreMinimal.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Containers/Ticker.h"
#include "Dom/JsonObject.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/GameViewportClient.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "RelayDogCharacter.h"
#include "WonderlandBeta.h"
#include "WonderlandCard.h"
#include "WonderlandCardDirector.h"
#include "WonderlandCompanionEmbodiment.h"
#include "WonderlandMascotStyle.h"
#include "WonderlandSidekicks.h"
#include "WonderlandSkinStage.h"
#include "WonderlandUiSubsystem.h"
#include "WonderlandUiTestLibrary.h"
#include "Framework/Application/SlateApplication.h"
#include "Layout/WidgetPath.h"
#include "Widgets/SWindow.h"
#include "WonderlandRelaySkins.h"

namespace WonderlandShadowColourQa
{
	const TCHAR* const Sc3CardName = TEXT("QA COLOR3");
	/** Shadow Flame's surfaces (RelaySkins/ShadowFlame.wlvox), and which of them GLOW: a glow's brightness is animated every frame
	 *  (the eyes' pulse, the void edges), so a glow is compared by its HUE, everything else by its exact paint. */
	const TCHAR* const Sc3Glows[] = { TEXT("eye"), TEXT("eyehalo"), TEXT("voidedge") };

	struct FSc3Run
	{
		TWeakObjectPtr<UWorld> World;
		TWeakObjectPtr<ACameraActor> Camera;
		bool bRestart = false;
		int32 Phase = 0;
		double At = 0.0;
		int32 Pass = 0;
		int32 Fail = 0;
		int32 Unmeasured = 0;
		FString Dir;
		FString CardId;
		TMap<FString, FString> Before;
		TMap<FString, FString> AfterPrimary;
		TMap<FString, FString> AfterSecondary;
		TMap<FString, FString> AfterStrips;
		TMap<FString, FString> AfterGold;
		TMap<FString, FString> AfterRestart;
		TMap<FString, FString> AfterJade;
		TMap<FString, FString> OthersBefore;
		/** The second card the DEFAULT-secondary step saves to (SC3.13), so the QA card keeps its colours for the restart. */
		FString DefaultCardId;
		/** The eye's drawn colour just before COLOR 2 is picked (SC3.2e's control: the old tint was this times the pick). */
		FLinearColor EyeBeforeSecondary = FLinearColor::Black;
		bool bEyeBeforeSecondary = false;
		/** The eye as AUTHORED, before any colour is picked: RC12's secondary rule drew THIS times the pick (SC3.2ec, Second's RC13
		 *  review: the post-primary eye already carries the gold tint, so a control built on it described a colour RC12 never drew),
		 *  and DEFAULT on the secondary row must draw its hue again (SC3.13e). */
		FLinearColor EyeAuthored = FLinearColor::Black;
		bool bEyeAuthored = false;
	};
	TSharedPtr<FSc3Run> GSc3Run;

	double Sc3Now()
	{
		return FPlatformTime::Seconds();
	}

	void Sc3Check(FSc3Run& Run, const TCHAR* Id, bool bOk, const FString& Detail)
	{
		(bOk ? Run.Pass : Run.Fail)++;
		UE_LOG(LogTemp, Display, TEXT("WLSC3 %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
	}

	/** A claim the run could not measure is said as such -- never a PASS. */
	void Sc3Unmeasured(FSc3Run& Run, const TCHAR* Id, const FString& Detail)
	{
		Run.Unmeasured++;
		UE_LOG(LogTemp, Display, TEXT("WLSC3 %s NOT MEASURED | %s"), Id, *Detail);
	}

	FString Sc3Rgb(const FLinearColor& C)
	{
		return FString::Printf(TEXT("%.4f,%.4f,%.4f"), C.R, C.G, C.B);
	}

	bool Sc3Exact(const FLinearColor& Got, const FLinearColor& Want)
	{
		return FMath::Abs(Got.R - Want.R) <= 0.002f && FMath::Abs(Got.G - Want.G) <= 0.002f && FMath::Abs(Got.B - Want.B) <= 0.002f;
	}

	/** The hue in whole degrees and the saturation in tenths -- how a glow is told apart while its brightness pulses; "grey" when
	 *  it has no hue to speak of. */
	FString Sc3HueWord(const FLinearColor& C)
	{
		const float Max = FMath::Max3(C.R, C.G, C.B);
		const float Min = FMath::Min3(C.R, C.G, C.B);
		const float Span = Max - Min;
		if (Max <= 1e-6f || Span / Max < 0.05f)
		{
			return TEXT("grey");
		}
		float Hue = 0.0f;
		if (Max == C.R)
		{
			Hue = 60.0f * FMath::Fmod((C.G - C.B) / Span, 6.0f);
		}
		else if (Max == C.G)
		{
			Hue = 60.0f * ((C.B - C.R) / Span + 2.0f);
		}
		else
		{
			Hue = 60.0f * ((C.R - C.G) / Span + 4.0f);
		}
		Hue = Hue < 0.0f ? Hue + 360.0f : Hue;
		return FString::Printf(TEXT("hue %.0f sat %.1f"), Hue, Span / Max);
	}

	const TPair<FName, FLinearColor>* Sc3Swatch(const TArray<TPair<FName, FLinearColor>>& Palette, const TCHAR* Key)
	{
		const FName Want(Key);
		return Palette.FindByPredicate([&Want](const TPair<FName, FLinearColor>& Each) { return Each.Key == Want; });
	}

	ARelayDogCharacter* Sc3Dog(UWorld* World)
	{
		const APlayerController* Controller = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		return Controller != nullptr ? Cast<ARelayDogCharacter>(Controller->GetPawn()) : nullptr;
	}

	FWonderlandCardStore* Sc3Store(UWorld* World)
	{
		UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
		UWonderlandSidekickSubsystem* Sidekicks = Instance != nullptr ? Instance->GetSubsystem<UWonderlandSidekickSubsystem>() : nullptr;
		return Sidekicks != nullptr ? &Sidekicks->GetCardStore() : nullptr;
	}

	/**
	 * EVERY SURFACE OF THE WORN COSTUME AS IT IS PAINTED NOW, one line per material: the names come from the costume itself
	 * (DescribeMaterialColours), so no surface can escape the comparison; each line is that instance's own BaseColor/Color, rim,
	 * relief and -- for the body -- the two-colour marble it is wearing. A glow is kept as its hue (its brightness pulses).
	 */
	/** The hue in degrees of a colour with a hue (saturation >= 0.05); false for a grey. Brightness plays no part -- a glow pulses. */
	bool Sc3HueOf(const FLinearColor& C, float& OutHue)
	{
		const float Max = FMath::Max3(C.R, C.G, C.B);
		const float Span = Max - FMath::Min3(C.R, C.G, C.B);
		if (Max <= 1e-6f || Span / Max < 0.05f)
		{
			return false;
		}
		float Hue = Max == C.R ? 60.0f * FMath::Fmod((C.G - C.B) / Span, 6.0f)
			: Max == C.G ? 60.0f * ((C.B - C.R) / Span + 2.0f) : 60.0f * ((C.R - C.G) / Span + 4.0f);
		OutHue = Hue < 0.0f ? Hue + 360.0f : Hue;
		return true;
	}

	/** Two colours with the same hue, within Degrees (round the circle). */
	bool Sc3SameHue(const FLinearColor& A, const FLinearColor& B, float Degrees)
	{
		float HueA = 0.0f;
		float HueB = 0.0f;
		if (!Sc3HueOf(A, HueA) || !Sc3HueOf(B, HueB))
		{
			return false;
		}
		const float Apart = FMath::Abs(HueA - HueB);
		return FMath::Min(Apart, 360.0f - Apart) <= Degrees;
	}

	TMap<FString, FString> Sc3Snapshot(const AWonderlandCompanionEmbodiment* Costume)
	{
		TMap<FString, FString> Out;
		if (Costume == nullptr)
		{
			return Out;
		}
		TArray<FString> Entries;
		Costume->DescribeMaterialColours().ParseIntoArray(Entries, TEXT(";"));
		for (const FString& Entry : Entries)
		{
			TArray<FString> Fields;
			Entry.ParseIntoArray(Fields, TEXT("|"), false);
			if (Fields.Num() < 1 || Fields[0].IsEmpty())
			{
				continue;
			}
			const FString& Name = Fields[0];
			FLinearColor Base;
			FLinearColor Rim;
			FString Relief;
			if (!Costume->QaReadPaint(FName(*Name), Base, Rim, Relief))
			{
				Out.Add(Name, TEXT("unreadable"));
				continue;
			}
			bool bGlow = false;
			for (const TCHAR* Glow : Sc3Glows)
			{
				bGlow |= Name.Equals(Glow, ESearchCase::IgnoreCase);
			}
			FLinearColor Cells;
			FLinearColor Veins;
			FLinearColor DrawnCells;
			FLinearColor DrawnVeins;
			float PeakDrawn = 0.0f;
			float PeakAsked = 0.0f;
			const bool bMarble = Costume->QaReadMarble(FName(*Name), Cells, Veins, DrawnCells, DrawnVeins, PeakDrawn, PeakAsked);
			const FString Marble = bMarble
				? FString::Printf(TEXT("marble %s/%s drawn %s/%s peak %.4f/%.4f"), *Sc3Rgb(Cells), *Sc3Rgb(Veins), *Sc3Rgb(DrawnCells), *Sc3Rgb(DrawnVeins),
					PeakDrawn, PeakAsked)
				: FString(TEXT("no marble"));
			Out.Add(Name, bGlow
				? FString::Printf(TEXT("glow %s"), *Sc3HueWord(Base))
				: FString::Printf(TEXT("base %s rim %s relief %s %s"), *Sc3Rgb(Base), *Sc3Rgb(Rim), *Relief, *Marble));
		}
		return Out;
	}

	/** Every OTHER embodiment in the world -- the companions, the swords they become -- by hue, material by material. The Wardrobe's
	 *  mannequin of the Dog is the Dog's look by design (it wears the same colours) and is left out. */
	TMap<FString, FString> Sc3Others(UWorld* World, const AWonderlandCompanionEmbodiment* Costume)
	{
		TMap<FString, FString> Out;
		for (TActorIterator<AWonderlandCompanionEmbodiment> It(World); It; ++It)
		{
			if (*It == Costume || Cast<AWonderlandSkinStage>(It->GetOwner()) != nullptr)
			{
				continue;
			}
			TArray<FString> Entries;
			It->DescribeMaterialColours().ParseIntoArray(Entries, TEXT(";"));
			for (const FString& Entry : Entries)
			{
				TArray<FString> Fields;
				Entry.ParseIntoArray(Fields, TEXT("|"), false);
				if (Fields.Num() < 4)
				{
					continue;
				}
				TArray<FString> Rgb;
				Fields[2].ParseIntoArray(Rgb, TEXT(","));
				const FLinearColor Body = Rgb.Num() == 3
					? FLinearColor(FCString::Atof(*Rgb[0]), FCString::Atof(*Rgb[1]), FCString::Atof(*Rgb[2]), 1.0f) : FLinearColor::Black;
				Out.Add(It->GetName() + TEXT(".") + Fields[0], FString::Printf(TEXT("%s val %.2f"), *Sc3HueWord(Body), FMath::Max3(Body.R, Body.G, Body.B)));
			}
		}
		return Out;
	}

	/** Which surfaces differ between two readings, by name, sorted, comma-joined ("" when none). */
	FString Sc3Changed(const TMap<FString, FString>& A, const TMap<FString, FString>& B)
	{
		TArray<FString> Names;
		for (const TPair<FString, FString>& Pair : B)
		{
			const FString* Was = A.Find(Pair.Key);
			if (Was == nullptr || *Was != Pair.Value)
			{
				Names.Add(Pair.Key);
			}
		}
		for (const TPair<FString, FString>& Pair : A)
		{
			if (!B.Contains(Pair.Key))
			{
				Names.Add(Pair.Key);
			}
		}
		Names.Sort();
		return FString::Join(Names, TEXT(","));
	}

	/** The changed surfaces are all ALLOWED ones and include every REQUIRED one (comma lists, as Sc3Changed writes them). */
	bool Sc3ChangedWithin(const FString& Changed, const TCHAR* Allowed, const TCHAR* Required)
	{
		TArray<FString> Got;
		TArray<FString> Ok;
		TArray<FString> Need;
		Changed.ParseIntoArray(Got, TEXT(","));
		FString(Allowed).ParseIntoArray(Ok, TEXT(","));
		FString(Required).ParseIntoArray(Need, TEXT(","));
		for (const FString& Name : Got)
		{
			if (!Ok.Contains(Name))
			{
				return false;
			}
		}
		for (const FString& Name : Need)
		{
			if (!Got.Contains(Name))
			{
				return false;
			}
		}
		return true;
	}

	FString Sc3Line(const TMap<FString, FString>& Reading, const TCHAR* Name)
	{
		const FString* Line = Reading.Find(Name);
		return Line != nullptr ? *Line : FString(TEXT("(none)"));
	}

	/** The surface painted EXACTLY this base (a rim's BaseColor, or a lit surface's Color). */
	bool Sc3BaseIs(const AWonderlandCompanionEmbodiment* Costume, const TCHAR* Name, const FLinearColor& Want, FString& OutGot)
	{
		FLinearColor Base;
		FLinearColor Rim;
		FString Relief;
		const bool bRead = Costume != nullptr && Costume->QaReadPaint(FName(Name), Base, Rim, Relief);
		OutGot = bRead ? Sc3Rgb(Base) : FString(TEXT("unreadable"));
		return bRead && Sc3Exact(Base, Want);
	}

	/** The body wears the two-colour marble: drawn for exactly these cells and veins, its pixels came out as them (within a byte at
	 *  its peak), and its BaseColor is that peak. */
	bool Sc3MarbleIs(const AWonderlandCompanionEmbodiment* Costume, const FLinearColor& Cells, const FLinearColor& Veins, FString& OutGot)
	{
		FLinearColor GotCells;
		FLinearColor GotVeins;
		FLinearColor DrawnCells;
		FLinearColor DrawnVeins;
		float PeakDrawn = 0.0f;
		float PeakAsked = 0.0f;
		if (Costume == nullptr || !Costume->QaReadMarble(FName(TEXT("bone")), GotCells, GotVeins, DrawnCells, DrawnVeins, PeakDrawn, PeakAsked))
		{
			OutGot = TEXT("no marble");
			return false;
		}
		OutGot = FString::Printf(TEXT("cells %s veins %s, drawn %s / %s, peak %.4f (asked %.4f)"), *Sc3Rgb(GotCells), *Sc3Rgb(GotVeins),
			*Sc3Rgb(DrawnCells), *Sc3Rgb(DrawnVeins), PeakDrawn, PeakAsked);
		const float Byte = FMath::Max(PeakAsked, 1e-4f) / 255.0f;
		auto Within = [](const FLinearColor& A, const FLinearColor& B, float Tolerance)
		{
			return FMath::Abs(A.R - B.R) <= Tolerance && FMath::Abs(A.G - B.G) <= Tolerance && FMath::Abs(A.B - B.B) <= Tolerance;
		};
		return Within(GotCells, Cells, 0.0005f) && Within(GotVeins, Veins, 0.0005f) && Within(DrawnCells, Cells, Byte * 0.75f)
			&& Within(DrawnVeins, Veins, Byte * 0.75f) && FMath::Abs(PeakDrawn - PeakAsked) <= 0.0005f;
	}

	/** The colour the strips are painted for a pick: the smoke look's base when the strips wear the relief, else the pick. */
	FLinearColor Sc3StripWant(const FLinearColor& Pick)
	{
		return WonderlandMascotStyle::SmokeStripRelief() ? WonderlandMascotStyle::SmokeBaseFor(Pick, false) : Pick;
	}

	/** The same colour to the 4 decimals Cards.sav keeps. */
	bool Sc3Same(const FLinearColor& A, const FLinearColor& B)
	{
		return A.Equals(B, 0.0006f);
	}

	/** The QA card's channels as the FILE holds them, read through the product's own sealed loader (read only): "secondary" and
	 *  "strips" of the card whose "id" is CardId, or a note saying why not. */
	bool Sc3CardOnDisk(const FWonderlandCardStore& Store, const FString& CardId, FString& OutSecondary, FString& OutStrips, FString& OutNote)
	{
		FString Text;
		FString Why;
		if (!WonderlandBeta::LoadSealedText(Store.GetPath(), FWonderlandCardStore::MaxFileBytes, Text, Why))
		{
			OutNote = FString::Printf(TEXT("Cards.sav not read: %s"), *Why);
			return false;
		}
		TSharedPtr<FJsonObject> Root;
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
		if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
		{
			OutNote = TEXT("Cards.sav is not JSON");
			return false;
		}
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Field : Root->Values)
		{
			const TArray<TSharedPtr<FJsonValue>>* Items = nullptr;
			if (!Field.Value.IsValid() || !Field.Value->TryGetArray(Items) || Items == nullptr)
			{
				continue;
			}
			for (const TSharedPtr<FJsonValue>& Item : *Items)
			{
				const TSharedPtr<FJsonObject>* Card = nullptr;
				FString Id;
				if (Item.IsValid() && Item->TryGetObject(Card) && Card != nullptr && (*Card)->TryGetStringField(TEXT("id"), Id) && Id == CardId)
				{
					(*Card)->TryGetStringField(TEXT("secondary"), OutSecondary);
					(*Card)->TryGetStringField(TEXT("strips"), OutStrips);
					return true;
				}
			}
		}
		OutNote = FString::Printf(TEXT("no card '%s' in Cards.sav"), *CardId);
		return false;
	}

	void Sc3Camera(FSc3Run& Run, UWorld* World, APlayerController* PC, ARelayDogCharacter* Dog)
	{
		const FVector Feet = Dog->GetActorLocation() - FVector(0.0, 0.0, Dog->GetSimpleCollisionHalfHeight());
		const FVector Middle = Feet + FVector(0.0, 0.0, Dog->GetCanonBodyHeightUu() * 0.62);
		const FVector Toward = Dog->GetActorForwardVector().GetSafeNormal2D().RotateAngleAxis(35.0, FVector::UpVector);
		const FVector Where = Middle + Toward * 230.0 + FVector(0.0, 0.0, 40.0);
		ACameraActor* Cam = Run.Camera.Get();
		if (Cam == nullptr)
		{
			FActorSpawnParameters Params;
			Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			Cam = World->SpawnActor<ACameraActor>(Where, FRotator::ZeroRotator, Params);
			Run.Camera = Cam;
		}
		if (Cam != nullptr)
		{
			Cam->SetActorLocationAndRotation(Where, (Middle - Where).Rotation());
			Cam->GetCameraComponent()->SetFieldOfView(48.0f);
			Cam->GetCameraComponent()->SetConstraintAspectRatio(false);
			PC->SetViewTargetWithBlend(Cam, 0.0f);
		}
	}

	void Sc3Shot(const FSc3Run& Run, const TCHAR* Name)
	{
		int32 Width = 0;
		int32 Height = 0;
		const FString Path = Run.Dir / FString::Printf(TEXT("%s.png"), Name);
		const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, Width, Height);
		UE_LOG(LogTemp, Display, TEXT("WLSC3 frame %s %s %dx%d"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), Width, Height);
	}

	/**
	 * WHERE THE HEAD AND THE BODY ARE IN A FRAME, in the viewport's pixels, logged beside the shot (Second's review of Color 3: the marble
	 * checks read the code's own records, so COLOR 2 and COLOR 3 are judged VISIBLE only on the frames -- the runner's PIXEL measure). The
	 * head is left out of that measure: the eyes follow COLOR 2 by their own long-standing rule. Boxes round the canon height (every skin
	 * stands at Relay OG's), wide enough for the arms and the strips.
	 */
	void Sc3Boxes(APlayerController* PC, ARelayDogCharacter* Dog, const TCHAR* Name)
	{
		const FVector Feet = Dog->GetActorLocation() - FVector(0.0, 0.0, Dog->GetSimpleCollisionHalfHeight());
		const double Tall = Dog->GetCanonBodyHeightUu();
		const FVector Ahead = Dog->GetActorForwardVector().GetSafeNormal2D();
		const FVector Across = FVector::CrossProduct(FVector::UpVector, Ahead);
		auto Project = [&](double Z0, double Z1, double HalfWidth, double HalfDepth, FIntRect& OutRect) -> bool
		{
			bool bAny = false;
			FVector2D Lo(1.0e9, 1.0e9);
			FVector2D Hi(-1.0e9, -1.0e9);
			for (int32 Corner = 0; Corner < 8; ++Corner)
			{
				const FVector At = Feet + Ahead * ((Corner & 1) ? HalfDepth : -HalfDepth) + Across * ((Corner & 2) ? HalfWidth : -HalfWidth)
					+ FVector(0.0, 0.0, (Corner & 4) ? Z1 : Z0);
				FVector2D OnScreen;
				if (PC->ProjectWorldLocationToScreen(At, OnScreen))
				{
					Lo = FVector2D(FMath::Min(Lo.X, OnScreen.X), FMath::Min(Lo.Y, OnScreen.Y));
					Hi = FVector2D(FMath::Max(Hi.X, OnScreen.X), FMath::Max(Hi.Y, OnScreen.Y));
					bAny = true;
				}
			}
			OutRect = FIntRect(FMath::FloorToInt(Lo.X), FMath::FloorToInt(Lo.Y), FMath::CeilToInt(Hi.X), FMath::CeilToInt(Hi.Y));
			return bAny;
		};
		FIntRect HeadRect;
		FIntRect BodyRect;
		const bool bHead = Project(0.62 * Tall, 1.06 * Tall, 0.26 * Tall, 0.22 * Tall, HeadRect);
		const bool bBody = Project(0.0, 0.66 * Tall, 0.42 * Tall, 0.30 * Tall, BodyRect);
		FVector2D View = FVector2D::ZeroVector;
		if (GEngine != nullptr && GEngine->GameViewport != nullptr)
		{
			GEngine->GameViewport->GetViewportSize(View);
		}
		UE_LOG(LogTemp, Display, TEXT("WLSC3 boxes %s head %d %d %d %d body %d %d %d %d viewport %.0fx%.0f%s"), Name,
			HeadRect.Min.X, HeadRect.Min.Y, HeadRect.Max.X, HeadRect.Max.Y, BodyRect.Min.X, BodyRect.Min.Y, BodyRect.Max.X, BodyRect.Max.Y,
			View.X, View.Y, bHead && bBody ? TEXT("") : TEXT(" (NOT PROJECTED)"));
	}

	/** A frame for the PIXEL measure: the shot and, in the same tick, where the head and body are in it. */
	void Sc3Measured(const FSc3Run& Run, APlayerController* PC, ARelayDogCharacter* Dog, const TCHAR* Name)
	{
		Sc3Shot(Run, Name);
		Sc3Boxes(PC, Dog, Name);
	}

	/** The SECONDARY row's first swatch, DEFAULT, as the palette holds it. */
	FLinearColor Palette0Colour()
	{
		const TArray<TPair<FName, FLinearColor>>& Shared = WonderlandMascotStyle::Palette();
		return Shared.Num() > 0 ? Shared[0].Value : FLinearColor::White;
	}

	/** The Wardrobe's SECONDARY swatch, exactly as its click writes it (WonderlandProjectBrainPanel::MakeSwatchRow). */
	void Sc3PickSecondary(const FLinearColor& Colour)
	{
		if (UWonderlandMascotStyleSettings* Style = GetMutableDefault<UWonderlandMascotStyleSettings>())
		{
			Style->Secondary = Colour;
			Style->bChosen = true;
			Style->bSecondaryChosen = true;
			WonderlandMascotStyle::SaveAndApply();
		}
	}

	bool Sc3Tick(float DeltaSeconds)
	{
		if (!GSc3Run.IsValid())
		{
			return false;
		}
		FSc3Run& Run = *GSc3Run;
		UWorld* World = Run.World.Get();
		APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		ARelayDogCharacter* Dog = Sc3Dog(World);
		FWonderlandCardStore* Store = Sc3Store(World);
		const double In = Sc3Now() - Run.At;
		const auto Next = [&Run](int32 Phase) { Run.Phase = Phase; Run.At = Sc3Now(); };
		const auto Finish = [&Run, PC, Dog]()
		{
			if (ACameraActor* Cam = Run.Camera.Get())
			{
				if (PC != nullptr && Dog != nullptr)
				{
					PC->SetViewTargetWithBlend(Dog, 0.0f);
				}
				Cam->Destroy();
			}
			UE_LOG(LogTemp, Display, TEXT("WLSC3 END pass=%d fail=%d unmeasured=%d (%s)"), Run.Pass, Run.Fail, Run.Unmeasured,
				Run.bRestart ? TEXT("the restart boot") : TEXT("the first boot"));
			GSc3Run.Reset();
			FPlatformMisc::RequestExit(false);
		};
		if (World == nullptr || PC == nullptr || Dog == nullptr || Store == nullptr)
		{
			if (In > 120.0)
			{
				UE_LOG(LogTemp, Display, TEXT("WLSC3 quit: no world, Relay Dog or C.A.R.D. store"));
				Finish();
				return false;
			}
			return true;
		}
		const AWonderlandCompanionEmbodiment* Costume = Dog->GetCostume();
		const TArray<TPair<FName, FLinearColor>>& Primaries = WonderlandMascotStyle::PrimaryPalette();
		const TArray<TPair<FName, FLinearColor>>& Shared = WonderlandMascotStyle::Palette();
		const TPair<FName, FLinearColor>* White = Sc3Swatch(Primaries, TEXT("WHITE"));
		const TPair<FName, FLinearColor>* Azure = Sc3Swatch(Shared, TEXT("AZURE"));
		const TPair<FName, FLinearColor>* Crimson = Sc3Swatch(Primaries, TEXT("CRIMSON"));
		const TPair<FName, FLinearColor>* Gold = Sc3Swatch(Primaries, TEXT("GOLD"));
		const TPair<FName, FLinearColor>* Jade = Sc3Swatch(Primaries, TEXT("JADE"));
		if (White == nullptr || Azure == nullptr || Crimson == nullptr || Gold == nullptr || Jade == nullptr)
		{
			Sc3Check(Run, TEXT("SC3.0"), false, TEXT("a swatch this QA needs is missing from the palettes (WHITE, AZURE, CRIMSON, GOLD, JADE)"));
			Finish();
			return false;
		}
		FString Said;
		FString Got;
		switch (Run.Phase)
		{
		// ================================================================ THE FIRST BOOT
		case 0:
			if (In >= 8.0)
			{
				if (const ULocalPlayer* Player = PC->GetLocalPlayer())
				{
					if (UWonderlandUiSubsystem* Ui = Player->GetSubsystem<UWonderlandUiSubsystem>())
					{
						Ui->DismissWelcome();
						Ui->CloseOverlay();
					}
				}
				// THE SKY HELD STILL, so every frame is lit the same
				GEngine->Exec(World, TEXT("wl.Sky.DayMinutes 0"));
				GEngine->Exec(World, TEXT("wl.Sky.Hour 12.5"));
				if (!Run.bRestart)
				{
					GEngine->Exec(World, TEXT("wl.Mascot.Reset"));
				}
				Next(Run.bRestart ? 20 : 1);
			}
			break;
		case 1:
			if (In >= 3.0)
			{
				// A CARD OF ITS OWN, made and selected through the C.A.R.D. section's own doors
				const FWonderlandCard* Existing = Store->GetCards().FindByPredicate([](const FWonderlandCard& Each) { return Each.Name == Sc3CardName; });
				if (Existing != nullptr)
				{
					Run.CardId = Existing->Id;
				}
				else if (!WonderlandCardDirector::Create(World, Sc3CardName, Run.CardId, Said))
				{
					Sc3Check(Run, TEXT("SC3.0"), false, FString::Printf(TEXT("no QA card: %s"), *Said));
					Finish();
					return false;
				}
				WonderlandCardDirector::Select(World, Run.CardId, Said);
				const FWonderlandCard* Card = Store->Find(Run.CardId);
				// SC3.0: a card that never recorded a colour leaves the live colours alone when selected (it does not invent one)
				Sc3Check(Run, TEXT("SC3.0"), Card != nullptr && !Card->Secondary.bRecorded && !Card->Strips.bRecorded && !Card->Flame.bRecorded
					&& Said.Contains(TEXT("colour 3 (strips) not recorded on this card")),
					FString::Printf(TEXT("a new card %s: secondary/strips/flame recorded %d/%d/%d (want 0/0/0); select said '%s'"), *Run.CardId,
						Card != nullptr && Card->Secondary.bRecorded ? 1 : 0, Card != nullptr && Card->Strips.bRecorded ? 1 : 0,
						Card != nullptr && Card->Flame.bRecorded ? 1 : 0, *Said));
				// THEN SHADOW FLAME, through the skin registry's own door (the Wardrobe's SWITCH SKIN): a new card is Relay OG, so
				// its SELECT comes first and the skin after it; SAVE TO C.A.R.D. records the skin with the colours
				GEngine->Exec(World, TEXT("wl.Skins.Wear shadow_flame"));
				Next(2);
			}
			break;
		case 2:
			if (In >= 3.0)
			{
				Run.Before = Sc3Snapshot(Costume);
				Run.OthersBefore = Sc3Others(World, Costume);
				// the eye as authored (no colour chosen yet): SC3.2ec's old rule and SC3.13e's "as designed"
				{
					FLinearColor AuthoredRim;
					FString AuthoredRelief;
					Run.bEyeAuthored = Costume != nullptr && Costume->QaReadPaint(FName(TEXT("eye")), Run.EyeAuthored, AuthoredRim, AuthoredRelief);
				}
				UE_LOG(LogTemp, Display, TEXT("WLSC3 worn %s, %d surfaces, %d other bodies' surfaces; look: %s"), *Dog->GetWornSkinId().ToString(),
					Run.Before.Num(), Run.OthersBefore.Num(), *WonderlandMascotStyle::DescribeSmokeLook());
				// the frames' camera FIRST: every measured frame (a-e) is taken from this one place, with the sky held still
				Sc3Camera(Run, World, PC, Dog);
				// COLOR 1 -- the PRIMARY row's door
				WonderlandMascotStyle::PickMascotPrimary(White->Key, White->Value);
				Next(3);
			}
			break;
		case 3:
			if (In >= 1.5)
			{
				Run.AfterPrimary = Sc3Snapshot(Costume);
				const FString Changed = Sc3Changed(Run.Before, Run.AfterPrimary);
				FString GotDeep;
				const bool bBody = Sc3BaseIs(Costume, TEXT("bone"), WonderlandMascotStyle::SmokeBaseFor(White->Value, false), Got);
				const bool bDeep = Sc3BaseIs(Costume, TEXT("bonedeep"), White->Value * 0.62f, GotDeep);
				// the eyes take a tint the moment any colour is chosen (their long-standing bChosen rule) -- allowed, and said
				const bool bOnlyBody = Sc3ChangedWithin(Changed, TEXT("bone,bonedeep,eye,eyehalo"), TEXT("bone,bonedeep"));
				Sc3Check(Run, TEXT("SC3.1"), bBody && bDeep && bOnlyBody,
					FString::Printf(TEXT("COLOR 1 WHITE: changed [%s] (want bone,bonedeep, the eyes only by their bChosen tint); body %s, deep coat %s"),
						*Changed, *Got, *GotDeep));
				// THE CONTROL: the "only the strips" judgement, run on this body change, must say NO
				Sc3Check(Run, TEXT("SC3.1c"), Changed != TEXT("shadow"), FString::Printf(TEXT("control: a COLOR 1 change read as 'only the strips'? %s"),
					Changed == TEXT("shadow") ? TEXT("YES (the judge cannot fail)") : TEXT("no")));
				// PIXEL frame a: COLOR 1 WHITE, no secondary, the strips as designed -- the reference the azure marbling is measured against
				Sc3Measured(Run, PC, Dog, TEXT("a_c1-white_c2-none_c3-default"));
				// the eye as drawn before COLOR 2 (SC3.2e's control)
				{
					FLinearColor EyeRim;
					FString EyeRelief;
					Run.bEyeBeforeSecondary = Costume != nullptr && Costume->QaReadPaint(FName(TEXT("eye")), Run.EyeBeforeSecondary, EyeRim, EyeRelief);
				}
				// COLOR 2 -- the Wardrobe's SECONDARY swatch
				Sc3PickSecondary(Azure->Value);
				Next(4);
			}
			break;
		case 4:
			if (In >= 1.5)
			{
				Run.AfterSecondary = Sc3Snapshot(Costume);
				const FString Changed = Sc3Changed(Run.AfterPrimary, Run.AfterSecondary);
				const bool bMarble = Sc3MarbleIs(Costume, WonderlandMascotStyle::SmokeMarbleCellsFor(White->Value, false), Azure->Value, Got);
				const bool bNotStrips = Sc3Line(Run.AfterPrimary, TEXT("shadow")) == Sc3Line(Run.AfterSecondary, TEXT("shadow"));
				const bool bNotDeep = Sc3Line(Run.AfterPrimary, TEXT("bonedeep")) == Sc3Line(Run.AfterSecondary, TEXT("bonedeep"));
				Sc3Check(Run, TEXT("SC3.2"), bMarble && bNotStrips && bNotDeep && Sc3ChangedWithin(Changed, TEXT("bone,eye,eyehalo"), TEXT("bone")),
					FString::Printf(TEXT("COLOR 2 AZURE (DATA: the marble the code drew; VISIBLE is judged on the frames, PIXEL M2): changed [%s] (want bone, and the eyes by their existing SECONDARY rule); the body's marble %s; the strips %s, the deep coat %s"),
						*Changed, *Got, bNotStrips ? TEXT("untouched") : TEXT("MOVED"), bNotDeep ? TEXT("untouched") : TEXT("MOVED")));
				// SC3.2e: THE EYES TAKE THE SECONDARY'S HUE (Second, RC12 real input: azure drew LIME GREEN eyes -- the skin's yellow TIMES
				// azure). Read by hue, since the eye's brightness pulses.
				{
					FLinearColor Eye;
					FLinearColor EyeRim;
					FString EyeRelief;
					const bool bEyeRead = Costume != nullptr && Costume->QaReadPaint(FName(TEXT("eye")), Eye, EyeRim, EyeRelief);
					Sc3Check(Run, TEXT("SC3.2e"), bEyeRead && Sc3SameHue(Eye, Azure->Value, 4.0f),
						FString::Printf(TEXT("COLOR 2 AZURE: the eye drawn %s (%s), want the secondary's hue %s (within 4 deg)"),
							bEyeRead ? *Sc3Rgb(Eye) : TEXT("unreadable"), bEyeRead ? *Sc3HueWord(Eye) : TEXT("-"), *Sc3HueWord(Azure->Value)));
					// THE CONTROL: the colour RC12's rule drew (the AUTHORED eye times azure: Second's RC13 review -- the post-primary eye
					// already carries the gold tint, which RC12 never multiplied in) asked the same question must say NO
					const FLinearColor OldTint = Run.EyeAuthored * Azure->Value;
					Sc3Check(Run, TEXT("SC3.2ec"), Run.bEyeAuthored && !Sc3SameHue(OldTint, Azure->Value, 4.0f),
						FString::Printf(TEXT("control: RC12's colour, the authored eye x azure %s (%s), read as azure? %s"), *Sc3Rgb(OldTint), *Sc3HueWord(OldTint),
							!Run.bEyeAuthored ? TEXT("(the authored eye was unreadable)")
								: Sc3SameHue(OldTint, Azure->Value, 4.0f) ? TEXT("YES (the judge cannot fail)") : TEXT("no")));
				}
				Sc3Measured(Run, PC, Dog, TEXT("b_c2-azure"));
				// COLOR 3 -- the STRIPS row's door
				WonderlandMascotStyle::PickMascotStrip(Crimson->Key, Crimson->Value);
				Next(5);
			}
			break;
		case 5:
			if (In >= 1.5)
			{
				Run.AfterStrips = Sc3Snapshot(Costume);
				const FString Changed = Sc3Changed(Run.AfterSecondary, Run.AfterStrips);
				const bool bStrips = Sc3BaseIs(Costume, TEXT("shadow"), Sc3StripWant(Crimson->Value), Got);
				Sc3Check(Run, TEXT("SC3.3"), Changed == TEXT("shadow") && bStrips,
					FString::Printf(TEXT("COLOR 3 CRIMSON: changed [%s] (want ONLY shadow -- not the body, marbling, eyes, visor or void edges); the strips %s, want %s"),
						*Changed, *Got, *Sc3Rgb(Sc3StripWant(Crimson->Value))));
				// THE CONTROL: the same reader, asked whether the strips are COLOR 2's azure, must say NO
				FString Wrong;
				const bool bReadAsAzure = Sc3BaseIs(Costume, TEXT("shadow"), Sc3StripWant(Azure->Value), Wrong);
				Sc3Check(Run, TEXT("SC3.3c"), !bReadAsAzure,
					FString::Printf(TEXT("control: the strips %s read as azure %s? %s"), *Wrong, *Sc3Rgb(Sc3StripWant(Azure->Value)),
						bReadAsAzure ? TEXT("YES (the reader cannot fail)") : TEXT("no")));
				// SC3.4: nothing else in the world moved -- the companions, the swords they become
				const TMap<FString, FString> Others = Sc3Others(World, Costume);
				if (Run.OthersBefore.Num() == 0)
				{
					Sc3Unmeasured(Run, TEXT("SC3.4"), TEXT("no companion bodies in the world to compare (the swords are the companions)"));
				}
				else
				{
					const FString Moved = Sc3Changed(Run.OthersBefore, Others);
					Sc3Check(Run, TEXT("SC3.4"), Moved.IsEmpty(), FString::Printf(TEXT("%d companion surfaces across COLOR 1/2/3: moved [%s] (want none)"),
						Others.Num(), *Moved));
				}
				Sc3Measured(Run, PC, Dog, TEXT("c_c3-crimson"));
				// the strips back to DEFAULT for one frame (the COLOR 3 pixel pair), then CRIMSON again before SAVE TO C.A.R.D.
				WonderlandMascotStyle::PickMascotStrip(FName(TEXT("DEFAULT")), FLinearColor::White);
				Next(30);
			}
			break;
		case 30:
			if (In >= 1.5)
			{
				const TMap<FString, FString> DefaultStrips = Sc3Snapshot(Costume);
				const FString Changed = Sc3Changed(Run.AfterStrips, DefaultStrips);
				const bool bDesigned = Sc3Line(DefaultStrips, TEXT("shadow")) == Sc3Line(Run.AfterSecondary, TEXT("shadow"));
				Sc3Check(Run, TEXT("SC3.3d"), Changed == TEXT("shadow") && bDesigned && !WonderlandMascotStyle::HasChosenStrip(),
					FString::Printf(TEXT("COLOR 3 DEFAULT (data): changed [%s] (want shadow only); the strips as designed again (as before CRIMSON): %s"),
						*Changed, bDesigned ? TEXT("yes") : TEXT("NO")));
				Sc3Measured(Run, PC, Dog, TEXT("d_c3-default"));
				WonderlandMascotStyle::PickMascotStrip(Crimson->Key, Crimson->Value);
				Next(31);
			}
			break;
		case 31:
			if (In >= 1.5)
			{
				const TMap<FString, FString> Again = Sc3Snapshot(Costume);
				const FString Differs = Sc3Changed(Run.AfterStrips, Again);
				Sc3Check(Run, TEXT("SC3.3e"), Differs.IsEmpty() && Again.Num() > 0,
					FString::Printf(TEXT("CRIMSON again before the save: every surface as at SC3.3 (differs [%s], want none; %d surfaces)"), *Differs, Again.Num()));
				Sc3Camera(Run, World, PC, Dog);
				Next(6);
			}
			break;
		case 6:
			if (In >= 0.8)
			{
				Sc3Shot(Run, TEXT("1_white_azure-marbling_crimson-strips"));
				// SAVE TO C.A.R.D. -- the section's own button
				const bool bSaved = WonderlandCardDirector::SaveLiveToActive(World, Said);
				const FWonderlandCard* Card = Store->Find(Run.CardId);
				FString FileSecondary;
				FString FileStrips;
				FString Note;
				const bool bOnDisk = Sc3CardOnDisk(*Store, Run.CardId, FileSecondary, FileStrips, Note);
				FWonderlandCardColour FromFileSecondary;
				FWonderlandCardColour FromFileStrips;
				const bool bFile = bOnDisk && FWonderlandCardStore::ParseColourText(FileSecondary, FromFileSecondary)
					&& FWonderlandCardStore::ParseColourText(FileStrips, FromFileStrips)
					&& FromFileSecondary.bChosen && Sc3Same(FromFileSecondary.Colour, Azure->Value)
					&& FromFileStrips.bChosen && Sc3Same(FromFileStrips.Colour, Crimson->Value);
				const bool bCard = Card != nullptr && Card->Primary.bChosen && Card->Primary.Key.Equals(TEXT("WHITE"), ESearchCase::IgnoreCase)
					&& Card->Secondary.bRecorded && Card->Secondary.bChosen && Sc3Same(Card->Secondary.Colour, Azure->Value)
					&& Card->Strips.bRecorded && Card->Strips.bChosen && Sc3Same(Card->Strips.Colour, Crimson->Value);
				const bool bClean = !WonderlandCardDirector::IsModified(World);
				Sc3Check(Run, TEXT("SC3.5"), bSaved && bCard && bFile && bClean,
					FString::Printf(TEXT("SAVE TO C.A.R.D.: '%s'; the card holds primary %s, colour 2 %s, colour 3 %s; Cards.sav says secondary '%s' strips '%s'%s; modified after: %s"),
						*Said, Card != nullptr ? *Card->Primary.Key : TEXT("(gone)"),
						Card != nullptr ? *WonderlandCardDirector::DescribeColour(Card->Secondary) : TEXT("-"),
						Card != nullptr ? *WonderlandCardDirector::DescribeColour(Card->Strips) : TEXT("-"),
						*FileSecondary, *FileStrips, Note.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" (%s)"), *Note), bClean ? TEXT("no") : TEXT("YES")));
				// THE CONTROL: the built-in card was never saved with a colour -- reading it as crimson strips must fail
				const FWonderlandCard* BuiltIn = Store->Find(FWonderlandCardStore::BuiltInId());
				Sc3Check(Run, TEXT("SC3.5c"), BuiltIn != nullptr && !(BuiltIn->Strips.bRecorded && Sc3Same(BuiltIn->Strips.Colour, Crimson->Value)),
					FString::Printf(TEXT("control: the built-in card's strips %s (want NOT SAVED, never crimson)"),
						BuiltIn != nullptr ? *WonderlandCardDirector::DescribeColour(BuiltIn->Strips) : TEXT("(no built-in card)")));
				Next(7);
			}
			break;
		case 7:
			// CHANGE ONLY COLOR 3 -- GOLD, the STRIPS row's door
			WonderlandMascotStyle::PickMascotStrip(Gold->Key, Gold->Value);
			Next(8);
			break;
		case 8:
			if (In >= 1.5)
			{
				Run.AfterGold = Sc3Snapshot(Costume);
				const FString Changed = Sc3Changed(Run.AfterStrips, Run.AfterGold);
				const bool bStrips = Sc3BaseIs(Costume, TEXT("shadow"), Sc3StripWant(Gold->Value), Got);
				const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
				const bool bOneTwo = WonderlandMascotStyle::IsMascotPrimaryOn(White->Key, White->Value) && Style.HasChosenSecondary()
					&& Style.Secondary.Equals(Azure->Value, 0.002f);
				FString What;
				const bool bModified = WonderlandCardDirector::IsModified(World, &What);
				Sc3Check(Run, TEXT("SC3.6"), Changed == TEXT("shadow") && bStrips && bOneTwo && bModified && What.Contains(TEXT("colour 3")),
					FString::Printf(TEXT("ONLY COLOR 3 -> GOLD: changed [%s] (want shadow only); the strips %s; COLOR 1 WHITE and COLOR 2 AZURE kept: %s; MODIFIED '%s'"),
						*Changed, *Got, bOneTwo ? TEXT("yes") : TEXT("NO"), *What));
				Sc3Shot(Run, TEXT("2_only-strips-changed_gold"));
				// RELOAD THE CARD -- the section's SELECT
				WonderlandCardDirector::Select(World, Run.CardId, Said);
				UE_LOG(LogTemp, Display, TEXT("WLSC3 select said: %s"), *Said);
				Next(9);
			}
			break;
		case 9:
			if (In >= 1.5)
			{
				const TMap<FString, FString> Back = Sc3Snapshot(Costume);
				const FString Differs = Sc3Changed(Run.AfterStrips, Back);
				Sc3Check(Run, TEXT("SC3.7"), Differs.IsEmpty() && !WonderlandCardDirector::IsModified(World),
					FString::Printf(TEXT("SELECT the card: every surface as saved (differs [%s], want none); modified %s"), *Differs,
						WonderlandCardDirector::IsModified(World) ? TEXT("YES") : TEXT("no")));
				const FString VersusGold = Sc3Changed(Run.AfterGold, Back);
				Sc3Check(Run, TEXT("SC3.7c"), VersusGold == TEXT("shadow"),
					FString::Printf(TEXT("control: the reloaded look against the gold one differs at [%s] (want shadow: the comparison can tell)"), *VersusGold));
				Sc3Shot(Run, TEXT("3_card-reloaded"));
				// THE SECONDARY ROW'S DEFAULT (Second's review, 10-04): on a SECOND card, so the QA card keeps its colours for the restart
				if (!WonderlandCardDirector::Create(World, TEXT("QA COLOR3 DEFAULT"), Run.DefaultCardId, Said))
				{
					Sc3Check(Run, TEXT("SC3.13"), false, FString::Printf(TEXT("no second card for the DEFAULT step: %s"), *Said));
					Finish();
					return false;
				}
				WonderlandCardDirector::Select(World, Run.DefaultCardId, Said);
				Sc3PickSecondary(Palette0Colour());
				Next(40);
			}
			break;
		case 40:
			if (In >= 1.5)
			{
				FLinearColor Cells;
				FLinearColor Veins;
				FLinearColor DrawnCells;
				FLinearColor DrawnVeins;
				float PeakDrawn = 0.0f;
				float PeakAsked = 0.0f;
				const bool bMarble = Costume != nullptr && Costume->QaReadMarble(FName(TEXT("bone")), Cells, Veins, DrawnCells, DrawnVeins, PeakDrawn, PeakAsked);
				const bool bOneColour = Sc3BaseIs(Costume, TEXT("bone"), WonderlandMascotStyle::SmokeBaseFor(White->Value, false), Got);
				Sc3Measured(Run, PC, Dog, TEXT("e_c2-default"));
				const bool bSaved = WonderlandCardDirector::SaveLiveToActive(World, Said);
				const FWonderlandCard* DefaultCard = Store->Find(Run.DefaultCardId);
				const bool bCardDefault = DefaultCard != nullptr && DefaultCard->Secondary.bRecorded && !DefaultCard->Secondary.bChosen;
				Sc3Check(Run, TEXT("SC3.13"), !bMarble && bOneColour && bSaved && bCardDefault,
					FString::Printf(TEXT("COLOR 2 DEFAULT (the row's first swatch, White): the body's marble %s (want none: as designed); the body %s (the one-colour look); ")
						TEXT("SAVE TO C.A.R.D. '%s'; the card holds colour 2 %s (want DEFAULT, never WHITE)"), bMarble ? TEXT("STILL DRAWN") : TEXT("none"), *Got, *Said,
						DefaultCard != nullptr ? *WonderlandCardDirector::DescribeColour(DefaultCard->Secondary) : TEXT("(gone)")));
				// THE CONTROL: the QA card's own colour 2 (AZURE) must NOT read as DEFAULT -- the reader can tell them apart
				const FWonderlandCard* QaCard = Store->Find(Run.CardId);
				const bool bQaDefault = QaCard != nullptr && QaCard->Secondary.bRecorded && !QaCard->Secondary.bChosen;
				Sc3Check(Run, TEXT("SC3.13c"), QaCard != nullptr && !bQaDefault,
					FString::Printf(TEXT("control: the QA card's colour 2 %s read as DEFAULT? %s"),
						QaCard != nullptr ? *WonderlandCardDirector::DescribeColour(QaCard->Secondary) : TEXT("(gone)"), bQaDefault ? TEXT("YES (cannot fail)") : TEXT("no")));
				// SC3.13e: DEFAULT ON THE SECONDARY ROW DRAWS THE EYES AS DESIGNED (Second's RC13 review B4: the hue rule turned them WHITE,
				// because the DEFAULT swatch is White and counts as a pick). By hue, against the eye as authored, since the glow pulses.
				{
					FLinearColor DefaultEyeDrawn;
					FLinearColor DefaultEyeRim;
					FString DefaultEyeRelief;
					const bool bDefaultEyeRead = Costume != nullptr && Costume->QaReadPaint(FName(TEXT("eye")), DefaultEyeDrawn, DefaultEyeRim, DefaultEyeRelief);
					Sc3Check(Run, TEXT("SC3.13e"), bDefaultEyeRead && Run.bEyeAuthored && Sc3SameHue(DefaultEyeDrawn, Run.EyeAuthored, 4.0f),
						FString::Printf(TEXT("COLOR 2 DEFAULT: the eye drawn %s (%s), want the authored eye's hue %s (within 4 deg; never white)"),
							bDefaultEyeRead ? *Sc3Rgb(DefaultEyeDrawn) : TEXT("unreadable"), bDefaultEyeRead ? *Sc3HueWord(DefaultEyeDrawn) : TEXT("-"),
							Run.bEyeAuthored ? *Sc3HueWord(Run.EyeAuthored) : TEXT("(the authored eye was unreadable)")));
					// THE CONTROL (Second's RC13 review m8: a WHITE eye can never pass -- Sc3HueOf rejects every grey -- so it proved nothing):
					// a COLOURED eye that is not the designed one -- the authored eye tinted by the QA's own azure, the colour the old rule drew
					// for COLOR 2 -- asked the same question must say NO. That needs the judge to tell hues apart, which it can fail to do.
					const FLinearColor TintedEye = Run.EyeAuthored * Azure->Value;
					Sc3Check(Run, TEXT("SC3.13ec"), Run.bEyeAuthored && !Sc3SameHue(TintedEye, Run.EyeAuthored, 4.0f),
						FString::Printf(TEXT("control: an azure-tinted eye %s (%s) read as the designed hue %s? %s"), *Sc3Rgb(TintedEye), *Sc3HueWord(TintedEye),
							*Sc3HueWord(Run.EyeAuthored), Sc3SameHue(TintedEye, Run.EyeAuthored, 4.0f) ? TEXT("YES (the judge cannot fail)") : TEXT("no")));
				}
				WonderlandCardDirector::Select(World, Run.CardId, Said);
				UE_LOG(LogTemp, Display, TEXT("WLSC3 select said: %s"), *Said);
				Next(41);
			}
			break;
		case 41:
			if (In >= 1.5)
			{
				const TMap<FString, FString> Back = Sc3Snapshot(Costume);
				const FString Differs = Sc3Changed(Run.AfterStrips, Back);
				Sc3Check(Run, TEXT("SC3.14"), Back.Num() > 0 && Differs.IsEmpty() && Store->GetActiveId() == Run.CardId && !WonderlandCardDirector::IsModified(World),
					FString::Printf(TEXT("back on the QA card for the restart: every surface as saved (differs [%s], want none); active %s; modified %s"), *Differs,
						Store->GetActiveId() == Run.CardId ? TEXT("yes") : TEXT("NO"), WonderlandCardDirector::IsModified(World) ? TEXT("YES") : TEXT("no")));
				UE_LOG(LogTemp, Display, TEXT("WLSC3 left for the restart: card %s active, WHITE / AZURE marbling / CRIMSON strips"), *Run.CardId);
				Finish();
				return false;
			}
			break;
		// ================================================================ THE RESTART BOOT: nothing picked before it reads
		case 20:
			if (In >= 4.0)
			{
				Run.AfterRestart = Sc3Snapshot(Costume);
				const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
				FString GotStrips;
				const bool bLive = Dog->GetWornSkinId() == FName(TEXT("shadow_flame"))
					&& WonderlandMascotStyle::IsMascotPrimaryOn(White->Key, White->Value)
					&& Style.HasChosenSecondary() && Style.Secondary.Equals(Azure->Value, 0.002f)
					&& WonderlandMascotStyle::HasChosenStrip() && WonderlandMascotStyle::StripColour().Equals(Crimson->Value, 0.002f);
				const bool bPaint = Sc3MarbleIs(Costume, WonderlandMascotStyle::SmokeMarbleCellsFor(White->Value, false), Azure->Value, Got)
					&& Sc3BaseIs(Costume, TEXT("shadow"), Sc3StripWant(Crimson->Value), GotStrips);
				Sc3Check(Run, TEXT("SC3.8"), bLive && bPaint,
					FString::Printf(TEXT("after a clean exit and a restart (DATA: the paint the code holds; the frames carry what is visible): wears %s; COLOR 1 WHITE ring %s; COLOR 2 %s; COLOR 3 %s; painted body %s, strips %s"),
						*Dog->GetWornSkinId().ToString(), WonderlandMascotStyle::IsMascotPrimaryOn(White->Key, White->Value) ? TEXT("on") : TEXT("OFF"),
						*Sc3Rgb(Style.Secondary), *Sc3Rgb(WonderlandMascotStyle::StripColour()), *Got, *GotStrips));
				const FWonderlandCard* Card = Store->GetCards().FindByPredicate([](const FWonderlandCard& Each) { return Each.Name == Sc3CardName; });
				Run.CardId = Card != nullptr ? Card->Id : FString();
				const FWonderlandCard* BuiltIn = Store->Find(FWonderlandCardStore::BuiltInId());
				const bool bCard = Card != nullptr && Store->GetActiveId() == Card->Id
					&& Card->Secondary.bRecorded && Card->Secondary.bChosen && Sc3Same(Card->Secondary.Colour, Azure->Value)
					&& Card->Strips.bRecorded && Card->Strips.bChosen && Sc3Same(Card->Strips.Colour, Crimson->Value);
				// AN OLD CARD STAYS AS IT WAS: the built-in card, loaded from the same file, never recorded a channel and still has none
				const bool bOld = BuiltIn != nullptr && !BuiltIn->Secondary.bRecorded && !BuiltIn->Strips.bRecorded && !BuiltIn->Flame.bRecorded;
				Sc3Check(Run, TEXT("SC3.9"), bCard && bOld && !WonderlandCardDirector::IsModified(World),
					FString::Printf(TEXT("Cards.sav reloaded: the QA card %s active %s, colour 2 %s, colour 3 %s; the built-in card's channels %s/%s/%s (want NOT SAVED); modified %s; load note '%s'"),
						*Run.CardId, Card != nullptr && Store->GetActiveId() == Card->Id ? TEXT("yes") : TEXT("NO"),
						Card != nullptr ? *WonderlandCardDirector::DescribeColour(Card->Secondary) : TEXT("-"),
						Card != nullptr ? *WonderlandCardDirector::DescribeColour(Card->Strips) : TEXT("-"),
						BuiltIn != nullptr ? *WonderlandCardDirector::DescribeColour(BuiltIn->Secondary) : TEXT("-"),
						BuiltIn != nullptr ? *WonderlandCardDirector::DescribeColour(BuiltIn->Strips) : TEXT("-"),
						BuiltIn != nullptr ? *WonderlandCardDirector::DescribeColour(BuiltIn->Flame) : TEXT("-"),
						WonderlandCardDirector::IsModified(World) ? TEXT("YES") : TEXT("no"), *Store->GetLoadNote()));
				Sc3Camera(Run, World, PC, Dog);
				Next(21);
			}
			break;
		case 21:
			if (In >= 0.8)
			{
				Sc3Shot(Run, TEXT("4_after-restart"));
				// RELOAD THE SAME CONFIGURATION -- the section's SELECT on the card that came back
				if (!Run.CardId.IsEmpty())
				{
					WonderlandCardDirector::Select(World, Run.CardId, Said);
					UE_LOG(LogTemp, Display, TEXT("WLSC3 select said: %s"), *Said);
				}
				Next(22);
			}
			break;
		case 22:
			if (In >= 1.5)
			{
				const TMap<FString, FString> Reloaded = Sc3Snapshot(Costume);
				const FString Differs = Sc3Changed(Run.AfterRestart, Reloaded);
				int32 Unreadable = 0;
				for (const TPair<FString, FString>& Surface : Reloaded)
				{
					Unreadable += Surface.Value == TEXT("unreadable") ? 1 : 0;
				}
				Sc3Check(Run, TEXT("SC3.10"), !Run.CardId.IsEmpty() && Reloaded.Num() > 0 && Unreadable == 0 && Differs.IsEmpty(),
					FString::Printf(TEXT("SELECT after the restart: every surface exactly as it came back (differs [%s], want none; %d surfaces, %d unreadable)"),
						*Differs, Reloaded.Num(), Unreadable));
				// THE CONTROL: the same reading with ONE surface (the strips) altered must be told apart, by exactly that surface
				TMap<FString, FString> Altered = Reloaded;
				if (FString* Strips = Altered.Find(TEXT("shadow")))
				{
					*Strips += TEXT(" (altered by the control)");
				}
				const FString Caught = Sc3Changed(Run.AfterRestart, Altered);
				Sc3Check(Run, TEXT("SC3.10c"), Caught == TEXT("shadow"),
					FString::Printf(TEXT("control: one altered surface found as [%s] (want shadow: the comparison can fail)"), *Caught));
				// CHANGE ONLY COLOR 3 AGAIN -- JADE
				WonderlandMascotStyle::PickMascotStrip(Jade->Key, Jade->Value);
				Next(23);
			}
			break;
		case 23:
			if (In >= 1.5)
			{
				Run.AfterJade = Sc3Snapshot(Costume);
				const FString Changed = Sc3Changed(Run.AfterRestart, Run.AfterJade);
				const bool bStrips = Sc3BaseIs(Costume, TEXT("shadow"), Sc3StripWant(Jade->Value), Got);
				const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
				const bool bOneTwo = WonderlandMascotStyle::IsMascotPrimaryOn(White->Key, White->Value) && Style.HasChosenSecondary()
					&& Style.Secondary.Equals(Azure->Value, 0.002f);
				FString What;
				const bool bModified = WonderlandCardDirector::IsModified(World, &What);
				Sc3Check(Run, TEXT("SC3.11"), Changed == TEXT("shadow") && bStrips && bOneTwo && bModified,
					FString::Printf(TEXT("after the restart, ONLY COLOR 3 -> JADE: changed [%s] (want shadow only); the strips %s; COLOR 1 and COLOR 2 kept: %s; MODIFIED '%s'"),
						*Changed, *Got, bOneTwo ? TEXT("yes") : TEXT("NO"), *What));
				Sc3Shot(Run, TEXT("5_after-restart_only-strips_jade"));
				// and back to the card, so the run leaves the saved look on
				if (!Run.CardId.IsEmpty())
				{
					WonderlandCardDirector::Select(World, Run.CardId, Said);
				}
				Next(24);
			}
			break;
		case 24:
			if (In >= 1.5)
			{
				const TMap<FString, FString> Back = Sc3Snapshot(Costume);
				const FString Differs = Sc3Changed(Run.AfterRestart, Back);
				const FString VersusJade = Sc3Changed(Run.AfterJade, Back);
				Sc3Check(Run, TEXT("SC3.12"), Differs.IsEmpty() && VersusJade == TEXT("shadow"),
					FString::Printf(TEXT("SELECT again: as saved (differs [%s], want none); control: against the jade look [%s] (want shadow)"), *Differs, *VersusJade));
				Finish();
				return false;
			}
			break;
		default:
			Finish();
			return false;
		}
		return true;
	}

	FAutoConsoleCommandWithWorldAndArgs GSc3Command(
		TEXT("wl.Qa.ShadowColour3"),
		TEXT("Shadow Flame's three colours through the real Project Brain / C.A.R.D. path (founder, 10-04): COLOR 1 WHITE, COLOR 2 AZURE marbling, ")
		TEXT("COLOR 3 CRIMSON strips through the rows' own doors, SAVE TO C.A.R.D., only COLOR 3 changed, the card reloaded (SC3.0-SC3.7), the SECONDARY row's ")
		TEXT("DEFAULT on a second card (SC3.13-SC3.14), then quits; frames a-e with their head/body boxes for the runner's PIXEL measure (VISIBLE is judged there). ")
		TEXT("`restart` (the next boot): the colours and the card came back, reload, only COLOR 3 changed again (SC3.8-SC3.12). Frames in Saved/Screenshots/WLSHADOWCOLOR3."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GSc3Run.IsValid())
			{
				return;
			}
			GSc3Run = MakeShared<FSc3Run>();
			GSc3Run->World = World;
			GSc3Run->At = Sc3Now();
			GSc3Run->bRestart = Args.ContainsByPredicate([](const FString& Arg) { return Arg.Equals(TEXT("restart"), ESearchCase::IgnoreCase); });
			GSc3Run->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLSHADOWCOLOR3"));
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&Sc3Tick), 0.0f);
			UE_LOG(LogTemp, Display, TEXT("WLSC3 armed (%s)"), GSc3Run->bRestart ? TEXT("the restart boot: SC3.8-SC3.12") : TEXT("the first boot: SC3.0-SC3.7"));
		}));

	/* ================================================================ wl.Qa.WardrobeSwatches (Second, R7, 10-04)
	 * EVERY WARDROBE SWATCH CAN BE CLICKED. Second's explore frame on 92f83bff showed the Wardrobe's skin-card list drawn OVER the colourway
	 * rows with Shadow Flame worn: PRIMARY's JADE, ROSE, SLATE and OBSIDIAN and SECONDARY's last swatches hidden, a click there hitting the
	 * card. With Project Brain's Wardrobe open and each skin worn in turn, every swatch the Wardrobe SHOWS has its centre hit-tested by
	 * Slate itself (LocateWindowUnderMouse, the path a real click would take), and that path must run through THAT swatch's own button
	 * (WardrobeSwatch.<ROW>.<COLOUR>, tagged in WonderlandProjectBrainPanel.cpp).
	 *   WS1.<n>  skin n: every shown swatch hit by its own centre (and at least the PRIMARY and SECONDARY rows seen)
	 *   WSX      the control: wl.Qa.WardrobeOverflow 1 (the rows unscaled, the R7 overlap back) on Shadow Flame -- a swatch must be MISSED
	 *   WSXR     the knob put back: every swatch hit again
	 * Lines WLWS; `quit` exits after.
	 */
	struct FWsRun
	{
		TWeakObjectPtr<UWorld> World;
		int32 Phase = 0;
		double At = 0.0;
		int32 SkinIndex = 0;
		TArray<FName> SkinIds;
		FName WornBefore = NAME_None;
		int32 Pass = 0;
		int32 Fail = 0;
		bool bQuit = false;
	};
	TSharedPtr<FWsRun> GWsRun;

	struct FWsHits
	{
		int32 Seen = 0;
		int32 Hit = 0;
		int32 RowsSeen = 0;
		FString Rows;
		FString Misses;
	};

	void WsCollect(const TSharedRef<SWidget>& Widget, TArray<TSharedRef<SWidget>>& Out)
	{
		if (Widget->GetTag().ToString().StartsWith(TEXT("WardrobeSwatch.")))
		{
			Out.Add(Widget);
		}
		FChildren* Children = Widget->GetChildren();
		for (int32 ChildIndex = 0; Children != nullptr && ChildIndex < Children->Num(); ++ChildIndex)
		{
			WsCollect(Children->GetChildAt(ChildIndex), Out);
		}
	}

	/** Shown: neither the swatch nor anything above it is collapsed or hidden (a skin without fire collapses the FLAME row). */
	bool WsShown(const TSharedRef<SWidget>& Widget)
	{
		for (TSharedPtr<SWidget> Up = Widget; Up.IsValid(); Up = Up->GetParentWidget())
		{
			const EVisibility Shown = Up->GetVisibility();
			if (Shown == EVisibility::Collapsed || Shown == EVisibility::Hidden)
			{
				return false;
			}
		}
		return true;
	}

	FWsHits WsTest()
	{
		FWsHits Hits;
		if (!FSlateApplication::IsInitialized())
		{
			return Hits;
		}
		FSlateApplication& SlateApp = FSlateApplication::Get();
		const TArray<TSharedRef<SWindow>> TopWindows = SlateApp.GetInteractiveTopLevelWindows();
		TArray<TSharedRef<SWidget>> Swatches;
		for (const TSharedRef<SWindow>& Window : TopWindows)
		{
			WsCollect(Window, Swatches);
		}
		TMap<FString, FIntPoint> PerRow;   // X = shown, Y = hit by its own centre
		for (const TSharedRef<SWidget>& Swatch : Swatches)
		{
			const FGeometry Placed = Swatch->GetTickSpaceGeometry();
			if (!WsShown(Swatch) || Placed.GetLocalSize().X < 1.0f || Placed.GetLocalSize().Y < 1.0f)
			{
				continue;
			}
			const FVector2D Centre = Placed.GetAbsolutePositionAtCoordinates(FVector2D(0.5f, 0.5f));
			const FWidgetPath Under = SlateApp.LocateWindowUnderMouse(Centre, TopWindows, true);
			bool bOwn = false;
			for (int32 Step = 0; Step < Under.Widgets.Num(); ++Step)
			{
				bOwn = bOwn || Under.Widgets[Step].Widget == Swatch;
			}
			FString RowWord;
			FString ColourWord;
			Swatch->GetTag().ToString().RightChop(15).Split(TEXT("."), &RowWord, &ColourWord);
			FIntPoint& Count = PerRow.FindOrAdd(RowWord);
			++Count.X;
			++Hits.Seen;
			if (bOwn)
			{
				++Count.Y;
				++Hits.Hit;
			}
			else
			{
				Hits.Misses += FString::Printf(TEXT("%s%s %s at (%.0f, %.0f) -> %s"), Hits.Misses.IsEmpty() ? TEXT("") : TEXT("; "), *RowWord, *ColourWord,
					Centre.X, Centre.Y, Under.Widgets.Num() > 0 ? *Under.Widgets.Last().Widget->GetTypeAsString() : TEXT("nothing"));
			}
		}
		Hits.RowsSeen = PerRow.Num();
		for (const TPair<FString, FIntPoint>& Row : PerRow)
		{
			Hits.Rows += FString::Printf(TEXT("%s%s %d/%d"), Hits.Rows.IsEmpty() ? TEXT("") : TEXT(", "), *Row.Key, Row.Value.Y, Row.Value.X);
		}
		return Hits;
	}

	void WsCheck(FWsRun& Run, const FString& Id, bool bOk, const FString& Detail)
	{
		(bOk ? Run.Pass : Run.Fail) += 1;
		UE_LOG(LogTemp, Display, TEXT("WLWS %s %s | %s"), *Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
	}

	/** The skin the registry says is worn now (the WS lines name it beside the one asked for: a locked skin may refuse). */
	FString WsWorn(const UWorld* World)
	{
		const UGameInstance* Game = World != nullptr ? World->GetGameInstance() : nullptr;
		const UWonderlandRelaySkinSubsystem* Registry = Game != nullptr ? Game->GetSubsystem<UWonderlandRelaySkinSubsystem>() : nullptr;
		return Registry != nullptr ? Registry->GetEquipped().SkinId.ToString() : FString(TEXT("(no registry)"));
	}

	UWonderlandUiSubsystem* WsUi(UWorld* World)
	{
		const APlayerController* Pc = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		const ULocalPlayer* Player = Pc != nullptr ? Pc->GetLocalPlayer() : nullptr;
		return Player != nullptr ? Player->GetSubsystem<UWonderlandUiSubsystem>() : nullptr;
	}

	bool WsTick(float)
	{
		if (!GWsRun.IsValid())
		{
			return false;
		}
		FWsRun& Run = *GWsRun;
		UWorld* World = Run.World.Get();
		UWonderlandUiSubsystem* Ui = WsUi(World);
		const double In = Sc3Now() - Run.At;
		auto Next = [&Run](int32 To)
		{
			Run.Phase = To;
			Run.At = Sc3Now();
		};
		auto Finish = [&Run, World, Ui](const TCHAR* Why)
		{
			if (World != nullptr)
			{
				GEngine->Exec(World, TEXT("wl.Qa.WardrobeOverflow 0"));
				if (!Run.WornBefore.IsNone())
				{
					GEngine->Exec(World, *FString::Printf(TEXT("wl.Skins.Wear %s"), *Run.WornBefore.ToString()));
				}
			}
			if (Ui != nullptr && Ui->IsProjectBrainOpen())
			{
				Ui->SetBrainSkinsOpen(false);
				Ui->ToggleProjectBrain();
			}
			UE_LOG(LogTemp, Display, TEXT("WLWS END pass=%d fail=%d (%s)"), Run.Pass, Run.Fail, Why);
			const bool bQuit = Run.bQuit;
			GWsRun.Reset();
			if (bQuit)
			{
				FPlatformMisc::RequestExit(false);
			}
			return false;
		};
		if (World == nullptr || Ui == nullptr)
		{
			return In < 30.0 ? true : Finish(TEXT("no world or UI"));
		}
		switch (Run.Phase)
		{
		case 0:
		{
			if (In < 8.0)
			{
				return true;
			}
			Ui->DismissWelcome();
			Ui->CloseOverlay();
			const UGameInstance* Game = World->GetGameInstance();
			const UWonderlandRelaySkinSubsystem* Registry = Game != nullptr ? Game->GetSubsystem<UWonderlandRelaySkinSubsystem>() : nullptr;
			if (Registry == nullptr || Registry->GetSkins().Num() == 0)
			{
				return Finish(TEXT("no skin registry"));
			}
			for (const FWonderlandRelaySkin& Skin : Registry->GetSkins())
			{
				Run.SkinIds.Add(Skin.SkinId);
			}
			Run.WornBefore = Registry->GetEquipped().SkinId;
			if (!Ui->IsProjectBrainOpen())
			{
				Ui->ToggleProjectBrain();
			}
			Ui->SetBrainSkinsOpen(true);
			UE_LOG(LogTemp, Display, TEXT("WLWS the Wardrobe open: %d skins to wear in turn (worn now: %s)"), Run.SkinIds.Num(), *Run.WornBefore.ToString());
			Next(1);
			return true;
		}
		case 1:
			// each skin in turn: worn, a moment to lay the rows out and paint, then every shown swatch hit-tested
			if (Run.SkinIndex >= Run.SkinIds.Num())
			{
				GEngine->Exec(World, TEXT("wl.Skins.Wear shadow_flame"));
				Next(3);
				return true;
			}
			if (In < 0.2)
			{
				return true;
			}
			GEngine->Exec(World, *FString::Printf(TEXT("wl.Skins.Wear %s"), *Run.SkinIds[Run.SkinIndex].ToString()));
			Next(2);
			return true;
		case 2:
		{
			if (In < 1.5)
			{
				return true;
			}
			const FWsHits Hits = WsTest();
			WsCheck(Run, FString::Printf(TEXT("WS1.%d"), Run.SkinIndex + 1), Hits.Seen > 0 && Hits.Hit == Hits.Seen && Hits.RowsSeen >= 2,
				FString::Printf(TEXT("%s (asked to wear %s): %d of %d shown swatches hit by their own centre over %d row(s) [%s]%s%s"),
					*WsWorn(World), *Run.SkinIds[Run.SkinIndex].ToString(), Hits.Hit, Hits.Seen, Hits.RowsSeen, *Hits.Rows,
					Hits.Misses.IsEmpty() ? TEXT("") : TEXT("; MISSED: "), *Hits.Misses));
			++Run.SkinIndex;
			Next(1);
			return true;
		}
		case 3:
			// THE CONTROL: Shadow Flame worn, the rows unscaled -- the R7 overlap back -- and a swatch MUST be missed
			if (In < 1.0)
			{
				return true;
			}
			GEngine->Exec(World, TEXT("wl.Qa.WardrobeOverflow 1"));
			Next(4);
			return true;
		case 4:
		{
			if (In < 1.5)
			{
				return true;
			}
			const FWsHits Hits = WsTest();
			WsCheck(Run, TEXT("WSX"), Hits.Seen > 0 && Hits.Hit < Hits.Seen,
				FString::Printf(TEXT("the control, wl.Qa.WardrobeOverflow 1 on %s: %d of %d shown swatches hit [%s] (want at least one MISSED: the check can fail)%s%s"),
					*WsWorn(World), Hits.Hit, Hits.Seen, *Hits.Rows, Hits.Misses.IsEmpty() ? TEXT(" -- none missed: the rows fit this window unscaled, so the control cannot fail here") : TEXT("; missed: "),
					*Hits.Misses));
			GEngine->Exec(World, TEXT("wl.Qa.WardrobeOverflow 0"));
			Next(5);
			return true;
		}
		case 5:
		{
			if (In < 1.5)
			{
				return true;
			}
			const FWsHits Hits = WsTest();
			WsCheck(Run, TEXT("WSXR"), Hits.Seen > 0 && Hits.Hit == Hits.Seen,
				FString::Printf(TEXT("the knob put back on %s: %d of %d shown swatches hit [%s]%s%s"), *WsWorn(World), Hits.Hit, Hits.Seen, *Hits.Rows,
					Hits.Misses.IsEmpty() ? TEXT("") : TEXT("; MISSED: "), *Hits.Misses));
			return Finish(TEXT("done"));
		}
		default:
			return Finish(TEXT("an unknown phase"));
		}
	}

	FAutoConsoleCommandWithWorldAndArgs GWsCommand(
		TEXT("wl.Qa.WardrobeSwatches"),
		TEXT("Every Wardrobe colourway swatch can be clicked (Second, R7, 10-04): with Project Brain's Wardrobe open and each skin worn in turn, every ")
		TEXT("shown swatch's centre hit-tested by Slate must reach that swatch's own button (WS1.<n>); the control wl.Qa.WardrobeOverflow 1 must make one ")
		TEXT("miss (WSX); put back, all hit again (WSXR). Lines WLWS; `quit` exits after."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GWsRun.IsValid() || World == nullptr)
			{
				return;
			}
			GWsRun = MakeShared<FWsRun>();
			GWsRun->World = World;
			GWsRun->At = Sc3Now();
			GWsRun->bQuit = Args.ContainsByPredicate([](const FString& Arg) { return Arg.Equals(TEXT("quit"), ESearchCase::IgnoreCase); });
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&WsTick), 0.0f);
			UE_LOG(LogTemp, Display, TEXT("WLWS armed"));
		}));
}
