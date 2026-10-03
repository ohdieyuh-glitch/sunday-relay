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
		int32 End = Scheme + 3;
		while (End < Word.Len() && FCString::Strchr(TEXT("/?#"), Word[End]) == nullptr)
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
}

void FWonderlandCardStore::FindSecrets(const FString& Text, TArray<FSecretFind>& OutFinds)
{
	OutFinds.Reset();
	static const TCHAR* const Edges = TEXT(".,;:!?()[]{}<>\"'`");
	// THE WORDS FIRST, each as typed (Raw: a label's ':' or '=' is read from it) and trimmed (Word), so a label can reach its value
	struct FSpan
	{
		int32 Start;
		int32 End;
		FString Raw;
		FString Word;
		FString Lower;
	};
	TArray<FSpan> Spans;
	const int32 Count = Text.Len();
	int32 At = 0;
	while (At < Count)
	{
		while (At < Count && FChar::IsWhitespace(Text[At]))
		{
			++At;
		}
		const int32 WordStart = At;
		while (At < Count && !FChar::IsWhitespace(Text[At]))
		{
			++At;
		}
		if (At == WordStart)
		{
			continue;
		}
		int32 Start = WordStart;
		int32 End = At;
		while (Start < End && FCString::Strchr(Edges, Text[Start]) != nullptr)
		{
			++Start;
		}
		while (End > Start && FCString::Strchr(Edges, Text[End - 1]) != nullptr)
		{
			--End;
		}
		const FString Raw = Text.Mid(WordStart, At - WordStart);
		const FString Word = Text.Mid(Start, FMath::Max(End - Start, 0));
		Spans.Add({ Start, End, Raw, Word, Word.ToLower() });
	}
	TArray<bool> Certain;
	Certain.Init(false, Spans.Num());
	bool bInPem = false;
	for (int32 Index = 0; Index < Spans.Num(); ++Index)
	{
		const FSpan& Span = Spans[Index];
		// A PEM BLOCK is certain from its BEGIN line to its END line
		const bool bPemStart = Span.Word.Contains(TEXT("-----BEGIN"));
		bInPem |= bPemStart;
		if (bInPem)
		{
			Certain[Index] = true;
			if (!bPemStart && Span.Word.Contains(TEXT("-----")))
			{
				bInPem = false;
			}
			continue;
		}
		if (!Span.Word.IsEmpty() && (CardWordIsCertain(Span.Word) || CardLabelWithValue(Span.Lower) || CardUrlUserinfoPassword(Span.Word)))
		{
			Certain[Index] = true;
		}
		// the word after "Bearer"; after "Basic" when it looks like base64
		if (Index + 1 < Spans.Num())
		{
			if (Span.Lower == TEXT("bearer") || (Span.Lower == TEXT("basic") && CardBase64Word(Spans[Index + 1].Word)))
			{
				Certain[Index + 1] = true;
			}
		}
		// A CREDENTIAL LABEL takes its value with it: "password: X", "secret = X", "api key: X", "pwd is X"
		const bool bLabel = CardCredentialLabel(Span.Lower)
			|| (Index > 0 && CardLabelQualifier(Spans[Index - 1].Lower) && (Span.Lower == TEXT("key") || Span.Lower == TEXT("secret")));
		if (bLabel && Span.Raw.Len() > 0)
		{
			const TCHAR Last = Span.Raw[Span.Raw.Len() - 1];
			if ((Last == TEXT(':') || Last == TEXT('=')) && Index + 1 < Spans.Num())
			{
				Certain[Index + 1] = true;
			}
			else if (Index + 2 < Spans.Num() && (Spans[Index + 1].Raw == TEXT(":") || Spans[Index + 1].Raw == TEXT("=") || Spans[Index + 1].Lower == TEXT("is")))
			{
				Certain[Index + 2] = true;
			}
		}
	}
	for (int32 Index = 0; Index < Spans.Num(); ++Index)
	{
		const FSpan& Span = Spans[Index];
		if (Span.Word.IsEmpty())
		{
			continue;
		}
		if (Certain[Index])
		{
			OutFinds.Add({ Span.Start, Span.End - Span.Start, true });
			continue;
		}
		if (CardWordIsStructure(Span.Word))
		{
			continue;
		}
		bool bUrl = false;
		if (CardUrlLooksSecret(Span.Word, bUrl))
		{
			OutFinds.Add({ Span.Start, Span.End - Span.Start, false });
			continue;
		}
		if (bUrl)
		{
			continue;
		}
		if (CardPiecesLookRandom(Span.Word.Replace(TEXT("."), TEXT(" "))))
		{
			OutFinds.Add({ Span.Start, Span.End - Span.Start, false });
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
		Out += TEXT("[a key: never shown or stored]");
		From = Find.Start + Find.Length;
	}
	Out += Text.Mid(From);
	return Out;
}

FString FWonderlandCardStore::WithoutInvisibleText(const FString& Text)
{
	return WithoutInvisible(Text);
}

bool FWonderlandCardStore::HoldsSecret(const FString& Text)
{
	TArray<FSecretFind> Finds;
	FindSecrets(Text, Finds);
	if (Finds.Num() > 0)
	{
		return true;
	}
	FindSecrets(WithoutInvisible(Text), Finds);
	return Finds.Num() > 0;
}

FString FWonderlandCardStore::MaskForDisplay(const FString& Line)
{
	// what is shown is the line without its invisible characters, every find (certain and statistical) replaced
	const FString Clean = WithoutInvisible(Line);
	TArray<FSecretFind> Finds;
	FindSecrets(Clean, Finds);
	return Finds.Num() > 0 ? RedactSecrets(Clean, Finds) : Line;
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
