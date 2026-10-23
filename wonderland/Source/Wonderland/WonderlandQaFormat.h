// QA event line (engine-free). One JSON object per event, stable key order, so another
// branch can parse the same message. Callers UE_LOG the returned string as the whole
// message. This header does not read the handoff wire and does not decide a mission.
#pragma once

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <map>
#include <string>
#include <vector>

namespace WonderlandQa
{
	inline constexpr int64_t kSamplePeriodMs = 100;
	inline constexpr char kHandoffAnim[] = "handoff_twin_swords";
	inline constexpr char kHandoffVfx[] = "WonderlandHandoffTransform";
	inline constexpr char kActivationStarted[] = "activation_started";
	inline constexpr char kActivationEnded[] = "activation_ended";
	inline constexpr char kDisconnect[] = "disconnect";
	inline constexpr char kReconnectAttempt[] = "reconnect_attempt";
	inline constexpr char kReconnected[] = "reconnected";
	inline constexpr char kStateRestored[] = "state_restored";
	inline constexpr char kMovementSample[] = "movement_sample";

	/** Plain refusal. No JSON object, so a scored parser does not see an event. */
	inline const char* DisabledRefusal()
	{
		return "QA instrumentation is off";
	}

	inline bool& EnabledFlag()
	{
		static bool bEnabled = false;
		return bEnabled;
	}

	inline bool IsEnabled()
	{
		return EnabledFlag();
	}

	inline void SetEnabled(bool bOn)
	{
		EnabledFlag() = bOn;
	}

	inline std::string JsonEscape(const std::string& In)
	{
		std::string Out;
		Out.reserve(In.size() + 2);
		for (unsigned char C : In)
		{
			switch (C)
			{
			case '"': Out += "\\\""; break;
			case '\\': Out += "\\\\"; break;
			case '\n': Out += "\\n"; break;
			case '\r': Out += "\\r"; break;
			case '\t': Out += "\\t"; break;
			default:
				if (C < 0x20)
				{
					char Buf[8];
					std::snprintf(Buf, sizeof(Buf), "\\u%04x", C);
					Out += Buf;
				}
				else
				{
					Out += static_cast<char>(C);
				}
			}
		}
		return Out;
	}

	inline std::string JsonStringOrNull(bool bPresent, const std::string& Value)
	{
		if (!bPresent)
		{
			return "null";
		}
		return std::string("\"") + JsonEscape(Value) + "\"";
	}

	/** A missing or non-finite number is null. A present finite number is printed, including a real zero. */
	inline std::string JsonNumber(double Value, bool bPresent)
	{
		if (!bPresent || !std::isfinite(Value))
		{
			return "null";
		}
		char Buf[64];
		std::snprintf(Buf, sizeof(Buf), "%.4f", Value);
		return Buf;
	}

	inline std::string JsonIntOrNull(bool bPresent, int64_t Value)
	{
		return bPresent ? std::to_string(Value) : std::string("null");
	}

	inline std::string JsonBoolOrNull(bool bPresent, bool Value)
	{
		if (!bPresent)
		{
			return "null";
		}
		return Value ? "true" : "false";
	}

	/**
	 * Key order: ts_utc_ms, client_role, net_id, build_sha, corr_id, event, then Extra.
	 * Extra is already-encoded `"name":value` pairs separated by commas, with no leading comma.
	 * An empty net id, a missing build, and a missing corr are JSON null, never "".
	 */
	inline std::string EventLine(int64_t TsMs, const std::string& Role, const std::string& NetId, bool bHasBuild, const std::string& Build,
		bool bHasCorr, const std::string& Corr, const std::string& Event, const std::string& Extra)
	{
		std::string Line;
		Line.reserve(256 + Extra.size());
		Line += "{\"ts_utc_ms\":";
		Line += std::to_string(TsMs);
		Line += ",\"client_role\":";
		Line += JsonStringOrNull(true, Role);
		Line += ",\"net_id\":";
		Line += JsonStringOrNull(!NetId.empty(), NetId);
		Line += ",\"build_sha\":";
		Line += JsonStringOrNull(bHasBuild, Build);
		Line += ",\"corr_id\":";
		Line += JsonStringOrNull(bHasCorr, Corr);
		Line += ",\"event\":";
		Line += JsonStringOrNull(true, Event);
		if (!Extra.empty())
		{
			Line += ",";
			Line += Extra;
		}
		Line += "}";
		return Line;
	}

	inline std::string ActivationLine(int64_t TsMs, const std::string& Role, const std::string& NetId, bool bHasBuild, const std::string& Build,
		bool bHasCorr, const std::string& Corr, const std::string& Event)
	{
		const std::string Extra = std::string("\"anim_asset\":\"") + JsonEscape(kHandoffAnim) + "\",\"vfx_asset\":\"" + JsonEscape(kHandoffVfx) + "\"";
		return EventLine(TsMs, Role, NetId, bHasBuild, Build, bHasCorr, Corr, Event, Extra);
	}

	inline std::string MovementLine(int64_t TsMs, const std::string& Role, const std::string& NetId, double X, double Y, double Z, bool bHasVelocity,
		double Vx, double Vy, double Vz, bool bGroundHit, bool bHasGroundDistance, double GroundDistance, bool bHover)
	{
		std::string Extra;
		Extra += "\"x\":";
		Extra += JsonNumber(X, true);
		Extra += ",\"y\":";
		Extra += JsonNumber(Y, true);
		Extra += ",\"z\":";
		Extra += JsonNumber(Z, true);
		Extra += ",\"vx\":";
		Extra += JsonNumber(Vx, bHasVelocity);
		Extra += ",\"vy\":";
		Extra += JsonNumber(Vy, bHasVelocity);
		Extra += ",\"vz\":";
		Extra += JsonNumber(Vz, bHasVelocity);
		Extra += ",\"ground_hit\":";
		Extra += bGroundHit ? "true" : "false";
		Extra += ",\"ground_distance\":";
		Extra += JsonNumber(GroundDistance, bHasGroundDistance);
		Extra += ",\"hover\":";
		Extra += bHover ? "true" : "false";
		return EventLine(TsMs, Role, NetId, false, std::string(), false, std::string(), kMovementSample, Extra);
	}

	/** True when a sample is due. Updates LastMs only when it samples. A backwards clock does not sample and does not move LastMs. One sample per call, including across a long gap. */
	inline bool ShouldSample(int64_t& LastMs, int64_t NowMs)
	{
		if (LastMs < 0)
		{
			LastMs = NowMs;
			return true;
		}
		if (NowMs < LastMs)
		{
			return false;
		}
		if (NowMs - LastMs >= kSamplePeriodMs)
		{
			LastMs = NowMs;
			return true;
		}
		return false;
	}

	struct FMotionSlot
	{
		int64_t LastMs = -1;
		bool bHasPos = false;
		double X = 0.0;
		double Y = 0.0;
		double Z = 0.0;
	};

	struct FMotionSample
	{
		bool bEmit = false;
		bool bHasVelocity = false;
		double Vx = 0.0;
		double Vy = 0.0;
		double Vz = 0.0;
	};

	inline std::map<std::string, FMotionSlot>& MotionSlots()
	{
		static std::map<std::string, FMotionSlot> Slots;
		return Slots;
	}

	/** First sample for a net id has no velocity (unknown is not zero). Later samples use the position delta over the elapsed sample clock. */
	inline FMotionSample TakeMotion(const std::string& NetId, int64_t NowMs, double X, double Y, double Z)
	{
		FMotionSlot& Slot = MotionSlots()[NetId];
		const int64_t Prev = Slot.LastMs;
		const bool bHad = Slot.bHasPos;
		const double Px = Slot.X;
		const double Py = Slot.Y;
		const double Pz = Slot.Z;
		FMotionSample Out;
		if (!ShouldSample(Slot.LastMs, NowMs))
		{
			return Out;
		}
		if (bHad && NowMs > Prev)
		{
			const double Dt = static_cast<double>(NowMs - Prev) / 1000.0;
			if (Dt > 0.0)
			{
				Out.bHasVelocity = true;
				Out.Vx = (X - Px) / Dt;
				Out.Vy = (Y - Py) / Dt;
				Out.Vz = (Z - Pz) / Dt;
			}
		}
		Slot.X = X;
		Slot.Y = Y;
		Slot.Z = Z;
		Slot.bHasPos = true;
		Out.bEmit = true;
		return Out;
	}

	inline std::string CorrId(int64_t Epoch, int64_t N)
	{
		return std::string("e") + std::to_string(Epoch) + "n" + std::to_string(N);
	}

	inline std::string SeqCorr(int64_t Seq)
	{
		return std::string("seq") + std::to_string(Seq);
	}

	/** The corr carried on the view, unchanged. Callers choose epoch+n, else seq, else empty before this. */
	inline std::string ObserverCorr(const std::string& Carried)
	{
		return Carried;
	}

	struct FEdge
	{
		bool bEmit = false;
		std::string Corr;
		std::string Event;
	};

	inline int& LocalSeq()
	{
		static int Seq = 0;
		return Seq;
	}

	inline bool& LocalStarted()
	{
		static bool bStarted = false;
		return bStarted;
	}

	inline std::string& LocalCorr()
	{
		static std::string Corr;
		return Corr;
	}

	inline bool HasOutstandingActivation()
	{
		return LocalStarted() && !LocalCorr().empty();
	}

	inline const std::string& OutstandingActivationCorr()
	{
		return LocalCorr();
	}

	/**
	 * Local presentation edge. State numbers match EWonderlandHandoffState:
	 * Idle 0, Acknowledged 1, Transforming 2, Delivering 3, Held 4, Returning 5.
	 * A start is only the entry into Acknowledged. A restored Held does not start.
	 * An end is the entry into Idle after a start was recorded. An end with no start emits nothing.
	 */
	inline FEdge LocalEdge(int Was, int Next)
	{
		FEdge Edge;
		if (Next == 1 && Was != 1)
		{
			LocalCorr() = std::string("local") + std::to_string(++LocalSeq());
			LocalStarted() = true;
			Edge.bEmit = true;
			Edge.Corr = LocalCorr();
			Edge.Event = kActivationStarted;
			return Edge;
		}
		if (Next == 0 && Was != 0 && LocalStarted())
		{
			Edge.bEmit = true;
			Edge.Corr = LocalCorr();
			Edge.Event = kActivationEnded;
			LocalStarted() = false;
			return Edge;
		}
		return Edge;
	}

	struct FPlaySlot
	{
		bool bStarted = false;
		std::string Corr;
	};

	inline std::map<std::string, FPlaySlot>& ObserverSlots()
	{
		static std::map<std::string, FPlaySlot> Slots;
		return Slots;
	}

	/**
	 * Observer drawn-state edge. Drawn is the presentation state (0 idle … 4 held), or -1 when nothing has been drawn.
	 * Duplicate start of the same corr is ignored. An end while not started does not emit a start.
	 * Entering Held does not emit. The carried corr is stored unchanged.
	 */
	inline FEdge ObserverEdge(const std::string& NetId, int PrevDrawn, int Drawn, const std::string& CarriedCorr)
	{
		FEdge Edge;
		FPlaySlot& Slot = ObserverSlots()[NetId];
		const std::string Carried = ObserverCorr(CarriedCorr);
		if (Drawn == 1 && PrevDrawn != 1)
		{
			if (Slot.bStarted && Slot.Corr == Carried)
			{
				return Edge;
			}
			Slot.bStarted = true;
			Slot.Corr = Carried;
			Edge.bEmit = true;
			Edge.Corr = Carried;
			Edge.Event = kActivationStarted;
			return Edge;
		}
		if (Drawn == 0 && PrevDrawn > 0)
		{
			if (!Slot.bStarted)
			{
				return Edge;
			}
			Edge.bEmit = true;
			Edge.Corr = !Slot.Corr.empty() ? Slot.Corr : Carried;
			Edge.Event = kActivationEnded;
			Slot.bStarted = false;
			return Edge;
		}
		return Edge;
	}

	struct FDropFacts
	{
		int64_t TsMs = 0;
		bool bHasSession = false;
		std::string SessionId;
		std::string SessionSource;
		bool bHasPose = false;
		double X = 0.0;
		double Y = 0.0;
		double Z = 0.0;
		double Yaw = 0.0;
		bool bHasPhase = false;
		int Phase = 0;
		bool bHasActivationCorr = false;
		std::string ActivationCorr;
		bool bHasRejoin404 = false;
		int Rejoin404 = 0;
		bool bHasRejoinKeep = false;
		int RejoinKeep = 0;
		bool bHasLeaveRetry = false;
		int LeaveRetry = 0;
		bool bHasLeaveWould = false;
		bool bLeaveRetryWouldApply = false;
	};

	inline std::string DropExtra(const FDropFacts& Facts, bool bRestored)
	{
		const std::string Source = Facts.SessionSource.empty() ? std::string("none") : Facts.SessionSource;
		std::string Extra;
		Extra += "\"session_id\":";
		Extra += JsonStringOrNull(Facts.bHasSession, Facts.SessionId);
		Extra += ",\"session_source\":";
		Extra += JsonStringOrNull(true, Source);
		Extra += ",\"x\":";
		Extra += JsonNumber(Facts.X, Facts.bHasPose);
		Extra += ",\"y\":";
		Extra += JsonNumber(Facts.Y, Facts.bHasPose);
		Extra += ",\"z\":";
		Extra += JsonNumber(Facts.Z, Facts.bHasPose);
		Extra += ",\"yaw\":";
		Extra += JsonNumber(Facts.Yaw, Facts.bHasPose);
		Extra += ",\"activation_phase\":";
		Extra += JsonIntOrNull(Facts.bHasPhase, Facts.Phase);
		Extra += ",\"activation_corr\":";
		Extra += JsonStringOrNull(Facts.bHasActivationCorr, Facts.ActivationCorr);
		if (bRestored)
		{
			Extra += ",\"rejoin_404_replan\":";
			Extra += JsonIntOrNull(Facts.bHasRejoin404, Facts.Rejoin404);
			Extra += ",\"rejoin_keep_target\":";
			Extra += JsonIntOrNull(Facts.bHasRejoinKeep, Facts.RejoinKeep);
			Extra += ",\"leave_retry\":";
			Extra += JsonIntOrNull(Facts.bHasLeaveRetry, Facts.LeaveRetry);
			Extra += ",\"leave_retry_would_apply\":";
			Extra += JsonBoolOrNull(Facts.bHasLeaveWould, Facts.bLeaveRetryWouldApply);
			Extra += ",\"restored_by\":\"local_snapshot\"";
			Extra += ",\"server_restored\":false";
		}
		return Extra;
	}

	inline std::string DropLine(const FDropFacts& Facts, const char* Event, bool bRestored)
	{
		return EventLine(Facts.TsMs, "sender", "local", false, std::string(), Facts.bHasActivationCorr, Facts.ActivationCorr, Event, DropExtra(Facts, bRestored));
	}

	inline std::vector<std::string> DropLines(const FDropFacts& Facts)
	{
		return {
			DropLine(Facts, kDisconnect, false),
			DropLine(Facts, kReconnectAttempt, false),
			DropLine(Facts, kReconnected, false),
			DropLine(Facts, kStateRestored, true),
		};
	}

	inline void ResetForTests()
	{
		EnabledFlag() = false;
		LocalSeq() = 0;
		LocalStarted() = false;
		LocalCorr().clear();
		ObserverSlots().clear();
		MotionSlots().clear();
	}
}
