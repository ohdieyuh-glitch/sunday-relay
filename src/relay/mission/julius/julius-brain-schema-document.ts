import {
  JULIUS_BRAIN_ARTIFACT_CLASSES,
  JULIUS_BRAIN_BODY_SCHEMAS,
  JULIUS_BRAIN_EVIDENCE_CLASSES,
  JULIUS_BRAIN_LINK_RELATIONS,
  JULIUS_BRAIN_RECORD_KINDS,
  JULIUS_BRAIN_RETIRE_SCHEMA,
  JULIUS_BRAIN_SCHEMA_VERSION,
} from './julius-brain-contracts';
import { JULIUS_BRAIN_OBSERVATION_KINDS } from './julius-brain-policy';

/**
 * THE LANGUAGE-INDEPENDENT BRAIN SCHEMA, AS ONE JSON DOCUMENT.
 *
 * Generated from the TypeScript domain and committed at
 * `relay-python/julius/brain_schema.json`, where the Python SDK reads it and a
 * test holds it byte-identical to this. The Python tool also hands this exact
 * document to every execution, so an SDK and the Brain can never disagree about
 * what a record may contain. A C++, Rust or Unreal consumer reads the same file.
 */
export const JULIUS_BRAIN_SCHEMA_DOCUMENT_FORMAT = 'julius-project-brain-schema.v1' as const;

export function juliusBrainSchemaDocument() {
  return {
    format: JULIUS_BRAIN_SCHEMA_DOCUMENT_FORMAT,
    schemaVersion: JULIUS_BRAIN_SCHEMA_VERSION,
    recordKinds: [...JULIUS_BRAIN_RECORD_KINDS],
    observationKinds: [...JULIUS_BRAIN_OBSERVATION_KINDS],
    linkRelations: [...JULIUS_BRAIN_LINK_RELATIONS],
    evidenceClasses: [...JULIUS_BRAIN_EVIDENCE_CLASSES],
    artifactClasses: [...JULIUS_BRAIN_ARTIFACT_CLASSES],
    retire: JULIUS_BRAIN_RETIRE_SCHEMA,
    kinds: JULIUS_BRAIN_BODY_SCHEMAS,
  };
}

/** The committed file's exact text: two-space JSON and a trailing newline. */
export const renderJuliusBrainSchemaDocument = (): string => `${JSON.stringify(juliusBrainSchemaDocument(), null, 2)}\n`;
