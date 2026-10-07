#include "WonderlandEosVoice.h"

#include "WonderlandBeta.h"   // -WLEosConfig is a developer session's (TryCreate)

#include "WonderlandSocialLive.h"

#include "Containers/Ticker.h"
#include "Dom/JsonObject.h"
#include "HAL/PlatformMisc.h"
#include "Misc/ScopeExit.h"
#include "Misc/SecureHash.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "IEOSSDKManager.h"
#if PLATFORM_WINDOWS && !PLATFORM_CPU_ARM_FAMILY
#include "HAL/PlatformProcess.h"
#include "Windows/eos_Windows.h"
#endif
#include "EOSVoiceChatFactory.h"
#include "VoiceChat.h"
#include "eos_sdk.h"
#include "eos_connect.h"

// ---------------------------------------------------------------------------------------------------------------- the engine side
struct FWonderlandEosVoice::FImpl
{
	IEOSPlatformHandlePtr Platform;
	/** THE ONE VOICE USER: IVoiceChat is itself an IVoiceChatUser; login, channels and events all go through it. */
	IVoiceChatPtr VoiceChat;
	/** EOS Connect's "this login expires in ~10 minutes" notification (Second's RC13 review: nothing renewed it, so a session past
	 *  the login's lifetime lost voice), and what its plain C callback reaches back into: the service, while it is alive. */
	EOS_NotificationId AuthExpiry = EOS_INVALID_NOTIFICATIONID;
	struct FExpiryTarget
	{
		TWeakPtr<bool> Alive;
		FWonderlandEosVoice* Service = nullptr;
	};
	TUniquePtr<FExpiryTarget> ExpiryTarget;
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

	/** Sign-in retries: after 2, 5 and 15 s; then the panel's next JOIN VOICE starts over. */
	constexpr float EosSignInRetrySeconds[] = { 2.0f, 5.0f, 15.0f };

	/** A player id for a WLVOICE line: hashed like every other id there (Second's RC13 review: raw user ids broke the "hashed ids only"
	 *  contract). An "unbound #…" row is already a hash and stays as it is. */
	FString VoiceLogId(const FString& UserId)
	{
		return UserId.StartsWith(TEXT("unbound ")) ? UserId : WonderlandEosVoice::Hashed(UserId);
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
		// SHA-1, first 12 lowercase hex -- the backend's own (Second, 10-04). NOT FPlatformMisc::GetSHA256Signature: on UE 5.8 only the
		// generic one exists and it is checkf(false) -- every -WLEosConfig session would have crashed at its first hashed line.
		const FTCHARToUTF8 Utf8(*Id);
		return TEXT("#") + FSHA1::HashBuffer(Utf8.Get(), static_cast<uint64>(Utf8.Length())).ToString().ToLower().Left(12);
	}

	FString HashedPuid(const FString& InProductUserId)
	{
		return Hashed(InProductUserId.ToLower());
	}

	FString DeveloperFileFrom(const TCHAR* CommandLine, bool bDeveloperSession, bool& OutIgnored)
	{
		OutIgnored = false;
		FString Path;
		if (CommandLine == nullptr || !FParse::Value(CommandLine, TEXT("WLEosConfig="), Path) || Path.IsEmpty())
		{
			return FString();
		}
		if (!bDeveloperSession)
		{
			OutIgnored = true;   // named, and refused: a player session takes the shipped path
			return FString();
		}
		return Path;
	}

	bool ReadConfig(const FString& Path, FWonderlandEosVoice::FConfig& Out, FString& OutWhy)
	{
		FString Text;
		if (!FFileHelper::LoadFileToString(Text, *Path))
		{
			OutWhy = TEXT("the EOS file named by -WLEosConfig cannot be read");
			return false;
		}
		TMap<FString, FString> Env;
		TArray<FString> Lines;
		// the file's text and every piece cut from it are zeroed before they are freed (Second's review M1)
		ON_SCOPE_EXIT
		{
			WipeString(Text);
			for (FString& Line : Lines) { WipeString(Line); }
			for (TPair<FString, FString>& Pair : Env) { WipeString(Pair.Value); }
		};
		// THE FOUNDER'S FILE IS A .env (10-04: eos-game.env): KEY=VALUE lines, EOS_PRODUCT_ID, EOS_SANDBOX_ID, EOS_DEPLOYMENT_ID,
		// EOS_GAME_CLIENT_ID, EOS_GAME_CLIENT_SECRET; '#' comments and quotes allowed. A JSON object with productId ... clientSecret is
		// still read. Values are kept in memory only; a problem names the key, never its value.
		// a JSON object is read as JSON (its values may hold '='); everything else as KEY=VALUE lines
		const bool bJson = Text.TrimStart().StartsWith(TEXT("{"));
		Text.ParseIntoArrayLines(Lines);
		for (const FString& Line : bJson ? TArray<FString>() : Lines)
		{
			FString Trimmed = Line.TrimStartAndEnd();
			if (Trimmed.StartsWith(TEXT("export ")))
			{
				Trimmed = Trimmed.RightChop(7).TrimStart();
			}
			FString Key;
			FString Value;
			if (Trimmed.IsEmpty() || Trimmed.StartsWith(TEXT("#")) || !Trimmed.Split(TEXT("="), &Key, &Value))
			{
				continue;
			}
			Value = Value.TrimStartAndEnd();
			// an inline comment first -- " # ..." after whitespace (ids and secrets hold no spaces) -- then the quotes around what is left
			for (int32 At = 1; At < Value.Len(); ++At)
			{
				if (Value[At] == TEXT('#') && FChar::IsWhitespace(Value[At - 1]))
				{
					Value = Value.Left(At).TrimEnd();
					break;
				}
			}
			if (Value.Len() >= 2 && ((Value.StartsWith(TEXT("\"")) && Value.EndsWith(TEXT("\""))) || (Value.StartsWith(TEXT("'")) && Value.EndsWith(TEXT("'")))))
			{
				Value = Value.Mid(1, Value.Len() - 2);
			}
			Env.Add(Key.TrimStartAndEnd(), Value);
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
	// A DEVELOPER'S FILE BELONGS TO A DEVELOPER SESSION (2026-10-07). The founder's final-package rule names -WLEosConfig, and a player
	// build has the SHIPPED path (the backend hands the game-client config out after sign-in): in a player session the switch is
	// ignored, said once, and the session goes on exactly as if it were absent.
	bool bIgnored = false;
	const FString Path = WonderlandEosVoice::DeveloperFileFrom(FCommandLine::Get(), WonderlandBeta::IsDeveloperSession(), bIgnored);
	if (bIgnored)
	{
		UE_LOG(LogTemp, Display, TEXT("WLVOICE: -WLEosConfig ignored: a developer setting, and this is a player session (the shipped path follows)"));
	}
	if (Path.IsEmpty())
	{
		OutWhy = TEXT("no -WLEosConfig");
		return nullptr;
	}
	FConfig Read;
	ON_SCOPE_EXIT { WonderlandEosVoice::WipeConfig(Read); };   // the developer file's copy, zeroed like the server's (Second's review M1)
	if (!WonderlandEosVoice::ReadConfig(Path, Read, OutWhy))
	{
		return nullptr;
	}
	return TryCreateWithConfig(InLive, Read, OutWhy);
}

TUniquePtr<FWonderlandEosVoice> FWonderlandEosVoice::TryCreateWithConfig(FWonderlandSocialLiveService* InLive, const FConfig& InConfig, FString& OutWhy)
{
	TUniquePtr<FWonderlandEosVoice> Service(new FWonderlandEosVoice(InLive, InConfig));
	if (!Service->Start(OutWhy))
	{
		return nullptr;
	}
	return Service;
}

void WonderlandEosVoice::WipeString(FString& Value)
{
	for (TCHAR& Character : Value.GetCharArray())
	{
		Character = TEXT('\0');
	}
	Value.Empty();
}

void WonderlandEosVoice::WipeConfig(FWonderlandEosVoice::FConfig& Config)
{
	WipeString(Config.ProductId);
	WipeString(Config.SandboxId);
	WipeString(Config.DeploymentId);
	WipeString(Config.ClientId);
	WipeString(Config.ClientSecret);
}

bool WonderlandEosVoice::ConfigFromServer(const TSharedPtr<FJsonObject>& Data, FWonderlandEosVoice::FConfig& Out, FString& OutWhy)
{
	// THE SERVER'S ANSWER, as the contract names it (Second's route, 10-04): the schema first, then five non-empty strings. A problem
	// names the FIELD only; the values are never logged, kept only in Out, and dropped by the caller once EOS holds them.
	FString Schema;
	if (!Data.IsValid() || !Data->TryGetStringField(TEXT("schema"), Schema) || Schema != TEXT("wonderland-eos-client-config.v1"))
	{
		OutWhy = TEXT("the server's voice config is not wonderland-eos-client-config.v1");
		return false;
	}
	static const TCHAR* const Names[] = { TEXT("productId"), TEXT("sandboxId"), TEXT("deploymentId"), TEXT("clientId"), TEXT("clientSecret") };
	FString* const Fields[] = { &Out.ProductId, &Out.SandboxId, &Out.DeploymentId, &Out.ClientId, &Out.ClientSecret };
	for (int32 Index = 0; Index < static_cast<int32>(UE_ARRAY_COUNT(Names)); ++Index)
	{
		if (!Data->TryGetStringField(Names[Index], *Fields[Index]) || Fields[Index]->IsEmpty())
		{
			OutWhy = FString::Printf(TEXT("the server's voice config has no %s"), Names[Index]);
			WipeConfig(Out);
			return false;
		}
	}
	return true;
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
	// TEARDOWN IS NOT A SERVER REMOVAL (Second's RC13 review B2): a quit, a SIGN OUT or the 401 sign-in-again ends this object while
	// it may hold a room, and the engine's exit event fires INSIDE LeaveChannel/Uninitialize -- with bLeaving unset it logged "EXIT
	// ... (ended by the server)", the R16 block step's own evidence words. Every callback is made inert FIRST (the strong Alive they
	// hold a weak copy of is replaced, so each one returns at its IsValid check), and the leave is logged here, as what it is.
	bLeaving = true;
	Alive = MakeShared<bool>(false);
	if (Impl->AuthExpiry != EOS_INVALID_NOTIFICATIONID && Impl->Platform.IsValid())
	{
		if (const EOS_HConnect ConnectApi = EOS_Platform_GetConnectInterface(*Impl->Platform))
		{
			EOS_Connect_RemoveNotifyAuthExpiration(ConnectApi, Impl->AuthExpiry);
		}
		Impl->AuthExpiry = EOS_INVALID_NOTIFICATIONID;
	}
	if (Impl->VoiceChat.IsValid())
	{
		// a room still held is LEFT, not dropped; then the voice user goes with its instance
		if (!RoomId.IsEmpty())
		{
			UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: EXIT room %s (left: this client's voice is shutting down)"), *WonderlandEosVoice::Hashed(RoomId));
			Impl->VoiceChat->LeaveChannel(RoomId, FOnVoiceChatChannelLeaveCompleteDelegate());
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
		WonderlandEosVoice::WipeConfig(Config);   // no platform will ever take it: zeroed here, not left to the destructor (Second's review M1)
		OutWhy = TEXT("the EOS SDK is not initialized in this build");
		return false;
	}
	FEOSSDKPlatformConfig PlatformConfig;
	PlatformConfig.Name = TEXT("WonderlandVoice");
	PlatformConfig.ProductId = Config.ProductId;
	PlatformConfig.SandboxId = Config.SandboxId;
	PlatformConfig.DeploymentId = Config.DeploymentId;
	PlatformConfig.ClientId = Config.ClientId;
	PlatformConfig.ClientSecret = Config.ClientSecret;
	// EACH INSTANCE ITS OWN EOS CACHE, under its own -userdir (Second's review #1: one Windows user's two instances must not share a PUID)
	PlatformConfig.CacheDirectory = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("EOS"));
	PlatformConfig.bEnableRTC = true;
	PlatformConfig.bDisableOverlay = true;
	PlatformConfig.bDisableSocialOverlay = true;
	Sdk->AddPlatformConfig(PlatformConfig, true);
#if PLATFORM_WINDOWS && !PLATFORM_CPU_ARM_FAMILY
	// R12 (founder 2026-10-07: an optional, unresolved component is removed, never shipped on an unclear licence): EOS voice uses
	// the SYSTEM XAudio 2.9 (xaudio2_9.dll in the Windows system folder; every supported Windows has it), exactly as the engine
	// already does on ARM64 (WindowsEOSSDKManager.cpp, CreatePlatform). The engine's x64 path hands EOS the bundled
	// Binaries/ThirdParty/Windows/XAudio2_9/x64/xaudio2_9redist.dll, whose own licence names no part of itself as distributable
	// code, so the package no longer ships that file (build_beta_rc.ps1 step 3). The game's own audio never used it: the XAudio2_9
	// module links the system xaudio2.lib. This hook runs after the engine set its path (OnPreCreateNamedPlatform fires inside
	// FEOSSDKManager::CreatePlatform, after FWindowsEOSSDKManager's override) and before EOS_Platform_Create; it touches only THIS
	// platform ("WonderlandVoice"), and it is removed as soon as the platform exists or failed to.
	const FDelegateHandle SystemXAudioHook = Sdk->OnPreCreateNamedPlatform.AddLambda(
		[](const FEOSSDKPlatformConfig& Named, EOS_Platform_Options& Options)
		{
			if (Named.Name != TEXT("WonderlandVoice") || Options.RTCOptions == nullptr)
			{
				return;
			}
			static const FString SystemXAudio = FPaths::Combine(FPlatformProcess::WindowsSystemDir(), TEXT("xaudio2_9.dll"));
			static const FTCHARToUTF8 SystemXAudioUtf8(*SystemXAudio);
			static EOS_Windows_RTCOptions WindowsRTCOptions = {};
			WindowsRTCOptions.ApiVersion = EOS_WINDOWS_RTCOPTIONS_API_LATEST;
			WindowsRTCOptions.XAudio29DllPath = SystemXAudioUtf8.Get();
			const_cast<EOS_Platform_RTCOptions*>(Options.RTCOptions)->PlatformSpecificOptions = &WindowsRTCOptions;
			UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: RTC audio is the system XAudio 2.9 (xaudio2_9.dll, Windows system folder)"));
		});
	Impl->Platform = Sdk->CreatePlatform(PlatformConfig.Name);
	Sdk->OnPreCreateNamedPlatform.Remove(SystemXAudioHook);
#else
	Impl->Platform = Sdk->CreatePlatform(PlatformConfig.Name);
#endif
	// THE SECRET'S LIFETIME (Second's review of 310b4dc7): the SDK manager keeps every added config for the process's life, so the
	// named one is overwritten by a blank (the name only) as soon as the platform exists or failed to, and THIS CLIENT'S OWN copies
	// are zeroed before they are freed. Copies the engine makes (the HTTP payload, the JSON reader's, the parsed tree's, the SDK
	// manager's replaced entry and its UTF-8 temporaries) and the EOS SDK's own inside the platform are freed as the engine frees them
	// (Second's review of 4e877962, M1); the founder ruled that runtime delivery is not secret from the machine's owner -- this only
	// keeps this client's copies from outliving their use, and every copy stays in memory: never logged, never written.
	{
		FEOSSDKPlatformConfig Blank;
		Blank.Name = PlatformConfig.Name;
		Sdk->AddPlatformConfig(Blank, true);
	}
	WonderlandEosVoice::WipeString(PlatformConfig.ClientSecret);
	WonderlandEosVoice::WipeString(PlatformConfig.ClientId);
	WonderlandEosVoice::WipeConfig(Config);
	if (!Impl->Platform.IsValid())
	{
		OutWhy = TEXT("EOS refused to create the platform (check the EOS product configuration)");
		return false;
	}
	// no product or deployment fingerprint in the log (Second's review: stable fingerprints in evidence, even hashed)
	UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: platform up; signing in"));
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
	bSigningIn = true;
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
	bSigningIn = false;
	if (InProductUserId.IsEmpty())
	{
		OnSignInFailed(TEXT("no product user id"));
		return;
	}
	if (bRenewing)
	{
		// THE LOGIN RENEWED before it expired (WatchAuthExpiry): the same device credential, so the same PUID; voice and any room are
		// left exactly as they are
		bRenewing = false;
		RenewAttempts = 0;
		const bool bSame = InProductUserId.Equals(ProductUserId, ESearchCase::IgnoreCase);
		UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: EOS login renewed (puid %s%s)"), *WonderlandEosVoice::HashedPuid(InProductUserId),
			bSame ? TEXT("") : TEXT(" -- NOT the same puid: voice keeps the first"));
		return;
	}
	ProductUserId = InProductUserId;
	bSignedIn = true;
	SignInAttempts = 0;
	// THE DAY-ONE CHECK (Second's review #1): each instance logs its PUID, hashed; two R16 clients must differ
	UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: signed in as puid %s (cache %s)"), *GetHashedProductUserId(),
		*WonderlandEosVoice::Hashed(FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir())));
	WatchAuthExpiry();
	StartVoice();
}

void FWonderlandEosVoice::WatchAuthExpiry()
{
	if (Impl->AuthExpiry != EOS_INVALID_NOTIFICATIONID || !Impl->Platform.IsValid())
	{
		return;
	}
	const EOS_HConnect ConnectApi = EOS_Platform_GetConnectInterface(*Impl->Platform);
	if (ConnectApi == nullptr)
	{
		return;
	}
	Impl->ExpiryTarget = MakeUnique<FImpl::FExpiryTarget>();
	Impl->ExpiryTarget->Alive = Alive;
	Impl->ExpiryTarget->Service = this;
	EOS_Connect_AddNotifyAuthExpirationOptions Options = {};
	Options.ApiVersion = EOS_CONNECT_ADDNOTIFYAUTHEXPIRATION_API_LATEST;
	Impl->AuthExpiry = EOS_Connect_AddNotifyAuthExpiration(ConnectApi, &Options, Impl->ExpiryTarget.Get(), [](const EOS_Connect_AuthExpirationCallbackInfo* Data)
	{
		const FImpl::FExpiryTarget* Target = Data != nullptr ? static_cast<const FImpl::FExpiryTarget*>(Data->ClientData) : nullptr;
		if (Target != nullptr && Target->Alive.IsValid() && Target->Service != nullptr)
		{
			Target->Service->RenewSignIn();
		}
	});
}

void FWonderlandEosVoice::RenewSignIn()
{
	if (bSigningIn)
	{
		return;
	}
	// EOS asks for a fresh login ~10 minutes before this one lapses: the device credential logs in again (EOS_Connect_Login)
	UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: EOS login expires soon: renewing (puid %s)"), *GetHashedProductUserId());
	bRenewing = true;
	SignIn();
}

void FWonderlandEosVoice::OnSignInFailed(const FString& Why)
{
	bSigningIn = false;
	if (bRenewing)
	{
		// A RENEWAL THAT FAILED: the voice in use is left alone (the old login lasts a few minutes more); tried again, spaced out
		UE_LOG(LogTemp, Warning, TEXT("WLVOICE eos: EOS login renewal failed (attempt %d): %s"), RenewAttempts + 1, *Why);
		if (RenewAttempts < 25)   // every 20 s until about the old login's end (~8 of its last 10 minutes); Second's RC13 review m2
		{
			RenewAttempts += 1;
			TWeakPtr<bool> RenewAlive = Alive;
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([this, RenewAlive](float)
			{
				if (RenewAlive.IsValid() && bRenewing && !bSigningIn)
				{
					SignIn();
				}
				return false;
			}), 20.0f);
		}
		else
		{
			bRenewing = false;
			RenewAttempts = 0;
			State.Detail = TEXT("EOS login could not be renewed: voice may drop soon");
			Notify();
		}
		return;
	}
	UE_LOG(LogTemp, Warning, TEXT("WLVOICE eos: sign-in failed (attempt %d): %s"), SignInAttempts + 1, *Why);
	SetConnection(TEXT("FAILED"), FString::Printf(TEXT("EOS sign-in failed (%s)"), *Why));
	// TRY AGAIN, a few times, spaced out (Second's review: one failure left voice "still signing in" forever)
	if (SignInAttempts < static_cast<int32>(UE_ARRAY_COUNT(EosSignInRetrySeconds)))
	{
		const float Delay = EosSignInRetrySeconds[SignInAttempts];
		SignInAttempts += 1;
		TWeakPtr<bool> WeakAlive = Alive;
		FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([this, WeakAlive](float)
		{
			if (WeakAlive.IsValid() && !bSignedIn && !bSigningIn)
			{
				SignIn();
			}
			return false;
		}), Delay);
	}
}

void FWonderlandEosVoice::StartVoice()
{
	FEOSVoiceChatFactory* Factory = FEOSVoiceChatFactory::Get();
	if (Factory == nullptr)
	{
		SetConnection(TEXT("FAILED"), TEXT("EOS voice is not in this build"));
		return;
	}
	if (!Impl->VoiceChat.IsValid())
	{
		Impl->VoiceChat = Factory->CreateInstanceWithPlatform(Impl->Platform);
		if (!Impl->VoiceChat.IsValid() || !Impl->VoiceChat->Initialize())
		{
			Impl->VoiceChat.Reset();
			bVoiceFailed = true;
			SetConnection(TEXT("FAILED"), TEXT("EOS voice did not start"));
			return;
		}
		BindVoiceEvents();
	}
	TWeakPtr<bool> WeakAlive = Alive;
	Impl->VoiceChat->Connect(FOnVoiceChatConnectCompleteDelegate::CreateLambda([this, WeakAlive](const FVoiceChatResult& Result)
	{
		if (!WeakAlive.IsValid())
		{
			return;
		}
		if (!Result.IsSuccess())
		{
			bVoiceFailed = true;
			SetConnection(TEXT("FAILED"), FString::Printf(TEXT("EOS voice did not connect (%s)"), *Result.ErrorCode));
			return;
		}
		Impl->VoiceChat->Login(FPlatformMisc::GetPlatformUserForUserIndex(0), ProductUserId, FString(),
			FOnVoiceChatLoginCompleteDelegate::CreateLambda([this, WeakAlive](const FString&, const FVoiceChatResult& LoginResult)
		{
			if (!WeakAlive.IsValid())
			{
				return;
			}
			if (!LoginResult.IsSuccess())
			{
				bVoiceFailed = true;
				SetConnection(TEXT("FAILED"), FString::Printf(TEXT("EOS voice login failed (%s)"), *LoginResult.ErrorCode));
				return;
			}
			bVoiceReady = true;
			UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: voice ready (puid %s)"), *GetHashedProductUserId());
			SetConnection(TEXT("DISCONNECTED"), FString());
		}));
	}));
}

void FWonderlandEosVoice::BindVoiceEvents()
{
	IVoiceChat* Voice = Impl->VoiceChat.Get();
	TWeakPtr<bool> WeakAlive = Alive;
	Voice->OnVoiceChatChannelExited().AddLambda([this, WeakAlive](const FString& Channel, const FVoiceChatResult& Reason)
	{
		if (!WeakAlive.IsValid() || Channel != RoomId)
		{
			return;
		}
		if (bHeldAfterFailedLeave)
		{
			// THE HELD ROOM DROPPED (Second's RC13 review m1): after this player's OWN refused leave, an exit is the leave completing
			// on the client side -- never worded as the server's removal
			UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: EXIT room %s (dropped after this client's failed leave: client side%s)"), *WonderlandEosVoice::Hashed(Channel),
				Reason.IsSuccess() ? TEXT("") : *FString::Printf(TEXT(", %s"), *Reason.ErrorCode));
			EndRoom(true, FString());
			return;
		}
		UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: EXIT room %s (%s%s)"), *WonderlandEosVoice::Hashed(Channel), bLeaving ? TEXT("left") : TEXT("ended by the server"),
			Reason.IsSuccess() ? TEXT("") : *FString::Printf(TEXT(", %s"), *Reason.ErrorCode));
		EndRoom(bLeaving, bLeaving ? FString() : FString(TEXT("removed from the voice room")));
	});
	Voice->OnVoiceChatPlayerAdded().AddLambda([this, WeakAlive](const FString& Channel, const FString& Player)
	{
		if (!WeakAlive.IsValid() || Channel != RoomId)
		{
			return;
		}
		const FString Key = Player.ToLower();
		RoomNameByProductId.Add(Key, Player);
		if (Key == ProductUserId.ToLower())
		{
			return;   // this player: the self row is the panel's own (SelfParticipant)
		}
		const bool bBound = UserByProductId.Contains(Key);
		const FString UserId = UserIdFor(Player);
		// THE ROW KEEPS THE NAME IT WAS SHOWN WITH (Second's RC13 review): removal used to look the PUID up in the CURRENT binding,
		// which every audience refresh resets, so a member who left stayed on the panel as connected (or speaking)
		RowUserByPuid.Add(Key, UserId);
		UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: ADDED %s (puid %s) to room %s%s"), *VoiceLogId(UserId), *WonderlandEosVoice::HashedPuid(Player),
			*WonderlandEosVoice::Hashed(Channel), bBound ? TEXT("") : TEXT(" -- not yet bound: asking the authority again"));
		if (FindParticipant(UserId) == nullptr)
		{
			FWonderlandVoiceParticipant Joined;
			Joined.UserId = UserId;
			Joined.bConnected = true;
			State.Participants.Add(Joined);
		}
		if (!bBound)
		{
			// A MEMBER BOUND AFTER THIS CLIENT JOINED (Second's review #3): the join answer is idempotent; ask again and re-name them
			RefreshAudience();
		}
		Notify();
	});
	Voice->OnVoiceChatPlayerRemoved().AddLambda([this, WeakAlive](const FString& Channel, const FString& Player)
	{
		if (!WeakAlive.IsValid() || Channel != RoomId)
		{
			return;
		}
		const FString Key = Player.ToLower();
		const FString UserId = RowUserFor(Player);
		RowUserByPuid.Remove(Key);
		RoomNameByProductId.Remove(Key);
		UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: REMOVED %s (puid %s) from room %s"), *VoiceLogId(UserId), *WonderlandEosVoice::HashedPuid(Player), *WonderlandEosVoice::Hashed(Channel));
		State.Participants.RemoveAll([&UserId](const FWonderlandVoiceParticipant& P) { return P.UserId == UserId; });
		Notify();
	});
	Voice->OnVoiceChatPlayerTalkingUpdated().AddLambda([this, WeakAlive](const FString& Channel, const FString& Player, bool bTalking)
	{
		if (!WeakAlive.IsValid() || Channel != RoomId)
		{
			return;
		}
		const bool bSelf = Player.ToLower() == ProductUserId.ToLower();
		FWonderlandVoiceParticipant* P = bSelf ? &SelfParticipant() : FindParticipant(RowUserFor(Player));
		if (P != nullptr && P->bSpeaking != (bTalking && !P->bMicMuted))
		{
			// THE EVIDENCE "A HEARS B": a REMOTE player's talking, as received through the room
			UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: TALKING %s %s (puid %s%s)"), *VoiceLogId(P->UserId), bTalking ? TEXT("on") : TEXT("off"),
				*WonderlandEosVoice::HashedPuid(Player), bSelf ? TEXT(", this player") : TEXT(", received"));
			P->bSpeaking = bTalking && !P->bMicMuted;
			Notify();
		}
	});
	// THIS LISTENER muted (or unmuted) a REMOTE player (EOSVoiceChatUser: SetPlayerMuted's echo) -- a local mute, never the other's mic
	Voice->OnVoiceChatPlayerMuteUpdated().AddLambda([this, WeakAlive](const FString& Channel, const FString& Player, bool bMuted)
	{
		if (!WeakAlive.IsValid() || Channel != RoomId)
		{
			return;
		}
		if (FWonderlandVoiceParticipant* P = FindParticipant(RowUserFor(Player)))
		{
			P->bMutedLocally = bMuted;
			Notify();
		}
	});
}

FWonderlandVoiceCommandResult FWonderlandEosVoice::Connect(const FString& PartyId, const TArray<FString>& MemberIds)
{
	if (!bVoiceReady)
	{
		if (bSignedIn && bVoiceFailed)
		{
			bVoiceFailed = false;
			StartVoice();
			return FWonderlandVoiceCommandResult{false, TEXT("starting voice again; try JOIN VOICE in a moment")};
		}
		if (!bSignedIn && !bSigningIn)
		{
			// a sign-in that gave up is started over by the next JOIN VOICE
			SignInAttempts = 0;
			SignIn();
			return FWonderlandVoiceCommandResult{false, TEXT("signing in to EOS again; try JOIN VOICE in a moment")};
		}
		return FWonderlandVoiceCommandResult{false, bSignedIn ? TEXT("voice is still starting") : TEXT("still signing in to EOS")};
	}
	if (Live == nullptr)
	{
		return FWonderlandVoiceCommandResult{false, TEXT("not connected to Wonderland's social service")};
	}
	if (!RoomId.IsEmpty() || bJoining)
	{
		return FWonderlandVoiceCommandResult{false, TEXT("already in (or joining) the voice room")};
	}
	State.PartyId = PartyId;
	bJoining = true;
	bCancelJoin = false;
	SetConnection(TEXT("CONNECTING"), FString());
	TWeakPtr<bool> WeakAlive = Alive;
	// THE AUTHORITY DECIDES: the room token is minted for this PUID only if the signed-in player may be in this party's voice
	Live->JoinVoice(PartyId, ProductUserId, [this, WeakAlive, PartyId](int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)
	{
		if (!WeakAlive.IsValid())
		{
			return;
		}
		if (bCancelJoin)
		{
			bJoining = false;
			bCancelJoin = false;
			UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: join cancelled before the room (LEAVE)"));
			SetConnection(TEXT("DISCONNECTED"), FString());
			return;
		}
		FString Provider;
		FString Room;
		FString Token;
		if (Status != 200 || !Data.IsValid() || !Data->TryGetStringField(TEXT("providerId"), Provider) || Provider != TEXT("eos")
			|| !Data->TryGetStringField(TEXT("roomId"), Room) || !Data->TryGetStringField(TEXT("participantToken"), Token))
		{
			bJoining = false;
			UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: join refused (%d)"), Status);
			SetConnection(TEXT("FAILED"), Status == 503 ? FString(TEXT("the server has no voice provider (503)"))
				: FString::Printf(TEXT("the party's voice refused (%d %s)"), Status, *Problem));
			return;
		}
		ReadAudience(Data);
		LastRoomId = Room;
		LastToken = Token;
		UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: joining room %s for party %s (%d members bound)"), *WonderlandEosVoice::Hashed(Room),
			*WonderlandEosVoice::Hashed(PartyId), UserByProductId.Num());
		JoinRoom(Room, Token);
	});
	return FWonderlandVoiceCommandResult{true, FString()};
}

void FWonderlandEosVoice::JoinRoom(const FString& Room, const FString& Token)
{
	RoomId = Room;
	TWeakPtr<bool> WeakAlive = Alive;
	Impl->VoiceChat->JoinChannel(Room, Token, EVoiceChatChannelType::NonPositional,
		FOnVoiceChatChannelJoinCompleteDelegate::CreateLambda([this, WeakAlive](const FString& Channel, const FVoiceChatResult& Result)
	{
		if (!WeakAlive.IsValid())
		{
			return;
		}
		bJoining = false;
		if (!Result.IsSuccess())
		{
			UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: join of room %s failed (%s)"), *WonderlandEosVoice::Hashed(Channel), *Result.ErrorCode);
			if (Channel == RoomId)
			{
				RoomId.Reset();
			}
			bCancelJoin = false;
			SetConnection(TEXT("FAILED"), FString::Printf(TEXT("could not join the voice room (%s)"), *Result.ErrorCode));
			return;
		}
		UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: JOINED room %s"), *WonderlandEosVoice::Hashed(Channel));
		if (bCancelJoin)
		{
			// a LEAVE pressed while the channel was joining: leave it now that it can be left
			bCancelJoin = false;
			bLeaving = true;
			Impl->VoiceChat->TransmitToNoChannels();   // the panel already says DISCONNECTED: no word sent while the leave lands (Second's RC13 review m4)
			Impl->VoiceChat->LeaveChannel(Channel, FOnVoiceChatChannelLeaveCompleteDelegate::CreateLambda([this, WeakAlive, Channel](const FString&, const FVoiceChatResult& LeaveResult)
			{
				if (WeakAlive.IsValid() && RoomId == Channel)
				{
					if (LeaveResult.IsSuccess())
					{
						EndRoom(true, FString());
					}
					else
					{
						HoldRoomAfterFailedLeave(Channel, LeaveResult.ErrorCode);
					}
				}
			}));
			return;
		}
		// the room joined is the ONLY channel the mic sends to (Second's RC13 review m4: All would also open it into any still-joined
		// channel); a failed leave earlier set NO channels (HoldRoomAfterFailedLeave)
		Impl->VoiceChat->TransmitToSpecificChannels(TSet<FString>{ Channel });
		FWonderlandVoiceParticipant& Self = SelfParticipant();
		Self.bConnected = true;
		Self.bMicMuted = bLocalMicMuted;
		SetConnection(TEXT("CONNECTED"), FString());
	}));
}

void FWonderlandEosVoice::ReadAudience(const TSharedPtr<FJsonObject>& Data)
{
	// the authority's pairs are {userId, puid} (Second's 7ef54bdd), PUIDs lowercase: matched case-blind; this player's own is known
	UserByProductId.Reset();
	if (!ProductUserId.IsEmpty() && !ViewerId().IsEmpty())
	{
		UserByProductId.Add(ProductUserId.ToLower(), ViewerId());
	}
	const TArray<TSharedPtr<FJsonValue>>* Audience = nullptr;
	if (!Data.IsValid() || !Data->TryGetArrayField(TEXT("audience"), Audience))
	{
		return;
	}
	for (const TSharedPtr<FJsonValue>& Member : *Audience)
	{
		const TSharedPtr<FJsonObject>* MemberObject = nullptr;
		FString UserId;
		FString Puid;
		if (Member.IsValid() && Member->TryGetObject(MemberObject) && (*MemberObject)->TryGetStringField(TEXT("userId"), UserId)
			&& (*MemberObject)->TryGetStringField(TEXT("puid"), Puid))
		{
			UserByProductId.Add(Puid.ToLower(), UserId);
		}
	}
}

void FWonderlandEosVoice::RefreshAudience()
{
	const double NowSeconds = FPlatformTime::Seconds();
	if (Live == nullptr || State.PartyId.IsEmpty())
	{
		return;
	}
	if (bAudienceRefreshing || NowSeconds - LastAudienceRefresh < 1.0)
	{
		// NOT DROPPED (Second's re-review: a member joining within a second of another stayed "unbound"): remembered, and retried once the
		// throttle allows -- by the answer in flight, or by a ticker
		if (!bAudienceRefreshPending)
		{
			bAudienceRefreshPending = true;
			TWeakPtr<bool> RetryAlive = Alive;
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([this, RetryAlive](float)
			{
				if (!RetryAlive.IsValid() || !bAudienceRefreshPending)
				{
					return false;
				}
				if (bAudienceRefreshing)
				{
					return true;   // the earlier answer is still on its way: keep waiting (Second's third pass: a one-shot here lost it)
				}
				bAudienceRefreshPending = false;
				RefreshAudience();
				return false;
			}), 1.2f);
		}
		return;
	}
	bAudienceRefreshing = true;
	LastAudienceRefresh = NowSeconds;
	TWeakPtr<bool> WeakAlive = Alive;
	Live->JoinVoice(State.PartyId, ProductUserId, [this, WeakAlive](int32 Status, const TSharedPtr<FJsonObject>& Data, const FString&)
	{
		if (!WeakAlive.IsValid())
		{
			return;
		}
		bAudienceRefreshing = false;
		// one more asked for while this was in flight runs once this answer is read (below; throttled again if need be)
		const bool bRunPending = bAudienceRefreshPending;
		bAudienceRefreshPending = false;
		ON_SCOPE_EXIT
		{
			if (bRunPending && WeakAlive.IsValid())
			{
				RefreshAudience();
			}
		};
		if (Status != 200 || !Data.IsValid())
		{
			UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: audience refresh refused (%d)"), Status);
			return;
		}
		ReadAudience(Data);
		// re-name every row the room showed before its member was bound; the token of this answer is not used (the room is held)
		for (FWonderlandVoiceParticipant& P : State.Participants)
		{
			if (P.UserId.StartsWith(TEXT("unbound ")))
			{
				for (const TPair<FString, FString>& Room : RoomNameByProductId)
				{
					if (P.UserId == FString::Printf(TEXT("unbound %s"), *WonderlandEosVoice::HashedPuid(Room.Key)))
					{
						if (const FString* Named = UserByProductId.Find(Room.Key))
						{
							UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: puid %s is %s"), *WonderlandEosVoice::HashedPuid(Room.Key), *VoiceLogId(*Named));
							P.UserId = *Named;
							RowUserByPuid.Add(Room.Key, *Named);
						}
					}
				}
			}
		}
		Notify();
	});
}

FWonderlandVoiceCommandResult FWonderlandEosVoice::Disconnect()
{
	if (bLeaving)
	{
		return FWonderlandVoiceCommandResult{true, FString()};   // already leaving (the panel, or the party gone)
	}
	if (bJoining)
	{
		// LEAVE while the join is under way: it is cancelled as soon as it lands (the authority's answer, or the channel's)
		bCancelJoin = true;
		SetConnection(TEXT("DISCONNECTED"), TEXT("leaving"));
		return FWonderlandVoiceCommandResult{true, FString()};
	}
	if (!Impl->VoiceChat.IsValid() || RoomId.IsEmpty())
	{
		return FWonderlandVoiceCommandResult{false, TEXT("not in a voice room")};
	}
	bLeaving = true;
	TWeakPtr<bool> WeakAlive = Alive;
	const FString Leaving = RoomId;
	Impl->VoiceChat->LeaveChannel(Leaving, FOnVoiceChatChannelLeaveCompleteDelegate::CreateLambda([this, WeakAlive, Leaving](const FString&, const FVoiceChatResult& Result)
	{
		// the channel's EXIT normally cleans up first; this is the leave's own answer
		if (WeakAlive.IsValid() && RoomId == Leaving)
		{
			if (Result.IsSuccess())
			{
				UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: left room %s"), *WonderlandEosVoice::Hashed(Leaving));
				EndRoom(true, FString());
				return;
			}
			HoldRoomAfterFailedLeave(Leaving, Result.ErrorCode);
		}
	}));
	return FWonderlandVoiceCommandResult{true, FString()};
}

void FWonderlandEosVoice::HoldRoomAfterFailedLeave(const FString& Room, const FString& ErrorCode)
{
	// A FAILED LEAVE MUST NOT FAIL OPEN (Second's RC13 review B3): letting the room go here cleared RoomId, so the still-joined
	// channel's events were ignored while EOS kept sending the microphone (transmit mode All) and the panel read DISCONNECTED. Now the
	// microphone transmits to NO channel at once, the room stays held (its events still count, and a JOIN elsewhere is refused), and
	// the panel says so; LEAVE can be pressed again.
	Impl->VoiceChat->TransmitToNoChannels();
	// nothing of the room is PLAYED either while it is held (Second's RC13 review C1: TransmitToNoChannels stops sending only)
	Impl->VoiceChat->SetAudioOutputDeviceMuted(true);
	bLeaving = false;
	bHeldAfterFailedLeave = true;
	State.bRoomHeld = true;   // the panel keeps LEAVE VOICE on offer; a party that is gone still leaves it
	UE_LOG(LogTemp, Warning, TEXT("WLVOICE eos: LEAVE of room %s FAILED (%s): the microphone now transmits to no channel and the room is not played; still in the room until a leave succeeds"),
		*WonderlandEosVoice::Hashed(Room), *ErrorCode);
	SetConnection(TEXT("FAILED"), FString::Printf(TEXT("could not leave the voice room (%s); your microphone and the room's sound are off. Press LEAVE VOICE again."), *ErrorCode));
}

void FWonderlandEosVoice::EndRoom(bool bAsked, const FString& Why)
{
	bLeaving = false;
	bJoining = false;
	bCancelJoin = false;
	RoomId.Reset();
	State.Participants.Reset();
	RoomNameByProductId.Reset();
	RowUserByPuid.Reset();
	if (bHeldAfterFailedLeave && Impl->VoiceChat.IsValid())
	{
		Impl->VoiceChat->SetAudioOutputDeviceMuted(false);   // the hold is over: the next room is heard again
	}
	bHeldAfterFailedLeave = false;
	State.bRoomHeld = false;
	SetConnection(TEXT("DISCONNECTED"), bAsked ? FString() : Why);
}

FWonderlandVoiceCommandResult FWonderlandEosVoice::SetMicMuted(bool bMuted)
{
	if (!Impl->VoiceChat.IsValid())
	{
		return FWonderlandVoiceCommandResult{false, TEXT("voice is not started")};
	}
	Impl->VoiceChat->SetAudioInputDeviceMuted(bMuted);
	bLocalMicMuted = bMuted;
	// the panel reads this player's own row for MUTE MIC / UNMUTE MIC (Second's review #4)
	if (!RoomId.IsEmpty())
	{
		FWonderlandVoiceParticipant& Self = SelfParticipant();
		Self.bMicMuted = bMuted;
		Self.bSpeaking = Self.bSpeaking && !bMuted;
	}
	UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: mic %s"), bMuted ? TEXT("muted") : TEXT("open"));
	Notify();
	return FWonderlandVoiceCommandResult{true, FString()};
}

FWonderlandVoiceCommandResult FWonderlandEosVoice::SetLocallyMuted(const FString& UserId, bool bMuted)
{
	if (!Impl->VoiceChat.IsValid())
	{
		return FWonderlandVoiceCommandResult{false, TEXT("voice is not started")};
	}
	// BY THE ROW AS SHOWN (Second's RC13 review: an "unbound #…" row has no binding, so MUTE on it always answered "not in this voice
	// room"), then by the authority's binding
	for (const TPair<FString, FString>& Row : RowUserByPuid)
	{
		if (Row.Value == UserId && Row.Key != ProductUserId.ToLower())
		{
			const FString* RoomName = RoomNameByProductId.Find(Row.Key);
			Impl->VoiceChat->SetPlayerMuted(RoomName != nullptr ? *RoomName : Row.Key, bMuted);
			if (FWonderlandVoiceParticipant* P = FindParticipant(UserId))
			{
				P->bMutedLocally = bMuted;
			}
			Notify();
			return FWonderlandVoiceCommandResult{true, FString()};
		}
	}
	for (const TPair<FString, FString>& Bound : UserByProductId)
	{
		if (Bound.Value == UserId && Bound.Key != ProductUserId.ToLower())
		{
			const FString* RoomName = RoomNameByProductId.Find(Bound.Key);
			Impl->VoiceChat->SetPlayerMuted(RoomName != nullptr ? *RoomName : Bound.Key, bMuted);
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

bool FWonderlandEosVoice::ReplayLastToken()
{
	if (!Impl->VoiceChat.IsValid() || LastRoomId.IsEmpty() || LastToken.IsEmpty())
	{
		UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: QA REPLAY of the previous token -- none in this session"));
		return false;
	}
	if (!RoomId.IsEmpty() || bJoining)
	{
		// inside a room the engine answers a JoinChannel at once without asking Epic: a "JOINED" there would be false evidence
		UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: QA REPLAY of the previous token refused -- this client is still in (or joining) a voice room; replay only after a removal"));
		return false;
	}
	UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: QA REPLAY of the previous token for room %s (NOT a normal join; after a removal it must be refused)"), *WonderlandEosVoice::Hashed(LastRoomId));
	TWeakPtr<bool> WeakAlive = Alive;
	Impl->VoiceChat->JoinChannel(LastRoomId, LastToken, EVoiceChatChannelType::NonPositional,
		FOnVoiceChatChannelJoinCompleteDelegate::CreateLambda([this, WeakAlive](const FString& Channel, const FVoiceChatResult& Result)
	{
		if (!WeakAlive.IsValid())
		{
			return;
		}
		UE_LOG(LogTemp, Display, TEXT("WLVOICE eos: QA REPLAY of the previous token, result for room %s: %s"), *WonderlandEosVoice::Hashed(Channel),
			Result.IsSuccess() ? TEXT("JOINED (the old token still works)") : *FString::Printf(TEXT("refused (%s)"), *Result.ErrorCode));
		if (Result.IsSuccess())
		{
			// evidence only: never stay in a room by a token the authority took back
			Impl->VoiceChat->LeaveChannel(Channel, FOnVoiceChatChannelLeaveCompleteDelegate());
		}
	}));
	return true;
}

FString FWonderlandEosVoice::Describe() const
{
	FString Talking;
	for (const FWonderlandVoiceParticipant& P : State.Participants)
	{
		if (P.bSpeaking)
		{
			Talking += (Talking.IsEmpty() ? TEXT("") : TEXT(", ")) + VoiceLogId(P.UserId);
		}
	}
	return FString::Printf(TEXT("eos | puid %s | %s | %s | room %s | %d in the room%s"), *GetHashedProductUserId(), bSignedIn ? TEXT("signed in") : TEXT("signing in"),
		*State.Connection, RoomId.IsEmpty() ? TEXT("none") : *WonderlandEosVoice::Hashed(RoomId), State.Participants.Num(),
		Talking.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(", talking: %s"), *Talking));
}

FString FWonderlandEosVoice::GetHashedProductUserId() const
{
	return WonderlandEosVoice::HashedPuid(ProductUserId);
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

FString FWonderlandEosVoice::ViewerId() const
{
	return Live != nullptr ? Live->GetSnapshot().ViewerId : FString();
}

FWonderlandVoiceParticipant& FWonderlandEosVoice::SelfParticipant()
{
	const FString Me = ViewerId();
	if (FWonderlandVoiceParticipant* Found = FindParticipant(Me))
	{
		return *Found;
	}
	FWonderlandVoiceParticipant Self;
	Self.UserId = Me;
	Self.bConnected = true;
	Self.bMicMuted = bLocalMicMuted;
	return State.Participants.Add_GetRef(Self);
}

FWonderlandVoiceParticipant* FWonderlandEosVoice::FindParticipant(const FString& UserId)
{
	return State.Participants.FindByPredicate([&UserId](const FWonderlandVoiceParticipant& P) { return P.UserId == UserId; });
}

FString FWonderlandEosVoice::RowUserFor(const FString& InProductUserId) const
{
	// the row as the panel shows it (Second's RC13 review m3: the current binding resets on every audience refresh)
	const FString* Shown = RowUserByPuid.Find(InProductUserId.ToLower());
	return Shown != nullptr ? *Shown : UserIdFor(InProductUserId);
}

FString FWonderlandEosVoice::UserIdFor(const FString& InProductUserId) const
{
	// a PUID the authority did not bind is shown as an unknown member, never as anyone it might claim to be
	const FString* UserId = UserByProductId.Find(InProductUserId.ToLower());
	return UserId != nullptr ? *UserId : FString::Printf(TEXT("unbound %s"), *WonderlandEosVoice::HashedPuid(InProductUserId));
}
