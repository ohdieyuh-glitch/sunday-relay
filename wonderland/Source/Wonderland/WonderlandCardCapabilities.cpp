// Copyright Wonderland. C.A.R.D.'s references, resolved. See WonderlandCardCapabilities.h.
#include "WonderlandCardCapabilities.h"

#include "Engine/GameInstance.h"
#include "WonderlandBeta.h"

namespace
{
	constexpr int32 MaxCardReasonChars = 160;

	/** Controls, the C1 block, and the format characters that hide or reorder text (zero widths, bidi, word joiners). */
	bool IsHiddenReasonChar(uint32 Code)
	{
		return Code < 0x20 || Code == 0x7F || (Code >= 0x80 && Code < 0xA0) || Code == 0xAD || (Code >= 0x200B && Code <= 0x200F)
			|| (Code >= 0x2028 && Code <= 0x202E) || (Code >= 0x2060 && Code <= 0x2064) || (Code >= 0x2066 && Code <= 0x2069) || Code == 0xFEFF;
	}

	FWonderlandCardRefStatus MakeRefStatus(EWonderlandCardStatus Status, const FString& Reason, bool bSimulated = false)
	{
		FWonderlandCardRefStatus Out;
		Out.Status = Status;
		Out.Reason = Reason;
		Out.bSimulated = bSimulated;
		return Out;
	}

	/** The runtime's text, made fit to show, or a plain fallback when it said nothing. */
	FString ShownReason(const FString& Text, const FString& Otherwise)
	{
		const FString Clean = WonderlandCardCapabilities::CleanReason(Text);
		return Clean.IsEmpty() ? Otherwise : Clean;
	}

	/** The founder's sides: slot 0 is the LLM Companion (LEFT), slot 1 is Jhinn (RIGHT). */
	const TCHAR* CardSlotName(int32 Slot) { return Slot == 0 ? TEXT("the LLM Companion (LEFT)") : TEXT("Jhinn (RIGHT)"); }
	/** What a provider must back to fill the slot, in the runtime's own words (FWonderlandSidekickProvider::Backs). */
	const TCHAR* CardSlotBacks(int32 Slot) { return Slot == 0 ? TEXT("llm_companion") : TEXT("single_agent"); }
	/** The runtime's id for the companion in the slot (UWonderlandSidekickSubsystem::ByIndex's order). */
	const TCHAR* CardSlotSidekickId(int32 Slot) { return Slot == 0 ? TEXT("llm-companion") : TEXT("jhinn"); }

	/** THE RUNTIME'S FIXTURES are named dev-* (the development companion and single agent): they answer, nothing is real. */
	bool IsFixtureProvider(const FString& ProviderId) { return ProviderId.StartsWith(TEXT("dev-")); }

	const TCHAR* CardLinkWord(bool bConnecting) { return bConnecting ? TEXT("still connecting") : TEXT("offline"); }

	const TCHAR* CardKindWord(EWonderlandCapabilityKind Kind)
	{
		switch (Kind)
		{
		case EWonderlandCapabilityKind::Mcp: return TEXT("MCP");
		case EWonderlandCapabilityKind::Api: return TEXT("API");
		default:                             return TEXT("SKILL");
		}
	}

	const TCHAR* CardKindWord(EWonderlandCardCompanionKind Kind)
	{
		switch (Kind)
		{
		case EWonderlandCardCompanionKind::Llm:           return TEXT("LLM");
		case EWonderlandCardCompanionKind::Agent:         return TEXT("agent");
		case EWonderlandCardCompanionKind::CompoundAgent: return TEXT("compound agent");
		default:                                          return TEXT("harness");
		}
	}
}

namespace WonderlandCardCapabilities
{
	FString CleanReason(const FString& Text)
	{
		// THE WHOLE TEXT IS CHECKED, before any cap: a credential past the 160th character is still a credential
		if (FWonderlandCardStore::LooksLikeSecret(Text))
		{
			return TEXT("(withheld: it looked like a credential)");
		}
		FString Out;
		Out.Reserve(FMath::Min(Text.Len(), MaxCardReasonChars + 1));
		for (int32 Index = 0; Index < Text.Len() && Out.Len() < MaxCardReasonChars; ++Index)
		{
			const uint32 Code = static_cast<uint32>(Text[Index]);
			// a TAG character (U+E0000-E007F, invisible ASCII look-alikes) is a surrogate pair in UTF-16: U+DB40, U+DC00-DC7F
			if (Code == 0xDB40 && Index + 1 < Text.Len())
			{
				const uint32 Low = static_cast<uint32>(Text[Index + 1]);
				if (Low >= 0xDC00 && Low <= 0xDC7F)
				{
					++Index;
					continue;
				}
			}
			if (Code == '\n' || Code == '\r' || Code == '\t')
			{
				// a line break becomes a space, so a reason stays on its one line and its words stay apart
				if (Out.Len() > 0 && Out[Out.Len() - 1] != TEXT(' '))
				{
					Out.AppendChar(TEXT(' '));
				}
				continue;
			}
			if (!IsHiddenReasonChar(Code))
			{
				Out.AppendChar(Text[Index]);
			}
		}
		// never half a character: a surrogate pair cut by the cap loses its first half too
		if (Out.Len() > 0 && static_cast<uint32>(Out[Out.Len() - 1]) >= 0xD800 && static_cast<uint32>(Out[Out.Len() - 1]) <= 0xDBFF)
		{
			Out.LeftChopInline(1);
		}
		Out.TrimStartAndEndInline();
		// and once more on what is left: dropping a hidden character can join two halves of one
		return FWonderlandCardStore::LooksLikeSecret(Out) ? FString(TEXT("(withheld: it looked like a credential)")) : Out;
	}

	FReading Read(const UGameInstance* GameInstance)
	{
		FReading Out;
		if (const UWonderlandSidekickSubsystem* Companions = GameInstance != nullptr ? GameInstance->GetSubsystem<UWonderlandSidekickSubsystem>() : nullptr)
		{
			Out.CompanionLink = Companions->GetLink();
			Out.CompanionProblem = Companions->GetLinkProblem();
			Out.Providers = Companions->GetProviders();
			Out.Sidekicks = Companions->GetSidekicks();
		}
		else
		{
			Out.CompanionProblem = TEXT("this game has no companion runtime client");
		}
		if (const UWonderlandJuliusConnectSubsystem* Connect = GameInstance != nullptr ? GameInstance->GetSubsystem<UWonderlandJuliusConnectSubsystem>() : nullptr)
		{
			Out.ConnectLink = Connect->GetLink();
			Out.ConnectProblem = Connect->GetProblem();
			Out.Services = Connect->GetSurface().Services;
		}
		else
		{
			Out.ConnectProblem = TEXT("this game has no Julius Connect client");
		}
		// THE PRIVATE BETA CALLS NO AI SERVICE: both authorities are off by design, and the reading says so from the first frame. A
		// client that has not ticked yet still reads "connecting" (CR19 on the M6 bed read Julius Connect that way).
		if (!WonderlandBeta::UseLocalAiServices())
		{
			Out.CompanionLink = EWonderlandSidekickLink::Offline;
			Out.CompanionProblem = WonderlandBeta::AiUnavailableSentence();
			Out.ConnectLink = EJuliusConnectLink::Offline;
			Out.ConnectProblem = WonderlandBeta::AiUnavailableSentence();
			Out.Providers.Reset();
			Out.Sidekicks.Reset();
			Out.Services.Reset();
		}
		return Out;
	}

	FWonderlandCardRefStatus ResolveCompanion(const FWonderlandCompanionRef& Ref, const FReading& Reading)
	{
		using S = EWonderlandCardStatus;
		if (Ref.Slot != 0 && Ref.Slot != 1)
		{
			return MakeRefStatus(S::Unavailable, TEXT("a C.A.R.D. has two companion slots: 0 (LEFT) and 1 (RIGHT)"));
		}
		// THE AUTHORITY SEPARATION (locked): Julius is the only compound agent, and mission authority is his alone
		if (Ref.Kind == EWonderlandCardCompanionKind::CompoundAgent)
		{
			return MakeRefStatus(S::Unavailable, TEXT("a compound agent never fills a companion slot: Julius is the only one, and mission authority is his"));
		}
		const bool bWantsConversation = Ref.Kind == EWonderlandCardCompanionKind::Llm;
		if (bWantsConversation != (Ref.Slot == 0))
		{
			return MakeRefStatus(S::Unavailable, FString::Printf(TEXT("slot %d is %s, which needs %s, not %s %s"), Ref.Slot, CardSlotName(Ref.Slot),
				Ref.Slot == 0 ? TEXT("a conversational LLM") : TEXT("a single agent or harness"),
				Ref.Kind == EWonderlandCardCompanionKind::Llm ? TEXT("an") : TEXT("a"), CardKindWord(Ref.Kind)));
		}
		if (Ref.ProviderId.IsEmpty())
		{
			return MakeRefStatus(S::Unconfigured, FString::Printf(TEXT("no provider chosen for %s"), CardSlotName(Ref.Slot)));
		}
		if (Reading.CompanionLink != EWonderlandSidekickLink::Online)
		{
			return MakeRefStatus(S::Unavailable, FString::Printf(TEXT("the companion runtime is %s: %s"),
				CardLinkWord(Reading.CompanionLink == EWonderlandSidekickLink::Connecting), *ShownReason(Reading.CompanionProblem, TEXT("no reason given"))));
		}
		const FWonderlandSidekickProvider* Provider = Reading.Providers.FindByPredicate(
			[&Ref](const FWonderlandSidekickProvider& Each) { return Each.ProviderId == Ref.ProviderId; });
		if (Provider == nullptr)
		{
			return MakeRefStatus(S::Unavailable, FString::Printf(TEXT("this machine's companion runtime offers no provider '%s'"), *Ref.ProviderId));
		}
		const FString Name = ShownReason(Provider->DisplayName, Provider->ProviderId);
		if (Provider->Backs != CardSlotBacks(Ref.Slot))
		{
			return MakeRefStatus(S::Unavailable, FString::Printf(TEXT("%s backs %s, not %s"), *Name, *ShownReason(Provider->Backs, TEXT("nothing")), CardSlotName(Ref.Slot)));
		}
		const bool bFixture = IsFixtureProvider(Provider->ProviderId);

		// CONNECTED IN THAT SLOT NOW: the companion's own state is the truth, and it carries the founder's locks
		// (AUTH_REQUIRED until the account is connected AND live use is allowed)
		const TCHAR* const SidekickId = CardSlotSidekickId(Ref.Slot);
		const FWonderlandSidekick* Live = Reading.Sidekicks.FindByPredicate(
			[SidekickId](const FWonderlandSidekick& Each) { return Each.SidekickId == SidekickId; });
		if (Live != nullptr && Live->ProviderId == Provider->ProviderId)
		{
			const FString& State = Live->State;
			if (State == TEXT("CONNECTED") || State == TEXT("WORKING"))
			{
				return MakeRefStatus(S::Ready, FString::Printf(TEXT("%s, connected to %s%s"), *Name, CardSlotName(Ref.Slot),
					Live->ModelId.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" (%s)"), *ShownReason(Live->ModelId, TEXT("")))), bFixture);
			}
			if (State == TEXT("SIMULATED"))
			{
				return MakeRefStatus(S::Ready, FString::Printf(TEXT("%s, a development fixture: its answers are simulated"), *Name), true);
			}
			if (State == TEXT("AUTH_REQUIRED") || State == TEXT("CONNECTING") || State == TEXT("DISCONNECTED"))
			{
				return MakeRefStatus(S::Unconfigured, FString::Printf(TEXT("%s: %s"), *State, *ShownReason(Live->Note, Name)), bFixture);
			}
			if (State == TEXT("RATE_LIMITED") || State == TEXT("FAILED"))
			{
				return MakeRefStatus(S::Unavailable, FString::Printf(TEXT("%s: %s"), *State, *ShownReason(Live->Failure.IsEmpty() ? Live->Note : Live->Failure, Name)), bFixture);
			}
			return MakeRefStatus(S::Unavailable, FString::Printf(TEXT("the runtime reports '%s' for %s"), *ShownReason(State, TEXT("nothing")), CardSlotName(Ref.Slot)), bFixture);
		}

		// THE SLOT ITSELF WAITS FOR AUTHORISATION (Second's read of M7a): its companion, on whatever provider, is AUTH_REQUIRED -- how
		// the founder's live-use lock shows. A real provider not yet in that slot is never READY then, whatever it reports about
		// itself: connecting it may meet the same lock. A fixture is exempt (it is simulated and needs no authorisation).
		if (!bFixture && Live != nullptr && Live->State == TEXT("AUTH_REQUIRED"))
		{
			return MakeRefStatus(S::Unconfigured, FString::Printf(TEXT("%s reports itself %s on this machine, but %s is waiting for authorisation (%s); it may need the same"),
				*Name, Provider->bReady ? TEXT("ready") : TEXT("not ready"), CardSlotName(Ref.Slot), *ShownReason(Live->Note, TEXT("AUTH_REQUIRED"))));
		}

		// NOT IN THE SLOT YET: what the provider says about itself on this machine (the tool, the account, permission to spend)
		if (Provider->bReady)
		{
			return MakeRefStatus(S::Ready, FString::Printf(TEXT("%s is ready on this machine; not connected to %s yet"), *Name, CardSlotName(Ref.Slot)), bFixture);
		}
		return MakeRefStatus(S::Unconfigured, ShownReason(Provider->Detail, FString::Printf(TEXT("%s is not ready on this machine"), *Name)), bFixture);
	}

	FWonderlandCardRefStatus ResolveCapability(const FWonderlandCapabilityRef& Ref, const FReading& Reading)
	{
		using S = EWonderlandCardStatus;
		if (Ref.Id.IsEmpty())
		{
			return MakeRefStatus(S::Unconfigured, FString::Printf(TEXT("no %s chosen"), CardKindWord(Ref.Kind)));
		}
		// NOTHING TO ASK IS NOT A YES: no skill registry is served to Wonderland, so a skill cannot be checked from here
		if (Ref.Kind == EWonderlandCapabilityKind::Skill)
		{
			return MakeRefStatus(S::Unavailable, TEXT("no skill registry is served to Wonderland yet, so this skill cannot be checked or used from here"));
		}
		if (Reading.ConnectLink != EJuliusConnectLink::Online)
		{
			return MakeRefStatus(S::Unavailable, FString::Printf(TEXT("Julius Connect is %s: %s"), CardLinkWord(Reading.ConnectLink == EJuliusConnectLink::Connecting),
				*ShownReason(Reading.ConnectProblem, TEXT("no reason given"))));
		}
		const FJuliusConnectService* Service = Reading.Services.FindByPredicate(
			[&Ref](const FJuliusConnectService& Each) { return Each.ConnectorId == Ref.Id; });
		if (Service == nullptr)
		{
			return MakeRefStatus(S::Unavailable, FString::Printf(TEXT("Julius Connect lists no connector '%s'"), *Ref.Id));
		}
		const bool bFixture = Service->Kind == TEXT("DEVELOPMENT CONNECTOR");
		const FString Name = ShownReason(Service->DisplayName, Service->ConnectorId);
		const FString StateSaid = ShownReason(Service->StateLabel, Service->State);
		if (!Service->bReachable)
		{
			return MakeRefStatus(S::Unavailable, FString::Printf(TEXT("%s: %s"), *Name, *ShownReason(Service->UnavailableReason, StateSaid)), bFixture);
		}
		const FString& State = Service->State;
		if (State == TEXT("CONNECTED"))
		{
			return MakeRefStatus(S::Ready, FString::Printf(TEXT("%s: %s via %s"), *Name, *StateSaid, *ShownReason(Service->RouteLabel, TEXT("Julius Connect"))), bFixture);
		}
		if (State == TEXT("FAILED") || State == TEXT("RATE_LIMITED") || State == TEXT("UNAVAILABLE"))
		{
			const FString Health = ShownReason(Service->HealthDetail, FString());
			return MakeRefStatus(S::Unavailable, FString::Printf(TEXT("%s: %s%s%s"), *Name, *StateSaid, Health.IsEmpty() ? TEXT("") : TEXT(" - "), *Health), bFixture);
		}
		// A PERSON CAN MAKE IT WORK: authorise, give the credential (to Julius, never here), reconnect
		if (State == TEXT("AUTHORIZATION_REQUIRED") || State == TEXT("CREDENTIAL_REQUIRED") || State == TEXT("CONNECTING")
			|| State == TEXT("RECONNECT_REQUIRED") || State == TEXT("REVOKED") || State == TEXT("EXPIRED") || Service->bAwaitingUser || Service->bCanConnect)
		{
			const FString Step = Service->bCanConnect ? ShownReason(Service->ConnectLabel, FString()) : FString();
			return MakeRefStatus(S::Unconfigured, FString::Printf(TEXT("%s: %s%s%s"), *Name, *StateSaid, Step.IsEmpty() ? TEXT("") : TEXT(" - "), *Step), bFixture);
		}
		return MakeRefStatus(S::Unavailable, FString::Printf(TEXT("%s: Julius Connect reports '%s'"), *Name, *ShownReason(State, TEXT("nothing"))), bFixture);
	}

	const TCHAR* StatusWord(EWonderlandCardStatus Status)
	{
		switch (Status)
		{
		case EWonderlandCardStatus::Ready:        return TEXT("READY");
		case EWonderlandCardStatus::Unconfigured: return TEXT("UNCONFIGURED");
		default:                                  return TEXT("UNAVAILABLE");
		}
	}

	FString Describe(const FWonderlandCardRefStatus& Status)
	{
		FString Out = StatusWord(Status.Status);
		if (Status.bSimulated)
		{
			Out += TEXT(" (SIMULATED)");
		}
		if (!Status.Reason.IsEmpty())
		{
			Out += TEXT(": ");
			Out += Status.Reason;
		}
		return Out;
	}

	TArray<FString> DescribeCard(const FWonderlandCard& Card, const FReading& Reading)
	{
		TArray<FString> Lines;
		Lines.Add(FString::Printf(TEXT("C.A.R.D. %s (%s): Mission Handoff %s, skin %s, outfit %s, primary %s"), *Card.Name, *Card.Id,
			*Card.MissionHandoff, *Card.Skin, Card.Outfit.IsEmpty() ? TEXT("the skin's own") : *Card.Outfit, *Card.Primary.Key));
		for (int32 Slot = 0; Slot < 2; ++Slot)
		{
			const FWonderlandCompanionRef* Ref = Card.Companions.FindByPredicate([Slot](const FWonderlandCompanionRef& Each) { return Each.Slot == Slot; });
			if (Ref == nullptr)
			{
				Lines.Add(FString::Printf(TEXT("  %s: none chosen (the runtime's own)"), CardSlotName(Slot)));
				continue;
			}
			Lines.Add(FString::Printf(TEXT("  %s: %s [%s] %s"), CardSlotName(Slot), Ref->Label.IsEmpty() ? *Ref->ProviderId : *Ref->Label, CardKindWord(Ref->Kind),
				*Describe(ResolveCompanion(*Ref, Reading))));
		}
		if (Card.Capabilities.Num() == 0)
		{
			Lines.Add(TEXT("  capabilities: none attached"));
		}
		for (const FWonderlandCapabilityRef& Ref : Card.Capabilities)
		{
			Lines.Add(FString::Printf(TEXT("  %s %s: %s"), CardKindWord(Ref.Kind), Ref.Label.IsEmpty() ? *Ref.Id : *Ref.Label, *Describe(ResolveCapability(Ref, Reading))));
		}
		return Lines;
	}
}
