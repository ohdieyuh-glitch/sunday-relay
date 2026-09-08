// MINIMAL UNREAL STUBS — enough to PARSE, never enough to run.
#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include <map>
#include <cmath>
#include <type_traits>
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
// A dynamic multicast delegate, reduced to what a PARSE needs. Broadcast is a
// no-op: nothing here dispatches, and a stub that pretended to would invite a
// test to believe it had observed a listener run.
#define DECLARE_DYNAMIC_MULTICAST_DELEGATE(Name) \
  struct Name { void Broadcast() {} void Clear() {} \
    template<typename O, typename F> void AddDynamic(O*, F) {} \
    template<typename O, typename F> void RemoveDynamic(O*, F) {} }
#define BlueprintAssignable

using int64 = std::int64_t; using uint64 = std::uint64_t; using int16 = std::int16_t; using uint16 = std::uint16_t;
using uint8 = std::uint8_t; using int32 = std::int32_t; using uint32 = std::uint32_t;
struct FString { std::string s; FString(){} FString(const char* c):s(c?c:""){}
  bool operator<(const FString& o) const { return s<o.s; }
  bool operator==(const FString& o) const { return s==o.s; }
  bool operator!=(const FString& o) const { return s!=o.s; }
  bool IsEmpty() const { return s.empty(); } void Reset(){ s.clear(); } };
struct FName { FName(){} FName(const char*){} };
struct FText {};
template<typename T> struct TArray { std::vector<T> v;
  int32 Num() const { return (int32)v.size(); } void Add(const T& x){ v.push_back(x); }
  bool IsValidIndex(int32 i) const { return i>=0 && (size_t)i<v.size(); }
  void Reset(){ v.clear(); } void Reserve(int32 n){ v.reserve((size_t)n); } void Empty(){ v.clear(); }
  T& operator[](int32 i){ return v[(size_t)i]; } const T& operator[](int32 i) const { return v[(size_t)i]; }
  T* begin(){return v.data();} T* end(){return v.data()+v.size();}
  const T* begin() const {return v.data();} const T* end() const {return v.data()+v.size();} };
template<typename K, typename V> struct TMap { std::map<K,V> m;
  int32 Num() const { return (int32)m.size(); } void Add(const K& k, const V& v){ m[k]=v; }
  V* Find(const K& k){ auto it=m.find(k); return it==m.end()?nullptr:&it->second; }
  auto begin(){return m.begin();} auto end(){return m.end();}
  auto begin() const {return m.begin();} auto end() const {return m.end();} };
struct FVector { double X=0,Y=0,Z=0; FVector(){} explicit FVector(double u):X(u),Y(u),Z(u){} FVector(double a,double b,double c):X(a),Y(b),Z(c){}
  FVector operator*(double s) const { return FVector(X*s,Y*s,Z*s); }
  FVector operator+(const FVector& o) const { return FVector(X+o.X,Y+o.Y,Z+o.Z); } };
struct FVector2D { double X=0,Y=0; FVector2D(){} FVector2D(double a,double b):X(a),Y(b){}
  FVector2D operator*(double s) const { return FVector2D(X*s,Y*s); }
  FVector2D operator+(const FVector2D& o) const { return FVector2D(X+o.X,Y+o.Y); }
  FVector2D operator-(const FVector2D& o) const { return FVector2D(X-o.X,Y-o.Y); } };
struct FRotator { double Pitch=0,Yaw=0,Roll=0; FRotator(){} FRotator(double p,double y,double r):Pitch(p),Yaw(y),Roll(r){} };
struct FTransform {};
struct FColor { uint8 R=0,G=0,B=0,A=255; FColor(){} FColor(uint8 r,uint8 g,uint8 b,uint8 a):R(r),G(g),B(b),A(a){} };
struct FLinearColor { float R=0,G=0,B=0,A=1; FLinearColor(){} FLinearColor(float r,float g,float b,float a):R(r),G(g),B(b),A(a){}
  FLinearColor operator*(float s) const { return FLinearColor(R*s,G*s,B*s,A*s); }
  FColor ToFColor(bool) const { return FColor((uint8)(R*255),(uint8)(G*255),(uint8)(B*255),(uint8)(A*255)); } };
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
  // RETURNED BY VALUE, AND THE `common_type` IS LOAD-BEARING.
  //
  // These were written as `-> decltype(a>b?a:b)`, which looks like the obvious
  // spelling and is a dangling reference: for two lvalues of the same type the
  // conditional expression is an LVALUE, so decltype yields `int&` and the
  // function returns a reference to its own parameter. At -O0 the dead stack
  // slot still held the right number and everything passed; at -O1 the caller
  // read whatever had replaced it, and a Reserve() of -1073741824 aborted the
  // usage harness. common_type_t decays it, so the value is copied out.
  template<typename A, typename B>
  static typename std::common_type<A, B>::type Max(A a, B b) { return a > b ? a : b; }
  template<typename A, typename B>
  static typename std::common_type<A, B>::type Min(A a, B b) { return a < b ? a : b; }
  static float Lerp(float a,float b,float t){ return a+(b-a)*t; }
  static bool IsFinite(float x){ return std::isfinite(x); }
  static bool IsNaN(float x){ return std::isnan(x); }
  static float Sqrt(float x){ return std::sqrt(x); }
  static float Pow(float a,float b){ return std::pow(a,b); }
  static constexpr float Pi = 3.14159265358979323846f; };
#define PI 3.14159265358979323846f
#define UE_SMALL_NUMBER 1.e-8f
template<typename To, typename From> To* Cast(From* p){ return static_cast<To*>(p); }

#define EditDefaultsOnly

// Slate's vertex, index and draw-element surface, declared far enough to parse.
// Nothing here draws; see Blueprint/UserWidget.h for why a stub that pretended
// to would be worse than one that does not.
using SlateIndex = uint32;
struct FSlateVertex { float Position[2] = {0.f, 0.f}; FColor Color; };
class FSlateResourceHandle { public: FSlateResourceHandle() {} };
struct FSlateDrawElement {
  template<typename... A> static void MakeCustomVerts(A&&...) {} };
template<typename T> struct TUniquePtr { T* p = nullptr;
  TUniquePtr(){} TUniquePtr(T* q):p(q){} ~TUniquePtr(){ delete p; }
  TUniquePtr(const TUniquePtr&) = delete; TUniquePtr& operator=(const TUniquePtr&) = delete;
  TUniquePtr(TUniquePtr&& o) noexcept : p(o.p) { o.p = nullptr; }
  TUniquePtr& operator=(TUniquePtr&& o) noexcept { delete p; p = o.p; o.p = nullptr; return *this; }
  TUniquePtr& operator=(T* q){ delete p; p = q; return *this; }
  T* Get() const { return p; } T* operator->() const { return p; }
  T& operator*() const { return *p; } bool IsValid() const { return p != nullptr; }
  void Reset(){ delete p; p = nullptr; } };
template<typename T, typename... A> TUniquePtr<T> MakeUnique(A&&... a) { return TUniquePtr<T>(new T(static_cast<A&&>(a)...)); }
template<typename T> void Swap(T& a, T& b) { T t = a; a = b; b = t; }
