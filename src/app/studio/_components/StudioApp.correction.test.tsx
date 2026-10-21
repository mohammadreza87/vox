import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudioApp, useNav } from './StudioApp';
const mocks = vi.hoisted(() => ({ me: vi.fn(), backs: new Set<() => void>(), show: vi.fn(), hide: vi.fn() }));
vi.mock('../_lib/client', () => ({ api: { me: mocks.me }, ApiError: class extends Error {}, haptic: { tap: vi.fn(), select: vi.fn() }, initTelegram: vi.fn(), tg: () => ({ BackButton: { show: mocks.show, hide: mocks.hide, onClick: (fn: () => void) => mocks.backs.add(fn), offClick: (fn: () => void) => mocks.backs.delete(fn) } }) }));
vi.mock('./Cloud', () => ({ Cloud: () => null }));
vi.mock('./UserInfo', () => ({ UserInfo: () => null }));
vi.mock('./screens/Home', () => ({ HomeScreen: function Home() { const nav = useNav(); return <><h1>Home probe</h1><button onClick={() => nav.push({ name: 'privacy' })}>Open privacy</button></>; } }));
vi.mock('./screens/Privacy', () => ({ PrivacyScreen: function Privacy({ onCorrectionPendingChange }: { onCorrectionPendingChange(token: string, pending: boolean): boolean }) {
  const nav = useNav(); return <><h1>Privacy probe</h1>
    <button onClick={() => onCorrectionPendingChange('one', true)}>Start one</button><button onClick={() => onCorrectionPendingChange('one', false)}>Finish one</button>
    <button onClick={() => onCorrectionPendingChange('two', true)}>Start two</button><button onClick={() => onCorrectionPendingChange('two', false)}>Finish two</button>
    <button onClick={() => nav.push({ name: 'home' })}>Probe push</button><button onClick={nav.back}>Probe back</button><button onClick={() => nav.reset({ name: 'home' })}>Probe reset</button>
  </>;
} }));
// No unrelated screen is reached by these guarded navigation cases.
beforeEach(() => { vi.clearAllMocks(); mocks.backs.clear(); mocks.me.mockResolvedValue({ member: { role: 'member', telegramId: 123 }, org: 'Synthetic' }); });
afterEach(cleanup);
it('disables Main navigation while a token owns Save and ignores an older release', async () => {
  render(<StudioApp />); await screen.findByRole('heading', { name: 'Home probe' });
  fireEvent.click(screen.getByRole('button', { name: 'You', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Start one' }));
  for (const name of ['Agents', 'Groups', 'Org', 'You']) expect(screen.getByRole('button', { name, exact: true })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Agents', exact: true })); await waitFor(() => expect(screen.getByRole('heading', { name: 'Privacy probe' })).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: 'Finish one' }));fireEvent.click(screen.getByRole('button', { name: 'Start two' }));
  fireEvent.click(screen.getByRole('button', { name: 'Finish one' })); expect(screen.getByRole('button', { name: 'Agents', exact: true })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Finish two' })); expect(screen.getByRole('button', { name: 'Agents', exact: true })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Agents', exact: true })); await waitFor(() => expect(screen.getByRole('heading', { name: 'Home probe' })).toBeVisible());
});
it('guards push/back/reset and the native Telegram callback, then releases after the owned result', async () => {
  render(<StudioApp />); fireEvent.click(await screen.findByRole('button', { name: 'Open privacy' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start one' }));
  for (const name of ['Probe push', 'Probe back', 'Probe reset']) { fireEvent.click(screen.getByRole('button', { name })); await waitFor(() => expect(screen.getByRole('heading', { name: 'Privacy probe' })).toBeVisible()); }
  act(() => { for (const back of mocks.backs) back(); }); await waitFor(() => expect(screen.getByRole('heading', { name: 'Privacy probe' })).toBeVisible());
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Finish one' }));
  const finishedUnload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(finishedUnload); expect(finishedUnload.defaultPrevented).toBe(false);
  act(() => { for (const back of [...mocks.backs]) back(); }); await screen.findByRole('heading', { name: 'Home probe' });
});
