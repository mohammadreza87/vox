import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivacyScreen } from './Privacy';
import type { AdaptiveSnapshot } from '../../_lib/adaptive-client';
import { expectNoRawControls, expectOneVolt } from '../ui.testing';

const mocks = vi.hoisted(() => ({ read: vi.fn(), confirm: vi.fn(), present: vi.fn(), consent: vi.fn(), save: vi.fn(), correct: vi.fn(), remove: vi.fn(), agent: vi.fn(), agents: vi.fn(),
  snack: vi.fn(), push: vi.fn(), nav: { current: null as unknown } }));
vi.mock('../../_lib/adaptive-client', () => ({ adaptiveApi: mocks }));
vi.mock('../ProductPausePanel', () => ({ ProductPausePanel: () => null }));
vi.mock('../VoiceRecognitionPanel', () => ({ VoiceRecognitionPanel: () => null }));
vi.mock('../Cloud', () => ({ AgentFace: () => null, Cloud: () => null }));
vi.mock('../../_lib/product-pause-client', () => ({ useProductPause: () => ({ coveredBlocked: false, status: null }) }));
vi.mock('../../_lib/client', async importOriginal => ({ ...await importOriginal<typeof import('../../_lib/client')>(), tg: () => null, api: { agents: mocks.agents } }));
vi.mock('./settings/useInboxBadge', () => ({ useInboxBadge: () => 0 }));
vi.mock('../StudioApp', () => ({ useNav: () => mocks.nav.current }));

/** The app-level nav the hub reads: locale and space live here, not in the screen. */
function Harness(props: Parameters<typeof PrivacyScreen>[0] & { role?: string }) {
  const [locale, setLocale] = useState<'en' | 'fa'>('en');
  const [space, setSpace] = useState<'work' | 'personal'>('work');
  mocks.nav.current = { locale, dir: locale === 'fa' ? 'rtl' : 'ltr', setLocale, space, setSpace, snack: mocks.snack, toast: mocks.snack, push: mocks.push, back: vi.fn(),
    tier: 'full', me: { org: 'HOOR', member: { telegramId: 1, name: 'Reza', role: props.role ?? 'member' } } };
  return <PrivacyScreen {...props} />;
}
const snapshot = (extra: Partial<AdaptiveSnapshot> = {}): AdaptiveSnapshot => ({
  schemaVersion: 1, revision: 2, space: 'work', scope: 'private_account_profile',
  identity: { accountId: 'synthetic-account', personId: 'synthetic-person', confirmed: true, verification: 'account_confirmation', adultDeclared: true },
  purposes: [{ purpose: 'optional.personalization', state: 'not_asked', revision: 1, available: true,
    notice: { id: 'synthetic-notice', version: 'synthetic-v1', title: 'Personalization terms', body: 'Synthetic exact notice.', copyHash: 'synthetic-hash', locale: 'en' } }],
  memories: [], agents: [], explicitMemoryAvailable: true, ...extra,
});
const tab = (name: string) => screen.getByRole('tab', { name, exact: true });
const note = (text: string) => screen.getByRole('button', { name: new RegExp(text) });
const chooseLanguage = async (label: string) => {
  fireEvent.click(screen.getByRole('button', { name: /^Language|^زبان/ }));
  fireEvent.click(await screen.findByRole('radio', { name: label }));
};
// Reset only this file's mocks: resetAllMocks would also wipe the shared matchMedia/IntersectionObserver stubs.
beforeEach(() => { for (const m of Object.values(mocks)) if (typeof m === 'function') m.mockReset(); mocks.read.mockResolvedValue(snapshot()); mocks.agents.mockResolvedValue({ agents: [] }); });
afterEach(cleanup);

describe('You hub', () => {
  it('reads locale and space from the app, with no per-screen language select', async () => {
    const { container } = render(<Harness />);
    await screen.findByRole('switch', { name: /^Personalization/ });
    expectOneVolt(container); expectNoRawControls(container);
    expect(mocks.read).toHaveBeenLastCalledWith('work', 'en');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('heading', { name: 'You' })).toBeVisible();
    fireEvent.click(tab('Personal'));
    await waitFor(() => expect(mocks.read).toHaveBeenLastCalledWith('personal', 'en'));
    expect(screen.getAllByRole('button', { name: /^Language/ })).toHaveLength(1);
  });

  it('does not grant anything on load or on a space switch and clears previous-space text immediately', async () => {
    mocks.read.mockResolvedValueOnce(snapshot({ memories: [{ id: 'private-note', text: 'WORK_ONLY_SECRET', revision: 1, createdAt: 1, expiresAt: 2_000_000_000_000 }] }));
    render(<Harness />);
    expect(await screen.findAllByText('WORK_ONLY_SECRET')).toHaveLength(1);
    mocks.read.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(tab('Personal'));
    await waitFor(() => expect(screen.queryAllByText('WORK_ONLY_SECRET')).toHaveLength(0));
    expect(mocks.consent).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('turning a purpose on opens the server notice; Keep off is as available as Turn on and nothing is granted first', async () => {
    const presented = snapshot({ purposes: [{ ...snapshot().purposes[0], state: 'presented', revision: 2 }] });
    mocks.present.mockResolvedValue({ ...presented, receipt: 'receipt-from-server', notice: presented.purposes[0].notice });
    mocks.consent.mockResolvedValue(snapshot({ purposes: [{ ...snapshot().purposes[0], state: 'declined', revision: 3 }] }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole('switch', { name: /^Personalization/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Personalization terms' });
    await waitFor(() => expect(within(sheet).getByText('Synthetic exact notice.')).toBeVisible());
    expect(within(sheet).getByText('synthetic-v1')).toBeVisible();
    expect(mocks.consent).not.toHaveBeenCalled();
    const on = within(sheet).getByRole('button', { name: 'Turn on' }), off = within(sheet).getByRole('button', { name: 'Keep off' });
    expect(on).toBeEnabled(); expect(off).toBeEnabled(); expect(on.className).toBe(off.className);
    fireEvent.click(off);
    await waitFor(() => expect(mocks.consent).toHaveBeenCalledWith('work', 'optional.personalization', 2, 'declined', 'receipt-from-server'));
  });

  it('turning a purpose off acts at once and offers Undo, which only reopens the notice', async () => {
    const granted = snapshot({ purposes: [{ ...snapshot().purposes[0], state: 'granted', revision: 4 }] });
    mocks.read.mockResolvedValue(granted);
    mocks.consent.mockResolvedValue(snapshot({ purposes: [{ ...snapshot().purposes[0], state: 'withdrawn', revision: 5 }] }));
    mocks.present.mockResolvedValue({ ...granted, receipt: 'fresh-receipt', notice: granted.purposes[0].notice });
    render(<Harness />);
    const toggle = await screen.findByRole('switch', { name: /^Personalization/ });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.consent).toHaveBeenCalledWith('work', 'optional.personalization', 4, 'withdrawn'));
    await waitFor(() => expect(mocks.snack).toHaveBeenCalledWith(expect.objectContaining({ message: 'Personalization is off.', action: expect.objectContaining({ label: 'Undo' }) })));
    const undo = mocks.snack.mock.calls.find(([s]) => s.action)![0].action;
    act(() => undo.run());
    await waitFor(() => expect(mocks.present).toHaveBeenCalledWith('work', 'optional.personalization', 5, 'en'));
    expect(mocks.consent).toHaveBeenCalledTimes(1);
  });

  it('never claims failed deletion succeeded and retains the visible authoritative note', async () => {
    mocks.read.mockResolvedValue(snapshot({ memories: [{ id: 'm', text: 'A synthetic note', revision: 4, createdAt: 1, expiresAt: 2_000_000_000_000 }] }));
    mocks.remove.mockRejectedValue(new Error('conflict'));
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: /A synthetic note/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Private note' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete', exact: true }));
    fireEvent.click(within(within(sheet).getByRole('group', { name: 'Delete this saved memory?' })).getByRole('button', { name: 'Delete', exact: true }));
    await within(sheet).findByRole('alert');
    expect(screen.getAllByText('A synthetic note')).toHaveLength(2);
    expect(mocks.snack).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'The saved memory was deleted.' }));
  });

  it('renders Persian RTL from the app locale with the same server purposes and no automatic consent', async () => {
    const { container } = render(<Harness />);
    await screen.findByRole('switch', { name: /^Personalization/ });
    await chooseLanguage('فارسی');
    await waitFor(() => expect(mocks.read).toHaveBeenLastCalledWith('work', 'fa'));
    await screen.findByRole('switch', { name: /^شخصی‌سازی/ });
    expect(container.querySelector('section')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'شما' })).toBeVisible();
    expect(mocks.consent).not.toHaveBeenCalled();
  });

  it('shows the Telegram account (user ID to share with an admin) from the identity section', async () => {
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: /^Telegram account/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Telegram account' });
    expect(within(sheet).getByText('1')).toBeVisible();
    expect(within(sheet).getByRole('button', { name: 'Copy user ID' })).toBeVisible();
  });

  it('shows the Admin section to owners only', async () => {
    const view = render(<Harness />);
    await screen.findByRole('switch', { name: /^Personalization/ });
    expect(screen.queryByRole('button', { name: 'Diagnostics' })).toBeNull();
    view.unmount();
    render(<Harness role="owner" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Privacy requests' }));
    expect(mocks.push).toHaveBeenCalledWith({ name: 'settings', page: 'requests' });
  });
});

it('renders an inherited unverified claim caveat alongside summary provenance in EN and FA', async () => {
  const summary = { id: 'summary', text: 'Inherited summary claim', revision: 1, createdAt: 1, expiresAt: 2_000_000_000_000,
    origin: 'user_reviewed_claim' as const, sourceRefs: [{ id: 'source-one', revision: 1 }, { id: 'source-two', revision: 1 }] };
  mocks.read.mockResolvedValue(snapshot({ memories: [summary] }));
  render(<Harness />);
  fireEvent.click(await screen.findByRole('button', { name: /Inherited summary claim/ }));
  let article = within(await screen.findByRole('dialog', { name: 'Private note' })).getByRole('article');
  expect(within(article).getByText('User-reviewed claim; not independently verified.')).toBeVisible();
  expect(within(article).getByText('Reviewed summary of 2 notes; deleting this summary keeps the originals.')).toBeVisible();
  await chooseLanguage('فارسی');
  fireEvent.click(await screen.findByRole('button', { name: /Inherited summary claim/ }));
  await screen.findByText('ادعای بررسی‌شدهٔ شما؛ به‌طور مستقل تأیید نشده است.');
  article = within(screen.getByRole('dialog', { name: 'یادداشت خصوصی' })).getByRole('article');
  expect(within(article).getByText('خلاصهٔ بررسی‌شده از 2 یادداشت؛ حذف خلاصه، اصل یادداشت‌ها را نگه می‌دارد.')).toBeVisible();
  expect(summary.revision).toBe(1); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.consent).not.toHaveBeenCalled();
});

it('serializes own-note corrections: the pending note sheet stays open and other notes stay locked until it lands', async () => {
  const notes = ['First own note', 'Second own note'].map((text, index) => ({ id: `note-${index}`, text, revision: 1, createdAt: 1, expiresAt: 2_000_000_000_000 }));
  const initial = snapshot({ memories: notes, memoryCorrectionAvailable: true }); mocks.read.mockResolvedValue(initial);
  const release: Array<(value: AdaptiveSnapshot) => void> = [];
  mocks.correct.mockImplementation(() => new Promise(resolve => release.push(resolve)));
  render(<Harness />);
  fireEvent.click(await screen.findByRole('button', { name: /First own note/ }));
  let sheet = await screen.findByRole('dialog', { name: 'Private note' });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Edit note' })); fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: 'Corrected 0' } });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Review correction' })); fireEvent.click(within(sheet).getByRole('button', { name: 'Save correction' }));
  const second = note('Second own note'); expect(second).toBeDisabled(); fireEvent.click(second);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1); expect(mocks.correct).toHaveBeenCalledOnce();
  const firstSaved = { ...notes[0], revision: 2, text: 'Corrected 0' };
  await act(async () => release[0]({ ...initial, revision: 3, memories: [firstSaved, notes[1]] }));
  expect(within(sheet).getByText('Corrected 0')).toBeVisible(); expect(second).toBeEnabled();
  fireEvent.click(second);
  sheet = await screen.findByRole('dialog', { name: 'Private note' });
  await waitFor(() => expect(within(sheet).getByText('Second own note')).toBeVisible());
  fireEvent.click(within(sheet).getByRole('button', { name: 'Edit note' })); fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: 'Corrected 1' } });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Review correction' })); fireEvent.click(within(sheet).getByRole('button', { name: 'Save correction' }));
  await act(async () => release[1]({ ...initial, revision: 4, memories: [firstSaved, { ...notes[1], revision: 2, text: 'Corrected 1' }] }));
  expect(note('Corrected 0')).toBeVisible(); expect(note('Corrected 1')).toBeVisible(); expect(mocks.correct).toHaveBeenCalledTimes(2);
});

it.each(['en', 'fa'] as const)('owns a pending %s correction without self-aborting or allowing competing scope/writes', async locale => {
  const n = { id: 'pending-note', text: 'Scoped original note', revision: 1, createdAt: 1, expiresAt: Date.now() + 86400_000 };
  const current = snapshot({ memoryCorrectionAvailable: true, memories: [n] }); mocks.read.mockImplementation((space: string) => Promise.resolve({ ...current, space, memories: space === 'work' ? [n] : [] }));
  let release!: (v: AdaptiveSnapshot) => void; mocks.correct.mockImplementation(() => new Promise(r => { release = r; }));
  const navigation = { shared: vi.fn(), experience: vi.fn(), connections: vi.fn(), pending: vi.fn(() => true) };
  render(<Harness onShared={navigation.shared} onExperience={navigation.experience} onConnections={navigation.connections} onCorrectionPendingChange={navigation.pending} />);
  await screen.findByRole('button', { name: /Scoped original note/ });
  const fa = locale === 'fa';
  if (fa) { await chooseLanguage('فارسی'); await screen.findByRole('switch', { name: /^شخصی‌سازی/ }); }
  fireEvent.click(note('Scoped original note'));
  const sheet = await screen.findByRole('dialog');
  fireEvent.click(within(sheet).getByRole('button', { name: fa ? 'ویرایش یادداشت' : 'Edit note' }));
  fireEvent.change(within(sheet).getByRole('textbox', { name: fa ? 'یادداشت اصلاح‌شده' : 'Corrected note' }), { target: { value: 'Scoped corrected note' } });
  fireEvent.click(within(sheet).getByRole('button', { name: fa ? 'بررسی اصلاح' : 'Review correction' })); fireEvent.click(within(sheet).getByRole('button', { name: fa ? 'ذخیرهٔ اصلاح' : 'Save correction' }));
  const signal = mocks.correct.mock.calls[0][2] as AbortSignal, token = mocks.correct.mock.calls[0][1].eventId;
  expect(signal.aborted).toBe(false); expect(navigation.pending).toHaveBeenCalledExactlyOnceWith(token, true);
  const personal = tab(fa ? 'شخصی' : 'Personal'), language = screen.getByRole('button', { name: fa ? /^زبان/ : /^Language/ });
  for (const control of [personal, language, within(sheet).getByRole('button', { name: fa ? 'انصراف' : 'Cancel', exact: true }), screen.getByRole('button', { name: fa ? 'ذخیرهٔ حافظهٔ خصوصی' : 'Save private memory' }), within(sheet).getByRole('button', { name: fa ? 'حذف' : 'Delete', exact: true })]) expect(control).toBeDisabled();
  fireEvent.click(personal); fireEvent.click(language); expect(personal).toHaveAttribute('aria-selected', 'false');
  expect(screen.queryByRole('radio')).toBeNull();
  for (const name of [fa ? 'ترجیح‌ها' : 'Preferences', fa ? 'اتصال‌ها' : 'Connections', fa ? 'حافظه‌های مشترک' : 'Shared memories']) { const button = screen.getByRole('button', { name }); expect(button).toBeDisabled(); fireEvent.click(button); }
  expect(navigation.shared).not.toHaveBeenCalled(); expect(navigation.experience).not.toHaveBeenCalled(); expect(navigation.connections).not.toHaveBeenCalled(); expect(signal.aborted).toBe(false); expect(mocks.correct).toHaveBeenCalledOnce();
  expect(screen.getByRole('switch', { name: fa ? /مکث وکس/ : /Pause Vox/ })).toBeEnabled();
  await act(async () => release({ ...current, revision: 3, memories: [{ ...n, text: 'Scoped corrected note', revision: 2 }] }));
  expect(navigation.pending).toHaveBeenLastCalledWith(token, false); expect(personal).toBeEnabled(); expect(screen.getAllByText('Scoped corrected note').length).toBeGreaterThan(0);
  fireEvent.click(personal); await waitFor(() => expect(screen.queryByText('Scoped corrected note')).not.toBeInTheDocument()); expect(mocks.read).toHaveBeenLastCalledWith('personal', locale);
});
