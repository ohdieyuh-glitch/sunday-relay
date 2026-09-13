#include "WonderlandUsagePreview.h"

#include "Engine/GameInstance.h"
#include "Misc/DateTime.h"
#include "WonderlandUsageSubsystem.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandUsagePreview, Log, All);

namespace
{
	FWonderlandFigure Known(double Value)
	{
		FWonderlandFigure Figure;
		Figure.bKnown = true;
		Figure.Value = Value;
		Figure.Reason = EWonderlandUnknownReason::Unobserved;   // the contract's word for "this figure is known"
		return Figure;
	}

	FWonderlandText Text(const FString& Value)
	{
		FWonderlandText Out;
		Out.bKnown = true;
		Out.Value = Value;
		return Out;
	}

	// A PREVIEW METER IS AN ORDINARY METER THAT SAYS IT IS SIMULATED. Capacity equals the
	// reference, so the track is the full swoop, and 100 units of capacity make the remainder
	// read directly as the percentage the preview state asked for.
	FWonderlandUsageMeter PreviewMeter(EWonderlandUsageChannel Channel, float Percent, const TCHAR* TierLabel, const FString& Now)
	{
		const double Capacity = 100.0;
		const double Remaining = FMath::Clamp(static_cast<double>(Percent), 0.0, 100.0);
		FWonderlandUsageMeter Meter;
		Meter.SchemaVersion = WonderlandUsagePreview::AuthorityId;
		Meter.Channel = Channel;
		Meter.TierId = Text(WonderlandUsagePreview::AuthorityId);
		Meter.TierLabel = Text(TierLabel);
		Meter.CapacityUnits = Known(Capacity);
		Meter.UsedUnits = Known(Capacity - Remaining);
		Meter.RemainingUnits = Known(Remaining);
		Meter.ReferenceCapacityUnits = Known(Capacity);
		Meter.CapacitySpan = Known(1.0);
		Meter.FillFraction = Known((Capacity - Remaining) / Capacity);
		Meter.RemainingFraction = Known(Remaining / Capacity);
		Meter.Status = EWonderlandUsageStatus::Available;
		Meter.Provenance = EWonderlandProvenance::Simulated;
		Meter.bSimulated = true;
		Meter.ObservedAtIso = Now;
		return Meter;
	}
}

FWonderlandUsageHud WonderlandUsagePreview::BuildReading(const FWonderlandUsagePreviewState& State)
{
	const FString Now = FDateTime::UtcNow().ToIso8601();
	FWonderlandUsageHud Hud;
	Hud.SchemaVersion = AuthorityId;
	Hud.CompoundAgent = PreviewMeter(EWonderlandUsageChannel::CompoundAgent, State.CompoundAgentPercent, TEXT("DEVELOPMENT PREVIEW"), Now);
	Hud.SingleAgent = PreviewMeter(EWonderlandUsageChannel::SingleAgent, State.SingleAgentPercent, TEXT("DEVELOPMENT PREVIEW"), Now);
	Hud.ObservedAtIso = Now;
	return Hud;
}

bool WonderlandUsagePreview::ApplyIfConfigured(UGameInstance* GameInstance)
{
#if UE_BUILD_SHIPPING
	return false;
#else
	const UWonderlandUsageHudSettings* Settings = GetDefault<UWonderlandUsageHudSettings>();
	UWonderlandUsageSubsystem* Usage = GameInstance != nullptr ? GameInstance->GetSubsystem<UWonderlandUsageSubsystem>() : nullptr;
	if (Settings == nullptr || Usage == nullptr || Settings->UsageSource != EWonderlandUsageSource::DevelopmentPreview)
	{
		return false;
	}
	// NEVER OVER A REAL READING. A subsystem another authority has bound keeps what it holds.
	if (Usage->IsBound() && Usage->GetBoundProjectId() != ProjectId)
	{
		UE_LOG(LogWonderlandUsagePreview, Log, TEXT("WLUSAGE preview skipped: bound to %s"), *Usage->GetBoundProjectId());
		return false;
	}

	Usage->BindProject(ProjectId);
	FWonderlandUsageAuthorityStatus Authority;
	Authority.Reading = EWonderlandUsageReading::Known;
	Authority.AuthorityId = Text(AuthorityId);
	Authority.Reason = Text(TEXT("Julius usage authority is not connected to Wonderland yet."));
	Authority.Revision = Usage->GetAppliedRevision() + 1;
	const EWonderlandOrderingVerdict Verdict = Usage->ApplyUsage(ProjectId, BuildReading(Settings->Preview), Authority);
	UE_LOG(LogWonderlandUsagePreview, Log, TEXT("WLUSAGE development preview applied: compound %.0f%%, single %.0f%% (verdict %d)"),
		Settings->Preview.CompoundAgentPercent, Settings->Preview.SingleAgentPercent, static_cast<int32>(Verdict));
	return Verdict == EWonderlandOrderingVerdict::Applied;
#endif
}
