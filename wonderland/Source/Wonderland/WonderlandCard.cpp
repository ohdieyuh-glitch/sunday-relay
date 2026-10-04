// Copyright Wonderland. C.A.R.D.: the model and its one sealed store. See WonderlandCard.h.
#include "WonderlandCard.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "HAL/FileManager.h"
#include "Misc/Paths.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "WonderlandBeta.h"
#include "WonderlandMissionHandoff.h"

// The provider-key test the sidekick client already trusts (WonderlandSidekicks.cpp): one rule, not two copies of it.
namespace WonderlandSidekickSecrets
{
	bool LooksLikeKey(const FString& Text);
}

namespace
{
	const TCHAR* const FormatTag = TEXT("wonderland.cards.v1");

	const TCHAR* KindName(EWonderlandCardCompanionKind Kind)
	{
		switch (Kind)
		{
		case EWonderlandCardCompanionKind::Agent: return TEXT("agent");
		case EWonderlandCardCompanionKind::CompoundAgent: return TEXT("compound_agent");
		case EWonderlandCardCompanionKind::Harness: return TEXT("harness");
		default: return TEXT("llm");
		}
	}

	bool ParseKind(const FString& Text, EWonderlandCardCompanionKind& Out)
	{
		if (Text == TEXT("llm")) { Out = EWonderlandCardCompanionKind::Llm; return true; }
		if (Text == TEXT("agent")) { Out = EWonderlandCardCompanionKind::Agent; return true; }
		if (Text == TEXT("compound_agent")) { Out = EWonderlandCardCompanionKind::CompoundAgent; return true; }
		if (Text == TEXT("harness")) { Out = EWonderlandCardCompanionKind::Harness; return true; }
		return false;
	}

	const TCHAR* CapabilityName(EWonderlandCapabilityKind Kind)
	{
		switch (Kind)
		{
		case EWonderlandCapabilityKind::Mcp: return TEXT("mcp");
		case EWonderlandCapabilityKind::Api: return TEXT("api");
		default: return TEXT("skill");
		}
	}

	bool ParseCapability(const FString& Text, EWonderlandCapabilityKind& Out)
	{
		if (Text == TEXT("mcp")) { Out = EWonderlandCapabilityKind::Mcp; return true; }
		if (Text == TEXT("api")) { Out = EWonderlandCapabilityKind::Api; return true; }
		if (Text == TEXT("skill")) { Out = EWonderlandCapabilityKind::Skill; return true; }
		return false;
	}

	/** CONDENSED: what is written is what is measured, and a re-save never grows past what the loader accepts. */
	FString Serialise(const TSharedRef<FJsonObject>& Object)
	{
		FString Out;
		const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer =
			TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Out);
		FJsonSerializer::Serialize(Object, Writer);
		return Out;
	}

	/**
	 * A character no label shows: the C0 and C1 controls, and the invisible FORMAT characters (Unicode Cf) that split a key
	 * so that no test sees it while a UI still draws it whole -- the soft hyphen, zero-width spaces and joiners, marks, bidi
	 * controls, word joiners and invisible operators, the BOM, interlinear annotations (Second's M0-3). Ordinary spaces are
	 * NOT among them: a 64-character label with its spaces removed would be refused for nothing.
	 */
	bool IsInvisible(uint32 Code)
	{
		return Code < 0x20 || (Code >= 0x7F && Code <= 0x9F) || Code == 0xAD || (Code >= 0x600 && Code <= 0x605) || Code == 0x61C
			|| Code == 0x6DD || Code == 0x70F || Code == 0x180E || (Code >= 0x200B && Code <= 0x200F) || (Code >= 0x202A && Code <= 0x202E)
			|| (Code >= 0x2060 && Code <= 0x2064) || (Code >= 0x2066 && Code <= 0x206F) || Code == 0xFEFF || (Code >= 0xFFF9 && Code <= 0xFFFB)
			|| (Code >= 0xE0000 && Code <= 0xE007F);
	}

	/** The text without its invisible characters and with NO length cap: what cleaning a label could reassemble. */
	FString WithoutInvisible(const FString& Text)
	{
		FString Out;
		Out.Reserve(Text.Len());
		for (int32 Index = 0; Index < Text.Len(); ++Index)
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
			if (!IsInvisible(Code))
			{
				Out.AppendChar(Text[Index]);
			}
		}
		return Out;
	}

	/** Secret-shaped as written, or once its invisible characters are gone ("sk-\nproj-..." is "sk-proj-..." when cleaned). */
	bool LooksSecretAnyWay(const FString& Text)
	{
		return FWonderlandCardStore::LooksLikeSecret(Text) || FWonderlandCardStore::LooksLikeSecret(WithoutInvisible(Text));
	}

	/** A label as it is stored, or false when it is secret-shaped either way: cleaning must never reassemble a key. */
	bool AcceptLabel(const FString& Raw, FString& OutClean)
	{
		if (LooksSecretAnyWay(Raw) || FWonderlandCardStore::HoldsSecret(Raw))
		{
			return false;
		}
		OutClean = FWonderlandCardStore::CleanLabel(Raw);
		return true;
	}

	/** An id as it may be stored: safe for an FName (WonderlandBeta::IsSafeId) and not secret-shaped -- every stored string
	 * passes the refusal, ids included. */
	bool IsCleanId(const FString& Id)
	{
		return WonderlandBeta::IsSafeId(Id) && !FWonderlandCardStore::LooksLikeSecret(Id) && !FWonderlandCardStore::HoldsSecret(Id);
	}

	/** Deeper than this is a nesting bomb, never a C.A.R.D. file (which nests 5 levels; the rest is a later build's room). */
	constexpr int32 MaxJsonNesting = 32;

	/** How deep the brackets of a JSON text nest, counted outside its strings. */
	int32 JsonNesting(const FString& Text)
	{
		int32 Depth = 0;
		int32 Deepest = 0;
		bool bInString = false;
		bool bEscaped = false;
		for (const TCHAR Char : Text)
		{
			if (bInString)
			{
				if (bEscaped)
				{
					bEscaped = false;
				}
				else if (Char == TEXT('\\'))
				{
					bEscaped = true;
				}
				else if (Char == TEXT('"'))
				{
					bInString = false;
				}
				continue;
			}
			if (Char == TEXT('"'))
			{
				bInString = true;
			}
			else if (Char == TEXT('{') || Char == TEXT('['))
			{
				Deepest = FMath::Max(Deepest, ++Depth);
			}
			else if (Char == TEXT('}') || Char == TEXT(']'))
			{
				--Depth;
			}
		}
		return Deepest;
	}

	/**
	 * Whether a passthrough value holds a secret ANYWHERE: every string value and every object key, at every depth, each
	 * read as itself (Second's M0-2: the serialised shape escapes a newline into two characters, which would hide a key
	 * split by one inside a nested array). Bounded by the nesting cap the loader already enforced.
	 */
	bool JsonHoldsSecret(const TSharedPtr<FJsonValue>& Value, int32 Depth)
	{
		if (!Value.IsValid())
		{
			return false;
		}
		if (Depth > MaxJsonNesting)
		{
			return true;
		}
		switch (Value->Type)
		{
		case EJson::String:
		{
			FString Text;
			return Value->TryGetString(Text) && LooksSecretAnyWay(Text);
		}
		case EJson::Array:
		{
			const TArray<TSharedPtr<FJsonValue>>* Items = nullptr;
			if (Value->TryGetArray(Items) && Items != nullptr)
			{
				for (const TSharedPtr<FJsonValue>& Item : *Items)
				{
					if (JsonHoldsSecret(Item, Depth + 1))
					{
						return true;
					}
				}
			}
			return false;
		}
		case EJson::Object:
		{
			const TSharedPtr<FJsonObject>* Object = nullptr;
			if (Value->TryGetObject(Object) && Object != nullptr && Object->IsValid())
			{
				for (const TPair<FString, TSharedPtr<FJsonValue>>& Field : (*Object)->Values)
				{
					if (LooksSecretAnyWay(Field.Key) || JsonHoldsSecret(Field.Value, Depth + 1))
					{
						return true;
					}
				}
			}
			return false;
		}
		default:
			return false;
		}
	}

	/** DEFAULT is the skin's designed coat, never a colour someone chose (B64): it is stored as not chosen. */
	void NormalisePrimary(FWonderlandCardPrimary& Primary)
	{
		if (Primary.Key.Equals(TEXT("DEFAULT"), ESearchCase::IgnoreCase))
		{
			Primary.Key = TEXT("DEFAULT");
			Primary.bChosen = false;
		}
	}

	/** A key every known field uses: passthrough keeps only names a person could have meant. */
	bool IsKnownField(const FString& Key)
	{
		static const TCHAR* const Known[] = { TEXT("id"), TEXT("name"), TEXT("missionHandoff"), TEXT("skin"), TEXT("outfit"),
			TEXT("primary"), TEXT("companions"), TEXT("capabilities"), TEXT("builtIn") };
		for (const TCHAR* Name : Known)
		{
			if (Key == Name)
			{
				return true;
			}
		}
		return false;
	}
}

FString FWonderlandCardStore::DefaultPath()
{
	return FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Wonderland"), TEXT("Cards.sav"));
}

FWonderlandCardStore::FWonderlandCardStore(const FString& InPath)
	: Path(InPath)
{
	ResetToDefault();
}

namespace
{
	/** The words a credential arrives with. Any case. Shared by the label rule and the prose rule. */
	bool CardHasCredentialWord(const FString& Text)
	{
		static const TCHAR* const CredentialWords[] = { TEXT("-----BEGIN"), TEXT("credentialRef"), TEXT("vault://"), TEXT("Bearer "), TEXT("token="),
			TEXT("access_token"), TEXT("api_key"), TEXT("apikey="), TEXT("password="), TEXT("secret=") };
		for (const TCHAR* Word : CredentialWords)
		{
			if (Text.Contains(Word, ESearchCase::IgnoreCase))
			{
				return true;
			}
		}
		return false;
	}

	bool CardAsciiLetter(TCHAR Char) { return (Char >= TEXT('A') && Char <= TEXT('Z')) || (Char >= TEXT('a') && Char <= TEXT('z')); }
	bool CardAsciiDigit(TCHAR Char) { return Char >= TEXT('0') && Char <= TEXT('9'); }

	/**
	 * KEY PREFIXES, BUILT FROM HALVES AT RUN TIME: the release scan reads the package for exactly these, and a hit there must always
	 * mean a real leak -- so no prefix is written whole in the binary.
	 */
	const TArray<FString>& CardVendorPrefixes()
	{
		static const TArray<FString> Prefixes = {
			FString(TEXT("gh")) + TEXT("p_"), FString(TEXT("gh")) + TEXT("o_"), FString(TEXT("gh")) + TEXT("u_"), FString(TEXT("gh")) + TEXT("s_"),
			FString(TEXT("gh")) + TEXT("r_"), FString(TEXT("github")) + TEXT("_pat_"), FString(TEXT("gl")) + TEXT("pat-"),
			FString(TEXT("xo")) + TEXT("xb-"), FString(TEXT("xo")) + TEXT("xp-"), FString(TEXT("xo")) + TEXT("xa-"), FString(TEXT("xo")) + TEXT("xr-"),
			FString(TEXT("xo")) + TEXT("xs-"), FString(TEXT("sk")) + TEXT("_live_"), FString(TEXT("sk")) + TEXT("_test_"),
			FString(TEXT("rk")) + TEXT("_live_"), FString(TEXT("rk")) + TEXT("_test_"), FString(TEXT("AK")) + TEXT("IA"), FString(TEXT("AS")) + TEXT("IA"),
			FString(TEXT("AI")) + TEXT("za"), FString(TEXT("hf")) + TEXT("_"), FString(TEXT("SG")) + TEXT("."), FString(TEXT("ya")) + TEXT("29."),
			FString(TEXT("np")) + TEXT("m_"), FString(TEXT("py")) + TEXT("pi-"), FString(TEXT("dop")) + TEXT("_v1_"), FString(TEXT("sh")) + TEXT("pat_"),
			FString(TEXT("sh")) + TEXT("pss_"), FString(TEXT("sq0")) + TEXT("atp-"), FString(TEXT("sq0")) + TEXT("csp-") };
		return Prefixes;
	}

	/** A vendor prefix at a token start, followed by 16+ key characters holding letters AND digits ("hf_hub_cache" is a name, not a key). */
	bool CardHasVendorKey(const FString& Text)
	{
		for (const FString& Prefix : CardVendorPrefixes())
		{
			int32 From = 0;
			while (true)
			{
				const int32 At = Text.Find(Prefix, ESearchCase::CaseSensitive, ESearchDir::FromStart, From);
				if (At == INDEX_NONE)
				{
					break;
				}
				const bool bStart = At == 0 || !(FChar::IsAlnum(Text[At - 1]) || Text[At - 1] == TEXT('_'));
				int32 Run = 0;
				bool bLetter = false;
				bool bDigit = false;
				for (int32 Index = At + Prefix.Len(); Index < Text.Len(); ++Index)
				{
					const TCHAR Char = Text[Index];
					if (!(CardAsciiLetter(Char) || CardAsciiDigit(Char) || Char == TEXT('_') || Char == TEXT('-')))
					{
						break;
					}
					++Run;
					bLetter |= CardAsciiLetter(Char);
					bDigit |= CardAsciiDigit(Char);
				}
				if (bStart && Run >= 16 && bLetter && bDigit)
				{
					return true;
				}
				From = At + Prefix.Len();
			}
		}
		return false;
	}

	/** A JWT-like word: 3+ dot-separated parts of 8+ key characters, 40+ long in all, holding letters and digits. */
	bool CardHasDottedToken(const FString& Text)
	{
		TArray<FString> Words;
		Text.ParseIntoArrayWS(Words);
		for (FString Word : Words)
		{
			Word.TrimCharInline(TEXT('.'), nullptr);
			for (const TCHAR Edge : { TEXT(','), TEXT(';'), TEXT(':'), TEXT('('), TEXT(')'), TEXT('['), TEXT(']'), TEXT('"'), TEXT('\'') })
			{
				Word.TrimCharInline(Edge, nullptr);
			}
			TArray<FString> Parts;
			Word.ParseIntoArray(Parts, TEXT("."), false);
			if (Parts.Num() < 3 || Word.Len() < 40)
			{
				continue;
			}
			bool bAll = true;
			bool bLetter = false;
			bool bDigit = false;
			for (const FString& Part : Parts)
			{
				bAll &= Part.Len() >= 8;
				for (int32 At = 0; At < Part.Len(); ++At)
				{
					const TCHAR Char = Part[At];
					bAll &= CardAsciiLetter(Char) || CardAsciiDigit(Char) || Char == TEXT('_') || Char == TEXT('-') || Char == TEXT('+')
						|| Char == TEXT('/') || Char == TEXT('=');
					bLetter |= CardAsciiLetter(Char);
					bDigit |= CardAsciiDigit(Char);
				}
			}
			if (bAll && bLetter && bDigit)
			{
				return true;
			}
		}
		return false;
	}

	bool CardHexChar(TCHAR Char)
	{
		return CardAsciiDigit(Char) || (Char >= TEXT('a') && Char <= TEXT('f')) || (Char >= TEXT('A') && Char <= TEXT('F'));
	}

	/** The key characters a token is made of (base64's + / = and base64url's - _ included: a key is never split on them). */
	bool CardKeyCharacter(TCHAR Char)
	{
		return CardAsciiLetter(Char) || CardAsciiDigit(Char) || Char == TEXT('+') || Char == TEXT('/') || Char == TEXT('=') || Char == TEXT('_')
			|| Char == TEXT('-');
	}

	/** The 195 commonest English letter pairs: 95% of the letter pairs in Python's bundled documentation prose (Second's table, 10-03,
	 *  card_second/common_bigrams_195.txt), as a 26x26 table built on first use. */
	struct FCardPairTable
	{
		bool Common[26][26];
		FCardPairTable()
		{
			FMemory::Memzero(Common);
			const TCHAR* const Pairs = TEXT("ab ac ad ai al am an ap ar as at au av ay ba be bj bl bo bu by ca cc ce ch ci ck cl co cr ct cu de di do ds du ea ec ed ee ef el em en ep eq er es et ev ex ey fa fe fi fo fr fu ge gi gn gu ha he hi ho ia ib ic id ie if ig il im in io ip ir is it iv je ke la ld le lf li ll lo ls lt lu ly ma mb me mi mo mp mu na nc nd ne ng ni nl no ns nt nu ob oc od of ol om on op or os ot ou ov ow pa pe pi pl po pp pr pt py qu ra rd re rg ri rm rn ro rr rs rt ru ry sa sc se sh si so sp ss st su sy ta te th ti to tr ts tt tu ty ua ub uc ue ui ul um un up ur us ut va ve vi wh wi wo xc xe xp yp yt");
			const int32 Count = FCString::Strlen(Pairs);
			for (int32 At = 0; At + 1 < Count; At += 3)
			{
				Common[Pairs[At] - TEXT('a')][Pairs[At + 1] - TEXT('a')] = true;
			}
		}
	};

	bool CardCommonPair(TCHAR A, TCHAR B)
	{
		static const FCardPairTable Table;
		const TCHAR LowA = FChar::ToLower(A);
		const TCHAR LowB = FChar::ToLower(B);
		return LowA >= TEXT('a') && LowA <= TEXT('z') && LowB >= TEXT('a') && LowB <= TEXT('z') && Table.Common[LowA - TEXT('a')][LowB - TEXT('a')];
	}

	bool CardLowerLetter(TCHAR Char)
	{
		return Char >= TEXT('a') && Char <= TEXT('z');
	}

	/**
	 * ANY random signal on one 20+ candidate: Second's COMBO B (10-03), transcribed 1:1 from card_second/secret_rule_signals.py and
	 * secret_rule_v2_measure.py's stats(). Measured on Second's corpus: >= 99.3% of every random shape of 20+ characters (letters-
	 * only 24 the worst), 0.24% of 9,714 standard-library identifiers of 20+, 2 of 23 real objectives; CORE's own v2f lost on both.
	 */
	bool CardCandidateLooksRandom(const FString& Candidate)
	{
		const int32 Count = Candidate.Len();
		if (Count < 20)
		{
			return false;
		}
		// FEW DISTINCT CHARACTERS IS A PATTERN, NOT A KEY (round 4's card C6: ten thousand 'x' as a card's name read as random -- no letter
		// pair is common). Gated on 8 distinct characters, case-folded -- Second's measurement on their corpus: the worst recall over every
		// random shape stays 99.5%, eleven degenerate strings (xxxx, abab, abcabc, Zzzz, Hmmm, 1111, xoxo, lolol...) go from 8 flagged to 0,
		// and a gate of 10 cost recall (95.3%). DIGITS ONLY have ten symbols, so 8 would let 7.4% of random 20-digit keys through (CORE's
		// measurement): those are gated at 6 (0.02%). The certain class (labels with values, vendor keys, JWT, PEM, URL userinfo) is untouched.
		TSet<TCHAR> Distinct;
		bool bAnyLetter = false;
		for (int32 Seen = 0; Seen < Count; ++Seen)
		{
			bAnyLetter |= CardAsciiLetter(Candidate[Seen]);
			if (Distinct.Num() < 8)
			{
				Distinct.Add(FChar::ToLower(Candidate[Seen]));
			}
		}
		if (Distinct.Num() < (bAnyLetter ? 8 : 6))
		{
			return false;
		}
		int32 Letters = 0;
		int32 Digits = 0;
		int32 LetterDigit = 0;
		int32 Pairs = 0;
		int32 CommonPairs = 0;
		int32 OneLowerRuns = 0;
		bool bHexOnly = true;
		for (int32 At = 0; At < Count; ++At)
		{
			const TCHAR Char = Candidate[At];
			const bool bLetter = CardAsciiLetter(Char);
			const bool bDigit = CardAsciiDigit(Char);
			Letters += bLetter ? 1 : 0;
			Digits += bDigit ? 1 : 0;
			bHexOnly &= CardHexChar(Char);
			if (At + 1 < Count)
			{
				const TCHAR Next = Candidate[At + 1];
				LetterDigit += (bLetter && CardAsciiDigit(Next)) || (bDigit && CardAsciiLetter(Next)) ? 1 : 0;
				if (bLetter && CardAsciiLetter(Next))
				{
					++Pairs;
					CommonPairs += CardCommonPair(Char, Next) ? 1 : 0;
				}
			}
			// a lowercase run of exactly one letter, not at the candidate's start or end ("aBcD" -> c)
			if (CardLowerLetter(Char) && At > 0 && At + 1 < Count && !CardLowerLetter(Candidate[At - 1]) && !CardLowerLetter(Candidate[At + 1]))
			{
				++OneLowerRuns;
			}
		}
		return LetterDigit >= 3                                  // letters and digits interleaved
			|| (bHexOnly && Letters > 0 && Digits > 0)           // a hex run
			|| OneLowerRuns >= 3                                 // random mixed case
			|| (Pairs >= 12 && 100 * CommonPairs < 55 * Pairs)   // letter pairs English does not make
			|| Letters == 0;                                     // no letters at all
	}

	/** A word made of 20+ key-character pieces any of which looks random (pieces split at '.' and at every non-key character). */
	bool CardPiecesLookRandom(const FString& Text)
	{
		FString Piece;
		for (int32 At = 0; At <= Text.Len(); ++At)
		{
			const TCHAR Char = At < Text.Len() ? Text[At] : TEXT(' ');
			if (CardKeyCharacter(Char))
			{
				Piece.AppendChar(Char);
				continue;
			}
			if (CardCandidateLooksRandom(Piece))
			{
				return true;
			}
			Piece.Reset();
		}
		return false;
	}

	bool CardAllOf(const FString& Text, int32 From, int32 To, bool (*Test)(TCHAR))
	{
		for (int32 At = From; At < To; ++At)
		{
			if (!Test(Text[At]))
			{
				return false;
			}
		}
		return To > From;
	}

	bool CardDigitChar(TCHAR Char)
	{
		return CardAsciiDigit(Char);
	}

	/** A recognised structure (exempt): a canonical UUID, an e-mail, a version, an ISO date/time. */
	bool CardWordIsStructure(const FString& Word)
	{
		const int32 Count = Word.Len();
		// UUID 8-4-4-4-12
		if (Count == 36 && Word[8] == TEXT('-') && Word[13] == TEXT('-') && Word[18] == TEXT('-') && Word[23] == TEXT('-')
			&& CardAllOf(Word, 0, 8, &CardHexChar) && CardAllOf(Word, 9, 13, &CardHexChar) && CardAllOf(Word, 14, 18, &CardHexChar)
			&& CardAllOf(Word, 19, 23, &CardHexChar) && CardAllOf(Word, 24, 36, &CardHexChar))
		{
			return true;
		}
		// e-mail: one '@', a local part of e-mail characters, a dotted domain ending in 2+ letters
		int32 AtSign = INDEX_NONE;
		if (Word.FindChar(TEXT('@'), AtSign) && AtSign > 0 && Word.Find(TEXT("@"), ESearchCase::CaseSensitive, ESearchDir::FromEnd) == AtSign)
		{
			bool bLocal = true;
			for (int32 At = 0; At < AtSign; ++At)
			{
				const TCHAR Char = Word[At];
				bLocal &= CardAsciiLetter(Char) || CardAsciiDigit(Char) || FCString::Strchr(TEXT("._%+-"), Char) != nullptr;
			}
			const FString Domain = Word.Mid(AtSign + 1);
			int32 LastDot = INDEX_NONE;
			bool bDomain = Domain.FindLastChar(TEXT('.'), LastDot) && LastDot > 0 && Domain.Len() - LastDot - 1 >= 2;
			for (int32 At = 0; bDomain && At < Domain.Len(); ++At)
			{
				const TCHAR Char = Domain[At];
				bDomain &= CardAsciiLetter(Char) || CardAsciiDigit(Char) || Char == TEXT('.') || Char == TEXT('-');
			}
			for (int32 At = LastDot + 1; bDomain && At < Domain.Len(); ++At)
			{
				bDomain &= CardAsciiLetter(Domain[At]);
			}
			if (bLocal && bDomain)
			{
				return true;
			}
		}
		// a version: v?digits(.digits){1,3} then optionally [-+] and version characters
		{
			int32 At = Count > 0 && (Word[0] == TEXT('v') || Word[0] == TEXT('V')) ? 1 : 0;
			int32 Groups = 0;
			bool bOk = true;
			while (At < Count && bOk)
			{
				const int32 Start = At;
				while (At < Count && CardAsciiDigit(Word[At]))
				{
					++At;
				}
				bOk = At > Start;
				++Groups;
				if (At < Count && Word[At] == TEXT('.') && Groups < 4)
				{
					++At;
					continue;
				}
				break;
			}
			if (bOk && Groups >= 2)
			{
				if (At == Count)
				{
					return true;
				}
				if (Word[At] == TEXT('-') || Word[At] == TEXT('+'))
				{
					bool bTail = At + 1 < Count;
					for (int32 Tail = At + 1; bTail && Tail < Count; ++Tail)
					{
						bTail &= CardAsciiLetter(Word[Tail]) || CardAsciiDigit(Word[Tail]) || Word[Tail] == TEXT('.') || Word[Tail] == TEXT('-');
					}
					if (bTail)
					{
						return true;
					}
				}
			}
		}
		// an ISO date, optionally with a time and a zone: dddd-dd-dd[Thh:mm[:ss[.fff]][Z|+hh:mm]]
		if (Count >= 10 && CardAllOf(Word, 0, 4, &CardDigitChar) && Word[4] == TEXT('-') && CardAllOf(Word, 5, 7, &CardDigitChar) && Word[7] == TEXT('-')
			&& CardAllOf(Word, 8, 10, &CardDigitChar))
		{
			if (Count == 10)
			{
				return true;
			}
			if (Word[10] == TEXT('T') || Word[10] == TEXT('t'))
			{
				bool bTime = true;
				for (int32 At = 11; At < Count; ++At)
				{
					bTime &= CardAsciiDigit(Word[At]) || FCString::Strchr(TEXT(":.Z+-z"), Word[At]) != nullptr;
				}
				if (bTime && Count >= 16)
				{
					return true;
				}
			}
		}
		return false;
	}

	/** A URL (scheme://...): the host is exempt; the path and the query, piece by piece and value by value, are screened. */
	bool CardUrlLooksSecret(const FString& Word, bool& bOutUrl)
	{
		bOutUrl = false;
		const int32 Scheme = Word.Find(TEXT("://"));
		if (Scheme <= 0 || !CardAsciiLetter(Word[0]))
		{
			return false;
		}
		for (int32 At = 1; At < Scheme; ++At)
		{
			if (!(CardAsciiLetter(Word[At]) || CardAsciiDigit(Word[At]) || Word[At] == TEXT('+') || Word[At] == TEXT('.') || Word[At] == TEXT('-')))
			{
				return false;
			}
		}
		bOutUrl = true;
		int32 PathStart = Scheme + 3;
		while (PathStart < Word.Len() && FCString::Strchr(TEXT("/?#"), Word[PathStart]) == nullptr)
		{
			++PathStart;
		}
		TArray<FString> Pieces;
		Word.Mid(PathStart).ParseIntoArray(Pieces, TEXT("/"), true);
		TArray<FString> Split;
		for (const FString& Piece : Pieces)
		{
			TArray<FString> Inner;
			Piece.ParseIntoArray(Inner, TEXT("?"), true);
			for (const FString& Part : Inner)
			{
				TArray<FString> Pairs;
				Part.ParseIntoArray(Pairs, TEXT("&"), true);
				for (const FString& Pair : Pairs)
				{
					TArray<FString> Hashes;
					Pair.ParseIntoArray(Hashes, TEXT("#"), true);
					Split.Append(Hashes);
				}
			}
		}
		for (const FString& Piece : Split)
		{
			int32 Eq = INDEX_NONE;
			const FString Value = Piece.FindChar(TEXT('='), Eq) ? Piece.Mid(Eq + 1) : Piece;
			if (CardPiecesLookRandom(Value))
			{
				return true;
			}
		}
		return false;
	}

	/** A CERTAIN word: a credential word, a 'sk-' key, a vendor-prefixed key, a JWT-like dotted word, a PEM line. */
	bool CardWordIsCertain(const FString& Word)
	{
		return CardHasCredentialWord(Word) || WonderlandSidekickSecrets::LooksLikeKey(Word) || CardHasVendorKey(Word) || CardHasDottedToken(Word)
			|| Word.Contains(TEXT("-----"));
	}
}

namespace
{
	/**
	 * A word naming a credential (Second's sink audit and suffix rule, 10-03): its value is the next word when it ends with ':' or '=',
	 * or the word after a lone ':' / '=' / "is". Read on its letters and digits only, lower case -- DB_PASSWORD is "dbpassword",
	 * x-api-key "xapikey", username/password "usernamepassword" -- and matched by its ENDING, so the env-style and compound labels
	 * people actually paste fire; "pass", "pw" and "creds" only whole, so "bypass:" and "compass=" do not. Short passwords are only
	 * catchable by their label -- no statistic sees "Tr0ub4dor&3x".
	 */
	bool CardCredentialLabel(const FString& Lower)
	{
		FString Bare;
		for (int32 At = 0; At < Lower.Len(); ++At)
		{
			const TCHAR Char = FChar::ToLower(Lower[At]);
			if (CardAsciiLetter(Char) || CardAsciiDigit(Char))
			{
				Bare.AppendChar(Char);
			}
		}
		if (Bare.IsEmpty())
		{
			return false;
		}
		static const TCHAR* const Whole[] = { TEXT("pass"), TEXT("pw"), TEXT("creds") };
		for (const TCHAR* Label : Whole)
		{
			if (Bare.Equals(Label, ESearchCase::CaseSensitive))
			{
				return true;
			}
		}
		static const TCHAR* const Endings[] = { TEXT("password"), TEXT("passwd"), TEXT("passphrase"), TEXT("passcode"), TEXT("passkey"), TEXT("pwd"),
			TEXT("secret"), TEXT("token"), TEXT("apikey"), TEXT("accesskey"), TEXT("privatekey"), TEXT("secretkey"), TEXT("clientsecret"),
			TEXT("credential"), TEXT("credentials"), TEXT("authorization") };
		for (const TCHAR* Ending : Endings)
		{
			if (Bare.EndsWith(Ending, ESearchCase::CaseSensitive))
			{
				return true;
			}
		}
		return false;
	}

	/** QA ONLY: a rule wl.Qa.SecretInput's planted control switched off for one call (FWonderlandCardStore::QaRulesOff); every rule on in play. */
	bool CardRuleOn(uint32 Rule)
	{
		return (FWonderlandCardStore::QaRulesOff() & Rule) == 0;
	}

	/** What a redaction leaves in a line: one spelling, so the screen can tell its own marker from a key. */
	const TCHAR* CardRedactionMarker()
	{
		return TEXT("[a key: never shown or stored]");
	}

	/** The scheme word of an Authorization header ("Authorization: Bearer X"): the credential is the word after it. */
	bool CardAuthScheme(const FString& Lower)
	{
		return Lower == TEXT("bearer") || Lower == TEXT("basic") || Lower == TEXT("digest") || Lower == TEXT("token") || Lower == TEXT("negotiate")
			|| Lower == TEXT("ntlm");
	}

	/** A word a person would use as a password: 6+ characters holding a digit or a symbol, or random-looking. "reset", "manager" and
	 *  "sauce" are not -- "password reset", "password manager" and "the secret sauce" stay as typed. */
	bool CardPasswordLike(const FString& Word)
	{
		if (Word.Len() < 6)
		{
			return false;
		}
		bool bDigitOrSymbol = false;
		for (const TCHAR Char : Word)
		{
			bDigitOrSymbol |= !CardAsciiLetter(Char);
		}
		return bDigitOrSymbol || CardPiecesLookRandom(Word);
	}

	/** The first word of a two-word label: "api key", "access key", "private key", "client secret", "secret key", "master key",
	 *  "encryption key", "signing key", "ssh key". */
	bool CardLabelQualifier(const FString& Lower)
	{
		return Lower == TEXT("api") || Lower == TEXT("access") || Lower == TEXT("private") || Lower == TEXT("client") || Lower == TEXT("secret")
			|| Lower == TEXT("master") || Lower == TEXT("encryption") || Lower == TEXT("signing") || Lower == TEXT("ssh");
	}

	/** A label and its value in one word: "pwd=X", "password:X", "api-key=X". */
	bool CardLabelWithValue(const FString& Lower)
	{
		int32 Cut = INDEX_NONE;
		for (int32 At = 0; At < Lower.Len(); ++At)
		{
			if (Lower[At] == TEXT(':') || Lower[At] == TEXT('='))
			{
				Cut = At;
				break;
			}
		}
		return Cut > 0 && Cut + 1 < Lower.Len() && CardCredentialLabel(Lower.Left(Cut));
	}

	/** A URL whose userinfo carries a password: scheme://user:PASS@host... */
	bool CardUrlUserinfoPassword(const FString& Word)
	{
		const int32 Scheme = Word.Find(TEXT("://"));
		if (Scheme <= 0)
		{
			return false;
		}
		// r6: the authority runs to the first '/' -- a '#' or '?' typed INSIDE a password no longer hides the '@' (CORE's r6 measurement:
		// 'scheme://app:<pw>@host' leaked whenever the password held a '#', 24% of Second's probes)
		const TCHAR* const Stops = CardRuleOn(FWonderlandCardStore::QaRuleUrlPieces) ? TEXT("/") : TEXT("/?#");
		int32 End = Scheme + 3;
		while (End < Word.Len() && FCString::Strchr(Stops, Word[End]) == nullptr)
		{
			++End;
		}
		const FString Authority = Word.Mid(Scheme + 3, End - Scheme - 3);
		int32 AtSign = INDEX_NONE;
		if (!Authority.FindLastChar(TEXT('@'), AtSign))
		{
			return false;
		}
		int32 Colon = INDEX_NONE;
		return Authority.Left(AtSign).FindChar(TEXT(':'), Colon) && Colon + 1 < AtSign;
	}

	/** 8+ characters of base64 (A-Z a-z 0-9 + / =): what follows "Basic" in an Authorization header. */
	bool CardBase64Word(const FString& Word)
	{
		if (Word.Len() < 8)
		{
			return false;
		}
		for (int32 At = 0; At < Word.Len(); ++At)
		{
			const TCHAR Char = Word[At];
			if (!(CardAsciiLetter(Char) || CardAsciiDigit(Char) || Char == TEXT('+') || Char == TEXT('/') || Char == TEXT('=')))
			{
				return false;
			}
		}
		return true;
	}

	/* ------------------------------------------------------------------ r6 (Second's round-5 review, 10-03): the label window
	 * Measured in Python before this port (CORE r6 model, scratchpad r6secrets/screen_model.py): Second's 66-case corpus 66/66 (d831cbd1:
	 * 41 fail); a label x connector x value fuzz 0 of 5,100 leak (d831cbd1: 62.6%); prose naming a credential 2 of 65 altered (d831cbd1:
	 * 19); identifiers 23 of 31,974 and real objectives 2 of 23 as before; 0 of 18,000 fuzzed lines change on a second pass. */

	/** A character that SEPARATES words however it was typed: TAB, the line breaks, VT/FF, the information separators, NEL, NBSP, the
	 *  Unicode spaces. Mapped to a plain space before the screen reads a line, never deleted (Second's MAJOR 1: deleted as invisible, they
	 *  glued "password<TAB>X" into one word that no rule saw). */
	bool CardSpaceLike(uint32 Code)
	{
		return (Code >= 0x09 && Code <= 0x0D) || Code == 0x20 || (Code >= 0x1C && Code <= 0x1F) || Code == 0x85 || Code == 0xA0 || Code == 0x1680
			|| Code == 0x180E || (Code >= 0x2000 && Code <= 0x200A) || Code == 0x2028 || Code == 0x2029 || Code == 0x202F || Code == 0x205F
			|| Code == 0x3000;
	}

	/** r7 (Second's r6 attack, 10-04): a glyph drawn BLANK though Unicode calls it something else -- the braille blank, the Hangul fillers --
	 *  separates words as a space does ("password<U+2800>X" was one word no rule read). */
	bool CardBlankGlyph(uint32 Code)
	{
		return Code == 0x2800 || Code == 0x3164 || Code == 0x115F || Code == 0x1160 || Code == 0xFFA0;
	}

	/** r7: a mark that draws nothing between two letters -- the variation selectors, the combining grapheme joiner, the Khmer inherent vowels,
	 *  the Mongolian selectors -- is as invisible to the screen as a zero-width space ("password<U+FE0F>X" was glued). Not IsInvisible: a
	 *  C.A.R.D. label keeps its emoji presentation. */
	bool CardZeroWidthMark(uint32 Code)
	{
		return (Code >= 0xFE00 && Code <= 0xFE0F) || Code == 0x34F || Code == 0x17B4 || Code == 0x17B5 || (Code >= 0x180B && Code <= 0x180F);
	}

	bool CardSplitsWords(TCHAR Char)
	{
		const uint32 Code = static_cast<uint32>(Char);
		return FChar::IsWhitespace(Char) || CardSpaceLike(Code) || (CardRuleOn(FWonderlandCardStore::QaRuleFold) && CardBlankGlyph(Code));
	}

	/** The punctuation a word is trimmed of: ASCII, and the typographic quotes ("password “X”", "password «X»"). */
	bool CardEdge(TCHAR Char)
	{
		return Char != 0 && FCString::Strchr(TEXT(".,;:!?()[]{}<>\"'`“”‘’«»„‚"), Char) != nullptr;
	}

	FString CardTrimEdges(const FString& Text)
	{
		int32 Start = 0;
		int32 End = Text.Len();
		while (Start < End && CardEdge(Text[Start]))
		{
			++Start;
		}
		while (End > Start && CardEdge(Text[End - 1]))
		{
			--End;
		}
		return Text.Mid(Start, End - Start);
	}

	template <SIZE_T N>
	bool CardOneOf(const FString& Word, const TCHAR* const (&List)[N])
	{
		for (const TCHAR* Item : List)
		{
			if (Word.Equals(Item, ESearchCase::CaseSensitive))
			{
				return true;
			}
		}
		return false;
	}

	/** An ASSIGNMENT: the next word is the value whatever it looks like (a stopword excepted: "Secret: the launch ..." is prose). */
	const TCHAR* const CardStrongConnectors[] = { TEXT(":"), TEXT("="), TEXT(":="), TEXT("=>"), TEXT("->"), TEXT("-"), TEXT("–"), TEXT("—") };
	/** Connectors that lead to a value only when it LOOKS like one ("the password is <value>" yes; "my password is too short" no). */
	const TCHAR* const CardWeakConnectors[] = { TEXT("is"), TEXT("was"), TEXT("were"), TEXT("are"), TEXT("equals"), TEXT("to"), TEXT("the"), TEXT("my"),
		TEXT("our"), TEXT("your"), TEXT("a"), TEXT("an"), TEXT("for"), TEXT("of"), TEXT("now"), TEXT("still"), TEXT("be"), TEXT("will"), TEXT("new"),
		TEXT("old") };
	const TCHAR* const CardPrepositions[] = { TEXT("for"), TEXT("of"), TEXT("on"), TEXT("in"), TEXT("at"), TEXT("to") };
	const TCHAR* const CardArticles[] = { TEXT("the"), TEXT("a"), TEXT("an"), TEXT("my"), TEXT("our"), TEXT("your") };
	const TCHAR* const CardStopwords[] = { TEXT("the"), TEXT("a"), TEXT("an"), TEXT("to"), TEXT("we"), TEXT("i"), TEXT("you"), TEXT("it"), TEXT("is"),
		TEXT("are"), TEXT("was"), TEXT("be"), TEXT("and"), TEXT("or"), TEXT("but"), TEXT("not"), TEXT("no"), TEXT("so"), TEXT("too"), TEXT("out"),
		TEXT("in"), TEXT("on"), TEXT("at"), TEXT("of"), TEXT("for"), TEXT("with"), TEXT("by"), TEXT("as"), TEXT("if"), TEXT("then"), TEXT("this"),
		TEXT("that"), TEXT("my"), TEXT("our"), TEXT("your"), TEXT("its"), TEXT("their"), TEXT("all"), TEXT("any"), TEXT("some") };
	/** Days, months and relative days are when, never what ("rotate the api key Monday"). */
	const TCHAR* const CardNotValues[] = { TEXT("monday"), TEXT("tuesday"), TEXT("wednesday"), TEXT("thursday"), TEXT("friday"), TEXT("saturday"),
		TEXT("sunday"), TEXT("january"), TEXT("february"), TEXT("march"), TEXT("april"), TEXT("may"), TEXT("june"), TEXT("july"), TEXT("august"),
		TEXT("september"), TEXT("october"), TEXT("november"), TEXT("december"), TEXT("today"), TEXT("tomorrow"), TEXT("tonight"), TEXT("yesterday") };
	/** Common words the letter-pair test misreads (measured: "weekly", "input", "cookie", "flag" ...). */
	const TCHAR* const CardCommonMisread[] = { TEXT("weekly"), TEXT("input"), TEXT("inputs"), TEXT("cookie"), TEXT("cookies"), TEXT("flag"),
		TEXT("flags"), TEXT("okay"), TEXT("skew"), TEXT("knob"), TEXT("knobs"), TEXT("jwks"), TEXT("oauth"), TEXT("login"), TEXT("logins"), TEXT("signup"),
		TEXT("webhook"), TEXT("webhooks"), TEXT("backup"), TEXT("backups") };
	/** The word before a "name:value" login pair ("login admin:<value>"). */
	const TCHAR* const CardLoginWords[] = { TEXT("login"), TEXT("log-in"), TEXT("logon"), TEXT("signin"), TEXT("sign-in"), TEXT("user"), TEXT("username"),
		TEXT("creds"), TEXT("credentials"), TEXT("account"), TEXT("ssh"), TEXT("auth") };
	/** The last underscore segment of an env-style label (DB_PASS, SMTP_PWD, GH_TOKEN, REDIS_AUTH, STRIPE_KEY). */
	const TCHAR* const CardEnvSegments[] = { TEXT("pass"), TEXT("pw"), TEXT("pwd"), TEXT("passwd"), TEXT("password"), TEXT("secret"), TEXT("token"),
		TEXT("key"), TEXT("apikey"), TEXT("pat"), TEXT("creds"), TEXT("credential"), TEXT("credentials"), TEXT("passphrase"), TEXT("passcode"),
		TEXT("pin"), TEXT("auth") };
	const TCHAR* const CardLabelEndings[] = { TEXT("password"), TEXT("passwd"), TEXT("passphrase"), TEXT("passcode"), TEXT("passkey"), TEXT("pwd"),
		TEXT("secret"), TEXT("token"), TEXT("apikey"), TEXT("accesskey"), TEXT("privatekey"), TEXT("secretkey"), TEXT("clientsecret"),
		TEXT("credential"), TEXT("credentials"), TEXT("authorization") };

	/* ------------------------------------------------------------------ r7 (Second's static attack on r6, 10-04: 50 of 100 new attacks leaked)
	 * Measured in Python before this port (CORE r7 model, m6_core/r7_secrets/r7_screen_model.py, built on Second's own transcription of
	 * r6): Second's 100 attacks 0 leak (r6: 50); Second's 66-case corpus 66/66; CORE's label x connector x value fuzz 0 of 48,960 (r6: 70%)
	 * and CLI/config pastes 0 of 460 (r6: 65%); a STRONG value back after /keep 0 of 36,720; label-colon prose 5 of 40 altered, each undone
	 * by /keep (r6: 30 of 40, for good); ordinary prose 0 of 50; real objectives 2 of 23 and identifiers 23 of 31,974 as before; 0 of
	 * 10,000 + 18,000 fuzzed lines change on a second pass and 0 /keep'd objectives change at a restore. */
	const TCHAR* const CardCopulas[] = { TEXT("is"), TEXT("was"), TEXT("were"), TEXT("are"), TEXT("equals"), TEXT("be") };
	/** Words between a connector and its value that are never the value ("password: now X", "pwd = probably X", "password (it is X)"). */
	const TCHAR* const CardFillers[] = { TEXT("now"), TEXT("it's"), TEXT("it\u2019s"), TEXT("its"), TEXT("it"), TEXT("probably"), TEXT("maybe"),
		TEXT("just"), TEXT("actually"), TEXT("currently"), TEXT("simply"), TEXT("likely"), TEXT("perhaps"), TEXT("definitely"), TEXT("still"),
		TEXT("also"), TEXT("literally"), TEXT("basically"), TEXT("temporarily"), TEXT("again"), TEXT("finally"), TEXT("is"), TEXT("was"),
		TEXT("be"), TEXT("will") };
	/** What a word after "password:" or "the token is" says about its STATE or WHERE it is, never what it is ("password: required", "token:
	 *  expired", "password: see the vault", "secret: don't cache it"): the window stops there. */
	const TCHAR* const CardNonValues[] = { TEXT("required"), TEXT("optional"), TEXT("invalid"), TEXT("valid"), TEXT("expired"), TEXT("missing"),
		TEXT("none"), TEXT("null"), TEXT("nil"), TEXT("empty"), TEXT("blank"), TEXT("tbd"), TEXT("tba"), TEXT("n/a"), TEXT("pending"), TEXT("unknown"),
		TEXT("unset"), TEXT("set"), TEXT("reset"), TEXT("changed"), TEXT("updated"), TEXT("rotated"), TEXT("revoked"), TEXT("hashed"),
		TEXT("encrypted"), TEXT("masked"), TEXT("hidden"), TEXT("redacted"), TEXT("removed"), TEXT("deleted"), TEXT("stored"), TEXT("saved"),
		TEXT("kept"), TEXT("needed"), TEXT("mandatory"), TEXT("wrong"), TEXT("incorrect"), TEXT("correct"), TEXT("weak"), TEXT("strong"),
		TEXT("short"), TEXT("long"), TEXT("secure"), TEXT("insecure"), TEXT("safe"), TEXT("unsafe"), TEXT("broken"), TEXT("fine"), TEXT("ok"),
		TEXT("okay"), TEXT("ready"), TEXT("done"), TEXT("same"), TEXT("different"), TEXT("forgotten"), TEXT("lost"), TEXT("compromised"),
		TEXT("leaked"), TEXT("disabled"), TEXT("enabled"), TEXT("locked"), TEXT("unlocked"), TEXT("see"), TEXT("check"), TEXT("ask"), TEXT("use"),
		TEXT("refer"), TEXT("below"), TEXT("above"), TEXT("attached"), TEXT("provided"), TEXT("default"), TEXT("generated"), TEXT("random"),
		TEXT("temporary"), TEXT("private"), TEXT("public"), TEXT("secret"), TEXT("sensitive"), TEXT("confidential"), TEXT("too"), TEXT("here"),
		TEXT("there"), TEXT("inside"), TEXT("elsewhere"), TEXT("unchanged"), TEXT("don't"), TEXT("dont"), TEXT("don\u2019t"), TEXT("do"),
		TEXT("does"), TEXT("never"), TEXT("should"), TEXT("must"), TEXT("can't"), TEXT("cannot"), TEXT("won't"), TEXT("isn't"), TEXT("not") };
	const TCHAR* const CardClauseJoins[] = { TEXT("and"), TEXT("but"), TEXT("so"), TEXT("or"), TEXT("then"), TEXT("please"), TEXT("thanks"), TEXT("thx") };
	/** The endings of words that describe ("the password is changing"), never name, a value. */
	const TCHAR* const CardProseSuffixes[] = { TEXT("ed"), TEXT("ing"), TEXT("ly"), TEXT("able"), TEXT("ible"), TEXT("ful"), TEXT("less"),
		TEXT("ous"), TEXT("ive") };
	/** The first word of a two-word label r7 adds: "license key", "recovery key", "wifi key", "root secret" ... */
	const TCHAR* const CardQualifiersR7[] = { TEXT("license"), TEXT("licence"), TEXT("product"), TEXT("serial"), TEXT("activation"),
		TEXT("registration"), TEXT("recovery"), TEXT("wifi"), TEXT("backup"), TEXT("deploy"), TEXT("root"), TEXT("admin"), TEXT("session"), TEXT("auth"),
		TEXT("decryption"), TEXT("gpg"), TEXT("pgp"), TEXT("door"), TEXT("access"), TEXT("security"), TEXT("verification"), TEXT("otp"), TEXT("2fa"),
		TEXT("mfa"), TEXT("pin"), TEXT("gate"), TEXT("alarm"), TEXT("safe"), TEXT("lock"), TEXT("entry"), TEXT("garage"), TEXT("sms"), TEXT("login"),
		TEXT("unlock"), TEXT("one-time"), TEXT("master"), TEXT("api") };
	/** The word before "code" that makes it a credential: "door code", "access code", "2fa code" -- never "error code" or "source code". */
	const TCHAR* const CardCodeQualifiers[] = { TEXT("door"), TEXT("access"), TEXT("security"), TEXT("verification"), TEXT("auth"), TEXT("2fa"),
		TEXT("mfa"), TEXT("otp"), TEXT("backup"), TEXT("recovery"), TEXT("pin"), TEXT("gate"), TEXT("alarm"), TEXT("safe"), TEXT("lock"),
		TEXT("entry"), TEXT("garage"), TEXT("wifi"), TEXT("one-time"), TEXT("sms"), TEXT("login"), TEXT("unlock"), TEXT("pass"), TEXT("secret") };
	const TCHAR* const CardPinWords[] = { TEXT("otp"), TEXT("totp"), TEXT("hotp"), TEXT("mfacode"), TEXT("2facode"), TEXT("smscode") };
	const TCHAR* const CardTokenWords[] = { TEXT("sessionid"), TEXT("sessid"), TEXT("sessionkey"), TEXT("sessioncookie") };
	/** The word for password in other languages, its accents folded (Passwort, Kennwort, contrasena, wachtwoord, senha, haslo, sifre ...). */
	const TCHAR* const CardForeignLabels[] = { TEXT("passwort"), TEXT("kennwort"), TEXT("contrasena"), TEXT("clave"), TEXT("senha"),
		TEXT("wachtwoord"), TEXT("losenord"), TEXT("adgangskode"), TEXT("passord"), TEXT("salasana"), TEXT("haslo"), TEXT("sifre"), TEXT("heslo"),
		TEXT("jelszo"), TEXT("parola"), TEXT("motdepasse"), TEXT("mdp"), TEXT("lozinka"), TEXT("geslo"), TEXT("parool"), TEXT("parolis"),
		TEXT("slaptazodis") };
	/** ... and in other scripts, as typed (Russian in three cases, Chinese, Japanese, Korean, Hebrew, Hindi, Thai). */
	const TCHAR* const CardForeignScriptLabels[] = { TEXT("\u043F\u0430\u0440\u043E\u043B\u044C"), TEXT("\u041F\u0430\u0440\u043E\u043B\u044C"),
		TEXT("\u041F\u0410\u0420\u041E\u041B\u042C"), TEXT("\u5BC6\u7801"), TEXT("\u5BC6\u78BC"), TEXT("\u30D1\u30B9\u30EF\u30FC\u30C9"),
		TEXT("\uBE44\uBC00\uBC88\uD638"), TEXT("\uC554\uD638"), TEXT("\u05E1\u05D9\u05E1\u05DE\u05D4"), TEXT("\u092A\u093E\u0938\u0935\u0930\u094D\u0921"),
		TEXT("\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19") };
	/** Labels written with no space before their value ("<password>:X", "<password> is X" in one word), and what may join them -- longest first. */
	const TCHAR* const CardForeignGluedLabels[] = { TEXT("\u5BC6\u7801"), TEXT("\u5BC6\u78BC"), TEXT("\u30D1\u30B9\u30EF\u30FC\u30C9"),
		TEXT("\uBE44\uBC00\uBC88\uD638") };
	const TCHAR* const CardGlueAfter[] = { TEXT("\u306F\u3001"), TEXT(":"), TEXT("="), TEXT("\u662F"), TEXT("\u4E3A"), TEXT("\u70BA"), TEXT("\u306F"),
		TEXT("\uB294"), TEXT("\uC740") };
	/** A password-family label: its clause-final plain word after "is" is taken ("the password is marmalade"); a token's or a key's is not. */
	const TCHAR* const CardPasswordFamily[] = { TEXT("password"), TEXT("passwd"), TEXT("passphrase"), TEXT("passcode"), TEXT("pwd") };
	/** The CLI user flags a "name:value" login pair follows ("curl -u admin:X"). */
	const TCHAR* const CardCliLoginFlags[] = { TEXT("-u"), TEXT("--user"), TEXT("--username"), TEXT("-user"), TEXT("--login") };
	/** A CLI password flag is one only after its own command: "mysql -pX", "sshpass -p X", "docker login -p X", "redis-cli -a X" -- never
	 *  "ssh -p 2222" or "mkdir -p dir". */
	struct FCardCliPassword
	{
		const TCHAR* Command;
		const TCHAR* Flag;
	};
	const FCardCliPassword CardCliPasswords[] = { { TEXT("sshpass"), TEXT("-p") }, { TEXT("mysql"), TEXT("-p") }, { TEXT("mysqldump"), TEXT("-p") },
		{ TEXT("mysqladmin"), TEXT("-p") }, { TEXT("mariadb"), TEXT("-p") }, { TEXT("mariadb-dump"), TEXT("-p") }, { TEXT("login"), TEXT("-p") },
		{ TEXT("redis-cli"), TEXT("-a") } };
	/** "name:value@host" with no scheme is a login unless the name is a scheme of its own ("mailto:bob@example.com"). */
	const TCHAR* const CardNotUserinfo[] = { TEXT("mailto"), TEXT("tel"), TEXT("sip"), TEXT("sips"), TEXT("xmpp"), TEXT("http"), TEXT("https"),
		TEXT("ftp"), TEXT("ssh"), TEXT("file"), TEXT("news"), TEXT("urn"), TEXT("data") };
	const TCHAR* const CardValueSymbols = TEXT("!@#$%^&*+=?~|<>\\;:,\"'`()[]{}");
	const TCHAR* const CardQuoteOpen = TEXT("\"'`\u201C\u2018\u00AB");
	const TCHAR* const CardQuoteClose = TEXT("\"'`\u201D\u2019\u00BB");
	// r8 (QaRuleParticle; Second's r7 leak 7): a label in another script with its particle, the value after a space -- longest first
	const TCHAR* const CardParticles[] = { TEXT("\u306F\u3001"), TEXT("\uB294"), TEXT("\uC740"), TEXT("\uC774"), TEXT("\uAC00"), TEXT("\uB97C"),
		TEXT("\uC744"), TEXT("\u306F"), TEXT("\u304C"), TEXT("\u3092"), TEXT("\u662F"), TEXT("\u4E3A"), TEXT("\u70BA"), TEXT("\uFF1A"), TEXT(":") };
	// r8 (QaRuleCommonPw; Second's r7 leak 6): the commonest weak passwords -- after "is" at a clause's end they ARE the password
	const TCHAR* const CardCommonPasswords[] = { TEXT("secret"), TEXT("password"), TEXT("passw0rd"), TEXT("changeme"), TEXT("letmein"), TEXT("admin"),
		TEXT("default"), TEXT("welcome"), TEXT("qwerty"), TEXT("guest"), TEXT("root"), TEXT("test"), TEXT("pass"), TEXT("master"), TEXT("login"),
		TEXT("iloveyou"), TEXT("monkey"), TEXT("dragon"), TEXT("sunshine"), TEXT("abc123"), TEXT("123456"), TEXT("12345678"), TEXT("111111") };
	// r8 (QaRuleEchoPipe; Second's r7 leak 5): what reads a password from a pipe, and what writes one into it
	const TCHAR* const CardPipeConsumers[] = { TEXT("--password-stdin"), TEXT("--pass-stdin"), TEXT("chpasswd"), TEXT("passwd"), TEXT("--stdin") };
	const TCHAR* const CardEchoWords[] = { TEXT("echo"), TEXT("printf") };
	// r8 (QaRulePerf; Second's r7 (A)): the screen's bounds -- a longer text is read in windows that overlap, a value's continuation stops
	// after so many pieces (and is judged whole only while it could be one value), and so many distinct values go to EVERY OCCURRENCE
	constexpr int32 CardScreenCap = 4096;
	constexpr int32 CardScreenOverlap = 512;
	constexpr int32 CardMaxRun = 64;
	constexpr int32 CardMaxValues = 64;
	constexpr int32 CardMaxWhole = 512;

	/** r8 (QaRuleParticle): a label in another script followed by its particle ("<Korean password>neun", "<Japanese password>wa"). */
	bool CardParticleLabel(const FString& OrigWord)
	{
		const FString Orig = CardTrimEdges(OrigWord);
		for (const TCHAR* Particle : CardParticles)
		{
			const int32 ParticleLen = FCString::Strlen(Particle);
			if (Orig.Len() > ParticleLen && Orig.EndsWith(Particle, ESearchCase::CaseSensitive)
				&& CardOneOf(Orig.LeftChop(ParticleLen), CardForeignScriptLabels))
			{
				return true;
			}
		}
		return false;
	}

	FString CardBare(const FString& Text)
	{
		FString Bare;
		for (const TCHAR Char : Text)
		{
			if (CardAsciiLetter(Char) || CardAsciiDigit(Char))
			{
				Bare.AppendChar(FChar::ToLower(Char));
			}
		}
		return Bare;
	}

	/** What a label word is: Whole (a short word that is a label only with a value: pass, pw, creds, auth), Pin (pin/pincode: 4+ digits),
	 *  Token (a number after it is a quantity: "set token 128000 as the limit"), EnvKey (*_KEY: its value must look like one, or
	 *  "SORT_KEY=name" would go), Normal; r7: Phrase (a pass phrase: its words after the first are taken too). */
	enum class ECardLabelKind : uint8 { None, Whole, Pin, Token, EnvKey, Normal, Phrase };

	/** r7: "p@ssw0rd", "pa$$word", "s3cr3t" read as the letters they stand for. */
	TCHAR CardLeet(TCHAR Char)
	{
		switch (Char)
		{
		case TEXT('@'): case TEXT('4'): return TEXT('a');
		case TEXT('0'): return TEXT('o');
		case TEXT('$'): case TEXT('5'): return TEXT('s');
		case TEXT('3'): return TEXT('e');
		case TEXT('1'): case TEXT('!'): return TEXT('i');
		case TEXT('7'): return TEXT('t');
		case TEXT('|'): return TEXT('l');
		default: return Char;
		}
	}

	/** The kind a label's letters and digits name (r6's rule, read once for every spelling r7 tries). */
	ECardLabelKind CardKindOfBare(const FString& Bare)
	{
		if (Bare.IsEmpty())
		{
			return ECardLabelKind::None;
		}
		if (Bare == TEXT("pin") || Bare == TEXT("pincode"))
		{
			return ECardLabelKind::Pin;
		}
		if (Bare == TEXT("pass") || Bare == TEXT("pw") || Bare == TEXT("creds") || Bare == TEXT("auth"))
		{
			return ECardLabelKind::Whole;
		}
		for (const TCHAR* Ending : CardLabelEndings)
		{
			const bool bPlural = Bare.EndsWith(TEXT("s"), ESearchCase::CaseSensitive) && Bare.LeftChop(1).EndsWith(Ending, ESearchCase::CaseSensitive)
				&& FCString::Strcmp(Ending, TEXT("credentials")) != 0;
			if (Bare.EndsWith(Ending, ESearchCase::CaseSensitive) || bPlural)
			{
				if (FCString::Strcmp(Ending, TEXT("passphrase")) == 0 && CardRuleOn(FWonderlandCardStore::QaRuleContinue))
				{
					return ECardLabelKind::Phrase;
				}
				return FCString::Strcmp(Ending, TEXT("token")) == 0 ? ECardLabelKind::Token : ECardLabelKind::Normal;
			}
		}
		return ECardLabelKind::None;
	}

	/** r7's labels (QaRuleLabels): OTP, a door/access code, a bare "key", a session id, the word in other languages and scripts, a numbered
	 *  label ("password1"), a leet one ("p@ssw0rd"). Lower and Bare are the word's; Orig is it as typed (unfolded). */
	ECardLabelKind CardLabelKindR7(const FString& Lower, const FString& Bare, const FString& OrigWord, const FString& PreviousLower)
	{
		if (CardOneOf(Bare, CardPinWords))
		{
			return ECardLabelKind::Pin;
		}
		if (Bare == TEXT("key"))
		{
			return ECardLabelKind::EnvKey;
		}
		if (Bare == TEXT("code") && CardOneOf(PreviousLower, CardCodeQualifiers))
		{
			return ECardLabelKind::Normal;
		}
		if (CardOneOf(Bare, CardTokenWords))
		{
			return ECardLabelKind::Token;
		}
		if (CardOneOf(Bare, CardForeignLabels))
		{
			return ECardLabelKind::Normal;
		}
		FString Stripped = Lower;
		while (Stripped.Len() > 0 && FCString::Strchr(TEXT("0123456789-=:>|"), Stripped[Stripped.Len() - 1]) != nullptr)
		{
			Stripped.LeftChopInline(1);
		}
		const FString StrippedBare = CardBare(Stripped);
		if (!StrippedBare.Equals(Bare, ESearchCase::CaseSensitive) && StrippedBare.Len() >= 4)
		{
			const ECardLabelKind Numbered = CardKindOfBare(StrippedBare);
			if (Numbered != ECardLabelKind::None)
			{
				return Numbered;
			}
		}
		int32 Letters = 0;
		for (const TCHAR Char : Stripped)
		{
			Letters += CardAsciiLetter(Char) ? 1 : 0;
		}
		if (Letters >= 2)
		{
			FString Leet;
			for (const TCHAR Char : Stripped)
			{
				Leet.AppendChar(CardLeet(Char));
			}
			if (!Leet.Equals(Stripped, ESearchCase::CaseSensitive))
			{
				const ECardLabelKind Spelled = CardKindOfBare(CardBare(Leet));
				if (Spelled != ECardLabelKind::None)
				{
					return Spelled;
				}
			}
		}
		FString Orig = CardTrimEdges(OrigWord);
		while (Orig.Len() > 0 && FCString::Strchr(TEXT("-=:>|"), Orig[Orig.Len() - 1]) != nullptr)
		{
			Orig.LeftChopInline(1);
		}
		if (CardOneOf(Orig, CardForeignScriptLabels))
		{
			return ECardLabelKind::Normal;
		}
		return CardRuleOn(FWonderlandCardStore::QaRuleParticle) && CardParticleLabel(OrigWord) ? ECardLabelKind::Normal : ECardLabelKind::None;
	}

	ECardLabelKind CardLabelKind(const FString& RawWord, const FString& OrigWord = FString(), const FString& PreviousLower = FString())
	{
		const FString Word = CardTrimEdges(RawWord);
		if (!CardRuleOn(FWonderlandCardStore::QaRuleLabelForms))
		{
			// d831cbd1: the label list only
			const FString Lower = Word.ToLower();
			if (!CardCredentialLabel(Lower))
			{
				return ECardLabelKind::None;
			}
			const FString Bare = CardBare(Lower);
			if (Bare == TEXT("pass") || Bare == TEXT("pw") || Bare == TEXT("creds"))
			{
				return ECardLabelKind::Whole;
			}
			return Bare.EndsWith(TEXT("token"), ESearchCase::CaseSensitive) ? ECardLabelKind::Token : ECardLabelKind::Normal;
		}
		FString Lower = Word.ToLower();
		// "password's"
		if (Lower.EndsWith(TEXT("'s"), ESearchCase::CaseSensitive) || Lower.EndsWith(TEXT("’s"), ESearchCase::CaseSensitive))
		{
			Lower.LeftChopInline(2);
		}
		// ENV-STYLE: the last underscore segment names the credential
		int32 Under = INDEX_NONE;
		if (Word.FindLastChar(TEXT('_'), Under))
		{
			const FString Segment = CardBare(Word.Mid(Under + 1));
			if (CardOneOf(Segment, CardEnvSegments))
			{
				return Segment == TEXT("key") ? ECardLabelKind::EnvKey : Segment == TEXT("token") ? ECardLabelKind::Token : ECardLabelKind::Normal;
			}
		}
		const FString Bare = CardBare(Lower);
		const ECardLabelKind Kind = CardKindOfBare(Bare);
		// an empty Bare still reaches r7: a label in another script has no ASCII letters at all
		if (Kind != ECardLabelKind::None || !CardRuleOn(FWonderlandCardStore::QaRuleLabels))
		{
			return Kind;
		}
		return CardLabelKindR7(Lower, Bare, OrigWord, PreviousLower);
	}

	/** A lowercase letters-only part reads as English: short, a common word the pair test misreads, or a vowel and >= 60% of its letter
	 *  pairs among the 195 common ones. */
	bool CardEnglishLike(const FString& Lower)
	{
		if (Lower.Len() <= 3 || CardOneOf(Lower, CardCommonMisread))
		{
			return true;
		}
		bool bVowel = false;
		int32 Pairs = 0;
		int32 Common = 0;
		for (int32 At = 0; At < Lower.Len(); ++At)
		{
			bVowel |= FCString::Strchr(TEXT("aeiouy"), Lower[At]) != nullptr;
			if (At + 1 < Lower.Len())
			{
				++Pairs;
				Common += CardCommonPair(Lower[At], Lower[At + 1]) ? 1 : 0;
			}
		}
		return bVowel && Common * 100 >= 60 * Pairs;
	}

	bool CardIsAlphaWord(const FString& Word)
	{
		if (Word.IsEmpty())
		{
			return false;
		}
		for (const TCHAR Char : Word)
		{
			if (!FChar::IsAlpha(Char))
			{
				return false;
			}
		}
		return true;
	}

	bool CardInnerUpper(const FString& Word)
	{
		for (int32 At = 1; At < Word.Len(); ++At)
		{
			if (FChar::IsUpper(Word[At]))
			{
				return true;
			}
		}
		return false;
	}

	/**
	 * A word that could be the credential a label names. NOT: a structure (date, version, UUID, e-mail), a day or month, a quantity after
	 * "token", a word under 5 characters, ordinary words joined by - _ / . ' ("reset-flow", "refresh_handler", "level-2", "e-mail"), a
	 * word in another script. YES: 4+ digits (after a pin or a password), a certain or random shape, mixed case, a capitalised word
	 * right after a label ("the password Swordfish"), a word no English reads like, digits or symbols in a part, 4+ words joined (a
	 * pass phrase).
	 */
	bool CardValueLikeBase(const FString& Word, ECardLabelKind Kind)
	{
		if (!CardRuleOn(FWonderlandCardStore::QaRuleValueLike))
		{
			// d831cbd1's 'password-like' (6+ characters holding a non-letter, or random), the short labels never: the over-redacting rule
			return Kind != ECardLabelKind::Whole && CardPasswordLike(Word);
		}
		if (Word.IsEmpty() || Word.Contains(CardRedactionMarker()))
		{
			return false;
		}
		if (CardWordIsStructure(Word) || CardOneOf(Word.ToLower(), CardNotValues))
		{
			return false;
		}
		if (CardAllOf(Word, 0, Word.Len(), &CardDigitChar))
		{
			return Kind == ECardLabelKind::Token ? false : Word.Len() >= 4;
		}
		if (Kind == ECardLabelKind::Pin || Word.Len() < 5)
		{
			return false;
		}
		if (CardWordIsCertain(Word) || CardPiecesLookRandom(Word))
		{
			return true;
		}
		if (CardIsAlphaWord(Word))
		{
			if (CardInnerUpper(Word))
			{
				return true;   // CamelCase or random case: a chosen string, not a word
			}
			if (!CardAllOf(Word, 0, Word.Len(), &CardAsciiLetter))
			{
				return false;  // a word in another script ("réunion"): prose
			}
			if (FChar::IsUpper(Word[0]))
			{
				return true;   // capitalised right after a label: a name chosen for it
			}
			return !CardEnglishLike(Word);
		}
		TArray<FString> Parts;
		FString Part;
		for (int32 At = 0; At <= Word.Len(); ++At)
		{
			const TCHAR Char = At < Word.Len() ? Word[At] : TEXT('-');
			if (Char == TEXT('-') || Char == TEXT('_') || Char == TEXT('/') || Char == TEXT('.') || Char == TEXT('\''))
			{
				if (!Part.IsEmpty())
				{
					Parts.Add(Part);
				}
				Part.Reset();
				continue;
			}
			Part.AppendChar(Char);
		}
		for (const FString& Piece : Parts)
		{
			if (CardAllOf(Piece, 0, Piece.Len(), &CardDigitChar) && Piece.Len() <= 3)
			{
				continue;
			}
			if (CardIsAlphaWord(Piece) && (Piece.Len() == 1 || !CardAllOf(Piece, 0, Piece.Len(), &CardAsciiLetter)
				|| (!CardInnerUpper(Piece) && CardEnglishLike(Piece.ToLower()))))
			{
				continue;
			}
			return true;
		}
		return Parts.Num() >= 4;   // a pass phrase of four or more words
	}

	/** r7: two or more capitalised words joined by - _ . ("Correct-Horse-Battery"): a pass phrase, not prose. */
	bool CardCapitalisedJoined(const FString& Word)
	{
		int32 Parts = 0;
		int32 Capitals = 0;
		FString Part;
		for (int32 At = 0; At <= Word.Len(); ++At)
		{
			const TCHAR Char = At < Word.Len() ? Word[At] : TEXT('-');
			if (Char == TEXT('-') || Char == TEXT('_') || Char == TEXT('.'))
			{
				if (!Part.IsEmpty())
				{
					if (!CardAllOf(Part, 0, Part.Len(), &CardAsciiLetter))
					{
						return false;
					}
					++Parts;
					Capitals += FChar::IsUpper(Part[0]) ? 1 : 0;
				}
				Part.Reset();
				continue;
			}
			Part.AppendChar(Char);
		}
		return Parts >= 2 && Capitals >= 2;
	}

	bool CardValueLike(const FString& Word, ECardLabelKind Kind)
	{
		const ECardLabelKind Read = Kind == ECardLabelKind::Phrase ? ECardLabelKind::Normal : Kind;
		return CardValueLikeBase(Word, Read) || (CardRuleOn(FWonderlandCardStore::QaRuleFillers) && CardRuleOn(FWonderlandCardStore::QaRuleValueLike)
			&& !Word.IsEmpty() && CardCapitalisedJoined(Word));
	}

	/** The second word of a two-word label glued to its value: "api key:X", "client secret=X" (the word "key:X" / "secret=X"). */
	bool CardGluedTwoWordValue(const FString& Lower)
	{
		static const TCHAR* const Heads[] = { TEXT("key"), TEXT("secret") };
		for (const TCHAR* Head : Heads)
		{
			if (!Lower.StartsWith(Head, ESearchCase::CaseSensitive))
			{
				continue;
			}
			FString Rest = Lower.Mid(FCString::Strlen(Head));
			if (Rest.IsEmpty() || (Rest[0] != TEXT(':') && Rest[0] != TEXT('=')))
			{
				continue;
			}
			while (Rest.Len() > 0 && (Rest[0] == TEXT(':') || Rest[0] == TEXT('=')))
			{
				Rest.RightChopInline(1);
			}
			if (!CardTrimEdges(Rest).IsEmpty())
			{
				return true;
			}
		}
		return false;
	}

	/** A login pair without a URL, after a login word: "login admin:<value>" -- a plain name, then a value that looks like one. */
	bool CardLoginPair(const FString& Word)
	{
		int32 Colon = INDEX_NONE;
		if (!Word.FindChar(TEXT(':'), Colon) || Word.Find(TEXT(":"), ESearchCase::CaseSensitive, ESearchDir::FromEnd) != Colon)
		{
			return false;
		}
		const FString Name = Word.Left(Colon);
		if (Name.IsEmpty() || Name.Len() > 40)
		{
			return false;
		}
		for (const TCHAR Char : Name)
		{
			if (!(CardAsciiLetter(Char) || CardAsciiDigit(Char) || Char == TEXT('.') || Char == TEXT('_') || Char == TEXT('@') || Char == TEXT('-')))
			{
				return false;
			}
		}
		return CardValueLike(CardTrimEdges(Word.Mid(Colon + 1)), ECardLabelKind::Normal);
	}
}

namespace
{
	/* ------------------------------------------------------------------ r7: the matching view, a value's strength, label=value read whole */

	/** r7: GENERATED from the CORE r7 model (m6_core/r7_secrets/gen_fold_cpp.py), never typed: every BMP character the screen reads as
	 *  one ASCII letter, digit or connector -- marked and compatibility Latin letters, small capitals, the Cyrillic and Greek letters drawn
	 *  like Latin ones, circled and super/subscript forms, the colon/equals/dash/bar/slash look-alikes. Sorted; 819 entries. */
	const uint16 CardFoldFrom[] = {
		0x00AA, 0x00B2, 0x00B3, 0x00B9, 0x00BA, 0x00C0, 0x00C1, 0x00C2, 0x00C3, 0x00C4, 0x00C5, 0x00C7, 0x00C8, 0x00C9, 0x00CA, 0x00CB,
		0x00CC, 0x00CD, 0x00CE, 0x00CF, 0x00D1, 0x00D2, 0x00D3, 0x00D4, 0x00D5, 0x00D6, 0x00D8, 0x00D9, 0x00DA, 0x00DB, 0x00DC, 0x00DD,
		0x00DF, 0x00E0, 0x00E1, 0x00E2, 0x00E3, 0x00E4, 0x00E5, 0x00E7, 0x00E8, 0x00E9, 0x00EA, 0x00EB, 0x00EC, 0x00ED, 0x00EE, 0x00EF,
		0x00F1, 0x00F2, 0x00F3, 0x00F4, 0x00F5, 0x00F6, 0x00F8, 0x00F9, 0x00FA, 0x00FB, 0x00FC, 0x00FD, 0x00FF, 0x0100, 0x0101, 0x0102,
		0x0103, 0x0104, 0x0105, 0x0106, 0x0107, 0x0108, 0x0109, 0x010A, 0x010B, 0x010C, 0x010D, 0x010E, 0x010F, 0x0110, 0x0111, 0x0112,
		0x0113, 0x0114, 0x0115, 0x0116, 0x0117, 0x0118, 0x0119, 0x011A, 0x011B, 0x011C, 0x011D, 0x011E, 0x011F, 0x0120, 0x0121, 0x0122,
		0x0123, 0x0124, 0x0125, 0x0126, 0x0127, 0x0128, 0x0129, 0x012A, 0x012B, 0x012C, 0x012D, 0x012E, 0x012F, 0x0130, 0x0131, 0x0134,
		0x0135, 0x0136, 0x0137, 0x0139, 0x013A, 0x013B, 0x013C, 0x013D, 0x013E, 0x0141, 0x0142, 0x0143, 0x0144, 0x0145, 0x0146, 0x0147,
		0x0148, 0x014C, 0x014D, 0x014E, 0x014F, 0x0150, 0x0151, 0x0154, 0x0155, 0x0156, 0x0157, 0x0158, 0x0159, 0x015A, 0x015B, 0x015C,
		0x015D, 0x015E, 0x015F, 0x0160, 0x0161, 0x0162, 0x0163, 0x0164, 0x0165, 0x0166, 0x0167, 0x0168, 0x0169, 0x016A, 0x016B, 0x016C,
		0x016D, 0x016E, 0x016F, 0x0170, 0x0171, 0x0172, 0x0173, 0x0174, 0x0175, 0x0176, 0x0177, 0x0178, 0x0179, 0x017A, 0x017B, 0x017C,
		0x017D, 0x017E, 0x017F, 0x0180, 0x01A0, 0x01A1, 0x01AF, 0x01B0, 0x01B5, 0x01B6, 0x01C0, 0x01CD, 0x01CE, 0x01CF, 0x01D0, 0x01D1,
		0x01D2, 0x01D3, 0x01D4, 0x01D5, 0x01D6, 0x01D7, 0x01D8, 0x01D9, 0x01DA, 0x01DB, 0x01DC, 0x01DE, 0x01DF, 0x01E0, 0x01E1, 0x01E6,
		0x01E7, 0x01E8, 0x01E9, 0x01EA, 0x01EB, 0x01EC, 0x01ED, 0x01F0, 0x01F4, 0x01F5, 0x01F8, 0x01F9, 0x01FA, 0x01FB, 0x0200, 0x0201,
		0x0202, 0x0203, 0x0204, 0x0205, 0x0206, 0x0207, 0x0208, 0x0209, 0x020A, 0x020B, 0x020C, 0x020D, 0x020E, 0x020F, 0x0210, 0x0211,
		0x0212, 0x0213, 0x0214, 0x0215, 0x0216, 0x0217, 0x0218, 0x0219, 0x021A, 0x021B, 0x021E, 0x021F, 0x0226, 0x0227, 0x0228, 0x0229,
		0x022A, 0x022B, 0x022C, 0x022D, 0x022E, 0x022F, 0x0230, 0x0231, 0x0232, 0x0233, 0x024B, 0x0262, 0x026A, 0x0274, 0x0280, 0x028F,
		0x0299, 0x029C, 0x029F, 0x02B0, 0x02B2, 0x02B3, 0x02B7, 0x02B8, 0x02D0, 0x02E1, 0x02E2, 0x02E3, 0x0391, 0x0392, 0x0395, 0x0396,
		0x0397, 0x0399, 0x039A, 0x039C, 0x039D, 0x039F, 0x03A1, 0x03A4, 0x03A5, 0x03A7, 0x03B1, 0x03B3, 0x03B5, 0x03B9, 0x03BA, 0x03BD,
		0x03BF, 0x03C1, 0x03C5, 0x03C7, 0x0405, 0x0406, 0x0408, 0x0410, 0x0412, 0x0415, 0x041A, 0x041C, 0x041D, 0x041E, 0x0420, 0x0421,
		0x0422, 0x0423, 0x0425, 0x0430, 0x0435, 0x043A, 0x043E, 0x0440, 0x0441, 0x0443, 0x0445, 0x0455, 0x0456, 0x0458, 0x04BA, 0x04BB,
		0x04C0, 0x04CF, 0x0501, 0x051A, 0x051B, 0x051C, 0x051D, 0x0589, 0x05C3, 0x1400, 0x16EC, 0x1D00, 0x1D03, 0x1D04, 0x1D05, 0x1D07,
		0x1D0A, 0x1D0B, 0x1D0D, 0x1D0E, 0x1D0F, 0x1D10, 0x1D18, 0x1D19, 0x1D1A, 0x1D1B, 0x1D1C, 0x1D20, 0x1D21, 0x1D22, 0x1D2C, 0x1D2E,
		0x1D30, 0x1D31, 0x1D33, 0x1D34, 0x1D35, 0x1D36, 0x1D37, 0x1D38, 0x1D39, 0x1D3A, 0x1D3C, 0x1D3E, 0x1D3F, 0x1D40, 0x1D41, 0x1D42,
		0x1D43, 0x1D47, 0x1D48, 0x1D49, 0x1D4D, 0x1D4F, 0x1D50, 0x1D52, 0x1D56, 0x1D57, 0x1D58, 0x1D5B, 0x1D62, 0x1D63, 0x1D64, 0x1D65,
		0x1D9C, 0x1DA0, 0x1DBB, 0x1E00, 0x1E01, 0x1E02, 0x1E03, 0x1E04, 0x1E05, 0x1E06, 0x1E07, 0x1E08, 0x1E09, 0x1E0A, 0x1E0B, 0x1E0C,
		0x1E0D, 0x1E0E, 0x1E0F, 0x1E10, 0x1E11, 0x1E12, 0x1E13, 0x1E14, 0x1E15, 0x1E16, 0x1E17, 0x1E18, 0x1E19, 0x1E1A, 0x1E1B, 0x1E1C,
		0x1E1D, 0x1E1E, 0x1E1F, 0x1E20, 0x1E21, 0x1E22, 0x1E23, 0x1E24, 0x1E25, 0x1E26, 0x1E27, 0x1E28, 0x1E29, 0x1E2A, 0x1E2B, 0x1E2C,
		0x1E2D, 0x1E2E, 0x1E2F, 0x1E30, 0x1E31, 0x1E32, 0x1E33, 0x1E34, 0x1E35, 0x1E36, 0x1E37, 0x1E38, 0x1E39, 0x1E3A, 0x1E3B, 0x1E3C,
		0x1E3D, 0x1E3E, 0x1E3F, 0x1E40, 0x1E41, 0x1E42, 0x1E43, 0x1E44, 0x1E45, 0x1E46, 0x1E47, 0x1E48, 0x1E49, 0x1E4A, 0x1E4B, 0x1E4C,
		0x1E4D, 0x1E4E, 0x1E4F, 0x1E50, 0x1E51, 0x1E52, 0x1E53, 0x1E54, 0x1E55, 0x1E56, 0x1E57, 0x1E58, 0x1E59, 0x1E5A, 0x1E5B, 0x1E5C,
		0x1E5D, 0x1E5E, 0x1E5F, 0x1E60, 0x1E61, 0x1E62, 0x1E63, 0x1E64, 0x1E65, 0x1E66, 0x1E67, 0x1E68, 0x1E69, 0x1E6A, 0x1E6B, 0x1E6C,
		0x1E6D, 0x1E6E, 0x1E6F, 0x1E70, 0x1E71, 0x1E72, 0x1E73, 0x1E74, 0x1E75, 0x1E76, 0x1E77, 0x1E78, 0x1E79, 0x1E7A, 0x1E7B, 0x1E7C,
		0x1E7D, 0x1E7E, 0x1E7F, 0x1E80, 0x1E81, 0x1E82, 0x1E83, 0x1E84, 0x1E85, 0x1E86, 0x1E87, 0x1E88, 0x1E89, 0x1E8A, 0x1E8B, 0x1E8C,
		0x1E8D, 0x1E8E, 0x1E8F, 0x1E90, 0x1E91, 0x1E92, 0x1E93, 0x1E94, 0x1E95, 0x1E96, 0x1E97, 0x1E98, 0x1E99, 0x1EA0, 0x1EA1, 0x1EA2,
		0x1EA3, 0x1EA4, 0x1EA5, 0x1EA6, 0x1EA7, 0x1EA8, 0x1EA9, 0x1EAA, 0x1EAB, 0x1EAC, 0x1EAD, 0x1EAE, 0x1EAF, 0x1EB0, 0x1EB1, 0x1EB2,
		0x1EB3, 0x1EB4, 0x1EB5, 0x1EB6, 0x1EB7, 0x1EB8, 0x1EB9, 0x1EBA, 0x1EBB, 0x1EBC, 0x1EBD, 0x1EBE, 0x1EBF, 0x1EC0, 0x1EC1, 0x1EC2,
		0x1EC3, 0x1EC4, 0x1EC5, 0x1EC6, 0x1EC7, 0x1EC8, 0x1EC9, 0x1ECA, 0x1ECB, 0x1ECC, 0x1ECD, 0x1ECE, 0x1ECF, 0x1ED0, 0x1ED1, 0x1ED2,
		0x1ED3, 0x1ED4, 0x1ED5, 0x1ED6, 0x1ED7, 0x1ED8, 0x1ED9, 0x1EDA, 0x1EDB, 0x1EDC, 0x1EDD, 0x1EDE, 0x1EDF, 0x1EE0, 0x1EE1, 0x1EE2,
		0x1EE3, 0x1EE4, 0x1EE5, 0x1EE6, 0x1EE7, 0x1EE8, 0x1EE9, 0x1EEA, 0x1EEB, 0x1EEC, 0x1EED, 0x1EEE, 0x1EEF, 0x1EF0, 0x1EF1, 0x1EF2,
		0x1EF3, 0x1EF4, 0x1EF5, 0x1EF6, 0x1EF7, 0x1EF8, 0x1EF9, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2024, 0x2044, 0x2070,
		0x2071, 0x2074, 0x2075, 0x2076, 0x2077, 0x2078, 0x2079, 0x207C, 0x207F, 0x2080, 0x2081, 0x2082, 0x2083, 0x2084, 0x2085, 0x2086,
		0x2087, 0x2088, 0x2089, 0x208C, 0x2090, 0x2091, 0x2092, 0x2093, 0x2095, 0x2096, 0x2097, 0x2098, 0x2099, 0x209A, 0x209B, 0x209C,
		0x2102, 0x210A, 0x210B, 0x210C, 0x210D, 0x210E, 0x2110, 0x2111, 0x2112, 0x2113, 0x2115, 0x2119, 0x211A, 0x211B, 0x211C, 0x211D,
		0x2124, 0x2128, 0x212A, 0x212C, 0x212D, 0x212F, 0x2130, 0x2131, 0x2133, 0x2134, 0x2139, 0x2145, 0x2146, 0x2147, 0x2148, 0x2149,
		0x2160, 0x2164, 0x2169, 0x216C, 0x216D, 0x216E, 0x216F, 0x2170, 0x2174, 0x2179, 0x217C, 0x217D, 0x217E, 0x217F, 0x2212, 0x2215,
		0x2223, 0x2236, 0x2460, 0x2461, 0x2462, 0x2463, 0x2464, 0x2465, 0x2466, 0x2467, 0x2468, 0x24B6, 0x24B7, 0x24B8, 0x24B9, 0x24BA,
		0x24BB, 0x24BC, 0x24BD, 0x24BE, 0x24BF, 0x24C0, 0x24C1, 0x24C2, 0x24C3, 0x24C4, 0x24C5, 0x24C6, 0x24C7, 0x24C8, 0x24C9, 0x24CA,
		0x24CB, 0x24CC, 0x24CD, 0x24CE, 0x24CF, 0x24D0, 0x24D1, 0x24D2, 0x24D3, 0x24D4, 0x24D5, 0x24D6, 0x24D7, 0x24D8, 0x24D9, 0x24DA,
		0x24DB, 0x24DC, 0x24DD, 0x24DE, 0x24DF, 0x24E0, 0x24E1, 0x24E2, 0x24E3, 0x24E4, 0x24E5, 0x24E6, 0x24E7, 0x24E8, 0x24E9, 0x24EA,
		0x2C7C, 0x2C7D, 0xA731, 0xA789, 0xA78A, 0xA7F2, 0xA7F3, 0xA7F4, 0xFE13, 0xFE33, 0xFE34, 0xFE4D, 0xFE4E, 0xFE4F, 0xFE52, 0xFE55,
		0xFE63, 0xFE66, 0xFE6B
	};
	const ANSICHAR CardFoldTo[] =
		"a231oAAAAAACEEEEIIIINOOOOOOUUUUYsaaaaaaceeeeiiiinoooooouuuuyyAaAaAaCcCcCcCcDdDdEeEeEeEeEeGgGgGgG"
		"gHhHhIiIiIiIiIiJjKkLlLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtTtUuUuUuUuUuUuWwYyYZzZzZzsbOoUuZz|AaIiO"
		"oUuUuUuUuUuAaAaGgKkOoOojGgNnAaAaAaEeEeIiIiOoOoRrRrUuUuSsTtHhAaEeOoOoOoOoYyqginrybhlhjrwy:lsxABEZ"
		"HIKMNOPTYXayeikvopuxSIJABEKMHOPCTYXaekopcyxsijHhIldQqWw::=:abcdejkmnooprrtuvwzABDEGHIJKLMNOPRTUW"
		"abdegkmoptuviruvcfzAaBbBbBbCcDdDdDdDdDdEeEeEeEeEeFfGgHhHhHhHhHhIiIiKkKkKkLlLlLlLlMmMmMmNnNnNnNnO"
		"oOoOoOoPpPpRrRrRrRrSsSsSsSsSsTtTtTtTtUuUuUuUuUuVvVvWwWwWwWwWwXxXxYyZzZzZzhtwyAaAaAaAaAaAaAaAaAaA"
		"aAaAaEeEeEeEeEeEeEeEeIiIiOoOoOoOoOoOoOoOoOoOoOoOoUuUuUuUuUuUuUuYyYyYyYy------./0i456789=n0123456"
		"789=aeoxhklmnpstCgHHHhIILlNPQRRRZZKBCeEFMoiDdeijIVXLCDMivxlcdm-/|:123456789ABCDEFGHIJKLMNOPQRSTU"
		"VWXYZabcdefghijklmnopqrstuvwxyz0jVs:=CFQ:_____.:-=@";
	static_assert(UE_ARRAY_COUNT(CardFoldFrom) + 1 == UE_ARRAY_COUNT(CardFoldTo), "the fold table's two halves are one table");

	/** A math alphanumeric (U+1D400-1D6A3 letters, U+1D7CE-1D7FF digits: a surrogate pair) as the ASCII it is drawn as, or 0. */
	TCHAR CardMathAlnum(uint32 CodePoint)
	{
		if (CodePoint >= 0x1D400 && CodePoint <= 0x1D6A3)
		{
			const uint32 Letter = (CodePoint - 0x1D400) % 52;
			return Letter < 26 ? static_cast<TCHAR>(TEXT('A') + Letter) : static_cast<TCHAR>(TEXT('a') + Letter - 26);
		}
		if (CodePoint >= 0x1D7CE && CodePoint <= 0x1D7FF)
		{
			return static_cast<TCHAR>(TEXT('0') + (CodePoint - 0x1D7CE) % 10);
		}
		return 0;
	}

	/** One BMP character as the ASCII the screen reads it as (full-width forms by their offset, the rest from the table), or 0. */
	TCHAR CardFoldChar(uint32 Code)
	{
		if (Code >= 0xFF01 && Code <= 0xFF5E)
		{
			return static_cast<TCHAR>(Code - 0xFEE0);
		}
		int32 Low = 0;
		int32 High = static_cast<int32>(UE_ARRAY_COUNT(CardFoldFrom)) - 1;
		while (Low <= High)
		{
			const int32 Middle = (Low + High) / 2;
			const uint32 At = CardFoldFrom[Middle];
			if (At == Code)
			{
				return static_cast<TCHAR>(CardFoldTo[Middle]);
			}
			if (At < Code)
			{
				Low = Middle + 1;
			}
			else
			{
				High = Middle - 1;
			}
		}
		return 0;
	}

	/**
	 * THE MATCHING VIEW (r7, QaRuleFold; Second's (e)): the text folded ONE CHARACTER FOR ONE -- full-width, look-alike, marked and math letters
	 * to the ASCII they are drawn as ("p<Cyrillic a>ssword", "<full-width>password"), the look-alike connectors to ':' '=' '-' '|' '/', and
	 * "%3D" / "%3A" to "===" / ":::" -- so every index is the same character in both. What is MATCHED is folded; what is stored and shown never
	 * is: an accented or Russian objective keeps its letters.
	 */
	FString CardFold(const FString& Text)
	{
		if (!CardRuleOn(FWonderlandCardStore::QaRuleFold))
		{
			return Text;
		}
		FString Out = Text;
		const int32 Count = Text.Len();
		for (int32 At = 0; At < Count; ++At)
		{
			const uint32 Code = static_cast<uint32>(Text[At]);
			if (Code == TEXT('%') && At + 2 < Count && Text[At + 1] == TEXT('3') && FCString::Strchr(TEXT("DdAa"), Text[At + 2]) != nullptr)
			{
				const TCHAR Connector = (Text[At + 2] == TEXT('D') || Text[At + 2] == TEXT('d')) ? TEXT('=') : TEXT(':');
				Out[At] = Connector;
				Out[At + 1] = Connector;
				Out[At + 2] = Connector;
				At += 2;
				continue;
			}
			if (Code == 0xD835 && At + 1 < Count && static_cast<uint32>(Text[At + 1]) >= 0xDC00 && static_cast<uint32>(Text[At + 1]) <= 0xDFFF)
			{
				const TCHAR Plain = CardMathAlnum(0x10000 + ((Code - 0xD800) << 10) + (static_cast<uint32>(Text[At + 1]) - 0xDC00));
				if (Plain != 0)
				{
					Out[At] = Plain;
					Out[At + 1] = static_cast<TCHAR>(0xAD);
				}
				++At;
				continue;
			}
			const TCHAR Plain = CardFoldChar(Code);
			if (Plain != 0)
			{
				Out[At] = Plain;
			}
		}
		return Out;
	}

	/** r8 (QaRuleExpand; Second's r7 leak 1): the compatibility EXPANSIONS a one-for-one fold cannot make, or null. */
	const TCHAR* CardExpansion(uint32 Code)
	{
		switch (Code)
		{
		case 0x00DF: return TEXT("ss");
		case 0x1E9E: return TEXT("SS");
		case 0xFB00: return TEXT("ff");
		case 0xFB01: return TEXT("fi");
		case 0xFB02: return TEXT("fl");
		case 0xFB03: return TEXT("ffi");
		case 0xFB04: return TEXT("ffl");
		case 0xFB05: return TEXT("st");
		case 0xFB06: return TEXT("st");
		case 0x0132: return TEXT("IJ");
		case 0x0133: return TEXT("ij");
		case 0x01C4: return TEXT("DZ");
		case 0x01C5: return TEXT("Dz");
		case 0x01C6: return TEXT("dz");
		case 0x01C7: return TEXT("LJ");
		case 0x01C8: return TEXT("Lj");
		case 0x01C9: return TEXT("lj");
		case 0x01CA: return TEXT("NJ");
		case 0x01CB: return TEXT("Nj");
		case 0x01CC: return TEXT("nj");
		case 0x01F1: return TEXT("DZ");
		case 0x01F2: return TEXT("Dz");
		case 0x01F3: return TEXT("dz");
		default: return nullptr;
		}
	}

	/**
	 * THE MATCHING VIEW WITH ITS EXPANSIONS (r8, QaRuleExpand): CardFold, and each character a one-for-one fold cannot spell -- the sharp s, a
	 * ligature, a digraph -- written as its letters, so "pa<eszett>word" and "con<fi>g password" read as typed words. OutStart[i] / OutEnd[i]
	 * are the characters of Text that the folded character i stands for: a find on the folded view lands on the characters as typed.
	 */
	FString CardFoldMapped(const FString& Text, TArray<int32>& OutStart, TArray<int32>& OutEnd)
	{
		const FString Base = CardFold(Text);
		bool bAny = false;
		if (CardRuleOn(FWonderlandCardStore::QaRuleFold) && CardRuleOn(FWonderlandCardStore::QaRuleExpand))
		{
			for (const TCHAR Char : Text)
			{
				if (CardExpansion(static_cast<uint32>(Char)) != nullptr)
				{
					bAny = true;
					break;
				}
			}
		}
		OutStart.Reset(Text.Len() + 8);
		OutEnd.Reset(Text.Len() + 8);
		FString Out;
		Out.Reserve(Text.Len() + 8);
		for (int32 At = 0; At < Text.Len(); ++At)
		{
			const TCHAR* Expansion = bAny ? CardExpansion(static_cast<uint32>(Text[At])) : nullptr;
			if (Expansion != nullptr)
			{
				for (const TCHAR* Letter = Expansion; *Letter != 0; ++Letter)
				{
					Out.AppendChar(*Letter);
					OutStart.Add(At);
					OutEnd.Add(At + 1);
				}
				continue;
			}
			Out.AppendChar(Base[At]);
			OutStart.Add(At);
			OutEnd.Add(At + 1);
		}
		return Out;
	}

	/** A surrogate pair that draws nothing: a TAG character (U+E0000-E007F, r6), and (r7) a variation selector of the supplement
	 *  (U+E0100-E01EF), a musical format control (U+1D173-1D17A), a shorthand format control (U+1BCA0-1BCA3). */
	bool CardInvisiblePair(uint32 High, uint32 Low)
	{
		if (High == 0xDB40)
		{
			return (Low >= 0xDC00 && Low <= 0xDC7F) || (CardRuleOn(FWonderlandCardStore::QaRuleFold) && Low >= 0xDD00 && Low <= 0xDDEF);
		}
		if (!CardRuleOn(FWonderlandCardStore::QaRuleFold))
		{
			return false;
		}
		return (High == 0xD834 && Low >= 0xDD73 && Low <= 0xDD7A) || (High == 0xD82F && Low >= 0xDCA0 && Low <= 0xDCA3);
	}

	/** CERTAIN BY ITS OWN SHAPE, whatever stands around it: a 'sk-' key, a vendor-prefixed key, a JWT-like dotted word, a PEM line. */
	bool CardShapeCertain(const FString& Word)
	{
		return WonderlandSidekickSecrets::LooksLikeKey(Word) || CardHasVendorKey(Word) || CardHasDottedToken(Word) || Word.Contains(TEXT("-----BEGIN"))
			|| Word.Contains(TEXT("-----END"));
	}

	/**
	 * A VALUE THAT IS A CREDENTIAL BY ITS OWN LOOK (r7, CORE's refinement of Second's (a)): a label that finds it may NOT give it back on /keep,
	 * and a restart's restore applies it. A key or random shape; 6+ digits (4+ after "pin:"), never a quantity after "token"; 6+ characters
	 * that look like a value and hold a letter with two digits or a symbol ("Tr0ub4dor&3x", "Zq9pL2mN7x"). Not: a plain or capitalised word
	 * ("Swordfish", "Manager", "marmalade"), "hunter2", "1Password" -- those a label finds WEAK: redacted, and /keep gives them back.
	 */
	bool CardValueStrong(const FString& Value, ECardLabelKind Kind, bool bAssigned)
	{
		if (Value.IsEmpty())
		{
			return false;
		}
		if (CardShapeCertain(Value) || CardPiecesLookRandom(Value))
		{
			return true;
		}
		if (CardAllOf(Value, 0, Value.Len(), &CardDigitChar))
		{
			return Kind != ECardLabelKind::Token && (Value.Len() >= 6 || (bAssigned && Kind == ECardLabelKind::Pin && Value.Len() >= 4));
		}
		if (Value.Len() < 6 || !CardValueLike(Value, Kind))
		{
			return false;
		}
		bool bLetter = false;
		int32 Digits = 0;
		int32 Symbols = 0;
		for (const TCHAR Char : Value)
		{
			bLetter |= CardAsciiLetter(Char);
			Digits += CardAsciiDigit(Char) ? 1 : 0;
			Symbols += Char != 0 && FCString::Strchr(CardValueSymbols, Char) != nullptr ? 1 : 0;
		}
		return bLetter && (Digits >= 2 || Symbols >= 1);
	}

	/** A further word of the same value (a list, a run past a marker): value-like and no status word, and -- unless a comma listed it -- not
	 *  a lone capitalised word ("password: X Thanks"). */
	bool CardContLike(const FString& Word, ECardLabelKind Kind, bool bAfterComma)
	{
		if (Word.IsEmpty() || !CardValueLike(Word, Kind) || CardOneOf(Word.ToLower(), CardNonValues))
		{
			return false;
		}
		if (bAfterComma)
		{
			return true;
		}
		const bool bPlainCapital = CardIsAlphaWord(Word) && CardAllOf(Word, 0, Word.Len(), &CardAsciiLetter) && !CardInnerUpper(Word);
		return !bPlainCapital;
	}

	/** A plain lowercase word that can be a password-family label's value at the END of its clause ("the password is marmalade"): not a
	 *  stopword, a status, a day, a connector, nor a describing form (-ed -ing -ly -able -ible -ful -less -ous -ive). */
	bool CardPlainClauseWord(const FString& Word)
	{
		if (Word.Len() < 3)
		{
			return false;
		}
		for (const TCHAR Char : Word)
		{
			if (Char < TEXT('a') || Char > TEXT('z'))
			{
				return false;
			}
		}
		if (CardOneOf(Word, CardStopwords) || CardOneOf(Word, CardNonValues) || CardOneOf(Word, CardNotValues) || CardOneOf(Word, CardWeakConnectors))
		{
			return false;
		}
		for (const TCHAR* Suffix : CardProseSuffixes)
		{
			if (Word.EndsWith(Suffix, ESearchCase::CaseSensitive) && Word.Len() > FCString::Strlen(Suffix) + 2)
			{
				return false;
			}
		}
		return true;
	}

	/** What one word's label=value holds: the label's kind, the value up to the next piece, the REST of the word (a password holding '&' or
	 *  '#' is cut there by the piece split, so its strength is read on the rest too), and whether the value is an Authorization scheme whose
	 *  credential is the next word ("Authorization:Bearer X"). */
	struct FCardLabelValue
	{
		bool bFound = false;
		ECardLabelKind Kind = ECardLabelKind::None;
		FString Value;
		FString Rest;
		bool bSchemeNext = false;
	};

	bool CardLabelValueAccept(ECardLabelKind Kind, const FString& Value)
	{
		if (Value.IsEmpty())
		{
			return false;
		}
		// an env key's value -- and (r7) a token's -- must look like one: "SORT_KEY=name", "MAX_TOKEN=4096" are settings
		if (Kind == ECardLabelKind::EnvKey || (Kind == ECardLabelKind::Token && CardRuleOn(FWonderlandCardStore::QaRuleClasses)))
		{
			return CardValueLike(Value, Kind);
		}
		const FString Lower = Value.ToLower();
		return !(CardRuleOn(FWonderlandCardStore::QaRuleClasses) && (CardOneOf(Lower, CardNonValues) || CardOneOf(Lower, CardStopwords)));
	}

	/**
	 * A LABEL AND ITS VALUE IN ONE WORD (r7; Second's finding 2): read at EVERY ':' / '=' (and, r7, a glued "->" / "|") of every piece split at
	 * ? & ; # , -- a config paste whose secret is not its first key ({"user":"bob","pwd":"X"}, "user=bob,password=X"), a URL's query pair by
	 * pair. "Authorization:Bearer X" names the next word. A label in Chinese, Japanese or Korean is read glued to its value ("<password>:X").
	 */
	FCardLabelValue CardLabelWithValueR7(const FString& Word, const FString& Orig)
	{
		FCardLabelValue Out;
		if (!CardRuleOn(FWonderlandCardStore::QaRuleUrlPieces))
		{
			// d831cbd1: the first ':' or '=' of the word
			if (!CardLabelWithValue(Word.ToLower()))
			{
				return Out;
			}
			int32 Cut = 0;
			while (Cut < Word.Len() && Word[Cut] != TEXT(':') && Word[Cut] != TEXT('='))
			{
				++Cut;
			}
			FString Value = Word.Mid(Cut + 1);
			while (Value.Len() > 0 && (Value[0] == TEXT(':') || Value[0] == TEXT('=')))
			{
				Value.RightChopInline(1);
			}
			Out.bFound = true;
			Out.Kind = ECardLabelKind::Normal;
			Out.Value = CardTrimEdges(Value);
			return Out;
		}
		if (CardRuleOn(FWonderlandCardStore::QaRuleLabels))
		{
			int32 Lead = 0;
			while (Lead < Orig.Len() && CardEdge(Orig[Lead]))
			{
				++Lead;
			}
			for (const TCHAR* Label : CardForeignGluedLabels)
			{
				const int32 LabelLen = FCString::Strlen(Label);
				if (Orig.Len() < Lead + LabelLen || FCString::Strncmp(*Orig + Lead, Label, LabelLen) != 0)
				{
					continue;
				}
				int32 From = Lead + LabelLen;
				for (const TCHAR* Glue : CardGlueAfter)
				{
					const int32 GlueLen = FCString::Strlen(Glue);
					if ((Orig.Len() >= From + GlueLen && FCString::Strncmp(*Orig + From, Glue, GlueLen) == 0)
						|| (Word.Len() >= From + GlueLen && FCString::Strncmp(*Word + From, Glue, GlueLen) == 0))
					{
						From += GlueLen;
						break;
					}
				}
				while (From < Word.Len() && FCString::Strchr(TEXT(":=|->"), Word[From]) != nullptr)
				{
					++From;
				}
				const FString Value = CardTrimEdges(Word.Mid(From));
				if (!Value.IsEmpty())
				{
					Out.bFound = true;
					Out.Kind = ECardLabelKind::Normal;
					Out.Value = Value;
					return Out;
				}
			}
		}
		const TCHAR* const Cuts = CardRuleOn(FWonderlandCardStore::QaRuleFillers) ? TEXT(":=|>") : TEXT(":=");
		int32 From = 0;
		for (int32 At = 0; At <= Word.Len(); ++At)
		{
			if (At < Word.Len() && FCString::Strchr(TEXT("?&;#,"), Word[At]) == nullptr)
			{
				continue;
			}
			int32 Base = From;
			const int32 End = At;
			From = At + 1;
			while (Base < End && CardEdge(Word[Base]))
			{
				++Base;
			}
			int32 Previous = Base;
			for (int32 Cut = Base; Cut < End; ++Cut)
			{
				if (FCString::Strchr(Cuts, Word[Cut]) == nullptr)
				{
					continue;
				}
				if (Cut <= Previous)
				{
					Previous = Cut + 1;
					continue;
				}
				if (Word[Cut] == TEXT('>') && !(Cut > Base && (Word[Cut - 1] == TEXT('-') || Word[Cut - 1] == TEXT('='))))
				{
					continue;
				}
				const FString Label = Word.Mid(Previous, Cut - Previous);
				const ECardLabelKind Kind = CardLabelKind(Label, Orig.Mid(Previous, Cut - Previous));
				if (Kind != ECardLabelKind::None)
				{
					int32 ValueAt = Cut + 1;
					while (ValueAt < End && FCString::Strchr(Cuts, Word[ValueAt]) != nullptr)
					{
						++ValueAt;
					}
					const FString Value = CardTrimEdges(Word.Mid(ValueAt, End - ValueAt));
					if (CardRuleOn(FWonderlandCardStore::QaRuleCli) && CardAuthScheme(Value.ToLower()) && Label.Contains(TEXT("authorization")))
					{
						Out.bFound = true;
						Out.Kind = Kind;
						Out.Value = Value;
						Out.bSchemeNext = true;
						return Out;
					}
					if (CardLabelValueAccept(Kind, Value))
					{
						Out.bFound = true;
						Out.Kind = Kind;
						Out.Value = Value;
						Out.Rest = CardTrimEdges(Word.Mid(ValueAt));
						return Out;
					}
				}
				Previous = Cut + 1;
			}
		}
		return Out;
	}

	/** user:PASS@host with NO scheme ("connect admin:X@db.example.com"): the value, or empty. A name that is a scheme ("mailto:") is not. */
	FString CardSchemelessUserinfo(const FString& RawWord)
	{
		const FString Word = CardTrimEdges(RawWord);
		if (Word.Contains(TEXT("://")))
		{
			return FString();
		}
		int32 AtSign = INDEX_NONE;
		int32 Colon = INDEX_NONE;
		if (!Word.FindLastChar(TEXT('@'), AtSign) || AtSign <= 0 || !Word.FindChar(TEXT(':'), Colon) || Colon <= 0 || Colon + 1 >= AtSign)
		{
			return FString();
		}
		const FString Name = Word.Left(Colon);
		if (Name.Len() > 40 || CardOneOf(Name.ToLower(), CardNotUserinfo))
		{
			return FString();
		}
		for (const TCHAR Char : Name)
		{
			if (!(CardAsciiLetter(Char) || CardAsciiDigit(Char) || Char == TEXT('.') || Char == TEXT('_') || Char == TEXT('-')))
			{
				return FString();
			}
		}
		FString Host = Word.Mid(AtSign + 1);
		for (const TCHAR Stop : { TEXT('/'), TEXT(':'), TEXT('?'), TEXT('#') })
		{
			int32 StopAt = INDEX_NONE;
			if (Host.FindChar(Stop, StopAt))
			{
				Host.LeftInline(StopAt);
			}
		}
		if (Host.IsEmpty())
		{
			return FString();
		}
		for (const TCHAR Char : Host)
		{
			if (!(CardAsciiLetter(Char) || CardAsciiDigit(Char) || Char == TEXT('.') || Char == TEXT('-')))
			{
				return FString();
			}
		}
		if (!Host.Contains(TEXT(".")) && !Host.Equals(TEXT("localhost"), ESearchCase::IgnoreCase))
		{
			return FString();
		}
		return Word.Mid(Colon + 1, AtSign - Colon - 1);
	}

	/** https://TOKEN@host -- a token as a URL's user, no ':' ("git clone https://X@github.com/org/repo"): the token, or empty. */
	FString CardUrlUserToken(const FString& Word)
	{
		const int32 Scheme = Word.Find(TEXT("://"));
		if (Scheme <= 0)
		{
			return FString();
		}
		int32 End = Scheme + 3;
		while (End < Word.Len() && Word[End] != TEXT('/'))
		{
			++End;
		}
		const FString Authority = Word.Mid(Scheme + 3, End - Scheme - 3);
		int32 AtSign = INDEX_NONE;
		if (!Authority.FindLastChar(TEXT('@'), AtSign) || AtSign <= 0)
		{
			return FString();
		}
		const FString User = Authority.Left(AtSign);
		int32 Colon = INDEX_NONE;
		return User.FindChar(TEXT(':'), Colon) ? FString() : User;
	}

	/** A password-family label ("password", "passwd", "pwd", "pass", "Passwort", a numbered "password2" ...). */
	bool CardPasswordFamilyLabel(const FString& Word, const FString& Orig)
	{
		const FString Bare = CardBare(CardTrimEdges(Word).ToLower());
		if (Bare == TEXT("pass") || Bare == TEXT("pw") || CardOneOf(Bare, CardForeignLabels))
		{
			return true;
		}
		FString Numbered = Bare;
		while (Numbered.Len() > 0 && CardAsciiDigit(Numbered[Numbered.Len() - 1]))
		{
			Numbered.LeftChopInline(1);
		}
		for (const TCHAR* Family : CardPasswordFamily)
		{
			if (Numbered.EndsWith(Family, ESearchCase::CaseSensitive))
			{
				return true;
			}
		}
		return CardOneOf(CardTrimEdges(Orig), CardForeignScriptLabels) || (CardRuleOn(FWonderlandCardStore::QaRuleParticle) && CardParticleLabel(Orig));
	}

	/** r8 (QaRuleNameWeak): a NAME's shape inside a noun phrase ("the Server42xq box"): letters and digits, '-' '_' '.', and nothing else. */
	bool CardNameShaped(const FString& Word)
	{
		if (Word.IsEmpty() || Word.Len() > 24)
		{
			return false;
		}
		bool bLetter = false;
		for (const TCHAR Char : Word)
		{
			const bool bAsciiLetter = (Char >= TEXT('a') && Char <= TEXT('z')) || (Char >= TEXT('A') && Char <= TEXT('Z'));
			if (!bAsciiLetter && !CardAsciiDigit(Char) && Char != TEXT('-') && Char != TEXT('_') && Char != TEXT('.'))
			{
				return false;
			}
			bLetter |= bAsciiLetter;
		}
		return bLetter;
	}

	/** Where the redaction's own marker stands -- and (r7, QaRuleFold) the same words typed in another case: "[A key: ...]<value>" is the
	 *  marker a value is glued to, not a word that hides it. */
	TArray<TPair<int32, int32>> CardFindMarks(const FString& Text)
	{
		TArray<TPair<int32, int32>> Marks;
		const FString Mark = CardRedactionMarker();
		const ESearchCase::Type Case = CardRuleOn(FWonderlandCardStore::QaRuleFold) ? ESearchCase::IgnoreCase : ESearchCase::CaseSensitive;
		for (int32 At = Text.Find(Mark, Case); At != INDEX_NONE; At = Text.Find(Mark, Case, ESearchDir::FromStart, At + Mark.Len()))
		{
			Marks.Add(TPair<int32, int32>(At, At + Mark.Len()));
		}
		return Marks;
	}

	/** In order, overlaps merged: certain if either is, a weak label value only if both are (and neither certain), a shape if either is. */
	void CardMergeFinds(TArray<FWonderlandCardStore::FSecretFind>& Finds)
	{
		Finds.Sort([](const FWonderlandCardStore::FSecretFind& A, const FWonderlandCardStore::FSecretFind& B)
		{
			return A.Start < B.Start || (A.Start == B.Start && A.Length < B.Length);
		});
		TArray<FWonderlandCardStore::FSecretFind> Merged;
		for (const FWonderlandCardStore::FSecretFind& Find : Finds)
		{
			if (Merged.Num() > 0 && Find.Start < Merged.Last().Start + Merged.Last().Length)
			{
				FWonderlandCardStore::FSecretFind& Last = Merged.Last();
				const int32 End = FMath::Max(Last.Start + Last.Length, Find.Start + Find.Length);
				Last.Length = End - Last.Start;
				Last.bCertain |= Find.bCertain;
				Last.bWeak = Last.bWeak && Find.bWeak && !Last.bCertain;
				Last.bShape |= Find.bShape;
				continue;
			}
			Merged.Add(Find);
		}
		Finds = MoveTemp(Merged);
	}

	/** The text with every find replaced by the marker, and for each character of it the span of the original text it stands for. */
	void CardRedactWithMap(const FString& Text, const TArray<FWonderlandCardStore::FSecretFind>& Finds, FString& OutRedacted, TArray<TPair<int32, int32>>& OutOwner)
	{
		OutRedacted.Reset();
		OutOwner.Reset();
		const FString Mark = CardRedactionMarker();
		int32 From = 0;
		for (const FWonderlandCardStore::FSecretFind& Find : Finds)
		{
			for (int32 At = From; At < Find.Start; ++At)
			{
				OutRedacted.AppendChar(Text[At]);
				OutOwner.Add(TPair<int32, int32>(At, At + 1));
			}
			for (int32 At = 0; At < Mark.Len(); ++At)
			{
				OutRedacted.AppendChar(Mark[At]);
				OutOwner.Add(TPair<int32, int32>(Find.Start, Find.Start + Find.Length));
			}
			From = Find.Start + Find.Length;
		}
		for (int32 At = From; At < Text.Len(); ++At)
		{
			OutRedacted.AppendChar(Text[At]);
			OutOwner.Add(TPair<int32, int32>(At, At + 1));
		}
	}
}

void FWonderlandCardStore::FindSecrets(const FString& Text, TArray<FSecretFind>& OutFinds)
{
	OutFinds.Reset();
	const bool bPerf = CardRuleOn(QaRulePerf);
	// r8 (QaRulePerf; Second's attack on r7 (A)): A LONG TEXT IN WINDOWS -- CardScreenCap characters each, overlapping by CardScreenOverlap and
	// cut at a space, so the time is linear in the length and every word (and every label's window, a few words long) is read whole in at
	// least one of them. r7 read any length at once, and parts of it grew with the square: 2.8k characters of wrapped words took ~3 s
	if (bPerf && Text.Len() > CardScreenCap)
	{
		TArray<FSecretFind> Part;
		int32 From = 0;
		while (From < Text.Len())
		{
			int32 To = FMath::Min(Text.Len(), From + CardScreenCap);
			if (To < Text.Len())
			{
				for (int32 At = To - 1; At >= From + CardScreenCap / 2; --At)
				{
					if (Text[At] == TEXT(' '))
					{
						To = At;
						break;
					}
				}
			}
			FindSecrets(Text.Mid(From, To - From), Part);
			for (FSecretFind& Find : Part)
			{
				Find.Start += From;
				OutFinds.Add(Find);
			}
			if (To >= Text.Len())
			{
				break;
			}
			const int32 Next = FMath::Max(From + 1, To - CardScreenOverlap);
			int32 Back = INDEX_NONE;
			for (int32 At = Next; At > From; --At)
			{
				if (Text[At] == TEXT(' '))
				{
					Back = At;
					break;
				}
			}
			From = Back != INDEX_NONE ? Back + 1 : Next;
		}
		CardMergeFinds(OutFinds);
		return;
	}
	// r7: THE MATCHING VIEW (CardFold) -- every index the same character; the words are read from it, the finds land on Text. r8
	// (QaRuleExpand): with its expansions ("pa<eszett>word" is "password"), each folded character mapped to the characters it stands for
	TArray<int32> FoldStart;
	TArray<int32> FoldEnd;
	const FString Folded = CardFoldMapped(Text, FoldStart, FoldEnd);
	auto OrigOf = [&Text, &FoldStart, &FoldEnd](int32 From, int32 To)
	{
		return To > From ? Text.Mid(FoldStart[From], FoldEnd[To - 1] - FoldStart[From]) : FString();
	};
	auto OntoText = [&Text, &FoldStart, &FoldEnd](int32 From, int32 To, FSecretFind& Find)
	{
		if (To <= From)
		{
			Find.Start = From < FoldStart.Num() ? FoldStart[From] : Text.Len();
			Find.Length = 0;
			return;
		}
		Find.Start = FoldStart[From];
		Find.Length = FoldEnd[To - 1] - FoldStart[From];
	};
	// THE WORDS FIRST, each as typed (Raw: a label's ':' or '=' is read from it) and trimmed (Word), so a label can reach its value
	struct FSpan
	{
		int32 Start;
		int32 End;
		FString Raw;
		FString Word;
		FString Lower;
		/** The word as typed, its edge punctuation included: a credential's VALUE is redacted whole ("hunter2!" keeps no "!"). */
		int32 RawStart;
		int32 RawEnd;
		/** The redaction's own marker: never a find, never a value. */
		bool bMarker;
		/** Touching a marker with no space between (r6): a value glued to it is taken. */
		bool bGlued;
		/** r7: the word unfolded, as typed (a label in another script is read as written). */
		FString Orig;
	};
	TArray<FSpan> Spans;
	const int32 Count = Folded.Len();
	// THE REDACTION'S OWN MARKER IS NOT A KEY (round 4's SI3), AND IT IS ITS OWN TOKEN (r6, Second's MAJOR 2): a word never crosses a
	// marker's edge, so "[marker]<value>" or "<value>[marker]" is not exempt for overlapping it
	const FString RedactionMark = CardRedactionMarker();
	const bool bMarkerSplit = CardRuleOn(QaRuleMarkerSplit);
	const TArray<TPair<int32, int32>> Marks = CardFindMarks(Folded);
	auto AddWords = [&Folded, &Spans, &Marks, &OrigOf, bMarkerSplit](int32 From, int32 To)
	{
		int32 At = From;
		while (At < To)
		{
			while (At < To && CardSplitsWords(Folded[At]))
			{
				++At;
			}
			const int32 WordStart = At;
			while (At < To && !CardSplitsWords(Folded[At]))
			{
				++At;
			}
			if (At == WordStart)
			{
				continue;
			}
			int32 Start = WordStart;
			int32 End = At;
			while (Start < End && CardEdge(Folded[Start]))
			{
				++Start;
			}
			while (End > Start && CardEdge(Folded[End - 1]))
			{
				--End;
			}
			const int32 WordEnd = At;
			const bool bGlued = bMarkerSplit
				&& ((WordStart == From && Marks.ContainsByPredicate([From](const TPair<int32, int32>& Mark) { return Mark.Value == From; }))
					|| (WordEnd == To && Marks.ContainsByPredicate([To](const TPair<int32, int32>& Mark) { return Mark.Key == To; })));
			const FString Word = Folded.Mid(Start, FMath::Max(End - Start, 0));
			Spans.Add({ Start, End, Folded.Mid(WordStart, At - WordStart), Word, Word.ToLower(), WordStart, At, false, bGlued, OrigOf(Start, End) });
		}
	};
	if (bMarkerSplit)
	{
		int32 Previous = 0;
		for (const TPair<int32, int32>& Mark : Marks)
		{
			AddWords(Previous, Mark.Key);
			Spans.Add({ Mark.Key, Mark.Value, RedactionMark, RedactionMark, RedactionMark.ToLower(), Mark.Key, Mark.Value, true, false, RedactionMark });
			Previous = Mark.Value;
		}
		AddWords(Previous, Count);
	}
	else
	{
		// d831cbd1: a word OVERLAPPING a marker is the marker
		AddWords(0, Count);
		for (FSpan& Span : Spans)
		{
			for (const TPair<int32, int32>& Mark : Marks)
			{
				Span.bMarker |= Span.Start < Mark.Value && Span.End > Mark.Key;
			}
		}
	}
	const int32 NumSpans = Spans.Num();
	// r7: THE CLASS of each word -- 0 none, 1 a label's WEAK value (redacted; /keep gives it back; a restore never applies it), 2 CERTAIN
	// (never kept). A label-derived value is certain only when it is a credential by its own look (CardValueStrong) -- Second's (a), with
	// CORE's refinement that the founder's fail-closed still holds for every password a label names
	TArray<uint8> Class;
	Class.Init(0, NumSpans);
	// CERTAIN BY ITS OWN SHAPE (a key, a PEM block, a URL's user:pass@): what a restore applies to a /keep'd objective
	TArray<bool> Shape;
	Shape.Init(false, NumSpans);
	// A VALUE GIVEN BY A LABEL (or Bearer / Basic, pwd=..., a URL's user:pass@) is redacted as typed, edge punctuation and all: trimmed, a
	// password ending in "!" or ")" kept that character on screen and on disk (round 5's rule check: "the secret hunter2! goes in")
	TArray<bool> TakenWhole;
	TakenWhole.Init(false, NumSpans);
	// r7 (Second's (d)): every value a label found, so EVERY other occurrence of it goes too
	TArray<TPair<FString, uint8>> Values;
	const bool bClasses = CardRuleOn(QaRuleClasses);
	const bool bContinue = CardRuleOn(QaRuleContinue);
	auto Take = [&](int32 At, const FString& Value, ECardLabelKind Kind, bool bAssigned, const FString& Rest, bool bForced, bool bWeakOnly = false)
	{
		if (At < 0 || At >= NumSpans || Spans[At].bMarker || Spans[At].Word.IsEmpty())
		{
			return;
		}
		uint8 Got = (!bClasses || bForced || CardValueStrong(Value, Kind, bAssigned) || (!Rest.IsEmpty() && CardValueStrong(Rest, Kind, bAssigned))) ? 2 : 1;
		if (bWeakOnly && bClasses)
		{
			Got = 1;   // r8: a name the noun phrase held, taken for want of a value -- redacted, and /keep gives it back
		}
		Class[At] = FMath::Max(Class[At], Got);
		TakenWhole[At] = true;
		if (!Value.IsEmpty() && bContinue)
		{
			Values.Add(TPair<FString, uint8>(Value, Got));
		}
	};
	// the end of a clause: the last word, a word ending in . , ; ! ? ), or one before "and" / "but" / "please" -- never a marker (that was a
	// word before a first pass redacted it)
	auto ClauseFinal = [&Spans, NumSpans](int32 At)
	{
		if (At + 1 >= NumSpans)
		{
			return true;
		}
		const FString& Raw = Spans[At].Raw;
		if (Raw.Len() > 0 && FCString::Strchr(TEXT(".,;!?)"), Raw[Raw.Len() - 1]) != nullptr)
		{
			return true;
		}
		return !Spans[At + 1].bMarker && CardOneOf(Spans[At + 1].Lower, CardClauseJoins);
	};
	// r7 (QaRuleContinue): A VALUE'S CONTINUATION -- a backslash-newline wrap and a quoted run (one value, judged whole), a pass phrase's words,
	// a list ("X, Y"), a further value-like word, and past a marker as the window looks past one (a second pass sees a redacted value as a
	// marker; the first must already have taken what the second would)
	auto ContinueAfter = [&](int32 First, ECardLabelKind Kind)
	{
		if (!bContinue)
		{
			return;
		}
		TArray<int32> Run = { First };
		int32 Last = First;
		const FString& FirstRaw = Spans[First].Raw;
		bool bQuoteOpen = FirstRaw.Len() > 0 && FCString::Strchr(CardQuoteOpen, FirstRaw[0]) != nullptr
			&& !(FirstRaw.Len() > 1 && FCString::Strchr(CardQuoteClose, FirstRaw[FirstRaw.Len() - 1]) != nullptr);
		if (bQuoteOpen)
		{
			// a quoted run only when its quote CLOSES within six words: an unclosed quote is not a value spanning the prose after it
			bool bCloses = false;
			for (int32 Ahead = First + 1; Ahead < FMath::Min(NumSpans, First + 7); ++Ahead)
			{
				if (Spans[Ahead].bMarker)
				{
					break;
				}
				const FString& AheadRaw = Spans[Ahead].Raw;
				if (AheadRaw.Len() > 0 && FCString::Strchr(CardQuoteClose, AheadRaw[AheadRaw.Len() - 1]) != nullptr)
				{
					bCloses = true;
					break;
				}
			}
			bQuoteOpen = bCloses;
		}
		int32 Quoted = 0;
		int32 Phrase = 0;
		int32 Steps = 0;
		FString WholeValue = CardTrimEdges(Spans[First].Word);
		while (WholeValue.EndsWith(TEXT("\\"), ESearchCase::CaseSensitive))
		{
			WholeValue.LeftChopInline(1);
		}
		while (true)
		{
			++Steps;
			if (bPerf && Steps > CardMaxRun)
			{
				return;   // r8: no value runs on for more than CardMaxRun pieces
			}
			int32 Next = Last + 1;
			if (Next < NumSpans && Spans[Next].bMarker)
			{
				while (Next < NumSpans && Spans[Next].bMarker)
				{
					++Next;
				}
				if (Next < NumSpans && CardContLike(Spans[Next].Word, Kind, false))
				{
					Take(Next, Spans[Next].Word, Kind, false, FString(), false);
					Last = Next;
					bQuoteOpen = false;
					continue;
				}
				return;
			}
			if (Next >= NumSpans)
			{
				return;
			}
			const FString& LastRaw = Spans[Last].Raw;
			const FSpan& Candidate = Spans[Next];
			if (bQuoteOpen && Candidate.Raw.Len() > 0 && FCString::Strchr(TEXT("”’»"), Candidate.Raw[0]) != nullptr)
			{
				bQuoteOpen = false;   // the quote closed before this word
			}
			const bool bWrapped = LastRaw.EndsWith(TEXT("\\"), ESearchCase::CaseSensitive);
			if (bWrapped || (bQuoteOpen && Quoted < 6))
			{
				Quoted += bWrapped ? 0 : 1;
				Take(Next, Candidate.Word, Kind, true, FString(), false);
				Run.Add(Next);
				// ONE VALUE, judged whole: a wrapped or quoted password's pieces are as strong as all of it -- r8: grown one piece at a time
				// (r7 rebuilt it from every piece at every piece: the square of the run) and judged while it could still be one value
				if (bPerf)
				{
					FString Added = CardTrimEdges(Candidate.Word);
					while (Added.EndsWith(TEXT("\\"), ESearchCase::CaseSensitive))
					{
						Added.LeftChopInline(1);
					}
					WholeValue += Added;
				}
				else
				{
					WholeValue.Reset();
					for (const int32 Piece : Run)
					{
						FString Part = CardTrimEdges(Spans[Piece].Word);
						while (Part.EndsWith(TEXT("\\"), ESearchCase::CaseSensitive))
						{
							Part.LeftChopInline(1);
						}
						WholeValue += Part;
					}
				}
				if (bClasses && (!bPerf || WholeValue.Len() <= CardMaxWhole) && CardValueStrong(WholeValue, Kind, true))
				{
					for (const int32 Piece : Run)
					{
						Class[Piece] = 2;
					}
				}
				if (bQuoteOpen && Candidate.Raw.Len() > 0 && FCString::Strchr(CardQuoteClose, Candidate.Raw[Candidate.Raw.Len() - 1]) != nullptr)
				{
					bQuoteOpen = false;
				}
				Last = Next;
				continue;
			}
			if (Kind == ECardLabelKind::Phrase && Phrase < 8 && !(LastRaw.Len() > 0 && FCString::Strchr(TEXT(".;!?"), LastRaw[LastRaw.Len() - 1]) != nullptr)
				&& CardIsAlphaWord(Candidate.Word) && !CardOneOf(Candidate.Lower, CardStopwords) && !CardOneOf(Candidate.Lower, CardNonValues))
			{
				++Phrase;
				Take(Next, Candidate.Word, Kind, true, FString(), false);
				Last = Next;
				continue;
			}
			const bool bAfterComma = LastRaw.Len() > 0 && (LastRaw[LastRaw.Len() - 1] == TEXT(',') || LastRaw[LastRaw.Len() - 1] == TEXT(';'));
			if (CardContLike(Candidate.Word, Kind, bAfterComma))
			{
				Take(Next, Candidate.Word, Kind, bAfterComma, FString(), false);
				Last = Next;
				continue;
			}
			return;
		}
	};
	// A CREDENTIAL LABEL takes its value with it (r6 the LABEL WINDOW; r7 Second's (c)): after an ASSIGNMENT (':' '=' ':=' '->' '-' '|', on the
	// label or a qualifier closing it -- "password for staging: X", "password (staging): X") the next word, a stopword or a status word
	// excepted and fillers skipped ("password: now X"); otherwise, past the connectors and a NOUN PHRASE after a preposition ("for the new
	// staging db box is X"), the first word that LOOKS like a credential, a parenthesised one ("pwd (X)"), or -- a password-family label after
	// "is", at its clause's end -- a plain word ("the password is marmalade"). At most nine words on.
	auto LabelWindow = [&](int32 Index, ECardLabelKind Kind, bool bWordy)
	{
		const FSpan& Label = Spans[Index];
		const bool bNounPhrase = CardRuleOn(QaRuleNounPhrase);
		const bool bFillers = CardRuleOn(QaRuleFillers);
		FString LabelRaw = Label.Raw;
		while (LabelRaw.Len() > 0 && (LabelRaw[LabelRaw.Len() - 1] == TEXT('"') || LabelRaw[LabelRaw.Len() - 1] == TEXT('\'')))
		{
			LabelRaw.LeftChopInline(1);
		}
		bool bStrong = LabelRaw.EndsWith(TEXT(":"), ESearchCase::CaseSensitive) || LabelRaw.EndsWith(TEXT("="), ESearchCase::CaseSensitive);
		bool bCopula = false;
		bool bPrepositionSeen = false;
		bool bAfterQualifier = false;
		int32 Qualifiers = 0;
		int32 Pending = INDEX_NONE;
		bool bPendingName = false;
		bool bTaken = false;
		// r8 (QaRuleWideWindow; Second's r7 leaks 2/3): "the password for the brand new shared prod db box is X" -- a noun phrase of nine words
		const bool bWide = bNounPhrase && CardRuleOn(QaRuleWideWindow);
		const int32 MaxQualifiers = bWide ? 10 : 5;
		int32 Next = Index + 1;
		int32 Skips = 0;
		const int32 MaxSkips = bWide ? 14 : (bNounPhrase ? 8 : 4);
		while (Next < NumSpans && Skips <= MaxSkips)
		{
			const FSpan& Candidate = Spans[Next];
			if (Candidate.bMarker)
			{
				// that value is already gone -- or (r7) a marker the player TYPED stands between the label and the value
				if (bContinue && (bStrong || bCopula || Next == Index + 1))
				{
					int32 After = Next;
					while (After < NumSpans && Spans[After].bMarker)
					{
						++After;
					}
					if (After < NumSpans && CardContLike(Spans[After].Word, Kind, false))
					{
						Take(After, Spans[After].Word, Kind, bStrong, FString(), false);
						ContinueAfter(After, Kind);
					}
				}
				Pending = INDEX_NONE;
				break;
			}
			const FString& Raw = Candidate.Raw;
			const FString& Lower = Candidate.Lower;
			if (CardOneOf(Raw, CardStrongConnectors) || (bFillers && Raw == TEXT("|")))
			{
				bStrong = true;
				++Next;
				++Skips;
				continue;
			}
			if (!bStrong && (Raw.EndsWith(TEXT(":"), ESearchCase::CaseSensitive) || Raw.EndsWith(TEXT("="), ESearchCase::CaseSensitive))
				&& Candidate.Word.Len() <= 24
				&& (Next == Index + 1 || CardOneOf(Spans[Next - 1].Lower, CardPrepositions) || Raw.StartsWith(TEXT("("), ESearchCase::CaseSensitive)
					|| (bNounPhrase && bPrepositionSeen && !bCopula)))
			{
				bStrong = true;
				++Next;
				++Skips;
				continue;
			}
			if (bFillers && (bStrong || bCopula || (Raw.StartsWith(TEXT("("), ESearchCase::CaseSensitive) && !Raw.EndsWith(TEXT(")"), ESearchCase::CaseSensitive)))
				&& CardOneOf(Lower, CardFillers))
			{
				++Next;
				++Skips;
				continue;
			}
			if (bNounPhrase && !bStrong && !bCopula && CardOneOf(Lower, CardPrepositions) && !CardOneOf(Lower, CardWeakConnectors))
			{
				bPrepositionSeen = true;
				++Next;
				++Skips;
				continue;
			}
			if (!bStrong && CardOneOf(Lower, CardWeakConnectors))
			{
				if (CardOneOf(Lower, CardCopulas))
				{
					bCopula = true;
				}
				if (CardOneOf(Lower, CardPrepositions) && !bCopula)
				{
					bPrepositionSeen = true;
				}
				++Next;
				++Skips;
				continue;
			}
			if (!bStrong && Raw.StartsWith(TEXT("("), ESearchCase::CaseSensitive) && Raw.EndsWith(TEXT(")"), ESearchCase::CaseSensitive))
			{
				// r7: "pwd (X)" -- a parenthesised word is the value when it looks like one, a qualifier ("(staging)") when not
				if (bFillers && CardValueLike(Candidate.Word, Kind) && !CardOneOf(Candidate.Word.ToLower(), CardNonValues))
				{
					Take(Next, Candidate.Word, Kind, false, FString(), false);
					ContinueAfter(Next, Kind);
					Pending = INDEX_NONE;
					break;
				}
				++Next;
				++Skips;
				continue;
			}
			const FString Previous1 = Next - 1 > Index ? Spans[Next - 1].Lower : FString();
			const FString Previous2 = Next - 2 > Index ? Spans[Next - 2].Lower : FString();
			bool bQualifierPlace = CardOneOf(Previous1, CardPrepositions) || (CardOneOf(Previous1, CardArticles) && CardOneOf(Previous2, CardPrepositions));
			if (bNounPhrase && bPrepositionSeen && !bCopula && Qualifiers < MaxQualifiers)
			{
				bQualifierPlace = true;
			}
			bool bQualifierWord = false;
			if (bNounPhrase)
			{
				bool bAllowed = Candidate.Word.Len() <= 20;
				bool bAnyLetter = false;
				for (const TCHAR Char : Candidate.Word)
				{
					bAllowed &= FChar::IsAlpha(Char) || Char == TEXT('-') || Char == TEXT('_') || Char == TEXT('\'');
					bAnyLetter |= FChar::IsAlpha(Char);
				}
				bQualifierWord = (bAllowed && bAnyLetter) || (CardAllOf(Candidate.Word, 0, Candidate.Word.Len(), &CardDigitChar) && Candidate.Word.Len() <= 3);
			}
			else
			{
				bQualifierWord = CardIsAlphaWord(Candidate.Word) && Candidate.Word.Len() <= 16;
			}
			if (!bStrong && bQualifierPlace && bQualifierWord)
			{
				if (!CardValueLike(Candidate.Word, Kind))
				{
					bAfterQualifier = true;
					++Qualifiers;
					++Next;
					++Skips;
					continue;
				}
				// a value-like word INSIDE the noun phrase ("for the MyServer box is X"): held, taken only if no value follows
				if (bNounPhrase && bPrepositionSeen && !bCopula && !CardValueStrong(Candidate.Word, Kind, false))
				{
					if (Pending == INDEX_NONE)
					{
						Pending = Next;
					}
					bAfterQualifier = true;
					++Qualifiers;
					++Next;
					++Skips;
					continue;
				}
			}
			// r8 (QaRuleNameWeak; Second's r7): a NAME inside the noun phrase ("the password for the Server42xq box is X") is held like any
			// qualifier and taken -- weak, so /keep gives it back -- only when no value follows; r7 took it CERTAIN and looked no further
			if (CardRuleOn(QaRuleNameWeak) && bNounPhrase && bPrepositionSeen && !bCopula && !bStrong && Qualifiers < MaxQualifiers
				&& CardValueLike(Candidate.Word, Kind) && CardNameShaped(Candidate.Word))
			{
				if (Pending == INDEX_NONE)
				{
					Pending = Next;
					bPendingName = true;
				}
				bAfterQualifier = true;
				++Qualifiers;
				++Next;
				++Skips;
				continue;
			}
			// AN AUTHORIZATION SCHEME IS NOT THE CREDENTIAL (Second, 10-03): "Authorization: Bearer X" keeps "Bearer" readable and takes X
			if (Label.Lower.Contains(TEXT("authorization")) && CardAuthScheme(Lower) && Next + 1 < NumSpans)
			{
				++Next;
				continue;
			}
			// r8 (QaRuleCommonPw; Second's r7 leak 6): "the password is secret!" -- a common weak password at the clause's end IS the password
			if (CardRuleOn(QaRuleCommonPw) && bFillers && bWordy && (bCopula || bStrong) && CardOneOf(Lower, CardCommonPasswords) && ClauseFinal(Next))
			{
				Take(Next, Candidate.Word, Kind, bStrong, FString(), false);
				bTaken = true;
				Pending = INDEX_NONE;
				break;
			}
			if (bFillers && CardOneOf(Lower, CardNonValues) && !(Kind == ECardLabelKind::Phrase && bStrong && !ClauseFinal(Next)))
			{
				break;   // "password: required", "token: see the vault" -- a state, not a value
			}
			if (bClasses && CardIsAlphaWord(Candidate.Word) && CardKindOfBare(CardBare(Lower)) != ECardLabelKind::None && !CardValueLike(Candidate.Word, Kind))
			{
				break;   // another label ("password: token ..."), never a value
			}
			if (CardRuleOn(QaRuleLabels) && Kind == ECardLabelKind::Pin && !bStrong && !bCopula && Candidate.Word.Len() == 4
				&& CardAllOf(Candidate.Word, 0, 4, &CardDigitChar)
				&& (Candidate.Word.StartsWith(TEXT("19"), ESearchCase::CaseSensitive) || Candidate.Word.StartsWith(TEXT("20"), ESearchCase::CaseSensitive)))
			{
				break;   // "pin 2026 roadmap": a year
			}
			// an env key's or a token's value must LOOK like one even after '=' ("SORT_KEY = name", "token -> refresh mapping")
			const bool bAssigns = bStrong && !(bClasses && (Kind == ECardLabelKind::EnvKey || Kind == ECardLabelKind::Token) && !CardValueLike(Candidate.Word, Kind));
			bool bTake = (bAssigns && !CardOneOf(Lower, CardStopwords))
				|| (CardValueLike(Candidate.Word, Kind) && !(bAfterQualifier && CardAllOf(Candidate.Word, 0, Candidate.Word.Len(), &CardDigitChar)));
			if (!bTake && bFillers && bCopula && !bStrong && bWordy && CardPlainClauseWord(Candidate.Word) && ClauseFinal(Next))
			{
				bTake = true;
			}
			if (bTake && !Candidate.Word.IsEmpty())
			{
				Take(Next, Candidate.Word, Kind, bStrong, FString(), false);
				ContinueAfter(Next, Kind);
				bTaken = true;
				Pending = INDEX_NONE;
			}
			break;
		}
		// r8 (QaRuleCopulaScan; Second's r7 leak 4): "the password associated with the account is X" -- the window stopped on a word that is
		// neither a connector nor a qualifier; within ten words, inside the clause and before another label, an "is" / "was" / '=' / ':'
		// and then a value-like word (never a URL) is the label's value, whatever the words between
		if (!bTaken && CardRuleOn(QaRuleCopulaScan))
		{
			const int32 Limit = FMath::Min(NumSpans, Index + 11);
			for (int32 At = Index + 1; At < Limit; ++At)
			{
				const FSpan& Word = Spans[At];
				if (Word.bMarker)
				{
					break;
				}
				const FString& BeforeRaw = Spans[At - 1].Raw;
				if (At > Index + 1 && BeforeRaw.Len() > 0 && FCString::Strchr(TEXT(".;!?"), BeforeRaw[BeforeRaw.Len() - 1]) != nullptr)
				{
					break;
				}
				if (CardOneOf(Word.Lower, CardClauseJoins))
				{
					break;
				}
				if (At > Index + 1 && CardIsAlphaWord(Word.Word) && CardKindOfBare(CardBare(Word.Lower)) != ECardLabelKind::None)
				{
					break;   // another label: its own window reads what follows
				}
				const bool bAssign = CardOneOf(Word.Raw, CardStrongConnectors) || Word.Raw.EndsWith(TEXT(":"), ESearchCase::CaseSensitive)
					|| Word.Raw.EndsWith(TEXT("="), ESearchCase::CaseSensitive);
				if (!CardOneOf(Word.Lower, CardCopulas) && !bAssign)
				{
					continue;
				}
				int32 ValueAt = At + 1;
				while (ValueAt < NumSpans && !Spans[ValueAt].bMarker && CardOneOf(Spans[ValueAt].Lower, CardFillers))
				{
					++ValueAt;
				}
				if (ValueAt < NumSpans && !Spans[ValueAt].bMarker)
				{
					const FSpan& Value = Spans[ValueAt];
					if (!Value.Word.IsEmpty() && CardValueLike(Value.Word, Kind) && !CardOneOf(Value.Lower, CardNonValues) && !CardOneOf(Value.Lower, CardStopwords)
						&& !Value.Word.Contains(TEXT("://")) && !Value.Lower.StartsWith(TEXT("www."))
						&& !(CardIsAlphaWord(Value.Word) && CardKindOfBare(CardBare(Value.Lower)) != ECardLabelKind::None))
					{
						Take(ValueAt, Value.Word, Kind, bAssign, FString(), false);
						ContinueAfter(ValueAt, Kind);
						Pending = INDEX_NONE;
					}
				}
				break;
			}
		}
		if (Pending != INDEX_NONE)
		{
			Take(Pending, Spans[Pending].Word, Kind, false, FString(), false, bPendingName);
		}
	};
	// r8: each word's FIRST place, read once (r7 looked back over every earlier word for every CLI flag: the square of the length)
	TMap<FString, int32> FirstAt;
	for (int32 Index = 0; Index < NumSpans; ++Index)
	{
		if (!Spans[Index].bMarker && !FirstAt.Contains(Spans[Index].Lower))
		{
			FirstAt.Add(Spans[Index].Lower, Index);
		}
	}
	// r8 (QaRuleEchoPipe; Second's r7 leak 5): "echo X | docker login --password-stdin", "echo 'user:X' | chpasswd", "echo X | sudo -S cmd" --
	// what echo or printf writes into a pipe that a password reader drinks from is the password
	if (CardRuleOn(QaRuleEchoPipe))
	{
		for (int32 Index = 0; Index < NumSpans; ++Index)
		{
			if (Spans[Index].bMarker || !CardOneOf(Spans[Index].Lower, CardEchoWords))
			{
				continue;
			}
			int32 Bar = INDEX_NONE;
			for (int32 At = Index + 1; At < FMath::Min(NumSpans, Index + 8); ++At)
			{
				if (Spans[At].bMarker)
				{
					break;
				}
				if (Spans[At].Raw.StartsWith(TEXT("|"), ESearchCase::CaseSensitive))
				{
					Bar = At;
					break;
				}
			}
			if (Bar == INDEX_NONE)
			{
				continue;
			}
			bool bConsumer = false;
			for (int32 At = Bar + 1; At < FMath::Min(NumSpans, Bar + 10) && !bConsumer; ++At)
			{
				const FString& Raw = Spans[At].Raw;
				if (Raw == TEXT(";") || Raw == TEXT("&&") || Raw == TEXT("||") || Raw.EndsWith(TEXT(";"), ESearchCase::CaseSensitive))
				{
					break;
				}
				bConsumer = CardOneOf(Spans[At].Lower, CardPipeConsumers) || (Spans[At].Lower == TEXT("-s") && Spans[At - 1].Lower == TEXT("sudo"));
			}
			if (!bConsumer)
			{
				continue;
			}
			for (int32 At = Index + 1; At < Bar; ++At)
			{
				const FString& Word = Spans[At].Word;
				if (Word.IsEmpty() || Spans[At].bMarker || (Word.StartsWith(TEXT("-"), ESearchCase::CaseSensitive) && Word.Len() <= 3) || Word.Contains(TEXT("%")))
				{
					continue;   // echo's own flags, printf's format
				}
				Take(At, Word, ECardLabelKind::Normal, true, FString(), false);
			}
		}
	}
	int32 Pem = 0;
	bool bInPem = false;
	for (int32 Index = 0; Index < NumSpans; ++Index)
	{
		const FSpan& Span = Spans[Index];
		if (Span.bMarker)
		{
			continue;
		}
		// A PEM BLOCK is certain from its BEGIN line to the end of its END line (r7: r6 stopped at the BEGIN line's own closing dashes, so the
		// body was only statistical and /keep gave it back -- Second's attack A28)
		if (CardRuleOn(QaRulePem))
		{
			if (Pem == 0 && Span.Word.Contains(TEXT("-----BEGIN")))
			{
				Pem = 1;
			}
			if (Pem != 0)
			{
				Class[Index] = 2;
				Shape[Index] = true;
				if (Pem == 1)
				{
					const int32 EndAt = Span.Word.Find(TEXT("-----END"));
					if (EndAt != INDEX_NONE)
					{
						Pem = Span.Word.Mid(EndAt + 8).Contains(TEXT("-----")) ? 0 : 2;
					}
				}
				else if (Span.Word.Contains(TEXT("-----")))
				{
					Pem = 0;
				}
				continue;
			}
		}
		else
		{
			const bool bPemStart = Span.Word.Contains(TEXT("-----BEGIN"));
			bInPem |= bPemStart;
			if (bInPem)
			{
				Class[Index] = 2;
				Shape[Index] = true;
				if (!bPemStart && Span.Word.Contains(TEXT("-----")))
				{
					bInPem = false;
				}
				continue;
			}
		}
		// A VALUE GLUED TO THE MARKER (r6) is screened as the credential it most likely is, whole
		if (Span.bGlued && !Span.Word.IsEmpty())
		{
			Take(Index, Span.Word, ECardLabelKind::Normal, false, FString(), false);
		}
		const FString PreviousLower = Index > 0 ? Spans[Index - 1].Lower : FString();
		const bool bQualified = Index > 0 && (CardLabelQualifier(PreviousLower) || (CardRuleOn(QaRuleLabels) && CardOneOf(PreviousLower, CardQualifiersR7)));
		FCardLabelValue LabelValue = CardLabelWithValueR7(Span.Word, Span.Orig);
		// a two-word label glued to its value: "api key:X", "client secret=X", "license key:X"
		if (!LabelValue.bFound && bQualified && CardRuleOn(QaRuleLabelForms) && CardGluedTwoWordValue(Span.Lower))
		{
			int32 Cut = 0;
			while (Cut < Span.Word.Len() && Span.Word[Cut] != TEXT(':') && Span.Word[Cut] != TEXT('='))
			{
				++Cut;
			}
			FString Value = Span.Word.Mid(Cut + 1);
			while (Value.Len() > 0 && (Value[0] == TEXT(':') || Value[0] == TEXT('=')))
			{
				Value.RightChopInline(1);
			}
			LabelValue.bFound = true;
			LabelValue.Kind = ECardLabelKind::Normal;
			LabelValue.Value = CardTrimEdges(Value);
		}
		if (!Span.Word.IsEmpty() && LabelValue.bFound && LabelValue.bSchemeNext)
		{
			// "Authorization:Bearer X" (r7): the scheme stays readable, X goes
			if (Index + 1 < NumSpans && !Spans[Index + 1].bMarker)
			{
				Take(Index + 1, Spans[Index + 1].Word, ECardLabelKind::Token, true, FString(), false);
			}
		}
		else if (!Span.Word.IsEmpty() && LabelValue.bFound)
		{
			Take(Index, LabelValue.Value, LabelValue.Kind, true, LabelValue.Rest, false);
		}
		else if (!Span.Word.IsEmpty() && CardUrlUserinfoPassword(Span.Word))
		{
			Class[Index] = 2;
			Shape[Index] = true;
			TakenWhole[Index] = true;
		}
		else if (!Span.Word.IsEmpty() && CardShapeCertain(Span.Word))
		{
			Class[Index] = 2;
			Shape[Index] = true;
		}
		else if (!Span.Word.IsEmpty() && !bClasses && (CardHasCredentialWord(Span.Word) || Span.Word.Contains(TEXT("-----"))))
		{
			// r6: a credential WORD was certain on its own; r7 finds the value it carries (label=value) or nothing
			Class[Index] = 2;
			Shape[Index] = true;
		}
		// the word after "Bearer"; after "Basic" when it looks like base64 -- an Authorization scheme's credential is one by its place
		if (Index + 1 < NumSpans && !Spans[Index + 1].bMarker)
		{
			const FSpan& After = Spans[Index + 1];
			if ((Span.Lower == TEXT("bearer") || (Span.Lower == TEXT("basic") && CardBase64Word(After.Word))) && !(bClasses && CardOneOf(After.Lower, CardStopwords)))
			{
				const bool bSchemeValue = Span.Lower == TEXT("basic") || (CardValueLike(After.Word, ECardLabelKind::Token) && After.Word.Len() >= 8);
				Take(Index + 1, After.Word, ECardLabelKind::Token, true, FString(), bSchemeValue);
			}
		}
		// A LOGIN PAIR without a URL (r6): "login admin:<value>"; r7: after a CLI user flag ("curl -u admin:<value>")
		const bool bLoginWord = Index > 0 && (CardOneOf(PreviousLower, CardLoginWords) || (CardRuleOn(QaRuleCli) && CardOneOf(Spans[Index - 1].Word, CardCliLoginFlags)));
		if (CardRuleOn(QaRuleLoginPair) && bLoginWord && CardLoginPair(Span.Word))
		{
			int32 Colon = INDEX_NONE;
			Span.Word.FindChar(TEXT(':'), Colon);
			Take(Index, Span.Word.Mid(Colon + 1), ECardLabelKind::Normal, true, FString(), false);
		}
		// r7 (QaRuleCli; Second's finding 3): a CLI password flag after its own command, user:X@host with no scheme, https://X@host, "login bob / X"
		if (CardRuleOn(QaRuleCli))
		{
			for (const FCardCliPassword& Cli : CardCliPasswords)
			{
				if (!Span.Word.StartsWith(Cli.Flag, ESearchCase::CaseSensitive))
				{
					continue;
				}
				bool bAfterCommand = false;
				if (bPerf)
				{
					const int32* CommandAt = FirstAt.Find(FString(Cli.Command));
					bAfterCommand = CommandAt != nullptr && *CommandAt < Index;
				}
				else
				{
					for (int32 Before = 0; Before < Index && !bAfterCommand; ++Before)
					{
						bAfterCommand = Spans[Before].Lower.Equals(Cli.Command, ESearchCase::CaseSensitive);
					}
				}
				if (!bAfterCommand)
				{
					continue;
				}
				const int32 FlagLen = FCString::Strlen(Cli.Flag);
				if (Span.Word.Equals(Cli.Flag, ESearchCase::CaseSensitive))
				{
					if (Index + 1 < NumSpans && !Spans[Index + 1].bMarker)
					{
						Take(Index + 1, Spans[Index + 1].Word, ECardLabelKind::Normal, true, FString(), false);
					}
				}
				else if (Span.Word.Len() > FlagLen && Span.Word[FlagLen] != TEXT('-'))
				{
					Take(Index, Span.Word.Mid(FlagLen), ECardLabelKind::Normal, true, FString(), false);
				}
				break;
			}
			const FString Userinfo = CardSchemelessUserinfo(Span.Word);
			if (!Userinfo.IsEmpty())
			{
				Take(Index, Userinfo, ECardLabelKind::Normal, true, FString(), false);
			}
			const FString UserToken = CardUrlUserToken(Span.Word);
			if (!UserToken.IsEmpty() && CardValueLike(UserToken, ECardLabelKind::Token))
			{
				Take(Index, UserToken, ECardLabelKind::Token, true, FString(), false);
			}
			if (Span.Raw == TEXT("/") && Index >= 2 && CardOneOf(Spans[Index - 2].Lower, CardLoginWords) && Index + 1 < NumSpans && !Spans[Index + 1].bMarker
				&& CardValueLike(Spans[Index + 1].Word, ECardLabelKind::Normal))
			{
				Take(Index + 1, Spans[Index + 1].Word, ECardLabelKind::Normal, true, FString(), false);
			}
		}
		// THE LABEL WINDOW
		ECardLabelKind Kind = CardLabelKind(Span.Word, Span.Orig, PreviousLower);
		if (Kind == ECardLabelKind::None && bQualified && (Span.Lower == TEXT("key") || Span.Lower == TEXT("secret")))
		{
			Kind = ECardLabelKind::Normal;
		}
		if (Kind == ECardLabelKind::None || Span.Raw.IsEmpty() || !CardRuleOn(QaRuleLabelWindow))
		{
			continue;
		}
		LabelWindow(Index, Kind, CardPasswordFamilyLabel(Span.Word, Span.Orig));
	}
	// EVERY OCCURRENCE of a value a label found (r7, Second's (d): redaction by position left "password: X (again: X)" showing its second X).
	// A certain value goes wherever it stands, glued into another word or not; a weak one only as a word of its own ("pass" never takes
	// "passwords").
	if (bContinue)
	{
		if (bPerf)
		{
			// r8: each distinct value once, at its strongest, at most CardMaxValues of them (r7 searched every word for every value found,
			// each repeat again: 88k characters took 1.4 s in Second's port)
			TArray<TPair<FString, uint8>> Distinct;
			TMap<FString, int32> Seen;
			for (const TPair<FString, uint8>& Found : Values)
			{
				if (const int32* Already = Seen.Find(Found.Key))
				{
					Distinct[*Already].Value = FMath::Max(Distinct[*Already].Value, Found.Value);
					continue;
				}
				if (Distinct.Num() >= CardMaxValues)
				{
					continue;
				}
				Seen.Add(Found.Key, Distinct.Num());
				Distinct.Add(Found);
			}
			Values = MoveTemp(Distinct);
		}
		for (const TPair<FString, uint8>& Found : Values)
		{
			const FString& Value = Found.Key;
			if (Value.Len() < 4 || CardOneOf(Value.ToLower(), CardStopwords))
			{
				continue;
			}
			for (int32 Index = 0; Index < NumSpans; ++Index)
			{
				const FSpan& Span = Spans[Index];
				if (Span.bMarker || Class[Index] != 0 || Span.Word.IsEmpty())
				{
					continue;
				}
				bool bHit = false;
				for (int32 At = Span.Word.Find(Value, ESearchCase::CaseSensitive); At != INDEX_NONE && !bHit;
					At = Span.Word.Find(Value, ESearchCase::CaseSensitive, ESearchDir::FromStart, At + 1))
				{
					const TCHAR Before = At > 0 ? Span.Word[At - 1] : TEXT(' ');
					const TCHAR After = At + Value.Len() < Span.Word.Len() ? Span.Word[At + Value.Len()] : TEXT(' ');
					bHit = Found.Value == 2 || !(FChar::IsAlnum(Before) || FChar::IsAlnum(After));
				}
				if (bHit)
				{
					Class[Index] = Found.Value;
					TakenWhole[Index] = true;
				}
			}
		}
	}
	for (int32 Index = 0; Index < NumSpans; ++Index)
	{
		const FSpan& Span = Spans[Index];
		// the marker is never a find, whatever rule pointed at it
		if (Span.Word.IsEmpty() || Span.bMarker)
		{
			continue;
		}
		if (Class[Index] != 0)
		{
			const bool bWhole = TakenWhole[Index];
			FSecretFind Find;
			OntoText(bWhole ? Span.RawStart : Span.Start, bWhole ? Span.RawEnd : Span.End, Find);
			Find.bCertain = Class[Index] == 2;
			Find.bWeak = Class[Index] == 1;
			Find.bShape = Shape[Index];
			OutFinds.Add(Find);
			continue;
		}
		if (CardWordIsStructure(Span.Word))
		{
			continue;
		}
		bool bUrl = false;
		if (CardUrlLooksSecret(Span.Word, bUrl))
		{
			FSecretFind Find;
			OntoText(Span.Start, Span.End, Find);
			OutFinds.Add(Find);
			continue;
		}
		if (bUrl)
		{
			continue;
		}
		if (CardPiecesLookRandom(Span.Word.Replace(TEXT("."), TEXT(" "))))
		{
			FSecretFind Find;
			OntoText(Span.Start, Span.End, Find);
			OutFinds.Add(Find);
		}
	}
}

FString FWonderlandCardStore::RedactSecrets(const FString& Text, const TArray<FSecretFind>& Finds, bool bKeepStatistical)
{
	FString Out;
	int32 From = 0;
	for (const FSecretFind& Find : Finds)
	{
		if (bKeepStatistical && !Find.bCertain)
		{
			continue;
		}
		Out += Text.Mid(From, Find.Start - From);
		Out += CardRedactionMarker();
		From = Find.Start + Find.Length;
	}
	Out += Text.Mid(From);
	return Out;
}

FString FWonderlandCardStore::WithoutInvisibleText(const FString& Text)
{
	return WithoutInvisible(Text);
}

void FWonderlandCardStore::ScreenText(const FString& Text, FString& OutScreened, TArray<FSecretFind>& OutFinds)
{
	OutFinds.Reset();
	const bool bSpaces = CardRuleOn(QaRuleSpaces);
	const bool bFold = CardRuleOn(QaRuleFold);
	// TWO VIEWS OF ONE LINE, character for character: JOINED (what is stored: spaces normalised, invisibles gone -- a key split by a
	// zero-width space is whole again) and SPLIT (the invisibles as spaces too -- a label and its value split by one stay two words)
	FString Joined;
	FString Split;
	TArray<int32> SplitToJoined;
	Joined.Reserve(Text.Len());
	Split.Reserve(Text.Len());
	SplitToJoined.Reserve(Text.Len());
	for (int32 Index = 0; Index < Text.Len(); ++Index)
	{
		const uint32 Code = static_cast<uint32>(Text[Index]);
		// a pair that draws nothing (CardInvisiblePair): a TAG character, and (r7) a supplement variation selector, a musical or shorthand
		// format control
		if (Code >= 0xD800 && Code <= 0xDBFF && Index + 1 < Text.Len() && CardInvisiblePair(Code, static_cast<uint32>(Text[Index + 1])))
		{
			Split.AppendChar(TEXT(' '));
			Split.AppendChar(TEXT(' '));
			SplitToJoined.Add(INDEX_NONE);
			SplitToJoined.Add(INDEX_NONE);
			++Index;
			continue;
		}
		// r7: a blank glyph (U+2800, the Hangul fillers) separates words as a space does
		if (bSpaces && (CardSpaceLike(Code) || (bFold && CardBlankGlyph(Code))))
		{
			SplitToJoined.Add(Joined.Len());
			Joined.AppendChar(TEXT(' '));
			Split.AppendChar(TEXT(' '));
			continue;
		}
		// r7: a variation selector, CGJ or the like is as invisible as a zero-width space
		if (IsInvisible(Code) || (bFold && CardZeroWidthMark(Code)))
		{
			SplitToJoined.Add(INDEX_NONE);
			Split.AppendChar(TEXT(' '));
			continue;
		}
		SplitToJoined.Add(Joined.Len());
		Joined.AppendChar(Text[Index]);
		Split.AppendChar(Text[Index]);
	}
	FindSecrets(Joined, OutFinds);
	if (CardRuleOn(QaRuleBothViews))
	{
		TArray<FSecretFind> SplitFinds;
		FindSecrets(Split, SplitFinds);
		// a split find lands on the joined text WIDENED to its whole word there, never into a marker: nothing of the word is left glued
		// to the marker the redaction writes (so a second screen finds nothing new)
		TArray<bool> InMark;
		InMark.Init(false, Joined.Len());
		for (const TPair<int32, int32>& Mark : CardFindMarks(CardFold(Joined)))
		{
			for (int32 At = Mark.Key; At < Mark.Value; ++At)
			{
				InMark[At] = true;
			}
		}
		for (const FSecretFind& Find : SplitFinds)
		{
			int32 Low = INDEX_NONE;
			int32 High = INDEX_NONE;
			for (int32 At = Find.Start; At < Find.Start + Find.Length && At < SplitToJoined.Num(); ++At)
			{
				const int32 Joint = SplitToJoined[At];
				if (Joint != INDEX_NONE)
				{
					Low = Low == INDEX_NONE ? Joint : FMath::Min(Low, Joint);
					High = FMath::Max(High, Joint);
				}
			}
			if (Low == INDEX_NONE)
			{
				continue;
			}
			int32 From = Low;
			while (From > 0 && Joined[From - 1] != TEXT(' ') && !InMark[From - 1])
			{
				--From;
			}
			int32 To = High;
			while (To < Joined.Len() && Joined[To] != TEXT(' ') && !InMark[To])
			{
				++To;
			}
			FSecretFind Widened = Find;
			Widened.Start = From;
			Widened.Length = To - From;
			OutFinds.Add(Widened);
		}
		CardMergeFinds(OutFinds);
	}
	// THE FIXPOINT (r7): the screen runs again on what it would store until it finds nothing new, each new find mapped back onto the line
	// (CardRedactWithMap). A value one rule found can stand where another rule's value stood -- a label, a marker, a value -- and a second
	// pass of the screen must never see more than the first (the restore's idempotence; Second's 10,000-line fuzz: 0 change)
	if (CardRuleOn(QaRuleContinue))
	{
		FString Redacted;
		TArray<TPair<int32, int32>> Owner;
		TArray<FSecretFind> Again;
		for (int32 Pass = 0; Pass < 4; ++Pass)
		{
			CardRedactWithMap(Joined, OutFinds, Redacted, Owner);
			FindSecrets(Redacted, Again);
			if (Again.Num() == 0)
			{
				break;
			}
			for (const FSecretFind& Find : Again)
			{
				FSecretFind Mapped = Find;
				Mapped.Start = Owner[Find.Start].Key;
				Mapped.Length = Owner[Find.Start + Find.Length - 1].Value - Mapped.Start;
				OutFinds.Add(Mapped);
			}
			CardMergeFinds(OutFinds);
		}
	}
	OutScreened = MoveTemp(Joined);
}

bool FWonderlandCardStore::HoldsSecret(const FString& Text)
{
	FString Screened;
	TArray<FSecretFind> Finds;
	ScreenText(Text, Screened, Finds);
	if (Finds.Num() > 0)
	{
		return true;
	}
	FindSecrets(Text, Finds);
	return Finds.Num() > 0;
}

FString FWonderlandCardStore::MaskForDisplay(const FString& Line)
{
	// what is shown is the screened line (spaces normalised, invisibles gone), every find (certain and statistical) replaced
	FString Screened;
	TArray<FSecretFind> Finds;
	ScreenText(Line, Screened, Finds);
	return Finds.Num() > 0 ? RedactSecrets(Screened, Finds) : Line;
}

bool FWonderlandCardStore::LooksLikeSecret(const FString& Text)
{
	if (Text.IsEmpty())
	{
		return false;
	}
	if (WonderlandSidekickSecrets::LooksLikeKey(Text))
	{
		return true;
	}
	// The words a credential arrives with: a PEM block, a credential reference, a bearer token, a token or a password in a
	// URL or a config line. Any case. A label never needs any of them.
	if (CardHasCredentialWord(Text))
	{
		return true;
	}
	// A TOKEN-SHAPED RUN: 32 or more key characters holding both letters and digits. Every vendor's key is one (GitHub's,
	// Slack's, Google's, a cloud secret's); a person's label never is, and a run of one letter is not. Matched by SHAPE,
	// never by a vendor's prefix, so this file plants no key prefix in the package -- the release scan (pii_scan.py) reads
	// the package for exactly those, and a hit there must always mean a real leak.
	int32 Run = 0;
	bool bLetter = false;
	bool bDigit = false;
	for (int32 Index = 0; Index <= Text.Len(); ++Index)
	{
		const TCHAR Char = Index < Text.Len() ? Text[Index] : TEXT(' ');
		// ASCII only: keys are, and a long label in another script is not a key
		const bool bAsciiLetter = (Char >= TEXT('A') && Char <= TEXT('Z')) || (Char >= TEXT('a') && Char <= TEXT('z'));
		const bool bAsciiDigit = Char >= TEXT('0') && Char <= TEXT('9');
		if (bAsciiLetter || bAsciiDigit || Char == TEXT('_') || Char == TEXT('-') || Char == TEXT('+') || Char == TEXT('/') || Char == TEXT('='))
		{
			++Run;
			bLetter |= bAsciiLetter;
			bDigit |= bAsciiDigit;
			continue;
		}
		if (Run >= 32 && bLetter && bDigit)
		{
			return true;
		}
		Run = 0;
		bLetter = false;
		bDigit = false;
	}
	return false;
}

FString FWonderlandCardStore::CleanLabel(const FString& Text)
{
	// controls and invisible format characters are dropped: a label lands in logs and lines, never on two of them, and
	// never hides anything from the eye
	FString Out = WithoutInvisible(Text);
	Out.LeftInline(MaxLabelChars);
	// never half a character: a surrogate pair cut by the cap loses its first half too
	if (Out.Len() > 0 && static_cast<uint32>(Out[Out.Len() - 1]) >= 0xD800 && static_cast<uint32>(Out[Out.Len() - 1]) <= 0xDBFF)
	{
		Out.LeftChopInline(1);
	}
	Out.TrimStartAndEndInline();
	return Out;
}

FWonderlandCard FWonderlandCardStore::MakeDefaultCard()
{
	FWonderlandCard Card;
	Card.Id = BuiltInId();
	Card.Name = TEXT("C.A.R.D. 1");
	Card.bBuiltIn = true;
	// The two companions this build ships, on their canonical sides: the LLM Companion LEFT, Jhinn RIGHT.
	FWonderlandCompanionRef Llm;
	Llm.Slot = 0;
	Llm.Kind = EWonderlandCardCompanionKind::Llm;
	Llm.ProviderId = TEXT("dev-companion");
	Llm.Label = TEXT("LLM COMPANION");
	FWonderlandCompanionRef Jhinn;
	Jhinn.Slot = 1;
	Jhinn.Kind = EWonderlandCardCompanionKind::Agent;
	Jhinn.ProviderId = TEXT("dev-single-agent");
	Jhinn.Label = TEXT("JHINN");
	Card.Companions = { Llm, Jhinn };
	return Card;
}

void FWonderlandCardStore::ResetToDefault()
{
	Cards.Reset();
	Cards.Add(MakeDefaultCard());
	ActiveId = BuiltInId();
}

const FWonderlandCard* FWonderlandCardStore::Find(const FString& Id) const
{
	return Cards.FindByPredicate([&Id](const FWonderlandCard& Card) { return Card.Id == Id; });
}

const FWonderlandCard& FWonderlandCardStore::GetActive() const
{
	if (const FWonderlandCard* Active = Find(ActiveId))
	{
		return *Active;
	}
	// the invariant keeps a built-in card in the list; this is the last line of defence, never a crash
	static const FWonderlandCard Fallback = MakeDefaultCard();
	return Cards.Num() > 0 ? Cards[0] : Fallback;
}

TSharedPtr<FJsonObject> FWonderlandCardStore::ToJson(const FWonderlandCard& Card)
{
	const TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
	// unknown fields first, so a known field of the same name (it never is: IsKnownField) could not be shadowed
	if (Card.Unknown.IsValid())
	{
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Field : Card.Unknown->Values)
		{
			Json->SetField(Field.Key, Field.Value);
		}
	}
	Json->SetStringField(TEXT("id"), Card.Id);
	Json->SetStringField(TEXT("name"), Card.Name);
	Json->SetStringField(TEXT("missionHandoff"), Card.MissionHandoff);
	Json->SetStringField(TEXT("skin"), Card.Skin);
	Json->SetStringField(TEXT("outfit"), Card.Outfit);
	const TSharedRef<FJsonObject> Primary = MakeShared<FJsonObject>();
	Primary->SetStringField(TEXT("key"), Card.Primary.Key);
	Primary->SetBoolField(TEXT("chosen"), Card.Primary.bChosen);
	Json->SetObjectField(TEXT("primary"), Primary);
	TArray<TSharedPtr<FJsonValue>> Companions;
	for (const FWonderlandCompanionRef& Ref : Card.Companions)
	{
		const TSharedRef<FJsonObject> One = MakeShared<FJsonObject>();
		One->SetNumberField(TEXT("slot"), Ref.Slot);
		One->SetStringField(TEXT("kind"), KindName(Ref.Kind));
		One->SetStringField(TEXT("provider"), Ref.ProviderId);
		One->SetStringField(TEXT("label"), Ref.Label);
		Companions.Add(MakeShared<FJsonValueObject>(One));
	}
	Json->SetArrayField(TEXT("companions"), Companions);
	TArray<TSharedPtr<FJsonValue>> Capabilities;
	for (const FWonderlandCapabilityRef& Ref : Card.Capabilities)
	{
		const TSharedRef<FJsonObject> One = MakeShared<FJsonObject>();
		One->SetStringField(TEXT("kind"), CapabilityName(Ref.Kind));
		One->SetStringField(TEXT("id"), Ref.Id);
		One->SetStringField(TEXT("label"), Ref.Label);
		Capabilities.Add(MakeShared<FJsonValueObject>(One));
	}
	Json->SetArrayField(TEXT("capabilities"), Capabilities);
	Json->SetBoolField(TEXT("builtIn"), Card.bBuiltIn);
	return Json;
}

bool FWonderlandCardStore::FromJson(const TSharedPtr<FJsonObject>& Json, FWonderlandCard& Out, FString& OutNote)
{
	auto Note = [&OutNote](const FString& What) { OutNote += (OutNote.IsEmpty() ? TEXT("") : TEXT("; ")) + What; };
	Out = FWonderlandCard();
	if (!Json.IsValid() || !Json->TryGetStringField(TEXT("id"), Out.Id) || !IsCleanId(Out.Id))
	{
		Note(TEXT("a card without a safe id was dropped"));
		return false;
	}
	// A FIELD THAT IS ABSENT takes its default quietly (an older file); one that is PRESENT and unusable is noted. A note
	// says what was refused, never what it held.
	FString Name;
	Json->TryGetStringField(TEXT("name"), Name);
	if (!AcceptLabel(Name, Out.Name) || Out.Name.IsEmpty())
	{
		Out.Name = TEXT("C.A.R.D.");
		Note(FString::Printf(TEXT("card %s: its name was refused or empty"), *Out.Id));
	}
	FString Text;
	if (Json->TryGetStringField(TEXT("missionHandoff"), Text))
	{
		// a clean id is not enough: it must be a form this build HAS (Second's M0-5)
		if (IsCleanId(Text) && FWonderlandMissionHandoff::IsKnownForm(Text))
		{
			Out.MissionHandoff = Text;
		}
		else
		{
			Note(FString::Printf(TEXT("card %s: unknown Mission Handoff, the Angelic Twin Swords"), *Out.Id));
		}
	}
	if (Json->TryGetStringField(TEXT("skin"), Text))
	{
		if (IsCleanId(Text))
		{
			Out.Skin = Text;
		}
		else
		{
			Note(FString::Printf(TEXT("card %s: unknown skin, Relay OG"), *Out.Id));
		}
	}
	if (Json->TryGetStringField(TEXT("outfit"), Text))
	{
		if (Text.IsEmpty() || IsCleanId(Text))
		{
			Out.Outfit = Text;
		}
		else
		{
			Note(FString::Printf(TEXT("card %s: unknown outfit, the skin's own clothes"), *Out.Id));
		}
	}
	const TSharedPtr<FJsonObject>* Primary = nullptr;
	if (Json->TryGetObjectField(TEXT("primary"), Primary) && Primary != nullptr && Primary->IsValid())
	{
		FString Key;
		bool bChosen = false;
		(*Primary)->TryGetBoolField(TEXT("chosen"), bChosen);
		if ((*Primary)->TryGetStringField(TEXT("key"), Key) && IsCleanId(Key))
		{
			Out.Primary.Key = Key;
			Out.Primary.bChosen = bChosen;
		}
	}
	NormalisePrimary(Out.Primary);
	const TArray<TSharedPtr<FJsonValue>>* Companions = nullptr;
	if (Json->TryGetArrayField(TEXT("companions"), Companions) && Companions != nullptr)
	{
		for (const TSharedPtr<FJsonValue>& Value : *Companions)
		{
			const TSharedPtr<FJsonObject>* One = nullptr;
			if (!Value.IsValid() || !Value->TryGetObject(One) || One == nullptr || !One->IsValid() || Out.Companions.Num() >= MaxCompanions)
			{
				continue;
			}
			FWonderlandCompanionRef Ref;
			double Slot = -1.0;
			FString Kind;
			FString Label;
			(*One)->TryGetNumberField(TEXT("slot"), Slot);
			(*One)->TryGetStringField(TEXT("kind"), Kind);
			(*One)->TryGetStringField(TEXT("provider"), Ref.ProviderId);
			(*One)->TryGetStringField(TEXT("label"), Label);
			// a slot is 0 or 1; anything else (a fraction, a huge number, NaN) is refused BEFORE any conversion to an integer
			Ref.Slot = (Slot == 0.0 || Slot == 1.0) ? static_cast<int32>(Slot) : -1;
			if ((Ref.Slot != 0 && Ref.Slot != 1) || !ParseKind(Kind, Ref.Kind) || !IsCleanId(Ref.ProviderId)
				|| !AcceptLabel(Label, Ref.Label)
				|| Out.Companions.ContainsByPredicate([&Ref](const FWonderlandCompanionRef& R) { return R.Slot == Ref.Slot; }))
			{
				Note(FString::Printf(TEXT("card %s: a companion reference was refused"), *Out.Id));
				continue;
			}
			Out.Companions.Add(Ref);
		}
	}
	const TArray<TSharedPtr<FJsonValue>>* Capabilities = nullptr;
	if (Json->TryGetArrayField(TEXT("capabilities"), Capabilities) && Capabilities != nullptr)
	{
		for (const TSharedPtr<FJsonValue>& Value : *Capabilities)
		{
			const TSharedPtr<FJsonObject>* One = nullptr;
			if (!Value.IsValid() || !Value->TryGetObject(One) || One == nullptr || !One->IsValid())
			{
				continue;
			}
			if (Out.Capabilities.Num() >= MaxCapabilities)
			{
				Note(FString::Printf(TEXT("card %s: capabilities beyond %d were dropped"), *Out.Id, MaxCapabilities));
				break;
			}
			FWonderlandCapabilityRef Ref;
			FString Kind;
			FString Label;
			(*One)->TryGetStringField(TEXT("kind"), Kind);
			(*One)->TryGetStringField(TEXT("id"), Ref.Id);
			(*One)->TryGetStringField(TEXT("label"), Label);
			if (!ParseCapability(Kind, Ref.Kind) || !IsCleanId(Ref.Id) || !AcceptLabel(Label, Ref.Label))
			{
				Note(FString::Printf(TEXT("card %s: a capability reference was refused"), *Out.Id));
				continue;
			}
			Out.Capabilities.Add(Ref);
		}
	}
	// FIELDS A LATER BUILD ADDED are kept and written back -- capped, and each VALUE secret-scanned. Never logged: the
	// note says how many were dropped, not what they held.
	int32 Dropped = 0;
	for (const TPair<FString, TSharedPtr<FJsonValue>>& Field : Json->Values)
	{
		if (IsKnownField(Field.Key))
		{
			continue;
		}
		if (!Out.Unknown.IsValid())
		{
			Out.Unknown = MakeShared<FJsonObject>();
		}
		const TSharedRef<FJsonObject> Probe = MakeShared<FJsonObject>();
		Probe->SetField(TEXT("v"), Field.Value);
		const FString Shape = Serialise(Probe);
		// every string and key inside the value is also read as itself, at every depth: the serialised shape escapes control
		// characters, which would hide a key split by one
		if (!IsCleanId(Field.Key) || Out.Unknown->Values.Num() >= MaxUnknownFields || Shape.Len() > MaxUnknownBytes
			|| LooksLikeSecret(Shape) || JsonHoldsSecret(Field.Value, 0))
		{
			++Dropped;
			continue;
		}
		Out.Unknown->SetField(Field.Key, Field.Value);
	}
	if (Dropped > 0)
	{
		Note(FString::Printf(TEXT("card %s: %d unknown field(s) dropped (too many, too large, or secret-shaped)"), *Out.Id, Dropped));
	}
	return true;
}

void FWonderlandCardStore::Load()
{
	ResetToDefault();
	LoadNote.Reset();
	bReadOnly = false;
	WonderlandBeta::RecoverInterruptedSave(Path);
	FString Text;
	FString Why;
	if (!WonderlandBeta::LoadSealedText(Path, MaxFileBytes, Text, Why))
	{
		if (!Why.IsEmpty())
		{
			LoadNote = Refuse(FString::Printf(TEXT("Cards.sav could not be used (%s)"), *Why));
			UE_LOG(LogTemp, Warning, TEXT("WLCARD %s"), *LoadNote);
		}
		return;
	}
	// A NESTING BOMB is refused before it is parsed: thousands of brackets fit in 256 KB, and the parse and the release of
	// what it built would run that deep. No C.A.R.D. file nests more than a few levels.
	if (JsonNesting(Text) > MaxJsonNesting)
	{
		LoadNote = Refuse(FString::Printf(TEXT("Cards.sav nests deeper than %d levels"), MaxJsonNesting));
		UE_LOG(LogTemp, Warning, TEXT("WLCARD %s"), *LoadNote);
		return;
	}
	TSharedPtr<FJsonObject> Root;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
	FString Format;
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid() || !Root->TryGetStringField(TEXT("format"), Format) || Format != FormatTag)
	{
		LoadNote = Refuse(FString::Printf(TEXT("Cards.sav is sealed but does not hold %s"), FormatTag));
		UE_LOG(LogTemp, Warning, TEXT("WLCARD %s"), *LoadNote);
		return;
	}
	TArray<FWonderlandCard> Loaded;
	FString Notes;
	const TArray<TSharedPtr<FJsonValue>>* List = nullptr;
	if (Root->TryGetArrayField(TEXT("cards"), List) && List != nullptr)
	{
		for (const TSharedPtr<FJsonValue>& Value : *List)
		{
			if (Loaded.Num() >= MaxCards)
			{
				Notes += (Notes.IsEmpty() ? TEXT("") : TEXT("; ")) + FString::Printf(TEXT("cards beyond %d were dropped"), MaxCards);
				break;
			}
			const TSharedPtr<FJsonObject>* One = nullptr;
			FWonderlandCard Card;
			if (!Value.IsValid() || !Value->TryGetObject(One) || One == nullptr || !FromJson(*One, Card, Notes))
			{
				continue;
			}
			if (Loaded.ContainsByPredicate([&Card](const FWonderlandCard& C) { return C.Id == Card.Id; }))
			{
				Notes += (Notes.IsEmpty() ? TEXT("") : TEXT("; ")) + FString::Printf(TEXT("card %s: a second card with that id was dropped"), *Card.Id);
				continue;
			}
			Card.bBuiltIn = Card.Id == BuiltInId();
			Loaded.Add(MoveTemp(Card));
		}
	}
	// THE BUILT-IN CARD IS ALWAYS THERE: a file that lost it (hand-edited) gets it back, first.
	if (!Loaded.ContainsByPredicate([](const FWonderlandCard& C) { return C.bBuiltIn; }))
	{
		Loaded.Insert(MakeDefaultCard(), 0);
		if (Loaded.Num() > MaxCards)
		{
			Loaded.RemoveAt(Loaded.Num() - 1);
			Notes += (Notes.IsEmpty() ? TEXT("") : TEXT("; ")) + FString::Printf(TEXT("cards beyond %d were dropped"), MaxCards);
		}
	}
	Cards = MoveTemp(Loaded);
	FString Active;
	Root->TryGetStringField(TEXT("active"), Active);
	if (IsCleanId(Active) && Find(Active) != nullptr)
	{
		ActiveId = Active;
	}
	else
	{
		ActiveId = BuiltInId();
		Notes += (Notes.IsEmpty() ? TEXT("") : TEXT("; ")) + FString(TEXT("the active card named no card; the default is active"));
	}
	LoadNote = Notes;
	UE_LOG(LogTemp, Display, TEXT("WLCARD loaded %d card(s), active '%s'%s"), Cards.Num(), *ActiveId,
		LoadNote.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" | %s"), *LoadNote));
}

FString FWonderlandCardStore::Serialised() const
{
	const TSharedRef<FJsonObject> Root = MakeShared<FJsonObject>();
	Root->SetStringField(TEXT("format"), FormatTag);
	Root->SetStringField(TEXT("active"), ActiveId);
	TArray<TSharedPtr<FJsonValue>> List;
	for (const FWonderlandCard& Card : Cards)
	{
		List.Add(MakeShared<FJsonValueObject>(ToJson(Card)));
	}
	Root->SetArrayField(TEXT("cards"), List);
	return Serialise(Root);
}

bool FWonderlandCardStore::FitsInFile(FString& OutWhy) const
{
	// measured as the loader measures it: the UTF-8 bytes the seal will cover
	const FString Text = Serialised();
	const int64 Bytes = FTCHARToUTF8(*Text, Text.Len()).Length();
	if (Bytes > MaxFileBytes)
	{
		OutWhy = FString::Printf(TEXT("the C.A.R.D.s would no longer fit in their file (%lld KB of %lld KB)"), Bytes / 1024, MaxFileBytes / 1024);
		return false;
	}
	return true;
}

bool FWonderlandCardStore::Writable(FString& OutWhy) const
{
	if (bReadOnly)
	{
		OutWhy = TEXT("the C.A.R.D.s are read-only this session: Cards.sav could not be set aside, so it is never overwritten");
		return false;
	}
	return true;
}

FString FWonderlandCardStore::Refuse(const FString& Why)
{
	const FString Aside = WonderlandBeta::SetAsideRefusedSave(Path);
	if (Aside.IsEmpty())
	{
		// THE ORIGINAL STAYS UNTOUCHED: a file that cannot be moved aside must not be overwritten by the next save either
		bReadOnly = true;
		return FString::Printf(TEXT("%s, and it could not be set aside; the C.A.R.D.s are read-only this session"), *Why);
	}
	return FString::Printf(TEXT("%s; set aside as %s"), *Why, *FPaths::GetCleanFilename(Aside));
}

bool FWonderlandCardStore::Save() const
{
	FString Why;
	if (!Writable(Why) || !FitsInFile(Why))
	{
		// THE FILE ON DISK IS KEPT: never write what the next boot would set aside (every card would go with it)
		UE_LOG(LogTemp, Warning, TEXT("WLCARD not saved: %s; the file on disk is kept"), *Why);
		return false;
	}
	const bool bOk = WonderlandBeta::SaveSealedText(Path, Serialised());
	UE_LOG(LogTemp, Display, TEXT("WLCARD saved %d card(s), active '%s': %s"), Cards.Num(), *ActiveId, bOk ? TEXT("ok") : TEXT("FAILED"));
	return bOk;
}

FString FWonderlandCardStore::NewId() const
{
	for (int32 N = Cards.Num() + 1; N < 10000; ++N)
	{
		const FString Id = FString::Printf(TEXT("card-%d"), N);
		if (Find(Id) == nullptr)
		{
			return Id;
		}
	}
	return FString();
}

bool FWonderlandCardStore::Validate(FWonderlandCard& Card, FString& OutWhy) const
{
	FString Clean;
	if (!AcceptLabel(Card.Name, Clean))
	{
		OutWhy = TEXT("that name looks like credential material; it was not stored");
		return false;
	}
	Card.Name = Clean;
	if (Card.Name.IsEmpty())
	{
		OutWhy = TEXT("a C.A.R.D. needs a name");
		return false;
	}
	if (!IsCleanId(Card.MissionHandoff) || !IsCleanId(Card.Skin)
		|| (!Card.Outfit.IsEmpty() && !IsCleanId(Card.Outfit)) || !IsCleanId(Card.Primary.Key))
	{
		OutWhy = TEXT("an id in it is not a valid id");
		return false;
	}
	if (!FWonderlandMissionHandoff::IsKnownForm(Card.MissionHandoff))
	{
		OutWhy = TEXT("that Mission Handoff form is not in this build");
		return false;
	}
	NormalisePrimary(Card.Primary);
	if (Card.Companions.Num() > MaxCompanions || Card.Capabilities.Num() > MaxCapabilities)
	{
		OutWhy = TEXT("too many companions or capabilities");
		return false;
	}
	for (FWonderlandCompanionRef& Ref : Card.Companions)
	{
		if ((Ref.Slot != 0 && Ref.Slot != 1) || !IsCleanId(Ref.ProviderId) || !AcceptLabel(Ref.Label, Clean))
		{
			OutWhy = TEXT("a companion reference is not valid (or its label looks like credential material)");
			return false;
		}
		Ref.Label = Clean;
	}
	for (FWonderlandCapabilityRef& Ref : Card.Capabilities)
	{
		if (!IsCleanId(Ref.Id) || !AcceptLabel(Ref.Label, Clean))
		{
			OutWhy = TEXT("a capability reference is not valid (or its label looks like credential material)");
			return false;
		}
		Ref.Label = Clean;
	}
	return true;
}

FString FWonderlandCardStore::Create(const FString& Name, FString& OutWhy)
{
	if (!Writable(OutWhy))
	{
		return FString();
	}
	if (Cards.Num() >= MaxCards)
	{
		OutWhy = FString::Printf(TEXT("at most %d C.A.R.D.s"), MaxCards);
		return FString();
	}
	FWonderlandCard Card = GetActive();
	Card.Id = NewId();
	Card.Name = Name;
	Card.bBuiltIn = false;
	// its own copy of the passthrough fields: two cards never share one object
	if (Card.Unknown.IsValid())
	{
		const TSharedPtr<FJsonObject> Copy = MakeShared<FJsonObject>();
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Field : Card.Unknown->Values)
		{
			Copy->SetField(Field.Key, Field.Value);
		}
		Card.Unknown = Copy;
	}
	if (Card.Id.IsEmpty() || !Validate(Card, OutWhy))
	{
		return FString();
	}
	Cards.Add(Card);
	// A COPY THAT WOULD NOT FIT is undone here, not discovered by a save (Second's M0-1): the store stays loadable
	if (!FitsInFile(OutWhy))
	{
		Cards.RemoveAt(Cards.Num() - 1);
		return FString();
	}
	return Card.Id;
}

bool FWonderlandCardStore::Rename(const FString& Id, const FString& Name, FString& OutWhy)
{
	const FWonderlandCard* Existing = Find(Id);
	if (Existing == nullptr)
	{
		OutWhy = TEXT("no such C.A.R.D.");
		return false;
	}
	FWonderlandCard Card = *Existing;
	Card.Name = Name;
	return Update(Card, OutWhy);
}

bool FWonderlandCardStore::Delete(const FString& Id, FString& OutWhy)
{
	if (!Writable(OutWhy))
	{
		return false;
	}
	const int32 Index = Cards.IndexOfByPredicate([&Id](const FWonderlandCard& Card) { return Card.Id == Id; });
	if (Index == INDEX_NONE)
	{
		OutWhy = TEXT("no such C.A.R.D.");
		return false;
	}
	if (Cards[Index].bBuiltIn)
	{
		OutWhy = TEXT("the built-in C.A.R.D. cannot be deleted");
		return false;
	}
	Cards.RemoveAt(Index);
	if (ActiveId == Id)
	{
		ActiveId = BuiltInId();
	}
	return true;
}

bool FWonderlandCardStore::Select(const FString& Id, FString& OutWhy)
{
	if (!Writable(OutWhy))
	{
		return false;
	}
	if (!IsCleanId(Id) || Find(Id) == nullptr)
	{
		OutWhy = TEXT("no such C.A.R.D.");
		return false;
	}
	ActiveId = Id;
	return true;
}

bool FWonderlandCardStore::Update(const FWonderlandCard& Card, FString& OutWhy)
{
	if (!Writable(OutWhy))
	{
		return false;
	}
	const int32 Index = Cards.IndexOfByPredicate([&Card](const FWonderlandCard& C) { return C.Id == Card.Id; });
	if (Index == INDEX_NONE)
	{
		OutWhy = TEXT("no such C.A.R.D.");
		return false;
	}
	FWonderlandCard Next = Card;
	Next.bBuiltIn = Cards[Index].bBuiltIn;
	if (!Validate(Next, OutWhy))
	{
		return false;
	}
	FWonderlandCard Previous = MoveTemp(Cards[Index]);
	Cards[Index] = MoveTemp(Next);
	// A CHANGE THAT WOULD NOT FIT is undone: the card stays exactly as it was
	if (!FitsInFile(OutWhy))
	{
		Cards[Index] = MoveTemp(Previous);
		return false;
	}
	return true;
}
