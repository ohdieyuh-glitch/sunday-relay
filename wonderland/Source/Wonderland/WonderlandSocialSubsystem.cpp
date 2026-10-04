#include "WonderlandSocialSubsystem.h"

#include "WonderlandEosVoice.h"

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
#include "WonderlandJuliusStream.h"

// NO NEW LOG CATEGORY: a category is an early FName, and a new early FName shifted the name table under Niagara and
// crashed a UE 5.8 package at boot (memory: niagara-fname-hash-crash). LogTemp with a WLSOCIAL prefix, like the rest.

void UWonderlandSocialSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	RemoteTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateUObject(this, &UWonderlandSocialSubsystem::TickRemotePlayers), 0.0f);
	// ONE BRIDGE: social signs in to the same main-line bridge the Julius link uses, resolved by the same rule (the project
	// setting; the wl.Julius.Bridge.Url override; https, or plain http to this machine only).
	SignIn = MakeUnique<FWonderlandSocialSignIn>([](FString& OutProblem) -> FString
	{
		IConsoleVariable* Override = IConsoleManager::Get().FindConsoleVariable(TEXT("wl.Julius.Bridge.Url"));
		return WonderlandJuliusStreamLogic::ResolveBridgeUrl(Override != nullptr ? Override->GetString() : FString(),
			GetDefault<UWonderlandJuliusLinkSettings>()->BridgeUrl, OutProblem);
	});
	SignIn->OnChanged().AddUObject(this, &UWonderlandSocialSubsystem::HandleServiceChanged);
	const TWeakObjectPtr<UWonderlandSocialSubsystem> WeakThis(this);
	SignIn->OnSignedIn = [WeakThis](const FString& BaseUrl, const FString& Token)
	{
		if (WeakThis.IsValid() && WeakThis->ConnectWith(BaseUrl, Token))
		{
			WeakThis->bLiveBySignIn = true;
		}
	};
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
	VoicePreview = nullptr;
	Voice.Reset();   // before the service: an EOS voice holds the live service's pointer
	Live = nullptr;
	Service.Reset();
	SignIn.Reset();   // the session dies with the process (memory only); the bridge lets it expire
	Super::Deinitialize();
}

const FWonderlandSignInView& UWonderlandSocialSubsystem::GetSignInView() const
{
	static const FWonderlandSignInView None;
	return SignIn.IsValid() ? SignIn->GetView() : None;
}

void UWonderlandSocialSubsystem::StartSignIn()
{
	if (SignIn.IsValid())
	{
		SignIn->Start();
	}
}

void UWonderlandSocialSubsystem::CancelSignIn()
{
	if (SignIn.IsValid())
	{
		SignIn->Cancel();
	}
}

bool UWonderlandSocialSubsystem::OpenSignInBrowser()
{
	return SignIn.IsValid() && SignIn->OpenBrowser();
}

FString UWonderlandSocialSubsystem::DescribeSignIn() const
{
	return SignIn.IsValid() ? SignIn->Describe() : FString(TEXT("no sign-in"));
}

void UWonderlandSocialSubsystem::SignOut()
{
	if (bLiveBySignIn)
	{
		DropLive();
	}
	if (SignIn.IsValid())
	{
		SignIn->SignOut();
	}
}

void UWonderlandSocialSubsystem::DropLive()
{
	if (Live != nullptr)
	{
		Live->ReportPresence(false);   // best effort: the player is leaving live social
	}
	Live = nullptr;
	bLiveBySignIn = false;
	VoicePreview = nullptr;
	Voice = MakeUnique<FWonderlandVoiceUnavailable>();
	Scene = TEXT("base");
	Adopt(nullptr);   // clears the other players too; every surface then offers SIGN IN
}

void UWonderlandSocialSubsystem::HandleLiveSessionEnded()
{
	// NEVER INSIDE THE SERVICE'S OWN CALLBACK: the live service is broadcasting from its HTTP completion, so it is replaced
	// on the next tick, once, and only if it is still the current one.
	const TWeakObjectPtr<UWonderlandSocialSubsystem> WeakThis(this);
	const FWonderlandSocialLiveService* Ended = Live;
	FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([WeakThis, Ended](float)
	{
		if (!WeakThis.IsValid() || WeakThis->Live != Ended || Ended == nullptr)
		{
			return false;
		}
		const bool bWasSignIn = WeakThis->bLiveBySignIn;
		WeakThis->DropLive();
		if (bWasSignIn && WeakThis->SignIn.IsValid())
		{
			WeakThis->SignIn->SessionEnded(TEXT("Your Wonderland session ended (the server restarted, or the session expired). Sign in again: your friends, messages and party are kept."));
		}
		UE_LOG(LogTemp, Display, TEXT("WLSOCIAL live: left live social after the server ended the session (%s)"), bWasSignIn ? TEXT("signed-in player") : TEXT("developer session"));
		return false;
	}), 0.0f);
}

bool UWonderlandSocialSubsystem::ReloadPreview()
{
	return LoadPreviewScene(Scene);
}

bool UWonderlandSocialSubsystem::LoadPreviewScene(const FString& InScene)
{
	VoicePreview = nullptr;
	Live = nullptr;
	bLiveBySignIn = false;
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

void UWonderlandSocialSubsystem::HandleServiceChanged()
{
	LeaveVoiceIfPartyGone();
	SocialChanged.Broadcast();
}

void UWonderlandSocialSubsystem::LeaveVoiceIfPartyGone()
{
	// THE CLIENT LEAVES TOO (the plan; Second's review: it relied on the authority's removal alone): a room whose party the viewer is no
	// longer in -- left, removed, a block -- is left at once. The authority removes the PUID from the room as well.
	FWonderlandEosVoice* Eos = GetEosVoice();
	if (Eos == nullptr)
	{
		return;
	}
	const FWonderlandVoiceState& VoiceNow = Eos->GetState();
	// a room HELD after a refused leave counts too (Second's RC13 review C1: FAILED was skipped, so a gone party kept its room)
	if (VoiceNow.Connection != TEXT("CONNECTED") && VoiceNow.Connection != TEXT("CONNECTING") && !VoiceNow.bRoomHeld)
	{
		return;
	}
	const FWonderlandSocialSnapshot* Snap = GetSnapshot();
	if (Snap == nullptr || !Snap->bHasParty || Snap->Party.PartyId != VoiceNow.PartyId)
	{
		UE_LOG(LogTemp, Display, TEXT("WLVOICE: the party %s is gone from this view: leaving its voice room"), *WonderlandEosVoice::Hashed(VoiceNow.PartyId));
		Eos->Disconnect();
	}
}

FWonderlandEosVoice* UWonderlandSocialSubsystem::GetEosVoice() const
{
	// in a live session Voice is either the honest UNAVAILABLE one (provider "") or the EOS one; a preview is never live
	return Live != nullptr && VoicePreview == nullptr && Voice.IsValid() && Voice->GetProviderId() == TEXT("eos")
		? static_cast<FWonderlandEosVoice*>(Voice.Get()) : nullptr;
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
		UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL live: a token from outside is for developer sessions; a player signs in (SIGN IN in the Social Hub)"));
		return false;
	}
	bLiveBySignIn = false;
	return ConnectWith(BaseUrl, Token);
}

bool UWonderlandSocialSubsystem::ConnectWith(const FString& BaseUrl, const FString& Token)
{
	if (!(BaseUrl.StartsWith(TEXT("https://")) || BaseUrl.StartsWith(TEXT("http://127.0.0.1")) || BaseUrl.StartsWith(TEXT("http://localhost"))) || Token.IsEmpty())
	{
		UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL live: refused (https, or http to this machine only; a token is required)"));
		return false;
	}
	VoicePreview = nullptr;
	Voice = MakeUnique<FWonderlandVoiceUnavailable>();   // a real provider is the founder's choice; until then, honestly pending
	TUniquePtr<FWonderlandSocialLiveService> Connected = MakeUnique<FWonderlandSocialLiveService>(BaseUrl, Token);
	Live = Connected.Get();
	++LiveGeneration;   // every live session its own number: late answers for an earlier one are recognized and dropped
	Scene = TEXT("live");
	// R16 REAL VOICE (founder, 10-04: EOS Voice). A developer's -WLEosConfig file first; else THE SHIPPED PATH (founder 10-04: "the
	// backend hands it out"): the signed-in session asks its server for the GAME-client config. Until then honestly pending, never faked.
	{
		FString VoiceWhy;
		TUniquePtr<FWonderlandEosVoice> Eos = FWonderlandEosVoice::TryCreate(Live, VoiceWhy);
		if (Eos.IsValid())
		{
			Voice = MoveTemp(Eos);
			// every voice change redraws the surfaces (Second's review: the panel sat on CONNECTING), and may leave a party's room
			Voice->OnChanged().AddUObject(this, &UWonderlandSocialSubsystem::HandleVoiceChanged);
			UE_LOG(LogTemp, Display, TEXT("WLVOICE: EOS voice on (the developer's -WLEosConfig; the authority mints each room)"));
		}
		else if (VoiceWhy == TEXT("no -WLEosConfig"))
		{
			RequestEosConfigFromServer();
		}
		else
		{
			UE_LOG(LogTemp, Display, TEXT("WLVOICE: no voice provider in this session (%s): VOICE TRANSPORT PENDING"), *VoiceWhy);
		}
	}
	// MULTIPLAYER PHASE 1: report this player's Dog, draw the others, and join the public world this map is.
	Live->SetAvatarSource([WeakThis = TWeakObjectPtr<UWonderlandSocialSubsystem>(this)](FWonderlandAvatarReport& Out)
	{
		return WeakThis.IsValid() && WeakThis->ReportLocalPlayer(Out);
	});
	Live->OnWorldChanged().AddUObject(this, &UWonderlandSocialSubsystem::HandleWorldChanged);
	Live->OnSessionEnded().AddUObject(this, &UWonderlandSocialSubsystem::HandleLiveSessionEnded);
	Adopt(MoveTemp(Connected));
	Live->JoinWorld(TEXT("PUBLIC"), TEXT("golden_arrival"));
	UE_LOG(LogTemp, Display, TEXT("WLSOCIAL live: connecting to %s"), *BaseUrl);
	return true;
}

void UWonderlandSocialSubsystem::RequestEosConfigFromServer(int32 Attempt)
{
	if (Live == nullptr)
	{
		return;
	}
	FWonderlandSocialLiveService* const Asked = Live;
	// THE SESSION IT WAS ASKED FOR, by generation: a pointer alone could match a later session allocated at the same address
	const int32 AskedGeneration = LiveGeneration;
	UE_LOG(LogTemp, Display, TEXT("WLVOICE: asking the server for the EOS game-client config (held in memory only, never logged)"));
	const TWeakObjectPtr<UWonderlandSocialSubsystem> WeakThis(this);
	Asked->GetEosClientConfig([WeakThis, Asked, AskedGeneration, Attempt](int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)
	{
		UWonderlandSocialSubsystem* Self = WeakThis.Get();
		if (Self == nullptr || Self->Live != Asked || Self->LiveGeneration != AskedGeneration)
		{
			return;   // signed out, or another session started meanwhile: this answer belongs to nobody now
		}
		FWonderlandEosVoice::FConfig Config;
		FString Why;
		if (Status != 200 || !WonderlandEosVoice::ConfigFromServer(Data, Config, Why))
		{
			const FString Reason = Status == 503 ? FString(TEXT("the server has no voice (503)"))
				: Status != 200 ? FString::Printf(TEXT("the server refused the voice config (%d %s)"), Status, *Problem) : Why;
			// ONE RETRY, spaced out (Second's review of 310b4dc7): no answer, a timeout, a 429 or a proxy's 5xx may pass; a 401/403/404 will
			// not. One retry stays far inside the route's 6 a minute.
			const bool bRetryable = Attempt == 0 && Status != 200 && Status != 401 && Status != 403 && Status != 404;
			UE_LOG(LogTemp, Display, TEXT("WLVOICE: no voice provider in this session (%s): VOICE TRANSPORT PENDING%s"), *Reason,
				bRetryable ? TEXT(" -- asking once more in 15 s") : TEXT(""));
			if (bRetryable)
			{
				FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([WeakThis, Asked, AskedGeneration](float)
				{
					UWonderlandSocialSubsystem* Again = WeakThis.Get();
					if (Again != nullptr && Again->Live == Asked && Again->LiveGeneration == AskedGeneration)
					{
						Again->RequestEosConfigFromServer(1);
					}
					return false;
				}), 15.0f);
			}
			return;
		}
		TUniquePtr<FWonderlandEosVoice> Eos = FWonderlandEosVoice::TryCreateWithConfig(Asked, Config, Why);
		WonderlandEosVoice::WipeConfig(Config);   // this copy is zeroed now: the EOS SDK holds what it needs, the service wiped its own
		if (!Eos.IsValid())
		{
			UE_LOG(LogTemp, Display, TEXT("WLVOICE: no voice provider in this session (%s): VOICE TRANSPORT PENDING"), *Why);
			return;
		}
		Self->Voice = MoveTemp(Eos);
		Self->Voice->OnChanged().AddUObject(Self, &UWonderlandSocialSubsystem::HandleVoiceChanged);
		UE_LOG(LogTemp, Display, TEXT("WLVOICE: EOS voice on (the game-client config from the server, in memory only; the authority mints each room)"));
		Self->HandleVoiceChanged();
	});
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
	/** R16 VOICE: the EOS voice's state, hashed ids only (`wl.Social.Voice`). */
	FAutoConsoleCommandWithWorldAndArgs GSocialVoice(
		TEXT("wl.Social.Voice"),
		TEXT("Say the live session's EOS voice state (hashed ids only): provider, this player's PUID hash, the room, who is talking."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
			const UWonderlandSocialSubsystem* Social = Instance != nullptr ? Instance->GetSubsystem<UWonderlandSocialSubsystem>() : nullptr;
			const FWonderlandEosVoice* Eos = Social != nullptr ? Social->GetEosVoice() : nullptr;
			UE_LOG(LogTemp, Display, TEXT("WLVOICE %s"), Eos != nullptr ? *Eos->Describe() : TEXT("no EOS voice in this session (not signed in, the server's voice config not received yet, or the server has no voice)"));
			// the pinned vector both sides hash (Second's backend test): the R16 evidence shows client and authority lines join
			UE_LOG(LogTemp, Display, TEXT("WLVOICE hash vector 0123456789abcdef0123456789abcdef -> %s"), *WonderlandEosVoice::HashedPuid(TEXT("0123456789abcdef0123456789abcdef")));
		}));

	/** R16 EVIDENCE: after the authority removed this player, try to rejoin the last room with the last token -- it must be refused. */
	FAutoConsoleCommandWithWorldAndArgs GQaVoiceReplay(
		TEXT("wl.Qa.VoiceReplayOldToken"),
		TEXT("R16 evidence: rejoin the last voice room with the last token this client was given (after a removal Epic must refuse it)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
			UWonderlandSocialSubsystem* Social = Instance != nullptr ? Instance->GetSubsystem<UWonderlandSocialSubsystem>() : nullptr;
			FWonderlandEosVoice* Eos = Social != nullptr ? Social->GetEosVoice() : nullptr;
			// the service says why it will not (no earlier token; still in a room); only "no EOS voice at all" is said here
			if (Eos == nullptr)
			{
				UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: QA REPLAY of the previous token -- no EOS voice in this session"));
			}
			else
			{
				Eos->ReplayLastToken();
			}
		}));

	/** R16 SHIPPED VOICE QA (founder 10-04: "tests/negative controls for every rule"): the server's EOS game-client config goes through
	 *  ONE strict parser (WonderlandEosVoice::ConfigFromServer). Synthetic canary values only -- never a real credential, never logged.
	 *  A valid answer parses; a wrong or missing schema, a null payload, and each field missing or empty are refused; no refusal reason
	 *  carries a value; a refusal leaves nothing behind. EC1 proves the value-in-reason judge can fail. No network. WLQA EOSCFG lines. */
	FAutoConsoleCommand GQaEosConfigParse(
		TEXT("wl.Qa.EosConfigParse"),
		TEXT("QA: the server's EOS game-client config parser, with synthetic values and negative controls (no network, no real credential)."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			int32 Passed = 0;
			int32 Failed = 0;
			auto Check = [&Passed, &Failed](const FString& Id, bool bOk, const FString& What)
			{
				(bOk ? Passed : Failed) += 1;
				UE_LOG(LogTemp, Display, TEXT("WLQA EOSCFG %s %s -- %s"), *Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *What);
			};
			static const TCHAR* const CfgNames[] = { TEXT("productId"), TEXT("sandboxId"), TEXT("deploymentId"), TEXT("clientId"), TEXT("clientSecret") };
			const FString Canary = FString::Printf(TEXT("qacanary%s"), *FGuid::NewGuid().ToString(EGuidFormats::Digits).Left(16));
			auto Make = [&Canary](const FString& Skip, const FString& Blank, const FString& Schema)
			{
				TSharedPtr<FJsonObject> Made = MakeShared<FJsonObject>();
				if (!Schema.IsEmpty())
				{
					Made->SetStringField(TEXT("schema"), Schema);
				}
				for (const TCHAR* CfgName : CfgNames)
				{
					if (Skip != CfgName)
					{
						Made->SetStringField(CfgName, Blank == CfgName ? FString() : FString::Printf(TEXT("%s-%s"), CfgName, *Canary));
					}
				}
				return Made;
			};
			const FString V1 = TEXT("wonderland-eos-client-config.v1");
			{
				FWonderlandEosVoice::FConfig Got;
				FString Why;
				const bool bOk = WonderlandEosVoice::ConfigFromServer(Make(FString(), FString(), V1), Got, Why);
				Check(TEXT("E1"), bOk && Got.ClientSecret == FString::Printf(TEXT("clientSecret-%s"), *Canary) && Got.ProductId.StartsWith(TEXT("productId-")),
					TEXT("a valid v1 answer parses, every field read"));
			}
			auto Refused = [&Check, &Canary](const FString& Id, const TSharedPtr<FJsonObject>& Data, const FString& WantInWhy)
			{
				FWonderlandEosVoice::FConfig Got;
				FString Why;
				const bool bOk = WonderlandEosVoice::ConfigFromServer(Data, Got, Why);
				const bool bClean = !Why.Contains(Canary) && Got.ClientSecret.IsEmpty() && Got.ClientId.IsEmpty();
				Check(Id, !bOk && bClean && (WantInWhy.IsEmpty() || Why.Contains(WantInWhy)),
					FString::Printf(TEXT("refused%s; the reason names %s and carries no value; nothing kept"), bOk ? TEXT(" -- NOT (accepted)") : TEXT(""),
						WantInWhy.IsEmpty() ? TEXT("the schema") : *WantInWhy));
			};
			Refused(TEXT("E2"), Make(FString(), FString(), TEXT("wonderland-eos-client-config.v2")), FString());
			Refused(TEXT("E3"), Make(FString(), FString(), FString()), FString());
			Refused(TEXT("E4"), TSharedPtr<FJsonObject>(), FString());
			int32 Case = 5;
			for (const TCHAR* CfgName : CfgNames)
			{
				Refused(FString::Printf(TEXT("E%d"), Case++), Make(CfgName, FString(), V1), CfgName);   // the field missing
				Refused(FString::Printf(TEXT("E%d"), Case++), Make(FString(), CfgName, V1), CfgName);   // the field empty
			}
			// THE JUDGE'S CONTROL: a reason that DID carry a value must be caught by the same Contains test
			const FString Leaky = FString::Printf(TEXT("the server's voice config has no clientSecret-%s"), *Canary);
			Check(TEXT("EC1"), Leaky.Contains(Canary), TEXT("control: a reason carrying a value IS detected by the value-in-reason judge"));
			UE_LOG(LogTemp, Display, TEXT("WLQA EOSCFG END pass=%d fail=%d"), Passed, Failed);
		}));

	/** R16 PRESENCE QA (founder 10-04: the hub's presence control, with tests + negative controls): the client sends only the
	 *  authority's four availabilities. A throwaway live service on a dead loopback port (127.0.0.1:9, nothing listens; never a real
	 *  server) is asked presence.set: an unknown word, a lowercase one and an empty one must be refused BEFORE sending; the four must be
	 *  accepted (sent, pending). PC1 proves the refusal is specific: a real operation on the same service is not refused. WLQA PRESENCE. */
	FAutoConsoleCommand GQaPresenceChoice(
		TEXT("wl.Qa.PresenceChoice"),
		TEXT("QA: the hub's presence choices -- only AVAILABLE/AWAY/BUSY/APPEAR_OFFLINE leave the client (dead loopback port, no real server)."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			int32 Passed = 0;
			int32 Failed = 0;
			TUniquePtr<FWonderlandSocialLiveService> Probe = MakeUnique<FWonderlandSocialLiveService>(TEXT("http://127.0.0.1:9"), TEXT("qa-presence"));
			auto Line = [&Passed, &Failed](const FString& Id, bool bOk, const FString& What)
			{
				(bOk ? Passed : Failed) += 1;
				UE_LOG(LogTemp, Display, TEXT("WLQA PRESENCE %s %s -- %s"), *Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *What);
			};
			int32 Case = 1;
			for (const TCHAR* Wrong : { TEXT("INVISIBLE"), TEXT("away"), TEXT("ONLINE"), TEXT("") })
			{
				const FWonderlandSocialActionResult Got = Probe->Request(TEXT("presence.set"), Wrong);
				Line(FString::Printf(TEXT("PR%d"), Case++), !Got.bOk && !Got.bPending,
					FString::Printf(TEXT("'%s' refused before sending (%s)"), Wrong, *Got.Reason));
			}
			for (const TCHAR* Right : { TEXT("AVAILABLE"), TEXT("AWAY"), TEXT("BUSY"), TEXT("APPEAR_OFFLINE") })
			{
				const FWonderlandSocialActionResult Got = Probe->Request(TEXT("presence.set"), Right);
				Line(FString::Printf(TEXT("PR%d"), Case++), Got.bOk && Got.bPending, FString::Printf(TEXT("'%s' accepted and sent"), Right));
			}
			// THE CONTROL: the refusal is the presence rule's, not the service's -- a real operation on the same probe is sent
			const FWonderlandSocialActionResult Other = Probe->Request(TEXT("requests.send"), TEXT("qa_user"));
			Line(TEXT("PC1"), Other.bOk && Other.bPending, TEXT("control: requests.send on the same service is NOT refused"));
			Probe.Reset();   // cancels every request it started (they were to a dead port)
			UE_LOG(LogTemp, Display, TEXT("WLQA PRESENCE END pass=%d fail=%d"), Passed, Failed);
		}));

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

	/** The Social Hub's sign-in, by name: the SAME calls its SIGN IN / OPEN GITHUB / CANCEL / SIGN OUT buttons make. */
	FAutoConsoleCommandWithWorldAndArgs GSocialSignIn(
		TEXT("wl.Social.SignIn"),
		TEXT("Sign in to Wonderland social: `wl.Social.SignIn [start|open|cancel|out|status]` (start by default)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
			UWonderlandSocialSubsystem* Social = Instance != nullptr ? Instance->GetSubsystem<UWonderlandSocialSubsystem>() : nullptr;
			if (Social == nullptr)
			{
				UE_LOG(LogTemp, Display, TEXT("WLSOCIAL signin: no social subsystem"));
				return;
			}
			const FString Verb = Args.Num() > 0 ? Args[0].ToLower() : FString(TEXT("start"));
			if (Verb == TEXT("start")) { Social->StartSignIn(); }
			else if (Verb == TEXT("open")) { Social->OpenSignInBrowser(); }
			else if (Verb == TEXT("cancel")) { Social->CancelSignIn(); }
			else if (Verb == TEXT("out")) { Social->SignOut(); }
			UE_LOG(LogTemp, Display, TEXT("WLSOCIAL signin status: %s"), *Social->DescribeSignIn());
		}));
}
