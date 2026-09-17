// WONDERLAND — WHAT IS INSIDE A WONDER WEB TAB: ordinary web pages.
//
// FOUNDER DIRECTION (2026-09-17): "Wonder Web outside = Wonderland black/yellow shell. Website inside = normal real web
// experience." The shell is Wonderland's (WonderlandWonderWebBrowserPanel.h); what is inside is ordinary web furniture --
// a site bar, a profile, a photo grid, a post with comments, search results, an inbox, an article, a cart -- drawn the way
// a website draws it. No sci-fi panels inside the page.
//
// NOTHING IS FETCHED AND NOTHING IS PUBLISHED. The pages come from a projection on disk
// (wonderland/UiArt/WonderWeb/wonder-web-browse.json, written by Tools/wonder_web/wonder-web-browse.generate.ts); there is
// no network in the simulation, and the shell says SIMULATED PAGE on every tab. This is the shape of the real thing: when
// Wonder Web reaches the internet for real it will be through Julius's governed browser, one authorized capability at a
// time -- which is why the sample post only happens as the Julius Connect task's steps are allowed
// (WonderlandJuliusConnect.h).
#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandWonderWebBrowse.generated.h"

class FJsonObject;
class UWonderlandJuliusConnectSubsystem;

/** One row of an ordinary web list: a search result, a message, a comment, a line of a cart. */
struct FWonderWebPageRow
{
	FString Title;
	FString Meta;
	FString Snippet;
	FString Tint;
};

/** A block of ordinary web furniture. The renderer draws each kind the way a website draws it. */
struct FWonderWebPageBlock
{
	FName Kind;
	FString Brand;
	FString Title;
	FString Subtitle;
	FString Text;
	FString Meta;
	FString Button;
	FString Query;
	FString Total;
	FString Tint;
	int32 Height = 0;
	int32 Likes = 0;
	TArray<FString> Links;
	TArray<FString> Lines;
	TArray<FString> Cells;
	TArray<FString> Stats;
	TArray<FWonderWebPageRow> Rows;
};

/** One tab: a site, its address, its sample page, and the real address to load when real mode is on. */
struct FWonderWebBrowseTab
{
	FString TabId;
	FString Title;
	FString Site;
	/** What the address bar reads. Never fetchable: the sample page is drawn, not loaded. */
	FString Url;
	/** The real page this tab stands for, loaded only in real mode and only if its host is allowed. Empty means none. */
	FString RealUrl;
	FString Letter;
	TArray<FWonderWebPageBlock> Blocks;
};

struct FWonderWebBrowseModel
{
	FString Schema;
	FString Notice;
	TArray<FWonderWebBrowseTab> Tabs;
};

/** Read the projection. Strict: a missing field or an unknown block kind is not a page. */
WONDERLAND_API bool WonderlandParseWonderWebBrowse(const TSharedPtr<class FJsonObject>& Json, FWonderWebBrowseModel& Out, FString& OutProblem);

DECLARE_MULTICAST_DELEGATE(FOnWonderWebBrowseChanged);

/**
 * The tabs Julius has open, which one is in front, and the one thing the sample post writes: a caption, and whether it
 * has been published. Julius does not type here on its own -- the Julius Connect task's steps drive it, so the page moves
 * only as the capability gate allows (see JuliusStep).
 */
UCLASS()
class WONDERLAND_API UWonderlandWonderWebBrowseSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	const FWonderWebBrowseModel& GetModel() const { return Model; }
	bool IsLoaded() const { return bLoaded; }
	const FString& GetProblem() const { return Problem; }
	int32 GetRevision() const { return Revision; }
	FOnWonderWebBrowseChanged OnChanged;

	// ---------------------------------------------------------------- the real web, when it is asked for
	//
	// FOUNDER DIRECTION (2026-09-17): "when it comes to the wonder web soon it should not be a simulation should be real."
	// Real mode loads the actual page with the engine's Chromium browser inside the Wonderland shell. It is off by default,
	// and while it is on the shell says LIVE PAGE instead of SIMULATED PAGE -- the label always matches what is on screen.
	// Only hosts on wl.WonderWeb.RealHosts load, so a typo cannot take the founder somewhere unintended, and nothing is
	// signed in on their behalf: a site that needs an account shows its own sign-in page, which is the person's own step.

	/** True when the browser loads real pages rather than drawing the sample ones. */
	bool IsRealMode() const;
	/** The address real mode has loaded (or is loading), empty when none. */
	const FString& GetRealUrl() const { return RealUrl; }
	/** What the shell should say about this page right now. */
	FString PageLabel() const;
	/**
	 * Load a real page. Refused, with a reason, for an address that is not http(s) or whose host is not allowed.
	 * The user's own navigation; Julius acting on a page is a capability and goes through Julius Connect.
	 */
	bool Navigate(const FString& Url, FString& OutRefusal);
	/** Whether a host is on the allowlist, for the shell and for tests. */
	static bool IsHostAllowed(const FString& Url, FString& OutHost);

	int32 GetSelectedTab() const { return SelectedTab; }
	const FWonderWebBrowseTab* GetTab(int32 Index) const { return Model.Tabs.IsValidIndex(Index) ? &Model.Tabs[Index] : nullptr; }
	const FWonderWebBrowseTab* GetSelected() const { return GetTab(SelectedTab); }
	bool SelectTabIndex(int32 Index);
	bool SelectTab(const FString& TabId);

	// ---------------------------------------------------------------- the one thing the sample post writes
	const FString& GetCaption() const { return Caption; }
	void SetCaption(const FString& Text);
	bool IsPosted() const { return bPosted; }
	/** Publish the caption as a post on the social tab. Refused with nothing typed. Labelled simulated wherever it shows. */
	bool Publish();
	void ClearPost();
	int32 GetPostedLikes() const { return PostedLikes; }

	/** What Julius is doing in the browser right now, for the shell's Julius strip. Empty when it is not working here. */
	const FString& GetJuliusLine() const { return JuliusLine; }
	/** True while Julius is typing the caption itself. */
	bool IsJuliusTyping() const { return TypedTo >= 0; }

	/** The browser as one line, for a proof job: tabs, which is in front, what is typed, whether it was posted. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Wonder Web")
	FString DescribeBrowse() const;

private:
	bool LoadModel();
	void Changed();
	bool Tick(float DeltaSeconds);
	/** Follow the Julius Connect task: the page acts only as its steps are allowed. */
	void FollowJulius();
	UWonderlandJuliusConnectSubsystem* Connect() const;

	FWonderWebBrowseModel Model;
	bool bLoaded = false;
	FString Problem;
	int32 Revision = 0;
	int32 SelectedTab = 0;

	FString RealUrl;
	FString Caption;
	bool bPosted = false;
	int32 PostedLikes = 0;
	FString JuliusLine;
	/** How much of the caption Julius has typed, or -1 when it is not typing. */
	int32 TypedTo = -1;
	FString Typing;
	float TypeWait = 0.0f;
	/** The step of the social-post task the page has already acted on. */
	int32 ActedOnStep = -1;
	FString ActedOnTask;
	FDelegateHandle ConnectChangedHandle;
	FTSTicker::FDelegateHandle Ticker;
};
