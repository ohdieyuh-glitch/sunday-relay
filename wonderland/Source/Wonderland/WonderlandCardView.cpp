// Copyright Wonderland. The C.A.R.D. section's reading. See WonderlandCardView.h.
#include "WonderlandCardView.h"

#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "WonderlandCardCapabilities.h"
#include "WonderlandCardDirector.h"
#include "WonderlandMissionHandoff.h"
#include "WonderlandRelaySkins.h"
#include "WonderlandSidekicks.h"

int32 FWonderlandCardView::CountCapabilities(EWonderlandCardStatus Status) const
{
	int32 Count = 0;
	for (const FWonderlandCardViewRef& Ref : Capabilities)
	{
		Count += Ref.Status == Status ? 1 : 0;
	}
	return Count;
}

namespace WonderlandCardView
{
	FString FormLabel(const FString& FormId)
	{
		return FormId.Replace(TEXT("_"), TEXT(" ")).ToUpper();
	}

	FWonderlandCardView Build(UWorld* World)
	{
		FWonderlandCardView View;
		UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
		UWonderlandSidekickSubsystem* Sidekicks = Instance != nullptr ? Instance->GetSubsystem<UWonderlandSidekickSubsystem>() : nullptr;
		if (Sidekicks == nullptr)
		{
			View.Unavailable = TEXT("C.A.R.D. is not available in this game");
			return View;
		}
		FWonderlandCardStore& Store = Sidekicks->GetCardStore();
		const FWonderlandCard& Card = Store.GetActive();
		View.bAvailable = true;
		View.ActiveId = Card.Id;
		View.ActiveName = Card.Name;
		View.HandoffForm = FormLabel(Card.MissionHandoff);
		switch (Sidekicks->GetMissionHandoff().GetState())
		{
		case EWonderlandHandoffState::Idle:      View.HandoffState = TEXT("READY"); break;
		case EWonderlandHandoffState::Held:      View.HandoffState = TEXT("HELD"); break;
		case EWonderlandHandoffState::Returning: View.HandoffState = TEXT("RETURNING"); break;
		default:                                 View.HandoffState = TEXT("FORMING"); break;
		}

		View.Skin = Card.Skin;
		if (const UWonderlandRelaySkinSubsystem* Skins = Instance->GetSubsystem<UWonderlandRelaySkinSubsystem>())
		{
			for (const FWonderlandRelaySkin& Skin : Skins->GetSkins())
			{
				if (Skin.SkinId.ToString().Equals(Card.Skin, ESearchCase::IgnoreCase))
				{
					View.Skin = Skin.DisplayName;
					break;
				}
			}
		}
		View.Primary = Card.Primary.bChosen && !Card.Primary.Key.Equals(TEXT("DEFAULT"), ESearchCase::IgnoreCase) ? Card.Primary.Key.ToUpper() : FString(TEXT("AS DESIGNED"));
		View.Colour2 = WonderlandCardDirector::DescribeColour(Card.Secondary);
		View.Colour3 = WonderlandCardDirector::DescribeColour(Card.Strips);
		View.Flame = WonderlandCardDirector::DescribeColour(Card.Flame);
		View.bModified = WonderlandCardDirector::IsModified(World, &View.ModifiedWhat);
		View.Waiting = WonderlandCardDirector::DescribeWaiting();

		const WonderlandCardCapabilities::FReading Reading = WonderlandCardCapabilities::Read(Instance);
		for (int32 Slot = 0; Slot < 2; ++Slot)
		{
			const FWonderlandCompanionRef* Ref = Card.Companions.FindByPredicate([Slot](const FWonderlandCompanionRef& Each) { return Each.Slot == Slot; });
			FWonderlandCompanionRef Use;
			Use.Slot = Slot;
			Use.Kind = Slot == 0 ? EWonderlandCardCompanionKind::Llm : EWonderlandCardCompanionKind::Agent;
			if (Ref != nullptr)
			{
				Use = *Ref;
			}
			const FWonderlandCardRefStatus Status = WonderlandCardCapabilities::ResolveCompanion(Use, Reading);
			FWonderlandCardViewRef& Row = View.Companions.AddDefaulted_GetRef();
			Row.Title = Slot == 0 ? TEXT("LLM COMPANION · LEFT") : TEXT("JHINN · RIGHT");
			Row.Label = Ref == nullptr || Ref->ProviderId.IsEmpty() ? FString(TEXT("none chosen")) : (Ref->Label.IsEmpty() ? Ref->ProviderId : Ref->Label);
			Row.Status = Status.Status;
			Row.Reason = Status.Reason;
			Row.bSimulated = Status.bSimulated;
		}
		for (const FWonderlandCapabilityRef& Ref : Card.Capabilities)
		{
			const FWonderlandCardRefStatus Status = WonderlandCardCapabilities::ResolveCapability(Ref, Reading);
			FWonderlandCardViewRef& Row = View.Capabilities.AddDefaulted_GetRef();
			Row.Title = Ref.Kind == EWonderlandCapabilityKind::Mcp ? TEXT("MCP") : (Ref.Kind == EWonderlandCapabilityKind::Api ? TEXT("API") : TEXT("SKILL"));
			Row.Label = Ref.Label.IsEmpty() ? Ref.Id : Ref.Label;
			Row.Status = Status.Status;
			Row.Reason = Status.Reason;
			Row.bSimulated = Status.bSimulated;
		}
		for (const FWonderlandCard& Each : Store.GetCards())
		{
			FWonderlandCardViewEntry& Entry = View.Cards.AddDefaulted_GetRef();
			Entry.Id = Each.Id;
			Entry.Name = Each.Name;
			Entry.bActive = Each.Id == Store.GetActiveId();
			Entry.bBuiltIn = Each.bBuiltIn;
		}
		return View;
	}
}
