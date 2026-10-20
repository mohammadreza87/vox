import type { ExperimentConfig, ExperimentScope } from './contracts';
import { experimentDigest, type ExperimentAuthority } from './service';
export const NOW = 10_000;
export const config = (overrides: Partial<ExperimentConfig> = {}): ExperimentConfig => ({ schemaVersion: 1,
  id: 'synthetic-density', assignmentVersion: 1, assignmentKind: 'private_person', salt: 'a'.repeat(64),
  baselineArtifact: 'b'.repeat(64), candidateArtifact: 'c'.repeat(64), candidateBasisPoints: 5000,
  candidateDensity: 'compact', baselineDensity: 'comfortable', startsAt: NOW, expiresAt: NOW + 10_000,
  review: { owner: 'synthetic-owner', reviewer: 'synthetic-independent-reviewer', reference: 'synthetic-review', reviewedAt: NOW,
    offlineEvidence: 'synthetic-offline', shadowEvidence: 'synthetic-shadow' },
  retention: { policyVersion: 'synthetic-only-retention', approvalReference: 'synthetic-policy-review', retainUntil: NOW + 20_000 },
  stoppingRules: { maxAssignments: 100, maxExposures: 100, maxFailures: 2, successMetric: 'client_reported_readability', guardrail: 'presentation_failure' }, ...overrides });
export const privateScope = (personId = 'alice'): ExperimentScope => ({ kind: 'private_person', tenantId: 'tenant', space: 'work', personId });
export const sharedScope = (recipients = ['alice', 'bob']): ExperimentScope => ({ kind: 'shared_container', tenantId: 'tenant', space: 'work', containerId: 'selected-alice-bob', containerKind: 'selected', recipients });
export const authority = (scope: ExperimentScope = privateScope(), revision = experimentDigest('synthetic-policy')): ExperimentAuthority => ({ scope, revision, expiresAt: NOW + 10_000 });
export const source = (id = 'synthetic-response') => ({ id: experimentDigest(id), revision: 1 });
