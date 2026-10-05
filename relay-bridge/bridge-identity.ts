import { randomBytes } from 'node:crypto';

import { isProductionDeployment } from './deployment-environment';

/**
 * WHICH BUILD IS ANSWERING, AND WHICH START OF IT.
 *
 * Final R16 needs the backend on accepted main, and a real restart between its
 * two phases. Neither could be read from outside: the hosted bridge said
 * nothing about the commit it was built from, and nothing told one start of the
 * process from the next, so a "restart" was whatever the operator said it was.
 * This answers both, as facts, to the operator only (the Wonderland readiness
 * route):
 *   - THE COMMIT THE PLATFORM SAYS IT DEPLOYED. `RAILWAY_GIT_COMMIT_SHA` is set
 *     by Railway on a deployment it built from GitHub. Nothing else is believed:
 *     not the code (it cannot know), not a checkout (a deployed bundle has
 *     none), not a variable an operator chose. Absent or malformed, the commit
 *     is null, which renders Unknown.
 *   - WHETHER THE PROCESS TAKES THE PRODUCTION BRANCH of every gate
 *     (`isProductionDeployment`, the same one-way markers the trusted-origin
 *     gate reads). A final run exercises the gates players will meet.
 *   - A BOOT: an id drawn at random when the server is created, and when.
 *     Two reads with different ids came from two starts; the same id, from one.
 */

export const BRIDGE_COMMIT_ATTESTATION = 'RAILWAY_GIT_COMMIT_SHA' as const;

export interface BridgeBoot {
  /** 128 random bits, hex, drawn when the server was created. */
  readonly bootId: string;
  /** When the server was created, ISO. */
  readonly startedAt: string;
}

export interface BridgeIdentity extends BridgeBoot {
  /** The full commit the platform says it deployed, lower-case hex, or null: Unknown. */
  readonly commit: string | null;
  /** The variable that attested it, or null when nothing did. */
  readonly attestedBy: typeof BRIDGE_COMMIT_ATTESTATION | null;
  /** Whether this process takes the production branch of every gate. */
  readonly production: boolean;
}

export function createBridgeBoot(now: Date = new Date()): BridgeBoot {
  return Object.freeze({ bootId: randomBytes(16).toString('hex'), startedAt: now.toISOString() });
}

export function readBridgeIdentity(env: Readonly<Record<string, string | undefined>>, boot: BridgeBoot): BridgeIdentity {
  const stated = (env[BRIDGE_COMMIT_ATTESTATION] ?? '').trim().toLowerCase();
  const commit = /^[0-9a-f]{40}$/u.test(stated) ? stated : null;
  return Object.freeze({
    commit,
    attestedBy: commit === null ? null : BRIDGE_COMMIT_ATTESTATION,
    production: isProductionDeployment(env),
    bootId: boot.bootId,
    startedAt: boot.startedAt,
  });
}
