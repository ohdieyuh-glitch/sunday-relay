#pragma once
#include "CoreMinimal.h"
class UStaticMesh : public UObject {};
class UStaticMeshComponent : public USceneComponent { public:
  void SetCollisionProfileName(FName){} void SetStaticMesh(UStaticMesh*){}
  void SetCastShadow(bool){} void SetVisibility(bool){} };
