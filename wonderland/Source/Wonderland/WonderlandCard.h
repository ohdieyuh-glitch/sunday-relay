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
enum class EWonderlandCardCompanionKind : uint8
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
	EWonderlandCardCompanionKind Kind = EWonderlandCardCompanionKind::Llm;
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

/**
 * ONE MORE COLOUR CHANNEL OF THE LOOK, as a C.A.R.D. keeps it (founder, 10-04 ~01:45Z: "COLOR 1 = body/base, COLOR 2 =
 * secondary/accent/marbling, COLOR 3 = strips/ribbons/tendrils ... through the REAL Project Brain/C.A.R.D. path"): DEFAULT (the
 * skin's designed colour -- bChosen false) or one exact linear colour in 0..1. Written in Cards.sav as "DEFAULT" or "r g b".
 */
struct FWonderlandCardColour
{
	bool bChosen = false;
	FLinearColor Colour = FLinearColor::Black;
	/** True once a save wrote this channel. A card saved before the channel existed leaves the live channel as it is when selected
	 *  (it never recorded one), instead of resetting it to DEFAULT behind the player's back. */
	bool bRecorded = false;
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
	/** COLOR 1: the body/base. */
	FWonderlandCardPrimary Primary;
	/** COLOR 2: the secondary -- the accents (Jack Flame's tie and suit), the status eyes, and Shadow Flame's MARBLING. */
	FWonderlandCardColour Secondary;
	/** COLOR 3: the strips / ribbons / tendrils (Shadow Flame's `strip` surfaces), and nothing else. */
	FWonderlandCardColour Strips;
	/** The flame skins' fire (Jack Flame, Skeleton Flame, Baal): its own channel, DEFAULT = the designed fire. */
	FWonderlandCardColour Flame;
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

	/**
	 * Reads the file. A refused file is set aside (its new path in the load note) and the store starts from the default;
	 * one that cannot be set aside makes the store READ-ONLY for the session, so the original is never overwritten.
	 */
	void Load();
	/**
	 * Writes the whole store, sealed and atomically -- never more than the loader accepts: a store over MaxFileBytes is
	 * refused and the file on disk is kept (Second's M0-1: a file the next boot would set aside loses every card).
	 */
	bool Save() const;
	/** True when a refused file could not be set aside: every change and every save is refused this session. */
	bool IsReadOnly() const { return bReadOnly; }

	const TArray<FWonderlandCard>& GetCards() const { return Cards; }
	const FWonderlandCard* Find(const FString& Id) const;
	/** The active card: always valid (the built-in default when nothing else is). */
	const FWonderlandCard& GetActive() const;
	const FString& GetActiveId() const { return ActiveId; }

	// Every change below is refused, with OutWhy, when the store is read-only or would no longer fit in its file; a refused
	// change leaves the store exactly as it was.
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

	/** A C.A.R.D. colour channel as Cards.sav writes it: "DEFAULT" or "r g b" (4 decimals, linear, 0..1). */
	static FString ColourText(const FWonderlandCardColour& Channel);
	/** "DEFAULT" or exactly three plain numbers in 0..1 -> a RECORDED channel; anything else is refused (false, Out untouched). */
	static bool ParseColourText(const FString& Text, FWonderlandCardColour& Out);

	/** The secret refusal every stored string passes: provider keys, private keys, tokens, credential references. */
	static bool LooksLikeSecret(const FString& Text);
	/** One credential-shaped word the free-text screen found: where it is in the text it was given, and whether it is CERTAIN (a
	 *  vendor key, a 'sk-' key, a JWT-like or PEM line, a URL's user:pass@, or (r7) a value a label names that is a credential by its own
	 *  look: never stored) or keep-able -- STATISTICAL (random-looking) or (r7) a label's WEAK value (a plain or capitalised word, a short
	 *  number): stored as typed only after the player's explicit /keep. */
	struct FSecretFind
	{
		int32 Start = 0;
		int32 Length = 0;
		bool bCertain = false;
		/** r7 (Second's (a)/(b)): a label's weak value -- redacted, /keep gives it back, and a restart's restore never applies it, so a
		 *  pre-r7 contract's prose ("update the password Policy page") is never rewritten. */
		bool bWeak = false;
		/** r7: certain by its OWN shape, whatever stands around it (a key, a PEM block, a URL's user:pass@) -- the only class a restore
		 *  applies to a /keep'd objective, so the player's word survives whatever its neighbours became. */
		bool bShape = false;
	};
	/**
	 * THE FREE-TEXT SCREEN, v2 (the founder's fail-closed; Second's direction and review, 10-03). Every whitespace word is screened:
	 * flagged when it carries a CERTAIN shape, or when ANY random signal fires on a 20+ key-character piece of it -- Second's COMBO B:
	 * 3+ letter/digit pairs; a hex run; 3+ one-letter lowercase runs; letter pairs under 55% common English; no letters. Exempt only
	 * recognised structures: a URL's host (its path and query are still screened), a canonical UUID, an e-mail, a version, an ISO
	 * date/time. Measured on Second's corpus (card_second/core_v2f_vs_comboB.py): >= 99.3% of every random shape of 20+ characters;
	 * 0.24% of 9,714 standard-library identifiers of 20+ and 2 of 23 real objectives flagged -- those are REDACTED and /keep stores
	 * them as typed. A canonical UUID used as a key is NOT caught (by design: indistinguishable from an id).
	 */
	static void FindSecrets(const FString& Text, TArray<FSecretFind>& OutFinds);
	/** The text with each find replaced by "[a key: never shown or stored]" -- every find, or only the CERTAIN ones (bKeepStatistical). */
	static FString RedactSecrets(const FString& Text, const TArray<FSecretFind>& Finds, bool bKeepStatistical = false);
	/** The text without invisible characters (zero-width, bidi, soft hyphen, BOM, tags) and with no length cap. */
	static FString WithoutInvisibleText(const FString& Text);
	/**
	 * THE SCREEN AS EVERY REDACTING CALLER RUNS IT (r6, Second's round-5 review). OutScreened is the text with every space-like character
	 * (TAB, the line breaks, VT/FF, NBSP, the Unicode spaces) a plain space -- never deleted, so cleaning cannot glue a label to its value
	 * -- and every invisible character gone. OutFinds are over OutScreened: its own finds, plus the finds of the same text split AT its
	 * invisibles (a zero-width space between a label and its value), each widened to its whole word there, never into a marker; overlaps
	 * merged. Measured in Python first (CORE r6 model: Second's 66-case corpus 66/66, 0 of 18,000 fuzzed lines change on a second pass).
	 * r7 (Second's static attack on r6, 10-04): the words are matched on a FOLDED view (look-alike, full-width, marked and math letters and
	 * connectors read as the ASCII they are drawn as; blank glyphs split words; variation selectors and CGJ are invisible) -- what is stored
	 * is never folded; and the screen runs to a FIXPOINT: re-screened on what it would store until nothing new is found.
	 */
	static void ScreenText(const FString& Text, FString& OutScreened, TArray<FSecretFind>& OutFinds);
	/** Free text holds a secret: ScreenText finds something in it, or the screen does in it exactly as written. */
	static bool HoldsSecret(const FString& Text);

	/** QA ONLY: rules wl.Qa.SecretInput's planted controls switch off for ONE call, to prove each case needs its rule (0 = every rule on). */
	enum EQaScreenRule : uint32
	{
		QaRuleSpaces = 1u << 0,       // space-like characters kept as spaces (off: deleted as invisible, the d831cbd1 behaviour)
		QaRuleBothViews = 1u << 1,    // the text split at its invisibles screened too
		QaRuleMarkerSplit = 1u << 2,  // the redaction marker its own token; a value glued to it taken
		QaRuleLabelWindow = 1u << 3,  // a label's value found past connectors and qualifiers
		QaRuleLabelForms = 1u << 4,   // plural, possessive, env-style, pin, auth and short labels with a value-like word
		QaRuleUrlPieces = 1u << 5,    // label=value read in every piece of a word (a URL's query), the userinfo up to the first '/'
		QaRuleValueLike = 1u << 6,    // the value-likeness test (off: d831cbd1's 'password-like', which over-redacted)
		QaRuleLoginPair = 1u << 7,    // "login name:value"
		// r7 (Second's r6 attack): each a planted control of wl.Qa.SecretInput SI18-SI25
		QaRuleFold = 1u << 8,         // the folded matching view, blank glyphs as spaces, zero-width marks as invisible, a marker in any case
		QaRuleNounPhrase = 1u << 9,   // "the password for the new staging db box is X": a noun phrase after a preposition
		QaRuleFillers = 1u << 10,     // fillers after a connector, a parenthesised value, a clause-final word after "is", status words stop
		QaRuleContinue = 1u << 11,    // lists, wraps, quoted runs, pass phrases, past a typed marker, every repeat, the fixpoint
		QaRuleCli = 1u << 12,         // CLI credentials, user:X@host with no scheme, X@host, "login bob / X", "Authorization:Bearer X"
		QaRuleLabels = 1u << 13,      // OTP, door/access codes, license keys, a bare key, session ids, numbered/leet labels, other languages
		QaRuleClasses = 1u << 14,     // a label's weak value keep-able and never applied by a restore (off: every label value certain, r6)
		QaRulePem = 1u << 15,         // a PEM block to the end of its END line (off: r6, which stopped at the BEGIN line's own dashes)
		// r8 (Second's attack on r7, 10-04)
		QaRulePerf = 1u << 16,        // linear time: long text in overlapping windows, runs grown not rebuilt, repeats de-duplicated (off: r7)
		QaRuleExpand = 1u << 17,      // the compatibility expansions folded through an index map ("pa<eszett>word", ligatures, digraphs)
		QaRuleWideWindow = 1u << 18,  // a noun phrase of up to ten words after a preposition ("for the brand new shared prod db box is X")
		QaRuleCopulaScan = 1u << 19,  // a label, then "is" / "was" / '=' / ':' and a value-like word within ten words, whatever lies between
		QaRuleEchoPipe = 1u << 20,    // "echo X | docker login --password-stdin", "| chpasswd", "| passwd --stdin", "| sudo -S"
		QaRuleCommonPw = 1u << 21,    // a common weak password after "is" at a clause's end ("the password is secret!"), weak
		QaRuleParticle = 1u << 22,    // a label in another script with its particle, then a space, then the value
		QaRuleNameWeak = 1u << 23,    // a NAME inside the noun phrase held, and taken weak (keep-able) only when no value follows
		// r9 (Second's attack on r8, 10-04)
		QaRuleMarkerAtomic = 1u << 24, // a redaction marker is never cut by a window boundary (off: r8, a split marker re-redacted, nested)
		QaRuleCrossWindow = 1u << 25,  // a certain value found in one window redacted wherever it stands on a long line (off: r8, per window)
		QaRuleHeredoc = 1u << 26,      // a heredoc / here-string feeding a password reader ("cat <<EOF | passwd --stdin", "passwd --stdin <<< X")
	};
	static uint32& QaRulesOff() { static uint32 Off = 0; return Off; }
	/** A line as it may be SHOWN: every word that holds a secret replaced; a line whose secret no single word shows ("Bearer" and its
	 *  token apart) replaced whole. What it returns never holds a secret. */
	static FString MaskForDisplay(const FString& Line);
	/**
	 * A label as it may be stored: control characters (C0, C1) and invisible format characters (zero-width, bidi, soft
	 * hyphen, BOM, tags) stripped, trimmed, capped at MaxLabelChars. Ordinary spaces stay.
	 */
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
	/** The store as the file holds it (condensed JSON). */
	FString Serialised() const;
	/** False, with OutWhy, when the store would be more than the loader accepts. */
	bool FitsInFile(FString& OutWhy) const;
	/** False, with OutWhy, when the store is read-only this session. */
	bool Writable(FString& OutWhy) const;
	/** Sets a refused file aside; when that fails, the store goes read-only. Returns the note. */
	FString Refuse(const FString& Why);

	FString Path;
	TArray<FWonderlandCard> Cards;
	FString ActiveId;
	FString LoadNote;
	bool bReadOnly = false;
};
