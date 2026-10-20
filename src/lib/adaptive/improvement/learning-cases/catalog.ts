import { canonical, hash, type MinimizedFinding } from '../contracts';
import { evaluationCaseSchema, type EvaluationCase } from '../evaluation/contracts';
import { fictionalUnits, recipeSchema, type LearningCaseRecipe } from './contracts';
/** Canonical closed output specification, identical in TS, CLI and bundled code.
 * The renderer consumes these exact policy records; runtime function source is
 * deliberately excluded because transpilation/minification changes it. */
const catalog = {
  version: 'vox.closed-routing-cases.v1',
  texts: { en: 'Synthetic routing exercise.', fa: 'تمرین ساختگی مسیریابی.', mixed: 'Synthetic تمرین مسیریابی.' },
  units: fictionalUnits,
  identity: { familyDomain:'vox.synthetic.case-family.v1', familyFields:['sourceDigest','sortedLineage','scenario','locale','unit'],
    unitFields:['domain','unit'], task:'vox.synthetic.task.v1', person:'vox.synthetic.person.v1', group:'vox.synthetic.group.v1', conversation:'vox.synthetic.conversation.v1' },
  scenarios: {
    cancellation: {cancelled:true,identity:'known',sharing:'none',notification:'none',expected:'stop',group:false},
    active_continue: {cancelled:false,identity:'known',sharing:'none',notification:'none',expected:'continue',group:false},
    revoked_sharing: {cancelled:false,identity:'known',sharing:'revoked',notification:'none',expected:'deny',group:true},
    unknown_identity: {cancelled:false,identity:'unknown',sharing:'none',notification:'none',expected:'deny',group:false},
    notification_verified: {cancelled:false,identity:'known',sharing:'none',notification:'verified',expected:'notify_verified',group:false},
    notification_unknown: {cancelled:false,identity:'known',sharing:'none',notification:'unknown',expected:'notify_unknown',group:false},
  },
} as const;
export const LEARNING_CASE_CATALOG_DIGEST = hash(canonical(catalog));
export function learningCaseId(input: LearningCaseRecipe, finding: MinimizedFinding): string {
  const r = recipeSchema.parse(input);
  return hash(canonical({ domain: catalog.identity.familyDomain, sourceDigest: finding.sourceDigest,
    lineage: [...finding.lineageIds].sort(), scenario: r.scenario, locale: r.locale, unit: r.unit }));
}
export function materializeLearningCase(input: LearningCaseRecipe, finding: MinimizedFinding): EvaluationCase {
  const r = recipeSchema.parse(input), policy=catalog.scenarios[r.scenario];
  if (r.catalogDigest !== LEARNING_CASE_CATALOG_DIGEST || finding.kind !== 'synthetic') throw new Error('learning_case_catalog_invalid');
  const unit = (kind: 'task'|'person'|'group'|'conversation') => hash(canonical({ domain: catalog.identity[kind], unit: r.unit }));
  return evaluationCaseSchema.parse({ id: learningCaseId(r, finding), taskId: unit('task'), personId: unit('person'),
    ...(policy.group ? { groupId: unit('group') } : {}), conversationId: unit('conversation'), occurredAt: r.occurredAt, scenario: r.scenario,
    input: { locale: r.locale, text: catalog.texts[r.locale], cancelled:policy.cancelled, identity:policy.identity, sharing:policy.sharing, notification:policy.notification }, expected:policy.expected });
}
