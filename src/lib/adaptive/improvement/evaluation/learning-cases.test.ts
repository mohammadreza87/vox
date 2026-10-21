import { expect, it } from 'vitest';
import { canonical, hash } from '../contracts';
import { corpusSchema, manifestSchema, protocolReservationSchema } from './contracts';
import { evaluationProtocolDigest, optimizerProjection, protocolCommitment, validateEvaluationInputs } from './manifest';
import { withEvaluationLearningCaseAuthority } from './authority';
import { attestLearningCaseProtocol } from './binding';
import type { EvaluationLearningCaseAuthority } from './authority';
import type { ProtocolReceipt } from './contracts';
import { syntheticProtocolInputs } from './synthetic';

function lc1() {
  const fixture = syntheticProtocolInputs();
  fixture.corpus.schemaVersion = 2;
  fixture.manifest.schemaVersion = 2;
  fixture.manifest.learningCases = { version: 1, lineageDigest: hash('reviewed-fictional-lineage') };
  fixture.manifest.digests.corpus = hash(canonical(fixture.corpus));
  return fixture;
}
it('requires an explicit matching LC1 corpus/manifest version and mandatory lineage commitment', () => {
  const f = lc1();
  expect(validateEvaluationInputs(f.manifest, f.corpus, 500).manifest.learningCases).toEqual(f.manifest.learningCases);
  expect(manifestSchema.safeParse({ ...f.manifest, learningCases: undefined }).success).toBe(false);
  expect(manifestSchema.safeParse({ ...f.manifest, schemaVersion: 1 }).success).toBe(false);
  expect(manifestSchema.safeParse({ ...f.manifest, schemaVersion: 3 }).success).toBe(false);
  expect(corpusSchema.safeParse({ ...f.corpus, schemaVersion: 3 }).success).toBe(false);
  expect(() => validateEvaluationInputs(f.manifest, { ...f.corpus, schemaVersion: 1 }, 500)).toThrow('learning_case_version_mismatch');
  expect(manifestSchema.safeParse({ ...f.manifest, learningCases: { ...f.manifest.learningCases, unreviewed: true } }).success).toBe(false);
});
it('LC1 commitment changes the protocol digest while legacy canonical commitments stay unchanged', () => {
  const { manifest } = syntheticProtocolInputs();
  const commitment = protocolCommitment(manifest);
  expect(Object.keys(commitment).sort()).toEqual(['bindings', 'budget', 'protocolMetadata', 'retainUntil']);
  expect(evaluationProtocolDigest(manifest)).toBe(hash(canonical(commitment)));
  const f = lc1();
  const first = evaluationProtocolDigest(f.manifest);
  f.manifest.learningCases!.lineageDigest = hash('another-reviewed-fictional-lineage');
  expect(evaluationProtocolDigest(f.manifest)).not.toBe(first);
});
it('legacy public optimizer projection never grants LC1 use, including a stripped corpus version', () => {
  const f = lc1();
  expect(() => optimizerProjection(f.manifest, f.corpus, 500)).toThrow('learning_case_authority_required');
  expect(() => optimizerProjection(f.manifest, { ...f.corpus, schemaVersion: 1 }, 500)).toThrow('learning_case_version_mismatch');
});
it('reservation requires both LC1 version and exact lineage-bound protocol digest', () => {
  const { manifest } = lc1();
  const reservation = { schemaVersion: 2, candidateId: 'fictional-candidate', candidateRevision: hash('candidate'), artifactDigest: hash('candidate'),
    baselineRevision: hash('base'), baselineArtifactDigest: hash('base-artifact'), legacyDatasetDigest: hash('legacy-final'), candidateEvaluatorDigest: hash('evaluator'), promotionPolicyDigest: hash('policy'),
    ...protocolCommitment(manifest), protocolDigest: evaluationProtocolDigest(manifest), evaluatorServiceId: 'evaluator', reservedAt: 500 };
  expect(protocolReservationSchema.safeParse(reservation).success).toBe(true);
  expect(protocolReservationSchema.safeParse({ ...reservation, schemaVersion: 1 }).success).toBe(false);
  expect(protocolReservationSchema.safeParse({ ...reservation, learningCases: undefined }).success).toBe(false);
  expect(protocolReservationSchema.safeParse({ ...reservation, learningCases: { version: 1, lineageDigest: hash('changed') } }).success).toBe(false);
});

it('a caller-supplied duck-typed authority callback cannot mint LC1 consumer access', async () => {
  let calls = 0;
  const fake = { workflow: { withLearningCaseAuthority() { calls++; return {}; } }, handle: {} } as unknown as EvaluationLearningCaseAuthority;
  await expect(withEvaluationLearningCaseAuthority(fake, { version: 1, lineageDigest: hash('lineage') }, { protocolDigest: hash('protocol') }, 'adapter', undefined, () => { calls++; })).rejects.toThrow('learning_case_authority_required');
  expect(calls).toBe(0);
});
it('guarded companion signing refuses fabricated runner receipt objects before signing', async () => {
  const fake = {} as EvaluationLearningCaseAuthority;
  await expect(attestLearningCaseProtocol(fake, {} as ProtocolReceipt, 'evaluator', 'not-a-key')).rejects.toThrow('learning_case_runner_receipt_required');
});
