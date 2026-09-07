// WONDERLAND — ENTERING. Two questions a single flag would confuse.
//
// Mirrors `WonderlandEntry` in
// src/relay/mission/wonderland/wonderland-entry.ts, field for field, and
// wonderland-cpp-parity.test.ts fails when the two drift in either direction.
//
// WHY TWO AXES AND NOT ONE BOOLEAN. The Relay Bridge exposes a real join route
// that really can succeed. A single `bEntered` set from that response would be
// TRUE while the person is still looking at the landing page — the request
// worked, the world admitted them, and nothing is on screen. A fact about a
// request reported as a fact about the world is the exact failure this whole
// repository is shaped to refuse.
//
//   ADMISSION     did the world let this person in? The bridge answers.
//   PRESENTATION  is something actually SHOWING it? A renderer answers, and
//                 only by claiming it — never by being asked.
//
// Being in Wonderland is Presentation == Presenting and nothing else.
//
// WHAT THE WORLD MODULE DOES WITH THIS. It is the receiving end: an Unreal
// client that has been handed a session confirms by reporting Presenting, and
// that confirmation is the ONLY thing that may set it. Nothing here computes
// its own arrival, because a renderer that decided it had arrived is a renderer
// that cannot report having failed to.

#pragma once

#include "CoreMinimal.h"
#include "WonderlandTypes.h"
#include "WonderlandEntry.generated.h"

/* ------------------------------------------------------------- admission */

// Mirrors WONDERLAND_ADMISSIONS. Did the world let this person in?
UENUM(BlueprintType)
enum class EWonderlandAdmission : uint8
{
	// Ordinal 0, and the honest default: a zero-filled struct has not been
	// admitted anywhere.
	NotRequested,
	// Asked, no answer yet. Announces NOTHING — this is not a soft yes.
	Requesting,
	// The bridge accepted and named a session.
	Admitted,
	// The bridge declined or could not be reached. Carries a reason.
	Refused
};

/* ---------------------------------------------------------- presentation */

// Mirrors WONDERLAND_PRESENTATIONS. Is anything actually showing the world?
UENUM(BlueprintType)
enum class EWonderlandPresentation : uint8
{
	// Ordinal 0 because it is both the safe default AND the true answer for
	// today's web build: no world client is delivered by it.
	NoRenderer,
	// Handed the session, has not confirmed. A request, not an arrival.
	Offered,
	// A renderer claimed it, and the claim held. The only state that means the
	// world is actually visible.
	Presenting,
	// Handed the session and could not show it.
	Failed
};

// Mirrors WONDERLAND_RENDERER_KINDS. HOW the world would be shown.
//
// The two differ in a way the product cares about: a pixel stream is the real
// Unreal world running somewhere else, and an embedded scene is the web build
// drawing an approximation. A person must never be shown the second while being
// told the first, so the kind travels with the offer and a surface can label it.
UENUM(BlueprintType)
enum class EWonderlandRendererKind : uint8
{
	// Ordinal 0. No renderer has said what it is. NOT a default of either kind:
	// a zero-filled offer that claimed to be the streamed Unreal world would be
	// describing an approximation as the real thing, and one that claimed to be
	// an embedded scene would understate a real stream. Absence is its own answer.
	Unobserved,
	UnrealPixelStream,
	EmbeddedScene
};

// Mirrors WonderlandRendererOffer. A renderer claiming it could show the world.
// A claim, not a capability — the confirmation is a separate step on purpose.
USTRUCT(BlueprintType)
struct FWonderlandRendererOffer
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	FString RendererId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	EWonderlandRendererKind Kind = EWonderlandRendererKind::Unobserved;

	// Shown to a person. Says what they would be looking at.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	FString Description;
};

/* ----------------------------------------------------------- the attempt */

// Mirrors WonderlandEntry. One person's attempt to enter one world.
USTRUCT(BlueprintType)
struct FWonderlandEntry
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	FString SchemaVersion;

	// An entry belongs to exactly one project. This is the identity boundary:
	// nothing about entering world A may move world B.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	FString ProjectId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	FString PlayerId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	EWonderlandAdmission Admission = EWonderlandAdmission::NotRequested;

	// A sentence whenever Admission is Refused. Never a bare flag.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	FWonderlandText AdmissionReason;

	// Named BY THE BRIDGE on admission. Never invented, never derived from a
	// player or project id — an entry that generated its own would be unable to
	// be left or resumed, and would look identical to one that had not.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	FWonderlandText SessionId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	FWonderlandText AdmittedAtIso;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	EWonderlandPresentation Presentation = EWonderlandPresentation::NoRenderer;

	// A sentence whenever nothing is presenting. Says which of the reasons.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	FWonderlandText PresentationReason;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	FWonderlandText RendererId;

	// Null until a renderer has been offered. Unobserved is that absence.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	EWonderlandRendererKind RendererKind = EWonderlandRendererKind::Unobserved;

	// Set only when a renderer CONFIRMED. The timestamp of the arrival.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	FWonderlandText PresentingSinceIso;

	// Attempts to show a world nobody had been admitted to.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	int64 UnadmittedPresentationsRefused = 0;

	// Claims from a renderer that was never handed the session — either a stale
	// message from a previous attempt, or a different renderer answering for one
	// that failed. A claim rather than a confirmation, and the word is chosen:
	// what arrives from a renderer is evidence Relay weighs, not a fact the world
	// gets to record on its own authority.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Entry")
	int64 UnofferedRendererClaimsRefused = 0;
};

/* ------------------------------------------------------------- resolvers */

// Is this person in Wonderland? Presenting and nothing else.
//
// Stated once, here, for the same reason the TypeScript states it once: every
// surface asks this question, and every surface answering it for itself is how
// one of them eventually decides that admitted is close enough.
WONDERLAND_API bool WonderlandEntryIsInside(const FWonderlandEntry& Entry);

// Whether asking to enter is worth doing right now. False while a request is in
// flight — a second join is a second presence — and false once admitted,
// because what is left to do then is render, not ask.
WONDERLAND_API bool WonderlandEntryMayRequest(const FWonderlandEntry& Entry);
