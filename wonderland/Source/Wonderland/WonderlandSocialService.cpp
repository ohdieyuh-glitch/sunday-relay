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
