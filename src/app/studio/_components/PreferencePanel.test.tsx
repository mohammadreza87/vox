import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PreferencePanel } from './PreferencePanel';
import type { ExperienceSnapshot, PreferenceState } from '@/lib/adaptive/runtime/contracts';
const mocks = vi.hoisted(() => ({ preferenceState: vi.fn(), preference: vi.fn(), preferenceUndo: vi.fn() }));
vi.mock('../_lib/experience-client', () => ({ experienceApi: mocks }));
const state = (): PreferenceState => ({ schemaVersion: 1, revision: 10, receipt: 'receipt', agentId: 'agent1', space: 'work', entries: [
  { setting: { key: 'response_length', value: 'balanced' }, source: 'default', applied: false, explanation: 'default' },
  { setting: { key: 'language', value: 'auto' }, source: 'default', applied: false, explanation: 'default' },
  { setting: { key: 'formatting', value: 'plain' }, source: 'default', applied: false, explanation: 'default' },
] });
const snapshot = { schemaVersion: 1, revision: 11 } as ExperienceSnapshot;
const props = () => ({ agentId: 'agent1', space: 'work' as const, confirmed: true, revisionHint: 10, onSnapshot: vi.fn() });
function withUndo(): PreferenceState {
  const s = state(); s.entries[0] = { setting: { key: 'response_length', value: 'detailed' }, source: 'explicit', applied: true, explanation: 'explicit_choice',
    saved: { id: 'preference1', revision: 2, space: 'work', agentId: 'agent1', setting: { key: 'response_length', value: 'detailed' }, status: 'active', updatedAt: Date.now() },
    undo: { changeId: 'change-1', expiresAt: Date.now() + 60_000, restore: { setting: { key: 'response_length', value: 'brief' }, status: 'active' } } };
  return s;
}
/** A choice in a preference row; choosing saves (auto-save). */
const option = (row: string, name: string) => within(screen.getByRole('article', { name: `${row} preference` })).getByRole('tab', { name });
beforeEach(() => { vi.resetAllMocks(); mocks.preferenceState.mockResolvedValue(state()); mocks.preference.mockResolvedValue(snapshot); mocks.preferenceUndo.mockResolvedValue(snapshot); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('shows coded reasons for all three settings and saves only an explicit choice with CAS', async () => {
  const p = props(); render(<PreferencePanel {...p} />);
  await screen.findByLabelText('Reply language');
  await act(async () => { fireEvent.click(option('Reply language', 'Persian')); });
  expect(mocks.preference).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent1', space: 'work', expectedRevision: 10, action: 'set', setting: { key: 'language', value: 'fa' } }), expect.any(AbortSignal));
  expect(p.onSnapshot).toHaveBeenCalledWith(snapshot); expect(screen.getAllByText('No saved choice; the default style is used.')).toHaveLength(3);
});
it('shows an unapplied saved choice honestly and does not change consent', async () => {
  const s = withUndo(); s.entries[0].applied = false; s.entries[0].source = 'default'; s.entries[0].explanation = 'personalization_off';
  mocks.preferenceState.mockResolvedValue(s); render(<PreferencePanel {...props()} />);
  expect(await screen.findByText('Saved choice: Detailed')).toBeInTheDocument();
  expect(screen.getByText('Saved choices are not used because personalization is off or expired.')).toBeInTheDocument();
  expect(mocks.preference).not.toHaveBeenCalled(); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
it('explains what undo restores, sends one scoped command and waits for server confirmation', async () => {
  mocks.preferenceState.mockResolvedValueOnce(withUndo()).mockResolvedValue(state());
  let complete!: (result: ExperienceSnapshot) => void; mocks.preferenceUndo.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  render(<PreferencePanel {...props()} />); const undo = await screen.findByRole('button', { name: 'Undo last change' });
  expect(screen.getByText(/Undo restores: Brief/)).toBeInTheDocument(); fireEvent.click(undo); fireEvent.click(undo);
  expect(mocks.preferenceUndo).toHaveBeenCalledOnce(); expect(screen.queryByText('Last change undone.')).not.toBeInTheDocument();
  expect(mocks.preferenceUndo).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent1', space: 'work', expectedRevision: 10, changeId: 'change-1' }), expect.any(AbortSignal));
  await act(async () => complete(snapshot)); expect(await screen.findByText('Last change undone.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Undo last change' })).not.toBeInTheDocument();
});
it('requires refresh after a conflict and uses the refreshed revision for the next explicit save', async () => {
  mocks.preference.mockRejectedValueOnce(new Error('PRIVATE_SERVER_CANARY'));
  render(<PreferencePanel {...props()} />); await screen.findByRole('article', { name: 'Reply length preference' });
  fireEvent.click(option('Reply length', 'Brief'));
  const alert = await screen.findByRole('alert'); expect(alert).not.toHaveTextContent('PRIVATE_SERVER_CANARY'); expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
  mocks.preferenceState.mockResolvedValue({ ...state(), revision: 22 }); fireEvent.click(screen.getByRole('button', { name: 'Refresh preferences' }));
  await screen.findByRole('article', { name: 'Reply length preference' });
  await act(async () => { fireEvent.click(option('Reply length', 'Detailed')); });
  expect(mocks.preference.mock.calls.at(-1)?.[0].expectedRevision).toBe(22);
});
it('suppresses stale source responses after switching agent and space', async () => {
  let complete!: (value: PreferenceState) => void;
  mocks.preferenceState.mockReturnValueOnce(new Promise(resolve => { complete = resolve; })).mockImplementation(() => new Promise(() => {}));
  const p = props(), view = render(<PreferencePanel {...p} />);
  const signal = mocks.preferenceState.mock.calls[0][2] as AbortSignal;
  view.rerender(<PreferencePanel {...p} agentId="agent2" space="personal" />); expect(signal.aborted).toBe(true);
  await act(async () => complete(withUndo()));
  expect(screen.queryByLabelText('Reply length')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Undo last change' })).not.toBeInTheDocument();
});
it('reloads a newly selected scope even when its aggregate revision is identical', async () => {
  const p = props(), view = render(<PreferencePanel {...p} />);
  await screen.findByLabelText('Reply language');
  mocks.preferenceState.mockResolvedValue({ ...state(), space: 'personal', agentId: 'agent2' });
  view.rerender(<PreferencePanel {...p} agentId="agent2" space="personal" />);
  await screen.findByLabelText('Reply language');
  expect(mocks.preferenceState).toHaveBeenLastCalledWith('personal', 'agent2', expect.any(AbortSignal));
  expect(mocks.preferenceState).toHaveBeenCalledTimes(2);
});
it('clears old status and loading controls when profile confirmation disappears', async () => {
  mocks.preferenceState.mockImplementation(() => new Promise(() => {}));
  const p = props(), view = render(<PreferencePanel {...p} />);
  expect(screen.getByRole('status', { name: 'Loading preferences…' })).toBeInTheDocument();
  view.rerender(<PreferencePanel {...p} confirmed={false} />);
  expect(screen.getByText('Confirm your account profile in You first.')).toBeInTheDocument();
  expect(screen.queryByRole('status', { name: 'Loading preferences…' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('does not report or refresh a late mutation after unmount', async () => {
  let complete!: (value: ExperienceSnapshot) => void;
  mocks.preference.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  const p = props(), view = render(<PreferencePanel {...p} />); await screen.findByRole('article', { name: 'Reply length preference' });
  fireEvent.click(option('Reply length', 'Brief')); const signal = mocks.preference.mock.calls[0][1] as AbortSignal; view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => complete(snapshot)); expect(p.onSnapshot).not.toHaveBeenCalled(); expect(mocks.preferenceState).toHaveBeenCalledTimes(1);
});
it('lets a newly loaded scope save while an old command hangs, without the old completion unlocking the new command', async () => {
  let finishWork!: (value: ExperienceSnapshot) => void, finishPersonal!: (value: ExperienceSnapshot) => void;
  mocks.preference.mockReturnValueOnce(new Promise(resolve => { finishWork = resolve; }))
    .mockReturnValueOnce(new Promise(resolve => { finishPersonal = resolve; }));
  const p = props(), view = render(<PreferencePanel {...p} />);
  await screen.findByRole('article', { name: 'Reply length preference' }); fireEvent.click(option('Reply length', 'Brief'));
  mocks.preferenceState.mockResolvedValue({ ...state(), space: 'personal', agentId: 'agent2', revision: 12 });
  view.rerender(<PreferencePanel {...p} agentId="agent2" space="personal" revisionHint={12} />);
  await act(async () => {});
  await screen.findByRole('article', { name: 'Reply length preference' }); const save = option('Reply length', 'Brief');
  expect(save).toBeEnabled(); fireEvent.click(save);
  expect(mocks.preference).toHaveBeenCalledTimes(2);
  expect(mocks.preference.mock.calls[1][0]).toMatchObject({ space: 'personal', agentId: 'agent2', expectedRevision: 12 });
  await act(async () => finishWork(snapshot));
  expect(save).toBeDisabled(); expect(p.onSnapshot).not.toHaveBeenCalled();
  fireEvent.click(option('Reply length', 'Detailed')); expect(mocks.preference).toHaveBeenCalledTimes(2);
  await act(async () => finishPersonal({ ...snapshot, revision: 13 }));
  expect(p.onSnapshot).toHaveBeenCalledExactlyOnceWith({ ...snapshot, revision: 13 });
  expect(option('Reply length', 'Detailed')).toBeEnabled();
});
it('does not abandon a pending command when the parent catches up to its already-loaded revision', async () => {
  mocks.preferenceState.mockResolvedValueOnce({ ...state(), revision: 11 }).mockResolvedValue({ ...state(), revision: 12 });
  let complete!: (value: ExperienceSnapshot) => void;
  mocks.preference.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  const p = props(), view = render(<PreferencePanel {...p} />);
  const row = await screen.findByRole('article', { name: 'Reply language preference' });
  fireEvent.click(within(row).getByRole('button', { name: 'Reset' }));
  view.rerender(<PreferencePanel {...p} revisionHint={11} />);
  await act(async () => complete({ ...snapshot, revision: 12 }));
  expect(await screen.findByText('Saved.')).toBeInTheDocument();
  expect(p.onSnapshot).toHaveBeenCalledOnce();
  expect(option('Reply language', 'English')).toBeEnabled();
});
it('hides undo when its displayed deadline ends', async () => {
  vi.useFakeTimers();
  const s = withUndo(); s.entries[0].undo!.expiresAt = Date.now() + 1000;
  mocks.preferenceState.mockResolvedValue(s); render(<PreferencePanel {...props()} />); await act(async () => {});
  expect(screen.getByRole('button', { name: 'Undo last change' })).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
  expect(screen.queryByRole('button', { name: 'Undo last change' })).not.toBeInTheDocument();
});
it('exposes Persian RTL labels and a reset-preserving undo explanation', async () => {
  const s = withUndo(); s.entries[0].undo!.restore = { setting: { key: 'response_length', value: 'brief' }, status: 'reset' };
  mocks.preferenceState.mockResolvedValue(s); const view = render(<PreferencePanel {...props()} locale="fa" />);
  expect(await screen.findByLabelText('زبان پاسخ')).toBeInTheDocument(); expect(view.container.firstChild).toHaveAttribute('dir', 'rtl');
  expect(screen.getByText(/واگرد، بازنشانی قبلی را برمی‌گرداند/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'واگرد آخرین تغییر' })).toBeEnabled();
});
it('a same-scope replacement aborts the old command and lets a new command retain its generation ownership', async () => {
  let finishOld!: (value: ExperienceSnapshot) => void, finishNext!: (value: ExperienceSnapshot) => void;
  mocks.preference.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; })).mockReturnValueOnce(new Promise(resolve => { finishNext = resolve; }));
  const p = props(), view = render(<PreferencePanel {...p} />);
  await screen.findByRole('article', { name: 'Reply length preference' }); fireEvent.click(option('Reply length', 'Brief'));
  const oldSignal = mocks.preference.mock.calls[0][1] as AbortSignal;
  mocks.preferenceState.mockResolvedValue({ ...state(), revision: 12 }); view.rerender(<PreferencePanel {...p} revisionHint={12} />); await act(async () => {});
  expect(oldSignal.aborted).toBe(true); const save = option('Reply length', 'Brief');
  expect(save).toBeEnabled(); fireEvent.click(save); expect(mocks.preference).toHaveBeenCalledTimes(2);
  await act(async () => finishOld(snapshot)); expect(option('Reply length', 'Detailed')).toBeDisabled(); expect(p.onSnapshot).not.toHaveBeenCalled();
  await act(async () => finishNext({ ...snapshot, revision: 13 })); expect(option('Reply length', 'Detailed')).toBeEnabled(); expect(p.onSnapshot).toHaveBeenCalledExactlyOnceWith({ ...snapshot, revision: 13 });
});
