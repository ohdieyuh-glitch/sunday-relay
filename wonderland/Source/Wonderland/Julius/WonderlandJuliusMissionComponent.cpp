#include "WonderlandJuliusMissionComponent.h"

#include "WonderlandJuliusMissionSubsystem.h"

UWonderlandJuliusMissionComponent::UWonderlandJuliusMissionComponent()
{
	PrimaryComponentTick.bCanEverTick = false;
}

UWonderlandJuliusMissionSubsystem* UWonderlandJuliusMissionComponent::Resolve() const
{
	const UWorld* World = GetWorld();
	if (World == nullptr) { return nullptr; }
	UGameInstance* Instance = World->GetGameInstance();
	if (Instance == nullptr) { return nullptr; }
	return Instance->GetSubsystem<UWonderlandJuliusMissionSubsystem>();
}

bool UWonderlandJuliusMissionComponent::StartMission(const FString& MissionId, const FString& PairId)
{
	UWonderlandJuliusMissionSubsystem* Session = Resolve();
	if (Session == nullptr) { return false; }
	return Session->DispatchMission(MissionId, PairId);
}

FString UWonderlandJuliusMissionComponent::GetPlayerLabel() const
{
	const UWonderlandJuliusMissionSubsystem* Session = Resolve();
	if (Session == nullptr) { return TEXT("no mission yet"); }
	return Session->PlayerLabel();
}

FString UWonderlandJuliusMissionComponent::GetUiStateToken() const
{
	const UWonderlandJuliusMissionSubsystem* Session = Resolve();
	if (Session == nullptr) { return TEXT("idle"); }
	return Session->UiStateToken();
}

FString UWonderlandJuliusMissionComponent::GetArtifactLabel() const
{
	const UWonderlandJuliusMissionSubsystem* Session = Resolve();
	if (Session == nullptr) { return FString(); }
	return Session->ArtifactLabel();
}

FString UWonderlandJuliusMissionComponent::GetServerRunId() const
{
	const UWonderlandJuliusMissionSubsystem* Session = Resolve();
	if (Session == nullptr) { return FString(); }
	return Session->ServerRunId();
}

bool UWonderlandJuliusMissionComponent::HasServerRunId() const
{
	const UWonderlandJuliusMissionSubsystem* Session = Resolve();
	return Session != nullptr && Session->HasServerRunId();
}
