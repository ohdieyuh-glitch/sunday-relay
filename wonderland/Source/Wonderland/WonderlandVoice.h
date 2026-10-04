// WONDERLAND SOCIAL — party voice in the client, separated from whoever carries the audio.
//
// FOUNDER: "Architect the UI separately from the underlying voice provider so Wonderland is not permanently coupled to one
// voice backend … Do NOT fake production voice transport." The client is where voice actually runs (the microphone, the
// speakers), so the abstraction lives here too, mirroring the authority's (src/relay/social/social-voice.ts) name for name:
// the UI reads ONE FWonderlandVoiceState from ONE IWonderlandVoiceService and calls its four commands, nothing else.
//
// Until the founder chooses a provider (LiveKit, Vivox, EOS Voice … with its credentials):
//   - FWonderlandVoiceUnavailable is what every build uses: UNAVAILABLE, no provider, every command refused with
//     "VOICE TRANSPORT PENDING", and the panel says so;
//   - FWonderlandVoicePreviewScript (developer sessions only) steps through the authority's own scripted states from the
//     DEVELOPMENT PREVIEW (connecting, connected with someone speaking, muted, reconnecting, failed), each labelled, so the
//     panel can be seen in every state. It carries no audio and refuses every command.
#pragma once

#include "CoreMinimal.h"

/** One member as the voice channel sees them. Speaking is only ever true for a connected member with an open mic. */
struct FWonderlandVoiceParticipant
{
	FString UserId;
	bool bConnected = false;
	bool bMicMuted = false;
	bool bSpeaking = false;
	/** Muted by THIS listener only: nobody else stops hearing them. */
	bool bMutedLocally = false;
};

/** PartyVoiceState (social-contracts.ts). */
struct FWonderlandVoiceState
{
	FString PartyId;
	/** UNAVAILABLE, DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING, FAILED */
	FString Connection = TEXT("UNAVAILABLE");
	/** Empty when there is no provider. */
	FString ProviderId;
	/** Why, for a person: "VOICE TRANSPORT PENDING", "network changed", "provider refused" … */
	FString Detail;
	TArray<FWonderlandVoiceParticipant> Participants;
	/** A room is still HELD after a leave the provider refused (Second's RC13 review C1): LEAVE VOICE stays on offer whatever
	 *  Connection says (it reads FAILED), and a party that is gone still leaves it. Client-side only; not in social-contracts.ts. */
	bool bRoomHeld = false;
};

struct FWonderlandVoiceCommandResult
{
	bool bOk = false;
	FString Reason;
};

DECLARE_MULTICAST_DELEGATE(FOnWonderlandVoiceChanged);

/** What the party voice UI calls and listens to. Nothing else about voice reaches the UI. */
class WONDERLAND_API IWonderlandVoiceService
{
public:
	virtual ~IWonderlandVoiceService() = default;

	virtual FString GetProviderId() const = 0;
	virtual const FWonderlandVoiceState& GetState() const = 0;
	/** JOIN VOICE for the party the viewer is in. */
	virtual FWonderlandVoiceCommandResult Connect(const FString& PartyId, const TArray<FString>& MemberIds) = 0;
	/** LEAVE VOICE: the party is kept; only the voice channel is left. */
	virtual FWonderlandVoiceCommandResult Disconnect() = 0;
	virtual FWonderlandVoiceCommandResult SetMicMuted(bool bMuted) = 0;
	virtual FWonderlandVoiceCommandResult SetLocallyMuted(const FString& UserId, bool bMuted) = 0;

	/** A development preview's label for the state on show ("connected, Nova speaking"); empty for a real provider. */
	virtual FString GetPreviewLabel() const { return FString(); }

	FOnWonderlandVoiceChanged& OnChanged() { return Changed; }

protected:
	FOnWonderlandVoiceChanged Changed;
};

namespace WonderlandVoice
{
	/** The words every command of a build with no voice provider is refused with. */
	WONDERLAND_API const TCHAR* TransportPending();
}

/** The honest service of a build with no voice provider. */
class WONDERLAND_API FWonderlandVoiceUnavailable final : public IWonderlandVoiceService
{
public:
	FWonderlandVoiceUnavailable();
	virtual FString GetProviderId() const override { return FString(); }
	virtual const FWonderlandVoiceState& GetState() const override { return State; }
	virtual FWonderlandVoiceCommandResult Connect(const FString&, const TArray<FString>&) override { return Refuse(); }
	virtual FWonderlandVoiceCommandResult Disconnect() override { return Refuse(); }
	virtual FWonderlandVoiceCommandResult SetMicMuted(bool) override { return Refuse(); }
	virtual FWonderlandVoiceCommandResult SetLocallyMuted(const FString&, bool) override { return Refuse(); }

private:
	static FWonderlandVoiceCommandResult Refuse() { return FWonderlandVoiceCommandResult{false, WonderlandVoice::TransportPending()}; }
	FWonderlandVoiceState State;
};

/** DEVELOPER SESSIONS ONLY: the authority's scripted voice states, one at a time, labelled; no audio; commands refused. */
class WONDERLAND_API FWonderlandVoicePreviewScript final : public IWonderlandVoiceService
{
public:
	/** The preview's states in the authority's order, each with its label. Empty: behaves as UNAVAILABLE. */
	explicit FWonderlandVoicePreviewScript(TArray<TPair<FString, FWonderlandVoiceState>> InStates);

	virtual FString GetProviderId() const override { return GetState().ProviderId; }
	virtual const FWonderlandVoiceState& GetState() const override;
	virtual FWonderlandVoiceCommandResult Connect(const FString&, const TArray<FString>&) override { return Refuse(); }
	virtual FWonderlandVoiceCommandResult Disconnect() override { return Refuse(); }
	virtual FWonderlandVoiceCommandResult SetMicMuted(bool) override { return Refuse(); }
	virtual FWonderlandVoiceCommandResult SetLocallyMuted(const FString&, bool) override { return Refuse(); }
	virtual FString GetPreviewLabel() const override;

	/** The next scripted state (wrapping), for the panel's DEVELOPMENT PREVIEW stepper and for QA. */
	void Step();
	int32 GetIndex() const { return Index; }
	int32 Num() const { return States.Num(); }

private:
	static FWonderlandVoiceCommandResult Refuse();
	TArray<TPair<FString, FWonderlandVoiceState>> States;
	int32 Index = 0;
	FWonderlandVoiceState Empty;
};
