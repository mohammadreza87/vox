import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationPanel } from './ConversationPanel';
const controls = vi.hoisted(() => ({ start: vi.fn(), update: vi.fn(), cancel: vi.fn(), suspend: vi.fn(), snapshot: vi.fn(), image: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/adaptive/prediction/client', () => ({
  predictionHttpTransport: () => ({}),
  LivePredictionConsumer: class { startTurn = controls.start; update = controls.update; cancel = controls.cancel; suspend = controls.suspend; snapshotTurn = controls.snapshot; },
}));
vi.mock('@/lib/adaptive/prediction/image-browser', () => ({ prepareSharedImage: controls.image }));
vi.mock('../_lib/preference-learning-client', () => ({ preferenceLearningApi: { cancel: vi.fn() } }));
vi.mock('../_lib/client', () => ({ tg: () => ({ initData: 'synthetic-signed-session' }) }));
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', controls.fetch); });
afterEach(() => vi.unstubAllGlobals());
describe('scoped conversation UI', () => {
  it('keeps drafts local until Send with preparation off by default', async () => {
    controls.fetch.mockResolvedValue(Response.json({ reply: 'Scoped answer' }));
    render(<ConversationPanel agentId="agent1" space="personal" />);
    expect(screen.getByLabelText('Prepare while I type')).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'A private message' } });
    expect(controls.fetch).not.toHaveBeenCalled(); expect(controls.update).toHaveBeenCalledWith(expect.objectContaining({ stable: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Scoped answer');
    expect(JSON.parse(controls.fetch.mock.calls[0][1].body)).toEqual({ agentId: 'agent1', space: 'personal', text: 'A private message' });
  });
  it('late image decoding uses the corrected draft, never the old text', async () => {
    let finish!: (value: string) => void;
    controls.image.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<ConversationPanel agentId="agent1" space="work" />);
    fireEvent.click(screen.getByLabelText('Prepare while I type'));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'PRIVATE_OLD_DRAFT_CANARY' } });
    fireEvent.change(screen.getByLabelText('Image (optional)'), { target: { files: [new File(['source'], 'image.png', { type: 'image/png' })] } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Corrected message instead' } });
    controls.update.mockClear();
    await act(async () => { finish('data:image/png;base64,cGl4ZWxz'); });
    expect(controls.update).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'Corrected message instead', image: expect.any(Object) }));
    expect(JSON.stringify(controls.update.mock.calls)).not.toContain('PRIVATE_OLD_DRAFT_CANARY');
  });
  it('changing space aborts the old response and clears private displayed lines', async () => {
    let finish!: (value: Response) => void;
    controls.fetch.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<ConversationPanel agentId="agent1" space="work" />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Work question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const signal = controls.fetch.mock.calls[0][1].signal as AbortSignal;
    view.rerender(<ConversationPanel agentId="agent1" space="personal" />);
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(Response.json({ reply: 'WORK_ONLY_CANARY' })); });
    expect(screen.queryByText('WORK_ONLY_CANARY')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toHaveValue('');
  });
  it('exposes Persian labels and safe failure without echoing provider errors', async () => {
    controls.fetch.mockResolvedValue(Response.json({ error: 'PRIVATE_PROVIDER_CANARY' }, { status: 503 }));
    render(<ConversationPanel agentId="agent1" space="work" locale="fa" />);
    fireEvent.change(screen.getByLabelText('پیام'), { target: { value: 'سلام، لطفاً کمک کن' } });
    fireEvent.click(screen.getByRole('button', { name: 'ارسال' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).not.toHaveTextContent('PRIVATE_PROVIDER_CANARY');
    expect(screen.getByRole('log').closest('section')).toHaveAttribute('dir', 'rtl');
  });
});
it('reuses one logical turn regardless of preparation toggle and supplies it only as correlation on final Send', async () => {
  const turn = { sessionId: 'logical-session', turnId: 'logical-turn', revision: 4, contextKey: 'logical-context' };
  controls.snapshot.mockReturnValue(turn); controls.fetch.mockResolvedValue(Response.json({ reply: 'Correlated answer' }));
  render(<ConversationPanel agentId="agent1" space="work" />);
  expect(controls.start).toHaveBeenCalledOnce(); fireEvent.click(screen.getByLabelText('Prepare while I type')); fireEvent.click(screen.getByLabelText('Prepare while I type'));
  expect(controls.start).toHaveBeenCalledOnce(); fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Please keep replies brief.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); await screen.findByText('Correlated answer');
  expect(JSON.parse(controls.fetch.mock.calls[0][1].body).turn).toEqual(turn); expect(controls.suspend).toHaveBeenCalled(); expect(controls.start).toHaveBeenCalledTimes(2);
});
