import type { AdaptiveAuthorityDocument, AdaptiveDocument } from './repository';
import { types as utilTypes } from 'node:util';
import type { IndexedControls, IndexedControlStamp } from './indexed/contracts';

/** Read-only canonical controls. Memory bodies, inbox content, observations and
 * mutation/event ledgers are deliberately absent from this distinct type. */
export type AdaptiveRuntimeControls = AdaptiveAuthorityDocument & Pick<AdaptiveDocument, 'revision' | 'updatedAt'> & {
  experience: Pick<AdaptiveDocument['experience'], 'preferences' | 'settings' | 'predictionTurns' | 'preferenceLearning'>;
  relationships: Pick<AdaptiveDocument['relationships'], 'controls' | 'bindings' | 'sources' | 'externalSettings'>;
};

/** observedDenial publishes mixed negative feature observations without waiving
 * the positive deadline. A pure evaluator identifies denial and the earliest external
 * policy deadline; the storage adapter persists observed denial time. */
export interface RuntimeControlEvaluation<T> { value: T; deadline?: number; denied?: boolean; observedDenial?: boolean }
/** Catalog evidence is data only. The namespace alone never proves current
 * permission, retention, source lineage or authority to load private bodies. */
export type RuntimeControlStamp = Readonly<IndexedControlStamp> | undefined;
export type RuntimeControlEvaluator<T> = (controls: Readonly<AdaptiveRuntimeControls>, now: number,
  storeIdentity: string, stamp: RuntimeControlStamp) => RuntimeControlEvaluation<T>;

/** These inputs are validated JSON trees; never freeze a caller's mutable draft. */
function freezeControls<T>(value: T): T {
  if (value && typeof value === 'object') {
    if (!Object.isFrozen(value)) Object.freeze(value);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))
      if ('value' in descriptor) freezeControls(descriptor.value);
  }
  return value;
}

/** Keep the bridge synchronous even when a mistaken async evaluator is hidden
 * inside its result wrapper. Inspect data descriptors, never execute getters or
 * arbitrary thenables. Observe genuine rejected promises before failing closed. */
export function validateRuntimeControlEvaluation<T>(raw: unknown): RuntimeControlEvaluation<T> {
  let invalid = false, nodes = 0;
  const seen = new Set<object>();
  // Complete the bounded data walk before rejecting: throwing at the first bad
  // value would leave a sibling rejected Promise unobserved. Unknown wrapper
  // fields are inspected too, but are never accepted as evaluation controls.
  const checkValue = (value: unknown, depth = 0): void => {
    if (utilTypes.isPromise(value)) {
      void Promise.prototype.then.call(value, undefined, () => undefined);
      invalid = true; return;
    }
    if (++nodes > 100_000 || depth > 32) { invalid = true; return; }
    if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))) return;
    if (typeof value !== 'object') { invalid = true; return; }
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid = true;
    if (seen.has(value)) { invalid = true; return; }
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (typeof key !== 'string' || key === 'then' || !('value' in descriptor)) invalid = true;
      if ('value' in descriptor) checkValue(descriptor.value, depth + 1);
    }
    seen.delete(value);
  };
  checkValue(raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || utilTypes.isPromise(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new Error('Invalid synchronous authority evaluation');
  const fields = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).some(key => typeof key !== 'string' || !['value', 'deadline', 'denied', 'observedDenial'].includes(key)) ||
      !Object.hasOwn(fields, 'value') || Object.values(fields).some(d => !('value' in d))) invalid = true;
  const deadline = fields.deadline?.value, denied = fields.denied?.value, observedDenial = fields.observedDenial?.value;
  if ((deadline !== undefined && (!Number.isSafeInteger(deadline) || deadline < 0)) ||
      (denied !== undefined && typeof denied !== 'boolean') || (observedDenial !== undefined && typeof observedDenial !== 'boolean')) invalid = true;
  if (invalid) throw new Error('Invalid synchronous authority evaluation');
  return { value: fields.value.value as T, ...(deadline === undefined ? {} : { deadline }), ...(denied === undefined ? {} : { denied }), ...(observedDenial === undefined ? {} : { observedDenial }) };
}

export function runtimeControlsFromIndexed(c: IndexedControls): AdaptiveRuntimeControls {
  return freezeControls({
    accountId: c.accountId, personId: c.personId, createdAt: c.createdAt, updatedAt: c.updatedAt, revision: c.revision,
    binding: c.binding, declaration: c.declaration, permissions: c.permissions, agentGrants: c.agentGrants,
    experience: { preferences: c.preferences, settings: c.settings, predictionTurns: c.predictionTurns,
      ...(c.preferenceLearning ? { preferenceLearning: c.preferenceLearning } : {}) },
    relationships: { controls: c.relationshipControls, bindings: c.relationshipBindings,
      sources: c.relationshipSources, externalSettings: c.relationshipExternalSettings },
  });
}

/** Compatibility reads still load a canonical document, but evaluators receive
 * the same immutable, body-free type without mutating the transaction draft. */
export function runtimeControlsFromDocument(d: AdaptiveDocument): AdaptiveRuntimeControls {
  return freezeControls(structuredClone({ accountId: d.accountId, personId: d.personId, createdAt: d.createdAt,
    updatedAt: d.updatedAt, revision: d.revision, binding: d.binding, declaration: d.declaration,
    permissions: d.permissions, agentGrants: d.agentGrants,
    experience: { preferences: d.experience.preferences, settings: d.experience.settings,
      predictionTurns: d.experience.predictionTurns,
      ...(d.experience.preferenceLearning ? { preferenceLearning: d.experience.preferenceLearning } : {}) },
    relationships: { controls: d.relationships.controls, bindings: d.relationships.bindings,
      sources: d.relationships.sources, externalSettings: d.relationships.externalSettings } }));
}
