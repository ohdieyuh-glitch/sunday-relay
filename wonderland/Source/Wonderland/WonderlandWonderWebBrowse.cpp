#include "WonderlandWonderWebBrowse.h"

#include "CoreGlobals.h"
#include "Dom/JsonObject.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "UObject/UObjectIterator.h"
#include "WonderlandJuliusConnect.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderWebBrowse, Log, All);

namespace WonderWebBrowseTuning
{
	TAutoConsoleVariable<float> CVarTypeSeconds(TEXT("wl.WonderWeb.Browse.TypeSeconds"), 0.035f,
		TEXT("Wonder Web browser: seconds between characters while Julius types the caption."));
	// THE REAL WEB, off until it is asked for. With it on, the page is loaded by the engine's Chromium browser instead of
	// drawn from the projection, and the shell says LIVE PAGE.
	TAutoConsoleVariable<int32> CVarReal(TEXT("wl.WonderWeb.Real"), 0,
		TEXT("Wonder Web browser: 0 draws the sample pages, 1 loads the real ones with the engine's browser (allowlisted hosts only)."));
	TAutoConsoleVariable<FString> CVarRealHosts(TEXT("wl.WonderWeb.RealHosts"),
		TEXT("wikipedia.org,en.wikipedia.org,www.wikipedia.org,example.com,www.example.com,instagram.com,www.instagram.com,duckduckgo.com,html.duckduckgo.com"),
		TEXT("Wonder Web browser: the hosts real mode may load, comma separated. A host not on this list is refused."));

	const TCHAR* SocialTemplate = TEXT("social-post");

	/** The block kinds the renderer knows. An unknown kind is a projection this build cannot draw, not a page to guess at. */
	bool IsKnownKind(const FName Kind)
	{
		static const TSet<FName> Known = {
			TEXT("site_bar"), TEXT("profile"), TEXT("grid"), TEXT("post"), TEXT("compose"),
			TEXT("results"), TEXT("list"), TEXT("article"), TEXT("cart"), TEXT("footer") };
		return Known.Contains(Kind);
	}
}

/* ==================================================================== reading the projection */

namespace
{
	FString Str(const TSharedPtr<FJsonObject>& Json, const TCHAR* Field)
	{
		FString Value;
		return Json.IsValid() && Json->TryGetStringField(Field, Value) ? Value : FString();
	}

	int32 Num(const TSharedPtr<FJsonObject>& Json, const TCHAR* Field)
	{
		int32 Value = 0;
		return Json.IsValid() && Json->TryGetNumberField(Field, Value) ? Value : 0;
	}

	TArray<FString> Strings(const TSharedPtr<FJsonObject>& Json, const TCHAR* Field)
	{
		TArray<FString> Out;
		const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
		if (Json.IsValid() && Json->TryGetArrayField(Field, Values))
		{
			for (const TSharedPtr<FJsonValue>& Value : *Values)
			{
				if (Value.IsValid() && Value->Type == EJson::String)
				{
					Out.Add(Value->AsString());
				}
			}
		}
		return Out;
	}
}

bool WonderlandParseWonderWebBrowse(const TSharedPtr<FJsonObject>& Json, FWonderWebBrowseModel& Out, FString& OutProblem)
{
	if (!Json.IsValid())
	{
		OutProblem = TEXT("the projection is not an object");
		return false;
	}
	FWonderWebBrowseModel Parsed;
	Parsed.Schema = Str(Json, TEXT("schema"));
	Parsed.Notice = Str(Json, TEXT("notice"));
	if (Parsed.Schema != TEXT("wonderland-wonder-web-browse.v1"))
	{
		OutProblem = FString::Printf(TEXT("unknown schema '%s'"), *Parsed.Schema);
		return false;
	}
	if (Parsed.Notice.IsEmpty())
	{
		OutProblem = TEXT("the projection does not say it is simulated");
		return false;
	}
	const TArray<TSharedPtr<FJsonValue>>* Tabs = nullptr;
	if (!Json->TryGetArrayField(TEXT("tabs"), Tabs) || Tabs->Num() < 1)
	{
		OutProblem = TEXT("no tabs");
		return false;
	}
	for (const TSharedPtr<FJsonValue>& TabValue : *Tabs)
	{
		const TSharedPtr<FJsonObject> TabJson = TabValue.IsValid() && TabValue->Type == EJson::Object ? TabValue->AsObject() : nullptr;
		if (!TabJson.IsValid())
		{
			OutProblem = TEXT("a tab is not an object");
			return false;
		}
		FWonderWebBrowseTab& Tab = Parsed.Tabs.AddDefaulted_GetRef();
		Tab.TabId = Str(TabJson, TEXT("tabId"));
		Tab.Title = Str(TabJson, TEXT("title"));
		Tab.Site = Str(TabJson, TEXT("site"));
		Tab.Url = Str(TabJson, TEXT("url"));
		Tab.RealUrl = Str(TabJson, TEXT("real"));
		Tab.Letter = Str(TabJson, TEXT("letter"));
		if (Tab.TabId.IsEmpty() || Tab.Title.IsEmpty() || Tab.Url.IsEmpty())
		{
			OutProblem = TEXT("a tab has no id, title or address");
			return false;
		}
		// NOT A LIVE ADDRESS: what the address bar shows is text to read. The real page a tab stands for is a separate
		// field, used only in real mode and only when its host is allowed.
		if (Tab.Url.StartsWith(TEXT("http")))
		{
			OutProblem = FString::Printf(TEXT("tab '%s' carries a fetchable address where its shown address belongs"), *Tab.TabId);
			return false;
		}
		if (!Tab.RealUrl.IsEmpty() && !Tab.RealUrl.StartsWith(TEXT("https://")))
		{
			OutProblem = FString::Printf(TEXT("tab '%s' has a real address that is not https"), *Tab.TabId);
			return false;
		}
		const TArray<TSharedPtr<FJsonValue>>* Blocks = nullptr;
		if (!TabJson->TryGetArrayField(TEXT("blocks"), Blocks) || Blocks->Num() < 1)
		{
			OutProblem = FString::Printf(TEXT("tab '%s' has no page"), *Tab.TabId);
			return false;
		}
		for (const TSharedPtr<FJsonValue>& BlockValue : *Blocks)
		{
			const TSharedPtr<FJsonObject> BlockJson = BlockValue.IsValid() && BlockValue->Type == EJson::Object ? BlockValue->AsObject() : nullptr;
			if (!BlockJson.IsValid())
			{
				OutProblem = TEXT("a block is not an object");
				return false;
			}
			FWonderWebPageBlock& Block = Tab.Blocks.AddDefaulted_GetRef();
			Block.Kind = FName(*Str(BlockJson, TEXT("kind")));
			if (!WonderWebBrowseTuning::IsKnownKind(Block.Kind))
			{
				OutProblem = FString::Printf(TEXT("tab '%s' has a block this build cannot draw ('%s')"), *Tab.TabId, *Block.Kind.ToString());
				return false;
			}
			Block.Brand = Str(BlockJson, TEXT("brand"));
			Block.Title = Str(BlockJson, TEXT("title"));
			Block.Subtitle = Str(BlockJson, TEXT("subtitle"));
			Block.Text = Str(BlockJson, TEXT("text"));
			Block.Meta = Str(BlockJson, TEXT("meta"));
			Block.Button = Str(BlockJson, TEXT("button"));
			Block.Query = Str(BlockJson, TEXT("query"));
			Block.Total = Str(BlockJson, TEXT("total"));
			Block.Tint = Str(BlockJson, TEXT("tint"));
			Block.Height = Num(BlockJson, TEXT("height"));
			Block.Likes = Num(BlockJson, TEXT("likes"));
			Block.Links = Strings(BlockJson, TEXT("links"));
			Block.Lines = Strings(BlockJson, TEXT("lines"));
			Block.Cells = Strings(BlockJson, TEXT("cells"));
			Block.Stats = Strings(BlockJson, TEXT("stats"));
			const TArray<TSharedPtr<FJsonValue>>* Rows = nullptr;
			if (BlockJson->TryGetArrayField(TEXT("rows"), Rows))
			{
				for (const TSharedPtr<FJsonValue>& RowValue : *Rows)
				{
					const TSharedPtr<FJsonObject> RowJson = RowValue.IsValid() && RowValue->Type == EJson::Object ? RowValue->AsObject() : nullptr;
					if (!RowJson.IsValid())
					{
						OutProblem = TEXT("a row is not an object");
						return false;
					}
					FWonderWebPageRow& Row = Block.Rows.AddDefaulted_GetRef();
					Row.Title = Str(RowJson, TEXT("title"));
					Row.Meta = Str(RowJson, TEXT("meta"));
					Row.Snippet = Str(RowJson, TEXT("snippet"));
					Row.Tint = Str(RowJson, TEXT("tint"));
				}
			}
		}
	}
	Out = MoveTemp(Parsed);
	return true;
}

/* ==================================================================== the console */

namespace WonderWebBrowseConsole
{
	void Say(const FString& Text, bool bProblem = false)
	{
		UE_LOG(LogWonderWebBrowse, Display, TEXT("%s"), *Text);
		GAreScreenMessagesEnabled = true;
		if (GEngine != nullptr)
		{
			GEngine->bEnableOnScreenDebugMessages = true;
			GEngine->AddOnScreenDebugMessage(INDEX_NONE, 7.0f, bProblem ? FColor(255, 107, 74) : FColor(255, 212, 0), Text);
		}
	}

	int32 ForEachLive(TFunctionRef<void(UWonderlandWonderWebBrowseSubsystem&)> Body)
	{
		int32 Found = 0;
		for (TObjectIterator<UWonderlandWonderWebBrowseSubsystem> It; It; ++It)
		{
			if (!It->HasAnyFlags(RF_ClassDefaultObject | RF_ArchetypeObject) && It->GetWorld() != nullptr && It->GetWorld()->IsGameWorld())
			{
				Body(**It);
				++Found;
			}
		}
		if (Found == 0)
		{
			Say(TEXT("WONDER WEB: nothing to do -- press Play first."), true);
		}
		return Found;
	}

	FAutoConsoleCommand CmdTab(TEXT("wl.WonderWeb.Browse.Tab"),
		TEXT("Bring a tab of the Wonder Web browser to the front: `wl.WonderWeb.Browse.Tab social` (social, search, mail, docs, store)."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString Id = Args.Num() > 0 ? Args[0] : TEXT("social");
			ForEachLive([&Id](UWonderlandWonderWebBrowseSubsystem& Browse)
			{
				Say(Browse.SelectTab(Id) ? FString::Printf(TEXT("WONDER WEB: %s is in front."), *Id)
					: FString::Printf(TEXT("WONDER WEB: there is no tab called '%s'."), *Id), true);
			});
		}));

	FAutoConsoleCommand CmdCaption(TEXT("wl.WonderWeb.Browse.Caption"), TEXT("Type a caption into the post box of the social tab."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString Text = FString::Join(Args, TEXT(" "));
			ForEachLive([&Text](UWonderlandWonderWebBrowseSubsystem& Browse)
			{
				Browse.SetCaption(Text);
				Say(FString::Printf(TEXT("WONDER WEB: caption '%s'."), *Text));
			});
		}));

	FAutoConsoleCommand CmdPost(TEXT("wl.WonderWeb.Browse.Post"), TEXT("Press Post on the social tab. The post is SIMULATED: nothing leaves this machine."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachLive([](UWonderlandWonderWebBrowseSubsystem& Browse)
			{
				Say(Browse.Publish() ? TEXT("WONDER WEB: posted (simulated -- nothing was published).")
					: TEXT("WONDER WEB: nothing to post -- type a caption first."), !Browse.IsPosted());
			});
		}));

	FAutoConsoleCommand CmdGo(TEXT("wl.WonderWeb.Go"),
		TEXT("Load a real page in the Wonder Web browser: `wl.WonderWeb.Go https://en.wikipedia.org/wiki/Wonderland`. Needs wl.WonderWeb.Real 1, and an allowed host."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString Url = Args.Num() > 0 ? Args[0] : FString();
			ForEachLive([&Url](UWonderlandWonderWebBrowseSubsystem& Browse)
			{
				FString Refusal;
				Say(Browse.Navigate(Url, Refusal) ? FString::Printf(TEXT("WONDER WEB: loading %s for real."), *Url)
					: FString::Printf(TEXT("WONDER WEB: %s"), *Refusal), !Refusal.IsEmpty());
			});
		}));

	FAutoConsoleCommand CmdReset(TEXT("wl.WonderWeb.Browse.Reset"), TEXT("Clear the caption and the simulated post."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachLive([](UWonderlandWonderWebBrowseSubsystem& Browse)
			{
				Browse.ClearPost();
				Say(TEXT("WONDER WEB: the post box is empty again."));
			});
		}));
}

/* ==================================================================== the subsystem */

void UWonderlandWonderWebBrowseSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	bLoaded = LoadModel();
	if (UWonderlandJuliusConnectSubsystem* Julius = Connect())
	{
		ConnectChangedHandle = Julius->OnChanged.AddUObject(this, &UWonderlandWonderWebBrowseSubsystem::FollowJulius);
	}
	Ticker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateUObject(this, &UWonderlandWonderWebBrowseSubsystem::Tick));
}

void UWonderlandWonderWebBrowseSubsystem::Deinitialize()
{
	if (Ticker.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(Ticker);
		Ticker.Reset();
	}
	if (UWonderlandJuliusConnectSubsystem* Julius = Connect())
	{
		Julius->OnChanged.Remove(ConnectChangedHandle);
	}
	ConnectChangedHandle.Reset();
	Super::Deinitialize();
}

UWonderlandJuliusConnectSubsystem* UWonderlandWonderWebBrowseSubsystem::Connect() const
{
	const UGameInstance* Instance = GetGameInstance();
	return Instance != nullptr ? const_cast<UGameInstance*>(Instance)->GetSubsystem<UWonderlandJuliusConnectSubsystem>() : nullptr;
}

bool UWonderlandWonderWebBrowseSubsystem::LoadModel()
{
	const FString Path = FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectDir(), TEXT("UiArt"), TEXT("WonderWeb"), TEXT("wonder-web-browse.json")));
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *Path))
	{
		Problem = FString::Printf(TEXT("the pages were not read from %s"), *Path);
		UE_LOG(LogWonderWebBrowse, Warning, TEXT("WLBROWSE %s"), *Problem);
		return false;
	}
	TSharedPtr<FJsonObject> Json;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
	if (!FJsonSerializer::Deserialize(Reader, Json) || !Json.IsValid())
	{
		Problem = FString::Printf(TEXT("%s is not JSON"), *Path);
		UE_LOG(LogWonderWebBrowse, Warning, TEXT("WLBROWSE %s"), *Problem);
		return false;
	}
	if (!WonderlandParseWonderWebBrowse(Json, Model, Problem))
	{
		UE_LOG(LogWonderWebBrowse, Warning, TEXT("WLBROWSE the pages were refused: %s"), *Problem);
		return false;
	}
	UE_LOG(LogWonderWebBrowse, Log, TEXT("WLBROWSE %d tabs of sample pages read"), Model.Tabs.Num());
	return true;
}

void UWonderlandWonderWebBrowseSubsystem::Changed()
{
	++Revision;
	OnChanged.Broadcast();
}

FString UWonderlandWonderWebBrowseSubsystem::DescribeBrowse() const
{
	const FWonderWebBrowseTab* Tab = GetSelected();
	return FString::Printf(TEXT("loaded=%d tabs=%d tab=%s url=%s real=%d real_url=%s label=\"%s\" caption_len=%d typing=%d posted=%d julius=\"%s\" problem=\"%s\""),
		bLoaded ? 1 : 0, Model.Tabs.Num(), Tab != nullptr ? *Tab->TabId : TEXT("-"), Tab != nullptr ? *Tab->Url : TEXT("-"),
		IsRealMode() ? 1 : 0, RealUrl.IsEmpty() ? TEXT("-") : *RealUrl, *PageLabel(),
		Caption.Len(), IsJuliusTyping() ? 1 : 0, bPosted ? 1 : 0, *JuliusLine, *Problem);
}

bool UWonderlandWonderWebBrowseSubsystem::IsRealMode() const
{
	return WonderWebBrowseTuning::CVarReal.GetValueOnGameThread() != 0;
}

bool UWonderlandWonderWebBrowseSubsystem::IsHostAllowed(const FString& Url, FString& OutHost)
{
	OutHost.Reset();
	if (!Url.StartsWith(TEXT("https://")) && !Url.StartsWith(TEXT("http://")))
	{
		return false;
	}
	FString Rest = Url.RightChop(Url.Find(TEXT("://")) + 3);
	FString Host = Rest;
	int32 Slash = INDEX_NONE;
	if (Rest.FindChar(TEXT('/'), Slash))
	{
		Host = Rest.Left(Slash);
	}
	Host.Split(TEXT(":"), &Host, nullptr, ESearchCase::CaseSensitive, ESearchDir::FromStart);
	OutHost = Host.ToLower();
	TArray<FString> Allowed;
	WonderWebBrowseTuning::CVarRealHosts.GetValueOnGameThread().ParseIntoArray(Allowed, TEXT(","), true);
	for (FString Candidate : Allowed)
	{
		Candidate.TrimStartAndEndInline();
		if (!Candidate.IsEmpty() && OutHost == Candidate.ToLower())
		{
			return true;
		}
	}
	return false;
}

FString UWonderlandWonderWebBrowseSubsystem::PageLabel() const
{
	if (!IsRealMode())
	{
		return TEXT("SIMULATED PAGE  ·  NO NETWORK");
	}
	FString Host;
	if (RealUrl.IsEmpty() || !IsHostAllowed(RealUrl, Host))
	{
		return TEXT("REAL MODE  ·  NOTHING LOADED");
	}
	return FString::Printf(TEXT("LIVE PAGE  ·  %s"), *Host.ToUpper());
}

bool UWonderlandWonderWebBrowseSubsystem::Navigate(const FString& Url, FString& OutRefusal)
{
	FString Host;
	if (!IsRealMode())
	{
		OutRefusal = TEXT("real mode is off: set wl.WonderWeb.Real 1 to load real pages");
		return false;
	}
	if (!IsHostAllowed(Url, Host))
	{
		OutRefusal = Host.IsEmpty()
			? FString::Printf(TEXT("'%s' is not an http(s) address"), *Url)
			: FString::Printf(TEXT("%s is not on wl.WonderWeb.RealHosts, so it was not loaded"), *Host);
		return false;
	}
	RealUrl = Url;
	// SAID IN THE LOG, EVERY TIME: a real page was loaded, and which one.
	UE_LOG(LogWonderWebBrowse, Display, TEXT("WLBROWSE real page loaded: %s"), *RealUrl);
	Changed();
	return true;
}

bool UWonderlandWonderWebBrowseSubsystem::SelectTabIndex(int32 Index)
{
	if (!Model.Tabs.IsValidIndex(Index) || Index == SelectedTab)
	{
		return Model.Tabs.IsValidIndex(Index);
	}
	SelectedTab = Index;
	// In real mode a tab is the real page it stands for; one with no real address loads nothing and says so.
	if (IsRealMode())
	{
		const FWonderWebBrowseTab* Tab = GetSelected();
		FString Refusal;
		if (Tab != nullptr && !Tab->RealUrl.IsEmpty() && !Navigate(Tab->RealUrl, Refusal))
		{
			UE_LOG(LogWonderWebBrowse, Warning, TEXT("WLBROWSE %s"), *Refusal);
			RealUrl.Reset();
		}
		else if (Tab != nullptr && Tab->RealUrl.IsEmpty())
		{
			RealUrl.Reset();
		}
	}
	Changed();
	return true;
}

bool UWonderlandWonderWebBrowseSubsystem::SelectTab(const FString& TabId)
{
	for (int32 Index = 0; Index < Model.Tabs.Num(); ++Index)
	{
		if (Model.Tabs[Index].TabId == TabId || Model.Tabs[Index].Title.Equals(TabId, ESearchCase::IgnoreCase))
		{
			return SelectTabIndex(Index);
		}
	}
	return false;
}

void UWonderlandWonderWebBrowseSubsystem::SetCaption(const FString& Text)
{
	if (Caption == Text)
	{
		return;
	}
	Caption = Text;
	TypedTo = -1;
	Changed();
}

bool UWonderlandWonderWebBrowseSubsystem::Publish()
{
	if (Caption.IsEmpty() || bPosted)
	{
		return false;
	}
	bPosted = true;
	// A plausible number for the picture, so the page reads like a page. It is sample data, like everything else here.
	PostedLikes = 3;
	Changed();
	return true;
}

void UWonderlandWonderWebBrowseSubsystem::ClearPost()
{
	Caption.Reset();
	bPosted = false;
	PostedLikes = 0;
	TypedTo = -1;
	Typing.Reset();
	JuliusLine.Reset();
	ActedOnStep = -1;
	ActedOnTask.Reset();
	Changed();
}

bool UWonderlandWonderWebBrowseSubsystem::Tick(float DeltaSeconds)
{
	// JULIUS TYPING: the caption appears a character at a time, so the founder can see the work happen.
	if (TypedTo >= 0 && TypedTo < Typing.Len())
	{
		TypeWait -= DeltaSeconds;
		while (TypeWait <= 0.0f && TypedTo < Typing.Len())
		{
			++TypedTo;
			TypeWait += FMath::Max(WonderWebBrowseTuning::CVarTypeSeconds.GetValueOnGameThread(), 0.005f);
		}
		Caption = Typing.Left(TypedTo);
		Changed();
		if (TypedTo >= Typing.Len())
		{
			TypedTo = -1;
		}
	}
	return true;
}

void UWonderlandWonderWebBrowseSubsystem::FollowJulius()
{
	const UWonderlandJuliusConnectSubsystem* Julius = Connect();
	if (Julius == nullptr)
	{
		return;
	}
	const FJuliusConnectTask* Task = Julius->GetSurface().CurrentTask();
	if (Task == nullptr || Task->TemplateId != WonderWebBrowseTuning::SocialTemplate)
	{
		return;
	}
	// THE PAGE MOVES ONLY AS THE GATE ALLOWS. Progress is how many steps the service has actually let Julius run; the page
	// does what that step did, once.
	if (Task->TaskId != ActedOnTask)
	{
		ActedOnTask = Task->TaskId;
		ActedOnStep = -1;
	}
	const FString Blocked = Task->BlockedReason;
	if (!Blocked.IsEmpty())
	{
		JuliusLine = FString::Printf(TEXT("JULIUS is waiting for the governed browser: %s"), *FString::Join(Task->BlockedOn, TEXT(", ")));
		Changed();
		return;
	}
	for (int32 Step = ActedOnStep + 1; Step <= Task->Progress - 1 && Step < 5; ++Step)
	{
		switch (Step)
		{
		case 0:
			// Open the studio profile.
			SelectTab(TEXT("social"));
			JuliusLine = TEXT("JULIUS opened instagram.com/wonderland.studio in the governed browser");
			break;
		case 1:
			JuliusLine = TEXT("JULIUS read the posts already on the profile");
			break;
		case 2:
			// Write the caption: typed, not pasted, so it can be watched.
			Typing = TEXT("Pixel Canvas got a palette today -- five colours, sixteen by nine, painted in Wonderland.");
			TypedTo = 0;
			TypeWait = 0.0f;
			JuliusLine = TEXT("JULIUS is writing the caption");
			break;
		case 3:
			Caption = Typing.IsEmpty() ? Caption : Typing;
			TypedTo = -1;
			Publish();
			JuliusLine = TEXT("JULIUS published the post (SIMULATED -- nothing left this machine)");
			break;
		default:
			JuliusLine = TEXT("JULIUS re-read the profile: the post is there");
			break;
		}
		ActedOnStep = Step;
	}
	Changed();
}
