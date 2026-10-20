'use client';
import type { ClientObservationInput, CorrectionObservationInput, ObserverSnapshot } from '@/lib/adaptive/observation/contracts';
import { request } from './client';
import type { ImprovementWorkflow } from '@/lib/adaptive/improvement/workflow';

export type { ObserverSnapshot };
export type LearningSpace = 'work' | 'personal';
// Export is a server-allowlisted document; do not assemble it from client state.
export type LearningExport = Record<string, unknown>;
export interface LearningOperations { maintenanceConfigured: boolean; improvementConfigured: boolean; report: Awaited<ReturnType<ImprovementWorkflow['report']>> | null }
export const learningApi = {
  read: (space: LearningSpace) => request<ObserverSnapshot>('GET', `learning/observations?space=${space}`),
  process: (space: LearningSpace) => request<ObserverSnapshot>('POST', `learning/observations/process?space=${space}`, {}),
  export: (space: LearningSpace) => request<LearningExport>('GET', `learning/export?space=${space}`),
  operations: () => request<LearningOperations>('GET', 'learning/operations'),
  correctionAuthority: (space: LearningSpace, signal?: AbortSignal) => request<{ policyReceipt: string | null }>('POST', 'learning/correction-authority', { space }, 'json', signal),
  correction: (input: CorrectionObservationInput, signal?: AbortSignal) => request<{ recorded: boolean; duplicate: boolean }>('POST', 'learning/corrections', input, 'json', signal),
  event: (input: ClientObservationInput, signal?: AbortSignal) => request<{ recorded: boolean; duplicate: boolean; eventId?: string }>('POST', 'learning/events', input, 'json', signal),
};
