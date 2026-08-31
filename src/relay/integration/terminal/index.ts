export {
  JULIUS_EVENT_ACTORS,
  JULIUS_EVENT_PORT_VERSION,
  TERMINAL_ROLE_LABELS,
  actorForWorkerSlot,
  type JuliusEventActor,
  type JuliusEventFact,
  type JuliusEventSource,
  type JuliusOperationalEvent,
} from './julius-event-port';

export {
  containsPrivateReasoning,
  containsStackTrace,
  factKeyIsSecretShaped,
  redactBoundaryText,
  type BoundaryRedaction,
} from './terminal-redaction';

export {
  INTERNAL_FAILURE_LINE,
  PRIVATE_REASONING_LINE,
  PROJECTED_EVENT_KINDS,
  TERMINAL_LINE_MAX,
  UNRECOGNISED_LINE,
  humanizeCapability,
  humanizeTaskReference,
  pluralize,
  projectJuliusEvent,
  projectJuliusEvents,
  type RelayTerminalEntry,
  type RelayTerminalProjection,
} from './julius-terminal-projection';
