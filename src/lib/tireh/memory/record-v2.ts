/**
 * Read-side view of the v2 memory fields (docs/AGENT_INTELLIGENCE_SOLUTION.md
 * section 4.3, L3 row). Every v2 field is optional on read: legacy rows get
 * these defaults. Pure functions, no I/O, never mutates the input record.
 */

import { createHash } from 'crypto';
import type { MemoryRecord, MemorySpace, MemoryStatus, MemoryType } from '../types';

export interface MemoryV2View {
  space: MemorySpace;
  status: MemoryStatus;
  validFrom: Date;
  importance: number;
  retrievalCount: number;
  subjectConfirmed: boolean;
  lastRetrievedAt?: Date;
  expiresAt?: Date;
  invalidatedAt?: Date;
}

export const DEFAULT_IMPORTANCE: Readonly<Record<MemoryType, number>> = Object.freeze({
  decision: 7,
  preference: 6,
  fact: 5,
  event: 5,
  relationship: 5,
});

const SPACES: readonly MemorySpace[] = ['work', 'personal'];
const STATUSES: readonly MemoryStatus[] = ['asserted', 'inferred', 'confirmed', 'disputed'];

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function memoryV2(m: MemoryRecord): MemoryV2View {
  const importance = typeof m.importance === 'number' && Number.isInteger(m.importance) && m.importance >= 1 && m.importance <= 10
    ? m.importance
    : DEFAULT_IMPORTANCE[m.type] ?? 5;
  const retrievalCount = typeof m.retrievalCount === 'number' && Number.isInteger(m.retrievalCount) && m.retrievalCount >= 0
    ? m.retrievalCount
    : 0;
  return {
    space: SPACES.includes(m.space as MemorySpace) ? m.space as MemorySpace : 'work',
    status: STATUSES.includes(m.status as MemoryStatus) ? m.status as MemoryStatus : 'asserted',
    validFrom: validDate(m.validFrom) ? m.validFrom : m.source.at,
    importance,
    retrievalCount,
    subjectConfirmed: m.subjectConfirmed === true,
    lastRetrievedAt: validDate(m.lastRetrievedAt) ? m.lastRetrievedAt : undefined,
    expiresAt: validDate(m.expiresAt) ? m.expiresAt : undefined,
    invalidatedAt: validDate(m.invalidatedAt) ? m.invalidatedAt : undefined,
  };
}

/** sha256 hex of the NFKC-normalised, trimmed content. */
export function contentHash(content: string): string {
  return createHash('sha256').update(content.normalize('NFKC').trim()).digest('hex');
}

/** Invalidated by a replacing record, or at an invalidation time that has passed (inclusive). */
export function isInvalidated(m: MemoryRecord, now: Date): boolean {
  return !!m.invalidatedBy || (validDate(m.invalidatedAt) && m.invalidatedAt.getTime() <= now.getTime());
}

/** Expired once expiresAt <= now. */
export function isExpired(m: MemoryRecord, now: Date): boolean {
  return validDate(m.expiresAt) && m.expiresAt.getTime() <= now.getTime();
}
