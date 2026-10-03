#include "WonderlandSocialSignIn.h"

#include "Dom/JsonObject.h"
#include "HAL/PlatformProcess.h"
#include "HAL/PlatformTime.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Misc/DateTime.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

// NO NEW LOG CATEGORY (an early FName; memory: niagara-fname-hash-crash): LogTemp with the WLSOCIAL prefix, like the rest.

// Named, not anonymous: the module builds as one unity translation unit.
namespace WonderlandSocialSignInLogic
{
	/** The only page the client will ever open for a sign-in: GitHub's own. A bridge cannot send the player elsewhere. */
	bool IsGitHubPage(const FString& Uri)
	{
		return Uri.StartsWith(TEXT("https://github.com/"), ESearchCase::IgnoreCase) && !Uri.Contains(TEXT(" ")) && Uri.Len() < 200;
	}

	/** A refusal, in words for a person. The kind is the bridge's short code; nothing GitHub said is ever echoed. */
	FString MessageFor(int32 Status, const FString& Kind)
	{
		if (Status == 0)
		{
			return TEXT("Couldn't reach Wonderland. Check your connection, then sign in again.");
		}
		if (Kind == TEXT("signin_unavailable") || Status == 503)
		{
			return TEXT("Sign-in isn't available on this Wonderland server right now.");
		}
		if (Kind == TEXT("signin_expired"))
		{
			return TEXT("The code expired before it was approved. Sign in again.");
		}
		if (Kind == TEXT("signin_denied"))
		{
			return TEXT("Sign-in was declined at GitHub.");
		}
		if (!Kind.IsEmpty())
		{
			return FString::Printf(TEXT("Sign-in didn't complete (%s). Sign in again."), *Kind.Left(40));
		}
		return FString::Printf(TEXT("Sign-in didn't complete (HTTP %d). Sign in again."), Status);
	}
}

FWonderlandSocialSignIn::FWonderlandSocialSignIn(TFunction<FString(FString& OutProblem)> InBaseUrlSource)
	: BaseUrlSource(MoveTemp(InBaseUrlSource))
{
	TickerHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateRaw(this, &FWonderlandSocialSignIn::Tick), 0.5f);
}

FWonderlandSocialSignIn::~FWonderlandSocialSignIn()
{
	FTSTicker::GetCoreTicker().RemoveTicker(TickerHandle);
	*Alive = false;
}

const TCHAR* FWonderlandSocialSignIn::StateName(EWonderlandSignInState State)
{
	switch (State)
	{
	case EWonderlandSignInState::NoServer:  return TEXT("NO_SERVER");
	case EWonderlandSignInState::SignedOut: return TEXT("SIGNED_OUT");
	case EWonderlandSignInState::Starting:  return TEXT("STARTING");
	case EWonderlandSignInState::Waiting:   return TEXT("WAITING");
	case EWonderlandSignInState::SignedIn:  return TEXT("SIGNED_IN");
	case EWonderlandSignInState::Failed:    return TEXT("FAILED");
	}
	return TEXT("?");
}

FString FWonderlandSocialSignIn::Describe() const
{
	switch (View.State)
	{
	case EWonderlandSignInState::Waiting:
		return FString::Printf(TEXT("WAITING code %d chars, %.0f s left, polling every %.0f s"), View.UserCode.Len(),
			FMath::Max(0.0, View.ExpiresAt - FPlatformTime::Seconds()), IntervalSeconds);
	case EWonderlandSignInState::SignedIn:
		return FString::Printf(TEXT("SIGNED_IN as %s (@%s) on %s"), *View.ParticipantId, *View.Login, *BaseUrl);
	default:
		return FString::Printf(TEXT("%s%s%s"), StateName(View.State), View.Message.IsEmpty() ? TEXT("") : TEXT(": "), *View.Message);
	}
}

void FWonderlandSocialSignIn::SetState(EWonderlandSignInState State, const FString& Message)
{
	View.State = State;
	View.Message = Message;
	if (State != EWonderlandSignInState::Waiting)
	{
		View.UserCode.Reset();
		View.VerificationUri.Reset();
		View.ExpiresAt = 0.0;
	}
	if (State != EWonderlandSignInState::SignedIn)
	{
		View.Login.Reset();
		View.ParticipantId.Reset();
	}
	UE_LOG(LogTemp, Display, TEXT("WLSOCIAL signin %s"), *Describe());
	Changed.Broadcast();
}

void FWonderlandSocialSignIn::Start()
{
	if (View.State == EWonderlandSignInState::Starting || View.State == EWonderlandSignInState::Waiting || View.State == EWonderlandSignInState::SignedIn)
	{
		return;
	}
	FString Problem;
	BaseUrl = BaseUrlSource ? BaseUrlSource(Problem) : FString();
	Handle.Reset();
	Token.Reset();
	if (BaseUrl.IsEmpty())
	{
		SetState(EWonderlandSignInState::NoServer, Problem.IsEmpty()
			? FString(TEXT("No Wonderland server is configured in this build, so there is nothing to sign in to.")) : Problem);
		return;
	}
	SetState(EWonderlandSignInState::Starting, TEXT("Asking Wonderland for a sign-in code…"));
	Post(TEXT("start"), TEXT("{}"), FString(), [this](int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Kind)
	{
		if (View.State != EWonderlandSignInState::Starting)
		{
			return;   // cancelled while the bridge answered
		}
		FString NewHandle;
		FString Code;
		FString Uri;
		if (Status == 200 && Data.IsValid() && Data->TryGetStringField(TEXT("handle"), NewHandle) && Data->TryGetStringField(TEXT("userCode"), Code)
			&& Data->TryGetStringField(TEXT("verificationUri"), Uri) && !NewHandle.IsEmpty() && !Code.IsEmpty() && Code.Len() <= 16
			&& WonderlandSocialSignInLogic::IsGitHubPage(Uri))
		{
			double Interval = 5.0;
			Data->TryGetNumberField(TEXT("interval"), Interval);
			FString ExpiresAtIso;
			double SecondsLeft = 900.0;
			FDateTime Expires;
			if (Data->TryGetStringField(TEXT("expiresAt"), ExpiresAtIso) && FDateTime::ParseIso8601(*ExpiresAtIso, Expires))
			{
				SecondsLeft = (Expires - FDateTime::UtcNow()).GetTotalSeconds();
			}
			Handle = NewHandle;
			IntervalSeconds = FMath::Clamp(Interval, 2.0, 60.0);
			NextPollAt = FPlatformTime::Seconds() + IntervalSeconds;
			// Written before SetState, which keeps the code fields for Waiting (and clears them for every other state).
			View.UserCode = Code;
			View.VerificationUri = Uri;
			View.ExpiresAt = FPlatformTime::Seconds() + FMath::Clamp(SecondsLeft, 0.0, 3600.0);
			SetState(EWonderlandSignInState::Waiting, TEXT("Open the GitHub page, enter this code and approve Wonderland. This screen updates by itself."));
			return;
		}
		if (Status == 200)
		{
			SetState(EWonderlandSignInState::Failed, TEXT("Wonderland's sign-in answer was not understood. Sign in again."));
			return;
		}
		SetState(Kind == TEXT("signin_unavailable") ? EWonderlandSignInState::NoServer : EWonderlandSignInState::Failed,
			WonderlandSocialSignInLogic::MessageFor(Status, Kind));
	});
}

bool FWonderlandSocialSignIn::Tick(float DeltaSeconds)
{
	if (View.State == EWonderlandSignInState::Waiting && !bPolling && FPlatformTime::Seconds() >= NextPollAt)
	{
		Poll();
	}
	return true;
}

void FWonderlandSocialSignIn::Poll()
{
	if (View.State != EWonderlandSignInState::Waiting || bPolling)
	{
		return;
	}
	if (FPlatformTime::Seconds() >= View.ExpiresAt)
	{
		Handle.Reset();
		SetState(EWonderlandSignInState::Failed, TEXT("The code expired before it was approved. Sign in again."));
		return;
	}
	FString Body;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Body);
	Writer->WriteObjectStart();
	Writer->WriteValue(TEXT("handle"), Handle);
	Writer->WriteObjectEnd();
	Writer->Close();
	bPolling = true;
	Post(TEXT("poll"), Body, FString(), [this](int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Kind)
	{
		bPolling = false;
		if (View.State != EWonderlandSignInState::Waiting)
		{
			return;   // cancelled while the bridge answered
		}
		FString Answer;
		if (Status == 200 && Data.IsValid() && Data->TryGetStringField(TEXT("state"), Answer))
		{
			if (Answer == TEXT("pending") || Answer == TEXT("slow_down"))
			{
				double Interval = IntervalSeconds;
				if (Data->TryGetNumberField(TEXT("interval"), Interval))
				{
					IntervalSeconds = FMath::Clamp(Interval, 2.0, 60.0);
				}
				NextPollAt = FPlatformTime::Seconds() + IntervalSeconds;
				return;
			}
			FString NewToken;
			FString Participant;
			if (Answer == TEXT("signed_in") && Data->TryGetStringField(TEXT("token"), NewToken) && Data->TryGetStringField(TEXT("participantId"), Participant)
				&& !NewToken.IsEmpty() && !Participant.IsEmpty() && Participant.Len() <= 80)
			{
				FString Login;
				Data->TryGetStringField(TEXT("login"), Login);
				Token = NewToken;
				Handle.Reset();
				// Written before SetState, which keeps the identity fields for SignedIn (and clears them for every other state).
				View.Login = Login;
				View.ParticipantId = Participant;
				SetState(EWonderlandSignInState::SignedIn, FString::Printf(TEXT("Signed in as @%s."), *Login));
				if (OnSignedIn)
				{
					OnSignedIn(BaseUrl, Token);
				}
				return;
			}
		}
		// AN OUTAGE IS NOT A REFUSAL: the bridge unreachable or failing keeps the code alive until it expires.
		if (Status == 0 || Status >= 500)
		{
			NextPollAt = FPlatformTime::Seconds() + IntervalSeconds * 2.0;
			View.Message = TEXT("Can't reach Wonderland right now; still waiting for the approval…");
			Changed.Broadcast();
			return;
		}
		Handle.Reset();
		SetState(EWonderlandSignInState::Failed, WonderlandSocialSignInLogic::MessageFor(Status, Kind));
	});
}

void FWonderlandSocialSignIn::Cancel()
{
	if (View.State != EWonderlandSignInState::Starting && View.State != EWonderlandSignInState::Waiting)
	{
		return;
	}
	Handle.Reset();
	SetState(EWonderlandSignInState::SignedOut, TEXT("Sign-in cancelled."));
}

void FWonderlandSocialSignIn::SignOut()
{
	if (View.State != EWonderlandSignInState::SignedIn)
	{
		return;
	}
	// BEST EFFORT: the session dies on the bridge if it can be reached, and is forgotten here whatever it answers.
	const FString Ended = Token;
	Token.Reset();
	Post(TEXT("revoke"), TEXT("{}"), FString::Printf(TEXT("Relay-Session %s"), *Ended), [](int32 Status, const TSharedPtr<FJsonObject>&, const FString&)
	{
		UE_LOG(LogTemp, Display, TEXT("WLSOCIAL signin revoke answered HTTP %d"), Status);
	});
	SetState(EWonderlandSignInState::SignedOut, TEXT("Signed out."));
}

void FWonderlandSocialSignIn::SessionEnded(const FString& Why)
{
	Token.Reset();
	Handle.Reset();
	SetState(EWonderlandSignInState::SignedOut, Why);
}

bool FWonderlandSocialSignIn::OpenBrowser() const
{
	if (View.State != EWonderlandSignInState::Waiting || !WonderlandSocialSignInLogic::IsGitHubPage(View.VerificationUri))
	{
		return false;
	}
	FString Error;
	FPlatformProcess::LaunchURL(*View.VerificationUri, nullptr, &Error);
	UE_LOG(LogTemp, Display, TEXT("WLSOCIAL signin browser %s"), Error.IsEmpty() ? TEXT("opened") : *FString::Printf(TEXT("NOT opened: %s"), *Error));
	return Error.IsEmpty();
}

void FWonderlandSocialSignIn::Post(const FString& Path, const FString& Body, const FString& Authorization,
	TFunction<void(int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& ErrorKind)> Done)
{
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(BaseUrl + TEXT("/relay-api/wonderland/native/signin/") + Path);
	Request->SetVerb(TEXT("POST"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	// NO ORIGIN, EVER: the bridge refuses a native route that carries one, so no web page can drive a client's sign-in.
	if (!Authorization.IsEmpty())
	{
		Request->SetHeader(TEXT("Authorization"), Authorization);
	}
	Request->SetTimeout(20.0f);
	Request->SetContentAsString(Body);
	const TWeakPtr<bool> WeakAlive = Alive;
	Request->OnProcessRequestComplete().BindLambda([WeakAlive, Done = MoveTemp(Done)](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		if (!WeakAlive.IsValid() || !*WeakAlive.Pin())
		{
			return;
		}
		const int32 Status = bConnected && Response.IsValid() ? Response->GetResponseCode() : 0;
		TSharedPtr<FJsonObject> Json;
		TSharedPtr<FJsonObject> Data;
		FString Kind;
		if (Response.IsValid() && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Response->GetContentAsString()), Json) && Json.IsValid())
		{
			const TSharedPtr<FJsonObject>* Found = nullptr;
			if (Json->TryGetObjectField(TEXT("data"), Found) && Found != nullptr)
			{
				Data = *Found;
			}
			const TSharedPtr<FJsonObject>* Error = nullptr;
			if (Json->TryGetObjectField(TEXT("error"), Error) && Error != nullptr && Error->IsValid())
			{
				(*Error)->TryGetStringField(TEXT("kind"), Kind);
			}
		}
		Done(Status, Data, Kind);
	});
	Request->ProcessRequest();
}
