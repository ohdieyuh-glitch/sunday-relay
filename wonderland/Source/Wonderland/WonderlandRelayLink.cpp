#include "WonderlandRelayLink.h"

#include "Dom/JsonObject.h"
#include "HAL/PlatformMisc.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "WonderlandDogPawn.h"

void UWonderlandRelayLink::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	BridgeBaseUrl = ResolveBridgeBaseUrl();
	if (BridgeBaseUrl.IsEmpty())
	{
		// Said once, plainly, at startup. An operator who sees no intents
		// leaving should not have to infer this from silence.
		UE_LOG(LogTemp, Warning,
			TEXT("WLRELAY no Bridge endpoint configured; the link is READ-ONLY and will send nothing. "
			     "Pass -WonderlandBridgeUrl=<url> or set WONDERLAND_BRIDGE_URL."));
	}
	else
	{
		UE_LOG(LogTemp, Log, TEXT("WLRELAY bridge endpoint: %s"), *BridgeBaseUrl);
	}
}

void UWonderlandRelayLink::Deinitialize()
{
	DogPawns.Reset();
	bWorldAccepted = false;
	Super::Deinitialize();
}

FString UWonderlandRelayLink::ResolveBridgeBaseUrl()
{
	// Command line first so a single packaged build can be pointed at different
	// environments without rebuilding; environment second so a container can
	// supply it without rewriting the launch command. NO DEFAULT — a wrong
	// default would send a real request somewhere nobody chose.
	FString Url;
	if (FParse::Value(FCommandLine::Get(), TEXT("WonderlandBridgeUrl="), Url) && !Url.IsEmpty())
	{
		return Url.TrimStartAndEnd();
	}
	Url = FPlatformMisc::GetEnvironmentVariable(TEXT("WONDERLAND_BRIDGE_URL"));
	return Url.TrimStartAndEnd();
}

void UWonderlandRelayLink::RegisterDogPawn(AWonderlandDogPawn* Pawn)
{
	if (Pawn == nullptr)
	{
		return;
	}
	// Drop anything that died since the last pass while we are here; a weak
	// array that is only ever appended to grows for the life of the process.
	DogPawns.RemoveAll([](const TWeakObjectPtr<AWonderlandDogPawn>& P) { return !P.IsValid(); });
	DogPawns.AddUnique(Pawn);

	// A pawn joining late must not sit dormant until the next poll — but it
	// must also not be handed a world that never arrived. Only push a world
	// that was actually accepted.
	if (bWorldAccepted)
	{
		Pawn->ApplyWorldState(LastWorld);
	}
}

void UWonderlandRelayLink::UnregisterDogPawn(AWonderlandDogPawn* Pawn)
{
	if (Pawn == nullptr)
	{
		return;
	}
	DogPawns.RemoveAll([Pawn](const TWeakObjectPtr<AWonderlandDogPawn>& P)
	{
		return !P.IsValid() || P.Get() == Pawn;
	});
}

int32 UWonderlandRelayLink::RegisteredDogPawnCount() const
{
	int32 Count = 0;
	for (const TWeakObjectPtr<AWonderlandDogPawn>& P : DogPawns)
	{
		if (P.IsValid())
		{
			++Count;
		}
	}
	return Count;
}

void UWonderlandRelayLink::PushWorldState(const FWonderlandWorld& World)
{
	LastWorld = World;
	bWorldAccepted = true;
	for (int32 Index = DogPawns.Num() - 1; Index >= 0; --Index)
	{
		AWonderlandDogPawn* const Pawn = DogPawns[Index].Get();
		if (Pawn == nullptr)
		{
			DogPawns.RemoveAtSwap(Index);
			continue;
		}
		// READ-ONLY, one direction. The link hands the pawn a copy and learns
		// nothing back; a pawn cannot report activity, and nothing it does
		// here can reach Relay.
		Pawn->ApplyWorldState(LastWorld);
	}
}

bool UWonderlandRelayLink::RaiseIntent(const FString& IntentType, const FString& Locus, const FVector& FromLocation)
{
	if (IntentType.IsEmpty())
	{
		UE_LOG(LogTemp, Warning, TEXT("WLRELAY refusing an intent with no type"));
		return false;
	}
	if (!IsConfigured())
	{
		// FAIL CLOSED, and say which of the two failures this is. "Not
		// configured" and "configured but unreachable" are different problems
		// and only one of them is a deployment mistake.
		UE_LOG(LogTemp, Warning,
			TEXT("WLRELAY intent '%s' at '%s' NOT SENT: no Bridge endpoint configured"),
			*IntentType, *Locus);
		return false;
	}

	const TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("intentType"), IntentType);
	Body->SetStringField(TEXT("locus"), Locus);
	// The position is CONTEXT for whoever reads the request later, not a
	// coordinate Relay is expected to trust or act on.
	const TSharedRef<FJsonObject> At = MakeShared<FJsonObject>();
	At->SetNumberField(TEXT("x"), FromLocation.X);
	At->SetNumberField(TEXT("y"), FromLocation.Y);
	At->SetNumberField(TEXT("z"), FromLocation.Z);
	Body->SetObjectField(TEXT("raisedAt"), At);
	Body->SetStringField(TEXT("source"), TEXT("wonderland-client"));

	FString Payload;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Payload);
	if (!FJsonSerializer::Serialize(Body, Writer))
	{
		UE_LOG(LogTemp, Warning, TEXT("WLRELAY intent '%s' NOT SENT: could not serialise"), *IntentType);
		return false;
	}

	FString Url = BridgeBaseUrl;
	if (Url.EndsWith(TEXT("/")))
	{
		Url.LeftChopInline(1);
	}
	Url += TEXT("/wonderland/intent");

	// FHttpRequestRef, not the spelled-out TSharedRef<IHttpRequest, ESPMode::…>:
	// the alias is what Interfaces/IHttpRequest.h defines for this, and the
	// explicit form has moved between engine versions.
	const FHttpRequestRef Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(Url);
	Request->SetVerb(TEXT("POST"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetContentAsString(Payload);

	// The response is LOGGED, never turned into local state. Relay decides what
	// an intent means; if it changes anything, this client learns about it the
	// same way it learns everything — through a world snapshot.
	const FString LoggedType = IntentType;
	const FString LoggedLocus = Locus;
	Request->OnProcessRequestComplete().BindLambda(
		[LoggedType, LoggedLocus](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnectedSuccessfully)
		{
			if (!bConnectedSuccessfully || !Response.IsValid())
			{
				UE_LOG(LogTemp, Warning, TEXT("WLRELAY intent '%s' at '%s': no response from the Bridge"),
					*LoggedType, *LoggedLocus);
				return;
			}
			UE_LOG(LogTemp, Log, TEXT("WLRELAY intent '%s' at '%s': Bridge replied %d"),
				*LoggedType, *LoggedLocus, Response->GetResponseCode());
		});

	// Announce the fact, not the intention: this reports that the request was
	// HANDED OFF, which is the most this function can honestly know at the
	// moment it returns.
	const bool bSent = Request->ProcessRequest();
	if (!bSent)
	{
		UE_LOG(LogTemp, Warning, TEXT("WLRELAY intent '%s' NOT SENT: request refused by the HTTP module"),
			*IntentType);
	}
	return bSent;
}
