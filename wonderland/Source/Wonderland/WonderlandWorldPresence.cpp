#include "WonderlandWorldPresence.h"

#include "Camera/PlayerCameraManager.h"
#include "Components/TextRenderComponent.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"
#include "GameFramework/PlayerController.h"
#include "RelayDogCharacter.h"
#include "RelayDogPresentation.h"
#include "WonderlandCompanionEmbodiment.h"
#include "WonderlandGrip.h"

// Named, not anonymous: the module is one unity translation unit.
namespace WonderlandWorldPresenceDetail
{
	/** How quickly a figure closes on its latest report (reports arrive ~5 a second): fast enough to keep up, slow enough
	 *  that a late report reads as a stride, not a jump. */
	constexpr float EaseRate = 9.0f;
	/** Further than this from its report, a figure is placed rather than eased (a teleport, a transition). */
	constexpr float SnapDistanceUu = 1500.0f;
	constexpr float LabelHeightUu = 215.0f;
	/** DEAD RECKONING: a figure is steered toward where its player should be by now (the last report plus Speed along the heading of
	 *  the last two reports), never further ahead than this: a stop or a turn can only ever be this far wrong. XY only; Z is as reported. */
	constexpr double MaxExtrapolationSeconds = 0.3;
	/** Below this a report is "standing"; above this a hostile or broken Speed is not believed. */
	constexpr float MinMovingSpeedUu = 10.0f;
	constexpr float MaxTrustedSpeedUu = 1200.0f;
	/** Fewer uu than this between two reports is not a heading. */
	constexpr float MinHeadingStepUu = 5.0f;
	/** 1 = steer toward the dead-reckoned point (default), 0 = the old chase of the last report (rollback without a rebuild). */
	TAutoConsoleVariable<int32> CVarRemoteDeadReckon(TEXT("wl.Remote.DeadReckon"), 1,
		TEXT("Remote players: 1 steers toward the dead-reckoned position (capped), 0 chases the last report as before."));
	// r16reh16c: A/B switches so ONE binary can be measured with and without each change (defaults = the new behaviour).
	// MP-VIS-01 (remote Relay OG eyes too exposed): r16reh16u defaults ON (9.4 / 2.05, the values measured in the r16reh16t automated captures: the eye
	// stands at the canon height in the window and the lit area falls below 50 % on the local Dog's yaw band); 0 = the figure as shipped, to measure with and without.
	TAutoConsoleVariable<float> CVarRemoteEyeRecess(TEXT("wl.Remote.EyeRecessUU"), 9.4f,
		TEXT("Remote players wearing relay_og: uu to push the visor plate, eyes and halos back into the head (canon window is 13.2 uu deep, the figure's 2.9; default 9.4 puts the eye front at the canon depth). 0 = off. Read when the figure loads."));
	TAutoConsoleVariable<float> CVarRemoteEyeLower(TEXT("wl.Remote.EyeLowerUU"), 2.05f,
		TEXT("Remote players wearing relay_og: uu to lower the eyes and halos in the window (canon eyes sit lower than the figure's by about 2.05, the default). 0 = off. Read when the figure loads."));
	TAutoConsoleVariable<int32> CVarRemoteNoHover(TEXT("wl.Remote.NoHover"), 1,
		TEXT("Remote players: 1 draws a remote figure planted (no FloatRoot hover, no Float-part bob), 0 restores the old hover. Read when a figure spawns."));
	TAutoConsoleVariable<int32> CVarRemoteInterp(TEXT("wl.Remote.Interp"), 1,
		TEXT("Remote players: 1 draws a figure InterpDelay seconds in the past, interpolated between the sender's report times (no overshoot); 0 uses the dead-reckoned chase."));
	TAutoConsoleVariable<float> CVarRemoteInterpDelay(TEXT("wl.Remote.InterpDelay"), 0.35f,
		TEXT("Remote players: seconds a figure is drawn behind its player in Interp mode (must exceed about two report periods)."));
	TAutoConsoleVariable<int32> CVarRemoteInterpAdaptive(TEXT("wl.Remote.InterpAdaptive"), 1,
		TEXT("Remote players, Interp mode: 1 sets the draw delay from the recent worst-case age of the newest report (+ InterpMargin, between InterpDelayMin and Max), slewed slowly; 0 uses the fixed wl.Remote.InterpDelay."));
	TAutoConsoleVariable<float> CVarRemoteInterpDelayMin(TEXT("wl.Remote.InterpDelayMin"), 0.12f, TEXT("Remote players: lowest adaptive draw delay (seconds)."));
	TAutoConsoleVariable<float> CVarRemoteInterpDelayMax(TEXT("wl.Remote.InterpDelayMax"), 0.60f, TEXT("Remote players: highest adaptive draw delay (seconds)."));
	TAutoConsoleVariable<float> CVarRemoteInterpMargin(TEXT("wl.Remote.InterpMargin"), 0.03f, TEXT("Remote players: seconds added to the worst-case report age for the adaptive delay."));
	TAutoConsoleVariable<float> CVarRemoteInterpCatchUp(TEXT("wl.Remote.InterpCatchUp"), 0.0f,
		TEXT("Remote players, Interp mode: the fastest a figure may close on its target after a late report, as a multiple of the player's reported speed (0 = no limit)."));
	TAutoConsoleVariable<float> CVarRemoteInterpEase(TEXT("wl.Remote.InterpEase"), 10.0f,
		TEXT("Remote players: chase rate toward the interpolated point in Interp mode (high = tight; lower smooths frame hitches)."));
	TAutoConsoleVariable<int32> CVarRemoteRetime(TEXT("wl.Remote.InterpRetime"), 1,
		TEXT("Remote players, Interp mode: 1 re-times a steady-motion segment from distance / reported speed (immune to report-delivery jitter), pulled back to the real clock; 0 trusts arrival - age."));
	TAutoConsoleVariable<float> CVarRemoteRetimePull(TEXT("wl.Remote.InterpRetimePull"), 0.2f,
		TEXT("Remote players: fraction of the (arrival - age) clock error pulled back into a re-timed sample (keeps the timeline from drifting)."));
	TAutoConsoleVariable<float> CVarRemoteInterpExtrap(TEXT("wl.Remote.InterpExtrap"), 0.2f,
		TEXT("Remote players: in Interp mode, seconds a figure may continue at the last segment's velocity when it has caught up with its newest report (0 = hold)."));
	// B33 (r16reh16w): 30 -> 120. At 30 the height lagged the interpolated arc by tau = 33 ms (10-14 uu on a 300-420 uu/s jump, b33a); at 120 tau is 8 ms. The height
	// between two reports is already the straight line between them, so the ease only softens a step INSIDE a frame (a late report's catch-up).
	TAutoConsoleVariable<float> CVarRemoteInterpEaseZ(TEXT("wl.Remote.InterpEaseZ"), 120.0f,
		TEXT("Remote players: chase rate of the height (floor contact) in Interp mode; XY uses wl.Remote.InterpEase. 120 is the COMPILED DEFAULT since B33 r16reh16w (no launch-time setting is needed); 30 restores the r16reh16u behaviour (never 0: 0 freezes the height)."));
	// B33 (r16reh16w): A STANDING PLAYER STILL REPORTS. Only a changed position used to be a new sample, so while the other player stood still no sample arrived, the
	// adaptive delay forgot how late reports come (PeakAge decays, the delay slews down to InterpDelayMin 0.12 s) and their next move -- a jump from standing -- was drawn
	// past the newest report and HELD (b33a: delay 120 ms at takeoff while the newest report was up to 270-330 ms old; height error -45.6 uu).
	TAutoConsoleVariable<int32> CVarRemoteReportTimeSamples(TEXT("wl.Remote.ReportTimeSamples"), 1,
		TEXT("Remote players, Interp mode: 1 stores a report that repeats a STANDING player's position (reported speed under 10 uu/s) as a new sample when it is a NEWER report (its time is more than 60 ms after the newest sample's; the server stores at most one report per 100 ms), so the adaptive draw delay keeps measuring delivery while they stand and their next move starts from their real last report; 0 = only a changed position is a new sample (the r16reh16u behaviour)."));
	// B33 (r16reh16w): THE SAMPLE CLOCK. arrival - ageMs dates a report LATE by its upload to the server plus this client's download of the answer (ageMs is the server's
	// age at answer time): b33a measured +18.3 ms mean (SD 12.5) against the sender's own send stamps, at an 11-15 ms round trip on loopback.
	TAutoConsoleVariable<int32> CVarRemoteRttClock(TEXT("wl.Remote.RttClock"), 1,
		TEXT("Remote players, Interp mode: 1 dates each report at arrival - ageMs - this client's own smoothed world-report round trip (an estimate of the report's upload plus the answer's download, which ageMs does not contain; at most 0.25 s), 0 = arrival - ageMs (the r16reh16u clock)."));
	/** B33: a report dated more than this after the newest sample is a NEWER report (the server stores at most one per 100 ms; the same report seen twice differs only
	 *  by this client's delivery jitter). */
	constexpr double NewerReportSeconds = 0.06;
	/** B33: the most the sample clock is moved back for the round trip. */
	constexpr double MaxRttClockSeconds = 0.25;
	TAutoConsoleVariable<float> CVarRemoteEaseRate(TEXT("wl.Remote.EaseRate"), 9.0f,
		TEXT("Remote players: chase rate toward the report / dead-reckoned point when Interp is 0."));
	TAutoConsoleVariable<float> CVarRemoteDrCap(TEXT("wl.Remote.DrCap"), 0.3f,
		TEXT("Remote players: dead-reckoning cap in seconds when Interp is 0."));
	TAutoConsoleVariable<int32> CVarRemoteIdleFreeze(TEXT("wl.Remote.IdleFreeze"), 1,
		TEXT("Remote players: 1 stops a remote figure's own idle motion (weight shift, breath, tail) while its player stands still; 0 restores the old idle."));
	TAutoConsoleVariable<int32> CVarRemoteGaitFromReport(TEXT("wl.Remote.GaitFromReport"), 1,
		TEXT("Remote players, Interp mode: 1 feeds the figure's gait speed from the speed the sender reported for the drawn moment (interpolated between the bracketing reports) instead of differentiating the eased position; 0 restores the measured displacement. Position is never affected."));
	TAutoConsoleVariable<int32> CVarRemoteDogAnimator(TEXT("wl.Remote.DogAnimator"), 1,
		TEXT("Remote players: 1 animates each remote figure with its own RelayDogStride::FDogAnimator (configured as the owner's Dog is) fed the sender's reported speed, and the figure wears that pose exactly as a worn skin does, so stride, duty, lean, arms-back and timing match the owner's Dog; 0 restores the figure's own simple gait (r16reh16q). Position is never affected."));
	// SC2 (the R16 reviewer's Stage 1 ruling Q6, 2026-10-20): OFF BY DEFAULT in the scored candidate. MP-VIS-02 is deferred until after the scored run (founder
	// 10-18) and the backend that serves it (REV3) is held (founder 10-19T19:16:39Z), so at the default the world report carries exactly the r16reh16u fields
	// (x, y, z, yaw, speed, motion, skinId; WonderlandSocialLive.cpp TickWorld logs them as "WLWORLD report fields") and no other figure's handoff is drawn.
	TAutoConsoleVariable<int32> CVarHandoffReplicate(TEXT("wl.Handoff.Replicate"), 0,
		TEXT("MP-VIS-02 (default 0, deferred): 1 sends this player's equipped Mission Handoff form and activation events with the world report and plays other players' on their figures; 0 does neither."));
	/** The companions' homes, in the pawn's yaw frame: WonderlandCompanionPreviewSettings LlmCompanionOffset / AgentOffset (WonderlandCompanionSubsystem.h:67,77 at 66ab070b).
	 *  ASSUMPTION to verify on two-client frames: the owner's companions float relative to the pawn (capsule centre), a remote figure is placed at the soles. */
	const FVector LlmCompanionHome(-40.0, -135.0, 0.0);
	const FVector AgentCompanionHome(-40.0, 140.0, 0.0);
	/** ASSUMPTION: the armed hold's third weight is the Dog's GaitWeight; a remote's is estimated from its reported speed. Dash and the fast hop are not replicated. */
	constexpr float GaitFullSpeedUu = 200.0f;
	TAutoConsoleVariable<float> CVarRemoteLogPeriod(TEXT("wl.Remote.LogPeriod"), 1.0f,
		TEXT("Remote players: seconds between the per-figure WLREMOTE log lines (default 1; a dev measurement can set 0.1)."));
}

bool WonderlandHandoffWire::IsReplicationOn()
{
	return WonderlandWorldPresenceDetail::CVarHandoffReplicate.GetValueOnGameThread() != 0;
}

FWonderlandRemoteAvatars::~FWonderlandRemoteAvatars()
{
	Clear();
}

void FWonderlandRemoteAvatars::DropSwords(FRemote& Remote)
{
	if (Remote.Swords.IsValid())
	{
		Remote.Swords->Destroy();   // the components belong to the figure; this removes what it made
		Remote.Swords.Reset();
	}
	Remote.LoggedHandoffKey = 0;
	Remote.LoggedPlayState = -1;
}

void FWonderlandRemoteAvatars::Remove(FRemote& Remote)
{
	DropSwords(Remote);   // before the figure: they hang from its forearms
	Remote.Transform.Reset();   // its motes and shards are components of the figure and go with it
	if (AWonderlandCompanionEmbodiment* Body = Remote.Body.Get())
	{
		Body->Destroy();
	}
	Remote.Body.Reset();
	Remote.Label.Reset();
}

void FWonderlandRemoteAvatars::Clear()
{
	for (TPair<FString, FRemote>& Pair : Remotes)
	{
		Remove(Pair.Value);
	}
	Remotes.Reset();
}

void FWonderlandRemoteAvatars::Apply(UWorld* World, const FWonderlandWorldView& View, TFunctionRef<FString(const FString&)> FigurePathFor, float BodyHeightUu)
{
	if (World == nullptr || !View.bInWorld)
	{
		Clear();
		return;
	}
	// THE DEPARTED: left, went silent, or no longer visible (a block either way removes them from the view itself).
	TSet<FString> Present;
	for (const FWonderlandRemoteAvatar& A : View.Avatars)
	{
		Present.Add(A.UserId);
	}
	for (auto It = Remotes.CreateIterator(); It; ++It)
	{
		if (!Present.Contains(It.Key()) || !It.Value().Body.IsValid())
		{
			// R16 EVIDENCE: a figure leaving this player's world is said once, by id (a leave, a silence, or a block).
			UE_LOG(LogTemp, Display, TEXT("WLWORLD player %s left this view (%s)"), *It.Key(),
				Present.Contains(It.Key()) ? TEXT("figure lost") : TEXT("no longer in the view"));
			Remove(It.Value());
			It.RemoveCurrent();
		}
	}
	for (const FWonderlandRemoteAvatar& A : View.Avatars)
	{
		FRemote& Remote = Remotes.FindOrAdd(A.UserId);
		if (!Remote.Motion.Equals(A.Motion))
		{
			Remote.Motion = A.Motion;   // WLREMOTE diagnostics only: copies only on a change
		}
		if (!A.Location.Equals(Remote.Target, 0.01))
		{
			// WLREMOTE: a view that carries a new position is a new report; one that repeats it is not.
			Remote.RecvAt = FPlatformTime::Seconds();
			Remote.RecvAgeMs = static_cast<float>(A.AgeMs);
		}
		{
			using namespace WonderlandWorldPresenceDetail;
			// THE REPORT'S TIME on this machine's clock: arrival minus the backend's age, and (B33 wl.Remote.RttClock) minus this client's smoothed round trip.
			const double RttClock = CVarRemoteRttClock.GetValueOnGameThread() != 0 ? FMath::Clamp(View.ReportRttSeconds, 0.0, MaxRttClockSeconds) : 0.0;
			const double ReportRaw = FPlatformTime::Seconds() - A.AgeMs * 0.001 - RttClock;
			// B33 (wl.Remote.ReportTimeSamples): a STANDING player's newer report is a new sample though its position repeats. Only for a report that says standing,
			// so a moving player's repeated view (the same report answered twice) is never a sample, and the steady-motion retime below never sees one.
			const bool bNewerStandingReport = CVarRemoteReportTimeSamples.GetValueOnGameThread() != 0 && Remote.Samples.Num() > 0 && A.Speed < MinMovingSpeedUu
				&& ReportRaw - Remote.Samples.Last().Raw > NewerReportSeconds;
			// A view that repeats the last position is not a new report (it must not restart the extrapolation clock) -- unless it is a standing player's newer one.
			const bool bMoved = !Remote.bDrHasReport || !A.Location.Equals(Remote.Target, 0.5) || bNewerStandingReport;
			if (bMoved)
			{
				if (Remote.bDrHasReport)
				{
					const FVector Step(A.Location.X - Remote.Target.X, A.Location.Y - Remote.Target.Y, 0.0);
					if (Step.Size() >= MinHeadingStepUu)
					{
						Remote.DrHeading = Step.GetSafeNormal();
					}
				}
				{
					// the sender's time of this report: arrival here minus the backend's age (minus the round trip, wl.Remote.RttClock); kept strictly increasing
					FRemote::FSample S;
					S.Raw = ReportRaw;
					S.T = S.Raw;
					S.V = FMath::Clamp(A.Speed, 0.0f, MaxTrustedSpeedUu);
					S.P = A.Location;
					if (Remote.Samples.Num() > 0)
					{
						const FRemote::FSample Last = Remote.Samples.Last();   // a COPY: Samples grows below
						if (FVector::Dist(Last.P, S.P) > SnapDistanceUu)
						{
							Remote.Samples.Reset();   // a teleport is placed, never swept across
						}
						else
						{
							const double DRaw = S.Raw - Last.Raw;
							{
								// HOW OLD the newest report was when its successor arrived = the draw delay that would just have avoided a hold. Measured here, at
								// arrival, so a player who stands still (no new reports) does not inflate it; a stand/start gap (> 0.6 s) is not a delivery gap.
								const double Avail = FPlatformTime::Seconds() - Last.T;
								if (Avail > 0.0 && Avail <= 0.6)
								{
									Remote.PeakAge = FMath::Max(Remote.PeakAge, Avail);
								}
							}
							if (S.Raw - Last.Raw > 0.4)
							{
								// stood still, then moved: hold the old place until just before the move, do not slide across the whole gap
								FRemote::FSample Hold = Last;
								Hold.T = S.T - 0.1;
								Hold.Raw = S.Raw - 0.1;
								Remote.Samples.Add(Hold);
							}
							else if (CVarRemoteRetime.GetValueOnGameThread() != 0 && DRaw > 0.02)
							{
								// STEADY MOTION: the time between two reports is the distance covered over the reported speed. Delivery jitter (frames, HTTP)
								// moves arrival - age by tens of ms but cannot change this. Not for a stop, a start or a turn (the speed does not describe
								// the displacement there): those keep the measured time. Bounded to [0.5, 1.7] x the measured gap, then pulled to the clock.
								const FVector2D Seg(S.P.X - Last.P.X, S.P.Y - Last.P.Y);
								const double Dist = Seg.Size();
								const double VAvg = 0.5 * (static_cast<double>(Last.V) + static_cast<double>(S.V));
								bool bSteady = VAvg >= MinMovingSpeedUu && Dist >= MinHeadingStepUu && Last.V >= MinMovingSpeedUu && S.V >= MinMovingSpeedUu
									&& FMath::Abs(static_cast<double>(S.V) - static_cast<double>(Last.V)) <= 0.25 * VAvg;
								if (bSteady && Remote.Samples.Num() >= 2)
								{
									const FVector2D Prev(Last.P.X - Remote.Samples[Remote.Samples.Num() - 2].P.X, Last.P.Y - Remote.Samples[Remote.Samples.Num() - 2].P.Y);
									bSteady = Prev.Size() >= MinHeadingStepUu && (Prev.GetSafeNormal() | Seg.GetSafeNormal()) > 0.8;   // within ~37 deg: not a turn
								}
								if (bSteady)
								{
									const double DUse = FMath::Clamp(Dist / VAvg, 0.5 * DRaw, 1.7 * DRaw);
									S.T = Last.T + DUse;
									S.T += static_cast<double>(CVarRemoteRetimePull.GetValueOnGameThread()) * (S.Raw - S.T);
								}
							}
							if (S.T <= Last.T)
							{
								S.T = Last.T + 0.001;
							}
						}
					}
					Remote.Samples.Add(S);
					UE_LOG(LogTemp, Display, TEXT("WLREMOTE rep fig=%s p=(%.1f,%.1f,%.1f) age=%.0fms n=%d v=%.0f retimeShiftMs=%.0f"), *A.UserId, A.Location.X, A.Location.Y, A.Location.Z, static_cast<double>(A.AgeMs), Remote.Samples.Num(), static_cast<double>(S.V), (S.T - S.Raw) * 1000.0);
					if (Remote.Samples.Num() > 24)
					{
						Remote.Samples.RemoveAt(0, Remote.Samples.Num() - 24, EAllowShrinking::No);
					}
				}
				Remote.bDrHasReport = true;
				Remote.DrReceivedAt = FPlatformTime::Seconds();
				Remote.DrAgeSeconds = static_cast<float>(A.AgeMs * 0.001);
			}
			else if (Remote.Samples.Num() > 0 && Remote.Samples.Last().V >= MinMovingSpeedUu && A.Speed < MinMovingSpeedUu)
			{
				// STOPPED ON THE SPOT (r16reh16s): the view repeats the last position, so it is not a new report -- but its SPEED has changed. Stopping against a wall or a step
				// ends on the position of the last moving report; dropping that report left the stale running speed in the newest sample and the extrapolation carry held for
				// ever (measured r16reh16r, automated session: 19.6 uu parked past the sender for 5 s). Only the speed of the newest sample is corrected.
				Remote.Samples.Last().V = FMath::Clamp(A.Speed, 0.0f, MaxTrustedSpeedUu);
			}
			Remote.DrSpeed = FMath::Clamp(A.Speed, 0.0f, MaxTrustedSpeedUu);
		}
		Remote.Target = A.Location;
		Remote.TargetYaw = A.Yaw;
		Remote.DisplayName = A.DisplayName;
		// MP-VIS-02 REV2: the persistent form and the latest event decide the figure's handoff (WonderlandHandoffRemote::OnView: new seq only, from its age,
		// settle when old, the form as the anchor). This view's arrival time is "now"; ageMs is the server's age of the event when it answered.
		Remote.Handoff = A.Handoff;
		{
			const WonderlandHandoffRemote::EAction Did = WonderlandHandoffRemote::OnView(Remote.Track, A.Handoff, A.HandoffEvent, FPlatformTime::Seconds(), Remote.AdaptDelay);
			if (Did != WonderlandHandoffRemote::EAction::None || A.HandoffEvent.bValid)
			{
				const int32 Key = static_cast<int32>(Did) | (A.HandoffEvent.Seq << 4);
				if (Key != Remote.LoggedHandoffKey && Did != WonderlandHandoffRemote::EAction::IgnoredStale)
				{
					Remote.LoggedHandoffKey = Key;
					static const TCHAR* const Actions[] = { TEXT("none"), TEXT("play"), TEXT("settle"), TEXT("ignored-stale") };
					UE_LOG(LogTemp, Display, TEXT("WLHANDOFF recv fig=%s form=%s event=%s seq=%d ageMs=%.0f action=%s mode=%d"), *A.UserId, WonderlandHandoffWire::ToWire(A.Handoff),
						WonderlandHandoffWire::KindToWire(A.HandoffEvent.Kind), A.HandoffEvent.Seq, A.HandoffEvent.AgeMs, Actions[static_cast<int32>(Did)], static_cast<int32>(Remote.Track.Mode));
				}
			}
		}
		AWonderlandCompanionEmbodiment* Body = Remote.Body.Get();
		if (Body == nullptr)
		{
			FActorSpawnParameters Params;
			Params.ObjectFlags |= RF_Transient;
			Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			Body = World->SpawnActor<AWonderlandCompanionEmbodiment>(AWonderlandCompanionEmbodiment::StaticClass(),
				FTransform(FRotator(0.0, A.Yaw, 0.0), A.Location), Params);
			if (Body == nullptr)
			{
				continue;
			}
			Body->DisplayName = A.DisplayName;
			Body->ClassLabel = TEXT("WONDERLAND PLAYER");
			// THE MASCOT, as every player's Dog is: its colourway, its gait, Relay OG's height (the HARD rule).
			Body->SetBodyRole(EWonderlandBodyRole::Mascot);
			Body->SetRuntimeActivity(TEXT("IDLE"));
			Body->SetPlantedNoFloat(WonderlandWorldPresenceDetail::CVarRemoteNoHover.GetValueOnGameThread() != 0);   // a remote player is drawn planted, not hovering (founder 2026-09-25: skins "remain planted")
			Body->TargetBodyHeightUU = BodyHeightUu;
			UTextRenderComponent* Label = NewObject<UTextRenderComponent>(Body, MakeUniqueObjectName(Body, UTextRenderComponent::StaticClass(), TEXT("PlayerName")));
			Label->SetupAttachment(Body->GetRootComponent());
			Label->RegisterComponent();
			Body->AddInstanceComponent(Label);
			Label->SetRelativeLocation(FVector(0.0, 0.0, WonderlandWorldPresenceDetail::LabelHeightUu));
			Label->SetHorizontalAlignment(EHTA_Center);
			Label->SetVerticalAlignment(EVRTA_TextBottom);
			Label->SetWorldSize(18.0f);
			Label->SetTextRenderColor(FColor(236, 231, 221));
			Label->SetText(FText::FromString(A.DisplayName));
			Label->SetCastShadow(false);
			Remote.Body = Body;
			Remote.Label = Label;
			Remote.SkinId.Reset();
			// R16 EVIDENCE: another player's Dog drawn in this player's world, said once, by id and place.
			UE_LOG(LogTemp, Display, TEXT("WLWORLD player %s (%s) appeared at (%.0f, %.0f, %.0f)"), *A.UserId, *A.DisplayName,
				A.Location.X, A.Location.Y, A.Location.Z);
		}
		// THEIR SKIN, THROUGH THE REGISTRY: a skin this build does not know keeps the figure it has.
		if (Remote.SkinId != A.SkinId)
		{
			const FString Figure = FigurePathFor(A.SkinId);
			// MP-VIS-01: another player's Relay OG is the voxel preview figure, whose window is 2.9 uu deep; the canon body's is 13.2 uu. Set per
			// load (a skin change reloads), only for relay_og, default 0 = the figure as shipped.
			const bool bRelayOg = A.SkinId.IsEmpty() || A.SkinId == TEXT("relay_og");
			Body->RemoteEyeRecessUU = bRelayOg ? FMath::Max(WonderlandWorldPresenceDetail::CVarRemoteEyeRecess.GetValueOnGameThread(), 0.0f) : 0.0f;
			Body->RemoteEyeLowerUU = bRelayOg ? FMath::Max(WonderlandWorldPresenceDetail::CVarRemoteEyeLower.GetValueOnGameThread(), 0.0f) : 0.0f;
			if (!Figure.IsEmpty() && Body->LoadFigure(Figure))
			{
				Remote.SkinId = A.SkinId;
				DropSwords(Remote);   // MP-VIS-02: a new figure has new forearm joints; the swords are rebuilt on them next frame (the Track is kept: the sequence goes on)
			}
			else
			{
				UE_LOG(LogTemp, Warning, TEXT("WLWORLD %s wears '%s', which this build cannot draw"), *A.UserId, *A.SkinId);
				Remote.SkinId = A.SkinId;   // not retried every report
			}
		}
		if (UTextRenderComponent* Label = Remote.Label.Get())
		{
			Label->SetText(FText::FromString(A.DisplayName));
		}
	}
}

// MP-VIS-02 REV2 (SPECIFICATION, NOT COMPILED). One frame of a remote figure's handoff. It drives the owner's OWN presentations (WonderlandHandoffSwords::FPresentation and
// WonderlandHandoffTransform::FPresentation) with the (state, phase) the owner's own state machine would be in, from the Track decided by WonderlandHandoffRemote.
//
// What it does NOT do (each is a stated limitation, not an omission by accident): the owner's COMPANION BODIES are not in any other player's world, so there is nothing to veil
// or to break into shards (Transform::Show runs with no companion actors: the swords form at the companions' home places, the energy stream is degenerate); no closed fist
// (WonderlandHands) on the remote's hand; no armed-stance pose of the legs and arms, no dash, no fast hop; no mission act the owner leaves.
void FWonderlandRemoteAvatars::UpdateRemoteHandoff(const FString& UserId, FRemote& R, AWonderlandCompanionEmbodiment* Body, UWorld* World, float DeltaSeconds)
{
	using namespace WonderlandHandoffRemote;
	using namespace WonderlandWorldPresenceDetail;
	const double Now = FPlatformTime::Seconds();
	Advance(R.Track, Now, DeltaSeconds);
	const bool bOn = WonderlandHandoffWire::IsReplicationOn();
	const FPose Wanted = bOn ? PoseAt(R.Track, Now) : FPose();
	const bool bShowing = (R.Swords.IsValid() && R.Swords->IsBuilt() && R.Swords->GetPresence() > 0.0f)
		|| (R.Transform.IsValid() && (R.Transform->CountVisibleMotes() > 0 || R.Transform->CountVisibleShards() > 0));
	if (Wanted.State == EWonderlandHandoffState::Idle && !bShowing)
	{
		if (R.LoggedPlayState > 0)
		{
			UE_LOG(LogTemp, Display, TEXT("WLHANDOFF play fig=%s state=Idle (ended)"), *UserId);
			R.LoggedPlayState = 0;
		}
		return;   // NOTHING IS MADE for a player who never hands off
	}
	if (!R.Swords.IsValid())
	{
		R.Swords = MakeShared<WonderlandHandoffSwords::FPresentation>();
	}
	if (!R.Transform.IsValid())
	{
		R.Transform = MakeShared<WonderlandHandoffTransform::FPresentation>();
	}
	// The scale unit: the owner's Dog uses HeadWidthUU / 60 = 1 (HeadWidthUU is 60 and never written), and every figure is drawn at Relay OG's height.
	constexpr float SwordScale = 1.0f;
	R.Swords->Build(Body, SwordScale);
	R.Transform->Build(Body);

	// THE OBSERVER'S OWN CAMERA: a forming sword turns its broad face to whoever LOOKS, so each client sees the sequence from its own place. Nothing of the owner's camera is sent.
	FVector ViewLocation = Body->GetActorLocation() - Body->GetActorForwardVector() * 400.0 + FVector(0.0, 0.0, 120.0);
	if (const APlayerController* ViewPC = World != nullptr ? World->GetFirstPlayerController() : nullptr)
	{
		if (ViewPC->PlayerCameraManager != nullptr)
		{
			ViewLocation = ViewPC->PlayerCameraManager->GetCameraLocation();
		}
	}
	const WonderlandGrip::FHold Hold = WonderlandGrip::CurrentHold();
	// the held look at this moment: the armed charge hold eased in after HELD, and the walking weight estimated from the reported speed (ASSUMPTION; dash and fast hop are 0)
	const float GaitWeight = R.Track.Armed * FMath::Clamp(R.DrSpeed / GaitFullSpeedUu, 0.0f, 1.0f);
	const WonderlandGrip::FHold VHold = WonderlandGrip::WithDash(WonderlandGrip::WithCharge(Hold, R.Track.Armed), GaitWeight);
	const FTransform BodyWorld = Body->GetActorTransform();
	const FRotator YawOnly(0.0, Body->GetActorRotation().Yaw, 0.0);

	WonderlandHandoffSwords::FShowInput In;
	In.Scale = SwordScale;
	In.TimeSeconds = World != nullptr ? World->GetTimeSeconds() : 0.0f;
	In.DeltaSeconds = DeltaSeconds;
	In.ViewLocation = ViewLocation;
	In.bHoldWorldRotation = VHold.bBodyV;
	In.LeftHoldRotation = WonderlandGrip::BodyVRotation(BodyWorld, true, VHold);
	In.RightHoldRotation = WonderlandGrip::BodyVRotation(BodyWorld, false, VHold);
	// where the companions WOULD float (the owner's, which no other player has): the swords form above these and return to them. ASSUMPTION: the pawn's centre is half a body above the soles.
	const FVector Middle = Body->GetActorLocation() + FVector(0.0, 0.0, Body->TargetBodyHeightUU * 0.5f);
	In.LeftCompanion = Middle + YawOnly.RotateVector(LlmCompanionHome) + FVector(0.0, 0.0, Body->HoverHeightUU);
	In.RightCompanion = Middle + YawOnly.RotateVector(AgentCompanionHome) + FVector(0.0, 0.0, Body->HoverHeightUU);
	bool bHands = true;
	for (const bool bLeft : { true, false })
	{
		USceneComponent* Forearm = nullptr;
		FVector Tip = FVector::ZeroVector;
		// the Dog's LEFT hand is its -Y forearm (RelayDogCharacter VisibleForearm(!bLeft)); a worn figure faces +X with its joints at rest on the figure's axes
		if (Body->GetHandFrame(!bLeft, Forearm, Tip) && Forearm != nullptr)
		{
			const FVector Forward = FVector::ForwardVector;
			const FVector Along = Tip.IsNearlyZero() ? FVector(0.0, 0.0, -1.0) : Tip.GetSafeNormal();
			const FVector Square = (Forward - Along * FVector::DotProduct(Forward, Along)).GetSafeNormal();
			const FVector Centre = Tip - Along * Hold.IntoHandUU + Square * Hold.ForwardUU;   // no closed fist on a remote figure: the tip formula
			const FTransform Local = WonderlandGrip::HandGripLocal(Tip, Centre, Forward, bLeft ? -1.0f : 1.0f, Hold);
			// the grip in the world, with no scale (as GetHandoffGripWorld returns it): where the swords FLY TO while delivering and FLY FROM while returning
			FTransform Grip(Forearm->GetComponentQuat() * Local.GetRotation(), Forearm->GetComponentTransform().TransformPosition(Local.GetLocation()));
			if (VHold.bBodyV)
			{
				Grip.SetRotation(WonderlandGrip::BodyVRotation(BodyWorld, bLeft, VHold));
			}
			(bLeft ? In.LeftForearm : In.RightForearm) = Forearm;
			(bLeft ? In.LeftGripLocal : In.RightGripLocal) = Local;
			(bLeft ? In.LeftGrip : In.RightGrip) = Grip;
		}
		else
		{
			// NEVER AN ORIGIN ARTIFACT: with no hand joint yet (a figure still loading, or one without arms) the flight aims at a place beside the body, and HELD stays hidden
			bHands = false;
			(bLeft ? In.LeftGrip : In.RightGrip) = FTransform(YawOnly.Quaternion(), Middle + YawOnly.RotateVector(FVector(0.0, bLeft ? -45.0 : 45.0, 0.0)));
		}
	}
	In.State = Wanted.State == EWonderlandHandoffState::Held && !bHands ? EWonderlandHandoffState::Idle : Wanted.State;
	In.PhaseSeconds = Wanted.Phase;
	R.Swords->Show(In);

	// THE TRANSFORMATION'S LIGHT, as the owner's Dog drives it (RelayDogCharacter UpdateHandoffPresentation): into the middle of each blade, along each blade, with no companion bodies
	WonderlandHandoffTransform::FShowInput Change;
	Change.State = In.State;
	Change.PhaseSeconds = In.PhaseSeconds;
	Change.LeftSword = R.Swords->GetSwordWorld(true).TransformPosition(FVector(0.0f, 0.0f, 50.0f));
	Change.RightSword = R.Swords->GetSwordWorld(false).TransformPosition(FVector(0.0f, 0.0f, 50.0f));
	Change.LeftSwordAxis = R.Swords->GetSwordWorld(true).GetRotation().GetAxisZ();
	Change.RightSwordAxis = R.Swords->GetSwordWorld(false).GetRotation().GetAxisZ();
	Change.LeftSwordReach = 50.0f * static_cast<float>(R.Swords->GetSwordWorld(true).GetScale3D().GetAbsMax());
	Change.RightSwordReach = 50.0f * static_cast<float>(R.Swords->GetSwordWorld(false).GetScale3D().GetAbsMax());
	Change.TimeSeconds = In.TimeSeconds;
	R.Transform->Show(Change);

	// WLHANDOFF play: said when the state being DRAWN changes, with the time since the sequence began on this machine's clock (the measurement line for the offset to the owner's)
	const int32 PlayState = 1 + static_cast<int32>(In.State) + (bHands ? 8 : 0);
	if (PlayState != R.LoggedPlayState)
	{
		R.LoggedPlayState = PlayState;
		UE_LOG(LogTemp, Display, TEXT("WLHANDOFF play fig=%s state=%s phase=%.2f sinceStartMs=%.0f hands=%d swords=%d armed=%.2f"), *UserId, FWonderlandMissionHandoff::StateName(In.State),
			static_cast<double>(In.PhaseSeconds), (Now - R.Track.StartedAt) * 1000.0, bHands ? 1 : 0, R.Swords->CountVisibleBoxes(), static_cast<double>(R.Track.Armed));
	}
}

void FWonderlandRemoteAvatars::Tick(UWorld* World, float DeltaSeconds)
{
	using namespace WonderlandWorldPresenceDetail;
	const APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
	const FVector Camera = PC != nullptr && PC->PlayerCameraManager != nullptr ? PC->PlayerCameraManager->GetCameraLocation() : FVector::ZeroVector;
	const double NowSeconds = FPlatformTime::Seconds();
	const bool bDeadReckon = CVarRemoteDeadReckon.GetValueOnGameThread() != 0;
	for (TPair<FString, FRemote>& Pair : Remotes)
	{
		FRemote& R = Pair.Value;
		AWonderlandCompanionEmbodiment* Body = R.Body.Get();
		if (Body == nullptr)
		{
			continue;
		}
		Body->SetFreezeIdleWhenStill(CVarRemoteIdleFreeze.GetValueOnGameThread() != 0);
		const FVector Now = Body->GetActorLocation();
		// WHERE THEY SHOULD BE BY NOW: the report plus constant velocity (Speed along the last two reports' heading) for the time since
		// it was taken (its age at the backend plus the time held here), capped. A standing report, a first report, or no heading: the report.
		FVector Aim = R.Target;
		if (bDeadReckon && R.DrSpeed >= MinMovingSpeedUu && !R.DrHeading.IsNearlyZero())
		{
			const double Ahead = FMath::Clamp((NowSeconds - R.DrReceivedAt) + R.DrAgeSeconds, 0.0, static_cast<double>(CVarRemoteDrCap.GetValueOnGameThread()));
			Aim += R.DrHeading * (R.DrSpeed * Ahead);
		}
		// EASED, so its gait (driven by the distance it covers) reads the movement as walking and running. The snap is still judged on the report.
		const bool bSnap = FVector::Dist(Now, R.Target) > SnapDistanceUu;
		float Rate = CVarRemoteEaseRate.GetValueOnGameThread();
		bool bInterp = false;
		double DelayUsed = 0.0;
		if (CVarRemoteInterp.GetValueOnGameThread() != 0 && R.Samples.Num() > 0)
		{
			// DRAWN IN THE PAST, between the sender's own report times: a turn is a turn and a stop is a stop, never guessed ahead.
			const TArray<FRemote::FSample>& Ss = R.Samples;
			double Delay = static_cast<double>(CVarRemoteInterpDelay.GetValueOnGameThread());
			if (CVarRemoteInterpAdaptive.GetValueOnGameThread() != 0)
			{
				// The delay must cover how old the NEWEST report can be at any tick (the sender's report gap + the time until this client's own next
				// answer carries it), or the figure catches up with it, holds, and jumps. A leaky peak of that age (+ a margin) is the smallest safe delay.
				// It RISES at most 10 percent of real time and FALLS at most 5 percent, so a change never reads as a speed change.
				const double Dt = FMath::Clamp(static_cast<double>(DeltaSeconds), 0.0, 0.25);
				R.PeakAge = FMath::Max(0.0, R.PeakAge - 0.05 * Dt);   // raised on report arrival (see the sample insertion); only decays here
				const double Target = FMath::Clamp(R.PeakAge + static_cast<double>(CVarRemoteInterpMargin.GetValueOnGameThread()),
					static_cast<double>(CVarRemoteInterpDelayMin.GetValueOnGameThread()), static_cast<double>(CVarRemoteInterpDelayMax.GetValueOnGameThread()));
				if (R.AdaptDelay < 0.0)
				{
					R.AdaptDelay = FMath::Max(Delay, Target);   // start safe: the fixed delay, or more if the first reports are already older
				}
				const double Step = (Target > R.AdaptDelay ? 0.10 : 0.05) * Dt;
				R.AdaptDelay += FMath::Clamp(Target - R.AdaptDelay, -Step, Step);
				Delay = R.AdaptDelay;
			}
			DelayUsed = Delay;
			const double RT = NowSeconds - Delay;
			if (RT <= Ss[0].T)
			{
				Aim = Ss[0].P;
			}
			else if (RT >= Ss.Last().T)
			{
				Aim = Ss.Last().P;
				// CAUGHT UP with the newest report (a late one): carry on at the last segment's velocity for a short, capped time (XY only) instead of stalling
				const double Cap = static_cast<double>(CVarRemoteInterpExtrap.GetValueOnGameThread());
				// ONLY FROM A MOVING REPORT, AT ITS REPORTED SPEED: a stop's last report says speed 0, and the 0.1 s hold-then-jump segment before it (see the
				// sample insertion) reads as hundreds of uu/s, so the figure was parked up to ~41 uu past the stop for good (measured r16reh16l, 10-18).
				if (Cap > 0.0 && Ss.Num() >= 2 && Ss.Last().V >= MinMovingSpeedUu)
				{
					const FRemote::FSample& Prev = Ss[Ss.Num() - 2];
					const double Span = Ss.Last().T - Prev.T;
					const FVector2D Seg(Ss.Last().P.X - Prev.P.X, Ss.Last().P.Y - Prev.P.Y);
					if (Span > 0.02 && Span < 0.4 && Seg.SizeSquared() > 1e-6)
					{
						// velocity decaying linearly to zero over Cap: the distance carried is v * (a - a^2 / 2Cap), at most v * Cap / 2 (30 uu at 300 uu/s, Cap 0.2)
						// THEN THE CARRIED DISTANCE GIVES BACK THE SAME WAY over the next Cap (zero by 2 x Cap): a report that never comes (the player stopped: no further
						// report is stored) must not leave the figure parked at the carried point. Measured r16reh16o: a stop reported at v=53 parked 5.2 uu past it for good.
						const double Over = RT - Ss.Last().T;
						const double Ahead = FMath::Min(Over, Cap);
						double Eff = Ahead - Ahead * Ahead / (2.0 * Cap);
						// Only when the last report says the player was slowing or stopped (a stop's final report is low but not zero: 33-53 uu/s measured). A runner whose next
						// report is merely LATE keeps the carried distance: pulling it back and then forward would be a visible stutter.
						if (Over > Cap && Ss.Last().V < 150.0f)
						{
							Eff *= FMath::Max(0.0, 1.0 - (Over - Cap) / Cap);
						}
						const FVector2D Dir = Seg.GetSafeNormal();
						const double Speed = FMath::Min(static_cast<double>(Ss.Last().V), Seg.Size() / Span);
						Aim.X += Dir.X * Speed * Eff;
						Aim.Y += Dir.Y * Speed * Eff;
					}
				}
			}
			else
			{
				int32 I = Ss.Num() - 2;
				while (I > 0 && Ss[I].T > RT)
				{
					--I;
				}
				const double Span = Ss[I + 1].T - Ss[I].T;
				const double F = Span > 1e-6 ? FMath::Clamp((RT - Ss[I].T) / Span, 0.0, 1.0) : 1.0;
				Aim = FMath::Lerp(Ss[I].P, Ss[I + 1].P, F);
			}
			Rate = CVarRemoteInterpEase.GetValueOnGameThread();
			bInterp = true;
		}
		FVector Next;
		// THE REPORTED SPEED OF THE MOMENT BEING DRAWN (for the figure's gait only; never used for position): interpolated between the bracketing reports.
		// Past the newest report: its speed while it is a run that is merely late (<= 0.4 s), else 0 (a stop-ish final report must not keep a parked figure 'moving').
		float GaitHint = -1.0f;
		if (bInterp && !bSnap && CVarRemoteGaitFromReport.GetValueOnGameThread() != 0)
		{
			const TArray<FRemote::FSample>& Gs = R.Samples;
			const double GRT = NowSeconds - DelayUsed;
			if (GRT <= Gs[0].T)
			{
				GaitHint = Gs[0].V;
			}
			else if (GRT >= Gs.Last().T)
			{
				GaitHint = (Gs.Last().V >= 150.0f && GRT - Gs.Last().T <= 0.4) ? Gs.Last().V : 0.0f;
			}
			else
			{
				int32 J = Gs.Num() - 2;
				while (J > 0 && Gs[J].T > GRT)
				{
					--J;
				}
				const double GSpan = Gs[J + 1].T - Gs[J].T;
				const double GF = GSpan > 1e-6 ? FMath::Clamp((GRT - Gs[J].T) / GSpan, 0.0, 1.0) : 1.0;
				GaitHint = static_cast<float>(FMath::Lerp(static_cast<double>(Gs[J].V), static_cast<double>(Gs[J + 1].V), GF));
			}
		}
		Body->SetRemoteGaitSpeedHint(GaitHint);
		if (bSnap)
		{
			Next = R.Target;
		}
		else if (bInterp)
		{
			// XY eased at InterpEase (smooths the report-rate speed ripple); the HEIGHT follows the floor at its own, fast rate so contact is not delayed.
			// EXPONENTIAL, so the lag is the same at any frame rate: VInterpTo's linear step snaps to the target when a frame takes >= 1/rate (a slow frame
			// = a jump, the next fast ones = lag: measured as 0.18-0.27 shown-speed CV where the interpolated path itself is 0.02-0.08).
			const double Dt = FMath::Max(0.0, static_cast<double>(DeltaSeconds));
			const double AlphaXY = 1.0 - FMath::Exp(-static_cast<double>(Rate) * Dt);
			const double AlphaZ = 1.0 - FMath::Exp(-static_cast<double>(CVarRemoteInterpEaseZ.GetValueOnGameThread()) * Dt);
			Next = FVector(Now.X + (Aim.X - Now.X) * AlphaXY, Now.Y + (Aim.Y - Now.Y) * AlphaXY, Now.Z + (Aim.Z - Now.Z) * AlphaZ);
			// CATCH-UP LIMIT: after a late report the target jumps ahead; the figure may close on it at most CatchUp x the player's own reported speed
			// (a visible surge is worse than a short extra lag). Standing / unknown speed: no limit beyond a generous 900 uu/s.
			const double CatchUp = static_cast<double>(CVarRemoteInterpCatchUp.GetValueOnGameThread());
			if (CatchUp > 0.0)
			{
				const double Vmax = (R.DrSpeed >= MinMovingSpeedUu ? static_cast<double>(R.DrSpeed) * CatchUp : 900.0) * Dt;
				const FVector2D Step(Next.X - Now.X, Next.Y - Now.Y);
				const double Len = Step.Size();
				if (Len > Vmax && Len > 1e-6)
				{
					Next.X = Now.X + Step.X * (Vmax / Len);
					Next.Y = Now.Y + Step.Y * (Vmax / Len);
				}
			}
		}
		else
		{
			Next = FMath::VInterpTo(Now, Aim, DeltaSeconds, Rate);
		}
		const FRotator Facing = FMath::RInterpTo(Body->GetActorRotation(), FRotator(0.0, R.TargetYaw, 0.0), DeltaSeconds, EaseRate);
		Body->SetActorLocationAndRotation(Next, Facing);
		UpdateRemoteHandoff(Pair.Key, R, Body, World, DeltaSeconds);
		// THE OWNER'S DOG ANIMATOR, run for this figure (MP-ANIM-01 cause 2): the same arithmetic, configured the same way, fed the speed the sender
		// reported for the drawn moment (the gait hint, 0 when standing), the same dt clamp and DistanceUU = speed x dt as ARelayDogCharacter::Tick; its pose
		// is worn exactly as a skin worn by the Dog wears it. A figure is never airborne, on stairs or under a look target here: the Dog's other inputs stay at their rest values.
		if (CVarRemoteDogAnimator.GetValueOnGameThread() != 0)
		{
			if (!R.bAnimConfigured)
			{
				// the canon body's width, asked of the local player's Dog when there is one (as the wardrobe stage does), else the canon's built width
				float HeadWidth = RelayDogPresentation::CanonHeadWidthUU;
				if (const ARelayDogCharacter* LocalDog = PC != nullptr ? Cast<ARelayDogCharacter>(PC->GetPawn()) : nullptr)
				{
					HeadWidth = LocalDog->HeadWidthUU > 1.0f ? LocalDog->HeadWidthUU : HeadWidth;
				}
				RelayDogPresentation::ConfigureCanonAnimator(R.Anim, HeadWidth);
				R.bAnimConfigured = true;
			}
			const float AnimDt = FMath::Clamp(DeltaSeconds, 0.0f, 0.05f);
			// the reported speed of the drawn moment; with no hint (Interp off, GaitFromReport 0) the distance actually covered; a snap is not a run
			const float AnimSpeed = bSnap ? 0.0f
				: (GaitHint >= 0.0f ? GaitHint : (DeltaSeconds > KINDA_SMALL_NUMBER ? static_cast<float>(FVector::Dist2D(Now, Next)) / DeltaSeconds : 0.0f));
			RelayDogStride::FDogInput AnimIn;
			AnimIn.DeltaSeconds = AnimDt;
			AnimIn.SpeedUU = AnimSpeed;
			AnimIn.DistanceUU = AnimSpeed * AnimDt;
			AnimIn.HeadingDeg = static_cast<float>(Facing.Yaw);
			AnimIn.DesiredHeadingDeg = AnimSpeed >= MinMovingSpeedUu ? R.TargetYaw : AnimIn.HeadingDeg;
			const RelayDogStride::FDogPose& AnimPose = R.Anim.Update(AnimIn);
			// STANDING still keeps the figure's own frozen idle (founder-confirmed r16reh16o: the other Dog stands still); the Dog's pose is worn while it moves or settles
			if (AnimSpeed >= MinMovingSpeedUu || AnimPose.GaitWeight > 0.02f)
			{
				Body->WearCanonicalPose(RelayDogPresentation::ComposeWornPose(AnimPose, 0.0f, 0.0f));
			}
			else if (Body->IsGaitDrivenExternally())
			{
				Body->ReleaseCanonicalGait();
			}
		}
		else if (Body->IsGaitDrivenExternally())
		{
			Body->ReleaseCanonicalGait();   // kill switch flipped at run time: back to the figure's own gait
		}
		// WLREMOTE: diagnostics only (a snap is said at once; otherwise one line a second per figure). Cheap: no allocation.
		if (bSnap)
		{
			UE_LOG(LogTemp, Display, TEXT("WLREMOTE snap fig=%s from=(%.1f,%.1f,%.1f) to=(%.1f,%.1f,%.1f)"), *Pair.Key,
				Now.X, Now.Y, Now.Z, R.Target.X, R.Target.Y, R.Target.Z);
		}
		const bool bLogMotionNow = NowSeconds >= R.LogNextAt;
		if (bLogMotionNow)
		{
			R.LogNextAt = NowSeconds + FMath::Max(0.02, static_cast<double>(CVarRemoteLogPeriod.GetValueOnGameThread()));
			UE_LOG(LogTemp, Display, TEXT("WLREMOTE fig=%s recv=(%.1f,%.1f,%.1f) age=%.0fms applied=(%.1f,%.1f,%.1f) lagUu=%.1f lagXYUu=%.1f worn=%d floatZ=%.2f lowestUu=%.2f aim=(%.1f,%.1f) dtMs=%.1f nowXY=(%.1f,%.1f) interp=%d delayMs=%.0f yaw=%.2f tyaw=%.2f idleFreeze=%.3f gaitW=%.3f gSpd=%.1f gPh=%.4f actPh=%.4f dogAnim=%d dStride=%.1f dDuty=%.2f dLean=%.1f dArms=%.2f dCps=%.2f"),
				*Pair.Key, R.Target.X, R.Target.Y, R.Target.Z,
				(NowSeconds - R.RecvAt) * 1000.0 + R.RecvAgeMs,
				Next.X, Next.Y, Next.Z,
				FVector::Dist(R.Target, Next), FVector::Dist2D(R.Target, Next),
				Body->IsWornPoseValid() ? 1 : 0, Body->GetFloatRootRelativeZ(), Body->GetFigureLowestUu(),
				Aim.X, Aim.Y, static_cast<double>(DeltaSeconds) * 1000.0, Now.X, Now.Y, bInterp ? 1 : 0, DelayUsed * 1000.0,
				Body->GetActorRotation().Yaw, static_cast<double>(R.TargetYaw), static_cast<double>(Body->GetIdleFreezeDiag()), static_cast<double>(Body->GetGaitWeightDiag()),
				static_cast<double>(Body->GetGroundSpeedDiag()), static_cast<double>(Body->GetGaitPhaseDiag()), static_cast<double>(Body->GetActivityPhaseDiag()),
				R.bAnimConfigured && Body->IsGaitDrivenExternally() ? 1 : 0, static_cast<double>(R.Anim.Pose().Stride.StrideLength), static_cast<double>(R.Anim.Pose().Stride.DutyFactor),
				static_cast<double>(R.Anim.Pose().LeanDeg), static_cast<double>(R.Anim.Pose().Stride.ArmsBack),
				R.Anim.Pose().Stride.StrideLength > 1.0f ? static_cast<double>(R.Anim.Pose().SpeedUU / R.Anim.Pose().Stride.StrideLength) : 0.0);
		}
		if (bLogMotionNow)
		{
			UE_LOG(LogTemp, Display, TEXT("WLREMOTE motion fig=%s motion=%s z=%.2f"), *Pair.Key, *R.Motion,
				Next.Z + static_cast<double>(Body->GetFloatRootRelativeZ()) + static_cast<double>(Body->GetFigureLowestUu()));
		}
		if (UTextRenderComponent* Label = R.Label.Get())
		{
			// FACING THE CAMERA: a name is read, not seen edge-on.
			const FVector ToCamera = Camera - Label->GetComponentLocation();
			Label->SetWorldRotation(FRotator(0.0, ToCamera.Rotation().Yaw, 0.0));
		}
	}
}

FString FWonderlandRemoteAvatars::Describe() const
{
	TArray<FString> Parts;
	for (const TPair<FString, FRemote>& Pair : Remotes)
	{
		const AWonderlandCompanionEmbodiment* Body = Pair.Value.Body.Get();
		Parts.Add(FString::Printf(TEXT("%s@%s %s"), *Pair.Key, Body != nullptr ? *Body->GetActorLocation().ToCompactString() : TEXT("(gone)"), *Pair.Value.SkinId));
	}
	return Parts.Num() > 0 ? FString::Join(Parts, TEXT(" | ")) : FString(TEXT("none"));
}
