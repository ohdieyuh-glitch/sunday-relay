// Copyright Wonderland. C.A.R.D.'s references, RESOLVED: what each companion and capability on a card really is right now.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandCard.h"
#include "WonderlandJuliusConnect.h"
#include "WonderlandSidekicks.h"

class UGameInstance;

/**
 * A C.A.R.D. references companions (by provider id) and capabilities (MCP servers and APIs by connector id, skills by id).
 * It never holds what makes them work: the credentials stay in the runtime and Julius Connect. So a card on its own cannot
 * say whether a reference works -- and it must never pretend to.
 *
 * THIS MODULE ASKS THE ONLY TWO AUTHORITIES THERE ARE, read-only: the companion runtime (its providers, as each says about
 * itself on this machine, and the companions as connected now) and Julius Connect (its connectors, as the service projects
 * them). Nothing here connects, grants, probes or spends; nothing is cached past one reading.
 *
 * Every status is one of three words, and the reason is the runtime's own where it gave one:
 *   READY         the runtime says it can be used now (a development fixture is READY and always marked SIMULATED);
 *   UNCONFIGURED  the runtime knows it, and a person can make it work (sign in, connect, give a credential);
 *   UNAVAILABLE   it cannot be used from here (the runtime is offline, never heard of it, or it failed), and why.
 *
 * A reason comes from a service, so it is UNTRUSTED TEXT: control and invisible characters are dropped, it is capped, and
 * anything shaped like a credential is withheld rather than shown.
 *
 * PLAIN C++ (the FName rule): no reflected type, no new name in the FName table.
 */
struct FWonderlandCardRefStatus
{
	EWonderlandCardStatus Status = EWonderlandCardStatus::Unavailable;
	/** Shown to a person as it is: why this status (cleaned, capped, never a credential). */
	FString Reason;
	/** A development fixture: it answers, but nothing it says is real. Always shown beside READY. */
	bool bSimulated = false;
};

namespace WonderlandCardCapabilities
{
	/**
	 * One reading of both authorities. Plain values, so the rules below are proved with readings a QA builds (every rule,
	 * every state) as well as with this machine's own.
	 */
	struct FReading
	{
		EWonderlandSidekickLink CompanionLink = EWonderlandSidekickLink::Offline;
		FString CompanionProblem;
		TArray<FWonderlandSidekickProvider> Providers;
		/** The companions as connected now, as the runtime lists them. */
		TArray<FWonderlandSidekick> Sidekicks;
		EJuliusConnectLink ConnectLink = EJuliusConnectLink::Offline;
		FString ConnectProblem;
		TArray<FJuliusConnectService> Services;
	};

	/** This game's reading (both subsystems; either missing reads as offline, with that said). */
	WONDERLAND_API FReading Read(const UGameInstance* GameInstance);

	/**
	 * A companion slot. Slot 0 is the LEFT companion (the LLM Companion: a conversational provider), slot 1 the RIGHT
	 * (Jhinn: a single agent). A compound agent never fills a slot: Julius is the only one, and mission authority is his.
	 */
	WONDERLAND_API FWonderlandCardRefStatus ResolveCompanion(const FWonderlandCompanionRef& Ref, const FReading& Reading);

	/** An MCP server or an API by its Julius Connect connector id; a skill has no registry served to Wonderland yet. */
	WONDERLAND_API FWonderlandCardRefStatus ResolveCapability(const FWonderlandCapabilityRef& Ref, const FReading& Reading);

	/** READY, UNCONFIGURED or UNAVAILABLE. */
	WONDERLAND_API const TCHAR* StatusWord(EWonderlandCardStatus Status);

	/** "READY", "READY (SIMULATED)", "UNCONFIGURED: why", "UNAVAILABLE: why". */
	WONDERLAND_API FString Describe(const FWonderlandCardRefStatus& Status);

	/** The whole card on a few lines, for the terminal and the QA: its references and their status. Never a credential. */
	WONDERLAND_API TArray<FString> DescribeCard(const FWonderlandCard& Card, const FReading& Reading);

	/** Untrusted text made fit to show: invisible characters dropped, capped, a credential-shaped value withheld. */
	WONDERLAND_API FString CleanReason(const FString& Text);
}
