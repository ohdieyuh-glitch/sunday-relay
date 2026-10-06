#include "WonderlandWonderWebLive.h"
#include "WonderlandCard.h"
#include "WonderlandBeta.h"
#include "WonderlandJuliusStream.h"

#include "Engine/Texture2D.h"
#include "GenericPlatform/GenericPlatformHttp.h"
#include "HAL/IConsoleManager.h"
#include "HttpModule.h"
#include "IImageWrapper.h"
#include "IImageWrapperModule.h"
#include "Interfaces/IHttpResponse.h"
#include "Modules/ModuleManager.h"
#include "RenderUtils.h"
#include "WonderlandWonderWebBrowse.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderWebLive, Log, All);

namespace WonderWebLiveTuning
{
	TAutoConsoleVariable<float> CVarFps(TEXT("wl.WonderWeb.Live.Fps"), 4.0f,
		TEXT("Wonder Web Live: frames a second asked of the runtime's browser for the window in front. One request is in flight at a time per window, so a slow page simply arrives slower."));
	TAutoConsoleVariable<float> CVarBackgroundShare(TEXT("wl.WonderWeb.Live.BackgroundShare"), 0.25f,
		TEXT("Wonder Web Live: the share of the front window's frame rate that the windows behind it get."));
	TAutoConsoleVariable<float> CVarForgetSeconds(TEXT("wl.WonderWeb.Live.ForgetSeconds"), 2.0f,
		TEXT("Wonder Web Live: stop asking for a window's frames this long after anything last drew it."));
	TAutoConsoleVariable<int32> CVarLog(TEXT("wl.WonderWeb.Live.Log"), 0,
		TEXT("Wonder Web Live: 1 logs every frame that arrives. Addresses and sizes only -- never what was typed."));
}

void UWonderlandWonderWebLiveSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	Ticker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateUObject(this, &UWonderlandWonderWebLiveSubsystem::Tick), 0.0f);
}

void UWonderlandWonderWebLiveSubsystem::Deinitialize()
{
	if (Ticker.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(Ticker);
		Ticker.Reset();
	}
	// A page left open in the runtime is a page still costing memory: say so on the way out, for every window that had one.
	for (const TPair<FString, FWonderWebLivePage>& Pair : Pages)
	{
		if (!Pair.Value.bFollowing)
		{
			SendIntent(Pair.Key, FString::Printf(TEXT("{\"op\":\"close\",\"tab\":\"%s\"}"), *Pair.Key), TEXT("close"));
		}
	}
	for (const FHttpRequestPtr& Request : InFlight)
	{
		if (Request.IsValid())
		{
			Request->OnProcessRequestComplete().Unbind();
			Request->CancelRequest();
		}
	}
	InFlight.Reset();
	Pages.Reset();
	Super::Deinitialize();
}

FString UWonderlandWonderWebLiveSubsystem::BaseUrl()
{
	static IConsoleVariable* Url = IConsoleManager::Get().FindConsoleVariable(TEXT("wl.JuliusConnect.Url"));
	FString Base = Url != nullptr ? Url->GetString() : FString();
	// Loopback only, exactly as the Connections client: this browser is a process on this machine and nowhere else -- the whole
	// authority read by the ONE loopback parser (Second's review of 614695e7, the same class as minor 1)
	if (!Base.StartsWith(TEXT("http://"), ESearchCase::IgnoreCase) || !WonderlandJuliusStreamLogic::IsLoopbackAuthority(Base.RightChop(7)))
	{
		Base = TEXT("http://127.0.0.1:8795");
	}
	Base.RemoveFromEnd(TEXT("/"));
	return Base + TEXT("/julius-connect/v1/browser");
}

FWonderWebLivePage& UWonderlandWonderWebLiveSubsystem::PageFor(const FString& TabId)
{
	return Pages.FindOrAdd(TabId);
}

UTexture2D* UWonderlandWonderWebLiveSubsystem::GetFrame(const FString& TabId) const
{
	const FWonderWebLivePage* Page = Find(TabId);
	return Page != nullptr ? Page->Frame.Get() : nullptr;
}

FIntPoint UWonderlandWonderWebLiveSubsystem::GetFrameSize(const FString& TabId) const
{
	const FWonderWebLivePage* Page = Find(TabId);
	return Page != nullptr ? Page->FrameSize : FIntPoint(1200, 800);
}

FString UWonderlandWonderWebLiveSubsystem::GetLiveUrl(const FString& TabId) const
{
	const FWonderWebLivePage* Page = Find(TabId);
	return Page != nullptr ? Page->Url : FString();
}

FString UWonderlandWonderWebLiveSubsystem::GetTitle(const FString& TabId) const
{
	const FWonderWebLivePage* Page = Find(TabId);
	return Page != nullptr ? Page->Title : FString();
}

bool UWonderlandWonderWebLiveSubsystem::IsLoading(const FString& TabId) const
{
	const FWonderWebLivePage* Page = Find(TabId);
	return Page != nullptr && Page->bLoading;
}

FString UWonderlandWonderWebLiveSubsystem::GetProblem(const FString& TabId) const
{
	const FWonderWebLivePage* Page = Find(TabId);
	return Page != nullptr ? Page->Problem : FString();
}

bool UWonderlandWonderWebLiveSubsystem::HasFrame(const FString& TabId) const
{
	const FWonderWebLivePage* Page = Find(TabId);
	return Page != nullptr && Page->Frame.IsValid();
}

bool UWonderlandWonderWebLiveSubsystem::IsFollowing(const FString& TabId) const
{
	const FWonderWebLivePage* Page = Find(TabId);
	return Page != nullptr && Page->bFollowing;
}

int32 UWonderlandWonderWebLiveSubsystem::GetFrameCount(const FString& TabId) const
{
	const FWonderWebLivePage* Page = Find(TabId);
	return Page != nullptr ? Page->FrameCount : 0;
}

TArray<FString> UWonderlandWonderWebLiveSubsystem::OpenTabs() const
{
	TArray<FString> Tabs;
	Pages.GetKeys(Tabs);
	Tabs.Sort();
	return Tabs;
}

FString UWonderlandWonderWebLiveSubsystem::DescribeLive() const
{
	if (Pages.IsEmpty())
	{
		return TEXT("live_pages=0 front=-");
	}
	TArray<FString> Rows;
	for (const FString& TabId : OpenTabs())
	{
		const FWonderWebLivePage& Page = Pages[TabId];
		Rows.Add(FString::Printf(TEXT("%s[url=%s following=%d frames=%d size=%dx%d loading=%d problem=\"%s\"]"),
			*TabId, Page.Url.IsEmpty() ? TEXT("-") : *Page.Url, Page.bFollowing ? 1 : 0, Page.FrameCount,
			Page.FrameSize.X, Page.FrameSize.Y, Page.bLoading ? 1 : 0, *Page.Problem));
	}
	return FString::Printf(TEXT("live_pages=%d front=%s %s"), Pages.Num(), Front.IsEmpty() ? TEXT("-") : *Front, *FString::Join(Rows, TEXT(" ")));
}

void UWonderlandWonderWebLiveSubsystem::Navigate(const FString& TabId, const FString& Url)
{
	FString Host;
	// CHECKED HERE FIRST. The runtime checks again before it fetches; neither check is the only one.
	if (!UWonderlandWonderWebBrowseSubsystem::IsHostAllowed(Url, Host))
	{
		FWonderWebLivePage& Refused = PageFor(TabId);
		Refused.Problem = Host.IsEmpty()
			? FString::Printf(TEXT("'%s' is not an http(s) address, so nothing was asked for"), *Url)
			: FString::Printf(TEXT("%s is not on wl.WonderWeb.RealHosts, so nothing was asked for"), *Host);
		UE_LOG(LogWonderWebLive, Warning, TEXT("WLLIVE refused: %s"), *Refused.Problem);
		return;
	}
	FWonderWebLivePage& Page = PageFor(TabId);
	Page.Url = Url;
	Page.bFollowing = false;
	Page.bLoading = true;
	Page.Problem.Reset();
	Page.WantedAt = FPlatformTime::Seconds();
	UE_LOG(LogWonderWebLive, Display, TEXT("WLLIVE navigate %s -> %s"), *TabId, *FWonderlandCardStore::MaskForDisplay(Url));
	// The page is opened first, then sized to the window it will be drawn in, then sent to the address: that way it lays
	// itself out once, for the shape it is actually going to be seen in.
	SendIntent(TabId, FString::Printf(TEXT("{\"op\":\"viewport\",\"tab\":\"%s\",\"width\":%d,\"height\":%d}"), *TabId, Page.Viewport.X, Page.Viewport.Y), TEXT("viewport"));
	Page.AskedViewport = Page.Viewport;
	SendIntent(TabId, FString::Printf(TEXT("{\"op\":\"navigate\",\"tab\":\"%s\",\"url\":\"%s\"}"), *TabId, *Url), TEXT("navigate"));
}

void UWonderlandWonderWebLiveSubsystem::Follow(const FString& TabId)
{
	FWonderWebLivePage& Page = PageFor(TabId);
	if (Page.bFollowing)
	{
		return;
	}
	Page.bFollowing = true;
	Page.bLoading = true;
	Page.Problem.Reset();
	Page.Frame.Reset();
	Page.FrameCount = 0;
	Page.WantedAt = FPlatformTime::Seconds();
	UE_LOG(LogWonderWebLive, Display, TEXT("WLLIVE watching the tab Julius works in: %s"), *TabId);
}

void UWonderlandWonderWebLiveSubsystem::SetViewport(const FString& TabId, FIntPoint Size)
{
	FWonderWebLivePage& Page = PageFor(TabId);
	// DRAWN MEANS WANTED. A window that stopped being drawn stops asking for frames a second or two later.
	Page.WantedAt = FPlatformTime::Seconds();
	Size.X = FMath::Clamp(Size.X, 480, 2400);
	Size.Y = FMath::Clamp(Size.Y, 320, 1800);
	// A few pixels of drift is a window being dragged, not a new layout: only a real change is worth re-rendering for.
	if (FMath::Abs(Size.X - Page.Viewport.X) < 12 && FMath::Abs(Size.Y - Page.Viewport.Y) < 12)
	{
		return;
	}
	Page.Viewport = Size;
	if (Page.Viewport != Page.AskedViewport && !Page.bFollowing)
	{
		Page.AskedViewport = Page.Viewport;
		SendIntent(TabId, FString::Printf(TEXT("{\"op\":\"viewport\",\"tab\":\"%s\",\"width\":%d,\"height\":%d}"), *TabId, Page.Viewport.X, Page.Viewport.Y), TEXT("viewport"));
	}
}

void UWonderlandWonderWebLiveSubsystem::SetFront(const FString& TabId)
{
	Front = TabId;
}

void UWonderlandWonderWebLiveSubsystem::CloseTab(const FString& TabId)
{
	const FWonderWebLivePage* Page = Find(TabId);
	if (Page == nullptr)
	{
		return;
	}
	// Only close what this client opened: the tab Julius works in belongs to Julius.
	if (!Page->bFollowing)
	{
		SendIntent(TabId, FString::Printf(TEXT("{\"op\":\"close\",\"tab\":\"%s\"}"), *TabId), TEXT("close"));
	}
	Pages.Remove(TabId);
	if (Front == TabId)
	{
		Front.Reset();
	}
}

void UWonderlandWonderWebLiveSubsystem::SendClick(const FString& TabId, double PageX, double PageY)
{
	FWonderWebLivePage* Page = Pages.Find(TabId);
	if (Page == nullptr)
	{
		return;
	}
	SendIntent(TabId, FString::Printf(TEXT("{\"op\":\"click\",\"tab\":\"%s\",\"x\":%.0f,\"y\":%.0f}"), *TabId, PageX, PageY), TEXT("click"));
	Page->bLoading = true;
}

void UWonderlandWonderWebLiveSubsystem::SendScroll(const FString& TabId, double DeltaY)
{
	if (Pages.Contains(TabId))
	{
		SendIntent(TabId, FString::Printf(TEXT("{\"op\":\"scroll\",\"tab\":\"%s\",\"deltaY\":%.0f}"), *TabId, DeltaY), TEXT("scroll"));
	}
}

void UWonderlandWonderWebLiveSubsystem::SendText(const FString& TabId, const FString& Text)
{
	if (!Pages.Contains(TabId) || Text.IsEmpty())
	{
		return;
	}
	FString Escaped;
	for (const TCHAR Char : Text)
	{
		if (Char == TEXT('"') || Char == TEXT('\\'))
		{
			Escaped.AppendChar(TEXT('\\'));
			Escaped.AppendChar(Char);
		}
		else if (Char >= 0x20)
		{
			Escaped.AppendChar(Char);
		}
	}
	// NOT LOGGED, EVER. This may be a password; it is the page's business and nobody else's.
	SendIntent(TabId, FString::Printf(TEXT("{\"op\":\"type\",\"tab\":\"%s\",\"text\":\"%s\"}"), *TabId, *Escaped), nullptr);
}

void UWonderlandWonderWebLiveSubsystem::SendKey(const FString& TabId, const FString& Key)
{
	if (Pages.Contains(TabId))
	{
		SendIntent(TabId, FString::Printf(TEXT("{\"op\":\"key\",\"tab\":\"%s\",\"key\":\"%s\"}"), *TabId, *Key), TEXT("key"));
	}
}

void UWonderlandWonderWebLiveSubsystem::SendBack(const FString& TabId)
{
	if (FWonderWebLivePage* Page = Pages.Find(TabId))
	{
		SendIntent(TabId, FString::Printf(TEXT("{\"op\":\"back\",\"tab\":\"%s\"}"), *TabId), TEXT("back"));
		Page->bLoading = true;
	}
}

void UWonderlandWonderWebLiveSubsystem::SendIntent(const FString& TabId, const FString& Body, const TCHAR* What)
{
	// NOT PART OF THIS BETA (private beta): live pages are opened by Julius through the local runtime, which a player's
	// session never contacts. The page says so instead of "no answer ... start it".
	if (!WonderlandBeta::UseLocalAiServices())
	{
		if (FWonderWebLivePage* Page = Pages.Find(TabId))
		{
			Page->Problem = TEXT("Live pages are opened by Julius, which is not part of this beta build.");
			Page->bLoading = false;
		}
		return;
	}
	const FString Describe = What != nullptr ? FString(What) : FString(TEXT("type"));
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(BaseUrl() + TEXT("/intent"));
	Request->SetVerb(TEXT("POST"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetContentAsString(Body);
	Request->SetTimeout(30.0f);
	Request->OnProcessRequestComplete().BindWeakLambda(this, [this, Describe, TabId](FHttpRequestPtr Done, FHttpResponsePtr Response, bool bConnected)
	{
		InFlight.Remove(Done);
		FWonderWebLivePage* Page = Pages.Find(TabId);
		if (Page == nullptr)
		{
			return;
		}
		if (!bConnected || !Response.IsValid())
		{
			// NOT NECESSARILY DOWN: a request cancelled as play ends looks the same from here, so this says what is known.
			Page->Problem = FString::Printf(TEXT("No answer from the Julius Connect runtime, so %s did nothing."), *Describe);
			Page->bLoading = false;
			return;
		}
		if (Response->GetResponseCode() >= 400)
		{
			// The refusal the runtime gave, shown as it was given: an allowlist is only useful if it is visible.
			Page->Problem = Response->GetContentAsString().Left(240);
			Page->bLoading = false;
			UE_LOG(LogWonderWebLive, Warning, TEXT("WLLIVE %s refused: %s"), *Describe, *Page->Problem);
			return;
		}
		Page->Problem.Reset();
	});
	InFlight.Add(Request);
	Request->ProcessRequest();
}

bool UWonderlandWonderWebLiveSubsystem::Tick(float DeltaSeconds)
{
	if (Pages.IsEmpty())
	{
		return true;
	}
	const double Now = FPlatformTime::Seconds();
	const float Fps = FMath::Clamp(WonderWebLiveTuning::CVarFps.GetValueOnGameThread(), 0.5f, 20.0f);
	const float Share = FMath::Clamp(WonderWebLiveTuning::CVarBackgroundShare.GetValueOnGameThread(), 0.05f, 1.0f);
	const double Forget = FMath::Max(WonderWebLiveTuning::CVarForgetSeconds.GetValueOnGameThread(), 0.25f);
	TArray<FString> Ask;
	for (TPair<FString, FWonderWebLivePage>& Pair : Pages)
	{
		FWonderWebLivePage& Page = Pair.Value;
		// NOBODY IS LOOKING. A window that is not being drawn -- minimized, or closed and not yet cleaned up -- costs the
		// runtime nothing until it is drawn again.
		if (Now - Page.WantedAt > Forget)
		{
			continue;
		}
		Page.SinceFrame += DeltaSeconds;
		// THE WINDOW IN FRONT IS WORTH MORE. The others still move, at a quarter of the rate by default.
		const float Period = 1.0f / (Pair.Key == Front ? Fps : FMath::Max(Fps * Share, 0.25f));
		if (!Page.bFrameInFlight && Page.SinceFrame >= Period)
		{
			Page.SinceFrame = 0.0f;
			Ask.Add(Pair.Key);
		}
	}
	for (const FString& TabId : Ask)
	{
		RequestFrame(TabId);
	}
	return true;
}

void UWonderlandWonderWebLiveSubsystem::RequestFrame(const FString& TabId)
{
	FWonderWebLivePage* Asked = Pages.Find(TabId);
	if (Asked == nullptr)
	{
		return;
	}
	if (!WonderlandBeta::UseLocalAiServices())
	{
		Asked->Problem = TEXT("Live pages are opened by Julius, which is not part of this beta build.");
		return;
	}
	Asked->bFrameInFlight = true;
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(FString::Printf(TEXT("%s/frame?tab=%s"), *BaseUrl(), *TabId));
	Request->SetVerb(TEXT("GET"));
	Request->SetTimeout(20.0f);
	Request->OnProcessRequestComplete().BindWeakLambda(this, [this, TabId](FHttpRequestPtr Done, FHttpResponsePtr Response, bool bConnected)
	{
		InFlight.Remove(Done);
		FWonderWebLivePage* Page = Pages.Find(TabId);
		if (Page == nullptr)
		{
			return;
		}
		Page->bFrameInFlight = false;
		if (!bConnected || !Response.IsValid())
		{
			Page->Problem = FString::Printf(TEXT("No answer from the Julius Connect runtime at %s — start it, or it is shutting down."), *BaseUrl());
			return;
		}
		if (Response->GetResponseCode() == 404)
		{
			// NO PAGE ON THIS TAB YET. Watching a tab Julius has not opened is the normal way this starts, so say that
			// rather than showing the runtime's own words for it.
			Page->Problem = Page->bFollowing ? TEXT("Waiting for Julius to open a page.") : TEXT("Nothing is open on this tab yet.");
			return;
		}
		if (Response->GetResponseCode() != 200)
		{
			Page->Problem = Response->GetContentAsString().Left(240);
			return;
		}
		const FString Url = Response->GetHeader(TEXT("X-Wonder-Web-Url"));
		if (!Url.IsEmpty())
		{
			Page->Url = Url;
		}
		const FString Encoded = Response->GetHeader(TEXT("X-Wonder-Web-Title"));
		if (!Encoded.IsEmpty())
		{
			Page->Title = FGenericPlatformHttp::UrlDecode(Encoded);
		}
		Page->bLoading = Response->GetHeader(TEXT("X-Wonder-Web-Loading")) == TEXT("1");
		if (ApplyJpeg(*Page, Response->GetContent()))
		{
			Page->Problem.Reset();
			++Page->FrameCount;
			if (WonderWebLiveTuning::CVarLog.GetValueOnGameThread() != 0)
			{
				UE_LOG(LogWonderWebLive, Display, TEXT("WLLIVE %s frame %d %dx%d %s"), *TabId, Page->FrameCount, Page->FrameSize.X, Page->FrameSize.Y, *Page->Url);
			}
			OnFrame.Broadcast();
		}
	});
	InFlight.Add(Request);
	Request->ProcessRequest();
}

bool UWonderlandWonderWebLiveSubsystem::ApplyJpeg(FWonderWebLivePage& Page, const TArray<uint8>& Bytes)
{
	if (Bytes.Num() < 4)
	{
		return false;
	}
	IImageWrapperModule& Wrappers = FModuleManager::LoadModuleChecked<IImageWrapperModule>(TEXT("ImageWrapper"));
	const TSharedPtr<IImageWrapper> Wrapper = Wrappers.CreateImageWrapper(EImageFormat::JPEG);
	if (!Wrapper.IsValid() || !Wrapper->SetCompressed(Bytes.GetData(), Bytes.Num()))
	{
		Page.Problem = TEXT("The runtime sent something that is not a JPEG frame.");
		return false;
	}
	TArray64<uint8> Raw;
	if (!Wrapper->GetRaw(ERGBFormat::BGRA, 8, Raw))
	{
		Page.Problem = TEXT("The frame could not be decoded.");
		return false;
	}
	const int32 Width = Wrapper->GetWidth();
	const int32 Height = Wrapper->GetHeight();
	if (Width <= 0 || Height <= 0 || Raw.Num() < static_cast<int64>(Width) * Height * 4)
	{
		return false;
	}
	Page.FrameSize = FIntPoint(Width, Height);
	if (!Page.Frame.IsValid() || Page.Frame->GetSizeX() != Width || Page.Frame->GetSizeY() != Height)
	{
		UTexture2D* Texture = UTexture2D::CreateTransient(Width, Height, PF_B8G8R8A8);
		if (Texture == nullptr)
		{
			return false;
		}
		Texture->NeverStream = true;
		Texture->SRGB = true;
		Texture->Filter = TF_Bilinear;
		Texture->AddressX = TA_Clamp;
		Texture->AddressY = TA_Clamp;
		Texture->UpdateResource();
		Page.Frame.Reset(Texture);
	}
	// The decoded frame is handed to the render thread and freed there, so the game thread never waits on the copy.
	uint8* Pixels = static_cast<uint8*>(FMemory::Malloc(Raw.Num()));
	FMemory::Memcpy(Pixels, Raw.GetData(), Raw.Num());
	FUpdateTextureRegion2D* Region = new FUpdateTextureRegion2D(0, 0, 0, 0, Width, Height);
	Page.Frame->UpdateTextureRegions(0, 1, Region, Width * 4, 4, Pixels,
		[](uint8* Data, const FUpdateTextureRegion2D* Done)
		{
			FMemory::Free(Data);
			delete Done;
		});
	return true;
}
