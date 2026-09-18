#include "WonderlandEntitlements.h"

#include "CoreGlobals.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"
#include "UObject/UObjectIterator.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandEntitlements, Log, All);

namespace WonderlandEntitlementConsole
{
	void Say(const FString& Text, bool bProblem = false)
	{
		UE_LOG(LogWonderlandEntitlements, Display, TEXT("%s"), *Text);
		GAreScreenMessagesEnabled = true;
		if (GEngine != nullptr)
		{
			GEngine->bEnableOnScreenDebugMessages = true;
			GEngine->AddOnScreenDebugMessage(INDEX_NONE, 8.0f, bProblem ? FColor(255, 107, 74) : FColor(255, 212, 0), Text);
		}
	}

	int32 ForEachLive(TFunctionRef<void(UWonderlandEntitlementSubsystem&)> Body)
	{
		int32 Found = 0;
		for (TObjectIterator<UWonderlandEntitlementSubsystem> It; It; ++It)
		{
			if (It->GetWorld() != nullptr && It->GetWorld()->IsGameWorld())
			{
				Body(**It);
				++Found;
			}
		}
		if (Found == 0)
		{
			Say(TEXT("ENTITLEMENTS: nothing to read -- press Play first."), true);
		}
		return Found;
	}

	FAutoConsoleCommand CmdShow(TEXT("wl.Entitlements.Show"), TEXT("What this account may do, and where the figures came from."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachLive([](UWonderlandEntitlementSubsystem& Entitlements)
			{
				Say(FString::Printf(TEXT("ENTITLEMENTS: %s"), *Entitlements.DescribeEntitlements()));
			});
		}));

	FAutoConsoleCommand CmdSetWebs(TEXT("wl.Entitlements.MaxWonderWebs"),
		TEXT("Raise or lower the Wonder Web limit for a proof: `wl.Entitlements.MaxWonderWebs 2`. Marked DEVELOPMENT, never shown as an account's grant."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const int32 Max = Args.Num() > 0 ? FCString::Atoi(*Args[0]) : 6;
			ForEachLive([Max](UWonderlandEntitlementSubsystem& Entitlements)
			{
				Say(Entitlements.SetMaxConcurrentWonderWebsForDevelopment(Max)
					? FString::Printf(TEXT("ENTITLEMENTS: the Wonder Web limit is %d for this session (DEVELOPMENT)."), Max)
					: TEXT("ENTITLEMENTS: refused -- that is not a limit this build will take."), Max <= 0);
			});
		}));
}

FString UWonderlandEntitlementSubsystem::GetSourceLabel() const
{
	switch (Entitlements.Source)
	{
	case EWonderlandEntitlementSource::Account:
		return TEXT("ACCOUNT");
	case EWonderlandEntitlementSource::Development:
		return TEXT("DEVELOPMENT");
	default:
		// SAID PLAINLY: nothing looked this account up. These are the build's free-tier figures.
		return TEXT("BUILT IN");
	}
}

FString UWonderlandEntitlementSubsystem::DescribeEntitlements() const
{
	return FString::Printf(TEXT("tier=%s label=%s source=%s max_wonder_webs=%d"),
		*Entitlements.TierId, *Entitlements.TierLabel, *GetSourceLabel(), Entitlements.MaxConcurrentWonderWebs);
}

bool UWonderlandEntitlementSubsystem::SetMaxConcurrentWonderWebsForDevelopment(int32 Max)
{
#if UE_BUILD_SHIPPING
	// A LIMIT IS NOT A DEVELOPER'S TO MOVE IN A SHIPPED BUILD.
	return false;
#else
	if (Max < 1 || Max > 32)
	{
		return false;
	}
	Entitlements.MaxConcurrentWonderWebs = Max;
	Entitlements.Source = EWonderlandEntitlementSource::Development;
	UE_LOG(LogWonderlandEntitlements, Log, TEXT("WLENTITLE the Wonder Web limit is %d for this session (DEVELOPMENT, not an account's grant)"), Max);
	OnChanged.Broadcast();
	return true;
#endif
}

void UWonderlandEntitlementSubsystem::ApplyFromAccount(const FWonderlandEntitlements& Reported)
{
	Entitlements = Reported;
	Entitlements.Source = EWonderlandEntitlementSource::Account;
	UE_LOG(LogWonderlandEntitlements, Log, TEXT("WLENTITLE an account authority reported tier %s: %d Wonder Webs"), *Entitlements.TierId, Entitlements.MaxConcurrentWonderWebs);
	OnChanged.Broadcast();
}
