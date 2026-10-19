import type { AdaptiveDocument, SpaceKind } from '../persistence/repository';
import type { LogicalTurn } from '../personalization/learning/contracts';
export type BudgetScope = Omit<LogicalTurn, 'contextKey'> & { space: SpaceKind; agentId: string; contextKey?: string };
export function findDecisionTurn(d: AdaptiveDocument, input: BudgetScope) {
  return d.experience.predictionTurns.find(p => p.agentId === input.agentId && p.space === input.space && p.sessionId === input.sessionId && p.turnId === input.turnId);
}
export function createDecisionTurn(d: AdaptiveDocument, input: BudgetScope, now: number) {
  if (d.experience.predictionTurns.length >= 100) return undefined;
  const row = { agentId: input.agentId, space: input.space, sessionId: input.sessionId, turnId: input.turnId, contextKey: input.contextKey,
    revision: input.revision, evaluations: 0, inFlightUntil: 0, expiresAt: now + 10 * 60_000 };
  d.experience.predictionTurns.push(row); return row as AdaptiveDocument['experience']['predictionTurns'][number];
}
/** Cumulative limit for preparation and final learning. Final sealing never
 * resets the count or restores a cancelled prepared hint. */
export function reserveDecision(d: AdaptiveDocument, input: BudgetScope, now: number, reservation: string, phase: 'prepare' | 'learn') {
  const row = findDecisionTurn(d, input);
  if (!row || row.expiresAt <= now || row.revision !== input.revision || row.contextKey !== input.contextKey) return { reason: 'stale' as const };
  if (row.evaluations >= 2) return { reason: 'budget' as const };
  if (d.experience.predictionTurns.some(p => p.sessionId === input.sessionId && p.inFlightUntil > now)) return { reason: 'busy' as const };
  if (phase === 'prepare' && row.finalFingerprint) return { reason: 'stale' as const };
  if (phase === 'learn' && (!row.finalFingerprint || row.learningReservation)) return { reason: 'stale' as const };
  row.evaluations++; row.inFlightUntil = now + (phase === 'prepare' ? 1000 : 500);
  if (phase === 'prepare') row.reservation = reservation; else row.learningReservation = reservation;
  return { row };
}
export function sealDecisionTurn(d: AdaptiveDocument, input: BudgetScope, now: number, fingerprint: string, evidenceId: string) {
  const row = findDecisionTurn(d, input) ?? createDecisionTurn(d, input, now);
  if (!row || row.expiresAt <= now || row.contextKey !== input.contextKey || input.revision < row.revision) return undefined;
  // A duplicate final is never another learning attempt, even with same content.
  if (row.finalFingerprint) return undefined;
  row.revision = input.revision; row.finalFingerprint = fingerprint; row.learningEvidenceId = evidenceId;
  row.cancelled = true; row.expiresAt = now + 24 * 60 * 60_000;
  return row;
}
