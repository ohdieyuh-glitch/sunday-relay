// Copyright Wonderland. THE ANGELIC TWIN SWORDS. See WonderlandHandoffSwords.h.
#include "WonderlandHandoffSwords.h"

#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Actor.h"
#include "HAL/IConsoleManager.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"

namespace
{
	// The Relay Dog's mission props' own engine materials and mesh (RelayDogCharacter.cpp): cooked into every package already.
	const TCHAR* const SwordLitParent = TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial");
	const TCHAR* const SwordGlowParent = TEXT("/Engine/EngineDebugMaterials/LevelColorationUnlitMaterial.LevelColorationUnlitMaterial");
	const TCHAR* const SwordCubePath = TEXT("/Engine/BasicShapes/Cube.Cube");

	/** THE EMISSIVE SCALE, a console variable so the frames can calibrate it without a build (the white point is 25,000). */
	TAutoConsoleVariable<float> CVarSwordExposure(TEXT("wl.Handoff.SwordExposure"), 4000.0f,
		TEXT("Mission Handoff swords: the scene exposure their emissive parts are multiplied by (the mission props use 4000)."));
	// EACH EMISSIVE PART'S LEVEL, live: the first frames read the blade light grey at noon (3.2) and the wings as grey planks
	// (lit), so the blade, the orb and the fuller came up and the feathers now glow white. Settled by frames, never asserted.
	TAutoConsoleVariable<float> CVarSwordBlade(TEXT("wl.Handoff.Sword.Blade"), 5.5f, TEXT("Mission Handoff swords: the white blade's emissive level."));
	TAutoConsoleVariable<float> CVarSwordFuller(TEXT("wl.Handoff.Sword.Fuller"), 3.4f, TEXT("Mission Handoff swords: the fuller's (engraving / runes) emissive level."));
	TAutoConsoleVariable<float> CVarSwordCore(TEXT("wl.Handoff.Sword.Core"), 10.0f, TEXT("Mission Handoff swords: the orb core's and the gems' emissive level."));
	TAutoConsoleVariable<float> CVarSwordFeather(TEXT("wl.Handoff.Sword.Feather"), 1.3f, TEXT("Mission Handoff swords: the wings' feathers' emissive level."));

	float SwordLevel(WonderlandHandoffSwords::ESwordPart Part)
	{
		switch (Part)
		{
		case WonderlandHandoffSwords::ESwordPart::Blade: return FMath::Clamp(CVarSwordBlade.GetValueOnGameThread(), 0.0f, 100.0f);
		case WonderlandHandoffSwords::ESwordPart::Fuller: return FMath::Clamp(CVarSwordFuller.GetValueOnGameThread(), 0.0f, 100.0f);
		case WonderlandHandoffSwords::ESwordPart::Core: return FMath::Clamp(CVarSwordCore.GetValueOnGameThread(), 0.0f, 100.0f);
		case WonderlandHandoffSwords::ESwordPart::Feather: return FMath::Clamp(CVarSwordFeather.GetValueOnGameThread(), 0.0f, 100.0f);
		default: return 1.0f;
		}
	}

	FTransform BoxXf(const WonderlandHandoffSwords::FSwordBox& Box, float Scale)
	{
		// the engine cube is 100 uu on a side
		return FTransform(Box.Turn, Box.Centre * Scale, Box.Size * (Scale / 100.0f));
	}

	float SmoothStep01(float X)
	{
		const float T = FMath::Clamp(X, 0.0f, 1.0f);
		return T * T * (3.0f - 2.0f * T);
	}
}

namespace WonderlandHandoffSwords
{
	const TCHAR* PartName(ESwordPart Part)
	{
		switch (Part)
		{
		case ESwordPart::Blade: return TEXT("Blade");
		case ESwordPart::Fuller: return TEXT("Fuller");
		case ESwordPart::Metal: return TEXT("Metal");
		case ESwordPart::Grip: return TEXT("Grip");
		case ESwordPart::Feather: return TEXT("Feather");
		case ESwordPart::Core: return TEXT("Core");
		default: return TEXT("Part");
		}
	}

	bool IsEmissive(ESwordPart Part)
	{
		// the feathers glow too: lit, the thin white planks read grey against the sun (the first noon frames)
		return Part == ESwordPart::Blade || Part == ESwordPart::Fuller || Part == ESwordPart::Core || Part == ESwordPart::Feather;
	}

	FLinearColor PartColour(ESwordPart Part, bool bGold)
	{
		// Emissive parts are LEVELS (times the exposure): the orb brightest, the blade "extremely bright" white, the fuller under
		// it in the sword's own energy colour, the feathers a soft white -- so the detail survives instead of blooming every part
		// to white. The levels are live console variables (wl.Handoff.Sword.*), calibrated by frames at noon and at night.
		switch (Part)
		{
		case ESwordPart::Blade: return (bGold ? FLinearColor(1.00f, 0.95f, 0.84f) : FLinearColor(0.90f, 0.96f, 1.00f)) * SwordLevel(Part);
		case ESwordPart::Fuller: return (bGold ? FLinearColor(1.00f, 0.62f, 0.14f) : FLinearColor(0.16f, 0.82f, 1.00f)) * SwordLevel(Part);
		case ESwordPart::Core: return (bGold ? FLinearColor(1.00f, 0.76f, 0.30f) : FLinearColor(0.32f, 0.92f, 1.00f)) * SwordLevel(Part);
		case ESwordPart::Feather: return (bGold ? FLinearColor(1.00f, 0.95f, 0.84f) : FLinearColor(0.90f, 0.96f, 1.00f)) * SwordLevel(Part);
		case ESwordPart::Metal: return bGold ? FLinearColor(0.86f, 0.62f, 0.18f) : FLinearColor(0.78f, 0.82f, 0.88f);
		case ESwordPart::Grip: return bGold ? FLinearColor(0.93f, 0.91f, 0.86f) : FLinearColor(0.92f, 0.94f, 0.97f);
		default: return FLinearColor::White;
		}
	}

	TArray<FSwordBox> BuildSword(bool bGold)
	{
		TArray<FSwordBox> Out;
		auto Add = [&Out](ESwordPart Part, const FVector& Centre, const FVector& Size, const FRotator& Turn = FRotator::ZeroRotator)
		{
			FSwordBox& Box = Out.AddDefaulted_GetRef();
			Box.Part = Part;
			Box.Centre = Centre;
			Box.Size = Size;
			Box.Turn = Turn;
		};
		// A rotation in the sword's own YZ plane (about +X, the blade's flat normal): positive tips +Y toward +Z.
		auto InPlane = [](float Degrees) { return FRotator(0.0f, 0.0f, Degrees); };

		// ---------------------------------------------------------------- the grip: white, wrapped in a lattice of metal
		Add(ESwordPart::Grip, FVector::ZeroVector, FVector(4.0f, 4.0f, 2.0f * GripHalfUU));
		for (int32 Row = 0; Row < 3; ++Row)
		{
			const float Z = -7.0f + 7.0f * Row;
			for (const float Face : { -1.0f, 1.0f })
			{
				// the diamond wrap: two crossing strips on each broad face, and two on each narrow one
				Add(ESwordPart::Metal, FVector(Face * 2.15f, 0.0f, Z), FVector(0.35f, 0.9f, 6.2f), InPlane(42.0f));
				Add(ESwordPart::Metal, FVector(Face * 2.15f, 0.0f, Z), FVector(0.35f, 0.9f, 6.2f), InPlane(-42.0f));
				Add(ESwordPart::Metal, FVector(0.0f, Face * 2.15f, Z), FVector(0.9f, 0.35f, 6.2f), FRotator(42.0f, 0.0f, 0.0f));
				Add(ESwordPart::Metal, FVector(0.0f, Face * 2.15f, Z), FVector(0.9f, 0.35f, 6.2f), FRotator(-42.0f, 0.0f, 0.0f));
			}
		}
		// collars at both ends of the grip
		Add(ESwordPart::Metal, FVector(0.0f, 0.0f, GripHalfUU), FVector(5.2f, 5.2f, 1.6f));
		Add(ESwordPart::Metal, FVector(0.0f, 0.0f, -GripHalfUU), FVector(5.2f, 5.2f, 1.6f));

		// ---------------------------------------------------------------- the pommel: a compass sun with star rays, a gem at its heart
		{
			const FVector C(0.0f, 0.0f, PommelZ);
			const int32 RingBoxes = 12;
			for (int32 i = 0; i < RingBoxes; ++i)
			{
				const float A = 2.0f * PI * i / RingBoxes;
				Add(ESwordPart::Metal, C + FVector(0.0f, FMath::Cos(A) * 4.6f, FMath::Sin(A) * 4.6f), FVector(1.6f, 2.8f, 1.2f),
					InPlane(FMath::RadiansToDegrees(A) + 90.0f));
			}
			for (int32 i = 0; i < 8; ++i)
			{
				// eight rays, the four cardinal ones longer: a compass star
				const float A = 2.0f * PI * i / 8.0f;
				const float Long = (i % 2 == 0) ? 6.5f : 4.0f;
				Add(ESwordPart::Metal, C + FVector(0.0f, FMath::Cos(A) * (5.2f + Long * 0.5f), FMath::Sin(A) * (5.2f + Long * 0.5f)),
					FVector(1.0f, Long, 0.9f), InPlane(FMath::RadiansToDegrees(A)));
			}
			Add(ESwordPart::Core, C, FVector(2.6f, 3.4f, 3.4f), InPlane(45.0f));
		}

		// ---------------------------------------------------------------- the crossguard: thorned metal, the orb core, the wings
		const float GuardZ = GripHalfUU + 2.4f;
		Add(ESwordPart::Metal, FVector(0.0f, 0.0f, GuardZ), FVector(4.2f, 24.0f, 3.2f));
		for (const float Side : { -1.0f, 1.0f })
		{
			// the thorn flares at each end: one swept up, one swept down, a spike outward
			Add(ESwordPart::Metal, FVector(0.0f, Side * 13.0f, GuardZ + 2.4f), FVector(2.6f, 1.6f, 6.0f), InPlane(Side * -32.0f));
			Add(ESwordPart::Metal, FVector(0.0f, Side * 12.0f, GuardZ - 2.4f), FVector(2.6f, 1.4f, 4.8f), InPlane(Side * 30.0f));
			Add(ESwordPart::Metal, FVector(0.0f, Side * 14.6f, GuardZ), FVector(2.2f, 4.0f, 1.2f));
			// small thorns along the bar
			Add(ESwordPart::Metal, FVector(0.0f, Side * 7.0f, GuardZ + 2.0f), FVector(1.8f, 1.0f, 2.4f), InPlane(Side * -20.0f));
		}
		// THE ORB CORE: a radiant star -- two cubes turned against each other -- inside a ring of metal
		Add(ESwordPart::Core, FVector(0.0f, 0.0f, GuardZ), FVector(5.4f, 5.4f, 5.4f), InPlane(45.0f));
		Add(ESwordPart::Core, FVector(0.0f, 0.0f, GuardZ), FVector(5.8f, 4.0f, 4.0f), FRotator(0.0f, 45.0f, 0.0f));
		for (int32 i = 0; i < 10; ++i)
		{
			const float A = 2.0f * PI * i / 10.0f;
			Add(ESwordPart::Metal, FVector(0.0f, FMath::Cos(A) * 4.8f, GuardZ + FMath::Sin(A) * 4.8f), FVector(4.8f, 2.6f, 1.0f),
				InPlane(FMath::RadiansToDegrees(A) + 90.0f));
		}
		// THE WINGS: two white feathered wings spreading from the guard, each a fan of feathers sweeping outward and up
		{
			const float Angles[] = { 8.0f, 22.0f, 36.0f, 50.0f, 64.0f, 78.0f };
			const float Lengths[] = { 21.0f, 24.0f, 23.0f, 20.0f, 16.0f, 11.0f };
			for (const float Side : { -1.0f, 1.0f })
			{
				const FVector Base(0.0f, Side * 6.0f, GuardZ + 1.0f);
				for (int32 i = 0; i < 6; ++i)
				{
					const float A = FMath::DegreesToRadians(Angles[i]);
					const FVector Dir(0.0f, Side * FMath::Cos(A), FMath::Sin(A));
					const float L = Lengths[i];
					// the feather lies along Dir in the guard's plane; tipped so +Y (its length) runs along Dir
					const FRotator Turn = InPlane(Side * Angles[i]);
					Add(ESwordPart::Feather, Base + Dir * (L * 0.5f + 2.0f), FVector(1.2f, L, 3.4f - i * 0.25f), Turn);
					// its edge: a thin line of the sword's metal along the feather's upper side
					const FVector Edge = FVector(0.0f, -FMath::Sin(A) * Side, FMath::Cos(A)) * 1.7f;
					Add(ESwordPart::Metal, Base + Dir * (L * 0.5f + 2.0f) + Edge, FVector(1.4f, L * 0.92f, 0.45f), Turn);
				}
			}
		}

		// ---------------------------------------------------------------- below the guard: filigree spikes and a gem at the blade's root
		for (const float Side : { -1.0f, 1.0f })
		{
			Add(ESwordPart::Metal, FVector(0.0f, Side * 4.0f, BladeRootZ + 2.5f), FVector(2.0f, 1.0f, 7.0f), InPlane(Side * 24.0f));
		}
		Add(ESwordPart::Core, FVector(0.0f, 0.0f, BladeRootZ + 3.0f), FVector(2.4f, 3.6f, 3.6f), InPlane(45.0f));

		// ---------------------------------------------------------------- the blade: long, slender, white and luminous, tapering to a point
		const int32 Segments = 10;
		const float Step = BladeLengthUU / Segments;
		for (int32 i = 0; i < Segments; ++i)
		{
			const float T = (i + 0.5f) / Segments;
			const float Width = FMath::Lerp(8.4f, 3.2f, T * T);
			const float Thick = FMath::Lerp(1.8f, 1.1f, T);
			Add(ESwordPart::Blade, FVector(0.0f, 0.0f, BladeRootZ + Step * (i + 0.5f)), FVector(Thick, Width, Step + 0.3f));
		}
		// the point: a diamond closing the blade
		Add(ESwordPart::Blade, FVector(0.0f, 0.0f, BladeRootZ + BladeLengthUU + 1.0f), FVector(1.0f, 3.8f, 3.8f), InPlane(45.0f));
		Add(ESwordPart::Blade, FVector(0.0f, 0.0f, BladeRootZ + BladeLengthUU + 3.6f), FVector(0.9f, 1.8f, 1.8f), InPlane(45.0f));

		// ---------------------------------------------------------------- the fuller: gold engraving, or crystalline cyan runes
		for (const float Face : { -1.0f, 1.0f })
		{
			if (bGold)
			{
				// a continuous engraved channel with small chevrons, narrowing with the blade
				for (int32 i = 0; i < 8; ++i)
				{
					const float T = (i + 0.5f) / 8.0f;
					Add(ESwordPart::Fuller, FVector(Face * 1.05f, 0.0f, BladeRootZ + 6.0f + 10.0f * i + 5.0f), FVector(0.35f, FMath::Lerp(2.4f, 1.1f, T), 10.2f));
					if (i % 2 == 1)
					{
						Add(ESwordPart::Fuller, FVector(Face * 1.05f, 0.0f, BladeRootZ + 6.0f + 10.0f * i + 2.0f), FVector(0.35f, 3.4f, 0.8f), InPlane(30.0f));
						Add(ESwordPart::Fuller, FVector(Face * 1.05f, 0.0f, BladeRootZ + 6.0f + 10.0f * i + 2.0f), FVector(0.35f, 3.4f, 0.8f), InPlane(-30.0f));
					}
				}
			}
			else
			{
				// a line of crystal diamonds down the fuller, each turned 45 degrees, linked by a fine channel
				Add(ESwordPart::Fuller, FVector(Face * 1.05f, 0.0f, BladeRootZ + 45.0f), FVector(0.3f, 0.7f, 80.0f));
				for (int32 i = 0; i < 11; ++i)
				{
					const float Z = BladeRootZ + 8.0f + 7.6f * i;
					const float S = FMath::Lerp(2.9f, 1.5f, i / 10.0f);
					Add(ESwordPart::Fuller, FVector(Face * 1.1f, 0.0f, Z), FVector(0.4f, S, S), InPlane(45.0f));
				}
			}
		}
		if (!bGold)
		{
			// Sword B's cyan diamond gems: at the pommel's front and back (beside the heart already there) and on the guard
			Add(ESwordPart::Core, FVector(1.6f, 0.0f, PommelZ), FVector(0.8f, 2.2f, 2.2f), InPlane(45.0f));
			Add(ESwordPart::Core, FVector(-1.6f, 0.0f, PommelZ), FVector(0.8f, 2.2f, 2.2f), InPlane(45.0f));
		}
		else
		{
			// Sword A's sun rays round its orb
			for (int32 i = 0; i < 8; ++i)
			{
				const float A = 2.0f * PI * i / 8.0f + PI / 8.0f;
				Add(ESwordPart::Core, FVector(0.0f, FMath::Cos(A) * 6.4f, GuardZ + FMath::Sin(A) * 6.4f), FVector(1.2f, 2.6f, 0.9f),
					InPlane(FMath::RadiansToDegrees(A)));
			}
		}
		return Out;
	}

	void FPresentation::Build(AActor* Owner, float Scale)
	{
		if (bBuilt || Owner == nullptr)
		{
			return;
		}
		bBuilt = true;
		BuiltScale = Scale;
		BuildOne(Owner, Gold, true, Scale);
		BuildOne(Owner, Cyan, false, Scale);
		UE_LOG(LogTemp, Display, TEXT("WLHANDOFF swords built: gold %d boxes (LEFT, the LLM Companion's), cyan %d boxes (RIGHT, Jhinn's), scale %.2f"),
			Gold.Boxes, Cyan.Boxes, Scale);
	}

	void FPresentation::BuildOne(AActor* Owner, FSword& Sword, bool bGold, float Scale)
	{
		UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, SwordCubePath);
		UMaterialInterface* Lit = LoadObject<UMaterialInterface>(nullptr, SwordLitParent);
		UMaterialInterface* Glow = LoadObject<UMaterialInterface>(nullptr, SwordGlowParent);
		USceneComponent* Root = NewObject<USceneComponent>(Owner,
			MakeUniqueObjectName(Owner, USceneComponent::StaticClass(), bGold ? TEXT("HandoffSwordGold") : TEXT("HandoffSwordCyan")));
		// IN WORLD SPACE: placed every frame (over a companion, in flight, in a hand), so it never inherits the capsule's turns
		Root->SetMobility(EComponentMobility::Movable);
		Root->SetupAttachment(Owner->GetRootComponent());
		Root->SetAbsolute(true, true, true);
		Root->RegisterComponent();
		Root->ComponentTags.AddUnique(TEXT("WL_Prop"));
		Sword.Root = Root;

		const TArray<FSwordBox> Boxes = BuildSword(bGold);
		const float Exposure = CVarSwordExposure.GetValueOnGameThread();
		for (int32 PartIndex = 0; PartIndex < static_cast<int32>(ESwordPart::Count); ++PartIndex)
		{
			const ESwordPart Part = static_cast<ESwordPart>(PartIndex);
			UInstancedStaticMeshComponent* Mesh = NewObject<UInstancedStaticMeshComponent>(Owner, MakeUniqueObjectName(Owner,
				UInstancedStaticMeshComponent::StaticClass(), *FString::Printf(TEXT("HandoffSword%s%s"), bGold ? TEXT("Gold") : TEXT("Cyan"), PartName(Part))));
			Mesh->SetMobility(EComponentMobility::Movable);
			Mesh->SetStaticMesh(Cube);
			const bool bGlow = IsEmissive(Part);
			UMaterialInterface* Parent = bGlow ? Glow : Lit;
			UMaterialInstanceDynamic* Mid = Parent != nullptr ? UMaterialInstanceDynamic::Create(Parent, Owner) : nullptr;
			if (Mid != nullptr)
			{
				const FLinearColor Colour = PartColour(Part, bGold);
				Mid->SetVectorParameterValue(TEXT("Color"), bGlow ? Colour * Exposure : Colour);
				Mesh->SetMaterial(0, Mid);
			}
			Sword.Materials[PartIndex] = Mid;
			Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			Mesh->SetGenerateOverlapEvents(false);
			Mesh->SetCanEverAffectNavigation(false);
			// a light does not shadow the ground under it; the lit metal and feathers do
			Mesh->SetCastShadow(!bGlow);
			Mesh->SetupAttachment(Root);
			Mesh->RegisterComponent();
			for (const FSwordBox& Box : Boxes)
			{
				if (Box.Part == Part)
				{
					Mesh->AddInstance(BoxXf(Box, 1.0f));
					++Sword.Boxes;
				}
			}
			Mesh->SetVisibility(false);
			// A HELD THING, NOT THE BODY: kept out of the height measurement and out of every skin repaint
			Mesh->ComponentTags.AddUnique(TEXT("WL_Prop"));
			Sword.Parts[PartIndex] = Mesh;
		}

		// ---------------------------------------------------------------- the living light: ribbons, particles, the dash's trail
		auto Effect = [&](const TCHAR* Name, const FLinearColor& Colour, USceneComponent* AttachTo, bool bWorld, int32 Count, int32 Slot)
		{
			UInstancedStaticMeshComponent* Mesh = NewObject<UInstancedStaticMeshComponent>(Owner, MakeUniqueObjectName(Owner,
				UInstancedStaticMeshComponent::StaticClass(), *FString::Printf(TEXT("HandoffSword%s%s"), bGold ? TEXT("Gold") : TEXT("Cyan"), Name)));
			Mesh->SetMobility(EComponentMobility::Movable);
			Mesh->SetStaticMesh(Cube);
			if (Glow != nullptr)
			{
				if (UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(Glow, Owner))
				{
					Mid->SetVectorParameterValue(TEXT("Color"), Colour * Exposure);
					Mesh->SetMaterial(0, Mid);
					Sword.EffectMaterials[Slot] = Mid;
					Sword.EffectColours[Slot] = Colour;
				}
			}
			Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			Mesh->SetGenerateOverlapEvents(false);
			Mesh->SetCanEverAffectNavigation(false);
			Mesh->SetCastShadow(false);
			Mesh->SetupAttachment(AttachTo);
			if (bWorld)
			{
				Mesh->SetAbsolute(true, true, true);
			}
			Mesh->RegisterComponent();
			if (bWorld)
			{
				Mesh->SetWorldTransform(FTransform::Identity);
			}
			for (int32 i = 0; i < Count; ++i)
			{
				Mesh->AddInstance(FTransform(FRotator::ZeroRotator, FVector::ZeroVector, FVector(0.001)), bWorld);
			}
			Mesh->SetVisibility(false);
			Mesh->ComponentTags.AddUnique(TEXT("WL_Prop"));
			return Mesh;
		};
		// the ribbons and the particles in the sword's energy colour; the particles a little paler, the trail the colour itself
		const FLinearColor Energy = bGold ? FLinearColor(1.0f, 0.70f, 0.22f) : FLinearColor(0.22f, 0.86f, 1.0f);
		Sword.Ribbons = Effect(TEXT("Ribbons"), Energy * 2.2f, Root, false, RibbonBoxesPerSword, 0);
		Sword.Motes = Effect(TEXT("Motes"), (Energy * 0.7f + FLinearColor(0.3f, 0.3f, 0.3f)) * 2.6f, Root, false, MotesPerSword, 1);
		Sword.Trail = Effect(TEXT("Trail"), Energy * 1.8f, Owner->GetRootComponent(), true, TrailSamples - 1, 2);
	}

	void FPresentation::Animate(FSword& Sword, bool bGold, bool bVisible, const FShowInput& In)
	{
		const float Time = In.TimeSeconds;
		// ---------------------------------------------------------------- two ribbons spiralling up the blade, turning slowly
		if (UInstancedStaticMeshComponent* Mesh = Sword.Ribbons.Get())
		{
			if (Mesh->IsVisible() != bVisible)
			{
				Mesh->SetVisibility(bVisible);
			}
			if (bVisible)
			{
				const int32 PerRibbon = RibbonBoxesPerSword / 2;
				const float Spin = (bGold ? 1.0f : -1.0f) * Time * 2.2f;
				for (int32 Ribbon = 0; Ribbon < 2; ++Ribbon)
				{
					for (int32 j = 0; j < PerRibbon; ++j)
					{
						const float T = static_cast<float>(j) / (PerRibbon - 1);
						const float A = T * 3.0f * 2.0f * PI + Ribbon * PI + Spin;
						const float R = FMath::Lerp(8.0f, 3.2f, T);
						const float Z = FMath::Lerp(BladeRootZ + 2.0f, TipZ - 10.0f, T);
						const FVector P(R * FMath::Cos(A), R * FMath::Sin(A), Z);
						// along the helix's tangent, thinning toward the point
						const FVector Tangent(-R * FMath::Sin(A) * 6.0f * PI, R * FMath::Cos(A) * 6.0f * PI, TipZ - BladeRootZ - 12.0f);
						const FRotator Turn = FRotationMatrix::MakeFromX(Tangent.GetSafeNormal()).Rotator();
						const float Width = FMath::Lerp(1.3f, 0.6f, T);
						Mesh->UpdateInstanceTransform(Ribbon * PerRibbon + j, FTransform(Turn, P, FVector(4.4f, Width, 0.45f) / 100.0f), false,
							Ribbon == 1 && j == PerRibbon - 1, true);
					}
				}
			}
		}
		// ---------------------------------------------------------------- floating particles round the blade
		if (UInstancedStaticMeshComponent* Mesh = Sword.Motes.Get())
		{
			if (Mesh->IsVisible() != bVisible)
			{
				Mesh->SetVisibility(bVisible);
			}
			if (bVisible)
			{
				for (int32 i = 0; i < MotesPerSword; ++i)
				{
					const float Rise = FMath::Frac(i * 0.37f + Time * 0.11f);
					const float A = i * 2.399963f + Time * 0.6f * (bGold ? 1.0f : -1.0f);
					const float R = 10.0f + 6.0f * FMath::Frac(i * 0.61f);
					const FVector P(R * FMath::Cos(A), R * FMath::Sin(A), BladeRootZ + Rise * (BladeLengthUU + 8.0f));
					// in and out of being: each grows as it rises and fades near the top
					const float Life = FMath::Sin(Rise * PI);
					FVector Size;
					FRotator Turn(Time * 40.0f + i * 31.0f, Time * 25.0f + i * 47.0f, 0.0f);
					if (bGold)
					{
						// gold feathers (long and flat) and four-pointed stars (a diamond)
						Size = (i % 2 == 0) ? FVector(0.5f, 1.4f, 4.2f) : FVector(0.6f, 2.4f, 2.4f);
						if (i % 2 == 1)
						{
							Turn = FRotator(0.0f, Time * 30.0f + i * 20.0f, 45.0f);
						}
					}
					else
					{
						// small glowing squares -- the digital, voxel motif -- and one white-cyan feather
						Size = (i == 0) ? FVector(0.5f, 1.4f, 4.2f) : FVector(1.6f);
					}
					Mesh->UpdateInstanceTransform(i, FTransform(Turn, P, Size * (Life / 100.0f)), false, i == MotesPerSword - 1, true);
				}
			}
		}
		// ---------------------------------------------------------------- the dash's trail, where the blade has just been
		UInstancedStaticMeshComponent* Trail = Sword.Trail.Get();
		const USceneComponent* Root = Sword.Root.Get();
		if (Trail == nullptr || Root == nullptr)
		{
			return;
		}
		const float Want = (In.bDashing && bVisible) ? 1.0f : 0.0f;
		Sword.TrailWeight = FMath::FInterpTo(Sword.TrailWeight, Want, In.DeltaSeconds, Want > Sword.TrailWeight ? 30.0f : 6.0f);
		const bool bTrail = Sword.TrailWeight > 0.01f;
		if (Trail->IsVisible() != bTrail)
		{
			Trail->SetVisibility(bTrail);
		}
		if (!bTrail)
		{
			Sword.TrailTips.Reset();
			Sword.TrailRoots.Reset();
			Sword.TrailAges.Reset();
			return;
		}
		// the upper half of the blade sweeps the trail: from its middle to near its point
		const FTransform At = Root->GetComponentTransform();
		Sword.TrailTips.Insert(At.TransformPosition(FVector(0.0f, 0.0f, TipZ - 8.0f)), 0);
		Sword.TrailRoots.Insert(At.TransformPosition(FVector(0.0f, 0.0f, BladeRootZ + BladeLengthUU * 0.45f)), 0);
		Sword.TrailAges.Insert(0.0f, 0);
		for (float& Age : Sword.TrailAges)
		{
			Age += In.DeltaSeconds;
		}
		while (Sword.TrailTips.Num() > TrailSamples)
		{
			Sword.TrailTips.Pop();
			Sword.TrailRoots.Pop();
			Sword.TrailAges.Pop();
		}
		const float Lifetime = 0.22f;
		for (int32 i = 0; i < TrailSamples - 1; ++i)
		{
			FTransform Segment(FRotator::ZeroRotator, FVector::ZeroVector, FVector(0.001f));
			if (i + 1 < Sword.TrailTips.Num())
			{
				const float Fade = FMath::Clamp(1.0f - Sword.TrailAges[i] / Lifetime, 0.0f, 1.0f) * Sword.TrailWeight;
				const FVector MidA = (Sword.TrailTips[i] + Sword.TrailRoots[i]) * 0.5f;
				const FVector MidB = (Sword.TrailTips[i + 1] + Sword.TrailRoots[i + 1]) * 0.5f;
				const FVector Along = MidB - MidA;
				const float Length = static_cast<float>(Along.Size());
				const FVector Span = Sword.TrailTips[i] - Sword.TrailRoots[i];
				if (Length > 0.5f && Fade > 0.01f)
				{
					// a thin band: long in the direction travelled, as broad as the swept blade, narrowing as it fades
					const FMatrix Basis = FRotationMatrix::MakeFromXZ(Along / Length, Span.GetSafeNormal());
					const float Broad = static_cast<float>(Span.Size()) * Fade;
					Segment = FTransform(Basis.Rotator(), (MidA + MidB) * 0.5f, FVector(Length + 1.0f, 0.6f, Broad) / 100.0f);
				}
			}
			Trail->UpdateInstanceTransform(i, Segment, true, i == TrailSamples - 2, true);
		}
	}

	int32 FPresentation::CountVisibleRibbons() const
	{
		int32 Count = 0;
		for (const FSword* Sword : { &Gold, &Cyan })
		{
			const UInstancedStaticMeshComponent* Mesh = Sword->Ribbons.Get();
			Count += Mesh != nullptr && Mesh->IsVisible() ? Mesh->GetInstanceCount() : 0;
		}
		return Count;
	}

	int32 FPresentation::CountVisibleMotes() const
	{
		int32 Count = 0;
		for (const FSword* Sword : { &Gold, &Cyan })
		{
			const UInstancedStaticMeshComponent* Mesh = Sword->Motes.Get();
			Count += Mesh != nullptr && Mesh->IsVisible() ? Mesh->GetInstanceCount() : 0;
		}
		return Count;
	}

	int32 FPresentation::CountVisibleTrail() const
	{
		int32 Count = 0;
		for (const FSword* Sword : { &Gold, &Cyan })
		{
			const UInstancedStaticMeshComponent* Mesh = Sword->Trail.Get();
			Count += Mesh != nullptr && Mesh->IsVisible() ? FMath::Max(Sword->TrailTips.Num() - 1, 0) : 0;
		}
		return Count;
	}

	void FPresentation::Place(FSword& Sword, const FTransform& World, float Grow, bool bVisible, USceneComponent* HoldIn, const FTransform& HoldLocal,
		const FQuat* HoldWorldRotation)
	{
		USceneComponent* Root = Sword.Root.Get();
		if (Root == nullptr)
		{
			return;
		}
		// A HIDDEN SWORD IS NOT PLACED (Second's review: every frame after the first handoff, for swords nobody could see)
		if (!bVisible)
		{
			for (const TWeakObjectPtr<UInstancedStaticMeshComponent>& Part : Sword.Parts)
			{
				UInstancedStaticMeshComponent* Mesh = Part.Get();
				if (Mesh != nullptr && Mesh->IsVisible())
				{
					Mesh->SetVisibility(false);
				}
			}
			return;
		}
		const FVector Scale(FMath::Max(Grow, 0.001f) * BuiltScale);
		if (HoldIn != nullptr)
		{
			// IN THE HAND: parented to the forearm, the grip frame its relative place, its own size kept (absolute scale)
			if (Root->GetAttachParent() != HoldIn)
			{
				Root->AttachToComponent(HoldIn, FAttachmentTransformRules::KeepWorldTransform);
			}
			if (HoldWorldRotation != nullptr)
			{
				// THE V: the centre rides on the forearm (no lag behind a skin's later joint writes); the direction is the body's
				if (Root->IsUsingAbsoluteLocation() || !Root->IsUsingAbsoluteRotation() || !Root->IsUsingAbsoluteScale())
				{
					Root->SetAbsolute(false, true, true);
				}
				Root->SetRelativeLocation(HoldLocal.GetLocation());
				Root->SetWorldRotation(*HoldWorldRotation);
			}
			else
			{
				if (Root->IsUsingAbsoluteLocation() || Root->IsUsingAbsoluteRotation() || !Root->IsUsingAbsoluteScale())
				{
					Root->SetAbsolute(false, false, true);
				}
				Root->SetRelativeLocationAndRotation(HoldLocal.GetLocation(), HoldLocal.GetRotation());
			}
			Root->SetWorldScale3D(Scale);
		}
		else
		{
			// IN THE WORLD (forming, in flight, returning): back on the owner, placed absolutely
			USceneComponent* Home = Root->GetOwner() != nullptr ? Root->GetOwner()->GetRootComponent() : nullptr;
			if (Home != nullptr && Root->GetAttachParent() != Home)
			{
				Root->AttachToComponent(Home, FAttachmentTransformRules::KeepWorldTransform);
			}
			if (!Root->IsUsingAbsoluteLocation() || !Root->IsUsingAbsoluteRotation() || !Root->IsUsingAbsoluteScale())
			{
				Root->SetAbsolute(true, true, true);
			}
			FTransform At = World;
			At.SetScale3D(Scale);
			Root->SetWorldTransform(At);
		}
		for (const TWeakObjectPtr<UInstancedStaticMeshComponent>& Part : Sword.Parts)
		{
			if (UInstancedStaticMeshComponent* Mesh = Part.Get())
			{
				if (Mesh->IsVisible() != bVisible)
				{
					Mesh->SetVisibility(bVisible);
				}
			}
		}
	}

	void FPresentation::Show(const FShowInput& In)
	{
		if (!bBuilt)
		{
			return;
		}
		// THE CALIBRATION IS LIVE: a level changed at the console reaches the swords on the next frame
		const float Levels[5] = { CVarSwordExposure.GetValueOnGameThread(), SwordLevel(ESwordPart::Blade), SwordLevel(ESwordPart::Fuller),
			SwordLevel(ESwordPart::Core), SwordLevel(ESwordPart::Feather) };
		if (FMemory::Memcmp(Levels, AppliedLevels, sizeof(Levels)) != 0)
		{
			Recolour(Gold, true);
			Recolour(Cyan, false);
			FMemory::Memcpy(AppliedLevels, Levels, sizeof(Levels));
		}
		// Upright ABOVE its companion, its broad face turned to the player's camera (edge-on, a forming sword reads as a line):
		// the pose each sword forms in, out of its companion's light
		const FVector View = In.ViewLocation;
		auto Upright = [View](const FVector& At, const FTransform& Grip)
		{
			const FVector Where = At + FVector(0.0f, 0.0f, 70.0f);
			const FVector Toward = (View - Where).GetSafeNormal2D();
			const float Yaw = Toward.IsNearlyZero() ? Grip.Rotator().Yaw : Toward.Rotation().Yaw;
			return FTransform(FRotator(0.0f, Yaw, 0.0f), Where);
		};
		auto Between = [](const FTransform& From, const FTransform& To, float T)
		{
			// a curve, not a line: the sword rises as it travels and settles into the hand
			const float S = SmoothStep01(T);
			FVector Where = FMath::Lerp(From.GetLocation(), To.GetLocation(), S);
			Where.Z += FMath::Sin(S * PI) * 45.0f;
			const FQuat Turn = FQuat::Slerp(From.GetRotation(), To.GetRotation(), S);
			return FTransform(Turn, Where);
		};

		FTransform GoldAt = In.LeftGrip;
		FTransform CyanAt = In.RightGrip;
		float Grow = 1.0f;
		bool bVisible = true;
		switch (In.State)
		{
		case EWonderlandHandoffState::Transforming:
		{
			// FORMING over each companion, out of its light: from nothing to the whole sword
			const float T = In.PhaseSeconds / FWonderlandMissionHandoff::TransformSeconds;
			Grow = SmoothStep01(T);
			GoldAt = Upright(In.LeftCompanion, In.LeftGrip);
			CyanAt = Upright(In.RightCompanion, In.RightGrip);
			// a slow quarter turn as it forms, so it reads as made, not placed
			GoldAt.ConcatenateRotation(FQuat(FVector::UpVector, (1.0f - Grow) * PI * 0.5f));
			CyanAt.ConcatenateRotation(FQuat(FVector::UpVector, -(1.0f - Grow) * PI * 0.5f));
			break;
		}
		case EWonderlandHandoffState::Delivering:
		{
			const float T = In.PhaseSeconds / FWonderlandMissionHandoff::DeliverSeconds;
			GoldAt = Between(Upright(In.LeftCompanion, In.LeftGrip), In.LeftGrip, T);
			CyanAt = Between(Upright(In.RightCompanion, In.RightGrip), In.RightGrip, T);
			break;
		}
		case EWonderlandHandoffState::Held:
			break;
		case EWonderlandHandoffState::Returning:
		{
			// back to the companions, fading into them over the last third
			const float T = In.PhaseSeconds / FWonderlandMissionHandoff::ReturnSeconds;
			GoldAt = Between(In.LeftGrip, Upright(In.LeftCompanion, In.LeftGrip), T);
			CyanAt = Between(In.RightGrip, Upright(In.RightCompanion, In.RightGrip), T);
			Grow = 1.0f - SmoothStep01((T - 0.66f) / 0.34f);
			bVisible = Grow > 0.01f;
			break;
		}
		default:
			Grow = 0.0f;
			bVisible = false;
			break;
		}
		Presence = bVisible ? Grow : 0.0f;
		// HELD: parented to the hands' forearms (the frame they are written in); otherwise placed in the world
		const bool bInHands = In.State == EWonderlandHandoffState::Held;
		USceneComponent* LeftHold = bInHands ? In.LeftForearm.Get() : nullptr;
		USceneComponent* RightHold = bInHands ? In.RightForearm.Get() : nullptr;
		Place(Gold, GoldAt, Grow, bVisible, LeftHold, In.LeftGripLocal, In.bHoldWorldRotation ? &In.LeftHoldRotation : nullptr);
		Place(Cyan, CyanAt, Grow, bVisible, RightHold, In.RightGripLocal, In.bHoldWorldRotation ? &In.RightHoldRotation : nullptr);
		// the light lives once the sword has formed enough to carry it
		Animate(Gold, true, bVisible && Grow > 0.35f, In);
		Animate(Cyan, false, bVisible && Grow > 0.35f, In);
	}

	void FPresentation::Recolour(FSword& Sword, bool bGold)
	{
		const float Exposure = CVarSwordExposure.GetValueOnGameThread();
		for (int32 PartIndex = 0; PartIndex < static_cast<int32>(ESwordPart::Count); ++PartIndex)
		{
			if (UMaterialInstanceDynamic* Mid = Sword.Materials[PartIndex].Get())
			{
				const ESwordPart Part = static_cast<ESwordPart>(PartIndex);
				const FLinearColor Colour = PartColour(Part, bGold);
				Mid->SetVectorParameterValue(TEXT("Color"), IsEmissive(Part) ? Colour * Exposure : Colour);
			}
		}
		for (int32 Slot = 0; Slot < 3; ++Slot)
		{
			if (UMaterialInstanceDynamic* Mid = Sword.EffectMaterials[Slot].Get())
			{
				Mid->SetVectorParameterValue(TEXT("Color"), Sword.EffectColours[Slot] * Exposure);
			}
		}
	}

	FTransform FPresentation::GetSwordWorld(bool bGold) const
	{
		const USceneComponent* Root = (bGold ? Gold : Cyan).Root.Get();
		return Root != nullptr ? Root->GetComponentTransform() : FTransform::Identity;
	}

	const USceneComponent* FPresentation::GetHeldBy(bool bGold) const
	{
		const USceneComponent* Root = (bGold ? Gold : Cyan).Root.Get();
		return Root != nullptr ? Root->GetAttachParent() : nullptr;
	}

	int32 FPresentation::CountVisibleBoxes() const
	{
		int32 Count = 0;
		for (const FSword* Sword : { &Gold, &Cyan })
		{
			for (const TWeakObjectPtr<UInstancedStaticMeshComponent>& Part : Sword->Parts)
			{
				const UInstancedStaticMeshComponent* Mesh = Part.Get();
				if (Mesh != nullptr && Mesh->IsVisible())
				{
					Count += Mesh->GetInstanceCount();
				}
			}
		}
		return Count;
	}

	void FPresentation::Destroy()
	{
		for (FSword* Sword : { &Gold, &Cyan })
		{
			for (TWeakObjectPtr<UInstancedStaticMeshComponent>& Part : Sword->Parts)
			{
				if (UInstancedStaticMeshComponent* Mesh = Part.Get())
				{
					Mesh->DestroyComponent();
				}
				Part.Reset();
			}
			for (TWeakObjectPtr<UInstancedStaticMeshComponent>* Effect : { &Sword->Ribbons, &Sword->Motes, &Sword->Trail })
			{
				if (UInstancedStaticMeshComponent* Mesh = Effect->Get())
				{
					Mesh->DestroyComponent();
				}
				Effect->Reset();
			}
			Sword->TrailTips.Reset();
			Sword->TrailRoots.Reset();
			Sword->TrailAges.Reset();
			if (USceneComponent* Root = Sword->Root.Get())
			{
				Root->DestroyComponent();
			}
			Sword->Root.Reset();
			Sword->Boxes = 0;
		}
		bBuilt = false;
		Presence = 0.0f;
	}
}
