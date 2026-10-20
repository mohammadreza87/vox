import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaintenanceHealth, ObserverSnapshot } from '../_lib/learning-client';
import { LearningPanel } from './LearningPanel';
const mocks = vi.hoisted(() => ({ read: vi.fn(), process: vi.fn(), export: vi.fn(), operations: vi.fn() }));
vi.mock('../_lib/learning-client', () => ({ learningApi: mocks }));
function snapshot(space: 'work' | 'personal' = 'work'): ObserverSnapshot {
  return { schemaVersion: 1, version: 'vox-observer-v1', space, available: true,
    projection: { space, sourceDigest: 'PRIVATE_DIGEST', sourceEvents: 4, responded: 2, failed: 1, cancelled: 0,
      unknownResponses: 0, taskOutcomesUnknown: 3, timedResponses: 0, responseTurns: 3, meanResponseMs: null,
      playbackStarted: 1, playbackCompleted: 0, playbackFailed: 1, interruptions: 0, playbackUnknown: 2, findings: [] }, findings: [],
    queue: { pending: 1, leased: 0, failed: 0, oldestPendingAgeMs: 10, lastProcessedAt: null },
    completeness: { complete: false, acceptedEvents: 4, processedEvents: 3, pendingEvents: 1, failedEvents: 0, samplingRate: 1, retentionMs: 604800000,
      coverage: 'instrumented_response_and_client_playback_only', playbackEvidence: 'client_unverified', verifiedTaskSuccess: null, providerUsage: null, language: null, release: null } };
}
function maintenance(checkpointedPages = 42): MaintenanceHealth {
  return { version: 1, state: 'completed', observedAt: 1000, leaseExpiresAt: null, reason: null,
    checkpoint: { updatedAt: 900, recordedStatus: 'completed', checkpointedPages, checkpointedAccounts: 7, failure: null } };
}
const operations = (health: unknown = maintenance()) => ({ maintenanceConfigured: false, maintenance: health, improvementConfigured: false, report: null });
beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue(snapshot()); mocks.process.mockResolvedValue(snapshot()); mocks.operations.mockResolvedValue(operations({ version: 1, state: 'not_configured', observedAt: null, checkpoint: null, leaseExpiresAt: null, reason: 'health_not_configured' })); mocks.export.mockResolvedValue({ schemaVersion: 1, space: 'work', records: [] }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('Learning evidence', () => {
  it('shows partial evidence and queue health without exposing raw identifiers or inferring task success', async () => {
    const value = snapshot();
    value.findings = [{ id: 'PRIVATE_FINDING', space: 'work', rule: 'playback_failure', ruleVersion: 1, evidenceIds: ['PRIVATE_EVENT'], count: 1,
      observed: 'client_reported_playback_failure', inferredCause: null, alternatives: ['network_or_device_failure'], confidence: 'observation_only', reproducibleFrom: 'journal_events' }];
    mocks.read.mockResolvedValue(value);
    const { container } = render(<LearningPanel space="work" />);
    await screen.findByText('Responses completed');
    expect(screen.getByText(/Waiting to process/)).toHaveTextContent('Waiting to process: 1 · Processing failures: 0');
    expect(screen.getByText(/Verified task success is unknown/)).toBeInTheDocument();
    expect(screen.getByText(/Playback failures were reported by the client/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/PRIVATE_|network_or_device_failure/);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh measurements' }));
    await screen.findByText(/Measurements refreshed/);
    expect(mocks.process).toHaveBeenCalledWith('work');
  });
  it('distinguishes unavailable analytics from zero counts and supports Persian RTL', async () => {
    mocks.read.mockResolvedValue({ ...snapshot('personal'), available: false });
    const { container } = render(<LearningPanel space="personal" locale="fa" />);
    await screen.findByText(/تحلیل اختیاری استفاده/);
    expect(container.querySelector('section')).toHaveAttribute('dir', 'rtl');
    expect(container.querySelector('dd')).toHaveTextContent('در دسترس نیست');
    expect(screen.getByText('فضای شخصی شما')).toBeInTheDocument();
  });
  it('discards a refresh from the previous space and permits the new space to load', async () => {
    let finish!: (value: ObserverSnapshot) => void;
    mocks.process.mockReturnValue(new Promise<ObserverSnapshot>(resolve => { finish = resolve; }));
    const { rerender } = render(<LearningPanel space="work" />);
    await screen.findByText('Responses completed');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh measurements' }));
    mocks.read.mockResolvedValue({ ...snapshot('personal'), available: false });
    rerender(<LearningPanel space="personal" />);
    await screen.findByText(/Optional usage analytics is off/);
    await act(async () => finish(snapshot()));
    expect(screen.getByText('Your Personal space')).toBeInTheDocument();
    expect(screen.queryByText(/Measurements refreshed/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh measurements' })).toBeEnabled();
  });
  it('retries an initial load failure through bounded processing', async () => {
    mocks.read.mockRejectedValue(new Error('server failure'));
    render(<LearningPanel space="work" />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry measurements' }));
    await screen.findByText('Responses completed');
    expect(mocks.process).toHaveBeenCalledWith('work');
  });
  it('downloads only the server export for the selected space and releases the temporary URL', async () => {
    const create = vi.fn(() => 'blob:synthetic-export'); const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    mocks.read.mockResolvedValue(snapshot('personal'));
    render(<LearningPanel space="personal" />);
    await screen.findByText('Responses completed');
    fireEvent.click(screen.getByRole('button', { name: 'Export my learning data' }));
    await screen.findByText('Your JSON download is ready.');
    expect(mocks.export).toHaveBeenCalledWith('personal');
    expect(click.mock.instances[0]).toHaveAttribute('download', 'vox-learning-personal.json');
    expect(create).toHaveBeenCalledWith(expect.any(Blob)); expect(revoke).toHaveBeenCalledWith('blob:synthetic-export');
  });
  it('shows minimized operator status only when requested and preserves unavailable report evidence', async () => {
    const { rerender } = render(<LearningPanel space="work" />);
    await screen.findByText('Responses completed');
    expect(mocks.operations).not.toHaveBeenCalled();
    rerender(<LearningPanel space="work" showOperations />);
    await screen.findByText('Local workflow report: unavailable.');
    expect(screen.getByText(/CI, deployment, production impact and cost: unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Maintenance: Not configured/)).toBeInTheDocument();
  });
  it('shows aggregate operator evidence without exposing candidate IDs or audit digests', async () => {
    mocks.operations.mockResolvedValue({ maintenanceConfigured: true, maintenance: maintenance(), improvementConfigured: true, report: {
      auditEvents: 4, auditHead: 'PRIVATE_AUDIT', candidates: [{ candidateId: 'PRIVATE_CANDIDATE', evaluationStatus: 'passed', humanDecision: 'approve' }],
    } });
    const { container } = render(<LearningPanel space="work" showOperations />);
    await screen.findByText('Audit events: 4 · Candidates: 1');
    expect(screen.getByText('Evaluations passed: 1 · Signed approvals: 1')).toBeInTheDocument();
    expect(container.textContent).not.toContain('PRIVATE_');
  });
  it('discards a pending export after switching spaces', async () => {
    let finish!: (value: object) => void;
    mocks.export.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const create = vi.fn(); Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    const { rerender } = render(<LearningPanel space="work" />);
    await screen.findByText('Responses completed');
    fireEvent.click(screen.getByRole('button', { name: 'Export my learning data' }));
    mocks.read.mockResolvedValue(snapshot('personal'));
    rerender(<LearningPanel space="personal" />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledWith('personal'));
    await act(async () => finish({ space: 'work' }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByText('Your JSON download is ready.')).not.toBeInTheDocument();
  });

  it('keeps configuration separate from retained maintenance failure and lease evidence', async () => {
    mocks.operations.mockResolvedValue(operations({ ...maintenance(), state: 'leased', leaseExpiresAt: 2000,
      checkpoint: { ...maintenance().checkpoint!, recordedStatus: 'failed', failure: 'sweep_failed' } }));
    const { container } = render(<LearningPanel space="work" showOperations />);
    await screen.findByText('Worker lease recorded');
    expect(screen.getByText(/Maintenance: Not configured/)).toBeInTheDocument();
    expect(screen.getByText('A maintenance failure was recorded.')).toBeInTheDocument();
    expect(screen.getByText('System-wide status, independent of your selected space. This view does not run maintenance.')).toBeInTheDocument();
    expect(mocks.operations).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(mocks.process).not.toHaveBeenCalled(); expect(mocks.export).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/sweep_failed|workerId|cursor|accountId/);
  });

  it('clears old progress while refreshing, rejects duplicate refresh and sanitizes failed reads', async () => {
    mocks.operations.mockResolvedValue(operations());
    render(<LearningPanel space="work" showOperations />);
    const panel = screen.getByRole('region', { name: 'Software improvement operations' });
    await within(panel).findByText('Pages in recorded progress');
    let fail!: (error: Error) => void;
    mocks.operations.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    const refresh = within(panel).getByRole('button', { name: 'Refresh operations' });
    fireEvent.click(refresh); fireEvent.click(refresh);
    expect(mocks.operations).toHaveBeenCalledTimes(2);
    expect(within(panel).queryByText('Pages in recorded progress')).not.toBeInTheDocument();
    expect(panel).toHaveAttribute('aria-busy', 'true');
    await act(async () => fail(new Error('PRIVATE_ACCOUNT_CURSOR_FAILURE')));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Operations evidence is unavailable. Refresh to try again.');
    expect(panel.textContent).not.toContain('PRIVATE_');
    expect(within(panel).queryByText('Pages in recorded progress')).not.toBeInTheDocument();
    mocks.operations.mockResolvedValueOnce(operations(maintenance(9)));
    fireEvent.click(within(panel).getByRole('button', { name: 'Refresh operations' }));
    await within(panel).findByText('Pages in recorded progress');
    expect(within(panel).getByText('Pages in recorded progress').nextElementSibling).toHaveTextContent('9');
  });

  it('aborts a previous-space refresh and discards its late result without changing personal evidence behavior', async () => {
    mocks.operations.mockResolvedValueOnce(operations());
    const { rerender } = render(<LearningPanel space="work" showOperations />);
    await screen.findByText('Pages in recorded progress');
    let finish!: (value: ReturnType<typeof operations>) => void;
    mocks.operations.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh operations' }));
    const pendingSignal = mocks.operations.mock.calls.at(-1)![0] as AbortSignal;
    mocks.operations.mockResolvedValueOnce(operations(maintenance(99)));
    mocks.read.mockResolvedValueOnce(snapshot('personal'));
    rerender(<LearningPanel space="personal" showOperations />);
    expect(pendingSignal.aborted).toBe(true);
    await screen.findByText('Pages in recorded progress');
    await act(async () => finish(operations(maintenance(999))));
    expect(screen.getByText('Pages in recorded progress').nextElementSibling).toHaveTextContent('99');
    expect(screen.getByText('Your Personal space')).toBeInTheDocument();
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it('aborts on operator-view removal and ignores the old refresh after access is restored', async () => {
    mocks.operations.mockResolvedValueOnce(operations());
    const { rerender } = render(<LearningPanel space="work" showOperations />);
    await screen.findByText('Pages in recorded progress');
    let finish!: (value: ReturnType<typeof operations>) => void;
    mocks.operations.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh operations' }));
    const pendingSignal = mocks.operations.mock.calls.at(-1)![0] as AbortSignal;
    rerender(<LearningPanel space="work" />);
    expect(pendingSignal.aborted).toBe(true);
    expect(screen.queryByRole('region', { name: 'Software improvement operations' })).not.toBeInTheDocument();
    mocks.operations.mockResolvedValueOnce(operations(maintenance(10)));
    rerender(<LearningPanel space="work" showOperations />);
    await screen.findByText('Pages in recorded progress');
    await act(async () => finish(operations(maintenance(999))));
    expect(screen.getByText('Pages in recorded progress').nextElementSibling).toHaveTextContent('10');
  });

  it('aborts the pending initial operator read on unmount', async () => {
    let finish!: (value: ReturnType<typeof operations>) => void;
    mocks.operations.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const { unmount } = render(<LearningPanel space="work" showOperations />);
    const pendingSignal = mocks.operations.mock.calls[0][0] as AbortSignal;
    unmount(); expect(pendingSignal.aborted).toBe(true);
    await act(async () => finish(operations()));
  });

  it('reads operations once without polling or processing actions as time advances', async () => {
    vi.useFakeTimers(); mocks.operations.mockResolvedValue(operations());
    render(<LearningPanel space="work" showOperations />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => vi.advanceTimersByTime(60000));
    expect(mocks.operations).toHaveBeenCalledTimes(1);
    expect(mocks.process).not.toHaveBeenCalled(); expect(mocks.export).not.toHaveBeenCalled();
  });
});
