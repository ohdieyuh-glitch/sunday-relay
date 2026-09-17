// WONDERLAND — JULIUS CONNECT, AS WONDERLAND SEES IT.
//
// "JULIUS CONNECT + WONDER WEB MUST BE FUNCTIONAL SYSTEMS, NOT VISUAL MOCKUPS" (founder, 2026-09-17). Wonderland does not
// hold connections and decides nothing about them. Julius Connect is its own subsystem -- the connection state machine,
// the registry, the capability gate, the credential vault, the audit and Julius's task runner -- running as a local
// service (C:\dev\iwonder\julius-connect: `npm run julius-connect:dev`, 127.0.0.1:8795). This client READS that
// service's Connections surface and SENDS the user's intents to it: start a task, connect, not now, revoke, reconnect,
// test access. Every Wonder Web window that shows a connection is a view of the one surface, so two windows can never
// disagree about what Julius may do.
//
// NO SECRET CROSSES THIS LINE. The service's surface carries no credential and no credential reference; this client
// refuses a surface that does, rather than drawing it.
//
// WHEN THE SERVICE IS NOT RUNNING the client says so -- OFFLINE, with the command that starts it -- and never shows a
// remembered or invented connection state in its place.
#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Interfaces/IHttpRequest.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandJuliusConnect.generated.h"

class FJsonObject;

struct FJuliusConnectCapability
{
	FString Id;
	FString Label;
	FString Risk;
};

struct FJuliusConnectService
{
	FString ConnectorId;
	FString DisplayName;
	/** "DEVELOPMENT CONNECTOR" or "REAL SERVICE". */
	FString Kind;
	FString ConnectionId;
	FString State;
	FString StateLabel;
	bool bReachable = false;
	FString UnavailableReason;
	FString RouteLabel;
	FString AccountLabel;
	TArray<FString> Granted;
	TArray<FString> Denied;
	TArray<FString> ProjectScope;
	TArray<FString> Missions;
	FString HealthDetail;
	FString LastActivityAt;
	bool bCanRevoke = false;
	bool bCanConnect = false;
	FString ConnectLabel;
	bool bAwaitingUser = false;
};

struct FJuliusConnectPrompt
{
	FString RequestId;
	FString Banner;
	FString Headline;
	FString Kind;
	FString ConnectorId;
	FString DisplayName;
	FString RouteLabel;
	FString NeededFor;
	FString MissionId;
	TArray<FJuliusConnectCapability> Requested;
	TArray<FJuliusConnectCapability> NotRequested;
	TArray<FString> JuliusDid;
	FString HumanStep;
	bool bCredentialFlow = false;
};

struct FJuliusConnectSetupRow
{
	FString RequestId;
	FString DisplayName;
	FString Kind;
	FString RouteLabel;
	FString HumanStep;
};

struct FJuliusConnectTimelineRow
{
	FString At;
	FString State;
	FString Summary;
};

struct FJuliusConnectTask
{
	FString TaskId;
	FString MissionId;
	FString Title;
	FString RunState;
	FString StepLabel;
	int32 Progress = 0;
	int32 Total = 0;
	FString BlockedReason;
	TArray<FString> BlockedOn;
	TArray<FJuliusConnectTimelineRow> Timeline;
};

struct FJuliusConnectAuditRow
{
	FString At;
	FString Actor;
	FString Action;
	FString Service;
	FString Capability;
	FString Outcome;
	FString Detail;
	FString ProjectId;
	FString MissionId;
};

/** The Connections surface as the service projected it. */
struct FJuliusConnectSurface
{
	int32 ServiceRevision = 0;
	FString Mode;
	FString ObservedAt;
	FString ViewerUserId;
	FString ProjectId;
	FString Notice;
	TArray<FJuliusConnectService> Services;
	bool bHasPrompt = false;
	FJuliusConnectPrompt Prompt;
	TArray<FJuliusConnectSetupRow> Setup;
	TArray<FJuliusConnectTask> Tasks;
	TArray<FJuliusConnectAuditRow> Audit;

	const FJuliusConnectService* FindService(const FString& ConnectorId) const;
	/** The task Julius is working on or waiting in, else the most recent. Null when there is none. */
	const FJuliusConnectTask* CurrentTask() const;
};

/**
 * Read the service's JSON. Strict about shape -- schema names, required fields -- and refuses anything carrying a
 * credential reference.
 */
WONDERLAND_API bool WonderlandParseJuliusConnectView(const FString& Body, FJuliusConnectSurface& Out, FString& OutProblem);

enum class EJuliusConnectLink : uint8
{
	Connecting,
	Online,
	Offline
};

DECLARE_MULTICAST_DELEGATE(FOnJuliusConnectChanged);

UCLASS()
class WONDERLAND_API UWonderlandJuliusConnectSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	const FJuliusConnectSurface& GetSurface() const { return Surface; }
	EJuliusConnectLink GetLink() const { return Link; }
	/** Why the link is not online, or why the last surface was refused. */
	const FString& GetProblem() const { return Problem; }
	/** Bumps on every change a view should redraw for (a new surface, the link, a terminal line). */
	int32 GetRevision() const { return Revision; }
	FOnJuliusConnectChanged OnChanged;

	/** The command that starts the service, for the OFFLINE state. */
	static FString StartCommand();

	// ---------------------------------------------------------------- the user's intents (sent; the service decides)
	void StartTask(const FString& TemplateId);
	/** CONNECT on the prompt on screen. */
	bool ApprovePrompt();
	/** NOT NOW on the prompt on screen. */
	bool DeclinePrompt();
	/** Connect (or reconnect) by connector id, or by what the user calls it. */
	void Connect(const FString& ConnectorIdOrName);
	bool Revoke(const FString& ConnectorId);
	/** Ask the gate, on the record, whether Julius may use a capability now. */
	void TestAccess(const FString& ConnectorId, const FString& Capability);
	/** DEVELOPMENT CONTROL: push a connection into a health state (RATE_LIMITED, UNAVAILABLE, EXPIRED, CONNECTED ...). */
	bool SetHealth(const FString& ConnectorId, const FString& State);
	void Reset();
	int32 GetIntentsSent() const { return IntentsSent; }

	// ---------------------------------------------------------------- the Connections terminal
	/**
	 * A line typed at the Connections window's prompt. A fixed vocabulary, never a shell:
	 *   julius sync design tokens | connect <service> | revoke <service> | test <service> [capability] | approve | not now | status | help
	 */
	void SubmitTerminal(const FString& Line);
	struct FLine
	{
		FString Text;
		bool bTyped = false;
		bool bProblem = false;
	};
	const TArray<FLine>& GetTerminalLines() const { return Lines; }

	/** Poll now rather than at the next interval. */
	void PollNow();

private:
	bool Tick(float DeltaSeconds);
	void Poll();
	void Post(const TSharedRef<FJsonObject>& Intent, const FString& Describe);
	/** Take a response body: apply its surface when it parses, record the error message when the service refused. */
	void Accept(const FString& Body, int32 Status, bool bFromIntent, const FString& Describe);
	void SetLink(EJuliusConnectLink NewLink, const FString& Why);
	void Say(const FString& Text, bool bTyped = false, bool bProblem = false);
	/** Say it where it cannot be missed -- the viewport and the log -- for a refusal or an offline service. */
	void Announce(const FString& Text, bool bProblem) const;
	void Changed();
	FString BaseUrl() const;

	FJuliusConnectSurface Surface;
	EJuliusConnectLink Link = EJuliusConnectLink::Connecting;
	FString Problem;
	int32 Revision = 0;
	int32 IntentsSent = 0;
	double NextPollAt = 0.0;
	bool bPollInFlight = false;
	TArray<FLine> Lines;
	FTSTicker::FDelegateHandle Ticker;
	TArray<FHttpRequestPtr> InFlight;
};
