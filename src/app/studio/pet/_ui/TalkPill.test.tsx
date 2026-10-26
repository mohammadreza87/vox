import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickMicType } from './mic';
import { loadMic, TalkPill, type TalkPillProps } from './TalkPill';

function setup(over: Partial<TalkPillProps> = {}) {
  const p = {
    name: 'Mochi', onListen: vi.fn(), onIdle: vi.fn(), onTypingPause: vi.fn(), onSend: vi.fn(), onVoice: vi.fn(), onRecording: vi.fn(),
    ...over,
  } satisfies TalkPillProps;
  render(<TalkPill {...p} />);
  return { p, input: screen.getByRole('textbox', { name: 'Talk to Mochi' }) };
}

/** A MediaRecorder double: records until stop(), then hands one chunk over. */
class FakeRecorder {
  static isTypeSupported = vi.fn((t: string) => t === 'audio/mp4');
  static last: FakeRecorder | null = null;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType: string;
  constructor(_s: MediaStream, o?: { mimeType?: string }) { this.mimeType = o?.mimeType ?? ''; FakeRecorder.last = this; }
  start() {}
  stop() { this.ondataavailable?.({ data: new Blob(['x'], { type: this.mimeType }) }); this.onstop?.(); }
}

describe('TalkPill', () => {
  // the recorder is its own chunk (mic.ts): loaded here as the page's idle prefetch would, so a hold runs as on a settled page
  beforeAll(async () => { await loadMic(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('perks to listening inside the focus handler (well under 100 ms)', () => {
    const { p, input } = setup();
    const t0 = performance.now();
    fireEvent.focus(input);
    expect(p.onListen).toHaveBeenCalledWith('text');
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('nods on typing pauses and sends on Enter, clearing the field and floating a chip', () => {
    vi.useFakeTimers();
    const { p, input } = setup();
    fireEvent.change(input, { target: { value: 'hello' } });
    act(() => { vi.advanceTimersByTime(690); });
    expect(p.onTypingPause).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(20); });
    expect(p.onTypingPause).toHaveBeenCalledTimes(1);
    fireEvent.submit(input.closest('form')!);
    expect(p.onSend).toHaveBeenCalledWith('hello');
    expect(input).toHaveValue('');
    expect(screen.getByText('hello')).toHaveClass('pet-chip');
  });

  it('does not send while a reply is in flight, and goes idle on an empty blur', () => {
    const { p, input } = setup({ busy: true });
    fireEvent.change(input, { target: { value: 'again' } });
    fireEvent.submit(input.closest('form')!);
    expect(p.onSend).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(p.onIdle).not.toHaveBeenCalled(); // busy: the character keeps thinking
  });

  it('shows the send button only with text, the mic otherwise', () => {
    const { input } = setup();
    expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'hi' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hold to talk' })).toBeNull();
  });

  it('opens the DM for a guest instead of talking on the page', () => {
    const onOpenDm = vi.fn();
    render(<TalkPill name="Mochi" guest onOpenDm={onOpenDm} onListen={vi.fn()} onIdle={vi.fn()} onSend={vi.fn()} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chat in Telegram' }));
    expect(onOpenDm).toHaveBeenCalled();
  });

  describe('hold-to-talk', () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
    beforeEach(() => {
      FakeRecorder.last = null;
      vi.stubGlobal('MediaRecorder', FakeRecorder);
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(async () => stream) }, configurable: true });
    });

    it.each(['release', 'cancel', 'unmount'] as const)('never starts recording when permission resolves after %s', async (end) => {
      let allow!: (stream: MediaStream) => void;
      const stop = vi.fn();
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(() => new Promise<MediaStream>((r) => { allow = r; })) }, configurable: true });
      const props = { name: 'Mochi', onListen: vi.fn(), onIdle: vi.fn(), onSend: vi.fn(), onVoice: vi.fn(), onRecording: vi.fn() };
      const ui = render(<TalkPill {...props} />);
      const mic = screen.getByRole('button', { name: 'Hold to talk' });
      fireEvent.pointerDown(mic);
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
      if (end === 'unmount') ui.unmount();
      else if (end === 'cancel') fireEvent.pointerCancel(mic);
      else fireEvent.pointerUp(mic);
      await act(async () => { allow({ getTracks: () => [{ stop }] } as unknown as MediaStream); });
      expect(stop).toHaveBeenCalledTimes(1);
      expect(FakeRecorder.last).toBeNull();
      expect(props.onVoice).not.toHaveBeenCalled();
      expect(props.onRecording).not.toHaveBeenCalledWith(true);
    });

    it('a hold before the recorder chunk has loaded asks for the mic in the handler, then records once it lands', async () => {
      vi.resetModules();
      const fresh = await import('./TalkPill');
      const p = { name: 'Mochi', onListen: vi.fn(), onIdle: vi.fn(), onSend: vi.fn(), onVoice: vi.fn(), onRecording: vi.fn() };
      render(<fresh.TalkPill {...p} />);
      const mic = screen.getByRole('button', { name: 'Hold to talk' });
      fireEvent.pointerDown(mic);
      expect(p.onListen).toHaveBeenCalledWith('mic');
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
      await act(async () => { await fresh.loadMic(); });
      await vi.waitFor(() => expect(mic).toHaveAttribute('aria-pressed', 'true'));
      expect(p.onRecording).toHaveBeenCalledWith(true);
      act(() => { fireEvent.pointerCancel(mic); });
      expect(p.onVoice).not.toHaveBeenCalled();
      expect(p.onRecording).toHaveBeenLastCalledWith(false);
    });

    it('a stale permission grant cannot consume or cancel a newer hold', async () => {
      const permits: Array<(stream: MediaStream) => void> = [];
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(() => new Promise<MediaStream>((r) => permits.push(r))) }, configurable: true });
      const { p } = setup();
      const mic = screen.getByRole('button', { name: 'Hold to talk' });
      fireEvent.pointerDown(mic); fireEvent.pointerCancel(mic); fireEvent.pointerDown(mic);
      const oldStop = vi.fn(), currentStop = vi.fn();
      await act(async () => { permits[0]({ getTracks: () => [{ stop: oldStop }] } as unknown as MediaStream); });
      expect(oldStop).toHaveBeenCalledTimes(1); expect(FakeRecorder.last).toBeNull();
      const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
      await act(async () => { permits[1]({ getTracks: () => [{ stop: currentStop }] } as unknown as MediaStream); });
      expect(FakeRecorder.last).not.toBeNull();
      expect(mic).toHaveAttribute('aria-pressed', 'true');
      now.mockReturnValue(2000); fireEvent.pointerUp(mic);
      expect(currentStop).toHaveBeenCalledTimes(1); expect(p.onVoice).toHaveBeenCalledTimes(1);
      now.mockRestore();
    });

    it('unmounting an active recorder stops its tracks without submitting a clip', async () => {
      const stop = vi.fn();
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) }, configurable: true });
      const props = { name: 'Mochi', onListen: vi.fn(), onIdle: vi.fn(), onSend: vi.fn(), onVoice: vi.fn(), onRecording: vi.fn() };
      const ui = render(<TalkPill {...props} />);
      await act(async () => { fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' })); });
      expect(FakeRecorder.last).not.toBeNull();
      ui.unmount();
      expect(stop).toHaveBeenCalledTimes(1); expect(props.onVoice).not.toHaveBeenCalled();
      expect(FakeRecorder.last?.onstop).toBeNull();
      expect(FakeRecorder.last?.ondataavailable).toBeNull();
      expect(props.onRecording).toHaveBeenLastCalledWith(false);
    });

    it('picks the first supported container', () => {
      expect(pickMicType(FakeRecorder)).toBe('audio/mp4');
      expect(pickMicType({ isTypeSupported: () => false })).toBe('');
      expect(pickMicType(null)).toBeNull();
    });

    it('asks for the mic on the first hold, records, and sends the clip on release', async () => {
      const { p } = setup();
      const now = vi.spyOn(performance, 'now');
      now.mockReturnValue(1000);
      const mic = screen.getByRole('button', { name: 'Hold to talk' });
      await act(async () => { fireEvent.pointerDown(mic); });
      expect(p.onListen).toHaveBeenCalledWith('mic');
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
      expect(mic).toHaveAttribute('aria-pressed', 'true');
      expect(p.onRecording).toHaveBeenCalledWith(true);
      now.mockReturnValue(2400);
      act(() => { fireEvent.pointerUp(mic); });
      expect(p.onVoice).toHaveBeenCalledTimes(1);
      expect((p.onVoice.mock.calls[0][0] as Blob).type).toBe('audio/mp4');
      expect(p.onRecording).toHaveBeenLastCalledWith(false);
      now.mockRestore();
    });

    it('treats a quick tap as a hint, not a message', async () => {
      const { p } = setup();
      const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
      const mic = screen.getByRole('button', { name: 'Hold to talk' });
      await act(async () => { fireEvent.pointerDown(mic); });
      now.mockReturnValue(1100);
      act(() => { fireEvent.pointerUp(mic); });
      expect(p.onVoice).not.toHaveBeenCalled();
      expect(screen.getByRole('status')).toHaveTextContent('Hold to talk');
      now.mockRestore();
    });

    it('falls back to typing when the mic is refused', async () => {
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); }) }, configurable: true });
      const { p, input } = setup();
      await act(async () => { fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' })); });
      expect(p.onVoice).not.toHaveBeenCalled();
      expect(screen.getByRole('status')).toHaveTextContent('Mic is off, so type instead');
      expect(input).toHaveFocus();
    });

    it('falls back to typing without MediaRecorder', async () => {
      vi.stubGlobal('MediaRecorder', undefined);
      const { input } = setup();
      await act(async () => { fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' })); });
      expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
      expect(input).toHaveFocus();
    });
  });
});
