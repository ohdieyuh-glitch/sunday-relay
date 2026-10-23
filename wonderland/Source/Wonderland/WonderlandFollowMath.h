// Engine-free follow-camera math. The observer pawn that goes in is the pawn that
// comes back. The camera is a separate point behind the remote body.
#pragma once

#include <cmath>
#include <cstring>
#include <string>

namespace WonderlandFollow
{
	inline constexpr double kFollowBackUu = 450.0;
	inline constexpr double kFollowUpUu = 250.0;

	struct FPoint
	{
		double X = 0.0;
		double Y = 0.0;
		double Z = 0.0;
	};

	struct FPawnXform
	{
		double X = 0.0;
		double Y = 0.0;
		double Z = 0.0;
		double Pitch = 0.0;
		double Yaw = 0.0;
		double Roll = 0.0;
	};

	struct FBodyId
	{
		const char* Display = "";
		const char* LogName = "";
	};

	enum class EFollowAsk
	{
		Invalid,
		Off,
		First,
		Named
	};

	inline bool EqualsIgnoreCase(const char* Left, const char* Right)
	{
		if (Left == nullptr || Right == nullptr)
		{
			return false;
		}
		while (*Left != '\0' && *Right != '\0')
		{
			unsigned char A = static_cast<unsigned char>(*Left);
			unsigned char B = static_cast<unsigned char>(*Right);
			if (A >= 'A' && A <= 'Z')
			{
				A = static_cast<unsigned char>(A - 'A' + 'a');
			}
			if (B >= 'A' && B <= 'Z')
			{
				B = static_cast<unsigned char>(B - 'A' + 'a');
			}
			if (A != B)
			{
				return false;
			}
			++Left;
			++Right;
		}
		return *Left == *Right;
	}

	inline bool EqualsExact(const char* Left, const char* Right)
	{
		if (Left == nullptr || Right == nullptr)
		{
			return false;
		}
		return std::strcmp(Left, Right) == 0;
	}

	inline EFollowAsk ClassifyFollowAsk(const char* Arg)
	{
		if (Arg == nullptr || Arg[0] == '\0')
		{
			return EFollowAsk::Invalid;
		}
		if (EqualsIgnoreCase(Arg, "off"))
		{
			return EFollowAsk::Off;
		}
		if (EqualsIgnoreCase(Arg, "first"))
		{
			return EFollowAsk::First;
		}
		return EFollowAsk::Named;
	}

	/** Display name, ignoring case, wins. Otherwise the user id in LogName, exact. */
	inline int PickBody(const FBodyId* Bodies, int Count, EFollowAsk Ask, const char* Want)
	{
		if (Bodies == nullptr || Count <= 0)
		{
			return -1;
		}
		if (Ask == EFollowAsk::First)
		{
			return 0;
		}
		if (Ask != EFollowAsk::Named || Want == nullptr)
		{
			return -1;
		}
		for (int Index = 0; Index < Count; ++Index)
		{
			if (Bodies[Index].Display != nullptr && EqualsIgnoreCase(Bodies[Index].Display, Want))
			{
				return Index;
			}
		}
		for (int Index = 0; Index < Count; ++Index)
		{
			if (Bodies[Index].LogName != nullptr && Bodies[Index].LogName[0] != '\0' && EqualsExact(Bodies[Index].LogName, Want))
			{
				return Index;
			}
		}
		return -1;
	}

	inline FPoint CameraLocation(double X, double Y, double Z, double YawDeg)
	{
		constexpr double kPi = 3.14159265358979323846;
		const double YawRad = YawDeg * kPi / 180.0;
		const double ForwardX = std::cos(YawRad);
		const double ForwardY = std::sin(YawRad);
		FPoint Camera;
		Camera.X = X - ForwardX * kFollowBackUu;
		Camera.Y = Y - ForwardY * kFollowBackUu;
		Camera.Z = Z + kFollowUpUu;
		return Camera;
	}

	inline bool SameXform(const FPawnXform& Left, const FPawnXform& Right)
	{
		return Left.X == Right.X && Left.Y == Right.Y && Left.Z == Right.Z
			&& Left.Pitch == Right.Pitch && Left.Yaw == Right.Yaw && Left.Roll == Right.Roll;
	}

	/** Copies the pawn through. Fills the camera from the body. Does not write the pawn. */
	inline FPawnXform PawnAfterFollow(const FPawnXform& Pawn, const FPawnXform& Body, FPoint& OutCamera)
	{
		OutCamera = CameraLocation(Body.X, Body.Y, Body.Z, Body.Yaw);
		return Pawn;
	}

	/** WLFOLLOW only. An empty user id is "(none)", never a display name. */
	inline std::string FollowLogLine(const char* State, const char* UserId)
	{
		const char* What = (State != nullptr && State[0] != '\0') ? State : "state";
		const char* Id = (UserId != nullptr && UserId[0] != '\0') ? UserId : "(none)";
		return std::string("WLFOLLOW ") + What + " id=" + Id;
	}
}
