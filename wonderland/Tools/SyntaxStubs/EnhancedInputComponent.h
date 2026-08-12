#pragma once
#include "CoreMinimal.h"
class UInputComponent : public UActorComponent {};
class UEnhancedInputComponent : public UInputComponent {};
class UInputAction : public UObject {};
class UInputMappingContext : public UObject {};
struct FInputActionValue { template<typename T> T Get() const { return T(); } };
