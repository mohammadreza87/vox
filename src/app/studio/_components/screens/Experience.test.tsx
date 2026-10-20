import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExperienceScreen } from './Experience';
import { emptyExperience } from '@/lib/adaptive/runtime/contracts';
const pauseState = vi.hoisted(() => ({ session: 'experience-session', phase: 'ready', coveredBlocked: false, status: null as { productPaused: boolean; useEpoch: number; accountId: string } | null }));
vi.mock('../../_lib/product-pause-client', () => ({ useProductPause: () => pauseState }));
const mocks = vi.hoisted(() => ({ read: vi.fn(), preference: vi.fn(), preferenceState: vi.fn(), preferenceUndo: vi.fn(), settings: vi.fn(), reminderChannelPresent: vi.fn(), reminder: vi.fn(), feedback: vi.fn(), agents: vi.fn() }));
vi.mock('../LearningPanel', () => ({ LearningPanel: ({ space, locale }: { space: string; locale: string }) => <div data-testid="learning-panel" data-space={space} data-locale={locale} /> }));
vi.mock('../../_lib/experience-client', () => ({ experienceApi: mocks }));
vi.mock('../../_lib/client', () => ({ tg: () => ({ initData: pauseState.session }), api: mocks }));
const snapshot = () => ({ schemaVersion: 1, revision: 2, space: 'work', confirmed: true, settings: emptyExperience().settings,
  preferences: [], inbox: [], observations: { available: false, total: 0 },
  capabilities: { personalization: false, productAnalytics: false, proactiveInbox: false, reminders: false, decisions: false } });
const preferenceState = () => ({ schemaVersion: 1, revision: 2, receipt: 'receipt', agentId: 'agent', space: 'work', entries: [
  { setting: { key: 'response_length', value: 'balanced' }, source: 'default', applied: false, explanation: 'personalization_off' },
] });
beforeEach(() => { pauseState.session = 'experience-session'; pauseState.phase = 'ready'; pauseState.coveredBlocked = false; pauseState.status = null; vi.resetAllMocks(); mocks.read.mockResolvedValue(snapshot()); mocks.preferenceState.mockResolvedValue(preferenceState()); mocks.agents.mockResolvedValue({ agents: [{ id: 'agent', status: 'active', persona: { name: 'Synthetic agent' } }] }); });
afterEach(cleanup);
describe('Experience controls', () => {
  it('keeps category switches disabled without effective permissions and does not implicitly opt in', async () => {
    render(<ExperienceScreen onBack={() => undefined} />);
    expect(await screen.findByLabelText('Helpful suggestions')).toBeDisabled();
    expect(screen.getByLabelText('Requested reminders')).toBeDisabled();
    expect(screen.getByLabelText('Enable inbox')).not.toBeChecked();
    expect(mocks.settings).not.toHaveBeenCalled(); expect(mocks.preference).not.toHaveBeenCalled();
  });
  it('sends an explicit reset in the current space only and reports server failure honestly', async () => {
    mocks.preference.mockRejectedValue(new Error('conflict'));
    render(<ExperienceScreen onBack={() => undefined} />);
    fireEvent.change(await screen.findByLabelText('Agent'), { target: { value: 'agent' } });
    fireEvent.click(within(await screen.findByRole('article', { name: 'Reply length preference' })).getByRole('button', { name: 'Reset', exact: true }));
    await screen.findByRole('alert');
    expect(mocks.preference).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'reset', agentId: 'agent', space: 'work', expectedRevision: 2 }), expect.any(AbortSignal));
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
  });
  it('shows the default reply length after the server confirms an explicit reset', async () => {
    mocks.read.mockResolvedValue({ ...snapshot(), preferences: [{ agentId: 'agent', setting: { key: 'response_length', value: 'brief' }, status: 'active' }] });
    mocks.preferenceState.mockResolvedValueOnce({ ...preferenceState(), entries: [{ setting: { key: 'response_length', value: 'brief' }, source: 'explicit', applied: true,
      explanation: 'explicit_choice', saved: { id: 'saved', revision: 1, space: 'work', agentId: 'agent', setting: { key: 'response_length', value: 'brief' }, status: 'active', updatedAt: 1 } }] }).mockResolvedValue(preferenceState());
    mocks.preference.mockResolvedValue(snapshot());
    render(<ExperienceScreen onBack={() => undefined} />);
    fireEvent.change(await screen.findByLabelText('Agent'), { target: { value: 'agent' } });
    expect(await screen.findByLabelText('Reply length')).toHaveValue('brief');
    fireEvent.click(within(screen.getByRole('article', { name: 'Reply length preference' })).getByRole('button', { name: 'Reset', exact: true }));
    await screen.findByText('Saved.');
    expect(screen.getByLabelText('Reply length')).toHaveValue('balanced');
  });
  it('clears private reminder text during a space change and renders Persian RTL', async () => {
    mocks.read.mockResolvedValueOnce({ ...snapshot(), inbox: [{ id: 'i', kind: 'requested_reminder', label: 'WORK_REMINDER_CANARY' }] });
    const { container } = render(<ExperienceScreen onBack={() => undefined} />);
    await screen.findByText('WORK_REMINDER_CANARY');
    fireEvent.click(screen.getByRole('button', { name: 'فارسی' }));
    expect(container.querySelector('section')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('learning-panel')).toHaveAttribute('data-locale', 'fa');
    mocks.read.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(screen.getByRole('button', { name: 'شخصی', exact: true }));
    await waitFor(() => expect(screen.queryByText('WORK_REMINDER_CANARY')).not.toBeInTheDocument());
    expect(screen.getByTestId('learning-panel')).toHaveAttribute('data-space', 'personal');
  });
});

it('explains reminder renewal busy state without claiming the change was saved', async () => {
  mocks.read.mockResolvedValue({ ...snapshot(), reminderTelegram: { available: true, connected: true, enabled: true } });
  mocks.reminderChannelPresent.mockRejectedValue(new Error('reminder_delivery_busy'));
  render(<ExperienceScreen onBack={() => undefined} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review 30-day renewal' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A reminder is being dispatched');
  expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
});

const experienceElement = () => <ExperienceScreen onBack={() => undefined} />;
function experiencePause(epoch: number, paused: boolean, accountId = 'account-a', phase = 'ready') {
  pauseState.status = { productPaused: paused, useEpoch: epoch, accountId }; pauseState.coveredBlocked = paused || phase !== 'ready'; pauseState.phase = phase;
}
const derivedTitle = 'A reply did not finish. You can try again when convenient.';
const richSnapshot = (dailyCap = 7, space: 'work' | 'personal' = 'work') => ({ ...snapshot(), space, settings: { ...snapshot().settings, dailyCap }, inbox: [
  { id: 'old-derived', kind: 'reply_failed', dueAt: 1, status: 'unread' }, { id: 'requested-own', kind: 'requested_reminder', label: 'OWN_REQUESTED_KEEP', dueAt: 1, status: 'unread' },
] });
it('strips delayed pre-pause derived read rows after resume while keeping own requested reminders and settings', async () => {
  experiencePause(0, false); let finish!: (value: ReturnType<typeof richSnapshot>) => void; mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(experienceElement()); await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1)); experiencePause(1, true); view.rerender(experienceElement()); experiencePause(2, false); view.rerender(experienceElement());
  await act(async () => finish(richSnapshot())); expect(screen.queryByText(derivedTitle)).toBeNull(); expect(screen.getByText('OWN_REQUESTED_KEEP')).toBeVisible(); expect(screen.getByLabelText('Maximum suggestions per 24 hours')).toHaveValue(7); expect(screen.getByRole('button', { name: 'Save notification settings' })).toBeEnabled();
  expect(mocks.read).toHaveBeenCalledTimes(1); mocks.read.mockResolvedValueOnce(richSnapshot(8)); fireEvent.click(screen.getByRole('button', { name: 'Refresh experience settings' })); await screen.findByText(derivedTitle); expect(screen.getByLabelText('Maximum suggestions per 24 hours')).toHaveValue(8); expect(mocks.read).toHaveBeenCalledTimes(2);
});
it('keeps a late settings mutation result but excludes derived rows acquired before pause and resume', async () => {
  experiencePause(0, false); let finish!: (value: ReturnType<typeof richSnapshot>) => void; mocks.settings.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(experienceElement()); fireEvent.click(await screen.findByRole('button', { name: 'Save notification settings' })); expect(mocks.settings).toHaveBeenCalledTimes(1);
  experiencePause(1, true); view.rerender(experienceElement()); experiencePause(2, false); view.rerender(experienceElement()); await act(async () => finish(richSnapshot(9)));
  expect(screen.queryByText(derivedTitle)).toBeNull(); expect(screen.getByLabelText('Maximum suggestions per 24 hours')).toHaveValue(9); expect(screen.getByText('OWN_REQUESTED_KEEP')).toBeVisible(); expect(screen.getByRole('button', { name: 'Save notification settings' })).toBeEnabled();
});
it('binds PreferencePanel onSnapshot to the action’s original use boundary rather than the latest render', async () => {
  experiencePause(0, false); let finish!: (value: ReturnType<typeof richSnapshot>) => void; mocks.preference.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(experienceElement()); fireEvent.change(await screen.findByLabelText('Agent'), { target: { value: 'agent' } }); fireEvent.click(within(await screen.findByRole('article', { name: 'Reply length preference' })).getByRole('button', { name: 'Save preference' }));
  expect(mocks.preference).toHaveBeenCalledTimes(1); experiencePause(1, true); view.rerender(experienceElement()); experiencePause(2, false); view.rerender(experienceElement()); await act(async () => finish(richSnapshot(10)));
  await waitFor(() => expect(screen.getByLabelText('Maximum suggestions per 24 hours')).toHaveValue(10)); expect(screen.queryByText(derivedTitle)).toBeNull(); expect(screen.getByText('OWN_REQUESTED_KEEP')).toBeVisible();
});
it.each(['pending', 'unknown'])('excludes read rows acquired before a %s transition with the same epoch', async phase => {
  experiencePause(0, false); let finish!: (value: ReturnType<typeof richSnapshot>) => void; mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(experienceElement());
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1)); experiencePause(0, false, 'account-a', phase); view.rerender(experienceElement()); experiencePause(0, false); view.rerender(experienceElement()); await act(async () => finish(richSnapshot()));
  expect(screen.queryByText(derivedTitle)).toBeNull(); expect(screen.getByLabelText('Maximum suggestions per 24 hours')).toHaveValue(7);
});
it.each(['account', 'session'])('rejects old primary/derived settings mutation after a %s switch', async change => {
  experiencePause(0, false); let finish!: (value: ReturnType<typeof richSnapshot>) => void; mocks.settings.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(experienceElement());
  fireEvent.click(await screen.findByRole('button', { name: 'Save notification settings' })); mocks.read.mockResolvedValueOnce({ ...snapshot(), settings: { ...snapshot().settings, dailyCap: 11 } });
  if (change === 'account') experiencePause(0, false, 'account-b'); else pauseState.session = 'other-authenticated-session'; view.rerender(experienceElement());
  await waitFor(() => expect(screen.getByLabelText('Maximum suggestions per 24 hours')).toHaveValue(11)); await act(async () => finish(richSnapshot(19))); expect(screen.getByLabelText('Maximum suggestions per 24 hours')).toHaveValue(11); expect(screen.getByRole('button', { name: 'Save notification settings' })).toBeEnabled(); expect(screen.queryByText(derivedTitle)).toBeNull(); expect(screen.queryByText('OWN_REQUESTED_KEEP')).toBeNull();
});
it.each(['account', 'space'])('rejects old primary and derived read data after a %s switch', async change => {
  experiencePause(0, false); let finish!: (value: ReturnType<typeof richSnapshot>) => void; mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(experienceElement());
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1)); mocks.read.mockResolvedValueOnce({ ...snapshot(), space: change === 'space' ? 'personal' : 'work', settings: { ...snapshot().settings, dailyCap: 13 } });
  if (change === 'account') { experiencePause(0, false, 'account-b'); view.rerender(experienceElement()); } else fireEvent.click(screen.getByRole('button', { name: 'Personal', exact: true }));
  await waitFor(() => expect(screen.getByLabelText('Maximum suggestions per 24 hours')).toHaveValue(13)); await act(async () => finish(richSnapshot(19))); expect(screen.getByLabelText('Maximum suggestions per 24 hours')).toHaveValue(13); expect(screen.queryByText(derivedTitle)).toBeNull(); expect(screen.queryByText('OWN_REQUESTED_KEEP')).toBeNull();
});
it('makes one genuinely fresh initial read after unknown admission, keeping normal first inbox rows usable', async () => {
  pauseState.coveredBlocked = true; pauseState.phase = 'initial'; let finish!: (value: ReturnType<typeof richSnapshot>) => void;
  mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(richSnapshot(12)); const view = render(experienceElement()); await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
  experiencePause(0, false); view.rerender(experienceElement()); await screen.findByText(derivedTitle); expect(screen.getByLabelText('Maximum suggestions per 24 hours')).toHaveValue(12); expect(mocks.read).toHaveBeenCalledTimes(2);
  await act(async () => finish(richSnapshot(18))); expect(screen.getByLabelText('Maximum suggestions per 24 hours')).toHaveValue(12); expect(screen.getByText(derivedTitle)).toBeVisible(); view.rerender(experienceElement()); expect(mocks.read).toHaveBeenCalledTimes(2);
});

it('reacquires inbox after status verification while keeping the selected agent mounted', async () => {
  experiencePause(0, false); mocks.read.mockResolvedValueOnce(richSnapshot(7));
  const view = render(experienceElement());
  await screen.findByText(derivedTitle);
  fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'agent' } });
  await screen.findByLabelText('Reply length');
  let finish!: (value: ReturnType<typeof richSnapshot>) => void;
  mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  experiencePause(0, false, 'account-a', 'loading'); view.rerender(experienceElement());
  expect(screen.queryByText(derivedTitle)).toBeNull();
  experiencePause(0, false); view.rerender(experienceElement());
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText('Agent')).toHaveValue('agent');
  expect(screen.queryByText(derivedTitle)).toBeNull();
  await act(async () => finish(richSnapshot(12)));
  expect(screen.getByText(derivedTitle)).toBeVisible();
  expect(screen.getByLabelText('Agent')).toHaveValue('agent');
  expect(screen.getByLabelText('Maximum suggestions per 24 hours')).toHaveValue(12);
  view.rerender(experienceElement()); expect(mocks.read).toHaveBeenCalledTimes(2);
});
