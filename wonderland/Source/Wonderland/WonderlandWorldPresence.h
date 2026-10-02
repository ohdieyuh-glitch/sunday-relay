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
	};
	void Remove(FRemote& Remote);
	TMap<FString, FRemote> Remotes;
};
