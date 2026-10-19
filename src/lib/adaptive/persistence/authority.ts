import type { AdaptiveAuthorityDocument, AdaptiveDocument } from './repository';
import type { IndexedControls } from './indexed/contracts';

/** Read-only canonical controls. Memory bodies, inbox content, observations and
 * mutation/event ledgers are deliberately absent from this distinct type. */
export type AdaptiveRuntimeControls = AdaptiveAuthorityDocument & Pick<AdaptiveDocument, 'revision' | 'updatedAt'> & {
  experience: Pick<AdaptiveDocument['experience'], 'preferences' | 'settings' | 'predictionTurns' | 'preferenceLearning'>;
  relationships: Pick<AdaptiveDocument['relationships'], 'controls' | 'bindings' | 'sources' | 'externalSettings'>;
};

/** A pure evaluator explicitly identifies denial and the earliest external
 * policy deadline; the storage adapter persists observed denial time. */
export interface RuntimeControlEvaluation<T> { value: T; deadline?: number; denied?: boolean }

export function runtimeControlsFromIndexed(c: IndexedControls): AdaptiveRuntimeControls {
  return {
    accountId: c.accountId, personId: c.personId, createdAt: c.createdAt, updatedAt: c.updatedAt, revision: c.revision,
    binding: c.binding, declaration: c.declaration, permissions: c.permissions, agentGrants: c.agentGrants,
    experience: { preferences: c.preferences, settings: c.settings, predictionTurns: c.predictionTurns,
      ...(c.preferenceLearning ? { preferenceLearning: c.preferenceLearning } : {}) },
    relationships: { controls: c.relationshipControls, bindings: c.relationshipBindings,
      sources: c.relationshipSources, externalSettings: c.relationshipExternalSettings },
  };
}
