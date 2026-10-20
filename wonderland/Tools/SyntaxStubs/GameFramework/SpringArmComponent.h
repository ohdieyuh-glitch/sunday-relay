#pragma once
#include "CoreMinimal.h"
class USpringArmComponent : public USceneComponent { public:
  float TargetArmLength = 0.f; bool bUsePawnControlRotation = false;
  bool bEnableCameraLag = false; float CameraLagSpeed = 0.f;
  bool bEnableCameraRotationLag = false; float CameraRotationLagSpeed = 0.f;
  bool bDoCollisionTest = false; bool bInheritPitch = true; bool bInheritYaw = true; bool bInheritRoll = true;
  FVector SocketOffset; FVector TargetOffset;
  static FName SocketName; };
