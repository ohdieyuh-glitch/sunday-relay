#pragma once
#include "CoreMinimal.h"
class UInputComponent;
class APawn : public AActor { public:
  bool bUseControllerRotationYaw = false; bool bUseControllerRotationPitch = false; bool bUseControllerRotationRoll = false;
  virtual void SetupPlayerInputComponent(UInputComponent*){}
  void AddMovementInput(const FVector&, float = 1.0f, bool = false){}
  void AddControllerYawInput(float){} void AddControllerPitchInput(float){}
  class AController* GetController() const { return nullptr; } };
class AController : public AActor { public: FRotator GetControlRotation() const { return FRotator(); } };
class APlayerController : public AController {};
