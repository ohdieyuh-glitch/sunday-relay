// MINIMAL UNREAL STUB — enough to PARSE, never enough to run.
#pragma once

#include "CoreMinimal.h"

class UGameInstance : public UObject
{
public:
	template<typename T> T* GetSubsystem() const { return nullptr; }
};
