// WONDERLAND SOCIAL — R16 REAL VOICE through EOS (founder, 10-04: "USE EOS VOICE … prove REAL voice between the two actual R16 clients.
// The backend may mint the required room/token authorization.").
//
// One IWonderlandVoiceService behind the panel's one state, like every other (WonderlandVoice.h): the panel and its layout do not change.
//
//   - THE PRODUCT'S IDS AND THE GAME CLIENT'S CREDENTIALS come from the founder's file, named on the command line (-WLEosConfig=<path>),
//     added to EOSShared at run time (IEOSSDKManager::AddPlatformConfig). Nothing of it is in an .ini, in the package, or in a log.
//   - EOS CONNECT gives this player a ProductUserId (PUID) by device id: a TRANSPORT identity only. Who may talk to whom is decided by
//     the authority from the GitHub-signed-in session (voiceAudienceFor); the authority mints the room token for this PUID.
//     Each instance keeps its EOS cache under its own -userdir (CORE_R16_EOS_VOICE_PLAN.md, Second's review #1: two instances on one
//     Windows user must not share one PUID -- logged, hashed, and checked on day one).
//   - THE ROOM: POST /parties/:id/voice/join {eosProductUserId} answers {providerId "eos", roomId, participantToken}; the token is the
//     JSON EOSVoiceChat joins with ({"client_base_url", "participant_token"}, EOSVoiceChatTypes.h). Leaving, removal and blocks end the
//     channel; the authority also removes the PUID from the room itself, so a modified client cannot stay.
//   - WLVOICE lines carry hashed ids only -- never a token, a URL's query or a credential.
// With no -WLEosConfig the subsystem keeps FWonderlandVoiceUnavailable: honestly pending, never a faked "connected".
#pragma once

#include "CoreMinimal.h"
#include "WonderlandVoice.h"

class FWonderlandSocialLiveService;

class WONDERLAND_API FWonderlandEosVoice final : public IWonderlandVoiceService
{
public:
	/** A service on the founder's EOS product, or null (OutWhy says why: no file, a field missing, EOS not available in this build). */
	static TUniquePtr<FWonderlandEosVoice> TryCreate(FWonderlandSocialLiveService* InLive, FString& OutWhy);
	virtual ~FWonderlandEosVoice() override;

	virtual FString GetProviderId() const override { return TEXT("eos"); }
	virtual const FWonderlandVoiceState& GetState() const override { return State; }
	virtual FWonderlandVoiceCommandResult Connect(const FString& PartyId, const TArray<FString>& MemberIds) override;
	virtual FWonderlandVoiceCommandResult Disconnect() override;
	virtual FWonderlandVoiceCommandResult SetMicMuted(bool bMuted) override;
	virtual FWonderlandVoiceCommandResult SetLocallyMuted(const FString& UserId, bool bMuted) override;

	/** For QA and the log: "eos | puid #3f2a… | signed in | room #91c0… | 2 in the room, talking: usr_b". Hashed ids only. */
	FString Describe() const;
	/** This player's PUID, hashed (the day-one check: two instances must differ). Empty until EOS Connect has signed in. */
	FString GetHashedProductUserId() const;

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
	void OnSignedIn(const FString& ProductUserId);
	void OnSignInFailed(const FString& Why);
	void StartVoice();
	void SetConnection(const TCHAR* Connection, const FString& Detail);
	void Notify();
	FWonderlandVoiceParticipant* FindParticipant(const FString& UserId);
	FString UserIdFor(const FString& ProductUserId) const;

	struct FImpl;
	TUniquePtr<FImpl> Impl;
	FWonderlandSocialLiveService* Live = nullptr;
	FConfig Config;
	FWonderlandVoiceState State;
	FString ProductUserId;
	FString RoomId;
	bool bSignedIn = false;
	bool bVoiceReady = false;
	bool bLeaving = false;
	/** lowercased PUID -> userId, as the authority's join answer bound them (Second's review #2: only server-bound mappings). */
	TMap<FString, FString> UserByProductId;
	/** The room's own spelling of each player (lowercased PUID -> as EOS names it), for muting one. */
	TMap<FString, FString> RoomNameByProductId;
	/** Callbacks hold a weak copy: a service replaced or destroyed mid-request is never called back into. */
	TSharedRef<bool> Alive = MakeShared<bool>(true);
};

namespace WonderlandEosVoice
{
	/** A short stable hash of an id, for the log (never the id itself). */
	WONDERLAND_API FString Hashed(const FString& Id);
	/** The founder's EOS file: JSON {productId, sandboxId, deploymentId, clientId, clientSecret} (the GAME client's). False: OutWhy. */
	WONDERLAND_API bool ReadConfig(const FString& Path, FWonderlandEosVoice::FConfig& Out, FString& OutWhy);
}
