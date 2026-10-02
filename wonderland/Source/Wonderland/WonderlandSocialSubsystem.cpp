#include "WonderlandSocialSubsystem.h"

#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"
#include "Engine/LocalPlayer.h"
#include "WonderlandBeta.h"
#include "WonderlandSocialLive.h"
#include "RelayDogCharacter.h"
#include "Components/CapsuleComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "WonderlandRelaySkins.h"
#include "Dom/JsonObject.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "WonderlandUiSubsystem.h"

// NO NEW LOG CATEGORY: a category is an early FName, and a new early FName shifted the name table under Niagara and
// crashed a UE 5.8 package at boot (memory: niagara-fname-hash-crash). LogTemp with a WLSOCIAL prefix, like the rest.

void UWonderlandSocialSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	RemoteTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateUObject(this, &UWonderlandSocialSubsystem::TickRemotePlayers), 0.0f);
	ReloadPreview();
}

void UWonderlandSocialSubsystem::Deinitialize()
{
	FTSTicker::GetCoreTicker().RemoveTicker(RemoteTicker);
	RemotePlayers.Clear();
	if (Live != nullptr)
	{
		Live->ReportPresence(false);   // best effort: the player is leaving
	}
	Live = nullptr;
	Service.Reset();
	Super::Deinitialize();
}

bool UWonderlandSocialSubsystem::ReloadPreview()
{
	return LoadPreviewScene(Scene);
}

bool UWonderlandSocialSubsystem::LoadPreviewScene(const FString& InScene)
{
	VoicePreview = nullptr;
	Live = nullptr;
	Voice = MakeUnique<FWonderlandVoiceUnavailable>();
	// SYNTHETIC PEOPLE ARE A DEVELOPER FIXTURE (founder, 2026-10-02: "Do not expose synthetic users to beta testers as though
	// they are real people"; CORE: developer-session-only). A player session gets no service at all -- every social surface
	// then says Social is not connected -- never the preview's made-up friends. Its voice is the honest UNAVAILABLE one.
	if (!WonderlandBeta::IsDeveloperSession())
	{
		Adopt(nullptr);
		UE_LOG(LogTemp, Log, TEXT("WLSOCIAL preview not loaded: a player session never shows the development preview's synthetic people"));
		return false;
	}
	Scene = InScene.Equals(TEXT("party"), ESearchCase::IgnoreCase) ? FString(TEXT("party")) : FString(TEXT("base"));
	TUniquePtr<FWonderlandSocialPreviewService> Preview = MakeUnique<FWonderlandSocialPreviewService>();
	const FString Path = FWonderlandSocialPreviewService::ScenePath(Scene);
	const bool bLoaded = Preview->Load(Path);
	UE_LOG(LogTemp, Log, TEXT("WLSOCIAL preview (%s) %s: %s"), *Scene, bLoaded ? TEXT("loaded") : TEXT("NOT loaded"),
		bLoaded ? *FString::Printf(TEXT("%d friends, %d profiles, viewer %s, party %s, %d voice states"), Preview->GetSnapshot().Friends.Num(),
			Preview->GetSnapshot().Profiles.Num(), *Preview->GetSnapshot().ViewerId, Preview->GetSnapshot().bHasParty ? *Preview->GetSnapshot().Party.Name : TEXT("none"),
			Preview->GetSnapshot().VoiceStates.Num())
		        : *Preview->GetLastError());
	if (bLoaded)
	{
		// THE PREVIEW'S VOICE: the authority's scripted states, labelled, refusing every command.
		TUniquePtr<FWonderlandVoicePreviewScript> Script = MakeUnique<FWonderlandVoicePreviewScript>(Preview->GetSnapshot().VoiceStates);
		VoicePreview = Script.Get();
		Voice = MoveTemp(Script);
	}
	Adopt(MoveTemp(Preview));
	return bLoaded;
}

void UWonderlandSocialSubsystem::Adopt(TUniquePtr<IWonderlandSocialService> NewService)
{
	RemotePlayers.Clear();   // the other players belonged to the service that is going
	Service = MoveTemp(NewService);
	if (Service.IsValid())
	{
		Service->OnChanged().AddUObject(this, &UWonderlandSocialSubsystem::HandleServiceChanged);
		Service->OnAnswered().AddUObject(this, &UWonderlandSocialSubsystem::HandleServiceAnswered);
	}
	SocialChanged.Broadcast();
}

bool UWonderlandSocialSubsystem::ConnectLive(const FString& BaseUrl, const FString& Token)
{
	if (!WonderlandBeta::IsDeveloperSession())
	{
		UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL live: not in a player session until the bridge grants the social capability at pairing"));
		return false;
	}
	if (!(BaseUrl.StartsWith(TEXT("https://")) || BaseUrl.StartsWith(TEXT("http://127.0.0.1")) || BaseUrl.StartsWith(TEXT("http://localhost"))) || Token.IsEmpty())
	{
		UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL live: refused (https, or http to this machine only; a token is required)"));
		return false;
	}
	VoicePreview = nullptr;
	Voice = MakeUnique<FWonderlandVoiceUnavailable>();   // a real provider is the founder's choice; until then, honestly pending
	TUniquePtr<FWonderlandSocialLiveService> Connected = MakeUnique<FWonderlandSocialLiveService>(BaseUrl, Token);
	Live = Connected.Get();
	Scene = TEXT("live");
	// MULTIPLAYER PHASE 1: report this player's Dog, draw the others, and join the public world this map is.
	Live->SetAvatarSource([WeakThis = TWeakObjectPtr<UWonderlandSocialSubsystem>(this)](FWonderlandAvatarReport& Out)
	{
		return WeakThis.IsValid() && WeakThis->ReportLocalPlayer(Out);
	});
	Live->OnWorldChanged().AddUObject(this, &UWonderlandSocialSubsystem::HandleWorldChanged);
	Adopt(MoveTemp(Connected));
	Live->JoinWorld(TEXT("PUBLIC"), TEXT("golden_arrival"));
	UE_LOG(LogTemp, Display, TEXT("WLSOCIAL live: connecting to %s"), *BaseUrl);
	return true;
}

bool UWonderlandSocialSubsystem::ReportLocalPlayer(FWonderlandAvatarReport& Out) const
{
	const UGameInstance* Instance = GetGameInstance();
	UWorld* World = Instance != nullptr ? Instance->GetWorld() : nullptr;
	APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
	const ARelayDogCharacter* Dog = PC != nullptr ? Cast<ARelayDogCharacter>(PC->GetPawn()) : nullptr;
	if (Dog == nullptr)
	{
		return false;
	}
	// THE SOLES, where a remote figure stands: the capsule's centre less its half height.
	const UCapsuleComponent* Capsule = Dog->GetCapsuleComponent();
	Out.Location = Dog->GetActorLocation() - FVector(0.0, 0.0, Capsule != nullptr ? Capsule->GetScaledCapsuleHalfHeight() : 0.0);
	Out.Yaw = static_cast<float>(Dog->GetActorRotation().Yaw);
	const FVector Velocity = Dog->GetVelocity();
	Out.Speed = static_cast<float>(FVector2D(Velocity.X, Velocity.Y).Size());
	const UCharacterMovementComponent* Move = Dog->GetCharacterMovement();
	Out.Motion = Move != nullptr && Move->IsFalling() ? (Velocity.Z > 0.0 ? TEXT("JUMP") : TEXT("FALL"))
		: Out.Speed < 10.0f ? TEXT("IDLE") : Out.Speed < 400.0f ? TEXT("WALK") : TEXT("RUN");
	Out.SkinId = Dog->GetWornSkinId().IsNone() ? FString(TEXT("relay_og")) : Dog->GetWornSkinId().ToString();
	return true;
}

void UWonderlandSocialSubsystem::HandleWorldChanged()
{
	const UGameInstance* Instance = GetGameInstance();
	UWorld* World = Instance != nullptr ? Instance->GetWorld() : nullptr;
	if (Live == nullptr || World == nullptr)
	{
		return;
	}
	UWonderlandRelaySkinSubsystem* Skins = Instance->GetSubsystem<UWonderlandRelaySkinSubsystem>();
	APlayerController* PC = World->GetFirstPlayerController();
	const ARelayDogCharacter* Dog = PC != nullptr ? Cast<ARelayDogCharacter>(PC->GetPawn()) : nullptr;
	// EVERY DOG AT RELAY OG'S HEIGHT (the HARD rule), the same height this player's own Dog is measured at.
	const float Height = Dog != nullptr && Dog->GetCanonBodyHeightUu() > 1.0f ? Dog->GetCanonBodyHeightUu() : 174.15f;
	RemotePlayers.Apply(World, Live->GetWorldView(), [Skins](const FString& SkinId) { return Skins != nullptr ? Skins->FigurePathFor(FName(*SkinId)) : FString(); }, Height);
}

bool UWonderlandSocialSubsystem::TickRemotePlayers(float DeltaSeconds)
{
	const UGameInstance* Instance = GetGameInstance();
	RemotePlayers.Tick(Instance != nullptr ? Instance->GetWorld() : nullptr, DeltaSeconds);
	return true;
}

void UWonderlandSocialSubsystem::ConnectDevSession(const FString& BaseUrl, const FString& Player)
{
	if (!WonderlandBeta::IsDeveloperSession() || !(BaseUrl.StartsWith(TEXT("http://127.0.0.1")) || BaseUrl.StartsWith(TEXT("http://localhost"))))
	{
		UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL dev session: developer sessions and the loopback dev server only"));
		return;
	}
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(BaseUrl + TEXT("/dev/session"));
	Request->SetVerb(TEXT("POST"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetContentAsString(FString::Printf(TEXT("{\"player\":\"%s\"}"), *Player.ToLower()));
	const TWeakObjectPtr<UWonderlandSocialSubsystem> WeakThis(this);
	Request->OnProcessRequestComplete().BindLambda([WeakThis, BaseUrl, Player](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		if (!WeakThis.IsValid())
		{
			return;
		}
		TSharedPtr<FJsonObject> Json;
		const TSharedPtr<FJsonObject>* Data = nullptr;
		FString Token;
		if (bConnected && Response.IsValid() && Response->GetResponseCode() == 200
			&& FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Response->GetContentAsString()), Json) && Json.IsValid()
			&& Json->TryGetObjectField(TEXT("data"), Data) && Data != nullptr && (*Data)->TryGetStringField(TEXT("token"), Token))
		{
			UE_LOG(LogTemp, Display, TEXT("WLSOCIAL dev session for %s minted; connecting"), *Player);
			WeakThis->ConnectLive(BaseUrl, Token);
			return;
		}
		UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL dev session for %s failed (HTTP %d)"), *Player, Response.IsValid() ? Response->GetResponseCode() : 0);
	});
	Request->ProcessRequest();
}

const FWonderlandSocialProfileView* UWonderlandSocialSubsystem::FindProfile(const FString& UserId) const
{
	const FWonderlandSocialSnapshot* Snapshot = GetSnapshot();
	if (Snapshot == nullptr)
	{
		return nullptr;
	}
	if (UserId == Snapshot->ViewerId)
	{
		return &Snapshot->Self;
	}
	return Snapshot->Profiles.Find(UserId);
}

bool UWonderlandSocialSubsystem::OpenProfile(const FString& UserId)
{
	const FWonderlandSocialProfileView* View = FindProfile(UserId);
	if (View == nullptr)
	{
		UE_LOG(LogTemp, Log, TEXT("WLSOCIAL profile %s not openable for this viewer"), *UserId);
		return false;
	}
	const UGameInstance* Instance = GetGameInstance();
	for (ULocalPlayer* Player : Instance != nullptr ? Instance->GetLocalPlayers() : TArray<ULocalPlayer*>())
	{
		if (UWonderlandUiSubsystem* Ui = Player != nullptr ? Player->GetSubsystem<UWonderlandUiSubsystem>() : nullptr)
		{
			return Ui->OpenPlayerProfile(*View, GetSourceLine());
		}
	}
	return false;
}

// Named, not anonymous: the module builds as one unity translation unit.
namespace WonderlandSocialCommands
{
	/** Open a player's profile from the social service's view -- the same path a Friends row will take. */
	FAutoConsoleCommandWithWorldAndArgs GSocialProfile(
		TEXT("wl.Social.Profile"),
		TEXT("Open a player's profile from the social service's view, e.g. `wl.Social.Profile usr_nova` (DEVELOPMENT PREVIEW people)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
			UWonderlandSocialSubsystem* Social = Instance != nullptr ? Instance->GetSubsystem<UWonderlandSocialSubsystem>() : nullptr;
			if (Social == nullptr || Args.Num() == 0)
			{
				UE_LOG(LogTemp, Display, TEXT("WLSOCIAL usage: wl.Social.Profile <user id>"));
				return;
			}
			const bool bOpened = Social->OpenProfile(Args[0]);
			UE_LOG(LogTemp, Display, TEXT("WLSOCIAL profile %s: %s"), *Args[0], bOpened ? TEXT("opened") : TEXT("not openable for this viewer"));
		}));

	/** Developer sessions: switch the preview scene (base, or party: the viewer in Lab Crew). */
	FAutoConsoleCommandWithWorldAndArgs GSocialPreview(
		TEXT("wl.Social.Preview"),
		TEXT("Developer sessions: load a DEVELOPMENT PREVIEW scene, `wl.Social.Preview [base|party]`."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
			UWonderlandSocialSubsystem* Social = Instance != nullptr ? Instance->GetSubsystem<UWonderlandSocialSubsystem>() : nullptr;
			const bool bLoaded = Social != nullptr && Social->LoadPreviewScene(Args.Num() > 0 ? Args[0] : FString(TEXT("base")));
			UE_LOG(LogTemp, Display, TEXT("WLSOCIAL preview scene %s: %s"), Social != nullptr ? *Social->GetPreviewScene() : TEXT("-"), bLoaded ? TEXT("loaded") : TEXT("NOT loaded"));
		}));

	/** Developer sessions: be a real player on the DEVELOPMENT social server (two clients = two people). */
	FAutoConsoleCommandWithWorldAndArgs GSocialDev(
		TEXT("wl.Social.Dev"),
		TEXT("Developer sessions: `wl.Social.Dev <player> [http://127.0.0.1:8796]` mints a development session on the loopback social server and goes live."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
			UWonderlandSocialSubsystem* Social = Instance != nullptr ? Instance->GetSubsystem<UWonderlandSocialSubsystem>() : nullptr;
			if (Social == nullptr || Args.Num() == 0)
			{
				UE_LOG(LogTemp, Display, TEXT("WLSOCIAL usage: wl.Social.Dev <player> [base url]"));
				return;
			}
			Social->ConnectDevSession(Args.Num() > 1 ? Args[1] : FString(TEXT("http://127.0.0.1:8796")), Args[0]);
		}));

	/** Open the Social Hub on a tab -- the same path the player's way in will take. */
	FAutoConsoleCommandWithWorldAndArgs GSocialHub(
		TEXT("wl.Social.Hub"),
		TEXT("Open the Social Hub: `wl.Social.Hub [friends|requests|recent]`. In a player session it says Social is not connected."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
			for (ULocalPlayer* Player : Instance != nullptr ? Instance->GetLocalPlayers() : TArray<ULocalPlayer*>())
			{
				if (UWonderlandUiSubsystem* Ui = Player != nullptr ? Player->GetSubsystem<UWonderlandUiSubsystem>() : nullptr)
				{
					const bool bOpened = Ui->OpenSocialHub(Args.Num() > 0 ? Args[0] : FString());
					UE_LOG(LogTemp, Display, TEXT("WLSOCIAL hub %s: %s"), bOpened ? TEXT("opened") : TEXT("NOT opened"), *Ui->DescribeOpenSocialHub());
					return;
				}
			}
			UE_LOG(LogTemp, Display, TEXT("WLSOCIAL hub: no player to show it to"));
		}));
}
