// wl.Qa.WonderWeb.Describe — one read-only JSON line for the Wonder Web extraction proof.
//
// Not registered in a Shipping build. The guard is the same one around the other wl.Qa.* commands
// (WonderlandQaCommands.cpp:21, WonderlandDevDrive.cpp:19). On the QA event-line branch the same
// guard wraps the registrations in WonderlandQaEventCommands.cpp:21.
//
// The line is read-only. It calls DescribeWonderWeb and, because that method exists and takes no
// arguments, DescribeWonderWebWorkspace. It does not open, close, or focus a window.
//
// The subsystem is a ULocalPlayerSubsystem (WonderlandUiSubsystem.h:81). It is resolved the way
// WonderlandDevDrive.cpp already resolves it: the first EWorldType::Game world (DriveGameWorld,
// WonderlandDevDrive.cpp:66), then that world's first local player (DriveUi, WonderlandDevDrive.cpp:348).
//
// build_sha uses the same source the other QA lines use, WonderlandBeta::BuildLabel()
// (WonderlandBeta.h:43, WonderlandBeta.cpp:66): the release label stamped in BuildInfo/BuildInfo.txt
// ("Private Beta <version> | build <sha> | <date>", Tools/build_beta_rc.ps1). "Development build",
// and any label with no sha token, is unknown, so the field is JSON null and never "".
#include "CoreMinimal.h"

#if !UE_BUILD_SHIPPING

#include "Engine/Engine.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"
#include "Misc/DateTime.h"
#include "WonderlandBeta.h"
#include "WonderlandUiSubsystem.h"

namespace WonderlandWonderWebQaDescribe
{
	void AppendJsonString(FString& Out, const FString& Value)
	{
		Out.AppendChar(TEXT('"'));
		for (int32 Index = 0; Index < Value.Len(); ++Index)
		{
			const TCHAR C = Value[Index];
			switch (C)
			{
			case TEXT('"'): Out += TEXT("\\\""); break;
			case TEXT('\\'): Out += TEXT("\\\\"); break;
			case TEXT('\n'): Out += TEXT("\\n"); break;
			case TEXT('\r'): Out += TEXT("\\r"); break;
			case TEXT('\t'): Out += TEXT("\\t"); break;
			default:
				if (C < 0x20)
				{
					Out += FString::Printf(TEXT("\\u%04x"), static_cast<unsigned int>(C));
				}
				else
				{
					Out.AppendChar(C);
				}
				break;
			}
		}
		Out.AppendChar(TEXT('"'));
	}

	/** Hex token after "build " in the release label. "Development build" has no token. */
	bool ReadBuildSha(FString& OutSha)
	{
		const FString& Label = WonderlandBeta::BuildLabel();
		const TCHAR* Mark = TEXT("build ");
		const int32 MarkLen = 6;
		for (int32 At = 0; At + MarkLen <= Label.Len(); ++At)
		{
			bool bMark = true;
			for (int32 K = 0; K < MarkLen; ++K)
			{
				if (Label[At + K] != Mark[K])
				{
					bMark = false;
					break;
				}
			}
			if (!bMark)
			{
				continue;
			}
			FString Token;
			for (int32 J = At + MarkLen; J < Label.Len(); ++J)
			{
				const TCHAR C = Label[J];
				const bool bHex = (C >= TEXT('0') && C <= TEXT('9'))
					|| (C >= TEXT('a') && C <= TEXT('f'))
					|| (C >= TEXT('A') && C <= TEXT('F'));
				if (!bHex)
				{
					break;
				}
				Token.AppendChar(C);
			}
			if (Token.Len() >= 7 && Token.Len() <= 40)
			{
				OutSha = Token.ToLower();
				return true;
			}
		}
		return false;
	}

	UWorld* FirstGameWorld()
	{
		if (GEngine == nullptr)
		{
			return nullptr;
		}
		for (const FWorldContext& Context : GEngine->GetWorldContexts())
		{
			if (Context.WorldType == EWorldType::Game && Context.World() != nullptr)
			{
				return Context.World();
			}
		}
		return nullptr;
	}

	UWonderlandUiSubsystem* UiFromFirstGameWorld()
	{
		UWorld* World = FirstGameWorld();
		ULocalPlayer* Player = World != nullptr ? World->GetFirstLocalPlayerFromController() : nullptr;
		return Player != nullptr ? Player->GetSubsystem<UWonderlandUiSubsystem>() : nullptr;
	}

	void Emit()
	{
		const FDateTime Now = FDateTime::UtcNow();
		const int64 Ms = static_cast<int64>(Now.ToUnixTimestamp()) * 1000 + static_cast<int64>(Now.GetMillisecond());
		FString Sha;
		const bool bHasSha = ReadBuildSha(Sha);
		const UWonderlandUiSubsystem* Ui = UiFromFirstGameWorld();

		FString Line;
		Line.Reserve(512);
		Line += TEXT("{\"ts_utc_ms\":");
		Line += FString::Printf(TEXT("%lld"), static_cast<long long>(Ms));
		Line += TEXT(",\"event\":\"ww_describe\",\"build_sha\":");
		if (bHasSha)
		{
			AppendJsonString(Line, Sha);
		}
		else
		{
			Line += TEXT("null");
		}
		Line += TEXT(",\"describe\":");
		if (Ui != nullptr)
		{
			AppendJsonString(Line, Ui->DescribeWonderWeb());
		}
		else
		{
			Line += TEXT("null");
		}
		Line += TEXT(",\"workspace\":");
		if (Ui != nullptr)
		{
			AppendJsonString(Line, Ui->DescribeWonderWebWorkspace());
		}
		else
		{
			Line += TEXT("null");
		}
		Line += TEXT("}");
		UE_LOG(LogTemp, Display, TEXT("WLQA_WW_DESCRIBE %s"), *Line);
	}

	FAutoConsoleCommandWithWorldAndArgs GDescribe(
		TEXT("wl.Qa.WonderWeb.Describe"),
		TEXT("QA: print DescribeWonderWeb and DescribeWonderWebWorkspace as one JSON line (WLQA_WW_DESCRIBE). Read-only: does not open, close, or focus a window. Not in shipping builds."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld*)
		{
			Emit();
		}));
}

#endif
