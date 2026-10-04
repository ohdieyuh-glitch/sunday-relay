// Copyright Wonderland. The C.A.R.D. section's reading: what the store, the resolver and the director say right now.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandCard.h"

class UWorld;

/** One reference as the C.A.R.D. section shows it: what it is, its status, and why -- the resolver's words. */
struct FWonderlandCardViewRef
{
	/** "LLM COMPANION · LEFT", "JHINN · RIGHT", "MCP", "API", "SKILL". */
	FString Title;
	FString Label;
	EWonderlandCardStatus Status = EWonderlandCardStatus::Unavailable;
	FString Reason;
	bool bSimulated = false;
};

struct FWonderlandCardViewEntry
{
	FString Id;
	FString Name;
	bool bActive = false;
	bool bBuiltIn = false;
};

/**
 * READ, NEVER REMEMBERED. The section asks for a fresh reading a few times a second and keeps nothing of its own, so a card
 * selected from the terminal, a skin picked in the wardrobe or a companion connecting shows here without the panel being told.
 * Plain C++ (the FName rule); every string is already the resolver's cleaned text or a store-cleaned label.
 */
struct FWonderlandCardView
{
	bool bAvailable = false;
	FString Unavailable;
	FString ActiveId;
	FString ActiveName;
	/** "ANGELIC TWIN SWORDS". */
	FString HandoffForm;
	/** "READY", "FORMING", "HELD" or "RETURNING". */
	FString HandoffState;
	/** The skin's display name, and the primary as the card holds it ("WHITE", or "AS DESIGNED"). */
	FString Skin;
	FString Primary;
	/** COLOR 2 (accents, the status eyes, Shadow Flame's marbling), COLOR 3 (the strips) and the flame, as the card holds them:
	 *  "NOT SAVED" (never recorded on this card), "AS DESIGNED", a palette name or r,g,b (WonderlandCardDirector::DescribeColour). */
	FString Colour2;
	FString Colour3;
	FString Flame;
	bool bModified = false;
	FString ModifiedWhat;
	/** The director's envelope: which companions wait, and why (a mission running, the runtime offline). */
	FString Waiting;
	/** Exactly two: the LEFT slot (the LLM Companion), then the RIGHT (Jhinn). */
	TArray<FWonderlandCardViewRef> Companions;
	TArray<FWonderlandCardViewRef> Capabilities;
	TArray<FWonderlandCardViewEntry> Cards;

	int32 CountCapabilities(EWonderlandCardStatus Status) const;
};

namespace WonderlandCardView
{
	/** One reading of everything the section shows. */
	WONDERLAND_API FWonderlandCardView Build(UWorld* World);

	/** "ANGELIC TWIN SWORDS" from "angelic_twin_swords". */
	WONDERLAND_API FString FormLabel(const FString& FormId);
}
