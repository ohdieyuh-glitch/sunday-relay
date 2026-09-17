// WONDERLAND — WONDER WEB LIVE: the real internet inside the Wonder Web shell.
//
// FOUNDER DIRECTION (2026-09-17): "when it comes to the wonder web soon it should not be a simulation should be real."
// And earlier, on the workspace: "Julius will be spawning multiple wonder webs" -- so this holds one real page PER
// WINDOW, not one page in total. Each window has its own page and its own address; the window whose widget drew most
// recently gets full frames and the ones behind it fewer, because that is what they are worth.
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
#include "UObject/StrongObjectPtr.h"
#include "WonderlandWonderWebLive.generated.h"

class UTexture2D;

DECLARE_MULTICAST_DELEGATE(FOnWonderWebLiveFrame);

/**
 * ONE WINDOW'S PAGE: the frames it is drawing, and what it is drawing them of. The texture is held strongly because
 * nothing else refers to it -- this is not a reflected property, and a collected texture would be a window that went
 * blank for no reason anyone could see.
 */
struct FWonderWebLivePage
{
	TStrongObjectPtr<UTexture2D> Frame;
	FString Url;
	FString Title;
	FString Problem;
	FIntPoint FrameSize = FIntPoint(1200, 800);
	FIntPoint Viewport = FIntPoint(1200, 800);
	FIntPoint AskedViewport = FIntPoint(0, 0);
	bool bLoading = false;
	/** True while this page is one another client opened -- Julius's own tab, watched rather than driven. */
	bool bFollowing = false;
	bool bFrameInFlight = false;
	int32 FrameCount = 0;
	float SinceFrame = 0.0f;
	/** When the widget drawing this page last asked for it, so a window nobody is looking at stops costing frames. */
	double WantedAt = 0.0;
};

/**
 * The live pages: one per Wonder Web window, kept current from the runtime's browser, plus the input the founder sends
 * back to them. Every call names the window's tab, because several windows at once are the point.
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
	 * WATCH A TAB SOMEBODY ELSE IS DRIVING. Julius works in its own tab in the runtime; this points a window's frames at
	 * that tab without navigating it, so the founder watches exactly the page Julius is on, as it happens.
	 */
	void Follow(const FString& TabId);
	/**
	 * The shape the page is being drawn in. The page is rendered at this size, so what the founder sees is a page laid out
	 * for the window it is in -- not a differently shaped page squeezed into it. This also marks the page as wanted, which
	 * is how a window nobody is drawing stops asking for frames.
	 */
	void SetViewport(const FString& TabId, FIntPoint Size);
	/** Stop drawing and let the runtime close the page. A tab this client only watches is left where it is. */
	void CloseTab(const FString& TabId);

	/** Where the founder clicked, in the page's own pixels. */
	void SendClick(const FString& TabId, double PageX, double PageY);
	void SendScroll(const FString& TabId, double DeltaY);
	/** Characters the founder typed. NEVER LOGGED: this may be a password. */
	void SendText(const FString& TabId, const FString& Text);
	void SendKey(const FString& TabId, const FString& Key);
	void SendBack(const FString& TabId);

	/** The page as it looked at the last frame, or null when nothing has arrived yet. */
	UTexture2D* GetFrame(const FString& TabId) const;
	/** The size the runtime renders at, which is what page pixels are measured in. */
	FIntPoint GetFrameSize(const FString& TabId) const;
	/** The address the runtime says this tab is on. */
	FString GetLiveUrl(const FString& TabId) const;
	FString GetTitle(const FString& TabId) const;
	/** True between asking for a page and its first frame. */
	bool IsLoading(const FString& TabId) const;
	/** Why the last request did not work: the runtime being down, or a host refused. Empty when all is well. */
	FString GetProblem(const FString& TabId) const;
	/** True once a frame has arrived and the page is being drawn. */
	bool HasFrame(const FString& TabId) const;
	/** True while this window is watching a tab it did not navigate. */
	bool IsFollowing(const FString& TabId) const;
	int32 GetFrameCount(const FString& TabId) const;
	/** Every tab with a page: for a proof, and for closing them on the way out. */
	TArray<FString> OpenTabs() const;

	FOnWonderWebLiveFrame OnFrame;

	/** The live pages as one line, for a proof job. Never includes what was typed. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Wonder Web")
	FString DescribeLive() const;

private:
	bool Tick(float DeltaSeconds);
	void RequestFrame(const FString& TabId);
	void SendIntent(const FString& TabId, const FString& Body, const TCHAR* What);
	static FString BaseUrl();
	bool ApplyJpeg(FWonderWebLivePage& Page, const TArray<uint8>& Bytes);
	/** The page for a tab, made if this is the first anyone has asked about it. */
	FWonderWebLivePage& PageFor(const FString& TabId);
	const FWonderWebLivePage* Find(const FString& TabId) const { return Pages.Find(TabId); }

	TMap<FString, FWonderWebLivePage> Pages;
	/** The tab whose widget drew most recently: the window in front, and the one worth full frames. */
	FString Front;
	TArray<FHttpRequestPtr> InFlight;
	FTSTicker::FDelegateHandle Ticker;
};
