#include "WonderlandSocialService.h"

#include "Dom/JsonObject.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

// Named, not anonymous: the module is one unity translation unit, and WonderWebBrowse already has a `Str`.
namespace WonderlandSocialJson
{
	/** A preview that grew past this is not a preview; refuse rather than parse it. */
	constexpr int64 MaxBytes = 1024 * 1024;

	FString Str(const TSharedPtr<FJsonObject>& Json, const TCHAR* Field)
	{
		FString Value;
		return Json.IsValid() && Json->TryGetStringField(Field, Value) ? Value : FString();
	}

	bool Bool(const TSharedPtr<FJsonObject>& Json, const TCHAR* Field)
	{
		bool Value = false;
		return Json.IsValid() && Json->TryGetBoolField(Field, Value) && Value;
	}

	TSharedPtr<FJsonObject> Obj(const TSharedPtr<FJsonObject>& Json, const TCHAR* Field)
	{
		const TSharedPtr<FJsonObject>* Value = nullptr;
		return Json.IsValid() && Json->TryGetObjectField(Field, Value) && Value != nullptr ? *Value : nullptr;
	}

	const TArray<TSharedPtr<FJsonValue>>* Arr(const TSharedPtr<FJsonObject>& Json, const TCHAR* Field)
	{
		const TArray<TSharedPtr<FJsonValue>>* Value = nullptr;
		return Json.IsValid() && Json->TryGetArrayField(Field, Value) ? Value : nullptr;
	}

	FWonderlandSocialActions Actions(const TSharedPtr<FJsonObject>& J)
	{
		FWonderlandSocialActions A;
		A.bViewProfile = Bool(J, TEXT("viewProfile"));
		A.bMessage = Bool(J, TEXT("message"));
		A.bInviteToParty = Bool(J, TEXT("inviteToParty"));
		A.bJoinParty = Bool(J, TEXT("joinParty"));
		A.bInviteToServer = Bool(J, TEXT("inviteToServer"));
		A.bJoinServer = Bool(J, TEXT("joinServer"));
		A.bSendFriendRequest = Bool(J, TEXT("sendFriendRequest"));
		A.bRemoveFriend = Bool(J, TEXT("removeFriend"));
		A.bMute = Bool(J, TEXT("mute"));
		A.bBlock = Bool(J, TEXT("block"));
		A.bReport = Bool(J, TEXT("report"));
		return A;
	}

	bool Presence(const TSharedPtr<FJsonObject>& J, FWonderlandSocialPresence& Out, FString& Problem)
	{
		if (!J.IsValid())
		{
			Problem = TEXT("a presence is missing");
			return false;
		}
		Out.UserId = Str(J, TEXT("userId"));
		Out.OnlineState = Str(J, TEXT("onlineState"));
		Out.Availability = Str(J, TEXT("availability"));
		Out.Headline = Str(J, TEXT("headline"));
		Out.bHasActivity = J->TryGetStringField(TEXT("activityLabel"), Out.ActivityLabel);
		const TSharedPtr<FJsonObject> Loc = Obj(J, TEXT("location"));
		Out.bHasLocation = Loc.IsValid();
		if (Loc.IsValid())
		{
			Out.Location.ServerId = Str(Loc, TEXT("serverId"));
			Out.Location.ServerKind = Str(Loc, TEXT("serverKind"));
			Out.Location.ServerName = Str(Loc, TEXT("serverName"));
			Out.Location.PlaceLabel = Str(Loc, TEXT("placeLabel"));
			Out.Location.NationId = Str(Loc, TEXT("nationId"));
		}
		Out.PartyId = Str(J, TEXT("partyId"));
		Out.LastSeenIso = Str(J, TEXT("lastSeenAtIso"));
		Out.Can = Actions(Obj(J, TEXT("can")));
		Out.RestrictedReason = Str(J, TEXT("restrictedReason"));
		if (Out.UserId.IsEmpty() || Out.OnlineState.IsEmpty() || Out.Headline.IsEmpty())
		{
			Problem = TEXT("a presence has no user, state or headline");
			return false;
		}
		return true;
	}

	/** A person as a list row, presence included. False (with the problem) for a row without a user or a presence. */
	bool PersonRow(const TSharedPtr<FJsonObject>& J, FWonderlandSocialPersonRow& Out, FString& Problem)
	{
		if (!J.IsValid())
		{
			Problem = TEXT("a person row is missing");
			return false;
		}
		Out.UserId = Str(J, TEXT("userId"));
		Out.DisplayName = Str(J, TEXT("displayName"));
		Out.Handle = Str(J, TEXT("handle"));
		Out.AvatarRef = Str(J, TEXT("avatarRef"));
		return Presence(Obj(J, TEXT("presence")), Out.Presence, Problem);
	}

	/** A PartyView. False (with the problem) for a party without an id. */
	bool Party(const TSharedPtr<FJsonObject>& J, FWonderlandSocialParty& Out, FString& Problem)
	{
		Out.PartyId = Str(J, TEXT("partyId"));
		if (Out.PartyId.IsEmpty())
		{
			Problem = TEXT("a party has no id");
			return false;
		}
		Out.Name = Str(J, TEXT("name"));
		Out.LeaderId = Str(J, TEXT("leaderId"));
		Out.Privacy = Str(J, TEXT("privacy"));
		Out.InvitePermission = Str(J, TEXT("invitePermission"));
		Out.bViewerIsMember = Bool(J, TEXT("viewerIsMember"));
		Out.bViewerIsLeader = Bool(J, TEXT("viewerIsLeader"));
		Out.bViewerMayInvite = Bool(J, TEXT("viewerMayInvite"));
		if (const TArray<TSharedPtr<FJsonValue>>* Members = Arr(J, TEXT("members")))
		{
			for (const TSharedPtr<FJsonValue>& V : *Members)
			{
				const TSharedPtr<FJsonObject> M = V.IsValid() ? V->AsObject() : nullptr;
				FWonderlandSocialPartyMember Member;
				Member.UserId = Str(M, TEXT("userId"));
				Member.Role = Str(M, TEXT("role"));
				Member.bSelfMuted = Bool(M, TEXT("selfMuted"));
				Out.Members.Add(MoveTemp(Member));
			}
		}
		return true;
	}

	/** A PartyVoiceState. Null fields (no party, no provider, no detail) read as empty. */
	FWonderlandVoiceState VoiceState(const TSharedPtr<FJsonObject>& J)
	{
		FWonderlandVoiceState Out;
		Out.PartyId = Str(J, TEXT("partyId"));
		Out.Connection = Str(J, TEXT("connection"));
		Out.ProviderId = Str(J, TEXT("providerId"));
		Out.Detail = Str(J, TEXT("detail"));
		if (const TArray<TSharedPtr<FJsonValue>>* People = Arr(J, TEXT("participants")))
		{
			for (const TSharedPtr<FJsonValue>& V : *People)
			{
				const TSharedPtr<FJsonObject> P = V.IsValid() ? V->AsObject() : nullptr;
				FWonderlandVoiceParticipant Person;
				Person.UserId = Str(P, TEXT("userId"));
				Person.bConnected = Bool(P, TEXT("connected"));
				Person.bMicMuted = Bool(P, TEXT("micMuted"));
				Person.bSpeaking = Bool(P, TEXT("speaking"));
				Person.bMutedLocally = Bool(P, TEXT("mutedLocally"));
				Out.Participants.Add(MoveTemp(Person));
			}
		}
		return Out;
	}

	FWonderlandSocialAgent Agent(const TSharedPtr<FJsonObject>& J)
	{
		FWonderlandSocialAgent A;
		A.AgentId = Str(J, TEXT("agentId"));
		A.Kind = Str(J, TEXT("kind"));
		A.DisplayName = Str(J, TEXT("displayName"));
		A.SystemLabel = Str(J, TEXT("systemLabel"));
		A.EmblemId = Str(J, TEXT("emblemId"));
		if (const TArray<TSharedPtr<FJsonValue>>* Ratings = Arr(J, TEXT("ratings")))
		{
			for (const TSharedPtr<FJsonValue>& V : *Ratings)
			{
				const TSharedPtr<FJsonObject> R = V.IsValid() ? V->AsObject() : nullptr;
				if (!R.IsValid())
				{
					continue;
				}
				FWonderlandSocialAgentRating& Out = A.Ratings.AddDefaulted_GetRef();
				Out.Mode = Str(R, TEXT("mode"));
				R->TryGetNumberField(TEXT("rating"), Out.Rating);
				R->TryGetNumberField(TEXT("deviation"), Out.Deviation);
				R->TryGetNumberField(TEXT("battleCount"), Out.BattleCount);
				Out.bProvisional = !R->HasField(TEXT("provisional")) || Bool(R, TEXT("provisional"));
			}
		}
		return A;
	}

	FWonderlandSocialCompanion Companion(const TSharedPtr<FJsonObject>& J)
	{
		FWonderlandSocialCompanion C;
		C.CompanionId = Str(J, TEXT("companionId"));
		C.Kind = Str(J, TEXT("kind"));
		C.DisplayName = Str(J, TEXT("displayName"));
		C.Primary = Str(J, TEXT("primary"));
		C.Secondary = Str(J, TEXT("secondary"));
		return C;
	}

	bool Profile(const TSharedPtr<FJsonObject>& J, FWonderlandSocialProfile& Out, FString& Problem)
	{
		if (!J.IsValid())
		{
			Problem = TEXT("a profile is missing");
			return false;
		}
		Out.UserId = Str(J, TEXT("userId"));
		Out.DisplayName = Str(J, TEXT("displayName"));
		Out.Handle = Str(J, TEXT("handle"));
		Out.AvatarRef = Str(J, TEXT("avatarRef"));
		Out.NationId = Str(J, TEXT("nationId"));
		Out.ClanName = Str(J, TEXT("clanName"));
		Out.MemberSinceIso = Str(J, TEXT("memberSinceIso"));
		const TSharedPtr<FJsonObject> Progression = Obj(J, TEXT("progression"));
		Out.ProgressionSource = Str(Progression, TEXT("source"));
		// RANK AND LEVEL ARE PENDING BY CONTRACT. A preview claiming either is not one this client knows how to read.
		if (Out.ProgressionSource != TEXT("PENDING") || (Progression.IsValid() && (!Progression->HasTypedField<EJson::Null>(TEXT("rank")) || !Progression->HasTypedField<EJson::Null>(TEXT("level")))))
		{
			Problem = FString::Printf(TEXT("profile %s claims a rank or level; progression is PENDING by contract"), *Out.UserId);
			return false;
		}
		const TSharedPtr<FJsonObject> Primary = Obj(J, TEXT("primaryAgent"));
		Out.bHasPrimaryAgent = Primary.IsValid();
		if (Primary.IsValid())
		{
			Out.PrimaryAgent = Agent(Primary);
		}
		const TSharedPtr<FJsonObject> Dog = Obj(J, TEXT("relayDog"));
		Out.RelayDog.SkinId = Str(Dog, TEXT("skinId"));
		Out.RelayDog.Primary = Str(Dog, TEXT("primary"));
		Out.RelayDog.Secondary = Str(Dog, TEXT("secondary"));
		Out.RelayDog.Flame = Str(Dog, TEXT("flame"));
		Out.RelayDog.AppearanceTier = Str(Dog, TEXT("appearanceTier"));
		const TSharedPtr<FJsonObject> Active = Obj(J, TEXT("activeCompanion"));
		Out.bHasActiveCompanion = Active.IsValid();
		if (Active.IsValid())
		{
			Out.ActiveCompanion = Companion(Active);
		}
		if (const TArray<TSharedPtr<FJsonValue>>* Agents = Arr(J, TEXT("showcaseAgents")))
		{
			for (const TSharedPtr<FJsonValue>& V : *Agents)
			{
				if (V.IsValid() && V->Type == EJson::Object)
				{
					Out.ShowcaseAgents.Add(Agent(V->AsObject()));
				}
			}
		}
		if (const TArray<TSharedPtr<FJsonValue>>* Companions = Arr(J, TEXT("showcaseCompanions")))
		{
			for (const TSharedPtr<FJsonValue>& V : *Companions)
			{
				if (V.IsValid() && V->Type == EJson::Object)
				{
					Out.ShowcaseCompanions.Add(Companion(V->AsObject()));
				}
			}
		}
		if (const TArray<TSharedPtr<FJsonValue>>* Stats = Arr(J, TEXT("stats")))
		{
			for (const TSharedPtr<FJsonValue>& V : *Stats)
			{
				const TSharedPtr<FJsonObject> S = V.IsValid() ? V->AsObject() : nullptr;
				if (S.IsValid())
				{
					Out.Stats.Add({Str(S, TEXT("statId")), Str(S, TEXT("label")), Str(S, TEXT("value")), Str(S, TEXT("source"))});
				}
			}
		}
		if (Out.UserId.IsEmpty() || Out.DisplayName.IsEmpty() || Out.RelayDog.SkinId.IsEmpty())
		{
			Problem = TEXT("a profile has no user, name or Relay Dog");
			return false;
		}
		return true;
	}

	bool ProfileView(const TSharedPtr<FJsonObject>& J, FWonderlandSocialProfileView& Out, FString& Problem)
	{
		if (!Profile(Obj(J, TEXT("profile")), Out.Profile, Problem) || !Presence(Obj(J, TEXT("presence")), Out.Presence, Problem))
		{
			return false;
		}
		Out.Relationship = Str(J, TEXT("relationship"));
		if (const TArray<TSharedPtr<FJsonValue>>* Mutual = Arr(J, TEXT("mutualFriendIds")))
		{
			for (const TSharedPtr<FJsonValue>& V : *Mutual)
			{
				FString Id;
				if (V.IsValid() && V->TryGetString(Id))
				{
					Out.MutualFriendIds.Add(Id);
				}
			}
		}
		const TSharedPtr<FJsonObject> Party = Obj(J, TEXT("partyStatus"));
		Out.bInParty = Bool(Party, TEXT("inParty"));
		Out.bPartyJoinable = Bool(Party, TEXT("joinable"));
		double Count = -1.0;
		Out.PartyMemberCount = Party.IsValid() && Party->TryGetNumberField(TEXT("memberCount"), Count) ? static_cast<int32>(Count) : -1;
		return true;
	}

	// ---- LFF (social-lff.ts's views). Strict, as the snapshot's parse is: a required field missing or outside its vocabulary refuses the
	// whole answer. A field the contract allows to be null (availableSlots, viewerRequest, authorProfile, accepted, post, nextCursor) reads
	// as absent; any other type there is refused, never guessed at.

	/** A whole number (JSON has only doubles): false when absent, not a number, or not whole. */
	bool Whole(const TSharedPtr<FJsonObject>& J, const TCHAR* Field, int64& Out)
	{
		double Value = 0.0;
		if (!J.IsValid() || !J->TryGetNumberField(Field, Value) || !FMath::IsFinite(Value) || Value != FMath::FloorToDouble(Value))
		{
			return false;
		}
		Out = static_cast<int64>(Value);
		return true;
	}

	/** True when the field is there and is neither null nor an object: a nullable object the client must not guess at. */
	bool NeitherObjectNorNull(const TSharedPtr<FJsonObject>& J, const TCHAR* Field)
	{
		return J.IsValid() && J->HasField(Field) && !J->HasTypedField<EJson::Null>(Field) && !J->HasTypedField<EJson::Object>(Field);
	}

	bool IsPostStatus(const FString& S) { return S == TEXT("OPEN") || S == TEXT("CLOSED") || S == TEXT("EXPIRED"); }

	/**
	 * AN LFF ID AS THE AUTHORITY MINTS IT (lffp_<n>, lffr_<n>): 1-80 ASCII letters, digits, '_' or '-'. Anything else refuses the answer
	 * (the security review's m3): an id is written into a refusal that may reach a Warning line, so a line break in one could forge a log
	 * line, and an id that is not one is not a view this client knows.
	 */
	bool IsLffId(const FString& Id)
	{
		if (Id.IsEmpty() || Id.Len() > 80)
		{
			return false;
		}
		for (const TCHAR Character : Id)
		{
			const bool bAscii = (Character >= TEXT('A') && Character <= TEXT('Z')) || (Character >= TEXT('a') && Character <= TEXT('z'))
				|| (Character >= TEXT('0') && Character <= TEXT('9')) || Character == TEXT('_') || Character == TEXT('-');
			if (!bAscii)
			{
				return false;
			}
		}
		return true;
	}

	/** What the REQUESTER is shown of their own request (LFF_REQUESTER_STATUSES). */
	bool IsRequesterStatus(const FString& S)
	{
		return S == TEXT("PENDING") || S == TEXT("ACCEPTED") || S == TEXT("DECLINED") || S == TEXT("NO_LONGER_AVAILABLE");
	}

	bool LffPost(const TSharedPtr<FJsonObject>& J, FWonderlandLffPost& Out, FString& Problem)
	{
		if (!J.IsValid())
		{
			Problem = TEXT("an LFF post is missing");
			return false;
		}
		FWonderlandLffPost Post;
		Post.PostId = Str(J, TEXT("postId"));
		Post.Category = Str(J, TEXT("category"));
		Post.CategoryLabel = Str(J, TEXT("categoryLabel"));
		Post.Title = Str(J, TEXT("title"));
		Post.Description = Str(J, TEXT("description"));
		Post.ProjectLabel = Str(J, TEXT("projectLabel"));
		Post.Status = Str(J, TEXT("status"));
		Post.CreatedAtIso = Str(J, TEXT("createdAtIso"));
		Post.UpdatedAtIso = Str(J, TEXT("updatedAtIso"));
		Post.ExpiresAtIso = Str(J, TEXT("expiresAtIso"));
		Post.bViewerIsOwner = Bool(J, TEXT("viewerIsOwner"));
		if (!IsLffId(Post.PostId) || Post.Title.IsEmpty())
		{
			Problem = TEXT("an LFF post has no valid id or no title");
			return false;
		}
		// ids only in a problem, never a title (the 10-07 log rule: a problem may reach the log)
		if (!WonderlandLffIsCategory(Post.Category) || !IsPostStatus(Post.Status))
		{
			Problem = FString::Printf(TEXT("LFF post %s has an unknown category or status"), *Post.PostId);
			return false;
		}
		if (Post.CategoryLabel.IsEmpty())
		{
			Post.CategoryLabel = WonderlandLffCategoryLabel(Post.Category);
		}
		int64 Slots = 0;
		if (!Whole(J, TEXT("openSlots"), Slots) || Slots < 1 || Slots > 20)
		{
			Problem = FString::Printf(TEXT("LFF post %s does not look for 1 to 20 people"), *Post.PostId);
			return false;
		}
		Post.OpenSlots = static_cast<int32>(Slots);
		// THE OWNER'S COUNT ONLY: null for everyone else (a count of acceptances is a roster), read as -1
		int64 Available = -1;
		if (J->HasField(TEXT("availableSlots")) && !J->HasTypedField<EJson::Null>(TEXT("availableSlots"))
			&& (!Whole(J, TEXT("availableSlots"), Available) || Available < 0 || Available > Slots))
		{
			Problem = FString::Printf(TEXT("LFF post %s has an unreadable slot count"), *Post.PostId);
			return false;
		}
		Post.AvailableSlots = static_cast<int32>(Available);
		int64 Version = 0;
		Post.Version = Whole(J, TEXT("version"), Version) ? Version : 0;
		const TArray<TSharedPtr<FJsonValue>>* Skills = Arr(J, TEXT("skills"));
		if (Skills == nullptr)
		{
			Problem = FString::Printf(TEXT("LFF post %s has no skills list"), *Post.PostId);
			return false;
		}
		for (const TSharedPtr<FJsonValue>& V : *Skills)
		{
			// a STRING, not a number read as one (FJsonValueNumber answers TryGetString too)
			FString Skill;
			if (!V.IsValid() || V->Type != EJson::String || !V->TryGetString(Skill) || Skill.IsEmpty())
			{
				Problem = FString::Printf(TEXT("LFF post %s has a skill that is not text"), *Post.PostId);
				return false;
			}
			Post.Skills.Add(MoveTemp(Skill));
		}
		if (!PersonRow(Obj(J, TEXT("author")), Post.Author, Problem))
		{
			return false;
		}
		if (Post.Author.UserId.IsEmpty())
		{
			Problem = FString::Printf(TEXT("LFF post %s has no author"), *Post.PostId);
			return false;
		}
		// THE VIEWER'S OWN REQUEST, or none (null); anything else is not a view this client knows
		if (const TSharedPtr<FJsonObject> Mine = Obj(J, TEXT("viewerRequest")))
		{
			Post.bHasViewerRequest = true;
			Post.ViewerRequestId = Str(Mine, TEXT("requestId"));
			Post.ViewerRequestStatus = Str(Mine, TEXT("status"));
			if (!IsLffId(Post.ViewerRequestId) || !IsRequesterStatus(Post.ViewerRequestStatus))
			{
				Problem = FString::Printf(TEXT("LFF post %s carries an unreadable request of the viewer's"), *Post.PostId);
				return false;
			}
		}
		else if (NeitherObjectNorNull(J, TEXT("viewerRequest")))
		{
			Problem = FString::Printf(TEXT("LFF post %s carries an unreadable request of the viewer's"), *Post.PostId);
			return false;
		}
		Out = MoveTemp(Post);
		return true;
	}
}

const TArray<FString>& WonderlandLffCategories()
{
	// social-lff.ts LFF_CATEGORIES, in its order; a category added there is refused here until the client knows it
	static const TArray<FString> Categories = { TEXT("TEAMS"), TEXT("BUILDERS"), TEXT("AI_ENGINEERS"), TEXT("DESIGNERS"), TEXT("COMPETITORS"), TEXT("COLLABORATORS") };
	return Categories;
}

bool WonderlandLffIsCategory(const FString& Category)
{
	// exact, case-sensitive: the authority's own tokens
	return WonderlandLffCategories().ContainsByPredicate([&Category](const FString& Known) { return Known.Equals(Category, ESearchCase::CaseSensitive); });
}

FString WonderlandLffCategoryLabel(const FString& Category)
{
	// social-lff.ts LFF_CATEGORY_LABELS, word for word
	if (Category == TEXT("TEAMS")) return TEXT("Teams");
	if (Category == TEXT("BUILDERS")) return TEXT("Builders");
	if (Category == TEXT("AI_ENGINEERS")) return TEXT("AI engineers");
	if (Category == TEXT("DESIGNERS")) return TEXT("Designers");
	if (Category == TEXT("COMPETITORS")) return TEXT("Competitors");
	if (Category == TEXT("COLLABORATORS")) return TEXT("Collaborators");
	return FString();
}

FString WonderlandLffEncodeQueryValue(const FString& Value)
{
	// THE CLIENT'S OWN ENCODER, not the engine's: the bytes it sends are fixed here, and wl.Qa.SocialLff proves them ("Wonder Web+" ->
	// "Wonder%20Web%2B"). A space is %20, never '+': the routes decode exactly once, and '+' there is a plus.
	FString Out;
	const FTCHARToUTF8 Utf8(*Value, Value.Len());
	const uint8* Bytes = reinterpret_cast<const uint8*>(Utf8.Get());
	for (int32 Index = 0; Index < Utf8.Length(); ++Index)
	{
		const uint8 Byte = Bytes[Index];
		const bool bUnreserved = (Byte >= 'A' && Byte <= 'Z') || (Byte >= 'a' && Byte <= 'z') || (Byte >= '0' && Byte <= '9')
			|| Byte == '-' || Byte == '.' || Byte == '_' || Byte == '~';
		if (bUnreserved)
		{
			Out.AppendChar(static_cast<TCHAR>(Byte));
		}
		else
		{
			Out += FString::Printf(TEXT("%%%02X"), static_cast<uint32>(Byte));
		}
	}
	return Out;
}

bool WonderlandLffFeedPath(const FWonderlandLffFeedQuery& Query, FString& OutPath, FString& OutProblem)
{
	OutPath.Reset();
	OutProblem.Reset();
	// THE FEED IS FILTERED BY THE SERVER, every page: a filter applied by the client to the page it holds would miss the posts on the others
	FString Path = FString::Printf(TEXT("/lff/posts?limit=%d"), FMath::Clamp(Query.Limit, 1, 50));
	if (!Query.Category.IsEmpty())
	{
		if (!WonderlandLffIsCategory(Query.Category))
		{
			OutProblem = TEXT("That is not a Looking For Feed category");
			return false;
		}
		Path += FString::Printf(TEXT("&category=%s"), *Query.Category);
	}
	// A FILTER IS PLAYER TEXT: any character a person types, sent percent-encoded -- but never a control character or a line break (the
	// routes refuse them, as every LFF field does; the 10-07 log-injection rule)
	const TPair<const TCHAR*, const FString*> Filters[] = { {TEXT("projectLabel"), &Query.ProjectLabel}, {TEXT("skill"), &Query.Skill} };
	for (const TPair<const TCHAR*, const FString*>& Filter : Filters)
	{
		const FString Value = Filter.Value->TrimStartAndEnd();
		if (Value.IsEmpty())
		{
			continue;
		}
		for (int32 Index = 0; Index < Value.Len(); ++Index)
		{
			const uint32 Code = static_cast<uint32>(Value[Index]);
			if (Code < 0x20 || Code == 0x7F || (Code >= 0x80 && Code <= 0x9F) || Code == 0x2028 || Code == 0x2029)
			{
				OutProblem = TEXT("A filter must not contain a control character or a line break");
				return false;
			}
			// A LONE SURROGATE IS NO TEXT (the security review's m4): UTF-8 would carry a replacement byte, a filter the player never typed
			const uint32 Next = Index + 1 < Value.Len() ? static_cast<uint32>(Value[Index + 1]) : 0;
			const bool bHigh = Code >= 0xD800 && Code <= 0xDBFF;
			if ((Code >= 0xDC00 && Code <= 0xDFFF) || (bHigh && (Next < 0xDC00 || Next > 0xDFFF)))
			{
				OutProblem = TEXT("A filter is not valid text");
				return false;
			}
			Index += bHigh ? 1 : 0;
		}
		Path += FString::Printf(TEXT("&%s=%s"), Filter.Key, *WonderlandLffEncodeQueryValue(Value));
	}
	if (Query.bMine)
	{
		Path += TEXT("&mine=1");
	}
	if (Query.bHasOpenSlots)
	{
		Path += TEXT("&hasOpenSlots=1");   // a plain token (routes lffQueryOf), read by social-commands.ts lffFlag
	}
	if (!Query.Cursor.IsEmpty())
	{
		// "<ms>.<serial>" (social-lff.ts lffCursorOf): digits and one dot, or it is not a cursor this feed gave
		bool bCursor = Query.Cursor.Len() <= 40;
		int32 Dots = 0;
		for (const TCHAR Character : Query.Cursor)
		{
			Dots += Character == TEXT('.') ? 1 : 0;
			bCursor = bCursor && (FChar::IsDigit(Character) || Character == TEXT('.'));
		}
		if (!bCursor || Dots != 1)
		{
			OutProblem = TEXT("That is not a feed position this server gave");
			return false;
		}
		Path += FString::Printf(TEXT("&cursor=%s"), *Query.Cursor);
	}
	OutPath = MoveTemp(Path);
	return true;
}

bool WonderlandParseSocialProfileView(const TSharedPtr<FJsonObject>& Json, FWonderlandSocialProfileView& Out, FString& OutProblem)
{
	if (!Json.IsValid())
	{
		OutProblem = TEXT("the profile is missing");
		return false;
	}
	FWonderlandSocialProfileView View;
	if (!WonderlandSocialJson::ProfileView(Json, View, OutProblem))
	{
		return false;
	}
	Out = MoveTemp(View);
	return true;
}

bool WonderlandParseLffPost(const TSharedPtr<FJsonObject>& Json, FWonderlandLffPost& Out, FString& OutProblem)
{
	return WonderlandSocialJson::LffPost(Json, Out, OutProblem);
}

bool WonderlandParseLffFeed(const TSharedPtr<FJsonObject>& Json, FWonderlandLffFeedPage& Out, FString& OutProblem)
{
	using namespace WonderlandSocialJson;
	const TArray<TSharedPtr<FJsonValue>>* Posts = Arr(Json, TEXT("posts"));
	if (Posts == nullptr)
	{
		OutProblem = TEXT("the feed has no posts list");
		return false;
	}
	FWonderlandLffFeedPage Page;
	for (const TSharedPtr<FJsonValue>& V : *Posts)
	{
		FWonderlandLffPost Post;
		if (!LffPost(V.IsValid() && V->Type == EJson::Object ? V->AsObject() : nullptr, Post, OutProblem))
		{
			return false;
		}
		Page.Posts.Add(MoveTemp(Post));
	}
	Page.NextCursor = Str(Json, TEXT("nextCursor"));   // null on the last page reads as empty
	Out = MoveTemp(Page);
	return true;
}

bool WonderlandParseLffPostDetail(const TSharedPtr<FJsonObject>& Json, FWonderlandLffPostDetail& Out, FString& OutProblem)
{
	using namespace WonderlandSocialJson;
	FWonderlandLffPostDetail Detail;
	if (!LffPost(Json, Detail.Post, OutProblem))
	{
		return false;
	}
	// THE AUTHOR'S CARD, exactly what profile.read would show this viewer (resolveProfileFor): opened by the existing profile panel
	if (const TSharedPtr<FJsonObject> Card = Obj(Json, TEXT("authorProfile")))
	{
		if (!ProfileView(Card, Detail.AuthorProfile, OutProblem))
		{
			return false;
		}
		Detail.bHasAuthorProfile = true;
	}
	else if (NeitherObjectNorNull(Json, TEXT("authorProfile")))
	{
		OutProblem = FString::Printf(TEXT("LFF post %s carries an unreadable author card"), *Detail.Post.PostId);
		return false;
	}
	// THE ACCEPTED LIST, for the owner and the accepted only (null for everyone else)
	if (const TArray<TSharedPtr<FJsonValue>>* Accepted = Arr(Json, TEXT("accepted")))
	{
		Detail.bHasAccepted = true;
		for (const TSharedPtr<FJsonValue>& V : *Accepted)
		{
			FWonderlandSocialPersonRow Row;
			if (!PersonRow(V.IsValid() && V->Type == EJson::Object ? V->AsObject() : nullptr, Row, OutProblem))
			{
				return false;
			}
			Detail.Accepted.Add(MoveTemp(Row));
		}
	}
	else if (Json->HasField(TEXT("accepted")) && !Json->HasTypedField<EJson::Null>(TEXT("accepted")))
	{
		OutProblem = FString::Printf(TEXT("LFF post %s carries an unreadable accepted list"), *Detail.Post.PostId);
		return false;
	}
	Out = MoveTemp(Detail);
	return true;
}

bool WonderlandParseLffMyRequests(const TSharedPtr<FJsonObject>& Json, FWonderlandLffMyRequests& Out, FString& OutProblem)
{
	using namespace WonderlandSocialJson;
	const TArray<TSharedPtr<FJsonValue>>* List = Arr(Json, TEXT("requests"));
	if (List == nullptr)
	{
		OutProblem = TEXT("the requests answer has no list");
		return false;
	}
	FWonderlandLffMyRequests Mine;
	for (const TSharedPtr<FJsonValue>& V : *List)
	{
		const TSharedPtr<FJsonObject> R = V.IsValid() && V->Type == EJson::Object ? V->AsObject() : nullptr;
		FWonderlandLffMyRequest Row;
		Row.RequestId = Str(R, TEXT("requestId"));
		Row.PostId = Str(R, TEXT("postId"));
		Row.Status = Str(R, TEXT("status"));
		Row.Message = Str(R, TEXT("message"));
		Row.CreatedAtIso = Str(R, TEXT("createdAtIso"));
		Row.UpdatedAtIso = Str(R, TEXT("updatedAtIso"));
		if (!IsLffId(Row.RequestId) || !IsLffId(Row.PostId) || !IsRequesterStatus(Row.Status))
		{
			OutProblem = TEXT("a request of the viewer's has no valid id, no valid post or an unknown status");
			return false;
		}
		// THE POST AS THE REQUESTER MAY SEE IT NOW, or null (closed, expired, its author no longer visible to them)
		if (const TSharedPtr<FJsonObject> Post = Obj(R, TEXT("post")))
		{
			if (!LffPost(Post, Row.Post, OutProblem))
			{
				return false;
			}
			Row.bHasPost = true;
		}
		else if (NeitherObjectNorNull(R, TEXT("post")))
		{
			OutProblem = FString::Printf(TEXT("request %s carries an unreadable post"), *Row.RequestId);
			return false;
		}
		Mine.Requests.Add(MoveTemp(Row));
	}
	Mine.bTruncated = Bool(Json, TEXT("truncated"));
	Out = MoveTemp(Mine);
	return true;
}

bool WonderlandParseLffPostRequests(const TSharedPtr<FJsonObject>& Json, FWonderlandLffPostRequests& Out, FString& OutProblem)
{
	using namespace WonderlandSocialJson;
	FWonderlandLffPostRequests Inbox;
	Inbox.PostId = Str(Json, TEXT("postId"));
	const TArray<TSharedPtr<FJsonValue>>* List = Arr(Json, TEXT("requests"));
	if (!IsLffId(Inbox.PostId) || List == nullptr)
	{
		OutProblem = TEXT("the post's requests answer has no valid post or no list");
		return false;
	}
	for (const TSharedPtr<FJsonValue>& V : *List)
	{
		const TSharedPtr<FJsonObject> R = V.IsValid() && V->Type == EJson::Object ? V->AsObject() : nullptr;
		FWonderlandLffIncomingRequest Row;
		Row.RequestId = Str(R, TEXT("requestId"));
		Row.Status = Str(R, TEXT("status"));
		Row.Message = Str(R, TEXT("message"));
		Row.CreatedAtIso = Str(R, TEXT("createdAtIso"));
		Row.UpdatedAtIso = Str(R, TEXT("updatedAtIso"));
		// THE OWNER'S INBOX HOLDS ONLY LIVE REQUESTS: a declined, withdrawn or cancelled one is never listed to them
		if (!IsLffId(Row.RequestId) || (Row.Status != TEXT("PENDING") && Row.Status != TEXT("ACCEPTED")))
		{
			OutProblem = TEXT("a request on the post has no valid id or is neither PENDING nor ACCEPTED");
			return false;
		}
		if (!PersonRow(Obj(R, TEXT("requester")), Row.Requester, OutProblem))
		{
			return false;
		}
		Inbox.Requests.Add(MoveTemp(Row));
	}
	Out = MoveTemp(Inbox);
	return true;
}

bool WonderlandParseSocialPreview(const TSharedPtr<FJsonObject>& Json, FWonderlandSocialSnapshot& Out, FString& OutProblem)
{
	return WonderlandParseSocialView(Json, true, Out, OutProblem);
}

bool WonderlandParseSocialView(const TSharedPtr<FJsonObject>& Json, bool bExpectPreview, FWonderlandSocialSnapshot& Out, FString& OutProblem)
{
	using namespace WonderlandSocialJson;
	if (!Json.IsValid())
	{
		OutProblem = TEXT("the social view is not an object");
		return false;
	}
	FWonderlandSocialSnapshot Parsed;
	Parsed.Schema = Str(Json, TEXT("schema"));
	const TCHAR* const Want = bExpectPreview ? TEXT("relay-wonderland-social-preview.v1") : TEXT("relay-wonderland-social-view.v1");
	if (Parsed.Schema != Want)
	{
		OutProblem = FString::Printf(TEXT("unknown schema '%s' (want '%s')"), *Parsed.Schema, Want);
		return false;
	}
	// A PREVIEW SAYS IT IS ONE, AND A LIVE VIEW SAYS IT IS NOT, or it is not read: synthetic people must never be taken for
	// live ones, and live people never be labelled synthetic.
	Parsed.bDevelopmentPreview = Bool(Json, TEXT("developmentPreview"));
	Parsed.Note = Str(Json, TEXT("note"));
	if (bExpectPreview && (!Parsed.bDevelopmentPreview || Parsed.Note.IsEmpty()))
	{
		OutProblem = TEXT("the preview does not say it is a development preview");
		return false;
	}
	if (!bExpectPreview && Parsed.bDevelopmentPreview)
	{
		OutProblem = TEXT("a live social view says it is a development preview");
		return false;
	}
	Parsed.ViewerId = Str(Json, TEXT("viewerId"));
	Parsed.GeneratedAtIso = Str(Json, TEXT("generatedAtIso"));
	if (!ProfileView(Obj(Json, TEXT("self")), Parsed.Self, OutProblem))
	{
		return false;
	}
	if (const TArray<TSharedPtr<FJsonValue>>* Friends = Arr(Json, TEXT("friends")))
	{
		for (const TSharedPtr<FJsonValue>& V : *Friends)
		{
			FWonderlandSocialPersonRow Row;
			if (!PersonRow(V.IsValid() ? V->AsObject() : nullptr, Row, OutProblem))
			{
				return false;
			}
			Parsed.NamesById.Add(Row.UserId, Row.DisplayName);
			Parsed.Friends.Add(MoveTemp(Row));
		}
	}
	// FRIEND REQUESTS: incoming name who they are FROM, outgoing who they are TO.
	if (const TSharedPtr<FJsonObject> Requests = Obj(Json, TEXT("requests")))
	{
		const TPair<const TCHAR*, const TCHAR*> Sides[] = {{TEXT("incoming"), TEXT("from")}, {TEXT("outgoing"), TEXT("to")}};
		for (const TPair<const TCHAR*, const TCHAR*>& Side : Sides)
		{
			if (const TArray<TSharedPtr<FJsonValue>>* List = Arr(Requests, Side.Key))
			{
				for (const TSharedPtr<FJsonValue>& V : *List)
				{
					const TSharedPtr<FJsonObject> R = V.IsValid() ? V->AsObject() : nullptr;
					FWonderlandSocialRequestRow Row;
					Row.RequestId = Str(R, TEXT("requestId"));
					if (Row.RequestId.IsEmpty() || !PersonRow(Obj(R, Side.Value), Row.Person, OutProblem))
					{
						if (OutProblem.IsEmpty()) { OutProblem = TEXT("a friend request has no id"); }
						return false;
					}
					Parsed.NamesById.Add(Row.Person.UserId, Row.Person.DisplayName);
					(FCString::Strcmp(Side.Key, TEXT("incoming")) == 0 ? Parsed.IncomingRequests : Parsed.OutgoingRequests).Add(MoveTemp(Row));
				}
			}
		}
	}
	if (const TArray<TSharedPtr<FJsonValue>>* Recent = Arr(Json, TEXT("recentPlayers")))
	{
		for (const TSharedPtr<FJsonValue>& V : *Recent)
		{
			const TSharedPtr<FJsonObject> R = V.IsValid() ? V->AsObject() : nullptr;
			FWonderlandSocialRecentRow Row;
			if (!PersonRow(Obj(R, TEXT("person")), Row.Person, OutProblem))
			{
				return false;
			}
			Row.Context = Str(R, TEXT("context"));
			Row.ContextLabel = Str(R, TEXT("contextLabel"));
			Row.MetAtIso = Str(R, TEXT("metAtIso"));
			Parsed.NamesById.Add(Row.Person.UserId, Row.Person.DisplayName);
			Parsed.RecentPlayers.Add(MoveTemp(Row));
		}
	}
	if (const TArray<TSharedPtr<FJsonValue>>* Invites = Arr(Json, TEXT("partyInvites")))
	{
		for (const TSharedPtr<FJsonValue>& V : *Invites)
		{
			const TSharedPtr<FJsonObject> R = V.IsValid() ? V->AsObject() : nullptr;
			FWonderlandSocialPartyInviteRow Row;
			Row.InviteId = Str(R, TEXT("inviteId"));
			Row.PartyId = Str(R, TEXT("partyId"));
			Row.PartyName = Str(R, TEXT("partyName"));
			Row.ExpiresAtIso = Str(R, TEXT("expiresAtIso"));
			if (Row.InviteId.IsEmpty() || !PersonRow(Obj(R, TEXT("from")), Row.From, OutProblem))
			{
				if (OutProblem.IsEmpty()) { OutProblem = TEXT("a party invite has no id"); }
				return false;
			}
			Parsed.PartyInvites.Add(MoveTemp(Row));
		}
	}
	// THE INBOX: conversations as the authority listed them, and each one's messages in its own sequence.
	if (const TArray<TSharedPtr<FJsonValue>>* Conversations = Arr(Json, TEXT("conversations")))
	{
		for (const TSharedPtr<FJsonValue>& V : *Conversations)
		{
			const TSharedPtr<FJsonObject> C = V.IsValid() ? V->AsObject() : nullptr;
			FWonderlandSocialConversationRow Row;
			Row.ConversationId = Str(C, TEXT("conversationId"));
			if (Row.ConversationId.IsEmpty())
			{
				OutProblem = TEXT("a conversation has no id");
				return false;
			}
			Row.Kind = Str(C, TEXT("kind"));
			Row.Title = Str(C, TEXT("title"));
			Row.OtherUserId = Str(C, TEXT("otherUserId"));
			Row.LastMessagePreview = Str(C, TEXT("lastMessagePreview"));
			Row.LastMessageAtIso = Str(C, TEXT("lastMessageAtIso"));
			double Unread = 0.0;
			Row.Unread = C.IsValid() && C->TryGetNumberField(TEXT("unread"), Unread) ? FMath::Max(0, static_cast<int32>(Unread)) : 0;
			Parsed.Conversations.Add(MoveTemp(Row));
		}
	}
	if (const TSharedPtr<FJsonObject> Messages = Obj(Json, TEXT("messages")))
	{
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Entry : Messages->Values)
		{
			const TArray<TSharedPtr<FJsonValue>>* List = nullptr;
			if (!Entry.Value.IsValid() || !Entry.Value->TryGetArray(List) || List == nullptr)
			{
				OutProblem = FString::Printf(TEXT("conversation %s's messages are not a list"), *Entry.Key);
				return false;
			}
			TArray<FWonderlandSocialMessage>& Into = Parsed.Messages.Add(Entry.Key);
			for (const TSharedPtr<FJsonValue>& V : *List)
			{
				const TSharedPtr<FJsonObject> M = V.IsValid() ? V->AsObject() : nullptr;
				FWonderlandSocialMessage Message;
				Message.MessageId = Str(M, TEXT("messageId"));
				Message.ConversationId = Entry.Key;
				double Sequence = 0.0;
				Message.Sequence = M.IsValid() && M->TryGetNumberField(TEXT("sequence"), Sequence) ? static_cast<int64>(Sequence) : 0;
				Message.SenderId = Str(M, TEXT("senderId"));
				Message.Kind = Str(M, TEXT("kind"));
				Message.Body = Str(M, TEXT("body"));
				Message.SentAtIso = Str(M, TEXT("sentAtIso"));
				Into.Add(MoveTemp(Message));
			}
			Into.StableSort([](const FWonderlandSocialMessage& A, const FWonderlandSocialMessage& B) { return A.Sequence < B.Sequence; });
		}
	}
	// PARTIES: the viewer's own (or null), the parties of friends this viewer may see, and the preview's voice script.
	if (const TSharedPtr<FJsonObject> Mine = Obj(Json, TEXT("party")))
	{
		if (!Party(Mine, Parsed.Party, OutProblem))
		{
			return false;
		}
		Parsed.bHasParty = true;
	}
	if (const TArray<TSharedPtr<FJsonValue>>* Visible = Arr(Json, TEXT("visibleParties")))
	{
		for (const TSharedPtr<FJsonValue>& V : *Visible)
		{
			FWonderlandSocialParty Seen;
			if (!Party(V.IsValid() ? V->AsObject() : nullptr, Seen, OutProblem))
			{
				return false;
			}
			Parsed.VisibleParties.Add(MoveTemp(Seen));
		}
	}
	if (const TArray<TSharedPtr<FJsonValue>>* Voice = Arr(Json, TEXT("voiceStates")))
	{
		for (const TSharedPtr<FJsonValue>& V : *Voice)
		{
			const TSharedPtr<FJsonObject> Entry = V.IsValid() ? V->AsObject() : nullptr;
			Parsed.VoiceStates.Emplace(Str(Entry, TEXT("label")), VoiceState(Obj(Entry, TEXT("state"))));
		}
	}
	if (const TSharedPtr<FJsonObject> Profiles = Obj(Json, TEXT("profiles")))
	{
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Entry : Profiles->Values)
		{
			FWonderlandSocialProfileView View;
			if (!Entry.Value.IsValid() || !ProfileView(Entry.Value->AsObject(), View, OutProblem))
			{
				return false;
			}
			Parsed.NamesById.Add(View.Profile.UserId, View.Profile.DisplayName);
			Parsed.Profiles.Add(Entry.Key, MoveTemp(View));
		}
	}
	Out = MoveTemp(Parsed);
	return true;
}

FString FWonderlandSocialPreviewService::ScenePath(const FString& Scene)
{
	// The authority writes both (src/relay/social/tools/write-social-preview.ts); "party" is the viewer in Lab Crew.
	return Scene.Equals(TEXT("party"), ESearchCase::IgnoreCase)
		? FPaths::Combine(FPaths::GetPath(DefaultPath()), TEXT("social-preview-party.json"))
		: DefaultPath();
}

FString FWonderlandSocialPreviewService::DefaultPath()
{
	return FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectDir(), TEXT("UiArt"), TEXT("Social"), TEXT("social-preview.json")));
}

bool FWonderlandSocialPreviewService::Load(const FString& Path)
{
	LastError.Reset();
	const int64 Size = IFileManager::Get().FileSize(*Path);
	if (Size <= 0 || Size > WonderlandSocialJson::MaxBytes)
	{
		LastError = Size <= 0 ? FString::Printf(TEXT("no social preview at %s"), *Path) : TEXT("the social preview is too large to be one");
		return false;
	}
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *Path))
	{
		LastError = TEXT("the social preview could not be read");
		return false;
	}
	TSharedPtr<FJsonObject> Json;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Json) || !Json.IsValid())
	{
		LastError = TEXT("the social preview is not JSON");
		return false;
	}
	FWonderlandSocialSnapshot Parsed;
	if (!WonderlandParseSocialPreview(Json, Parsed, LastError))
	{
		return false;
	}
	Snapshot = MoveTemp(Parsed);
	Changed.Broadcast();
	return true;
}

FString FWonderlandSocialPreviewService::GetSourceLine() const
{
	return TEXT("DEVELOPMENT PREVIEW · synthetic people · not connected");
}

FWonderlandSocialActionResult FWonderlandSocialPreviewService::SendMessage(const FString& ConversationId, const FString& Body)
{
	// The preview is read-only, so a message is refused like every other action: same words, same reason.
	return Request(TEXT("messages.send"), ConversationId);
}

FWonderlandSocialActionResult FWonderlandSocialPreviewService::Request(const FString& OperationId, const FString& SubjectId)
{
	// READ-ONLY, AND SAYS SO. Nothing in the preview can be changed: these are not people.
	FWonderlandSocialActionResult Result;
	Result.bOk = false;
	Result.Reason = TEXT("DEVELOPMENT PREVIEW · social is not connected in this build");
	return Result;
}

FWonderlandLffAnswer FWonderlandSocialPreviewService::LffNeedsLive()
{
	// NO LFF PEOPLE AND NO LFF POSTS IN THE PREVIEW (the LFF contract; social-fixtures.ts has none either): an honest state, never fake posts
	FWonderlandLffAnswer Answer;
	Answer.bNeedsLive = true;
	Answer.Problem = TEXT("The Looking For Feed needs a live connection: sign in to Wonderland social. The DEVELOPMENT PREVIEW has no posts.");
	return Answer;
}

void FWonderlandSocialPreviewService::ReadLffFeed(const FWonderlandLffFeedQuery& Query, FWonderlandLffFeedDone Done)
{
	Done(LffNeedsLive(), FWonderlandLffFeedPage());
}

void FWonderlandSocialPreviewService::ReadLffPost(const FString& PostId, FWonderlandLffPostDone Done)
{
	Done(LffNeedsLive(), FWonderlandLffPostDetail());
}

void FWonderlandSocialPreviewService::ReadLffPostRequests(const FString& PostId, FWonderlandLffPostRequestsDone Done)
{
	Done(LffNeedsLive(), FWonderlandLffPostRequests());
}

void FWonderlandSocialPreviewService::ReadLffMyRequests(FWonderlandLffMyRequestsDone Done)
{
	Done(LffNeedsLive(), FWonderlandLffMyRequests());
}

void FWonderlandSocialPreviewService::CreateLffPost(const FWonderlandLffPostFields& Fields, FWonderlandLffWriteDone Done)
{
	Done(LffNeedsLive(), FString());
}

void FWonderlandSocialPreviewService::EditLffPost(const FString& PostId, const FWonderlandLffPostFields& Fields, FWonderlandLffWriteDone Done)
{
	Done(LffNeedsLive(), FString());
}

void FWonderlandSocialPreviewService::SendLffRequest(const FString& PostId, const FString& Message, FWonderlandLffWriteDone Done)
{
	Done(LffNeedsLive(), FString());
}

void FWonderlandSocialPreviewService::ActOnLff(const FString& OperationId, const FString& SubjectId, FWonderlandLffWriteDone Done)
{
	Done(LffNeedsLive(), FString());
}

void FWonderlandSocialPreviewService::ReportLffPost(const FString& AuthorId, const FString& PostId, FWonderlandLffWriteDone Done)
{
	Done(LffNeedsLive(), FString());
}

void FWonderlandSocialPreviewService::ReadProfile(const FString& UserId, FWonderlandLffProfileDone Done)
{
	// the preview's profiles open from its snapshot (the existing path); nothing is fetched for a person it does not carry
	Done(LffNeedsLive(), FWonderlandSocialProfileView());
}
