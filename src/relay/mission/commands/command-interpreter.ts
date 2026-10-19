/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * Command interpreter boundary.
 *
 * Interpretation turns natural language into a TYPED COMMAND DRAFT — it never
 * validates, never calculates final risk, and never mutates anything. The
 * deterministic implementation (deterministic-command-interpreter.ts) is the
 * only one in this milestone; a future model-backed interpreter plugs in
 * behind this same interface and gains no additional authority: whatever an
 * interpreter emits still passes the full validation pipeline and the atomic
 * executor before any state changes.
 */

import type { RelayMissionCommandContext } from './command-context';
import type { RelayMissionCommandDraft } from './command-types';

/** A natural-language request AS RECEIVED. Never trusted, never applied. */
export interface RelayMissionCommandNaturalRequest {
  requestId: string;
  projectId: string;
  missionId: string;
  issuedByUserId: string;
  issuedAt: string;
  text: string;
}

export type RelayMissionCommandInterpretationResult =
  | {
      kind: 'interpreted';
      commandDraft: RelayMissionCommandDraft;
      /** The deterministic interpreter never claims model-grade confidence. */
      confidence: 'deterministic';
    }
  | {
      kind: 'clarification_required';
      reason: string;
      missingInformation: string[];
    }
  | {
      kind: 'rejected';
      reason: string;
    };

export interface RelayMissionCommandInterpreter {
  interpret(
    request: RelayMissionCommandNaturalRequest,
    context: RelayMissionCommandContext,
  ): RelayMissionCommandInterpretationResult;
}
