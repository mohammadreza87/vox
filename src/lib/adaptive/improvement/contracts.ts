import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { z } from 'zod';
export const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
export const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value));
export const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const timestamp = z.number().int().nonnegative().safe();
export const findingSchema = z.object({ schemaVersion: z.literal(1), id: identifier,
  kind: z.enum(['synthetic', 'approved_aggregate']), problemCode: z.enum(['audio_cancellation', 'routing_quality']),
  sourceDigest: sha256, lineageIds: z.array(sha256).min(1).max(32),
  sampleCount: z.number().int().min(1).max(1000000), failureCount: z.number().int().min(1).max(1000000),
  purpose: z.literal('product_improvement'), reviewedAt: timestamp, expiresAt: timestamp,
}).strict().refine(f => f.failureCount <= f.sampleCount && f.expiresAt > f.reviewedAt);
export type MinimizedFinding = z.infer<typeof findingSchema>;
/** Inert, bounded candidate language: no executable code, prompts or free text. */
export const routingArtifactSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('cancellation_routing'),
  onCancelled: z.enum(['stop', 'complete']), onActive: z.enum(['continue', 'stop']),
}).strict();
export type RoutingArtifact = z.infer<typeof routingArtifactSchema>;
export const proposalSchema = z.object({ id: identifier, findingId: identifier,
  kind: z.literal('routing_change'), hypothesis: z.literal('cancelled_turn_should_stop'),
  expectedOutcome: z.literal('zero_post_cancel_work'),
  baselineRevision: sha256, baselineArtifactDigest: sha256, createdAt: timestamp,
  budget: z.object({ maxCandidates: z.number().int().min(1).max(4), maxCases: z.number().int().min(1).max(128) }).strict(),
}).strict();
export type Proposal = z.infer<typeof proposalSchema>;
export type Authority = 'analyst' | 'author' | 'evaluator' | 'human';
export interface Attestation<T> { schemaVersion: 1; keyId: string; purpose: string; payload: T; signature: string }
export interface TrustedKey { role: Authority; publicKey: string }
export type TrustStore = Record<string, TrustedKey>;
export function attest<T>(keyId: string, privateKey: string, purpose: string, payload: T): Attestation<T> {
  const message = { schemaVersion: 1 as const, keyId, purpose, payload };
  return { ...message, signature: sign(null, Buffer.from(canonical(message)), privateKey).toString('base64') };
}
export function verifyAttestation<T>(input: Attestation<T>, role: Authority, purpose: string, trust: TrustStore): boolean {
  try {
    if (Object.keys(input).sort().join(',') !== 'keyId,payload,purpose,schemaVersion,signature' || input.schemaVersion !== 1 || input.purpose !== purpose) return false;
    const key = trust[input.keyId];
    if (!key || key.role !== role || createPublicKey(key.publicKey).asymmetricKeyType !== 'ed25519') return false;
    const { signature, ...message } = input;
    return verify(null, Buffer.from(canonical(message)), key.publicKey, Buffer.from(signature, 'base64'));
  } catch { return false; }
}
export function validateTrust(trust: TrustStore): void {
  const seen = new Set<string>();
  for (const [id, key] of Object.entries(trust)) {
    identifier.parse(id);
    const material = createPublicKey(key.publicKey).export({ type: 'spki', format: 'der' });
    if (seen.has(hash(material)) || createPublicKey(key.publicKey).asymmetricKeyType !== 'ed25519') throw new Error('authority_keys_must_be_distinct_ed25519');
    seen.add(hash(material));
  }
  for (const role of ['analyst', 'author', 'evaluator', 'human']) if (!Object.values(trust).some(key => key.role === role)) throw new Error('missing_authority_key');
}
export const approvalSchema = z.object({ candidateId: identifier, artifactDigest: sha256, evaluationDigest: sha256,
  decision: z.enum(['approve', 'reject']), approvedAt: timestamp, expiresAt: timestamp,
}).strict().refine(a => a.expiresAt > a.approvedAt);
export type HumanApproval = z.infer<typeof approvalSchema>;
export const evaluationDetailsSchema = z.object({
  sourceDigest: sha256, artifactDigest: sha256, baselineArtifactDigest: sha256, datasetDigest: sha256, evaluatorDigest: sha256,
  imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), policyDigest: sha256,
  phase: z.literal('protected_final'), isolation: z.literal('docker_network_none_readonly'),
  checks: z.number().int().positive().max(128), baselineFailures: z.number().int().nonnegative(), candidateFailures: z.number().int().nonnegative(),
}).strict();
/** Signed results are a minimized projection too; extra narratives and logs must
 * never become durable audit/review content merely because a worker signed them. */
export const protectedEvaluationSchema = z.object({
  receipt: z.object({
    candidateId: identifier, candidateRevision: sha256, artifactDigest: sha256,
    evaluatorServiceId: identifier, evaluatorVersion: sha256, datasetVersion: sha256,
    promotionPolicyVersion: sha256, baselineRevision: sha256,
    status: z.enum(['passed', 'failed', 'incomplete']), privacyFailures: z.number().int().nonnegative(),
    failedChecks: z.number().int().nonnegative(), skippedChecks: z.number().int().nonnegative(), testedAt: timestamp,
  }).strict(),
  details: evaluationDetailsSchema,
}).strict();
export const caseSchema = z.object({ cancelled: z.boolean(), expected: z.enum(['stop', 'continue']) }).strict();
export const datasetSchema = z.object({ version: identifier, cases: z.array(caseSchema).min(1).max(128) }).strict();
export type RoutingDataset = z.infer<typeof datasetSchema>;

export function routeCancellation(config: RoutingArtifact, cancelled: boolean): 'stop' | 'continue' {
  const parsed = routingArtifactSchema.parse(config);
  return cancelled ? parsed.onCancelled === 'stop' ? 'stop' : 'continue' : parsed.onActive;
}
