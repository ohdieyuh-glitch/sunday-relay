# Relay Execution Attestation (Prompt 8.1)

> An immutable projection that separates the agent Relay REQUESTED from the
> agent that ACTUALLY ran, so Relay can prove — not assume — which agent did
> the work. Implemented in `src/relay/mission/attestation.ts` (pure,
> browser-safe). CLI: `/attestation`.

## Shape (RelayExecutionAttestation)

`attestationId · projectId · missionId · taskId · requestedAgentId/Type/Role
· actualAgentId/Type/Role · adapterId · adapterVersion · runtimeVersion ·
modelVersion · runId · externalSessionId · workspaceId · policyReference ·
startedAt · finishedAt · launchRequested · launchVerified ·
completionSignalReceived · workspaceInspectionCompleted ·
verificationCompleted · fallbackOccurred · fallbackAgentId · fallbackReason ·
outputDigest · activityDigest · evidenceIds[] · provenance · immutable(true)`

The returned object is `Object.freeze`d.

## Rules

- **Requested ≠ actual.** Both identities are recorded separately.
- **A request is not proof.** `launchRequested` alone proves nothing.
- **A start is not success.** `attestsSuccessfulExecution` requires
  `launchRequested && launchVerified && completionSignalReceived`.
- **A failed launch cannot satisfy required execution.**
- **Fallbacks are always visible**, must be policy-authorized (an
  unauthorized fallback fails to attest), and may **never inherit the
  requested agent's identity** (rejected).
- **No "Reviewed by Codex" without a Codex attestation** —
  `hasAttestedExecutionBy(list, agentId, role)` gates identity-sensitive
  credit; the mission verdict requires the reviewer attestation when the
  completion rule requires independent review.
- **Provenance is truthful:** simulated executions get `simulated`; live
  Claude execution gets `live`. The caller derives provenance from the
  adapter descriptor's provenance — a simulated run never yields a live
  attestation.

## Live-Claude capability (no new provider call)

The Prompt-8 live Claude fixture produces its evidence (session id, launch
verified, workspace inspection, Relay verification) from which a `live`
attestation is built by feeding those execution facts to
`buildExecutionAttestation`. Prompt 8.1 exercises this path with synthetic
live facts in tests — it does NOT make another live Claude call.

## Security

No credential value, raw stream, hidden reasoning, private system prompt, or
authentication data ever enters an attestation. Digests are pure,
deterministic hashes over already-safe bounded summaries — never over
secrets. No credential-shaped fields exist (boundary-tested).

## Known limitations

Volatile (no durable attestation store); `policyReference`/passport wiring
is post-YC. See COMPETITIVE_FEATURE_COVERAGE.md #9.
