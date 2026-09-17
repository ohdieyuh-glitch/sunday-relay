// WONDERLAND — WONDER WEB LIVE: the real internet inside the Wonder Web shell.
//
// FOUNDER DIRECTION (2026-09-17): "when it comes to the wonder web soon it should not be a simulation should be real."
//
// WHAT THIS IS. A real browser renders the real page on this machine, inside the Julius Connect runtime
// (relay-bridge/julius-connect/live-browser.ts), and Wonderland draws the frames it produces and sends back where the
// founder clicked, scrolled and typed. The bytes are the site's own; the layout is a real browser's; a site that wants an
// account shows its own sign-in page. Nothing here is drawn from a projection and nothing is a stand-in.
//
// WHY NOT THE ENGINE'S BROWSER. The engine ships CEF's libraries but this install has no UnrealCEFSubProcess.exe, so
// SWebBrowser renders an empty white page and logs nothing. That path is dead here; this one is real and, being a
// separate process, cannot take the editor down with it.
//
// WHAT KEEPS IT SAFE.
//   - ONE ALLOWLIST, CHECKED TWICE. Wonderland refuses a host before asking (WonderlandWonderWebBrowse::IsHostAllowed);
//     the runtime refuses it again before fetching. A mistake here reaches nothing.
//   - LOOPBACK ONLY. The service listens on 127.0.0.1 and refuses any request that carries an Origin header.
//   - NOTHING IS TYPED FOR ANYONE. Keystrokes are the founder's own, forwarded as they are pressed. Julius acting on a
//     page is a Julius Connect capability and goes through the gate (WonderlandJuliusConnect.h) -- not through here.
//   - NO SECRET CROSSES THIS SEAM. What is typed into a page is the page's business: it is never logged, never echoed to
//     the terminal, and never put in a describe line.
#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Interfaces/IHttpRequest.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandWonderWebLive.generated.h"

class UTexture2D;

DECLARE_MULTICAST_DELEGATE(FOnWonderWebLiveFrame);

/**
 * The live page: one texture, kept current from the runtime's browser, plus the input the founder sends back to it.
 * One tab is live at a time -- the one in front -- because that is the one anybody is looking at.
 */
UCLASS()
class WONDERLAND_API UWonderlandWonderWebLiveSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/** Ask the runtime's browser to load an address on a tab. The host is checked here before it is sent. */
	void Navigate(const FString& TabId, const FString& Url);
	/**
	 * The shape the page is being drawn in. The page is rendered at this size, so what the founder sees is a page laid out
	 * for the window it is in -- not a differently shaped page squeezed into it.
	 */
	void SetViewport(FIntPoint Size);
	/**
	 * WATCH A TAB SOMEBODY ELSE IS DRIVING. Julius works in its own tab in the runtime; this points the frames at that tab
	 * without navigating it, so the founder watches exactly the page Julius is on, as it happens.
	 */
	void Follow(const FString& TabId);
	/** True while the tab being drawn is one this client did not navigate. */
	bool IsFollowing() const { return bFollowing; }
	/** Stop drawing and let the runtime close the page. */
	void CloseTab(const FString& TabId);

	/** Where the founder clicked, in the page's own pixels. */
	void SendClick(double PageX, double PageY);
	void SendScroll(double DeltaY);
	/** Characters the founder typed. NEVER LOGGED: this may be a password. */
	void SendText(const FString& Text);
	void SendKey(const FString& Key);
	void SendBack();

	/** The page as it looked at the last frame, or null when nothing has arrived yet. */
	UTexture2D* GetFrame() const { return Frame; }
	/** The size the runtime renders at, which is what page pixels are measured in. */
	FIntPoint GetFrameSize() const { return FrameSize; }
	/** The tab whose frames are being drawn. */
	const FString& GetLiveTab() const { return LiveTab; }
	/** The address the runtime says it is on. */
	const FString& GetLiveUrl() const { return LiveUrl; }
	const FString& GetTitle() const { return Title; }
	/** True between asking for a page and its first frame. */
	bool IsLoading() const { return bLoading; }
	/** Why the last request did not work: the runtime being down, or a host refused. Empty when all is well. */
	const FString& GetProblem() const { return Problem; }
	/** True once a frame has arrived and the page is being drawn. */
	bool HasFrame() const { return Frame != nullptr; }
	int32 GetFrameCount() const { return FrameCount; }

	FOnWonderWebLiveFrame OnFrame;

	/** The live browser as one line, for a proof job. Never includes what was typed. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Wonder Web")
	FString DescribeLive() const;

private:
	bool Tick(float DeltaSeconds);
	void RequestFrame();
	void SendIntent(const FString& Body, const TCHAR* What);
	static FString BaseUrl();
	bool ApplyJpeg(const TArray<uint8>& Bytes);

	UPROPERTY(Transient)
	TObjectPtr<UTexture2D> Frame = nullptr;

	FString LiveTab;
	FString LiveUrl;
	FString Title;
	FString Problem;
	FIntPoint FrameSize = FIntPoint(1200, 800);
	FIntPoint Viewport = FIntPoint(1200, 800);
	FIntPoint AskedViewport = FIntPoint(0, 0);
	bool bLoading = false;
	bool bFollowing = false;
	bool bFrameInFlight = false;
	int32 FrameCount = 0;
	float SinceFrame = 0.0f;
	TArray<FHttpRequestPtr> InFlight;
	FTSTicker::FDelegateHandle Ticker;
};
