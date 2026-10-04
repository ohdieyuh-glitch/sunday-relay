// WONDERLAND SOCIAL — R16 REAL VOICE through EOS (founder, 10-04: "USE EOS VOICE … prove REAL voice between the two actual R16 clients.
// The backend may mint the required room/token authorization.").
//
// One IWonderlandVoiceService behind the panel's one state, like every other (WonderlandVoice.h): the panel and its layout do not change.
//
//   - THE PRODUCT'S IDS AND THE GAME CLIENT'S CREDENTIALS come from the founder's file, named on the command line (-WLEosConfig=<path>;
//     a .env: EOS_PRODUCT_ID, EOS_SANDBOX_ID, EOS_DEPLOYMENT_ID, EOS_GAME_CLIENT_ID, EOS_GAME_CLIENT_SECRET), added to EOSShared at run
//     time (IEOSSDKManager::AddPlatformConfig). Nothing of it is in an .ini, in the package, or in a log; the secret is dropped from this
//     object once the platform exists.
//   - EOS CONNECT gives this player a ProductUserId (PUID) by device id: a TRANSPORT identity only. Who may talk to whom is decided by
//     the authority from the GitHub-signed-in session (voiceAudienceFor; Second's backend 7ef54bdd binds PUID <-> player and mints the
//     room token for the caller's BOUND PUID only). Each instance keeps its EOS cache under its own -userdir (the day-one check: two
//     instances must not share a PUID -- logged hashed).
//   - ONE VOICE USER: IVoiceChat itself (it IS an IVoiceChatUser). Login, JoinChannel and every event go through that one object
//     (Second's review: events bound on IVoiceChat but the login on a second CreateUser() user never fired).
//   - THE ROOM: POST /parties/:id/voice/join {eosProductUserId} answers {providerId "eos", roomId, participantToken, audience
//     [{userId, puid}]}; the token is the JSON EOSVoiceChat joins with ({"client_base_url", "participant_token"}). A member the room
//     shows before the authority has bound them makes the client ask again (the join is idempotent) and re-name them.
//   - LEAVING: the panel's LEAVE, the party gone or changed (the subsystem), or the authority's removal (EXIT "by the server"; Epic
//     revokes the token, so an old token cannot rejoin -- wl.Qa.VoiceReplayOldToken tries it, for the R16 evidence).
//   - WLVOICE lines carry hashed ids only -- sha1(id) first 12 hex, PUIDs lowercased: the same as the backend's, so the evidence
//     lines join -- never a token, a URL's query or a credential.
// With no -WLEosConfig the subsystem keeps FWonderlandVoiceUnavailable: honestly pending, never a faked "connected". EOSShared itself
// initializes the SDK at every boot (unless -NoEOS): the R16 package's boot test covers both, with and without the file.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandVoice.h"

class FWonderlandSocialLiveService;
class FJsonObject;

class WONDERLAND_API FWonderlandEosVoice final : public IWonderlandVoiceService
{
public:
	/** A service on the founder's EOS product, or null (OutWhy says why: no file, a key missing, EOS not available in this build). */
	static TUniquePtr<FWonderlandEosVoice> TryCreate(FWonderlandSocialLiveService* InLive, FString& OutWhy);
	virtual ~FWonderlandEosVoice() override;

	virtual FString GetProviderId() const override { return TEXT("eos"); }
	virtual const FWonderlandVoiceState& GetState() const override { return State; }
	virtual FWonderlandVoiceCommandResult Connect(const FString& PartyId, const TArray<FString>& MemberIds) override;
	virtual FWonderlandVoiceCommandResult Disconnect() override;
	virtual FWonderlandVoiceCommandResult SetMicMuted(bool bMuted) override;
	virtual FWonderlandVoiceCommandResult SetLocallyMuted(const FString& UserId, bool bMuted) override;

	/** For QA and the log: "eos | puid #3f2a… | signed in | CONNECTED | room #91c0… | 2 in the room, talking: usr_b". Hashed ids only. */
	FString Describe() const;
	/** This player's PUID, hashed (the day-one check: two instances must differ). Empty until EOS Connect has signed in. */
	FString GetHashedProductUserId() const;
	/** R16 EVIDENCE ONLY (wl.Qa.VoiceReplayOldToken): join the LAST room again with the LAST token this client was given -- after the
	 *  authority removed this player it must be refused. The result is logged; false if there is no earlier token. */
	bool ReplayLastToken();

	/** The founder's EOS fields, as read from the file (never logged). */
	struct FConfig
	{
		FString ProductId;
		FString SandboxId;
		FString DeploymentId;
		FString ClientId;
		FString ClientSecret;
	};

private:
	FWonderlandEosVoice(FWonderlandSocialLiveService* InLive, const FConfig& InConfig);
	bool Start(FString& OutWhy);
	void SignIn();
	void OnSignedIn(const FString& InProductUserId);
	void OnSignInFailed(const FString& Why);
	/** EOS Connect's expiry notice -> a fresh login before this one lapses (Second's RC13 review: nothing renewed it). */
	void WatchAuthExpiry();
	void RenewSignIn();
	/** A leave EOS refused: keep the room, stop the microphone at once, say so (Second's RC13 review B3: it failed open). */
	void HoldRoomAfterFailedLeave(const FString& Room, const FString& ErrorCode);
	void StartVoice();
	void BindVoiceEvents();
	void JoinRoom(const FString& Room, const FString& Token);
	void ReadAudience(const TSharedPtr<FJsonObject>& Data);
	void RefreshAudience();
	void EndRoom(bool bAsked, const FString& Why);
	void SetConnection(const TCHAR* Connection, const FString& Detail);
	void Notify();
	FString ViewerId() const;
	FWonderlandVoiceParticipant& SelfParticipant();
	FWonderlandVoiceParticipant* FindParticipant(const FString& UserId);
	FString UserIdFor(const FString& InProductUserId) const;
	/** The panel row a room member was shown under (RowUserByPuid), else the authority's binding (UserIdFor). */
	FString RowUserFor(const FString& InProductUserId) const;

	struct FImpl;
	TUniquePtr<FImpl> Impl;
	FWonderlandSocialLiveService* Live = nullptr;
	FConfig Config;
	FWonderlandVoiceState State;
	FString ProductUserId;
	FString RoomId;
	bool bSignedIn = false;
	bool bSigningIn = false;
	int32 SignInAttempts = 0;
	/** A login renewal under way (RenewSignIn): its answer leaves voice and the room alone. */
	bool bRenewing = false;
	int32 RenewAttempts = 0;
	bool bVoiceReady = false;
	/** The voice start (Initialize / Connect / Login) failed: the next JOIN VOICE starts it again. */
	bool bVoiceFailed = false;
	/** A join under way (the authority asked, or the channel joining); a LEAVE meanwhile cancels it when it lands. */
	bool bJoining = false;
	bool bCancelJoin = false;
	bool bLeaving = false;
	/** This player's own leave was refused and the room is held (HoldRoomAfterFailedLeave): its later exit is a client-side drop. */
	bool bHeldAfterFailedLeave = false;
	bool bLocalMicMuted = false;
	bool bAudienceRefreshing = false;
	bool bAudienceRefreshPending = false;
	double LastAudienceRefresh = -100.0;
	/** The last room and token this client was given (memory only; the R16 old-token replay). Never logged. */
	FString LastRoomId;
	FString LastToken;
	/** lowercased PUID -> userId, as the authority's join answer bound them (Second's review #2: only server-bound mappings). */
	TMap<FString, FString> UserByProductId;
	/** The room's own spelling of each player (lowercased PUID -> as EOS names it), for muting one. */
	TMap<FString, FString> RoomNameByProductId;
	/** Each room member's row as the panel shows it (lowercased PUID -> the userId or "unbound #…" it was added under): removal and
	 *  MUTE find the row by this, never by the current binding, which an audience refresh resets (Second's RC13 review). */
	TMap<FString, FString> RowUserByPuid;
	/** Callbacks hold a weak copy: a service replaced or destroyed mid-request is never called back into. */
	TSharedRef<bool> Alive = MakeShared<bool>(true);
};

namespace WonderlandEosVoice
{
	/** An id for the log, never the id itself: "#" + sha1(id) first 12 lowercase hex -- the backend's own (eos-voice.ts), so lines join. */
	WONDERLAND_API FString Hashed(const FString& Id);
	/** The same for a PUID, lowercased first (the backend normalizes them). */
	WONDERLAND_API FString HashedPuid(const FString& InProductUserId);
	/** The founder's EOS file: a .env (EOS_PRODUCT_ID ... EOS_GAME_CLIENT_SECRET) or a JSON object. False: OutWhy names the key. */
	WONDERLAND_API bool ReadConfig(const FString& Path, FWonderlandEosVoice::FConfig& Out, FString& OutWhy);
}
