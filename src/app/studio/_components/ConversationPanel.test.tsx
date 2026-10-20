import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationPanel } from './ConversationPanel';
vi.mock('../_lib/product-pause-client', () => ({ useProductPause: () => controls.pause }));
const controls = vi.hoisted(() => ({ pause: { coveredBlocked: false, status: null as { productPaused: boolean; accountId: string; useEpoch: number } | null }, start: vi.fn(), update: vi.fn(), cancel: vi.fn(), suspend: vi.fn(), snapshot: vi.fn(), image: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/adaptive/prediction/client', () => ({
  predictionHttpTransport: () => ({}),
  LivePredictionConsumer: class { startTurn = controls.start; update = controls.update; cancel = controls.cancel; suspend = controls.suspend; snapshotTurn = controls.snapshot; },
}));
vi.mock('@/lib/adaptive/prediction/image-browser', () => ({ prepareSharedImage: controls.image }));
vi.mock('../_lib/preference-learning-client', () => ({ preferenceLearningApi: { cancel: vi.fn() } }));
vi.mock('../_lib/client', () => ({ tg: () => ({ initData: 'synthetic-signed-session' }) }));
beforeEach(() => { controls.pause.coveredBlocked = false; controls.pause.status = null; controls.snapshot.mockReturnValue(undefined); vi.clearAllMocks(); vi.stubGlobal('fetch', controls.fetch); });
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

it('keeps visible own history but disables its memory shortcut and drops pending output across pause', async () => {
  controls.fetch.mockResolvedValueOnce(Response.json({ reply: 'Visible own reply' }));
  const view = render(<ConversationPanel agentId="agent1" space="work" />);
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Own historical input' } }); fireEvent.click(screen.getByRole('button', { name: 'Send' })); await screen.findByText('Visible own reply');
  fireEvent.click(screen.getByRole('button', { name: 'Review this text for memory' })); expect(screen.getByLabelText('Exact selected text')).toHaveTextContent('Own historical input');
  let finish!: (value: Response) => void; controls.fetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Pending before pause' } }); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  const signal = controls.fetch.mock.calls.at(-1)![1].signal as AbortSignal;
  controls.pause.coveredBlocked = true; controls.pause.status = { productPaused: true, accountId: 'account', useEpoch: 1 };
  view.rerender(<ConversationPanel agentId="agent1" space="work" />);
  expect(screen.getByText('Visible own reply')).toBeVisible(); expect(screen.getByRole('button', { name: 'Review this text for memory' })).toBeDisabled(); expect(screen.queryByLabelText('Exact selected text')).toBeNull();
  expect(screen.getByLabelText('Prepare while I type')).toBeDisabled(); expect(screen.getByLabelText('Message')).toBeEnabled(); expect(signal.aborted).toBe(true);
  await act(async () => finish(Response.json({ reply: 'STALE_UNSENT_CANARY' }))); expect(screen.queryByText('STALE_UNSENT_CANARY')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Review current text for memory' })).toBeNull();
});
