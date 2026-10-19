// WONDERLAND SOCIAL -- the reconnect decisions, pure (no I/O, no clock): what the live service does after a join answer, a deferred 404 and a
// leave that did not reach the server. Header-only so the standalone test (_qa_handoff/.../reconnect_client) compiles the very same code.
#pragma once

#include "CoreMinimal.h"

namespace WonderlandSocialReconnectPolicy
{
	/** The join target kinds the live service sends (WorldTarget / AutoJoinTarget); anything unknown is treated as PUBLIC-like by the caller. */
	enum class EJoinKind : uint8 { Public, Private, Friend, Invite, Party };

	/** How many times a refused INVITE / PARTY rejoin target is asked for again, on the automatic backoff, before the public world takes over. */
	constexpr int32 MaxTargetRefusals = 2;

	/** What an AUTOMATIC join that was refused does next. */
	enum class ERefusalAction : uint8
	{
		RetryPublic,        // the public world refused it (or nothing answered): again, on the backoff
		FallBackToPublic,   // the old way back: the public world instead, at once planned
		RetrySameTarget     // an INVITE / PARTY target: said, and asked again (bounded) before falling back
	};

	/** RefusalsSoFar counts the refusals of THIS target including the one just answered. bKeepTarget is wl.Remote.RejoinKeepTarget (0 = the old rule). */
	inline ERefusalAction AfterAutomaticJoinRefused(EJoinKind Kind, int32 RefusalsSoFar, bool bKeepTarget)
	{
		if (Kind == EJoinKind::Public)
		{
			return ERefusalAction::RetryPublic;
		}
		const bool bDurableTarget = Kind == EJoinKind::Invite || Kind == EJoinKind::Party;
		if (bKeepTarget && bDurableTarget && RefusalsSoFar < MaxTargetRefusals)
		{
			return ERefusalAction::RetrySameTarget;
		}
		return ERefusalAction::FallBackToPublic;
	}

	/** A 404 "Join a world first" that landed while a join was in flight is not lost: when that join answered and left the player NOT placed
	 *  (its own refusal, a player's join the server did not take), the rejoin it deferred is planned now. A placed answer, a player who left,
	 *  or a retry already planned (an automatic refusal plans its own) needs nothing. */
	inline bool ShouldReplanDeferred404(bool bDeferred, bool bAnswerOk, bool bAutomatic, bool bWorldWanted, bool bAutoJoinPending, bool bEnabled)
	{
		return bEnabled && bDeferred && !bAnswerOk && !bAutomatic && bWorldWanted && !bAutoJoinPending;
	}

	/** world.leave that never reached the server (no answer at all, or a 5xx): ONE more try, a second later, and only while the player is still out. */
	inline bool ShouldRetryLeave(int32 Status, bool bAlreadyRetried, bool bEnabled)
	{
		const bool bTransportFailure = Status == 0 || Status >= 500;
		return bEnabled && bTransportFailure && !bAlreadyRetried;
	}
}
