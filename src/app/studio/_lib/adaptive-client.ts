'use client';

import type { CorrectionInput } from '@/lib/adaptive/persistence/validation';
import type { AdaptiveOptionalPurpose, AdaptivePresentation, AdaptiveSnapshot, AdaptiveSpace } from '@/lib/adaptive/persistence/contracts';
import { request } from './client';
import type { MessageMemoryPreview, MessagePreviewInput, MessageAcceptInput } from '@/lib/adaptive/message-memory/contracts';
import type { PrivacyLocale } from './adaptive-copy';
import type { ReviewedMemoryPreview, ReviewedPreviewInput, ReviewedAcceptInput } from '@/lib/adaptive/reviewed-memory/contracts';

export type { AdaptiveOptionalPurpose, AdaptivePresentation, AdaptiveSnapshot, AdaptiveSpace };
const eventId = () => crypto.randomUUID();
export const adaptiveApi = {
  messagePreview: (input: MessagePreviewInput, signal?: AbortSignal) => request<MessageMemoryPreview>('POST', 'adaptive/message-memory/preview', input, 'json', signal),
  messageAccept: (input: MessageAcceptInput, signal?: AbortSignal) => request<{ memoryIds: string[]; snapshot: AdaptiveSnapshot }>('POST', 'adaptive/message-memory/accept', input, 'json', signal),
  reviewedPreview: (input: ReviewedPreviewInput, signal?: AbortSignal) => request<ReviewedMemoryPreview>('POST', 'adaptive/reviewed/preview', input, 'json', signal),
  reviewedAccept: (input: ReviewedAcceptInput, signal?: AbortSignal) => request<{ memoryId: string; snapshot: AdaptiveSnapshot }>('POST', 'adaptive/reviewed/accept', input, 'json', signal),
  read: (space: AdaptiveSpace, locale: PrivacyLocale) => request<AdaptiveSnapshot>('GET', `adaptive?space=${space}&locale=${locale}`),
  confirm: (space: AdaptiveSpace, adultConfirmed: boolean, declaredJurisdiction?: string) =>
    request<AdaptiveSnapshot>('POST', `adaptive/identity?space=${space}`, { confirm: true, adultConfirmed, ...(declaredJurisdiction ? { declaredJurisdiction } : {}) }),
  present: (space: AdaptiveSpace, purpose: AdaptiveOptionalPurpose, revision: number, locale: PrivacyLocale) =>
    request<AdaptivePresentation>('POST', 'adaptive/consents/present', { space, purpose, expectedRevision: revision, locale, eventId: eventId(), deliberateReopen: true }),
  consent: (space: AdaptiveSpace, purpose: AdaptiveOptionalPurpose, revision: number, state: 'granted' | 'declined' | 'withdrawn', receipt?: string) =>
    request<AdaptiveSnapshot>('PUT', 'adaptive/consents', { space, purpose, expectedRevision: revision, state, eventId: eventId(), ...(receipt ? { receipt } : {}) }),
  save: (space: AdaptiveSpace, text: string, revision: number) =>
    request<AdaptiveSnapshot>('POST', 'adaptive/memories', { space, text, expectedRevision: revision, eventId: eventId() }),
  correct: (id: string, input: CorrectionInput, signal?: AbortSignal, locale: PrivacyLocale = 'en') =>
    request<AdaptiveSnapshot>('PUT', `adaptive/memories/${encodeURIComponent(id)}?locale=${locale}`, input, 'json', signal),
  remove: (space: AdaptiveSpace, id: string, revision: number) =>
    request<AdaptiveSnapshot>('DELETE', `adaptive/memories/${encodeURIComponent(id)}`, { space, expectedRevision: revision, eventId: eventId() }),
  agent: (space: AdaptiveSpace, id: string, allowed: boolean, revision: number) =>
    request<AdaptiveSnapshot>('PUT', `adaptive/agents/${encodeURIComponent(id)}`, { space, allowed, expectedRevision: revision, eventId: eventId() }),
};
