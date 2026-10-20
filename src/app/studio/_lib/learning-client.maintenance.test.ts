import { expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({ request: transport, ApiError: class extends Error { constructor(readonly status: number, message: string) { super(message); } } }));
import { learningApi } from './learning-client';
import { unconfiguredMaintenanceHealth } from '@/lib/adaptive/lifecycle/maintenance-health-contracts';
it('operations validates health and forwards optional cancellation without fabricating metadata', async () => {
  const value = { maintenanceConfigured: false, maintenance: unconfiguredMaintenanceHealth(), improvementConfigured: false, report: null };
  transport.mockResolvedValue(value); const signal = new AbortController().signal;
  expect(await learningApi.operations(signal)).toEqual(value); expect(transport).toHaveBeenLastCalledWith('GET', 'learning/operations', undefined, 'json', signal);
});
it.each([undefined, null, {}, { ...unconfiguredMaintenanceHealth(), checkpoint: { checkpointedAccounts: 0 } }, { ...unconfiguredMaintenanceHealth(), state: 'completed' }])('missing/malformed old health is a sanitized unavailable read', async maintenance => {
  transport.mockResolvedValue({ maintenanceConfigured: false, maintenance, improvementConfigured: false, report: null });
  await expect(learningApi.operations()).rejects.toMatchObject({ status: 503, message: 'Maintenance status is unavailable.' });
});
