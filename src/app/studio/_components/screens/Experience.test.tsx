import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ExperienceScreen as Screen } from './Experience';
import { InboxPage, PreferencesPage, RemindersPage } from './settings/ExperiencePages';
import { useExperience } from './settings/useExperience';
import { inboxRows } from './settings/useInboxBadge';
import { ConfirmProvider } from '../ui';
import { expectNoRawControls, expectOneVolt } from '../ui.testing';
import { emptyExperience } from '@/lib/adaptive/runtime/contracts';
const pauseState = vi.hoisted(() => ({ session: 'experience-session', phase: 'ready', coveredBlocked: false, status: null as { productPaused: boolean; useEpoch: number; accountId: string } | null }));
vi.mock('../../_lib/product-pause-client', () => ({ useProductPause: () => pauseState }));
const mocks = vi.hoisted(() => ({ read: vi.fn(), preference: vi.fn(), preferenceState: vi.fn(), preferenceUndo: vi.fn(), settings: vi.fn(), reminderChannelPresent: vi.fn(), reminder: vi.fn(), feedback: vi.fn(), agents: vi.fn(), resolveNotification: vi.fn() }));
vi.mock('../LearningPanel', () => ({ LearningPanel: ({ space, locale }: { space: string; locale: string }) => <div data-testid="learning-panel" data-space={space} data-locale={locale} /> }));
vi.mock('../Cloud', () => ({ AgentFace: () => null, Cloud: () => null }));
vi.mock('../../_lib/experience-client', () => ({ experienceApi: mocks }));
vi.mock('../../_lib/client', async importOriginal => ({ ...await importOriginal<typeof import('../../_lib/client')>(), tg: () => ({ initData: pauseState.session }), api: mocks }));
const nav = vi.hoisted(() => ({ current: null as unknown, setLocale: null as unknown as (locale: 'en' | 'fa') => void, snack: null as unknown as ReturnType<typeof vi.fn>, push: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock('../StudioApp', () => ({ useNav: () => nav.current }));
/** App-level locale and space, as StudioApp provides them. */
function App({ render: view }: { render: () => React.ReactNode }) {
  const [locale, setLocale] = useState<'en' | 'fa'>('en'), [space, setSpace] = useState<'work' | 'personal'>('work');
  nav.setLocale = setLocale;
  nav.current = { locale, dir: locale === 'fa' ? 'rtl' : 'ltr', setLocale, space, setSpace, snack: nav.snack, toast: vi.fn(), push: nav.push, back: vi.fn(), tier: 'full', cache: new Map(),
    me: { member: { role: 'member' } } };
  // Children are created here, so a locale or space change re-renders them as StudioApp would.
  return <ConfirmProvider>{view()}</ConfirmProvider>;
}
const derivedTitle = 'A reply did not finish';
/** The shared data model, rendered plainly: the pause/account/space boundary rules live in the hook, not in any one page. */
function Probe() {
  const x = useExperience();
  return <section>
    {x.error && <p role="alert">{x.error}</p>}
    {x.data && <>
      <output aria-label="Daily cap">{x.settings.cap}</output>
      <button disabled={x.busy} onClick={() => void x.saveSettings({ cap: x.settings.cap })}>Save settings</button>
      <button onClick={() => void x.load()}>Reload</button>
      <select aria-label="Agent" className="vx-select" value={x.agentId} onChange={e => x.setAgentId(e.target.value)}><option value="" />{x.agents.map(a => <option key={a.id} value={a.id}>{a.persona.name}</option>)}</select>
      <ul>{inboxRows(x.data, x.pause.coveredBlocked).map(i => <li key={i.id}>{derivedTitle}</li>)}</ul>
      <ul>{x.data.inbox.filter(i => i.kind === 'requested_reminder').map(i => <li key={i.id}>{i.label}</li>)}</ul>
    </>}
  </section>;
}
const probe = () => <App render={() => <Probe />} />;
const page = (which: 'preferences' | 'inbox' | 'reminders') => <App render={() => which === 'preferences' ? <PreferencesPage /> : which === 'inbox' ? <InboxPage /> : <RemindersPage />} />;
const snapshot = () => ({ schemaVersion: 1, revision: 2, space: 'work', confirmed: true, settings: emptyExperience().settings,
  preferences: [], inbox: [], observations: { available: false, total: 0 },
  capabilities: { personalization: false, productAnalytics: false, proactiveInbox: false, reminders: false, decisions: false } });
const preferenceState = () => ({ schemaVersion: 1, revision: 2, receipt: 'receipt', agentId: 'agent', space: 'work', entries: [
  { setting: { key: 'response_length', value: 'balanced' }, source: 'default', applied: false, explanation: 'personalization_off' },
] });
const richSnapshot = (dailyCap = 7, space: 'work' | 'personal' = 'work') => ({ ...snapshot(), space, settings: { ...snapshot().settings, dailyCap }, inbox: [
  { id: 'old-derived', kind: 'reply_failed', dueAt: 1, createdAt: 1, status: 'unread' }, { id: 'requested-own', kind: 'requested_reminder', label: 'OWN_REQUESTED_KEEP', dueAt: 1, createdAt: 1, status: 'unread' },
] });
function experiencePause(epoch: number, paused: boolean, accountId = 'account-a', phase = 'ready') {
  pauseState.status = { productPaused: paused, useEpoch: epoch, accountId }; pauseState.coveredBlocked = paused || phase !== 'ready'; pauseState.phase = phase;
}
/** Picks the agent through the "Agent" row and its picker sheet. */
async function chooseAgent() {
  fireEvent.click(await screen.findByRole('button', { name: /^Agent:/ }));
  fireEvent.click(await screen.findByRole('radio', { name: 'Synthetic agent' }));
}
beforeEach(() => {
  pauseState.session = 'experience-session'; pauseState.phase = 'ready'; pauseState.coveredBlocked = false; pauseState.status = null;
  for (const m of Object.values(mocks)) m.mockReset();
  nav.snack = vi.fn(); nav.push = vi.fn();
  mocks.read.mockResolvedValue(snapshot()); mocks.preferenceState.mockResolvedValue(preferenceState());
  mocks.agents.mockResolvedValue({ agents: [{ id: 'agent', status: 'active', persona: { name: 'Synthetic agent' }, look: { hue: 'sky', family: 'puff', features: {} } }] });
});
afterEach(cleanup);

describe('Preferences page', () => {
  it('keeps category switches disabled without effective permissions and does not implicitly opt in', async () => {
    const view = render(page('preferences'));
    expect(await screen.findByRole('switch', { name: /Helpful suggestions/ })).toBeDisabled();
    expect(screen.getByRole('switch', { name: /Requested reminders/ })).toBeDisabled();
    expect(screen.getByRole('switch', { name: /Enable inbox/ })).toHaveAttribute('aria-checked', 'false');
    expect(mocks.settings).not.toHaveBeenCalled(); expect(mocks.preference).not.toHaveBeenCalled();
    expectOneVolt(view.container); expectNoRawControls(view.container);
  });
  it('auto-saves one switch with the whole settings document, and puts the server value back when refused', async () => {
    mocks.settings.mockRejectedValueOnce(new Error('conflict')).mockResolvedValueOnce({ ...snapshot(), settings: { ...snapshot().settings, work: { inboxEnabled: true, proactiveEnabled: false, reminderEnabled: false } } });
    render(page('preferences'));
    const inbox = await screen.findByRole('switch', { name: /Enable inbox/ });
    await act(async () => { fireEvent.click(inbox); });
    expect(mocks.settings).toHaveBeenLastCalledWith(expect.objectContaining({ space: 'work', expectedRevision: 2, inboxEnabled: true, proactiveEnabled: false, dailyCap: 2, quietStartHour: 21, quietEndHour: 8 }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The change was not confirmed');
    expect(inbox).toHaveAttribute('aria-checked', 'false');
    expect(nav.snack).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(inbox); });
    await waitFor(() => expect(inbox).toHaveAttribute('aria-checked', 'true'));
    expect(nav.snack).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
  });
  it('changes the daily limit with the stepper and quiet hours in their sheet', async () => {
    mocks.settings.mockImplementation(async (input: { dailyCap: number; quietStartHour: number }) => ({ ...snapshot(), settings: { ...snapshot().settings, dailyCap: input.dailyCap, quietStartHour: input.quietStartHour } }));
    render(page('preferences'));
    expect(await screen.findByRole('group', { name: 'Maximum suggestions per 24 hours' })).toHaveTextContent('2');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Maximum suggestions per 24 hours +' })); });
    expect(mocks.settings).toHaveBeenLastCalledWith(expect.objectContaining({ dailyCap: 3 }));
    expect(screen.getByRole('group', { name: 'Maximum suggestions per 24 hours' })).toHaveTextContent('3');
    fireEvent.click(screen.getByRole('button', { name: /Quiet hours/ }));
    await act(async () => { fireEvent.change(await screen.findByLabelText('Quiet hours start'), { target: { value: '23' } }); });
    expect(mocks.settings).toHaveBeenLastCalledWith(expect.objectContaining({ quietStartHour: 23, dailyCap: 3 }));
  });
  it('sends an explicit reset in the current space only and reports server failure honestly', async () => {
    mocks.preference.mockRejectedValue(new Error('conflict'));
    render(page('preferences'));
    await chooseAgent();
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
    render(page('preferences'));
    await chooseAgent();
    const row = await screen.findByRole('article', { name: 'Reply length preference' });
    expect(within(row).getByRole('tab', { name: 'Brief' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(row).getByRole('button', { name: 'Reset', exact: true }));
    await screen.findByText('Saved.');
    expect(within(screen.getByRole('article', { name: 'Reply length preference' })).getByRole('tab', { name: 'Balanced' })).toHaveAttribute('aria-selected', 'true');
  });
  it('binds PreferencePanel onSnapshot to the action’s original use boundary rather than the latest render', async () => {
    experiencePause(0, false); let finish!: (value: ReturnType<typeof richSnapshot>) => void; mocks.preference.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = render(page('preferences')); await chooseAgent();
    fireEvent.click(within(await screen.findByRole('article', { name: 'Reply length preference' })).getByRole('tab', { name: 'Brief' }));
    expect(mocks.preference).toHaveBeenCalledTimes(1); experiencePause(1, true); view.rerender(page('preferences')); experiencePause(2, false); view.rerender(page('preferences'));
    await act(async () => finish(richSnapshot(10)));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Maximum suggestions per 24 hours' })).toHaveTextContent('10'));
  });
  it('reads app-level locale and space: Persian RTL, and private data clears during a space change', async () => {
    const { container } = render(page('preferences'));
    await screen.findByRole('switch', { name: /Enable inbox/ });
    act(() => nav.setLocale('fa'));
    expect(container.querySelector('section')).toHaveAttribute('dir', 'rtl');
    expect(container.querySelector('section')).toHaveAttribute('lang', 'fa');
    mocks.read.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(screen.getByRole('tab', { name: 'شخصی', exact: true }));
    await waitFor(() => expect(screen.queryByRole('switch', { name: /فعال کردن صندوق/ })).not.toBeInTheDocument());
    expect(mocks.read).toHaveBeenLastCalledWith('personal');
  });
  it('keeps measurements and export one row away, for the current space', async () => {
    render(page('preferences'));
    fireEvent.click(await screen.findByRole('button', { name: /Measurements and export/ }));
    expect(await screen.findByTestId('learning-panel')).toHaveAttribute('data-space', 'work');
  });
});

describe('Reminders page', () => {
  it('clears private reminder text during a space change and renders Persian RTL', async () => {
    mocks.read.mockResolvedValueOnce({ ...snapshot(), inbox: [{ id: 'i', kind: 'requested_reminder', label: 'WORK_REMINDER_CANARY', dueAt: 1, createdAt: 1, status: 'unread' }] });
    const { container } = render(page('reminders'));
    await screen.findByText('WORK_REMINDER_CANARY');
    act(() => nav.setLocale('fa'));
    expect(container.querySelector('section')).toHaveAttribute('dir', 'rtl');
    mocks.read.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(screen.getByRole('tab', { name: 'شخصی', exact: true }));
    await waitFor(() => expect(screen.queryByText('WORK_REMINDER_CANARY')).not.toBeInTheDocument());
  });
  it('explains reminder renewal busy state without claiming the change was saved', async () => {
    mocks.read.mockResolvedValue({ ...snapshot(), reminderTelegram: { available: true, connected: true, enabled: true } });
    mocks.reminderChannelPresent.mockRejectedValue(new Error('reminder_delivery_busy'));
    render(page('reminders'));
    fireEvent.click(await screen.findByRole('button', { name: /Telegram alerts/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review 30-day renewal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A reminder is being dispatched');
    expect(nav.snack).not.toHaveBeenCalled();
  });
  it('creates a reminder for the chosen agent', async () => {
    mocks.read.mockResolvedValue({ ...snapshot(), capabilities: { ...snapshot().capabilities, reminders: true } });
    mocks.reminder.mockResolvedValue({ ...snapshot(), capabilities: { ...snapshot().capabilities, reminders: true } });
    const view = render(page('reminders'));
    fireEvent.click(await screen.findByRole('button', { name: /^For:/ }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Synthetic agent' }));
    fireEvent.change(screen.getByLabelText('Due time (your device local time)'), { target: { value: '2026-10-21T09:00' } });
    fireEvent.change(screen.getByLabelText('Reminder'), { target: { value: 'Send the deck' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create reminder' })); });
    expect(mocks.reminder).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent', label: 'Send the deck', space: 'work', expectedRevision: 2 }));
    expectOneVolt(view.container); expectNoRawControls(view.container);
  });
  it('opens a reminder alert’s deep link in its own space and marks the row', async () => {
    mocks.resolveNotification.mockResolvedValue({ space: 'work' });
    mocks.read.mockResolvedValue({ ...snapshot(), reminders: [{ id: 'deep', kind: 'requested_reminder', label: 'DEEP_LINKED', dueAt: 1, createdAt: 1, status: 'unread' }] });
    render(<App render={() => <Screen notificationId="deep" />} />);
    expect((await screen.findByText('DEEP_LINKED')).closest('article')).toHaveAttribute('aria-current', 'true');
    expect(mocks.resolveNotification).toHaveBeenCalledWith('deep');
  });
});

describe('Inbox page', () => {
  it('lists derived notices with an unread dot, marks one read on open and records feedback from its sheet', async () => {
    mocks.read.mockResolvedValue(richSnapshot());
    mocks.feedback.mockResolvedValue(richSnapshot());
    const view = render(page('inbox'));
    const row = await screen.findByRole('button', { name: `Unread: ${derivedTitle}` });
    expect(screen.queryByText('OWN_REQUESTED_KEEP')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(row); });
    expect(mocks.feedback).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'old-derived', action: 'read' }));
    expect(nav.snack).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Useful' })); });
    expect(mocks.feedback).toHaveBeenLastCalledWith(expect.objectContaining({ itemId: 'old-derived', action: 'useful' }));
    expectOneVolt(view.container); expectNoRawControls(view.container);
  });
  it('hides derived notices while pause covers them', async () => {
    experiencePause(0, true);
    mocks.read.mockResolvedValue(richSnapshot());
    render(page('inbox'));
    await screen.findByText(/paused/i);
    expect(screen.queryByText(derivedTitle)).toBeNull();
  });
  it('shows an empty state that leads to Preferences when the inbox is off', async () => {
    render(page('inbox'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Preferences' }));
    expect(nav.push).toHaveBeenCalledWith({ name: 'settings', page: 'preferences' });
  });
});

describe('Shared use boundary (pause, account, space)', () => {
  it('strips delayed pre-pause derived read rows after resume while keeping own requested reminders and settings', async () => {
    experiencePause(0, false); let finish!: (value: ReturnType<typeof richSnapshot>) => void; mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = render(probe()); await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1)); experiencePause(1, true); view.rerender(probe()); experiencePause(2, false); view.rerender(probe());
    await act(async () => finish(richSnapshot())); expect(screen.queryByText(derivedTitle)).toBeNull(); expect(screen.getByText('OWN_REQUESTED_KEEP')).toBeVisible(); expect(screen.getByLabelText('Daily cap')).toHaveTextContent('7'); expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled();
    expect(mocks.read).toHaveBeenCalledTimes(1); mocks.read.mockResolvedValueOnce(richSnapshot(8)); fireEvent.click(screen.getByRole('button', { name: 'Reload' })); await screen.findByText(derivedTitle); expect(screen.getByLabelText('Daily cap')).toHaveTextContent('8'); expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it('keeps a late settings mutation result but excludes derived rows acquired before pause and resume', async () => {
    experiencePause(0, false); let finish!: (value: ReturnType<typeof richSnapshot>) => void; mocks.settings.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = render(probe()); fireEvent.click(await screen.findByRole('button', { name: 'Save settings' })); expect(mocks.settings).toHaveBeenCalledTimes(1);
    experiencePause(1, true); view.rerender(probe()); experiencePause(2, false); view.rerender(probe()); await act(async () => finish(richSnapshot(9)));
    expect(screen.queryByText(derivedTitle)).toBeNull(); expect(screen.getByLabelText('Daily cap')).toHaveTextContent('9'); expect(screen.getByText('OWN_REQUESTED_KEEP')).toBeVisible(); expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled();
  });
  it.each(['pending', 'unknown'])('excludes read rows acquired before a %s transition with the same epoch', async phase => {
    experiencePause(0, false); let finish!: (value: ReturnType<typeof richSnapshot>) => void; mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(probe());
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1)); experiencePause(0, false, 'account-a', phase); view.rerender(probe()); experiencePause(0, false); view.rerender(probe()); await act(async () => finish(richSnapshot()));
    expect(screen.queryByText(derivedTitle)).toBeNull(); expect(screen.getByLabelText('Daily cap')).toHaveTextContent('7');
  });
  it.each(['account', 'session'])('rejects old primary/derived settings mutation after a %s switch', async change => {
    experiencePause(0, false); let finish!: (value: ReturnType<typeof richSnapshot>) => void; mocks.settings.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(probe());
    fireEvent.click(await screen.findByRole('button', { name: 'Save settings' })); mocks.read.mockResolvedValueOnce({ ...snapshot(), settings: { ...snapshot().settings, dailyCap: 11 } });
    if (change === 'account') experiencePause(0, false, 'account-b'); else pauseState.session = 'other-authenticated-session'; view.rerender(probe());
    await waitFor(() => expect(screen.getByLabelText('Daily cap')).toHaveTextContent('11')); await act(async () => finish(richSnapshot(19))); expect(screen.getByLabelText('Daily cap')).toHaveTextContent('11'); expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled(); expect(screen.queryByText(derivedTitle)).toBeNull(); expect(screen.queryByText('OWN_REQUESTED_KEEP')).toBeNull();
  });
  it.each(['account', 'space'])('rejects old primary and derived read data after a %s switch', async change => {
    experiencePause(0, false); let finish!: (value: ReturnType<typeof richSnapshot>) => void; mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(probe());
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1)); mocks.read.mockResolvedValueOnce({ ...snapshot(), space: change === 'space' ? 'personal' : 'work', settings: { ...snapshot().settings, dailyCap: 13 } });
    if (change === 'account') { experiencePause(0, false, 'account-b'); view.rerender(probe()); } else act(() => (nav.current as { setSpace(s: string): void }).setSpace('personal'));
    await waitFor(() => expect(screen.getByLabelText('Daily cap')).toHaveTextContent('13')); await act(async () => finish(richSnapshot(19))); expect(screen.getByLabelText('Daily cap')).toHaveTextContent('13'); expect(screen.queryByText(derivedTitle)).toBeNull(); expect(screen.queryByText('OWN_REQUESTED_KEEP')).toBeNull();
  });
  it('makes one genuinely fresh initial read after unknown admission, keeping normal first inbox rows usable', async () => {
    pauseState.coveredBlocked = true; pauseState.phase = 'initial'; let finish!: (value: ReturnType<typeof richSnapshot>) => void;
    mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(richSnapshot(12)); const view = render(probe()); await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    experiencePause(0, false); view.rerender(probe()); await screen.findByText(derivedTitle); expect(screen.getByLabelText('Daily cap')).toHaveTextContent('12'); expect(mocks.read).toHaveBeenCalledTimes(2);
    await act(async () => finish(richSnapshot(18))); expect(screen.getByLabelText('Daily cap')).toHaveTextContent('12'); expect(screen.getByText(derivedTitle)).toBeVisible(); view.rerender(probe()); expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it('reacquires inbox after status verification while keeping the selected agent mounted', async () => {
    experiencePause(0, false); mocks.read.mockResolvedValueOnce(richSnapshot(7));
    const view = render(probe());
    await screen.findByText(derivedTitle);
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'agent' } });
    let finish!: (value: ReturnType<typeof richSnapshot>) => void;
    mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    experiencePause(0, false, 'account-a', 'loading'); view.rerender(probe());
    expect(screen.queryByText(derivedTitle)).toBeNull();
    experiencePause(0, false); view.rerender(probe());
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Agent')).toHaveValue('agent');
    expect(screen.queryByText(derivedTitle)).toBeNull();
    await act(async () => finish(richSnapshot(12)));
    expect(screen.getByText(derivedTitle)).toBeVisible();
    expect(screen.getByLabelText('Agent')).toHaveValue('agent');
    expect(screen.getByLabelText('Daily cap')).toHaveTextContent('12');
    view.rerender(probe()); expect(mocks.read).toHaveBeenCalledTimes(2);
  });
});
