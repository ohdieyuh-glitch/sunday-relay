// WONDERLAND -- companion UE adapter seam. NOT COMPILED: there is no Unreal toolchain on the box where this was written.
// Every Unreal API named here is UNVERIFIED against the project's engine version and must be checked in the editor.
// Build.cs: #433's Wonderland.Build.cs (blob bc070d53e2e7) already lists "HTTP", "UMG", "Slate", "SlateCore", "Json" and
// (private) "PlatformCrypto", "PlatformCryptoTypes", "PlatformCryptoContext"; this file depends on #433 for that and for
// Julius/WonderlandJuliusRandomBytes.h. No UMG widget asset exists for it yet.
//
// RULES (all enforced by the pure core WonderlandCompanionLogic, which this file only feeds):
//   - BYOAI only. The only server this talks to is the loopback relay origin it is given; there is no i.Wonder key,
//     no provider URL and no fallback anywhere in this file.
//   - The API key goes from the masked field to ONE FKeyHandoff request and is wiped. This adapter never copies it
//     into an FString, a log line, a widget, a save game or a config value. UE_LOG calls print trace words only.
//   - Idempotency keys come from the J1 random path: #433's FWonderlandJuliusPlatformCryptoRandom (IPlatformCrypto
//     CreateRandomBytes, no fallback) -> FIdempotencyKeyMinter -> canonical lowercase UUIDv4. Never FGuid::NewGuid
//     (FGuid is not a v4 UUID by construction). A failed source sends nothing (ApplyKeyMintFailure).
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Interfaces/IHttpRequest.h"
#include "WonderlandCompanionLogic.h"
#include "Wonderland/Julius/WonderlandJuliusRandomBytes.h"
#include "WonderlandCompanionClient.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnWonderlandCompanionViewChanged);

UCLASS()
class UWonderlandCompanionClient : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/**
	 * Q9: pass the SAME configured relay base URL the J1 dispatch path (#433) uses; there is no discovery. Only a strict
	 * loopback origin (http://127.0.0.1:<port> or http://[::1]:<port>, one trailing '/' allowed) is used: "localhost",
	 * which #433 accepts, keeps the companion Offline.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void Start(const FString& J1RelayBaseUrl);

	/** Masked key entry: the widget forwards key presses here; it never holds the text itself. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void KeyFieldAppend(const FString& Typed);
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void KeyFieldBackspace();
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	FString KeyFieldMask() const;
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void ConnectKey();
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void Disconnect();

	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void SendMessage(const FString& Message, const FString& WljRunIdOrEmpty);
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void Resend();
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void DeleteHistory();

	/** View for the terminal widget: state, server label (verbatim), status line, partial reply, banner flags. */
	const WonderlandCompanionLogic::FCompanionView& GetView() const { return Session->View(); }
	const WonderlandCompanionLogic::FTurnHistory& GetHistory() const { return Session->History(); }

	UPROPERTY(BlueprintAssignable, Category = "Wonderland|Companion")
	FOnWonderlandCompanionViewChanged OnViewChanged;

private:
	void Issue(const WonderlandCompanionLogic::FRelayRequest& Request, TFunction<void(int32, const FString&, const TArray<uint8>&)> OnDone);
	void StartChatRequest(const WonderlandCompanionLogic::FRelayRequest& Request);
	/** Empty when the random source failed or repeated; the session has then been told (ApplyKeyMintFailure). */
	FString NewIdempotencyKey();
	uint64 NowMs() const;
	void Changed();

	TUniquePtr<WonderlandCompanionLogic::FOpenAiCompanionSession> Session;
	WonderlandCompanionLogic::FMaskedKeyField KeyField;
	FWonderlandJuliusPlatformCryptoRandom Random;
	WonderlandCompanionLogic::FIdempotencyKeyMinter KeyMinter;
	TSharedPtr<IHttpRequest, ESPMode::ThreadSafe> ChatRequest;
};
