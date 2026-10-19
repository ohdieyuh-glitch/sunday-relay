/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * Deterministic command interpreter — exact/pattern FIXTURES, never a model.
 *
 * This implementation supports a documented set of representative phrasings
 * and refuses everything else. It does not pretend to understand arbitrary
 * language: an unmatched request is REJECTED, and a request whose targets
 * cannot be resolved deterministically (pronouns, missing entities, several
 * candidates) asks for CLARIFICATION instead of guessing.
 *
 * Nothing here mutates state. The emitted draft records the mission/task
 * revisions and current entity states it was based on, so the validator and
 * executor can refuse stale drafts. Zero provider calls, zero network, zero
 * process control.
 */

import { redactTerminalText } from '../terminal';
import type {
  CommandAgentContext,
  CommandTaskContext,
  RelayMissionCommandContext,
} from './command-context';
import { findActiveRunForTask } from './command-context';
import type {
  RelayMissionCommandInterpretationResult,
  RelayMissionCommandInterpreter,
  RelayMissionCommandNaturalRequest,
} from './command-interpreter';
import type {
  RelayMissionCommandDraft,
  RelayMissionCommandIntent,
  RelayStateChange,
} from './command-types';

/* -------------------------------------------------------------- helpers */

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?]+$/u, '').replace(/\s+/gu, ' ');
}

const AGENT_TOKENS: Record<string, string[]> = {
  claude_code: ['claude code', 'claude'],
  codex: ['codex'],
  hermes: ['hermes'],
};

function resolveAgent(
  context: RelayMissionCommandContext,
  token: string,
): { agent?: CommandAgentContext; ambiguous?: boolean } {
  const t = normalize(token);
  const matches = context.agents.filter((a) => {
    const aliases = AGENT_TOKENS[a.agentType] ?? [];
    return (
      a.agentId.toLowerCase() === t ||
      a.displayName.toLowerCase() === t ||
      aliases.includes(t)
    );
  });
  if (matches.length === 1) return { agent: matches[0] };
  if (matches.length > 1) {
    /* Several sessions/records of one alias: the agent actually ENGAGED in
       the mission is the deterministic referent; anything else stays
       ambiguous rather than guessed. */
    const engaged = matches.filter((a) => a.rolesInMission.length > 0);
    if (engaged.length === 1) return { agent: engaged[0] };
    return { ambiguous: true };
  }
  return {};
}

function stripTaskNoise(fragment: string): string {
  return normalize(fragment).replace(/^the /u, '').replace(/ task$/u, '');
}

function resolveTasks(
  context: RelayMissionCommandContext,
  fragment: string,
): CommandTaskContext[] {
  const frag = stripTaskNoise(fragment);
  const byFull = context.tasks.filter(
    (t) => t.taskId.toLowerCase().includes(frag) || t.title.toLowerCase().includes(frag),
  );
  if (byFull.length > 0) return byFull;
  const first = frag.split(' ')[0];
  if (!first || first === frag) return [];
  return context.tasks.filter(
    (t) => t.taskId.toLowerCase().includes(first) || t.title.toLowerCase().includes(first),
  );
}

function clarify(reason: string, missing: string[]): RelayMissionCommandInterpretationResult {
  return { kind: 'clarification_required', reason, missingInformation: missing };
}

/* --------------------------------------------------------- interpreter */

export class DeterministicCommandInterpreter implements RelayMissionCommandInterpreter {
  interpret(
    request: RelayMissionCommandNaturalRequest,
    context: RelayMissionCommandContext,
  ): RelayMissionCommandInterpretationResult {
    const text = normalize(request.text);
    let changeCount = 0;
    const changeId = (): string => {
      changeCount += 1;
      return `${request.requestId}-chg-${changeCount}`;
    };

    const draft = (
      intent: RelayMissionCommandIntent,
      init: Partial<
        Pick<
          RelayMissionCommandDraft,
          'secondaryIntents' | 'targetTaskIds' | 'targetAgentIds' | 'interpretedChanges'
        >
      >,
    ): RelayMissionCommandInterpretationResult => {
      const targetTaskIds = init.targetTaskIds ?? [];
      const taskRevisions: Record<string, number> = {};
      for (const id of targetTaskIds) {
        const task = context.tasks.find((t) => t.taskId === id);
        if (task) taskRevisions[id] = task.taskRevision;
      }
      return {
        kind: 'interpreted',
        confidence: 'deterministic',
        commandDraft: {
          projectId: request.projectId,
          missionId: request.missionId,
          issuedByUserId: request.issuedByUserId,
          issuedAt: request.issuedAt,
          naturalLanguageRequest: redactTerminalText(request.text).text,
          intent,
          secondaryIntents: init.secondaryIntents ?? [],
          targetTaskIds,
          targetAgentIds: init.targetAgentIds ?? [],
          interpretedChanges: init.interpretedChanges ?? [],
          missionRevision: context.mission.missionRevision,
          taskRevisions,
        },
      };
    };

    const cancelRunChanges = (agent: CommandAgentContext): {
      changes: RelayStateChange[];
      taskIds: string[];
    } | null => {
      const run = context.agentRuns.find(
        (r) =>
          r.actualAgentId === agent.agentId &&
          (r.state === 'starting' || r.state === 'running' || r.state === 'waiting'),
      );
      if (!run) return null;
      const task = context.tasks.find((t) => t.taskId === run.taskId);
      if (!task) return null;
      const changes: RelayStateChange[] = [
        {
          changeId: changeId(),
          entityType: 'agent_run',
          entityId: run.runId,
          previousState: run.state,
          requestedState: 'cancelled',
          reason: `stop the active ${agent.displayName} run`,
        },
        {
          changeId: changeId(),
          entityType: 'task',
          entityId: task.taskId,
          previousState: task.status.executionStatus,
          requestedState: 'cancelled',
          reason: `cancel task execution owned by ${agent.displayName}`,
          statusDimension: 'execution',
          expectedRevision: task.taskRevision,
        },
      ];
      const activeReview = context.reviews.find(
        (r) =>
          r.taskId === task.taskId &&
          r.reviewerAgentId === agent.agentId &&
          r.status === 'in_progress',
      );
      if (activeReview) {
        changes.push({
          changeId: changeId(),
          entityType: 'review',
          entityId: activeReview.reviewId,
          previousState: activeReview.status,
          requestedState: 'incomplete',
          reason: 'the active review stops before completion; confirmed partial findings are preserved',
        });
      }
      return { changes, taskIds: [task.taskId] };
    };

    /* -- compound: stop <reviewer> and have <agent> repair <topic> -- */
    let m = text.match(
      /^stop (?<agentA>[a-z0-9 _-]+?) and (?:have|let) (?<agentB>[a-z0-9 _-]+?) (?:repair|fix) (?:the )?(?<topic>.+?)(?: problem| issue| defect)?$/u,
    );
    if (m?.groups) {
      const a = resolveAgent(context, m.groups.agentA);
      const b = resolveAgent(context, m.groups.agentB);
      if (!a.agent || !b.agent) {
        return clarify('the named agents cannot be deterministically resolved', [
          ...(a.agent ? [] : [`agent "${m.groups.agentA}" not present in mission context`]),
          ...(b.agent ? [] : [`agent "${m.groups.agentB}" not present in mission context`]),
        ]);
      }
      const stop = cancelRunChanges(a.agent);
      if (!stop) {
        return clarify(`${a.agent.displayName} has no active run to stop`, [
          `active run for ${a.agent.displayName}`,
        ]);
      }
      const topic = stripTaskNoise(m.groups.topic);
      const repairTask = context.tasks.find(
        (t) =>
          t.responsibility === 'repair' &&
          (t.taskId.toLowerCase().includes(topic.split(' ')[0]) ||
            t.title.toLowerCase().includes(topic)),
      );
      if (!repairTask) {
        return clarify(`no repair task matches "${m.groups.topic}"`, [
          `repair task for ${m.groups.topic}`,
        ]);
      }
      const changes = [
        ...stop.changes,
        {
          changeId: changeId(),
          entityType: 'task' as const,
          entityId: repairTask.taskId,
          previousState: `owner:${repairTask.ownerAgentId ?? 'none'}`,
          requestedState: `owner:${b.agent.agentId}`,
          reason: `assign ${b.agent.displayName} as repair implementer`,
          expectedRevision: repairTask.taskRevision,
        },
      ];
      return draft('reassign', {
        secondaryIntents: ['cancel'],
        targetTaskIds: [...stop.taskIds, repairTask.taskId],
        targetAgentIds: [a.agent.agentId, b.agent.agentId],
        interpretedChanges: changes,
      });
    }

    /* -------------------- stop <agent> -------------------- */
    m = text.match(/^stop (?<agent>[a-z0-9 _-]+)$/u);
    if (m?.groups && resolveAgent(context, m.groups.agent).agent) {
      const agent = resolveAgent(context, m.groups.agent).agent as CommandAgentContext;
      const stop = cancelRunChanges(agent);
      if (!stop) {
        return clarify(`${agent.displayName} has no active run to stop`, [
          `active run for ${agent.displayName}`,
        ]);
      }
      return draft('cancel', {
        targetTaskIds: stop.taskIds,
        targetAgentIds: [agent.agentId],
        interpretedChanges: stop.changes,
      });
    }

    /* ------------------- pause <task|mission> ------------------- */
    m = text.match(/^pause (?<subject>.+)$/u);
    if (m?.groups) {
      const subject = stripTaskNoise(m.groups.subject);
      const targets =
        subject === 'mission'
          ? context.tasks.filter((t) => t.status.executionStatus === 'running')
          : resolveTasks(context, subject);
      if (targets.length === 0) {
        return clarify(`no task deterministically matches "${m.groups.subject}"`, [
          'target task',
        ]);
      }
      if (subject !== 'mission' && targets.length > 1) {
        return clarify(`several tasks match "${m.groups.subject}"`, [
          `one of: ${targets.map((t) => t.taskId).join(', ')}`,
        ]);
      }
      return draft('pause', {
        targetTaskIds: targets.map((t) => t.taskId),
        interpretedChanges: targets.map((t) => ({
          changeId: changeId(),
          entityType: 'task' as const,
          entityId: t.taskId,
          previousState: t.status.executionStatus,
          requestedState: 'waiting',
          reason: 'pause requested by the user',
          statusDimension: 'execution' as const,
          expectedRevision: t.taskRevision,
        })),
      });
    }

    /* ------------------- resume <task|mission> ------------------- */
    m = text.match(/^resume (?<subject>.+)$/u);
    if (m?.groups) {
      const subject = stripTaskNoise(m.groups.subject);
      let targets: CommandTaskContext[];
      if (subject === 'mission') {
        targets = context.tasks.filter((t) => t.status.executionStatus === 'waiting');
        if (targets.length !== 1) {
          return clarify('resume the mission is ambiguous — name the waiting task', [
            'target task',
          ]);
        }
      } else {
        targets = resolveTasks(context, subject);
        if (targets.length !== 1) {
          return clarify(`no single task deterministically matches "${m.groups.subject}"`, [
            'target task',
          ]);
        }
      }
      const task = targets[0];
      return draft('resume', {
        targetTaskIds: [task.taskId],
        interpretedChanges: [
          {
            changeId: changeId(),
            entityType: 'task',
            entityId: task.taskId,
            previousState: task.status.executionStatus,
            requestedState: 'running',
            reason: 'resume requested by the user',
            statusDimension: 'execution',
            expectedRevision: task.taskRevision,
          },
        ],
      });
    }

    /* ----------------------- cancel <task> ----------------------- */
    m = text.match(/^cancel (?<subject>.+)$/u);
    if (m?.groups) {
      const targets = resolveTasks(context, m.groups.subject);
      if (targets.length !== 1) {
        return clarify(`no single task deterministically matches "${m.groups.subject}"`, [
          'target task',
        ]);
      }
      const task = targets[0];
      const changes: RelayStateChange[] = [];
      const run = findActiveRunForTask(context, task.taskId);
      if (run) {
        changes.push({
          changeId: changeId(),
          entityType: 'agent_run',
          entityId: run.runId,
          previousState: run.state,
          requestedState: 'cancelled',
          reason: 'cancel the active run',
        });
      }
      changes.push({
        changeId: changeId(),
        entityType: 'task',
        entityId: task.taskId,
        previousState: task.status.executionStatus,
        requestedState: 'cancelled',
        reason: 'cancellation requested by the user',
        statusDimension: 'execution',
        expectedRevision: task.taskRevision,
      });
      return draft('cancel', { targetTaskIds: [task.taskId], interpretedChanges: changes });
    }

    /* --------------------- approve the repair --------------------- */
    if (/^approve the repair$/u.test(text)) {
      const completed = context.reviews.filter((r) => r.status === 'completed');
      const review = completed[completed.length - 1];
      if (!review) {
        return clarify('no completed review exists to approve from', ['completed review']);
      }
      const task = context.tasks.find((t) => t.taskId === review.taskId);
      if (!task) return clarify('the reviewed task is not in the mission context', ['target task']);
      return draft('approve', {
        targetTaskIds: [task.taskId],
        interpretedChanges: [
          {
            changeId: changeId(),
            entityType: 'task',
            entityId: task.taskId,
            previousState: task.status.verificationStatus,
            requestedState: 'approved',
            reason: `approve based on review ${review.reviewId}`,
            statusDimension: 'verification',
            expectedRevision: task.taskRevision,
          },
        ],
      });
    }

    /* ------------------- reject this implementation ------------------- */
    if (/^reject (?:this|the) implementation$/u.test(text)) {
      const task = context.tasks.find((t) => t.status.verificationStatus === 'reviewing');
      if (!task) {
        return clarify('no task is currently under review to reject', ['target task']);
      }
      return draft('reject', {
        targetTaskIds: [task.taskId],
        interpretedChanges: [
          {
            changeId: changeId(),
            entityType: 'task',
            entityId: task.taskId,
            previousState: task.status.verificationStatus,
            requestedState: 'changes_required',
            reason: 'implementation rejected by the user',
            statusDimension: 'verification',
            expectedRevision: task.taskRevision,
          },
        ],
      });
    }

    /* ------------------- allow production writes ------------------- */
    if (/^(?:allow|permit) production writes$/u.test(text)) {
      const implementer = context.agents.find((a) => a.rolesInMission.includes('implementer'));
      if (!implementer) {
        return clarify('no implementer agent exists to grant production writes to', [
          'target agent',
        ]);
      }
      const prev = implementer.passport.permissions.productionAccess ? 'allowed' : 'prohibited';
      return draft('change_permissions', {
        targetAgentIds: [implementer.agentId],
        interpretedChanges: [
          {
            changeId: changeId(),
            entityType: 'permission',
            entityId: implementer.agentId,
            previousState: `production_writes:${prev}`,
            requestedState: 'production_writes:allowed',
            reason: 'user requested production write access',
          },
        ],
      });
    }

    /* ---------- continue, but prohibit production changes ---------- */
    if (/^continue,? but (?:prohibit|forbid) production (?:changes|writes)$/u.test(text)) {
      const implementer = context.agents.find((a) => a.rolesInMission.includes('implementer'));
      if (!implementer) {
        return clarify('no implementer agent exists whose permissions could be narrowed', [
          'target agent',
        ]);
      }
      const prev = implementer.passport.permissions.productionAccess ? 'allowed' : 'prohibited';
      return draft('change_permissions', {
        targetAgentIds: [implementer.agentId],
        interpretedChanges: [
          {
            changeId: changeId(),
            entityType: 'permission',
            entityId: implementer.agentId,
            previousState: `production_writes:${prev}`,
            requestedState: 'production_writes:prohibited',
            reason: 'user narrowed permissions: production changes prohibited',
          },
        ],
      });
    }

    /* --------------------- increase the budget --------------------- */
    m = text.match(/^increase the (?:repair )?budget(?: to \$?(?<amount>\d+(?:\.\d+)?))?$/u);
    if (m?.groups) {
      if (!m.groups.amount) {
        return clarify('the budget increase has no target amount', ['target budget amount']);
      }
      const current = context.mission.budget.maximumSpendUsd;
      return draft('change_budget', {
        interpretedChanges: [
          {
            changeId: changeId(),
            entityType: 'budget',
            entityId: 'mission-budget',
            previousState: `max_usd:${current ?? 'none'}`,
            requestedState: `max_usd:${m.groups.amount}`,
            reason: 'user requested a budget increase',
          },
        ],
      });
    }

    /* ---------- escalate this finding to the project leader ---------- */
    if (/^escalate this finding to the project leader$/u.test(text)) {
      const holders = context.tasks.filter((t) => t.unresolvedFindingIds.length > 0);
      const findings = holders.flatMap((t) => t.unresolvedFindingIds);
      if (findings.length !== 1) {
        return clarify(
          findings.length === 0
            ? 'no unresolved finding exists to escalate'
            : 'several unresolved findings exist — name the finding',
          ['finding id'],
        );
      }
      return draft('escalate', {
        targetTaskIds: [holders[0].taskId],
        interpretedChanges: [
          {
            changeId: changeId(),
            entityType: 'mission',
            entityId: context.mission.missionId,
            previousState: `escalation:${context.mission.annotations.escalation ?? 'none'}`,
            requestedState: 'escalation:project_leader',
            reason: `escalate finding ${findings[0]} to the project leader`,
          },
        ],
      });
    }

    /* ---------------- move/reassign <task> to <agent> ---------------- */
    m = text.match(/^(?:move|reassign) (?<subject>.+?) to (?<agent>.+)$/u);
    if (m?.groups) {
      if (/^(?:another agent|the other one|someone else)$/u.test(normalize(m.groups.agent))) {
        return clarify('the replacement agent is unspecified', ['replacement agent']);
      }
      const agentRes = resolveAgent(context, m.groups.agent);
      const targets = resolveTasks(context, m.groups.subject);
      if (!agentRes.agent || targets.length !== 1) {
        return clarify('reassignment target cannot be deterministically resolved', [
          ...(targets.length === 1 ? [] : ['target task']),
          ...(agentRes.agent ? [] : ['replacement agent']),
        ]);
      }
      const task = targets[0];
      return draft('reassign', {
        targetTaskIds: [task.taskId],
        targetAgentIds: [agentRes.agent.agentId],
        interpretedChanges: [
          {
            changeId: changeId(),
            entityType: 'task',
            entityId: task.taskId,
            previousState: `owner:${task.ownerAgentId ?? 'none'}`,
            requestedState: `owner:${agentRes.agent.agentId}`,
            reason: `reassign ${task.taskId} to ${agentRes.agent.displayName}`,
            expectedRevision: task.taskRevision,
          },
        ],
      });
    }

    /* --------------- redirect the output of <a> to <b> --------------- */
    m = text.match(/^redirect (?:the )?output of (?<a>.+?) to (?<b>.+)$/u);
    if (m?.groups) {
      const a = resolveTasks(context, m.groups.a);
      const b = resolveTasks(context, m.groups.b);
      if (a.length !== 1 || b.length !== 1) {
        return clarify('redirect endpoints cannot be deterministically resolved', [
          ...(a.length === 1 ? [] : ['source task']),
          ...(b.length === 1 ? [] : ['destination task']),
        ]);
      }
      return draft('redirect', {
        targetTaskIds: [a[0].taskId],
        interpretedChanges: [
          {
            changeId: changeId(),
            entityType: 'task',
            entityId: a[0].taskId,
            previousState: `output_target:${a[0].outputTarget}`,
            requestedState: `output_target:${b[0].taskId}`,
            reason: `redirect ${a[0].taskId} output to ${b[0].taskId}`,
            expectedRevision: a[0].taskRevision,
          },
        ],
      });
    }

    /* ------------------------ retry <task> ------------------------ */
    m = text.match(/^retry (?<subject>.+)$/u);
    if (m?.groups) {
      const targets = resolveTasks(context, m.groups.subject);
      if (targets.length !== 1) {
        return clarify(`no single task deterministically matches "${m.groups.subject}"`, [
          'target task',
        ]);
      }
      const failedRun = context.agentRuns.find(
        (r) => r.taskId === targets[0].taskId && r.state === 'failed',
      );
      if (!failedRun) {
        return clarify(`${targets[0].taskId} has no failed run to retry`, ['failed run']);
      }
      return draft('retry', {
        targetTaskIds: [targets[0].taskId],
        interpretedChanges: [
          {
            changeId: changeId(),
            entityType: 'agent_run',
            entityId: failedRun.runId,
            previousState: 'failed',
            requestedState: 'retry_requested',
            reason: 'user requested a retry of the failed run',
          },
        ],
      });
    }

    /* ---------------------- start the mission ---------------------- */
    if (/^start the mission$/u.test(text)) {
      return draft('start', {
        interpretedChanges: [
          {
            changeId: changeId(),
            entityType: 'mission',
            entityId: context.mission.missionId,
            previousState: context.mission.status.executionStatus,
            requestedState: 'starting',
            reason: 'start requested by the user',
            statusDimension: 'execution',
          },
        ],
      });
    }

    /* ------------------ set <task> priority to <n> ------------------ */
    m = text.match(/^set (?<subject>.+?) priority to (?<priority>\d+)$/u);
    if (m?.groups) {
      const targets = resolveTasks(context, m.groups.subject);
      if (targets.length !== 1) {
        return clarify(`no single task deterministically matches "${m.groups.subject}"`, [
          'target task',
        ]);
      }
      const task = targets[0];
      return draft('change_priority', {
        targetTaskIds: [task.taskId],
        interpretedChanges: [
          {
            changeId: changeId(),
            entityType: 'task',
            entityId: task.taskId,
            previousState: `priority:${task.priority}`,
            requestedState: `priority:${m.groups.priority}`,
            reason: 'priority change requested by the user',
            expectedRevision: task.taskRevision,
          },
        ],
      });
    }

    /* -------------------- unresolvable pronouns -------------------- */
    if (/\b(?:it|them|this one|that one|the other one)\b/u.test(text)) {
      return clarify('the request uses pronouns Relay cannot deterministically resolve', [
        'target task',
        'current agent',
        'replacement agent',
      ]);
    }

    /* --------------------------- fallback --------------------------- */
    return {
      kind: 'rejected',
      reason:
        'not a recognized deterministic command pattern — the deterministic interpreter only supports its documented fixtures and never guesses',
    };
  }
}
