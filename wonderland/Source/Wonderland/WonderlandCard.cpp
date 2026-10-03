// Copyright Wonderland. C.A.R.D.: the model and its one sealed store. See WonderlandCard.h.
#include "WonderlandCard.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "HAL/FileManager.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "WonderlandBeta.h"

// The provider-key test the sidekick client already trusts (WonderlandSidekicks.cpp): one rule, not two copies of it.
namespace WonderlandSidekickSecrets
{
	bool LooksLikeKey(const FString& Text);
}

namespace
{
	const TCHAR* const FormatTag = TEXT("wonderland.cards.v1");

	const TCHAR* KindName(EWonderlandCompanionKind Kind)
	{
		switch (Kind)
		{
		case EWonderlandCompanionKind::Agent: return TEXT("agent");
		case EWonderlandCompanionKind::CompoundAgent: return TEXT("compound_agent");
		case EWonderlandCompanionKind::Harness: return TEXT("harness");
		default: return TEXT("llm");
		}
	}

	bool ParseKind(const FString& Text, EWonderlandCompanionKind& Out)
	{
		if (Text == TEXT("llm")) { Out = EWonderlandCompanionKind::Llm; return true; }
		if (Text == TEXT("agent")) { Out = EWonderlandCompanionKind::Agent; return true; }
		if (Text == TEXT("compound_agent")) { Out = EWonderlandCompanionKind::CompoundAgent; return true; }
		if (Text == TEXT("harness")) { Out = EWonderlandCompanionKind::Harness; return true; }
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

	FString Serialise(const TSharedRef<FJsonObject>& Object)
	{
		FString Out;
		const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Out);
		FJsonSerializer::Serialize(Object, Writer);
		return Out;
	}

	/** The text with every control character removed and NO length cap: what cleaning a label could reassemble. */
	FString WithoutControls(const FString& Text)
	{
		FString Out;
		Out.Reserve(Text.Len());
		for (const TCHAR Char : Text)
		{
			if (Char >= 0x20 && Char != 0x7F)
			{
				Out.AppendChar(Char);
			}
		}
		return Out;
	}

	/** Secret-shaped as written, or once its control characters are gone ("sk-\nproj-..." is "sk-proj-..." after cleaning). */
	bool LooksSecretAnyWay(const FString& Text)
	{
		return FWonderlandCardStore::LooksLikeSecret(Text) || FWonderlandCardStore::LooksLikeSecret(WithoutControls(Text));
	}

	/** A label as it is stored, or false when it is secret-shaped either way: cleaning must never reassemble a key. */
	bool AcceptLabel(const FString& Raw, FString& OutClean)
	{
		if (LooksSecretAnyWay(Raw))
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
		return WonderlandBeta::IsSafeId(Id) && !FWonderlandCardStore::LooksLikeSecret(Id);
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
	static const TCHAR* const Words[] = { TEXT("-----BEGIN"), TEXT("credentialRef"), TEXT("vault://"), TEXT("Bearer "), TEXT("token="),
		TEXT("access_token"), TEXT("api_key"), TEXT("apikey="), TEXT("password="), TEXT("secret=") };
	for (const TCHAR* Word : Words)
	{
		if (Text.Contains(Word, ESearchCase::IgnoreCase))
		{
			return true;
		}
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
	FString Out;
	Out.Reserve(FMath::Min(Text.Len(), MaxLabelChars));
	for (const TCHAR Char : Text)
	{
		// newlines and every other control character are dropped: a label lands in logs and lines, never on two of them
		if (Char < 0x20 || Char == 0x7F)
		{
			continue;
		}
		Out.AppendChar(Char);
		if (Out.Len() >= MaxLabelChars)
		{
			break;
		}
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
	Llm.Kind = EWonderlandCompanionKind::Llm;
	Llm.ProviderId = TEXT("dev-companion");
	Llm.Label = TEXT("LLM COMPANION");
	FWonderlandCompanionRef Jhinn;
	Jhinn.Slot = 1;
	Jhinn.Kind = EWonderlandCompanionKind::Agent;
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
		if (IsCleanId(Text))
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
		// a string value is also read as itself: the serialised shape escapes its control characters, which would hide a
		// key split by one
		FString AsText;
		const bool bStringSecret = Field.Value.IsValid() && Field.Value->Type == EJson::String && Field.Value->TryGetString(AsText)
			&& LooksSecretAnyWay(AsText);
		if (!IsCleanId(Field.Key) || Out.Unknown->Values.Num() >= MaxUnknownFields || Shape.Len() > MaxUnknownBytes
			|| LooksLikeSecret(Shape) || bStringSecret)
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
	WonderlandBeta::RecoverInterruptedSave(Path);
	FString Text;
	FString Why;
	if (!WonderlandBeta::LoadSealedText(Path, MaxFileBytes, Text, Why))
	{
		if (!Why.IsEmpty())
		{
			const FString Aside = WonderlandBeta::SetAsideRefusedSave(Path);
			LoadNote = FString::Printf(TEXT("Cards.sav could not be used (%s); set aside as %s"), *Why, *FPaths::GetCleanFilename(Aside));
			UE_LOG(LogTemp, Warning, TEXT("WLCARD %s"), *LoadNote);
		}
		return;
	}
	// A NESTING BOMB is refused before it is parsed: thousands of brackets fit in 256 KB, and the parse and the release of
	// what it built would run that deep. No C.A.R.D. file nests more than a few levels.
	if (JsonNesting(Text) > MaxJsonNesting)
	{
		const FString Aside = WonderlandBeta::SetAsideRefusedSave(Path);
		LoadNote = FString::Printf(TEXT("Cards.sav nests deeper than %d levels; set aside as %s"), MaxJsonNesting, *FPaths::GetCleanFilename(Aside));
		UE_LOG(LogTemp, Warning, TEXT("WLCARD %s"), *LoadNote);
		return;
	}
	TSharedPtr<FJsonObject> Root;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
	FString Format;
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid() || !Root->TryGetStringField(TEXT("format"), Format) || Format != FormatTag)
	{
		const FString Aside = WonderlandBeta::SetAsideRefusedSave(Path);
		LoadNote = FString::Printf(TEXT("Cards.sav is sealed but does not hold %s; set aside as %s"), FormatTag, *FPaths::GetCleanFilename(Aside));
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
			if (Value.IsValid() && Value->TryGetObject(One) && One != nullptr && FromJson(*One, Card, Notes)
				&& !Loaded.ContainsByPredicate([&Card](const FWonderlandCard& C) { return C.Id == Card.Id; }))
			{
				Card.bBuiltIn = Card.Id == BuiltInId();
				Loaded.Add(MoveTemp(Card));
			}
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

bool FWonderlandCardStore::Save() const
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
	const bool bOk = WonderlandBeta::SaveSealedText(Path, Serialise(Root));
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
	Cards[Index] = MoveTemp(Next);
	return true;
}
