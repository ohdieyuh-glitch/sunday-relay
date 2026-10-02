// WONDERLAND SOCIAL — where the desktop client's social views come from.
//
// ONE INTERFACE, TWO SOURCES. Surfaces ask an IWonderlandSocialService and never know which is behind it:
//   - FWonderlandSocialPreviewService: the DEVELOPMENT PREVIEW the authority generated (UiArt/Social/social-preview.json).
//     Read-only: every action is refused with the reason, and every surface says DEVELOPMENT PREVIEW.
//   - (later) a Relay Bridge service over the native session's `social` capability, once the founder deploys it after RC8.
// Neither decides privacy. See WonderlandSocialTypes.h.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandSocialTypes.h"

class FJsonObject;

DECLARE_MULTICAST_DELEGATE(FOnWonderlandSocialChanged);

/** The answer to an action a surface asked for. Refusals carry the reason a person can read. */
struct FWonderlandSocialActionResult
{
	bool bOk = false;
	FString Reason;
	/** Asked of a server: the answer arrives later through OnAnswered. */
	bool bPending = false;
};

/** A server's answer to an action asked earlier: (operation, subject, answer). */
DECLARE_MULTICAST_DELEGATE_ThreeParams(FOnWonderlandSocialAnswered, const FString& /*OperationId*/, const FString& /*SubjectId*/, const FWonderlandSocialActionResult& /*Answer*/);

class WONDERLAND_API IWonderlandSocialService
{
public:
	virtual ~IWonderlandSocialService() = default;

	virtual const FWonderlandSocialSnapshot& GetSnapshot() const = 0;
	/** Where the views come from, in one line a surface can show ("DEVELOPMENT PREVIEW · synthetic people …"). */
	virtual FString GetSourceLine() const = 0;
	virtual bool IsDevelopmentPreview() const = 0;
	/** Why the service has nothing, if it has nothing. Empty when it is healthy. */
	virtual FString GetLastError() const = 0;

	/** A social action by id (the operation ids of the `social` capability, e.g. "messages.send"). */
	virtual FWonderlandSocialActionResult Request(const FString& OperationId, const FString& SubjectId) = 0;
	/** "messages.send": a message into a conversation. Its own call because it carries a body. */
	virtual FWonderlandSocialActionResult SendMessage(const FString& ConversationId, const FString& Body) = 0;

	FOnWonderlandSocialChanged& OnChanged() { return Changed; }
	FOnWonderlandSocialAnswered& OnAnswered() { return Answered; }

protected:
	FOnWonderlandSocialChanged Changed;
	FOnWonderlandSocialAnswered Answered;
};

/** The generated preview, read-only. */
class WONDERLAND_API FWonderlandSocialPreviewService final : public IWonderlandSocialService
{
public:
	/** Load and validate the file. False (with GetLastError) on anything not exactly a social preview. */
	bool Load(const FString& Path);

	virtual const FWonderlandSocialSnapshot& GetSnapshot() const override { return Snapshot; }
	virtual FString GetSourceLine() const override;
	virtual bool IsDevelopmentPreview() const override { return true; }
	virtual FString GetLastError() const override { return LastError; }
	virtual FWonderlandSocialActionResult Request(const FString& OperationId, const FString& SubjectId) override;
	virtual FWonderlandSocialActionResult SendMessage(const FString& ConversationId, const FString& Body) override;

	/** The file's place in a package or an editor: <ProjectDir>/UiArt/Social/social-preview.json. */
	static FString DefaultPath();
	/** A preview scene's file: "party" (the viewer in a party) or anything else for the default. */
	static FString ScenePath(const FString& Scene);

private:
	FWonderlandSocialSnapshot Snapshot;
	FString LastError;
};

/** Strict parse of the preview (schema, the preview flag, every required field). Exposed for QA. */
WONDERLAND_API bool WonderlandParseSocialPreview(const TSharedPtr<FJsonObject>& Json, FWonderlandSocialSnapshot& Out, FString& OutProblem);
/** The same parse for either source: a preview (relay-wonderland-social-preview.v1, flagged) or a live view
 *  (relay-wonderland-social-view.v1, never flagged). Anything claiming to be the other is refused. */
WONDERLAND_API bool WonderlandParseSocialView(const TSharedPtr<FJsonObject>& Json, bool bExpectPreview, FWonderlandSocialSnapshot& Out, FString& OutProblem);
