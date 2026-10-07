// WONDERLAND SOCIAL — signing a player in from the desktop client (R16 step 0: "sign in").
//
// THE SAME IDENTITY AS THE WEBSITE, NOT A SECOND ONE. The player proves who they are to GitHub, through the main-line
// relay's own GitHub App, by GitHub's DEVICE FLOW: the client asks the bridge to start (`POST
// /relay-api/wonderland/native/signin/start`), shows the short code GitHub issued, the player enters it at
// github.com/login/device in their own browser, and the client asks the bridge whether it is done (`.../signin/poll`).
// The BRIDGE talks to GitHub, reads the identity itself and mints a `native_social` session for `ghu-<id>` -- the very
// participant the website's sign-in makes. The client never sees GitHub's token, a password or the App's secret, and
// nothing typed into the game is an identity: the identity is what GitHub attested to the bridge.
//
// WHAT THE CLIENT HOLDS: the session token, IN MEMORY ONLY (never a file, never a log line), exactly like the paired Julius
// session. The bridge keeps its sessions in memory too (founder decision 2, 2026-09-27), so a bridge restart ends every
// session: the client is told by a 401, says so, and offers SIGN IN again. Social state itself is durable on the server.
//
// Plain C++ (no UCLASS, no UPROPERTY, no log category): every reflected name is an early FName that can shift Niagara's
// type hashes at boot (memory: niagara-fname-hash-crash).
#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"

class FJsonObject;

enum class EWonderlandSignInState : uint8
{
	/** No Wonderland server is configured in this build (Project Settings > Wonderland Julius Link). */
	NoServer,
	SignedOut,
	/** Asking the bridge for a code. */
	Starting,
	/** A code is on screen; waiting for the player to approve it at GitHub. */
	Waiting,
	SignedIn,
	/** Refused, expired, denied or unreachable: Message says which, in words for a person. */
	Failed,
};

struct FWonderlandSignInView
{
	EWonderlandSignInState State = EWonderlandSignInState::SignedOut;
	/** The code to type at VerificationUri (Waiting only). */
	FString UserCode;
	FString VerificationUri;
	/** FPlatformTime::Seconds() at which the code dies (Waiting only). */
	double ExpiresAt = 0.0;
	/** The GitHub login the bridge read (SignedIn only). */
	FString Login;
	/** `ghu-<id>` (SignedIn only). */
	FString ParticipantId;
	/** Signed in through a page on THIS machine -- the bridge's GitHub stand-in, developer sessions only: NOT a real person (Waiting and
	 *  SignedIn only). The hub says TEST IDENTITY; the log said so when the code arrived. */
	bool bTestIdentity = false;
	/** The line a person reads under the state. */
	FString Message;
};

class WONDERLAND_API FWonderlandSocialSignIn
{
public:
	/** BaseUrlSource: the resolved bridge URL, or empty with a problem. Asked at every start, so a changed setting is seen. */
	explicit FWonderlandSocialSignIn(TFunction<FString(FString& OutProblem)> InBaseUrlSource);
	~FWonderlandSocialSignIn();

	const FWonderlandSignInView& GetView() const { return View; }
	/** The bridge the session belongs to, and its token: valid only while SignedIn. Never log the token. */
	const FString& GetBaseUrl() const { return BaseUrl; }
	const FString& GetToken() const { return Token; }

	/** SIGN IN: ask the bridge for a code. Ignored while already Starting/Waiting/SignedIn. */
	void Start();
	/** CANCEL: forget the code (GitHub lets it expire). */
	void Cancel();
	/** SIGN OUT: revoke the session on the bridge (best effort) and forget it. */
	void SignOut();
	/** The bridge refused the session (401): forget it and say why. */
	void SessionEnded(const FString& Why);
	/** Open VerificationUri in the player's browser (Waiting only). True if the OS accepted it. */
	bool OpenBrowser() const;

	/** Every state change. */
	FSimpleMulticastDelegate& OnChanged() { return Changed; }
	/** Signed in: (bridge base URL, session token). */
	TFunction<void(const FString&, const FString&)> OnSignedIn;

	/** For QA and the log: "WAITING code 9 chars, 812 s left" -- never the token, never the code. */
	FString Describe() const;
	static const TCHAR* StateName(EWonderlandSignInState State);

private:
	void SetState(EWonderlandSignInState State, const FString& Message);
	bool Tick(float DeltaSeconds);
	void Poll();
	/** One POST to the sign-in routes. Done(status, data object or null, error kind) runs on the game thread. */
	void Post(const FString& Path, const FString& Body, const FString& Authorization,
		TFunction<void(int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& ErrorKind)> Done);

	TFunction<FString(FString&)> BaseUrlSource;
	FWonderlandSignInView View;
	FString BaseUrl;
	FString Handle;
	FString Token;
	double IntervalSeconds = 5.0;
	double NextPollAt = 0.0;
	bool bPolling = false;
	FSimpleMulticastDelegate Changed;
	FTSTicker::FDelegateHandle TickerHandle;
	/** Callbacks hold a weak copy: a sign-in destroyed mid-request is never called back into. */
	TSharedRef<bool> Alive = MakeShared<bool>(true);
};
