// wl.Qa.SocialHubScroll -- row 14-Unreal, candidate C1 (CORE, 2026-10-07): the Social Hub keeps a player's scroll position through a
// server refresh.
//
// THE ACCEPTANCE TEST of the paid Julius mission.
// - Julius implements the behaviour and the six QA hooks below in WonderlandSocialHubPanel.cpp / .h.
// - This file is CORE's. It sits OUTSIDE the mission's slice and is byte-identical in the mission workspace, where it is a read-only
//   reference and is never compiled.
// - CORE compiles and runs it on the applied patch.
//
// THE HOOKS (SWonderlandSocialHubPanel, public, QA-only; these exact signatures):
//   float QaListScrollOffset() const;           the open tab's MAIN list: FRIENDS, REQUESTS, RECENT, the MESSAGES inbox, or PARTY's
//                                               party list (not the voice people list). Its SScrollBox::GetScrollOffset().
//   bool  QaSetListScrollOffset(float Offset);  as a player scrolling that list (SScrollBox::SetScrollOffset); false when the open
//                                               tab draws no such list.
//   float QaHistoryScrollOffset() const;        the open conversation's history: SScrollBox::GetScrollOffset().
//   bool  QaSetHistoryScrollOffset(float Offset);  false when no conversation is open.
//   bool  QaHistoryAtEnd() const;               the history's offset is within 1.0 Slate unit of SScrollBox::GetScrollOffsetOfEnd();
//                                               meaningful only after a layout.
//   void  QaSetScrollMemory(bool bOn);          OFF = the pre-fix behaviour EXACTLY: every rebuild starts the lists at the top and
//                                               the history at its end. Used by the controls SC5 / SC6. ON by default.
//
// THE BEHAVIOUR (what SC1-SC6 check; how it is built is the patch's choice):
//   - A REFRESH keeps the open tab's main list offset. A refresh is SetSnapshot, then the deferred rebuild (F-21: FlushRebuild or
//     Slate's pre-tick).
//   - A REFRESH keeps the open conversation's history offset when the player had scrolled back. When the player was at its end,
//     the history stays at its end and follows new messages.
//   - The memory never crosses conversations: a DIFFERENT conversation after a refresh starts at its end.
//   - The player's own OpenConversation (a click on a conversation row) opens it at its END, whatever was remembered.
//   - Out of scope (any behaviour is acceptable): tab switches; the voice people list on PARTY.
//   - F-21 stays intact: SetSnapshot / SetVoice still ask for a rebuild (RequestRebuild) and never rebuild at once; HandleSlatePreTick
//     / OnPreTick().AddSP stay; the reply draft carry (ReplyDraftConversationId) stays; wl.Qa.SocialHubClicks still reads 9/0.
//
// UE 5.8 SScrollBox FACTS this rests on (the installed engine, Runtime/Slate):
//   SScrollBox.h:312 float GetScrollOffset() const; :320 float GetViewFraction() const; :322 float GetViewOffsetFraction() const;
//   :325 float GetScrollOffsetOfEnd() const; :329 void SetScrollOffset(float NewScrollOffset); :331 void ScrollToStart();
//   :333 void ScrollToEnd().
//   - GetScrollOffset returns DesiredScrollOffset, UNCLAMPED (SScrollBox.cpp:496-499).
//   - SetScrollOffset stores DesiredScrollOffset, clears bScrollToEnd and does not clamp (:596-601). So it IS honoured on a NEW box
//     before its first layout, and reads back at once.
//   - ScrollToEnd only sets bScrollToEnd (:609-613). Tick resolves it from CachedGeometry: DesiredScrollOffset = max(content - view, 0)
//     (:908-912). Before a layout, GetScrollOffset still reads the old value (0 on a new box).
//   - GetScrollOffsetOfEnd uses CachedGeometry (:572-577), so it is only meaningful after a layout. The VISIBLE offset is clamped in
//     Tick through GetViewOffsetFraction (:587-593); DesiredScrollOffset itself is clamped only by ScrollBy (wheel / drag, :1236).
//   That is why this QA lays the off-screen panel out for real: FWidgetRenderer runs Slate's prepass, tick and paint. It draws twice
//   per state, as the map's off-screen render does (WonderlandUiSubsystem.cpp).
//
// Off-screen and fed: no synthetic people on any screen. Synchronous; WLQA HUBSCROLL lines; it does not quit.
#include "CoreMinimal.h"
#include "Engine/TextureRenderTarget2D.h"
#include "HAL/IConsoleManager.h"
#include "Slate/WidgetRenderer.h"
#include "WonderlandSocialHubPanel.h"

namespace WonderlandSocialHubScrollQa
{
	const FVector2D HubScrollDrawSize(1920.0, 1200.0);

	/** Prepass, tick and paint, twice: the first pass measures, the second draws the settled layout. */
	void HubScrollLayOut(UTextureRenderTarget2D* ScrollTarget, const TSharedRef<SWonderlandSocialHubPanel>& ScrollHub)
	{
		FWidgetRenderer ScrollRenderer(true, true);
		ScrollRenderer.DrawWidget(ScrollTarget, ScrollHub, HubScrollDrawSize, 0.0f);
		ScrollRenderer.DrawWidget(ScrollTarget, ScrollHub, HubScrollDrawSize, 0.016f);
	}

	FWonderlandSocialPersonRow HubScrollFriend(int32 FriendIndex)
	{
		FWonderlandSocialPersonRow FriendRow;
		FriendRow.UserId = FString::Printf(TEXT("qa-scroll-f%02d"), FriendIndex);
		FriendRow.DisplayName = FString::Printf(TEXT("Friend %02d"), FriendIndex);
		FriendRow.Handle = FString::Printf(TEXT("friend%02d"), FriendIndex);
		FriendRow.Presence.UserId = FriendRow.UserId;
		FriendRow.Presence.OnlineState = TEXT("OFFLINE");
		return FriendRow;
	}

	void HubScrollAddConversation(FWonderlandSocialSnapshot& FedInbox, const FString& ConvId, const FString& ConvTitle, int32 LineCount)
	{
		FWonderlandSocialConversationRow ConvRow;
		ConvRow.ConversationId = ConvId;
		ConvRow.Kind = TEXT("DIRECT");
		ConvRow.Title = ConvTitle;
		ConvRow.OtherUserId = TEXT("qa-scroll-f01");
		FedInbox.Conversations.Add(ConvRow);
		TArray<FWonderlandSocialMessage>& ConvLines = FedInbox.Messages.FindOrAdd(ConvId);
		for (int32 LineIndex = 0; LineIndex < LineCount; ++LineIndex)
		{
			FWonderlandSocialMessage ConvLine;
			ConvLine.MessageId = FString::Printf(TEXT("%s-m%03d"), *ConvId, LineIndex);
			ConvLine.ConversationId = ConvId;
			ConvLine.SenderId = (LineIndex % 2 == 0) ? TEXT("qa-scroll-me") : TEXT("qa-scroll-f01");
			ConvLine.Kind = TEXT("TEXT");
			ConvLine.Body = FString::Printf(TEXT("Line %03d of a long conversation, written long enough to wrap on the hub's message column."), LineIndex);
			ConvLine.SentAtIso = TEXT("2026-10-07T12:00:00Z");
			ConvLines.Add(ConvLine);
		}
	}

	/** 40 friends (all offline); conversation A (60 lines, plus ExtraOnA new ones) unless bWithA is false; conversation B (30 lines). */
	FWonderlandSocialSnapshot HubScrollFed(bool bWithA, int32 ExtraOnA)
	{
		FWonderlandSocialSnapshot FedInbox;
		FedInbox.bDevelopmentPreview = false;
		FedInbox.ViewerId = TEXT("qa-scroll-me");
		FedInbox.NamesById.Add(TEXT("qa-scroll-me"), TEXT("Me"));
		FedInbox.NamesById.Add(TEXT("qa-scroll-f01"), TEXT("Friend 01"));
		for (int32 FriendIndex = 1; FriendIndex <= 40; ++FriendIndex)
		{
			FedInbox.Friends.Add(HubScrollFriend(FriendIndex));
		}
		if (bWithA)
		{
			HubScrollAddConversation(FedInbox, TEXT("qa-scroll-a"), TEXT("Amy"), 60 + ExtraOnA);
		}
		HubScrollAddConversation(FedInbox, TEXT("qa-scroll-b"), TEXT("Bo"), 30);
		return FedInbox;
	}

	FAutoConsoleCommand GQaSocialHubScroll(
		TEXT("wl.Qa.SocialHubScroll"),
		TEXT("QA (row 14-Unreal C1): the Social Hub keeps scroll positions through a server refresh (SC1-SC4). SC5 / SC6 are the controls: with ")
		TEXT("the memory OFF they read the pre-fix behaviour. Off-screen, fed, laid out by FWidgetRenderer; WLQA HUBSCROLL lines."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			int32 Passed = 0;
			int32 Failed = 0;
			auto ScrollCheck = [&Passed, &Failed](const TCHAR* CheckId, bool bOk, const FString& What)
			{
				(bOk ? Passed : Failed) += 1;
				UE_LOG(LogTemp, Display, TEXT("WLQA HUBSCROLL %s %s -- %s"), CheckId, bOk ? TEXT("PASS") : TEXT("FAIL"), *What);
			};
			UTextureRenderTarget2D* ScrollTarget = FWidgetRenderer::CreateTargetFor(HubScrollDrawSize, TF_Bilinear, true);
			if (ScrollTarget == nullptr)
			{
				ScrollCheck(TEXT("SC0"), false, TEXT("no render target for the off-screen layout"));
				UE_LOG(LogTemp, Display, TEXT("WLQA HUBSCROLL END pass=%d fail=%d"), Passed, Failed);
				return;
			}
			const FWonderlandSocialSnapshot FedFull = HubScrollFed(true, 0);
			const TSharedRef<SWonderlandSocialHubPanel> ScrollHub = SNew(SWonderlandSocialHubPanel)
				.Snapshot(FedFull).bConnected(true).bDevelopmentPreview(false).InitialTab(SWonderlandSocialHubPanel::ETab::Friends);
			ScrollHub->QaSetScrollMemory(true);
			HubScrollLayOut(ScrollTarget, ScrollHub);
			// A SERVER REFRESH, as every live snapshot makes it: SetSnapshot, the deferred rebuild, then a real layout
			const auto ScrollRefresh = [ScrollTarget, &ScrollHub](const FWonderlandSocialSnapshot& NextSnapshot)
			{
				ScrollHub->SetSnapshot(NextSnapshot, true, FString(), false);
				ScrollHub->FlushRebuild();
				HubScrollLayOut(ScrollTarget, ScrollHub);
			};

			// SC1: a scrolled FRIENDS list keeps its place through a refresh
			const bool bListSet = ScrollHub->QaSetListScrollOffset(400.0f);
			HubScrollLayOut(ScrollTarget, ScrollHub);
			const float ListBefore = ScrollHub->QaListScrollOffset();
			ScrollRefresh(FedFull);
			const float ListAfter = ScrollHub->QaListScrollOffset();
			ScrollCheck(TEXT("SC1"), bListSet && ListBefore > 100.0f && FMath::Abs(ListAfter - ListBefore) <= 1.0f,
				FString::Printf(TEXT("FRIENDS scrolled to %.1f reads %.1f after a refresh (set: %s)"), ListBefore, ListAfter, bListSet ? TEXT("yes") : TEXT("NO")));

			// SC2: a conversation the player scrolled back in stays back through a refresh
			ScrollHub->SetTab(SWonderlandSocialHubPanel::ETab::Messages);
			ScrollHub->OpenConversation(TEXT("qa-scroll-a"));
			HubScrollLayOut(ScrollTarget, ScrollHub);
			const bool bOpenedAtEnd = ScrollHub->QaHistoryAtEnd();
			const float HistoryEnd = ScrollHub->QaHistoryScrollOffset();
			const bool bBackSet = ScrollHub->QaSetHistoryScrollOffset(FMath::Max(0.0f, HistoryEnd - 600.0f));
			HubScrollLayOut(ScrollTarget, ScrollHub);
			const float HistoryBefore = ScrollHub->QaHistoryScrollOffset();
			const bool bWasBack = !ScrollHub->QaHistoryAtEnd();
			ScrollRefresh(FedFull);
			const float HistoryAfter = ScrollHub->QaHistoryScrollOffset();
			const bool bStillBack = !ScrollHub->QaHistoryAtEnd();
			ScrollCheck(TEXT("SC2"), bOpenedAtEnd && HistoryEnd > 600.0f && bBackSet && bWasBack && bStillBack && FMath::Abs(HistoryAfter - HistoryBefore) <= 1.0f,
				FString::Printf(TEXT("A opened at its end (%s, end %.1f); scrolled back to %.1f; after a refresh %.1f (still back: %s)"),
					bOpenedAtEnd ? TEXT("yes") : TEXT("NO"), HistoryEnd, HistoryBefore, HistoryAfter, bStillBack ? TEXT("yes") : TEXT("NO")));

			// SC3: at the end, a refresh that brings a new message keeps the history at its (new) end
			ScrollHub->OpenConversation(TEXT("qa-scroll-a"));   // the player's own click: opens at its END, whatever was remembered
			HubScrollLayOut(ScrollTarget, ScrollHub);
			const bool bAtEndBefore = ScrollHub->QaHistoryAtEnd();
			const float EndBefore = ScrollHub->QaHistoryScrollOffset();
			ScrollRefresh(HubScrollFed(true, 1));
			const float EndAfter = ScrollHub->QaHistoryScrollOffset();
			const bool bAtEndAfter = ScrollHub->QaHistoryAtEnd();
			ScrollCheck(TEXT("SC3"), bAtEndBefore && bAtEndAfter && EndAfter > EndBefore + 1.0f,
				FString::Printf(TEXT("at the end (%s, %.1f); one new message: at the end (%s, %.1f, grew %s)"),
					bAtEndBefore ? TEXT("yes") : TEXT("NO"), EndBefore, bAtEndAfter ? TEXT("yes") : TEXT("NO"), EndAfter, EndAfter > EndBefore + 1.0f ? TEXT("yes") : TEXT("NO")));

			// SC4: the memory never crosses conversations: A scrolled back, then a refresh WITHOUT A opens B, at B's end
			const bool bABackSet = ScrollHub->QaSetHistoryScrollOffset(FMath::Max(0.0f, EndAfter - 600.0f));
			HubScrollLayOut(ScrollTarget, ScrollHub);
			const bool bABack = !ScrollHub->QaHistoryAtEnd();
			ScrollRefresh(HubScrollFed(false, 0));
			const bool bBAtEnd = ScrollHub->QaHistoryAtEnd();
			ScrollCheck(TEXT("SC4"), bABackSet && bABack && bBAtEnd,
				FString::Printf(TEXT("A scrolled back (%s); after a refresh without A, B is open at its END (%s, offset %.1f)"),
					bABack ? TEXT("yes") : TEXT("NO"), bBAtEnd ? TEXT("yes") : TEXT("NO"), ScrollHub->QaHistoryScrollOffset()));

			// SC5 CONTROL: with the memory OFF, the same refresh puts FRIENDS back at the top (the pre-fix behaviour). So SC1 can fail.
			ScrollHub->QaSetScrollMemory(false);
			ScrollHub->SetTab(SWonderlandSocialHubPanel::ETab::Friends);
			HubScrollLayOut(ScrollTarget, ScrollHub);
			const bool bOffListSet = ScrollHub->QaSetListScrollOffset(400.0f);
			HubScrollLayOut(ScrollTarget, ScrollHub);
			ScrollRefresh(FedFull);
			const float OffListAfter = ScrollHub->QaListScrollOffset();
			ScrollCheck(TEXT("SC5"), bOffListSet && OffListAfter <= 1.0f,
				FString::Printf(TEXT("control: memory OFF, FRIENDS scrolled to 400 reads %.1f after a refresh (back at the top)"), OffListAfter));

			// SC6 CONTROL: with the memory OFF, a refresh yanks a scrolled-back conversation to its end (the pre-fix behaviour). So SC2
			// can fail.
			ScrollHub->SetTab(SWonderlandSocialHubPanel::ETab::Messages);
			ScrollHub->OpenConversation(TEXT("qa-scroll-b"));
			HubScrollLayOut(ScrollTarget, ScrollHub);
			const float OffEnd = ScrollHub->QaHistoryScrollOffset();
			const bool bOffBackSet = ScrollHub->QaSetHistoryScrollOffset(FMath::Max(0.0f, OffEnd - 300.0f));
			HubScrollLayOut(ScrollTarget, ScrollHub);
			const bool bOffBack = !ScrollHub->QaHistoryAtEnd();
			ScrollRefresh(HubScrollFed(false, 0));
			const bool bOffYanked = ScrollHub->QaHistoryAtEnd();
			ScrollCheck(TEXT("SC6"), OffEnd > 300.0f && bOffBackSet && bOffBack && bOffYanked,
				FString::Printf(TEXT("control: memory OFF, B scrolled back (%s) is at its END after a refresh (%s)"),
					bOffBack ? TEXT("yes") : TEXT("NO"), bOffYanked ? TEXT("yes") : TEXT("NO")));
			ScrollHub->QaSetScrollMemory(true);

			UE_LOG(LogTemp, Display, TEXT("WLQA HUBSCROLL END pass=%d fail=%d"), Passed, Failed);
		}));
}
