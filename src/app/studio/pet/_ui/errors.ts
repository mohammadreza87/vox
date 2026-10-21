import type { PetErrorBody, PetErrorCode, PetPrivateView } from '@/lib/pet/types';
import type { PetApiError } from './contract';

/** What api.ts (and the mock) throw: `network` for fetch failures and aborts, else the server's code. */
export class PetError extends Error implements PetApiError {
  constructor(readonly status: number, readonly code: PetErrorCode | 'network', message: string, readonly body?: PetErrorBody | PetPrivateView) {
    super(message);
    this.name = 'PetError';
  }
}

export const isPetError = (e: unknown): e is PetError => e instanceof PetError;
