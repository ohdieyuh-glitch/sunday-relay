#include "WonderlandEosVoice.h"

#include "WonderlandSocialLive.h"

#include "Dom/JsonObject.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Misc/SecureHash.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "IEOSSDKManager.h"
#include "EOSVoiceChatFactory.h"
#include "VoiceChat.h"
#include "eos_sdk.h"
#include "eos_connect.h"

// ---------------------------------------------------------------------------------------------------------------- the engine side
struct FWonderlandEosVoice::FImpl
{
	IEOSPlatformHandlePtr Platform;
	IVoiceChatPtr VoiceChat;
	IVoiceChatUser* User = nullptr;
};

namespace
{
	/** One EOS Connect callback's way back: the service, if it is still alive. Deleted by the callback that receives it. */
	struct FEosCall
	{
		TWeakPtr<bool> Alive;
		FWonderlandEosVoice* Service = nullptr;
		EOS_HConnect Connect = nullptr;
		FString DisplayName;
	};

	FString ProductIdString(EOS_ProductUserId Id)
	{
		char Buffer[EOS_PRODUCTUSERID_MAX_LENGTH + 1] = {};
		int32_t Length = static_cast<int32_t>(sizeof(Buffer));
		return EOS_ProductUserId_ToString(Id, Buffer, &Length) == EOS_EResult::EOS_Success ? FString(UTF8_TO_TCHAR(Buffer)) : FString();
	}
}

namespace WonderlandEosVoice
{
	FString Hashed(const FString& Id)
	{
		if (Id.IsEmpty())
		{
			return FString();
		}
		return TEXT("#") + FMD5::HashAnsiString(*(TEXT("wlvoice:") + Id)).Left(8);
	}

	bool ReadConfig(const FString& Path, FWonderlandEosVoice::FConfig& Out, FString& OutWhy)
	{
		FString Text;
		if (!FFileHelper::LoadFileToString(Text, *Path))
		{
			OutWhy = TEXT("the EOS file named by -WLEosConfig cannot be read");
			return false;
		}
		// THE FOUNDER'S FILE IS A .env (10-04: eos-game.env): KEY=VALUE lines, EOS_PRODUCT_ID, EOS_SANDBOX_ID, EOS_DEPLOYMENT_ID,
		// EOS_GAME_CLIENT_ID, EOS_GAME_CLIENT_SECRET; '#' comments and quotes allowed. A JSON object with productId ... clientSecret is
		// still read. Values are kept in memory only; a problem names the key, never its value.
		TMap<FString, FString> Env;
		TArray<FString> Lines;
		Text.ParseIntoArrayLines(Lines);
		for (const FString& Line : Lines)
		{
			const FString Trimmed = Line.TrimStartAndEnd();
			FString Key;
			FString Value;
			if (Trimmed.IsEmpty() || Trimmed.StartsWith(TEXT("#")) || !Trimmed.Split(TEXT("="), &Key, &Value))
			{
				continue;
			}
			Env.Add(Key.TrimStartAndEnd(), Value.TrimStartAndEnd().TrimQuotes());
		}
		if (Env.Num() > 0)
		{
			static const TCHAR* const Keys[] = { TEXT("EOS_PRODUCT_ID"), TEXT("EOS_SANDBOX_ID"), TEXT("EOS_DEPLOYMENT_ID"), TEXT("EOS_GAME_CLIENT_ID"),
				TEXT("EOS_GAME_CLIENT_SECRET") };
			FString* const Fields[] = { &Out.ProductId, &Out.SandboxId, &Out.DeploymentId, &Out.ClientId, &Out.ClientSecret };
			for (int32 Index = 0; Index < static_cast<int32>(UE_ARRAY_COUNT(Keys)); ++Index)
			{
				const FString* Found = Env.Find(Keys[Index]);
				if (Found == nullptr || Found->IsEmpty())
				{
					OutWhy = FString::Printf(TEXT("the EOS file has no %s"), Keys[Index]);
					return false;
				}
				*Fields[Index] = *Found;
			}
			return true;
		}
		TSharedPtr<FJsonObject> Root;
		if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Root) || !Root.IsValid())
		{
			OutWhy = TEXT("the EOS file is neither KEY=VALUE lines nor a JSON object");
			return false;
		}
		const bool bAll = Root->TryGetStringField(TEXT("productId"), Out.ProductId) && Root->TryGetStringField(TEXT("sandboxId"), Out.SandboxId)
			&& Root->TryGetStringField(TEXT("deploymentId"), Out.DeploymentId) && Root->TryGetStringField(TEXT("clientId"), Out.ClientId)
			&& Root->TryGetStringField(TEXT("clientSecret"), Out.ClientSecret);
		if (!bAll || Out.ProductId.IsEmpty() || Out.SandboxId.IsEmpty() || Out.DeploymentId.IsEmpty() || Out.ClientId.IsEmpty() || Out.ClientSecret.IsEmpty())
		{
			// which field, never its value
			OutWhy = TEXT("the EOS file lacks one of productId, sandboxId, deploymentId, clientId, clientSecret");
			return false;
		}
		return true;
	}
}

// ---------------------------------------------------------------------------------------------------------------- the service
TUniquePtr<FWonderlandEosVoice> FWonderlandEosVoice::TryCreate(FWonderlandSocialLiveService* InLive, FString& OutWhy)
{
	FString Path;
	if (!FParse::Value(FCommandLine::Get(), TEXT("WLEosConfig="), Path) || Path.IsEmpty())
	{
		OutWhy = TEXT("no -WLEosConfig");
		return nullptr;
	}
	FConfig Read;
	if (!WonderlandEosVoice::ReadConfig(Path, Read, OutWhy))
	{
		return nullptr;
	}
	TUniquePtr<FWonderlandEosVoice> Service(new FWonderlandEosVoice(InLive, Read));
	if (!Service->Start(OutWhy))
	{
		return nullptr;
	}
	return Service;
}

FWonderlandEosVoice::FWonderlandEosVoice(FWonderlandSocialLiveService* InLive, const FConfig& InConfig)
	: Impl(MakeUnique<FImpl>())
	, Live(InLive)
	, Config(InConfig)
{
	State.ProviderId = TEXT("eos");
	State.Connection = TEXT("DISCONNECTED");
	State.Detail = TEXT("signing in to EOS");
}

FWonderlandEosVoice::~FWonderlandEosVoice()
{
	*Alive = false;
	if (Impl->VoiceChat.IsValid())
	{
		if (Impl->User != nullptr)
		{
			Impl->VoiceChat->ReleaseUser(Impl->User);
			Impl->User = nullptr;
		}
		Impl->VoiceChat->Uninitialize();
	}
	Impl->VoiceChat.Reset();
	Impl->Platform.Reset();
}

bool FWonderlandEosVoice::Start(FString& OutWhy)
{
	IEOSSDKManager* Sdk = IEOSSDKManager::Get();
	if (Sdk == nullptr || !Sdk->IsInitialized())
	{
		OutWhy = TEXT("the EOS SDK is not initialized in this build");
		return false;
	}
	FEOSSDKPlatformConfig Platform;
	Platform.Name = TEXT("WonderlandVoice");
	Platform.ProductId = Config.ProductId;
	Platform.SandboxId = Config.SandboxId;
	Platform.DeploymentId = Config.DeploymentId;
	Platform.ClientId = Config.ClientId;
	Platform.ClientSecret = Config.ClientSecret;
	// EACH INSTANCE ITS OWN EOS CACHE, under its own -userdir (Second's review #1: one Windows user's two instances must not share a PUID)
	Platform.CacheDirectory = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("EOS"));
	Platform.bEnableRTC = true;
	Platform.bDisableOverlay = true;
	Platform.bDisableSocialOverlay = true;
	Sdk->AddPlatformConfig(Platform, true);
	Impl->Platform = Sdk->CreatePlatform(Platform.Name);
	if (!Impl->Platform.IsValid())
	{
		OutWhy = TEXT("EOS refused to create the platform (check the product, sandbox, deployment and client in the founder's file)");
		return false;
	}
	UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: platform up (product %s, deployment %s); signing in"),
		*WonderlandEosVoice::Hashed(Config.ProductId), *WonderlandEosVoice::Hashed(Config.DeploymentId));
	SignIn();
	return true;
}

void FWonderlandEosVoice::SignIn()
{
	const EOS_HConnect ConnectApi = EOS_Platform_GetConnectInterface(*Impl->Platform);
	if (ConnectApi == nullptr)
	{
		OnSignInFailed(TEXT("no EOS Connect interface"));
		return;
	}
	// EOS CONNECT BY DEVICE ID: created once (a duplicate is fine), then the login; an unknown device creates its user
	FEosCall* Call = new FEosCall{ Alive, this, ConnectApi, FString::Printf(TEXT("Wonderland %s"), *FGuid::NewGuid().ToString().Left(6)) };
	EOS_Connect_CreateDeviceIdOptions Device = {};
	Device.ApiVersion = EOS_CONNECT_CREATEDEVICEID_API_LATEST;
	Device.DeviceModel = "Wonderland PC";
	EOS_Connect_CreateDeviceId(ConnectApi, &Device, Call, [](const EOS_Connect_CreateDeviceIdCallbackInfo* Data)
	{
		FEosCall* DeviceCall = static_cast<FEosCall*>(Data->ClientData);
		if (!DeviceCall->Alive.IsValid())
		{
			delete DeviceCall;
			return;
		}
		if (Data->ResultCode != EOS_EResult::EOS_Success && Data->ResultCode != EOS_EResult::EOS_DuplicateNotAllowed)
		{
			DeviceCall->Service->OnSignInFailed(FString::Printf(TEXT("device id: %s"), UTF8_TO_TCHAR(EOS_EResult_ToString(Data->ResultCode))));
			delete DeviceCall;
			return;
		}
		EOS_Connect_Credentials Credentials = {};
		Credentials.ApiVersion = EOS_CONNECT_CREDENTIALS_API_LATEST;
		Credentials.Token = nullptr;
		Credentials.Type = EOS_EExternalCredentialType::EOS_ECT_DEVICEID_ACCESS_TOKEN;
		const FTCHARToUTF8 Name(*DeviceCall->DisplayName);
		EOS_Connect_UserLoginInfo Info = {};
		Info.ApiVersion = EOS_CONNECT_USERLOGININFO_API_LATEST;
		Info.DisplayName = Name.Get();
		EOS_Connect_LoginOptions Login = {};
		Login.ApiVersion = EOS_CONNECT_LOGIN_API_LATEST;
		Login.Credentials = &Credentials;
		Login.UserLoginInfo = &Info;
		EOS_Connect_Login(DeviceCall->Connect, &Login, DeviceCall, [](const EOS_Connect_LoginCallbackInfo* LoginData)
		{
			FEosCall* LoginCall = static_cast<FEosCall*>(LoginData->ClientData);
			if (!LoginCall->Alive.IsValid())
			{
				delete LoginCall;
				return;
			}
			if (LoginData->ResultCode == EOS_EResult::EOS_Success)
			{
				LoginCall->Service->OnSignedIn(ProductIdString(LoginData->LocalUserId));
				delete LoginCall;
				return;
			}
			if (LoginData->ResultCode != EOS_EResult::EOS_InvalidUser || LoginData->ContinuanceToken == nullptr)
			{
				LoginCall->Service->OnSignInFailed(FString::Printf(TEXT("login: %s"), UTF8_TO_TCHAR(EOS_EResult_ToString(LoginData->ResultCode))));
				delete LoginCall;
				return;
			}
			EOS_Connect_CreateUserOptions Create = {};
			Create.ApiVersion = EOS_CONNECT_CREATEUSER_API_LATEST;
			Create.ContinuanceToken = LoginData->ContinuanceToken;
			EOS_Connect_CreateUser(LoginCall->Connect, &Create, LoginCall, [](const EOS_Connect_CreateUserCallbackInfo* CreateData)
			{
				FEosCall* CreateCall = static_cast<FEosCall*>(CreateData->ClientData);
				if (CreateCall->Alive.IsValid())
				{
					if (CreateData->ResultCode == EOS_EResult::EOS_Success)
					{
						CreateCall->Service->OnSignedIn(ProductIdString(CreateData->LocalUserId));
					}
					else
					{
						CreateCall->Service->OnSignInFailed(FString::Printf(TEXT("create user: %s"), UTF8_TO_TCHAR(EOS_EResult_ToString(CreateData->ResultCode))));
					}
				}
				delete CreateCall;
			});
		});
	});
}

void FWonderlandEosVoice::OnSignedIn(const FString& InProductUserId)
{
	if (InProductUserId.IsEmpty())
	{
		OnSignInFailed(TEXT("no product user id"));
		return;
	}
	ProductUserId = InProductUserId;
	bSignedIn = true;
	// THE DAY-ONE CHECK (Second's review #1): each instance logs its PUID, hashed; two R16 clients must differ
	UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: signed in as puid %s (cache %s)"), *GetHashedProductUserId(),
		*WonderlandEosVoice::Hashed(FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir())));
	StartVoice();
}

void FWonderlandEosVoice::OnSignInFailed(const FString& Why)
{
	UE_LOG(LogTemp, Warning, TEXT("WLVOICE eos: sign-in failed: %s"), *Why);
	SetConnection(TEXT("FAILED"), FString::Printf(TEXT("EOS sign-in failed (%s)"), *Why));
}

void FWonderlandEosVoice::StartVoice()
{
	FEOSVoiceChatFactory* Factory = FEOSVoiceChatFactory::Get();
	if (Factory == nullptr)
	{
		SetConnection(TEXT("FAILED"), TEXT("EOS voice is not in this build"));
		return;
	}
	Impl->VoiceChat = Factory->CreateInstanceWithPlatform(Impl->Platform);
	if (!Impl->VoiceChat.IsValid() || !Impl->VoiceChat->Initialize())
	{
		SetConnection(TEXT("FAILED"), TEXT("EOS voice did not start"));
		return;
	}
	IVoiceChat* Voice = Impl->VoiceChat.Get();
	TWeakPtr<bool> WeakAlive = Alive;
	Voice->OnVoiceChatChannelExited().AddLambda([this, WeakAlive](const FString& Channel, const FVoiceChatResult& Reason)
	{
		if (!WeakAlive.IsValid() || Channel != RoomId)
		{
			return;
		}
		UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: EXIT room %s (%s%s)"), *WonderlandEosVoice::Hashed(Channel), bLeaving ? TEXT("left") : TEXT("ended by the server"),
			Reason.IsSuccess() ? TEXT("") : *FString::Printf(TEXT(", %s"), *Reason.ErrorCode));
		const bool bAsked = bLeaving;
		bLeaving = false;
		RoomId.Reset();
		State.Participants.Reset();
		RoomNameByProductId.Reset();
		SetConnection(TEXT("DISCONNECTED"), bAsked ? FString() : TEXT("removed from the voice room"));
	});
	Voice->OnVoiceChatPlayerAdded().AddLambda([this, WeakAlive](const FString& Channel, const FString& Player)
	{
		if (!WeakAlive.IsValid() || Channel != RoomId)
		{
			return;
		}
		const FString UserId = UserIdFor(Player);
		RoomNameByProductId.Add(Player.ToLower(), Player);
		UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: ADDED %s (puid %s) to room %s"), *UserId, *WonderlandEosVoice::Hashed(Player), *WonderlandEosVoice::Hashed(Channel));
		if (FindParticipant(UserId) == nullptr)
		{
			FWonderlandVoiceParticipant Joined;
			Joined.UserId = UserId;
			Joined.bConnected = true;
			State.Participants.Add(Joined);
		}
		Notify();
	});
	Voice->OnVoiceChatPlayerRemoved().AddLambda([this, WeakAlive](const FString& Channel, const FString& Player)
	{
		if (!WeakAlive.IsValid() || Channel != RoomId)
		{
			return;
		}
		const FString UserId = UserIdFor(Player);
		UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: REMOVED %s (puid %s) from room %s"), *UserId, *WonderlandEosVoice::Hashed(Player), *WonderlandEosVoice::Hashed(Channel));
		State.Participants.RemoveAll([&UserId](const FWonderlandVoiceParticipant& P) { return P.UserId == UserId; });
		Notify();
	});
	Voice->OnVoiceChatPlayerTalkingUpdated().AddLambda([this, WeakAlive](const FString& Channel, const FString& Player, bool bTalking)
	{
		if (!WeakAlive.IsValid() || Channel != RoomId)
		{
			return;
		}
		if (FWonderlandVoiceParticipant* P = FindParticipant(UserIdFor(Player)))
		{
			if (P->bSpeaking != bTalking)
			{
				// THE EVIDENCE "A HEARS B": a REMOTE player's talking, as received through the room
				UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: TALKING %s %s (puid %s)"), *P->UserId, bTalking ? TEXT("on") : TEXT("off"), *WonderlandEosVoice::Hashed(Player));
				P->bSpeaking = bTalking && !P->bMicMuted;
				Notify();
			}
		}
	});
	Voice->OnVoiceChatPlayerMuteUpdated().AddLambda([this, WeakAlive](const FString& Channel, const FString& Player, bool bMuted)
	{
		if (!WeakAlive.IsValid() || Channel != RoomId)
		{
			return;
		}
		if (FWonderlandVoiceParticipant* P = FindParticipant(UserIdFor(Player)))
		{
			P->bMicMuted = bMuted;
			P->bSpeaking = P->bSpeaking && !bMuted;
			Notify();
		}
	});
	Voice->Connect(FOnVoiceChatConnectCompleteDelegate::CreateLambda([this, WeakAlive](const FVoiceChatResult& Result)
	{
		if (!WeakAlive.IsValid())
		{
			return;
		}
		if (!Result.IsSuccess())
		{
			SetConnection(TEXT("FAILED"), FString::Printf(TEXT("EOS voice did not connect (%s)"), *Result.ErrorCode));
			return;
		}
		Impl->User = Impl->VoiceChat->CreateUser();
		if (Impl->User == nullptr)
		{
			SetConnection(TEXT("FAILED"), TEXT("EOS voice made no user"));
			return;
		}
		Impl->User->Login(FPlatformMisc::GetPlatformUserForUserIndex(0), ProductUserId, FString(),
			FOnVoiceChatLoginCompleteDelegate::CreateLambda([this, WeakAlive](const FString&, const FVoiceChatResult& LoginResult)
		{
			if (!WeakAlive.IsValid())
			{
				return;
			}
			if (!LoginResult.IsSuccess())
			{
				SetConnection(TEXT("FAILED"), FString::Printf(TEXT("EOS voice login failed (%s)"), *LoginResult.ErrorCode));
				return;
			}
			bVoiceReady = true;
			UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: voice ready (puid %s)"), *GetHashedProductUserId());
			SetConnection(TEXT("DISCONNECTED"), FString());
		}));
	}));
}

FWonderlandVoiceCommandResult FWonderlandEosVoice::Connect(const FString& PartyId, const TArray<FString>& MemberIds)
{
	if (!bVoiceReady || Impl->User == nullptr)
	{
		return FWonderlandVoiceCommandResult{false, bSignedIn ? TEXT("voice is still starting") : TEXT("still signing in to EOS")};
	}
	if (Live == nullptr)
	{
		return FWonderlandVoiceCommandResult{false, TEXT("not connected to Wonderland's social service")};
	}
	if (!RoomId.IsEmpty())
	{
		return FWonderlandVoiceCommandResult{false, TEXT("already in the voice room")};
	}
	State.PartyId = PartyId;
	SetConnection(TEXT("CONNECTING"), FString());
	TWeakPtr<bool> WeakAlive = Alive;
	// THE AUTHORITY DECIDES: the room token is minted for this PUID only if the signed-in player may be in this party's voice
	Live->JoinVoice(PartyId, ProductUserId, [this, WeakAlive, PartyId](int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)
	{
		if (!WeakAlive.IsValid())
		{
			return;
		}
		FString Provider;
		FString Room;
		FString Token;
		if (Status != 200 || !Data.IsValid() || !Data->TryGetStringField(TEXT("providerId"), Provider) || Provider != TEXT("eos")
			|| !Data->TryGetStringField(TEXT("roomId"), Room) || !Data->TryGetStringField(TEXT("participantToken"), Token))
		{
			UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: join refused (%d)"), Status);
			SetConnection(TEXT("FAILED"), Status == 503 ? FString(WonderlandVoice::TransportPending()) : FString::Printf(TEXT("the party's voice refused (%d %s)"), Status, *Problem));
			return;
		}
		// the authority's bindings, PUID -> member (only these name anyone in the room)
		UserByProductId.Reset();
		const TArray<TSharedPtr<FJsonValue>>* Audience = nullptr;
		if (Data->TryGetArrayField(TEXT("audience"), Audience))
		{
			for (const TSharedPtr<FJsonValue>& Member : *Audience)
			{
				const TSharedPtr<FJsonObject>* MemberObject = nullptr;
				FString UserId;
				FString Puid;
				// the authority's pairs are {userId, puid} (Second's 7ef54bdd), PUIDs lowercase: matched case-blind
				if (Member.IsValid() && Member->TryGetObject(MemberObject) && (*MemberObject)->TryGetStringField(TEXT("userId"), UserId)
					&& (*MemberObject)->TryGetStringField(TEXT("puid"), Puid))
				{
					UserByProductId.Add(Puid.ToLower(), UserId);
				}
			}
		}
		RoomId = Room;
		UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: joining room %s for party %s (%d members bound)"), *WonderlandEosVoice::Hashed(Room),
			*WonderlandEosVoice::Hashed(PartyId), UserByProductId.Num());
		Impl->User->JoinChannel(Room, Token, EVoiceChatChannelType::NonPositional,
			FOnVoiceChatChannelJoinCompleteDelegate::CreateLambda([this, WeakAlive](const FString& Channel, const FVoiceChatResult& Result)
		{
			if (!WeakAlive.IsValid())
			{
				return;
			}
			if (!Result.IsSuccess())
			{
				UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: join of room %s failed (%s)"), *WonderlandEosVoice::Hashed(Channel), *Result.ErrorCode);
				RoomId.Reset();
				SetConnection(TEXT("FAILED"), FString::Printf(TEXT("could not join the voice room (%s)"), *Result.ErrorCode));
				return;
			}
			UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: JOINED room %s"), *WonderlandEosVoice::Hashed(Channel));
			SetConnection(TEXT("CONNECTED"), FString());
		}));
	});
	return FWonderlandVoiceCommandResult{true, FString()};
}

FWonderlandVoiceCommandResult FWonderlandEosVoice::Disconnect()
{
	if (Impl->User == nullptr || RoomId.IsEmpty())
	{
		return FWonderlandVoiceCommandResult{false, TEXT("not in a voice room")};
	}
	bLeaving = true;
	Impl->User->LeaveChannel(RoomId, FOnVoiceChatChannelLeaveCompleteDelegate());
	return FWonderlandVoiceCommandResult{true, FString()};
}

FWonderlandVoiceCommandResult FWonderlandEosVoice::SetMicMuted(bool bMuted)
{
	if (Impl->User == nullptr)
	{
		return FWonderlandVoiceCommandResult{false, TEXT("voice is not started")};
	}
	Impl->User->SetAudioInputDeviceMuted(bMuted);
	UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: mic %s"), bMuted ? TEXT("muted") : TEXT("open"));
	return FWonderlandVoiceCommandResult{true, FString()};
}

FWonderlandVoiceCommandResult FWonderlandEosVoice::SetLocallyMuted(const FString& UserId, bool bMuted)
{
	if (Impl->User == nullptr)
	{
		return FWonderlandVoiceCommandResult{false, TEXT("voice is not started")};
	}
	for (const TPair<FString, FString>& Bound : UserByProductId)
	{
		if (Bound.Value == UserId)
		{
			const FString* RoomName = RoomNameByProductId.Find(Bound.Key);
			Impl->User->SetPlayerMuted(RoomName != nullptr ? *RoomName : Bound.Key, bMuted);
			if (FWonderlandVoiceParticipant* P = FindParticipant(UserId))
			{
				P->bMutedLocally = bMuted;
			}
			Notify();
			return FWonderlandVoiceCommandResult{true, FString()};
		}
	}
	return FWonderlandVoiceCommandResult{false, TEXT("not in this voice room")};
}

FString FWonderlandEosVoice::Describe() const
{
	FString Talking;
	for (const FWonderlandVoiceParticipant& P : State.Participants)
	{
		if (P.bSpeaking)
		{
			Talking += (Talking.IsEmpty() ? TEXT("") : TEXT(", ")) + P.UserId;
		}
	}
	return FString::Printf(TEXT("eos | puid %s | %s | %s | room %s | %d in the room%s"), *GetHashedProductUserId(), bSignedIn ? TEXT("signed in") : TEXT("signing in"),
		*State.Connection, RoomId.IsEmpty() ? TEXT("none") : *WonderlandEosVoice::Hashed(RoomId), State.Participants.Num(),
		Talking.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(", talking: %s"), *Talking));
}

FString FWonderlandEosVoice::GetHashedProductUserId() const
{
	return WonderlandEosVoice::Hashed(ProductUserId);
}

void FWonderlandEosVoice::SetConnection(const TCHAR* Connection, const FString& Detail)
{
	State.Connection = Connection;
	State.Detail = Detail;
	Notify();
}

void FWonderlandEosVoice::Notify()
{
	Changed.Broadcast();
}

FWonderlandVoiceParticipant* FWonderlandEosVoice::FindParticipant(const FString& UserId)
{
	return State.Participants.FindByPredicate([&UserId](const FWonderlandVoiceParticipant& P) { return P.UserId == UserId; });
}

FString FWonderlandEosVoice::UserIdFor(const FString& InProductUserId) const
{
	// a PUID the authority did not bind is shown as an unknown member, never as anyone it might claim to be
	const FString* UserId = UserByProductId.Find(InProductUserId.ToLower());
	return UserId != nullptr ? *UserId : FString::Printf(TEXT("unbound %s"), *WonderlandEosVoice::Hashed(InProductUserId));
}
