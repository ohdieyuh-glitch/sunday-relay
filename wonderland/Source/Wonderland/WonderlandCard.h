// Copyright Wonderland. C.A.R.D. -- the user's customization/loadout layer for their Compound AI Agent ecosystem.
#pragma once

#include "CoreMinimal.h"

class FJsonObject;

/**
 * C.A.R.D. (founder, 2026-10-02: the FIFTH Project Brain component; the name is canonical and never renamed).
 *
 * A C.A.R.D. is a reusable loadout: which Mission Handoff form, which mascot skin / outfit / primary colour, which
 * companions (and the providers behind them), which capabilities (MCP servers, APIs, skills). Switching cards changes
 * the default for the NEXT mission; a running mission keeps the envelope it started with.
 *
 * PLAIN C++ ON PURPOSE. No reflected type, property, config name or USaveGame: a new reflected name shifts the FName
 * table Niagara hashes, which crashed RC1 at boot (WonderlandBeta.h). The store is ONE sealed text file of JSON
 * (WonderlandBeta::SaveSealedText), so a corrupt file is set aside and never crashes a launch.
 *
 * A CARD REFERENCES, IT IS NEVER AN AUTHORITY. The worn skin stays RelaySkin.txt's, the colours stay the colour
 * files', and a card is applied only on an explicit SELECT, through those authorities (WearSkin, PickMascotPrimary,
 * SaveAndApply). At boot the live files win and no card is re-applied.
 *
 * NO SECRET EVER ENTERS IT. Providers and capabilities are typed references by id; credentials stay in the secure
 * credential layer (Julius Connect). Every stored string passes the secret refusal; a key-shaped value is refused, not
 * stored, and never logged.
 */

/** How a companion slot is filled: a typed reference to a provider the runtime knows (never a credential). */
enum class EWonderlandCompanionKind : uint8
{
	Llm,
	Agent,
	CompoundAgent,
	Harness,
};

/** Slot 0 is the LEFT companion (the LLM Companion's side), slot 1 the RIGHT (Jhinn's): the founder's canonical sides. */
struct FWonderlandCompanionRef
{
	int32 Slot = 0;
	EWonderlandCompanionKind Kind = EWonderlandCompanionKind::Llm;
	/** The provider's id as the runtime names it (IsSafeId): dev-companion, dev-single-agent, openai, claude-code ... */
	FString ProviderId;
	/** Shown, never parsed: secret-refused, length-capped, control characters stripped. */
	FString Label;
};

enum class EWonderlandCapabilityKind : uint8
{
	Mcp,
	Api,
	Skill,
};

/** An attached capability, by id: the capability registry resolves it. Never a key, a token or a URL with one. */
struct FWonderlandCapabilityRef
{
	EWonderlandCapabilityKind Kind = EWonderlandCapabilityKind::Skill;
	FString Id;
	FString Label;
};

/** The primary as the wardrobe chooses it: a KEY, not an RGB (B64: DEFAULT is the skin's designed coat, not a colour). */
struct FWonderlandCardPrimary
{
	/** DEFAULT, WHITE, BLACK or a palette key (IsSafeId). */
	FString Key = TEXT("DEFAULT");
	bool bChosen = false;
};

struct FWonderlandCard
{
	FString Id;
	FString Name;
	/** The Mission Handoff form this card hands off with. The first canonical form is the Angelic Twin Swords. */
	FString MissionHandoff = TEXT("angelic_twin_swords");
	FString Skin = TEXT("relay_og");
	/** Empty: the skin's own clothes. */
	FString Outfit;
	FWonderlandCardPrimary Primary;
	TArray<FWonderlandCompanionRef> Companions;
	TArray<FWonderlandCapabilityRef> Capabilities;
	/** Fields a later build added, kept and written back (capped, secret-scanned, never logged). */
	TSharedPtr<FJsonObject> Unknown;
	/** The built-in default card: always present, cannot be deleted. */
	bool bBuiltIn = false;
};

/** What the C.A.R.D. section shows for a reference: resolved, never assumed. */
enum class EWonderlandCardStatus : uint8
{
	Ready,
	Unconfigured,
	Unavailable,
};

class WONDERLAND_API FWonderlandCardStore
{
public:
	/** Saved/Wonderland/Cards.sav. */
	static FString DefaultPath();

	explicit FWonderlandCardStore(const FString& InPath);

	/** Reads the file. A refused file is set aside (its new path in the load note) and the store starts from the default. */
	void Load();
	/** Writes the whole store, sealed and atomically. */
	bool Save() const;

	const TArray<FWonderlandCard>& GetCards() const { return Cards; }
	const FWonderlandCard* Find(const FString& Id) const;
	/** The active card: always valid (the built-in default when nothing else is). */
	const FWonderlandCard& GetActive() const;
	const FString& GetActiveId() const { return ActiveId; }

	/** A new card, copied from the active one with a fresh id and this name. Returns the id, or empty with OutWhy. */
	FString Create(const FString& Name, FString& OutWhy);
	bool Rename(const FString& Id, const FString& Name, FString& OutWhy);
	/** Deleting the active card makes the built-in default active. The built-in card cannot be deleted. */
	bool Delete(const FString& Id, FString& OutWhy);
	/** Makes a card the active one: the NEXT mission's default. Applying its looks is the caller's, through the authorities. */
	bool Select(const FString& Id, FString& OutWhy);
	/** Replaces a card after validating every field; the built-in flag and the id cannot be changed this way. */
	bool Update(const FWonderlandCard& Card, FString& OutWhy);

	/** Empty after a clean load; otherwise what the load set aside or dropped, for the C.A.R.D. section and the QA. */
	const FString& GetLoadNote() const { return LoadNote; }
	const FString& GetPath() const { return Path; }

	/** The secret refusal every stored string passes: provider keys, private keys, tokens, credential references. */
	static bool LooksLikeSecret(const FString& Text);
	/** A label as it may be stored: control characters and newlines stripped, trimmed, capped at MaxLabelChars. */
	static FString CleanLabel(const FString& Text);

	static constexpr int32 MaxCards = 32;
	static constexpr int32 MaxCompanions = 2;
	static constexpr int32 MaxCapabilities = 32;
	static constexpr int32 MaxLabelChars = 64;
	static constexpr int32 MaxUnknownFields = 16;
	static constexpr int32 MaxUnknownBytes = 4 * 1024;
	static constexpr int64 MaxFileBytes = 256 * 1024;
	static const TCHAR* BuiltInId() { return TEXT("default"); }

private:
	void ResetToDefault();
	static FWonderlandCard MakeDefaultCard();
	static TSharedPtr<FJsonObject> ToJson(const FWonderlandCard& Card);
	/** False for a card that can't be kept at all (no safe id); other bad fields fall back, each noted in OutNote. */
	static bool FromJson(const TSharedPtr<FJsonObject>& Json, FWonderlandCard& Out, FString& OutNote);
	bool Validate(FWonderlandCard& Card, FString& OutWhy) const;
	FString NewId() const;

	FString Path;
	TArray<FWonderlandCard> Cards;
	FString ActiveId;
	FString LoadNote;
};
