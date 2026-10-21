import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AnimatePresence, motion, MotionGlobalConfig } from 'framer-motion';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { AgentView } from '../../_lib/client';
import { FireScreen } from './Fire';

const mocks = vi.hoisted(() => ({ locale: 'en' as 'en' | 'fa', agent: vi.fn(), fire: vi.fn(), back: vi.fn(), reset: vi.fn(), toast: vi.fn(), heavy: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock('../../_lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, agent: mocks.agent, fire: mocks.fire },
    haptic: { tap: vi.fn(), select: vi.fn(), heavy: mocks.heavy, error: mocks.error, success: mocks.success } };
});
vi.mock('../StudioApp', () => ({
  useNav: () => ({ back: mocks.back, reset: mocks.reset, toast: mocks.toast, dir: mocks.locale === 'fa' ? 'rtl' : 'ltr', locale: mocks.locale, cache: new Map() }),
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : 'error'),
  LoadingFill: () => null,
}));

const agent = { id: 'a1', status: 'active', stage: 4, persona: { name: 'Nova', role: 'Designer' },
  look: { hue: 'sky', family: 'puff', features: { cheeks: true, lashes: false, brows: false } } } as unknown as AgentView;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.agent.mockResolvedValue({ agent });
  mocks.fire.mockResolvedValue({ agent: { ...agent, status: 'fired' } });
});

describe('Fire screen', () => {
  it('speaks Persian on a Persian session; the reason chips label the stored English reasons', async () => {
    mocks.locale = 'fa';
    render(<FireScreen id="a1" />);
    expect(await screen.findByRole('heading', { name: 'Nova اخراج شود؟' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'حافظه‌هایش' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /حذف برای همیشه/ })).toHaveClass('danger');
    const chip = screen.getByRole('button', { name: 'شروعی تازه' });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('برای تأیید، «Nova» را بنویسید')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Fire Nova|Why|Their memories|Hold to fire|Start fresh/);
  });

  it('chooses the memory policy from radio rows, delete in the danger tone', async () => {
    render(<FireScreen id="a1" />);
    const group = await screen.findByRole('radiogroup', { name: 'Their memories' });
    const radios = [...group.querySelectorAll('[role="radio"]')];
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /Delete forever/ }));
    expect(screen.getByRole('radio', { name: /Delete forever/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Delete forever/ })).toHaveClass('vx-row', 'danger');
    expect(group.querySelectorAll('.vx-radio')).toHaveLength(3);
  });

  it('shakes the name field once on blur when the typed name does not match', async () => {
    render(<FireScreen id="a1" />);
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'Nava' } });
    fireEvent.blur(input);
    expect(input).toHaveClass('vx-shake');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.error).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: 'nova' } });
    fireEvent.blur(input);
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('holds to fire, then says goodbye with the retiring character and a single heavy beat', async () => {
    const { container } = render(<FireScreen id="a1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not needed anymore' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Nova' } });
    const hold = screen.getByRole('button', { name: /Hold to fire Nova/ });
    await act(async () => { fireEvent.keyDown(hold, { key: 'Enter' }); });
    await waitFor(() => expect(mocks.fire).toHaveBeenCalledWith('a1', { reason: 'Not needed anymore', memoryPolicy: 'transfer', confirmName: 'Nova' }), { timeout: 3000 });
    expect(await screen.findByText('Goodbye, Nova')).toBeInTheDocument();
    expect(mocks.heavy).toHaveBeenCalledTimes(1);
    expect(mocks.success).not.toHaveBeenCalled();
    await waitFor(() => expect(container.querySelector('.vx-char')?.getAttribute('data-expr')).toBe('sleeping'));
  });

  it('backing out mid-hold never fires the agent, even while the screen is still leaving', async () => {
    MotionGlobalConfig.skipAnimations = false; // the hold must really take its 1.6 s here
    onTestFinished(() => { MotionGlobalConfig.skipAnimations = true; });
    // Like StudioApp's Page: the popped screen stays mounted (and its hold subscribed) through a long exit
    const Stack = ({ open }: { open: boolean }) => (
      <AnimatePresence>{open && <motion.div key="fire" exit={{ opacity: 0, transition: { duration: 3 } }}><FireScreen id="a1" /></motion.div>}</AnimatePresence>
    );
    const view = render(<Stack open />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not needed anymore' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Nova' } });
    await act(async () => { fireEvent.pointerDown(screen.getByRole('button', { name: /Hold to fire Nova/ })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(mocks.fire).not.toHaveBeenCalled(); // still holding
    view.rerender(<Stack open={false} />); // the route popped; no pointerup ever reaches the button
    await act(async () => { await new Promise((r) => setTimeout(r, 1800)); });
    expect(mocks.fire).not.toHaveBeenCalled();
    expect(mocks.heavy).not.toHaveBeenCalled();
    view.unmount();
  });

  it('the confirm face shows the agent’s real growth stage, like the retire moment', async () => {
    mocks.agent.mockResolvedValue({ agent: { ...agent, stage: 2 } });
    const { container } = render(<FireScreen id="a1" />);
    await screen.findByRole('heading', { name: 'Fire Nova?' });
    expect(container.querySelector('.vx-char')).toHaveAttribute('data-stage', '2');
  });
});
