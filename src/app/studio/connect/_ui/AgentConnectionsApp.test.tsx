import { act, cleanup, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../_lib/client';
import type { AgentConnectionsHandoff } from '@/lib/connections/contracts';
const m = vi.hoisted(() => ({ api: { read: vi.fn(), confirm: vi.fn(), enroll: vi.fn(), mcpEnroll: vi.fn(), resources: vi.fn(), setup: vi.fn(), claim: vi.fn(), cancelSetup: vi.fn(), mcpPreview: vi.fn(), mcpClaim: vi.fn(), mcpCancel: vi.fn(), grant: vi.fn(), revoke: vi.fn(), task: vi.fn(), review: vi.fn(), approve: vi.fn(), execute: vi.fn() },
  bridge: { initData: 'SYNTHETIC_SIGNED_ALPHA', initDataUnsafe: { user: { language_code: 'en' } }, isActive: true, ready: vi.fn(), expand: vi.fn(), onEvent: vi.fn(), offEvent: vi.fn() }, factory: vi.fn() }));
vi.mock('../../_lib/agent-connections-client', () => ({ createAgentConnectionsApi: m.factory }));
vi.mock('../../_lib/client', async importOriginal => ({ ...await importOriginal<typeof import('../../_lib/client')>(), tg: () => m.bridge, initTelegram: vi.fn() }));
vi.mock('../../_lib/connections-client', () => ({ openConnectionSignIn: vi.fn() }));
import { AgentConnectionsApp } from './AgentConnectionsApp';
const handoff = (name = 'Synthetic Alpha', id = 'alpha'): AgentConnectionsHandoff => ({ agent: { id, name }, manageInVox: true });
const NOTE = 'Your connected apps are in Vox. Open Vox to see them or change what this agent may use.';
let frames: FrameRequestCallback[];
beforeEach(() => {
  vi.clearAllMocks(); m.factory.mockReturnValue(m.api); m.api.read.mockResolvedValue(handoff()); m.bridge.initData = 'SYNTHETIC_SIGNED_ALPHA'; m.bridge.isActive = true; m.bridge.initDataUnsafe.user.language_code = 'en';
  frames = []; vi.stubGlobal('requestAnimationFrame', vi.fn((fn: FrameRequestCallback) => { frames.push(fn); return frames.length; })); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('window', window); Object.defineProperty(window, 'Telegram', { configurable: true, value: { WebApp: m.bridge } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('agent-bot Connections page (content-free handoff to Vox, decision 8)', () => {
  it('hydrates server English markup with a Persian Telegram session without a React recovery', async () => {
    const html = renderToString(<AgentConnectionsApp agentId="alpha" />);
    const container = document.createElement('div'); container.innerHTML = html; document.body.append(container);
    m.bridge.initDataUnsafe.user.language_code = 'fa';
    const recoveries: unknown[] = []; let root!: ReturnType<typeof hydrateRoot>;
    try {
      await act(async () => { root = hydrateRoot(container, <AgentConnectionsApp agentId="alpha" />, { onRecoverableError: error => recoveries.push(error) }); });
      await within(container).findByRole('heading', { name: 'اتصال‌ها' });
      expect(recoveries).toEqual([]); expect(within(container).getByRole('main')).toHaveAttribute('dir', 'rtl');
    } finally { await act(async () => root?.unmount()); container.remove(); }
  });
  it('shows only the agent and a pointer to Vox: no connection, account, space or control', async () => {
    render(<AgentConnectionsApp agentId="alpha" />);
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
    expect(screen.getByText('Synthetic Alpha')).toBeInTheDocument();
    expect(m.api.read).toHaveBeenCalledWith();
    expect(screen.queryByRole('heading', { name: 'Your connections' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Space' })).not.toBeInTheDocument();
    for (const name of ['Choose access', 'Connect', 'Disconnect this account', 'Confirm my account', 'Continue', 'Finish setup', 'Allow selected access', 'Start task'])
      expect(screen.queryByRole('button', { name, exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    for (const call of [m.api.confirm, m.api.enroll, m.api.mcpEnroll, m.api.setup, m.api.grant, m.api.revoke, m.api.task, m.api.resources, m.api.review, m.api.approve, m.api.execute])
      expect(call).not.toHaveBeenCalled();
  });
  it('never names another agent the server did not answer for', async () => {
    m.api.read.mockResolvedValue(handoff('OTHER_AGENT_CANARY', 'beta'));
    render(<AgentConnectionsApp agentId="alpha" />);
    await screen.findByText(NOTE);
    expect(screen.queryByText('OTHER_AGENT_CANARY')).not.toBeInTheDocument(); expect(screen.getByText('This agent')).toBeInTheDocument();
  });
  it('drops the old signed account before a new request answers', async () => {
    m.api.read.mockResolvedValueOnce(handoff('OLD_AGENT_NAME')).mockImplementation(() => new Promise(() => {}));
    const view = render(<AgentConnectionsApp agentId="alpha" />); await screen.findByText('OLD_AGENT_NAME');
    m.bridge.initData = 'SYNTHETIC_OTHER_PERSON'; act(() => frames.at(-1)!(0)); expect(screen.queryByText('OLD_AGENT_NAME')).not.toBeInTheDocument();
    view.rerender(<AgentConnectionsApp agentId="beta" />); expect(m.factory).toHaveBeenLastCalledWith('beta', 'SYNTHETIC_OTHER_PERSON', expect.any(Function));
  });
  it('a refused session shows the error, not the pointer', async () => {
    m.api.read.mockRejectedValue(new ApiError(403, 'agent_unavailable'));
    render(<AgentConnectionsApp agentId="alpha" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This agent is unavailable for your account.');
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });
  it('supports Persian RTL and a native focusable language control', async () => {
    m.bridge.initDataUnsafe.user.language_code = 'fa'; render(<AgentConnectionsApp agentId="alpha" />);
    await screen.findByRole('heading', { name: 'اتصال‌ها' }); expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl');
    const language = screen.getByRole('combobox', { name: 'زبان' }); language.focus(); expect(language).toHaveFocus();
    expect(await screen.findByText('برنامه‌های وصل‌شدهٔ شما در وکس هستند. برای دیدن آن‌ها یا تغییر آنچه این عامل می‌تواند به کار ببرد، وکس را باز کنید.')).toBeInTheDocument();
  });
});
