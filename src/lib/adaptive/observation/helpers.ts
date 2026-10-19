import { digest, spaceIdFor, type AdaptiveDocument, type SpaceKind } from '../persistence/repository';
import { TURN_STAGES, type TelemetryProjection } from './telemetry';
import { OBSERVER_MAX_ATTEMPTS, OBSERVER_VERSION, type ObserverEvent, type ObserverFinding, type ObserverProjection } from './contracts';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
const PURPOSE = 'optional.product_analytics' as const;
export type ObserverAllowed = (d: AdaptiveDocument, space: SpaceKind, agentId: string, now: number) => boolean;
/** The receipt changes on binding, permission or exact agent-grant changes. No text. */
export function observerPolicyReceipt(d: AdaptiveDocument, space: SpaceKind, agentId: string): string {
  return digest([OBSERVER_VERSION, d.accountId, d.personId, d.binding,
    d.permissions.find(p => p.id === `permission:${space}:${PURPOSE}`),
    d.agentGrants.find(g => g.space === space && g.agentId === agentId)]);
}
const uniqueTurns = (events: ObserverEvent[], outcome: ObserverEvent['outcome']) => new Set(events.filter(e => e.outcome === outcome).map(e => e.turnKey)).size;
/** Pure independently replayable deterministic projection. Only processed, current-policy
 * events belong here; the service/sweep performs authorization before calling it. */
export function projectObserverEvents(events: readonly ObserverEvent[], space: SpaceKind): ObserverProjection {
  const source = events.filter(e => e.space === space && e.state === 'processed').sort((a, b) => a.id.localeCompare(b.id));
  const responses = new Map<string, ObserverEvent>();
  const rank = { unknown: 0, responded: 1, cancelled: 2, failed: 3 };
  for (const event of source.filter(e => e.trust === 'server')) {
    const prior = responses.get(event.turnKey);
    if (!prior || event.revision > prior.revision || (event.revision === prior.revision && rank[event.outcome as keyof typeof rank] > rank[prior.outcome as keyof typeof rank])) responses.set(event.turnKey, event);
  }
  const allServer = [...responses.values()];
  const server = allServer.filter(e => e.operation !== 'prediction');
  const client = source.filter(e => e.trust === 'client_unverified');
  const timed = server.filter(e => e.outcome === 'responded' && e.durationMs !== undefined);
  const finishedPlayback = new Set(client.filter(e => ['playback_completed', 'playback_failed', 'interrupted'].includes(e.outcome)).map(e => e.turnKey));
  const taskReports = new Map<string, ObserverEvent>();
  for (const event of client.filter(e => e.outcome.startsWith('task_')).sort((a, b) => a.receivedAt - b.receivedAt || a.revision - b.revision || a.id.localeCompare(b.id))) taskReports.set(event.turnKey, event);
  const task = [...taskReports.values()];
  const spans = allServer.flatMap(e => e.telemetry?.stages ?? []), usage = allServer.flatMap(e => e.telemetry?.usage ?? []);
  const sum = (field: 'inputTokens' | 'outputTokens', receipts = usage) => receipts.some(u => u[field] !== null) ? receipts.reduce((n, u) => n + (u[field] ?? 0), 0) : null;
  const discarded = allServer.filter(e => e.outcome !== 'responded').flatMap(e => e.telemetry?.usage ?? []);
  const playbackTiming = client.filter(e => e.outcome === 'playback_started' && e.durationMs !== undefined);
  const telemetry: TelemetryProjection = { instrumentedTurns: allServer.filter(e => e.telemetry).length,
    stages: TURN_STAGES.map(stage => { const rows = spans.filter(s => s.stage === stage); return { stage, samples: rows.length,
      failed: rows.filter(s => s.outcome === 'failed').length, cancelled: rows.filter(s => s.outcome === 'cancelled').length,
      unknown: rows.filter(s => s.outcome === 'unknown').length, meanMs: rows.length ? rows.reduce((n, s) => n + s.durationMs, 0) / rows.length : null }; }),
    usageReceipts: usage.length, usageUnavailable: usage.filter(u => u.status === 'unavailable').length,
    inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), discardedInputTokens: sum('inputTokens', discarded), discardedOutputTokens: sum('outputTokens', discarded), usageComplete: allServer.length > 0 && allServer.every(e => e.telemetry && !e.telemetry.truncated && e.telemetry.usage.length > 0 && e.telemetry.usage.every(u => u.status === 'complete' && u.inputTokens !== null && u.outputTokens !== null)), billedCost: null, clientPlaybackTimingSamples: playbackTiming.length,
    clientMeanTimeToPlaybackMs: playbackTiming.length ? playbackTiming.reduce((n, e) => n + e.durationMs!, 0) / playbackTiming.length : null,
    reportedTaskSucceeded: task.filter(e => e.outcome === 'task_succeeded').length, reportedTaskFailed: task.filter(e => e.outcome === 'task_failed').length,
    reportedTaskUnknown: task.filter(e => e.outcome === 'task_unknown').length };
  const findings: ObserverFinding[] = [];
  const rules = [
    { rule: 'response_failure', outcome: 'failed', observed: 'server_reported_failure', alternatives: ['provider_or_application_failure', 'unknown'] },
    { rule: 'playback_failure', outcome: 'playback_failed', observed: 'client_reported_playback_failure', alternatives: ['network_or_device_failure', 'unknown'] },
    { rule: 'interruption', outcome: 'interrupted', observed: 'client_reported_interruption', alternatives: ['intentional_user_action', 'network_or_device_failure', 'unknown'] },
  ] as const;
  for (const rule of rules) {
    const evidence = (rule.rule === 'response_failure' ? server : client).filter(e => e.outcome === rule.outcome);
    if (!evidence.length) continue;
    const evidenceIds = evidence.map(e => e.id).sort();
    findings.push({ id: digest([OBSERVER_VERSION, space, rule.rule, evidenceIds]), space, rule: rule.rule, ruleVersion: 1,
      evidenceIds, count: new Set(evidence.map(e => e.turnKey)).size, observed: rule.observed,
      inferredCause: null, alternatives: [...rule.alternatives], confidence: 'observation_only', reproducibleFrom: 'journal_events' });
  }
  return { space, sourceDigest: digest(source.map(e => [e.id, e.fingerprint, e.revision])), sourceEvents: source.length,
    responseTurns: server.length, taskOutcomesUnknown: server.filter(e => !taskReports.has(e.turnKey) || taskReports.get(e.turnKey)!.outcome === 'task_unknown').length, timedResponses: timed.length, responded: uniqueTurns(server, 'responded'), failed: uniqueTurns(server, 'failed'),
    cancelled: uniqueTurns(server, 'cancelled'), unknownResponses: uniqueTurns(server, 'unknown'),
    meanResponseMs: timed.length ? timed.reduce((total, e) => total + e.durationMs!, 0) / timed.length : null,
    playbackStarted: uniqueTurns(client, 'playback_started'), playbackCompleted: uniqueTurns(client, 'playback_completed'),
    playbackFailed: uniqueTurns(client, 'playback_failed'), interruptions: uniqueTurns(client, 'interrupted'),
    telemetry, playbackUnknown: server.filter(e => e.channel === 'voice' && e.outcome === 'responded' && !finishedPlayback.has(e.turnKey)).length, findings };
}
/** Run after account mutations and from the lifecycle sweep. It must execute within
 * the same account transaction. Revocation removes journal and all derived evidence. */
export function sweepObserverDocument(d: AdaptiveDocument, now: number, isAllowed: ObserverAllowed): boolean {
  const before = digest(canonical(d.observer));
  d.observer.events = d.observer.events.filter(e => e.receivedAt <= now && e.expiresAt > now && e.accountId === d.accountId && e.personId === d.personId &&
    e.spaceId === spaceIdFor(d.accountId, e.space) && isAllowed(d, e.space, e.agentId, now) && e.policyReceipt === observerPolicyReceipt(d, e.space, e.agentId));
  // Client outcomes cannot outlive their authoritative server correlation.
  const serverTurns = new Set(d.observer.events.filter(e => e.trust === 'server' && e.operation !== 'prediction' && e.outcome === 'responded').map(e => e.turnKey));
  d.observer.events = d.observer.events.filter(e => e.trust === 'server' || serverTurns.has(e.turnKey));
  for (const e of d.observer.events) if (e.state === 'leased' && (e.leaseUntil ?? 0) <= now) {
    e.state = e.attempts >= OBSERVER_MAX_ATTEMPTS ? 'failed' : 'pending';
    if (e.state === 'failed') e.failureCode = 'retry_exhausted';
    delete e.leaseId; delete e.leaseUntil;
  }
  d.observer.projections = (['work', 'personal'] as const).filter(space => d.observer.events.some(e => e.space === space && e.state === 'processed')).map(space => projectObserverEvents(d.observer.events, space));
  return before !== digest(canonical(d.observer));
}
