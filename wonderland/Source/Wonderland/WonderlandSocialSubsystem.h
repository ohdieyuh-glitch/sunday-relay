// WONDERLAND SOCIAL — the desktop client's social state holder.
//
// A GameInstance subsystem because a person's friends, parties and conversations belong to the session, not to a level or
// a viewport. It owns ONE IWonderlandSocialService (today the read-only DEVELOPMENT PREVIEW; later the Relay Bridge over the
// `social` capability) and hands its views to the social surfaces. It holds no rules of its own: see WonderlandSocialTypes.h.
#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandSocialService.h"
#include "WonderlandSocialSignIn.h"
#include "WonderlandVoice.h"
#include "WonderlandWorldPresence.h"
#include "WonderlandSocialSubsystem.generated.h"

UCLASS()
// NO UFUNCTIONS, NO UPROPERTIES: nothing in Blueprint needs this, and every reflected name is an early FName that can shift
// Niagara's type hashes at boot (memory: niagara-fname-hash-crash). The UCLASS itself is what a subsystem has to be.
class WONDERLAND_API UWonderlandSocialSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	IWonderlandSocialService* GetService() const { return Service.Get(); }
	const FWonderlandSocialSnapshot* GetSnapshot() const { return Service.IsValid() ? &Service->GetSnapshot() : nullptr; }

	/** The profile this viewer may open, or null -- a person the authority withheld (a block) is simply not there. */
	const FWonderlandSocialProfileView* FindProfile(const FString& UserId) const;

	/** Re-read the preview (QA, and a regenerated file during development). */
	bool ReloadPreview();
	/** Developer sessions: load a preview scene ("base", or "party" with the viewer in a party). False otherwise. */
	bool LoadPreviewScene(const FString& Scene);
	const FString& GetPreviewScene() const { return Scene; }

	/** Party voice: never null. A build with no provider has the honest UNAVAILABLE service. */
	IWonderlandVoiceService* GetVoice() const { return Voice.Get(); }
	/** The live session's EOS voice, or null (no -WLEosConfig, a preview, no live session): QA and the R16 evidence commands. */
	class FWonderlandEosVoice* GetEosVoice() const;
	/** The preview's scripted voice, in a developer session with a preview; null otherwise. */
	FWonderlandVoicePreviewScript* GetVoicePreview() const { return VoicePreview; }

	/**
	 * LIVE (developer sessions): real people through the social routes at BaseUrl, as the native session Token. Replaces the
	 * preview. A PLAYER goes live only by signing in (StartSignIn), never with a token from the command line.
	 */
	bool ConnectLive(const FString& BaseUrl, const FString& Token);

	// ---- SIGN IN (R16): GitHub's device flow through the main-line bridge; see WonderlandSocialSignIn.h
	/** Never null after Initialize. */
	const FWonderlandSignInView& GetSignInView() const;
	/** SIGN IN WITH GITHUB: a code to enter at github.com/login/device; live once the player approves it. */
	void StartSignIn();
	void CancelSignIn();
	/** SIGN OUT: leave live social, revoke the session (best effort) and forget it. */
	void SignOut();
	/** Open GitHub's code page in the player's browser (while a code is shown). */
	bool OpenSignInBrowser();
	/** For QA and the log; never the token or the code. */
	FString DescribeSignIn() const;
	/** Developer sessions: mint a session for `Player` on the DEVELOPMENT social server (loopback only) and connect to it. */
	void ConnectDevSession(const FString& BaseUrl, const FString& Player);
	/** The live service, if this session is live; null otherwise. */
	class FWonderlandSocialLiveService* GetLive() const { return Live; }

	/** Whichever service is current changed its view, or a different service took over. */
	FOnWonderlandSocialChanged& OnSocialChanged() { return SocialChanged; }
	/** The VOICE alone changed (a join, someone talking): the panel redraws its voice only, never the whole hub (a half-typed message
	 *  and the keyboard focus stay -- Second's re-review). */
	FOnWonderlandSocialChanged& OnVoiceChanged() { return VoiceChanged; }
	/** A server answered an action asked earlier. */
	FOnWonderlandSocialAnswered& OnSocialAnswered() { return SocialAnswered; }

	/** MULTIPLAYER PHASE 1: the other players standing in this world, for QA ("usr_nova@(x,y,z) skin | …"). */
	FString DescribeRemotePlayers() const { return RemotePlayers.Describe(); }
	int32 NumRemotePlayers() const { return RemotePlayers.Num(); }

	FString GetSourceLine() const { return Service.IsValid() ? Service->GetSourceLine() : FString(); }

	FString GetLastError() const { return Service.IsValid() ? Service->GetLastError() : FString(TEXT("no social service")); }

	/** Open a profile on screen, the way a Friends row, a conversation or a party member does. False if not openable. */
	bool OpenProfile(const FString& UserId);

private:
	/** Go live at BaseUrl as Token. The developer gate is the caller's (ConnectLive); the sign-in path has none. */
	bool ConnectWith(const FString& BaseUrl, const FString& Token);
	/** The live service was told its session is over (401): leave live social on the next tick, never inside its callback. */
	void HandleLiveSessionEnded();
	/** Leave live social: this player's presence (best effort), the service, the other players, the voice. */
	void DropLive();
	/** Make this the service, forward its changes and answers, and tell the surfaces. */
	void Adopt(TUniquePtr<IWonderlandSocialService> NewService);
	/** A view or the voice changed: leave a voice room whose party is gone (Second's review), then tell every surface. */
	void HandleServiceChanged();
	void LeaveVoiceIfPartyGone();
	void HandleServiceAnswered(const FString& Op, const FString& Subject, const FWonderlandSocialActionResult& Answer) { SocialAnswered.Broadcast(Op, Subject, Answer); }
	void HandleWorldChanged();
	bool TickRemotePlayers(float DeltaSeconds);
	/** This player's own representation, from the local Relay Dog: the soles, facing, speed, motion, worn skin. */
	bool ReportLocalPlayer(FWonderlandAvatarReport& Out) const;

	FWonderlandRemoteAvatars RemotePlayers;
	FTSTicker::FDelegateHandle RemoteTicker;

	TUniquePtr<IWonderlandSocialService> Service;
	class FWonderlandSocialLiveService* Live = nullptr;
	FOnWonderlandSocialChanged SocialChanged;
	FOnWonderlandSocialChanged VoiceChanged;
	void HandleVoiceChanged() { VoiceChanged.Broadcast(); }
	/** THE SHIPPED VOICE PATH (founder 10-04: "the backend hands it out"): with no -WLEosConfig, ask the signed-in session's server for
	 *  the EOS game-client config and start EOS voice from it, in memory only. */
	void RequestEosConfigFromServer(int32 Attempt = 0);
	/** Bumped for every live session (ConnectWith): an answer carries the generation it was asked in. */
	int32 LiveGeneration = 0;
	FOnWonderlandSocialAnswered SocialAnswered;
	TUniquePtr<IWonderlandVoiceService> Voice;
	FWonderlandVoicePreviewScript* VoicePreview = nullptr;
	FString Scene = TEXT("base");
	TUniquePtr<FWonderlandSocialSignIn> SignIn;
	/** True while live through the sign-in (not a developer token): a 401 then returns the player to SIGN IN. */
	bool bLiveBySignIn = false;
};
