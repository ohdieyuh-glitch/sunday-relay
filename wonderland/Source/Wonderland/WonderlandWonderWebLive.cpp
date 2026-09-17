#include "WonderlandWonderWebLive.h"

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
		TEXT("Wonder Web Live: frames a second asked of the runtime's browser. One request is in flight at a time, so a slow page simply arrives slower."));
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
	// A page left open in the runtime is a page still costing memory: say so on the way out.
	if (!LiveTab.IsEmpty())
	{
		SendIntent(FString::Printf(TEXT("{\"op\":\"close\",\"tab\":\"%s\"}"), *LiveTab), TEXT("close"));
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
	Frame = nullptr;
	Super::Deinitialize();
}

FString UWonderlandWonderWebLiveSubsystem::BaseUrl()
{
	static IConsoleVariable* Url = IConsoleManager::Get().FindConsoleVariable(TEXT("wl.JuliusConnect.Url"));
	FString Base = Url != nullptr ? Url->GetString() : FString();
	// Loopback only, exactly as the Connections client: this browser is a process on this machine and nowhere else.
	if (!Base.StartsWith(TEXT("http://127.0.0.1:")) && !Base.StartsWith(TEXT("http://localhost:")))
	{
		Base = TEXT("http://127.0.0.1:8795");
	}
	Base.RemoveFromEnd(TEXT("/"));
	return Base + TEXT("/julius-connect/v1/browser");
}

FString UWonderlandWonderWebLiveSubsystem::DescribeLive() const
{
	return FString::Printf(TEXT("live_tab=%s live_url=%s frames=%d size=%dx%d loading=%d problem=\"%s\""),
		LiveTab.IsEmpty() ? TEXT("-") : *LiveTab, LiveUrl.IsEmpty() ? TEXT("-") : *LiveUrl,
		FrameCount, FrameSize.X, FrameSize.Y, bLoading ? 1 : 0, *Problem);
}

void UWonderlandWonderWebLiveSubsystem::Navigate(const FString& TabId, const FString& Url)
{
	FString Host;
	// CHECKED HERE FIRST. The runtime checks again before it fetches; neither check is the only one.
	if (!UWonderlandWonderWebBrowseSubsystem::IsHostAllowed(Url, Host))
	{
		Problem = Host.IsEmpty()
			? FString::Printf(TEXT("'%s' is not an http(s) address, so nothing was asked for"), *Url)
			: FString::Printf(TEXT("%s is not on wl.WonderWeb.RealHosts, so nothing was asked for"), *Host);
		UE_LOG(LogWonderWebLive, Warning, TEXT("WLLIVE refused: %s"), *Problem);
		return;
	}
	if (!LiveTab.IsEmpty() && LiveTab != TabId)
	{
		SendIntent(FString::Printf(TEXT("{\"op\":\"close\",\"tab\":\"%s\"}"), *LiveTab), TEXT("close"));
	}
	LiveTab = TabId;
	LiveUrl = Url;
	Problem.Reset();
	bLoading = true;
	UE_LOG(LogWonderWebLive, Display, TEXT("WLLIVE navigate %s -> %s"), *TabId, *Url);
	// The page is opened first, then sized to the window it will be drawn in, then sent to the address: that way it lays
	// itself out once, for the shape it is actually going to be seen in.
	SendIntent(FString::Printf(TEXT("{\"op\":\"viewport\",\"tab\":\"%s\",\"width\":%d,\"height\":%d}"), *TabId, Viewport.X, Viewport.Y), TEXT("viewport"));
	AskedViewport = Viewport;
	SendIntent(FString::Printf(TEXT("{\"op\":\"navigate\",\"tab\":\"%s\",\"url\":\"%s\"}"), *TabId, *Url), TEXT("navigate"));
}

void UWonderlandWonderWebLiveSubsystem::SetViewport(FIntPoint Size)
{
	Size.X = FMath::Clamp(Size.X, 480, 2400);
	Size.Y = FMath::Clamp(Size.Y, 320, 1800);
	// A few pixels of drift is a window being dragged, not a new layout: only a real change is worth re-rendering for.
	if (FMath::Abs(Size.X - Viewport.X) < 12 && FMath::Abs(Size.Y - Viewport.Y) < 12)
	{
		return;
	}
	Viewport = Size;
	if (!LiveTab.IsEmpty() && Viewport != AskedViewport)
	{
		AskedViewport = Viewport;
		SendIntent(FString::Printf(TEXT("{\"op\":\"viewport\",\"tab\":\"%s\",\"width\":%d,\"height\":%d}"), *LiveTab, Viewport.X, Viewport.Y), TEXT("viewport"));
	}
}

void UWonderlandWonderWebLiveSubsystem::CloseTab(const FString& TabId)
{
	if (!TabId.IsEmpty())
	{
		SendIntent(FString::Printf(TEXT("{\"op\":\"close\",\"tab\":\"%s\"}"), *TabId), TEXT("close"));
	}
	if (TabId == LiveTab)
	{
		LiveTab.Reset();
		LiveUrl.Reset();
		Title.Reset();
		bLoading = false;
		Frame = nullptr;
	}
}

void UWonderlandWonderWebLiveSubsystem::SendClick(double PageX, double PageY)
{
	if (LiveTab.IsEmpty())
	{
		return;
	}
	SendIntent(FString::Printf(TEXT("{\"op\":\"click\",\"tab\":\"%s\",\"x\":%.0f,\"y\":%.0f}"), *LiveTab, PageX, PageY), TEXT("click"));
	bLoading = true;
}

void UWonderlandWonderWebLiveSubsystem::SendScroll(double DeltaY)
{
	if (!LiveTab.IsEmpty())
	{
		SendIntent(FString::Printf(TEXT("{\"op\":\"scroll\",\"tab\":\"%s\",\"deltaY\":%.0f}"), *LiveTab, DeltaY), TEXT("scroll"));
	}
}

void UWonderlandWonderWebLiveSubsystem::SendText(const FString& Text)
{
	if (LiveTab.IsEmpty() || Text.IsEmpty())
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
	SendIntent(FString::Printf(TEXT("{\"op\":\"type\",\"tab\":\"%s\",\"text\":\"%s\"}"), *LiveTab, *Escaped), nullptr);
}

void UWonderlandWonderWebLiveSubsystem::SendKey(const FString& Key)
{
	if (!LiveTab.IsEmpty())
	{
		SendIntent(FString::Printf(TEXT("{\"op\":\"key\",\"tab\":\"%s\",\"key\":\"%s\"}"), *LiveTab, *Key), TEXT("key"));
	}
}

void UWonderlandWonderWebLiveSubsystem::SendBack()
{
	if (!LiveTab.IsEmpty())
	{
		SendIntent(FString::Printf(TEXT("{\"op\":\"back\",\"tab\":\"%s\"}"), *LiveTab), TEXT("back"));
		bLoading = true;
	}
}

void UWonderlandWonderWebLiveSubsystem::SendIntent(const FString& Body, const TCHAR* What)
{
	const FString Describe = What != nullptr ? FString(What) : FString(TEXT("type"));
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(BaseUrl() + TEXT("/intent"));
	Request->SetVerb(TEXT("POST"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetContentAsString(Body);
	Request->SetTimeout(30.0f);
	Request->OnProcessRequestComplete().BindWeakLambda(this, [this, Describe](FHttpRequestPtr Done, FHttpResponsePtr Response, bool bConnected)
	{
		InFlight.Remove(Done);
		if (!bConnected || !Response.IsValid())
		{
			Problem = FString::Printf(TEXT("The Julius Connect runtime is not answering, so %s did nothing."), *Describe);
			bLoading = false;
			return;
		}
		if (Response->GetResponseCode() >= 400)
		{
			// The refusal the runtime gave, shown as it was given: an allowlist is only useful if it is visible.
			Problem = Response->GetContentAsString().Left(240);
			bLoading = false;
			UE_LOG(LogWonderWebLive, Warning, TEXT("WLLIVE %s refused: %s"), *Describe, *Problem);
			return;
		}
		Problem.Reset();
	});
	InFlight.Add(Request);
	Request->ProcessRequest();
}

bool UWonderlandWonderWebLiveSubsystem::Tick(float DeltaSeconds)
{
	if (LiveTab.IsEmpty())
	{
		return true;
	}
	SinceFrame += DeltaSeconds;
	const float Period = 1.0f / FMath::Clamp(WonderWebLiveTuning::CVarFps.GetValueOnGameThread(), 0.5f, 20.0f);
	if (!bFrameInFlight && SinceFrame >= Period)
	{
		SinceFrame = 0.0f;
		RequestFrame();
	}
	return true;
}

void UWonderlandWonderWebLiveSubsystem::RequestFrame()
{
	bFrameInFlight = true;
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(FString::Printf(TEXT("%s/frame?tab=%s"), *BaseUrl(), *LiveTab));
	Request->SetVerb(TEXT("GET"));
	Request->SetTimeout(20.0f);
	Request->OnProcessRequestComplete().BindWeakLambda(this, [this](FHttpRequestPtr Done, FHttpResponsePtr Response, bool bConnected)
	{
		InFlight.Remove(Done);
		bFrameInFlight = false;
		if (!bConnected || !Response.IsValid())
		{
			Problem = FString::Printf(TEXT("The Julius Connect runtime is not running at %s."), *BaseUrl());
			return;
		}
		if (Response->GetResponseCode() != 200)
		{
			Problem = Response->GetContentAsString().Left(240);
			return;
		}
		const FString Url = Response->GetHeader(TEXT("X-Wonder-Web-Url"));
		if (!Url.IsEmpty())
		{
			LiveUrl = Url;
		}
		const FString Encoded = Response->GetHeader(TEXT("X-Wonder-Web-Title"));
		if (!Encoded.IsEmpty())
		{
			Title = FGenericPlatformHttp::UrlDecode(Encoded);
		}
		bLoading = Response->GetHeader(TEXT("X-Wonder-Web-Loading")) == TEXT("1");
		if (ApplyJpeg(Response->GetContent()))
		{
			Problem.Reset();
			++FrameCount;
			if (WonderWebLiveTuning::CVarLog.GetValueOnGameThread() != 0)
			{
				UE_LOG(LogWonderWebLive, Display, TEXT("WLLIVE frame %d %dx%d %s"), FrameCount, FrameSize.X, FrameSize.Y, *LiveUrl);
			}
			OnFrame.Broadcast();
		}
	});
	InFlight.Add(Request);
	Request->ProcessRequest();
}

bool UWonderlandWonderWebLiveSubsystem::ApplyJpeg(const TArray<uint8>& Bytes)
{
	if (Bytes.Num() < 4)
	{
		return false;
	}
	IImageWrapperModule& Wrappers = FModuleManager::LoadModuleChecked<IImageWrapperModule>(TEXT("ImageWrapper"));
	const TSharedPtr<IImageWrapper> Wrapper = Wrappers.CreateImageWrapper(EImageFormat::JPEG);
	if (!Wrapper.IsValid() || !Wrapper->SetCompressed(Bytes.GetData(), Bytes.Num()))
	{
		Problem = TEXT("The runtime sent something that is not a JPEG frame.");
		return false;
	}
	TArray64<uint8> Raw;
	if (!Wrapper->GetRaw(ERGBFormat::BGRA, 8, Raw))
	{
		Problem = TEXT("The frame could not be decoded.");
		return false;
	}
	const int32 Width = Wrapper->GetWidth();
	const int32 Height = Wrapper->GetHeight();
	if (Width <= 0 || Height <= 0 || Raw.Num() < static_cast<int64>(Width) * Height * 4)
	{
		return false;
	}
	FrameSize = FIntPoint(Width, Height);
	if (Frame == nullptr || Frame->GetSizeX() != Width || Frame->GetSizeY() != Height)
	{
		Frame = UTexture2D::CreateTransient(Width, Height, PF_B8G8R8A8);
		if (Frame == nullptr)
		{
			return false;
		}
		Frame->NeverStream = true;
		Frame->SRGB = true;
		Frame->Filter = TF_Bilinear;
		Frame->AddressX = TA_Clamp;
		Frame->AddressY = TA_Clamp;
		Frame->UpdateResource();
	}
	// The decoded frame is handed to the render thread and freed there, so the game thread never waits on the copy.
	uint8* Pixels = static_cast<uint8*>(FMemory::Malloc(Raw.Num()));
	FMemory::Memcpy(Pixels, Raw.GetData(), Raw.Num());
	FUpdateTextureRegion2D* Region = new FUpdateTextureRegion2D(0, 0, 0, 0, Width, Height);
	Frame->UpdateTextureRegions(0, 1, Region, Width * 4, 4, Pixels,
		[](uint8* Data, const FUpdateTextureRegion2D* Done)
		{
			FMemory::Free(Data);
			delete Done;
		});
	return true;
}
