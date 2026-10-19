// WONDERLAND MULTIPLAYER, PHASE 1 — the shared presence layer, in the client (founder, 2026-10-02).
//
// Each Wonderland runs its world locally. What the social backend shares (src/relay/social/world-presence.ts) is who is in
// which world context and where their representation stands: this client reports its own player's (position, facing,
// speed, motion, skin) a few times a second, reads who else is in its context, and draws each of them IN-WORLD as their
// Relay Dog -- in their own skin, from the canonical skin registry, sized to Relay OG -- with their name over it.
//
// Remote figures are drawn where their own clients say they are, eased toward each new report; nothing here simulates
// them. It is not authoritative multiplayer and does not pretend to be: a dedicated server is the seam for experiences
// that need authority (the context's `authority` says which a context is).
#pragma once

#include "CoreMinimal.h"
#include "RelayDogStride.h"
#include "WonderlandHandoffRemote.h"
#include "WonderlandHandoffSwords.h"
#include "WonderlandHandoffTransform.h"
#include "WonderlandHandoffWire.h"

class AWonderlandCompanionEmbodiment;
class UTextRenderComponent;
class UWorld;

/** One other player in this context, as the backend reported them. */
struct FWonderlandRemoteAvatar
{
	FString UserId;
	FString DisplayName;
	/** Where their Dog stands: the soles, in world units. */
	FVector Location = FVector::ZeroVector;
	float Yaw = 0.0f;
	float Speed = 0.0f;
	/** IDLE, WALK, RUN, JUMP, FALL, FLY */
	FString Motion;
	FString SkinId;
	/** MP-VIS-02 REV2: the Mission Handoff form this player has equipped (None from a server or client that does not send it), and their latest activation event. */
	WonderlandHandoffWire::EForm Handoff = WonderlandHandoffWire::EForm::None;
	WonderlandHandoffWire::FWireEvent HandoffEvent;
	/** How old the report was when the backend answered. */
	double AgeMs = 0.0;
};

struct FWonderlandWorldInviteRow
{
	FString InviteId;
	FString FromUserId;
	FString FromName;
	FString ServerName;
	double ExpiresInMs = 0.0;
};

/** What this player sees of their world context (worldViewFor). */
struct FWonderlandWorldView
{
	bool bInWorld = false;
	FString ContextId;
	/** PUBLIC_WORLD, PRIVATE_SERVER, GVE_ARENA, MISSION_SITE */
	FString Kind;
	FString ServerName;
	/** CLIENT_REPORTED today; SERVER_AUTHORITATIVE for a dedicated-server experience. */
	FString Authority;
	int32 Population = 0;
	int32 Capacity = 0;
	TArray<FWonderlandRemoteAvatar> Avatars;
	TArray<FWonderlandWorldInviteRow> Invites;
};

/** This client's own player, as it reports itself. */
struct FWonderlandAvatarReport
{
	FVector Location = FVector::ZeroVector;
	float Yaw = 0.0f;
	float Speed = 0.0f;
	FString Motion = TEXT("IDLE");
	FString SkinId = TEXT("relay_og");
	/** MP-VIS-02 REV2: this player's own equipped form, and the local state and phase it came from (the state decides when an EVENT is made; they are never sent). */
	WonderlandHandoffWire::EForm Handoff = WonderlandHandoffWire::EForm::None;
	EWonderlandHandoffState HandoffLocalState = EWonderlandHandoffState::Idle;
	float HandoffPhaseSeconds = 0.0f;
};

/**
 * THE OTHER PLAYERS, DRAWN. One figure per remote player in the view, dressed in their skin through the registry's figure
 * path, eased toward each report, walking by its own distance-driven gait, with a name label that faces this player's
 * camera. A player who leaves the view (left, went silent, or blocked either way) is removed.
 */
class WONDERLAND_API FWonderlandRemoteAvatars
{
public:
	~FWonderlandRemoteAvatars();

	/** A new view: spawn the newcomers, retarget the rest, remove the departed. */
	void Apply(UWorld* World, const FWonderlandWorldView& View, TFunctionRef<FString(const FString& SkinId)> FigurePathFor, float BodyHeightUu);
	/** Every frame: ease each figure toward its target, keep each label facing the camera. */
	void Tick(UWorld* World, float DeltaSeconds);
	/** Remove every figure (leaving the world, a new service, shutdown). */
	void Clear();

	int32 Num() const { return Remotes.Num(); }
	/** For QA: "usr_nova@(x,y,z) shadow_flame" per figure actually standing in the world. */
	FString Describe() const;

private:
	struct FRemote
	{
		TWeakObjectPtr<AWonderlandCompanionEmbodiment> Body;
		TWeakObjectPtr<UTextRenderComponent> Label;
		FVector Target = FVector::ZeroVector;
		float TargetYaw = 0.0f;
		FString SkinId;
		FString DisplayName;
		// MP-VIS-02 REV2: what this player reports as equipped; what their figure's handoff is doing (pure, from the wire); and the SAME presentations the owner's Dog uses,
		// built on first need on THIS figure: the swords and the transformation's light.
		WonderlandHandoffWire::EForm Handoff = WonderlandHandoffWire::EForm::None;
		WonderlandHandoffRemote::FTrack Track;
		TSharedPtr<WonderlandHandoffSwords::FPresentation> Swords;
		TSharedPtr<WonderlandHandoffTransform::FPresentation> Transform;
		int32 LoggedHandoffKey = 0;   // WLHANDOFF recv is said on a change of this only
		int32 LoggedPlayState = -1;   // WLHANDOFF play is said on a change of the state being drawn
		double PlayLoggedFrom = 0.0;
		// WLREMOTE diagnostics only: never read by the movement code.
		double LogNextAt = 0.0;
		double RecvAt = 0.0;
		float RecvAgeMs = 0.0f;
		// Dead reckoning (from the received Speed and the heading of the last two reports).
		bool bDrHasReport = false;
		FVector DrHeading = FVector::ZeroVector;   // unit, XY only; zero until a second, different report
		float DrSpeed = 0.0f;
		double DrReceivedAt = 0.0;                 // FPlatformTime::Seconds() of the last report that moved the figure's target
		float DrAgeSeconds = 0.0f;                 // the backend's ageMs for that report
		// r16reh16d snapshot interpolation: reports with the SENDER's time (arrival minus the backend's ageMs); drawn InterpDelay in the past.
		struct FSample { double T = 0.0; double Raw = 0.0; float V = 0.0f; FVector P = FVector::ZeroVector; };   // T = timeline used, Raw = arrival - age, V = reported speed
		TArray<FSample> Samples;
		// r16reh16i adaptive draw delay: the recent worst-case age of the newest report, and the delay actually used (slewed).
		double PeakAge = 0.0;
		double AdaptDelay = -1.0;
		// r16reh16r: the SAME animator the owner's Dog runs (RelayDogStride::FDogAnimator), configured as the Dog configures it, one per figure; its pose is worn by the figure.
		RelayDogStride::FDogAnimator Anim;
		bool bAnimConfigured = false;
	};
	void Remove(FRemote& Remote);
	/** MP-VIS-02 REV2: draws this frame of the handoff on a remote figure from its Track: the owner's own swords and light, the final look and the whole sequence. */
	void UpdateRemoteHandoff(const FString& UserId, FRemote& Remote, AWonderlandCompanionEmbodiment* Body, UWorld* World, float DeltaSeconds);
	/** Removes the swords' components (the figure is going, or was rebuilt on a new skin whose joints they hung from). */
	static void DropSwords(FRemote& Remote);
	TMap<FString, FRemote> Remotes;
};
