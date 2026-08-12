// MINIMAL UNREAL STUBS — enough to PARSE, never enough to run.
#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include <cmath>
#define UCLASS(...)
#define USTRUCT(...)
#define UENUM(...)
#define UPROPERTY(...)
#define UFUNCTION(...)
#define GENERATED_BODY(...)
#define GENERATED_USTRUCT_BODY(...)
#define UMETA(...)
#define IMPLEMENT_PRIMARY_GAME_MODULE(...)
#define FORCEINLINE inline
#define check(x)
#define ensure(x) (x)
#define TEXT(x) x
#define WONDERLAND_API
using int64 = std::int64_t; using uint64 = std::uint64_t; using int16 = std::int16_t; using uint16 = std::uint16_t;
using uint8 = std::uint8_t; using int32 = std::int32_t; using uint32 = std::uint32_t;
struct FString { FString(){} FString(const char*){} };
struct FName { FName(){} FName(const char*){} };
struct FText {};
template<typename T> struct TArray { std::vector<T> v;
  int32 Num() const { return (int32)v.size(); } void Add(const T& x){ v.push_back(x); }
  T& operator[](int32 i){ return v[(size_t)i]; } const T& operator[](int32 i) const { return v[(size_t)i]; }
  T* begin(){return v.data();} T* end(){return v.data()+v.size();}
  const T* begin() const {return v.data();} const T* end() const {return v.data()+v.size();} };
struct FVector { double X=0,Y=0,Z=0; FVector(){} explicit FVector(double u):X(u),Y(u),Z(u){} FVector(double a,double b,double c):X(a),Y(b),Z(c){}
  FVector operator*(double s) const { return FVector(X*s,Y*s,Z*s); }
  FVector operator+(const FVector& o) const { return FVector(X+o.X,Y+o.Y,Z+o.Z); } };
struct FRotator { double Pitch=0,Yaw=0,Roll=0; FRotator(){} FRotator(double p,double y,double r):Pitch(p),Yaw(y),Roll(r){} };
struct FTransform {};
struct FColor {}; struct FLinearColor {};
class UClass;
class UObject { public: virtual ~UObject(){} static UClass* StaticClass(){ return nullptr; } };
class UActorComponent : public UObject { public: void SetupAttachment(void*, FName = FName()){} };
class USceneComponent : public UActorComponent { public:
  void SetRelativeScale3D(const FVector&){} void SetRelativeLocation(const FVector&){}
  FVector GetRelativeScale3D() const { return FVector(); } };
class AActor : public UObject { public:
  struct { bool bCanEverTick = false; } PrimaryActorTick;
  USceneComponent* RootComponent = nullptr;
  virtual void Tick(float){} virtual void BeginPlay(){}
  FVector GetActorLocation() const { return FVector(); }
  void SetActorLocation(const FVector&){}
  void SetRootComponent(USceneComponent* c){ RootComponent = c; }
  FRotator GetActorRotation() const { return FRotator(); } };
template<typename T> T* CreateDefaultSubobject(FName) { static T t; return &t; }
template<typename T> T* NewObject(UObject* = nullptr) { static T t; return &t; }
template<typename T> struct TObjectPtr { T* p = nullptr; TObjectPtr(){} TObjectPtr(T* q):p(q){}
  T* operator->() const { return p; } operator T*() const { return p; }
  TObjectPtr& operator=(T* q){ p = q; return *this; } };
struct FMath {
  static float Sin(float x){ return std::sin(x); } static float Cos(float x){ return std::cos(x); }
  static float Fmod(float a,float b){ return std::fmod(a,b); }
  static float Abs(float x){ return std::fabs(x); }
  template<typename T> static T Clamp(T v,T a,T b){ return v<a?a:(v>b?b:v); }
  template<typename T> static T Max(T a,T b){ return a>b?a:b; }
  template<typename T> static T Min(T a,T b){ return a<b?a:b; }
  static float Lerp(float a,float b,float t){ return a+(b-a)*t; }
  static bool IsFinite(float x){ return std::isfinite(x); }
  static bool IsNaN(float x){ return std::isnan(x); }
  static float Sqrt(float x){ return std::sqrt(x); }
  static constexpr float Pi = 3.14159265358979323846f; };
#define PI 3.14159265358979323846f
#define UE_SMALL_NUMBER 1.e-8f
template<typename To, typename From> To* Cast(From* p){ return static_cast<To*>(p); }
