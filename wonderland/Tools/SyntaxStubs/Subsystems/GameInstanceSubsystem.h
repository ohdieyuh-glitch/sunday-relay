// MINIMAL UNREAL STUB — enough to PARSE, never enough to run.
//
// `Super` is deliberately NOT defined here. In a real build UHT writes it into
// each class's GENERATED_BODY, and a stub that guessed one base for every class
// would let a wrong base compile silently. The syntax check therefore carries a
// small per-file baseline for the `Super::` calls, exactly as it does for
// WonderlandDogPawn.cpp; the usage harness supplies the right one on its own
// command line, where the class being compiled is known.
#pragma once

#include "CoreMinimal.h"

class FSubsystemCollectionBase {};

class UGameInstanceSubsystem : public UObject
{
public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) { (void)Collection; }
	virtual void Deinitialize() {}
};
