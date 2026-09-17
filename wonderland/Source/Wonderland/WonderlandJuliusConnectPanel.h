// WONDERLAND — THE CONNECTIONS WINDOW: Julius Connect in a Wonder Web window.
//
// WONDER WEB IS THE CONNECTIONS CONTROL CENTER (founder, 2026-09-17). One window of the workspace, drawn in the same
// yellow-on-black as every Wonder Web window, showing -- from the Julius Connect service's surface, never from memory --
// every service with its state, route, account, what was granted and deliberately denied, what this project may use,
// the missions using it, its health and last activity; the authorization Julius is waiting on, with what it asks for
// and what it plainly does not; Julius's task and why it is blocked; the audit trail; and a prompt with a fixed
// vocabulary. CONNECT, NOT NOW, REVOKE, RECONNECT and TEST ACCESS send intents; the service decides.
//
// Designed at 1536 x 1024, like the creation window, and drawn by the workspace layer scaled to where its glass stands.
#pragma once

#include "CoreMinimal.h"
#include "Styling/SlateTypes.h"
#include "Widgets/SCompoundWidget.h"

class SBox;
class SEditableText;
class SScrollBox;
class UWonderlandJuliusConnectSubsystem;
struct FJuliusConnectService;
struct FJuliusConnectSurface;

class WONDERLAND_API SWonderlandJuliusConnectPanel : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandJuliusConnectPanel) {}
		SLATE_ARGUMENT(TWeakObjectPtr<UWonderlandJuliusConnectSubsystem>, Connect)
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
		SLATE_EVENT(FSimpleDelegate, OnRequestMinimize)
		SLATE_EVENT(FSimpleDelegate, OnRequestExpand)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;

	static FVector2D DesignSize() { return FVector2D(1536.0, 1024.0); }

	/** Where a named control sits, in window pixels, from the last frame it was drawn ("approve", "revoke:dev-figma" ...). */
	bool GetControlCentre(FName Control, FVector2D& OutCentre) const;
	/** Whether VIEW DETAILS is open on the prompt. */
	bool IsShowingDetails() const { return bShowDetails; }

private:
	void Rebuild();
	TSharedRef<SWidget> MakeServices(const FJuliusConnectSurface& Surface);
	TSharedRef<SWidget> MakeServiceRow(const FJuliusConnectService& Service);
	TSharedRef<SWidget> MakeRight(const FJuliusConnectSurface& Surface);
	TSharedRef<SWidget> MakeAudit(const FJuliusConnectSurface& Surface);
	TSharedRef<SWidget> MakeTerminalLines();
	TSharedRef<SWidget> MakeOffline();
	TSharedRef<SWidget> Probe(FName Id, TSharedRef<SWidget> Content);
	TSharedRef<SWidget> ActionButton(FName Id, const FText& Label, bool bPrimary, TFunction<void()> OnClick, int32 FontSize = 20);

	TWeakObjectPtr<UWonderlandJuliusConnectSubsystem> Connect;
	FSimpleDelegate OnRequestClose;
	FSimpleDelegate OnRequestMinimize;
	FSimpleDelegate OnRequestExpand;

	int32 ShownRevision = -1;
	FString ServicesKey;
	FString RightKey;
	FString AuditKey;
	int32 ShownLines = -1;
	bool bShowDetails = false;
	TSharedPtr<SBox> ServicesSlot;
	TSharedPtr<SBox> RightSlot;
	TSharedPtr<SBox> AuditSlot;
	TSharedPtr<SBox> TerminalLinesSlot;
	TSharedPtr<SScrollBox> TerminalScroll;
	TSharedPtr<SEditableText> TerminalInput;

	TMap<FName, FVector2D> ControlCentres;
	TMap<FName, double> ControlSeenAt;
	double Now = 0.0;
	/** Frames left before the terminal scrolls to its newest line: new lines must be laid out before the end is known. */
	int32 ScrollTerminalIn = 0;

	FSlateBrush WindowBrush;
	FSlateBrush LineBrush;
	FSlateBrush AddressBrush;
	FSlateBrush TabActiveBrush;
	FSlateBrush NoticeBrush;
	FSlateBrush CardBrush;
	FSlateBrush PromptBrush;
	FSlateBrush PillBrush;
	FSlateBrush BarBrush;
	FSlateBrush PrimaryBrush;
	FSlateBrush PrimaryHoverBrush;
	FSlateBrush ActionBrush;
	FSlateBrush ActionHoverBrush;
	FSlateBrush ClearBrush;
	FSlateBrush DotBrush;
	FButtonStyle IconStyle;
	FButtonStyle PrimaryStyle;
	FButtonStyle ActionStyle;
	FEditableTextStyle InputStyle;
};

/** A minimized Wonder Web window: a small live chip along the bottom of the workspace. Clicking it restores the window. */
class WONDERLAND_API SWonderWebWindowChip : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderWebWindowChip) {}
		SLATE_ATTRIBUTE(FText, Title)
		SLATE_ATTRIBUTE(FText, Status)
		SLATE_ATTRIBUTE(FSlateColor, StatusColor)
		SLATE_EVENT(FSimpleDelegate, OnRestore)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	static FVector2D DesignSize() { return FVector2D(560.0, 96.0); }

private:
	FSlateBrush ChipBrush;
	FSlateBrush ChipHoverBrush;
	FButtonStyle ChipStyle;
};
