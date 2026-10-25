/**
 * MemoryRecord v2 helpers (docs/AGENT_INTELLIGENCE_SOLUTION.md 4.3, L3 row).
 * Pure: no I/O and no logging. Every v2 field is optional on read; legacy rows
 * are viewed through memoryV2() with the documented defaults.
 */

import { createHash } from 'crypto';
import type { MemoryRecord, MemorySensitivity, MemorySpace, MemoryStatus, MemoryType } from '../types';

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
  fact: 5,
  decision: 7,
  preference: 6,
  event: 5,
  relationship: 5,
});

const STATUSES: ReadonlySet<string> = new Set<MemoryStatus>(['asserted', 'inferred', 'confirmed', 'disputed']);

function validDate(value: unknown): value is Date {
  return value instanceof Date && !isNaN(value.getTime());
}

/** Read-side view of the v2 fields with defaults; never mutates the record. */
export function memoryV2(m: MemoryRecord): MemoryV2View {
  const importance = typeof m.importance === 'number' && Number.isFinite(m.importance)
    ? Math.min(10, Math.max(1, Math.round(m.importance)))
    : DEFAULT_IMPORTANCE[m.type] ?? 5;
  const view: MemoryV2View = {
    space: m.space === 'personal' ? 'personal' : 'work',
    status: typeof m.status === 'string' && STATUSES.has(m.status) ? m.status : 'asserted',
    validFrom: validDate(m.validFrom) ? m.validFrom : m.source.at,
    importance,
    retrievalCount: typeof m.retrievalCount === 'number' && Number.isSafeInteger(m.retrievalCount) && m.retrievalCount >= 0
      ? m.retrievalCount : 0,
    subjectConfirmed: m.subjectConfirmed === true,
  };
  if (validDate(m.lastRetrievedAt)) view.lastRetrievedAt = m.lastRetrievedAt;
  if (validDate(m.expiresAt)) view.expiresAt = m.expiresAt;
  if (validDate(m.invalidatedAt)) view.invalidatedAt = m.invalidatedAt;
  return view;
}

/** sha256 hex of the NFKC-normalised, trimmed content. */
export function contentHash(content: string): string {
  return createHash('sha256').update(content.normalize('NFKC').trim()).digest('hex');
}

/**
 * Embeddings exist only for normal-sensitivity records. Returns a copy without
 * the embedding keys otherwise; the same reference when nothing changes.
 */
export function stripEmbeddingUnlessNormal<T extends Partial<MemoryRecord>>(record: T, sensitivity: MemorySensitivity | undefined): T {
  if (sensitivity === 'normal') return record;
  if (!('embedding' in record) && !('embeddingModel' in record) && !('embeddingVersion' in record)) return record;
  const copy = { ...record };
  delete copy.embedding;
  delete copy.embeddingModel;
  delete copy.embeddingVersion;
  return copy;
}
