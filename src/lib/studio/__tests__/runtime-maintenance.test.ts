import { describe, expect, it, vi } from 'vitest';
import { maintainAdaptiveAccount } from '../runtime';
import type { Studio } from '../service';

describe('independent maintenance cleanup', () => {
  it('attempts voice cleanup even if the separate Studio store is unavailable', async () => {
    const voice = vi.fn().mockResolvedValue({ pending: 0 });
    const studio = { deps: { store: { read: vi.fn().mockRejectedValue(new Error('store unavailable')) },
      observer: { process: vi.fn() }, voiceIdentity: { maintenanceAccount: voice } } } as unknown as Studio;
    await expect(maintainAdaptiveAccount(studio, 123)).rejects.toThrow('Adaptive maintenance incomplete');
    expect(voice).toHaveBeenCalledWith(123);
  });
  it('processes observations but retains a retryable failure while provider purge is pending', async () => {
    const observe = vi.fn().mockResolvedValue({ failed: 0 });
    const studio = { deps: { store: { read: vi.fn().mockResolvedValue({ members: [], agents: [] }) },
      observer: { process: observe }, voiceIdentity: { maintenanceAccount: vi.fn().mockResolvedValue({ pending: 1 }) } } } as unknown as Studio;
    await expect(maintainAdaptiveAccount(studio, 123)).rejects.toThrow('Adaptive maintenance incomplete');
    expect(observe).toHaveBeenCalledWith(123, { limit: 20, allowedAgentIds: [] });
  });
});
