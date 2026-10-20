import { createHash } from 'node:crypto';
import { experimentConfigSchema, experimentScopeSchema, experimentScopeExportSchema, type ExperimentConfig, type ExperimentDocument, type ExperimentPhase,
  type ExperimentScope, type ExperimentSource, type ResponsePresentation } from './contracts';
import type { ExperimentStorage } from './storage';
export const experimentDigest = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export interface ExperimentAuthority { scope: ExperimentScope; revision: string; scopeRevision?: string; expiresAt: number }
/** No conversation identity in this key. Shared selected recipients are sorted/deduped
 * and bound to the canonical container; membership changes cannot reuse old state. */
export function experimentUnit(raw: ExperimentScope): string {
  const scope = experimentScopeSchema.parse(raw);
  if (scope.kind === 'private_person') return experimentDigest(['person', scope.tenantId, scope.space, scope.personId]);
  if (new Set(scope.recipients).size !== scope.recipients.length) throw new Error('Duplicate experiment recipient');
  return experimentDigest(['container', scope.tenantId, scope.space, scope.containerKind, scope.containerId, [...scope.recipients].sort()]);
}
const versionKey = (config: ExperimentConfig) => experimentDigest(['killed', config.id, config.assignmentVersion]);
const scopeKey = (unit: string, config: ExperimentConfig) => experimentDigest(['scope-suppressed', unit, config.id, config.assignmentVersion]);
const sourceKey = (unit: string, source: ExperimentSource) => experimentDigest(['source', unit, source.id]);
function clock(now: number): void { if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid experiment clock'); }
function authorityKey(authority: ExperimentAuthority, now: number): string {
  if (!/^[a-f0-9]{64}$/.test(authority.revision) || !Number.isSafeInteger(authority.expiresAt) || authority.expiresAt <= now) throw new Error('Experiment authority unavailable');
  return experimentUnit(authority.scope);
}
function definition(d: ExperimentDocument, id: string, expectedRevision: number) {
  const item = d.definitions.find(r => r.config.id === id);
  if (!item || item.revision !== expectedRevision) throw new Error('Experiment revision conflict'); return item;
}
function quarantine(d: ExperimentDocument, item: ExperimentDocument['definitions'][number], now: number,
  reason: NonNullable<ExperimentDocument['definitions'][number]['stopReason']>, mode: 'quarantine' | 'purge' = 'quarantine') {
  if (item.phase !== 'killed') { item.phase = 'killed'; item.revision++; item.stopReason = reason; }
  const key = versionKey(item.config);
  if (!d.tombstones.some(t => t.id === key)) d.tombstones.push({ id: key, kind: 'version_killed', at: now });
  if (mode === 'purge') d.derived = d.derived.filter(r => r.experimentId !== item.config.id);
  else for (const row of d.derived) if (row.experimentId === item.config.id) row.state = 'quarantined';
}
function prune(d: ExperimentDocument, now: number) {
  for (const item of d.definitions) if (['shadow', 'pilot'].includes(item.phase) && item.config.expiresAt <= now) quarantine(d, item, now, 'expired');
  d.derived = d.derived.filter(r => r.expiresAt > now && (d.definitions.find(e => e.config.id === r.experimentId)?.config.retention.retainUntil ?? 0) > now);
  d.exposures = d.exposures.filter(r => (d.definitions.find(e => e.config.id === r.experimentId)?.config.retention.retainUntil ?? 0) > now);
  d.assignments = d.assignments.filter(r => (d.definitions.find(e => e.config.id === r.experimentId)?.config.retention.retainUntil ?? 0) > now);
}
/** Server/operator-only lifecycle. No HTTP or model output can install or promote configuration. */
export class ControlledExperimentService {
  constructor(readonly storage: ExperimentStorage) {}
  private snapshot(now: number): ExperimentDocument {
    clock(now); return this.storage.transaction(d => { now = d.observedAt = Math.max(d.observedAt, now); prune(d, d.observedAt); return structuredClone(d); });
  }
  exportScope(scope: ExperimentScope, now: number) {
    const unit = experimentUnit(scope), d = this.snapshot(now);
    return experimentScopeExportSchema.parse({ schemaVersion: 1,
      assignments: d.assignments.filter(r => r.unit === unit).map(({ experimentId, assignmentVersion, variant, assignedAt }) => ({ experimentId, assignmentVersion, variant, assignedAt })),
      derived: d.derived.filter(r => r.unit === unit).map(({ experimentId, variant, density, state, createdAt, expiresAt }) => ({ experimentId, variant, density, state, createdAt, expiresAt })),
      exposures: d.exposures.filter(r => r.unit === unit).map(({ experimentId, assignmentVersion, variant, occurredAt, trust, surface, configRevision }) => ({ experimentId, assignmentVersion, variant, occurredAt, trust, surface, configRevision })),
      suppressed: d.definitions.some(e => d.tombstones.some(t => t.id === scopeKey(unit, e.config))) });
  }
  scopeRevisionChanged(scope: ExperimentScope, revision: string): boolean {
    const unit = experimentUnit(scope); const d = this.storage.read(); return [...d.assignments, ...d.derived].some(r => r.unit === unit && r.scopeRevision !== revision);
  }
  purgeScope(scope: ExperimentScope, now: number): void {
    clock(now); const unit = experimentUnit(scope);
    const current = this.storage.read();
    if (![...current.assignments, ...current.derived, ...current.exposures].some(r => r.unit === unit)) return;
    this.storage.transaction(d => { now = d.observedAt = Math.max(d.observedAt, now);
      const versions = new Set(d.assignments.filter(r => r.unit === unit).map(r => r.experimentId));
      for (const e of d.definitions.filter(e => versions.has(e.config.id))) if (!d.tombstones.some(t => t.id === scopeKey(unit, e.config)))
        d.tombstones.push({ id: scopeKey(unit, e.config), kind: 'scope_suppressed', at: now });
      d.assignments = d.assignments.filter(r => r.unit !== unit); d.derived = d.derived.filter(r => r.unit !== unit); d.exposures = d.exposures.filter(r => r.unit !== unit);
    });
  }
  install(raw: unknown, now: number): { revision: number; phase: 'off' } {
    clock(now); const config = experimentConfigSchema.parse(raw);
    if (config.review.reviewedAt > now || config.expiresAt <= now) throw new Error('Experiment review expired');
    return this.storage.transaction(d => { now = d.observedAt = Math.max(d.observedAt, now);
      if (config.expiresAt <= now) throw new Error('Experiment review expired');
      if (d.definitions.some(r => r.config.id === config.id) || d.tombstones.some(t => t.id === versionKey(config))) throw new Error('Experiment version already exists');
      d.definitions.push({ config, revision: 1, phase: 'off', failures: 0 }); return { revision: 1, phase: 'off' };
    });
  }
  transition(id: string, expectedRevision: number, phase: Exclude<ExperimentPhase, 'killed' | 'off'>, now: number) {
    clock(now); return this.storage.transaction(d => { now = d.observedAt = Math.max(d.observedAt, now);
      const row = definition(d, id, expectedRevision);
      if (({ off: 'offline', offline: 'shadow', shadow: 'pilot', pilot: '', killed: '' })[row.phase] !== phase ||
          row.config.expiresAt <= now || d.tombstones.some(t => t.id === versionKey(row.config))) throw new Error('Invalid experiment transition');
      row.phase = phase; row.revision++; return { revision: row.revision, phase: row.phase };
    });
  }
  kill(id: string, expectedRevision: number, mode: 'quarantine' | 'purge', now: number) {
    clock(now); if (!['quarantine', 'purge'].includes(mode)) throw new Error('Invalid rollback mode');
    return this.storage.transaction(d => { now = d.observedAt = Math.max(d.observedAt, now); const row = definition(d, id, expectedRevision); quarantine(d, row, now, 'manual', mode);
      return { revision: row.revision, phase: row.phase, derived: d.derived.filter(r => r.experimentId === id).length }; });
  }
  failure(id: string, expectedRevision: number, now: number) {
    clock(now); return this.storage.transaction(d => { now = d.observedAt = Math.max(d.observedAt, now); const row = definition(d, id, expectedRevision);
      if (row.phase !== 'pilot') throw new Error('Experiment pilot unavailable');
      row.failures++; row.revision++;
      if (row.failures >= row.config.stoppingRules.maxFailures) quarantine(d, row, now, 'failure_guardrail');
      return { revision: row.revision, phase: row.phase }; });
  }
  sweepDue(now: number): void {
    clock(now); const d = this.storage.read(); now = Math.max(now, d.observedAt);
    if (d.definitions.some(e => ['shadow', 'pilot'].includes(e.phase) && e.config.expiresAt <= now) ||
        d.derived.some(r => r.expiresAt <= now) || [...d.assignments, ...d.exposures].some(r => (d.definitions.find(e => e.config.id === r.experimentId)?.config.retention.retainUntil ?? 0) <= now)) this.sweep(now);
  }
  sweep(now: number): void { clock(now); this.storage.transaction(d => { now = d.observedAt = Math.max(d.observedAt, now); prune(d, now); }); }
  deleteSource(scope: ExperimentScope, sourceId: string, now: number) {
    clock(now); if (!/^[a-f0-9]{64}$/.test(sourceId)) throw new Error('Invalid experiment source');
    const unit = experimentUnit(scope), key = sourceKey(unit, { id: sourceId, revision: 1 });
    this.storage.transaction(d => { now = d.observedAt = Math.max(d.observedAt, now);
      if (!d.tombstones.some(t => t.id === key)) d.tombstones.push({ id: key, kind: 'source_deleted', at: now });
      const deleted = new Set(d.derived.filter(r => r.unit === unit && r.source.id === sourceId).map(r => r.id));
      d.derived = d.derived.filter(r => !deleted.has(r.id)); d.exposures = d.exposures.filter(r => !deleted.has(r.derivedId));
    });
  }
  prepare(authority: ExperimentAuthority, source: ExperimentSource, now: number, fence: () => void): ResponsePresentation | undefined {
    clock(now); const unit = authorityKey(authority, now);
    if (!/^[a-f0-9]{64}$/.test(source.id) || !Number.isSafeInteger(source.revision) || source.revision < 1) throw new Error('Invalid experiment source');
    // Observe durable time even when disabled; no assignment or exposure is created.
    const snapshot = this.snapshot(now); now = snapshot.observedAt;
    authorityKey(authority, now);
    const available = snapshot.definitions.filter(row => ['shadow', 'pilot'].includes(row.phase) && row.config.assignmentKind === authority.scope.kind && row.config.startsAt <= now && now < row.config.expiresAt);
    if (available.length !== 1) return undefined;
    return this.storage.transaction(d => { now = d.observedAt = Math.max(d.observedAt, now);
      prune(d, now);
      const active = d.definitions.filter(row => ['shadow', 'pilot'].includes(row.phase) && row.config.assignmentKind === authority.scope.kind && row.config.startsAt <= now && row.config.expiresAt > now);
      if (active.length !== 1 || active[0].config.id !== available[0].config.id) return undefined;
      const item = active[0];
      if (!['shadow', 'pilot'].includes(item.phase) || item.config.startsAt > now || item.config.expiresAt <= now ||
          d.tombstones.some(t => t.id === scopeKey(unit, item.config) || t.id === versionKey(item.config) || t.id === sourceKey(unit, source))) return undefined;
      const c = item.config, assignmentId = experimentDigest(['assignment', c.id, c.assignmentVersion, unit]);
      let assigned = d.assignments.find(r => r.id === assignmentId);
      if (!assigned) {
        if (d.assignments.filter(r => r.experimentId === c.id).length >= c.stoppingRules.maxAssignments) { quarantine(d, item, now, 'assignment_limit'); return undefined; }
        const bucket = parseInt(experimentDigest([c.salt, c.id, c.assignmentVersion, unit]).slice(0, 12), 16) % 10000;
        assigned = { id: assignmentId, experimentId: c.id, assignmentVersion: c.assignmentVersion, unit,
          variant: bucket < c.candidateBasisPoints ? 'candidate' : 'control', scopeRevision: authority.scopeRevision ?? authority.revision, assignedAt: now }; d.assignments.push(assigned);
      }
      const receipt = experimentDigest(['derived', assignmentId, source, authority.revision, item.revision]);
      let row = d.derived.find(r => r.id === receipt);
      if (!row) {
        row = { id: receipt, experimentId: c.id, assignmentVersion: c.assignmentVersion, assignmentId, unit,
          source, configRevision: item.revision, authorityRevision: authority.revision, scopeRevision: authority.scopeRevision ?? authority.revision, variant: assigned.variant,
          density: assigned.variant === 'candidate' ? c.candidateDensity : c.baselineDensity, state: 'active', createdAt: now,
          expiresAt: Math.min(c.expiresAt, authority.expiresAt) }; d.derived.push(row);
      }
      return item.phase === 'pilot' && row.state === 'active' ? { density: row.density, receipt } : undefined;
    }, fence);
  }
  current(authority: ExperimentAuthority, presentation: ResponsePresentation, now: number): boolean {
    try { const d = this.snapshot(now); now = d.observedAt; const unit = authorityKey(authority, now);
      const row = d.derived.find(r => r.id === presentation.receipt), item = d.definitions.find(e => e.config.id === row?.experimentId);
      return d.definitions.filter(e => ['shadow', 'pilot'].includes(e.phase) && e.config.assignmentKind === authority.scope.kind && e.config.startsAt <= now && e.config.expiresAt > now).length === 1 && !!row && !!item && item.phase === 'pilot' && item.config.startsAt <= now && item.config.expiresAt > now &&
        row.state === 'active' && row.expiresAt > now && row.unit === unit && row.authorityRevision === authority.revision && row.density === presentation.density &&
        row.id === experimentDigest(['derived', row.assignmentId, row.source, authority.revision, item.revision]) &&
        !d.tombstones.some(t => t.id === scopeKey(unit, item.config) || t.id === versionKey(item.config) || t.id === sourceKey(unit, row.source));
    } catch { return false; }
  }
  expose(authority: ExperimentAuthority, receipt: string, now: number, fence: () => void): { recorded: boolean; duplicate: boolean } {
    clock(now); const unit = authorityKey(authority, now);
    return this.storage.transaction(d => { now = d.observedAt = Math.max(d.observedAt, now);
      prune(d, now); const row = d.derived.find(r => r.id === receipt), item = d.definitions.find(e => e.config.id === row?.experimentId);
      const denied = { recorded: false, duplicate: false };
      if (d.definitions.filter(e => ['shadow', 'pilot'].includes(e.phase) && e.config.assignmentKind === authority.scope.kind && e.config.startsAt <= now && e.config.expiresAt > now).length !== 1 || !row || !item || item.phase !== 'pilot' || item.config.startsAt > now || item.config.expiresAt <= now || row.state !== 'active' || row.expiresAt <= now ||
          row.unit !== unit || row.authorityRevision !== authority.revision || row.id !== experimentDigest(['derived', row.assignmentId, row.source, authority.revision, item.revision]) ||
          d.tombstones.some(t => t.id === scopeKey(unit, item.config) || t.id === sourceKey(unit, row.source) || t.id === versionKey(item.config))) return denied;
      const id = experimentDigest(['exposure', row.id]);
      if (d.exposures.some(e => e.id === id)) return { recorded: false, duplicate: true };
      if (d.exposures.filter(e => e.experimentId === item.config.id).length >= item.config.stoppingRules.maxExposures) { quarantine(d, item, now, 'exposure_limit'); return denied; }
      d.exposures.push({ id, derivedId: row.id, experimentId: row.experimentId, assignmentVersion: row.assignmentVersion,
        assignmentId: row.assignmentId, unit, variant: row.variant, occurredAt: now, trust: 'client_unverified', surface: 'text_rendered', configRevision: item.revision });
      if (d.exposures.filter(e => e.experimentId === item.config.id).length >= item.config.stoppingRules.maxExposures) quarantine(d, item, now, 'exposure_limit');
      return { recorded: true, duplicate: false };
    }, fence);
  }
}
