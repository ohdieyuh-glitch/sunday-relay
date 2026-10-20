// MP-VIS-02 REV2 (SPECIFICATION, NOT COMPILED): the Mission Handoff on the wire -- the equipped form and the activation EVENT.
//
// Plain C++ (the Niagara FName rule). Everything that leaves this machine about the handoff is one of these closed values; everything that
// arrives is decoded against them. NO mission id, mission state, approval, animation name, asset path, duration or position is ever sent, and the
// receiver derives none from what it is sent: each form's presentation (timings, meshes, effects) is its OWN build's.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandMissionHandoff.h"

namespace WonderlandHandoffWire
{
	/** The Mission Handoff FORM (the persistent "equipped" value). Extension point: a later form is added here AND to the server's WORLD_HANDOFFS, nowhere else on the wire. */
	enum class EForm : uint8
	{
		None,
		TwinSwords,
	};

	inline const TCHAR* ToWire(EForm Form)
	{
		return Form == EForm::TwinSwords ? TEXT("TWIN_SWORDS") : TEXT("NONE");
	}

	/** THE WHITELIST: exactly "TWIN_SWORDS" (case sensitive) is the swords; anything else -- absent, NONE, an unknown or longer string -- is None. */
	inline EForm FromWire(const FString& Wire)
	{
		return Wire.Equals(TEXT("TWIN_SWORDS"), ESearchCase::CaseSensitive) ? EForm::TwinSwords : EForm::None;
	}

	/** The EQUIPPED state others see: from the moment a handoff begins until its return begins -- the same rule as the saved record (FWonderlandMissionHandoff::Persist:
	 *  "written when a handoff begins, cleared the moment the return BEGINS"). A restored HELD is equipped. */
	inline EForm FromLocalState(EWonderlandHandoffState State)
	{
		return State != EWonderlandHandoffState::Idle && State != EWonderlandHandoffState::Returning ? EForm::TwinSwords : EForm::None;
	}

	/** The activation event kinds. Extension point: a new kind is added here AND to the server's WORLD_HANDOFF_KINDS. */
	enum class EKind : uint8
	{
		None,
		Activate,
		Deactivate,
	};

	inline const TCHAR* KindToWire(EKind Kind)
	{
		return Kind == EKind::Activate ? TEXT("ACTIVATE") : (Kind == EKind::Deactivate ? TEXT("DEACTIVATE") : TEXT("NONE"));
	}

	inline EKind KindFromWire(const FString& Wire)
	{
		if (Wire.Equals(TEXT("ACTIVATE"), ESearchCase::CaseSensitive))
		{
			return EKind::Activate;
		}
		return Wire.Equals(TEXT("DEACTIVATE"), ESearchCase::CaseSensitive) ? EKind::Deactivate : EKind::None;
	}

	/** One player's latest activation event as the server returned it: { seq, kind, form, ageMs }. Seq is the SERVER's, per player. */
	struct FWireEvent
	{
		bool bValid = false;
		int32 Seq = 0;
		EKind Kind = EKind::None;
		EForm Form = EForm::None;
		double AgeMs = 0.0;
	};

	/** This client's own event, kept and resent with every world report for ResendSeconds (the server keeps the first copy and ignores the rest). */
	struct FOutgoingEvent
	{
		bool bActive = false;
		int32 N = 0;
		EKind Kind = EKind::None;
		EForm Form = EForm::None;
		double CreatedAt = 0.0;
		double InitialSinceMs = 0.0;
	};
	inline constexpr double ResendSeconds = 8.0;

	/** wl.Handoff.Replicate (default 0 since SC2, 2026-10-20: MP-VIS-02 is deferred past the scored run): 0 sends nothing and draws nothing; 1 turns it on. */
	WONDERLAND_API bool IsReplicationOn();
}
