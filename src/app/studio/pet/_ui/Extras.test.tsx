import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyPlay, fakeHost } from './host.fixture';
import { loadStrings } from './strings';
import { writeSignals, NO_SIGNALS } from './tips';

const hf = { start: vi.fn(), stop: vi.fn() };
vi.mock('./handsFree', () => ({ startHandsFree: (d: unknown) => { hf.start(d); return Promise.resolve({ stop: hf.stop }); } }));
const { default: Extras, micSheet, HF_KEY } = await import('./Extras');

beforeAll(async () => { await loadStrings('en'); await loadStrings('fa'); });
beforeEach(() => { hf.start.mockClear(); hf.stop.mockClear(); localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function micDevice() {
  const track = { stop: vi.fn(), addEventListener: vi.fn() };
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  return { getUserMedia, track };
}

describe('the UX-02 mic sheet (P3) before the first hold', () => {
  it('a press with no answer opens the sheet; the OS prompt only after "Use microphone"; the yes is recorded', async () => {
    const { getUserMedia, track } = micDevice();
    const h = fakeHost();
    render(<Extras host={h} />);
    expect(h.micOk).toHaveBeenLastCalledWith(false);
    act(() => h.fire({ type: 'micAsk' }));
    const sheet = screen.getByRole('dialog', { name: 'Use your microphone for this conversation?' });
    expect(sheet.textContent).toContain('This does not turn on voice recognition.');
    expect(sheet.textContent).not.toMatch(/[{}]/);
    expect(h.play).toHaveBeenCalledWith({ op: 'askSeen', ask: 'P3' });
    expect(h.busy).toHaveBeenLastCalledWith('sheet', true);
    expect(getUserMedia).not.toHaveBeenCalled();
    // equal weight: two buttons, decline as large as accept
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Use microphone', 'Use text']);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use microphone' })); });
    expect(h.play).toHaveBeenCalledWith({ op: 'askAccepted', ask: 'P3' });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalled();
    expect(h.micOk).toHaveBeenLastCalledWith(true);
    expect(h.said).toEqual(['Go ahead, I’m all ears.']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('"Use text" keeps the keyboard: the decline is recorded, the pill focuses, the mic will ask again', async () => {
    const { getUserMedia } = micDevice();
    const h = fakeHost();
    render(<Extras host={h} />);
    act(() => h.fire({ type: 'micAsk' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use text' })); });
    expect(h.play).toHaveBeenCalledWith({ op: 'askDeclined', ask: 'P3' });
    expect(h.focusTalk).toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(h.micOk).not.toHaveBeenCalledWith(true);
    act(() => h.fire({ type: 'micAsk' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('no sheet when the record already says yes, or with no play record (a Wave A server)', () => {
    const yes = fakeHost({ play: emptyPlay({ asks: { P3: { lastAskedAt: 1, declined: 0, accepted: true } } }) });
    render(<Extras host={yes} />);
    expect(yes.micOk).toHaveBeenLastCalledWith(true);
    const old = fakeHost({ play: undefined });
    render(<Extras host={old} />);
    expect(old.micOk).toHaveBeenLastCalledWith(true);
  });

  it('the drafted text with its launch facts, in both languages (Persian names in isolates)', () => {
    const n = { providers: 'OpenAI', locations: 'the United States', retention: 'Audio is deleted after transcription.', retentionFa: 'صدا پس از تبدیل پاک می‌شود.' };
    expect(micSheet('en', n).body).toBe('Your audio will be sent to OpenAI in the United States to transcribe and answer your request. Audio is deleted after transcription. This does not turn on voice recognition.');
    const fa = micSheet('fa', n);
    expect(fa.title).toBe('برای این گفتگو از میکروفون استفاده می‌کنید؟');
    expect(fa.body).toContain('⁨OpenAI⁩');
    expect([fa.yes, fa.no]).toEqual(['استفاده از میکروفون', 'استفاده از متن']);
  });

  it('unresolved facts (no locations or retention yet): a neutral line pointing to Privacy, never a gap or a brace', () => {
    for (const n of [undefined, { providers: 'OpenAI' }]) {
      const en = micSheet('en', n).body, fa = micSheet('fa', n).body;
      expect(en).toBe('Your audio will be sent to our voice providers, listed in Privacy and memory, to transcribe and answer your request. This does not turn on voice recognition.');
      expect(fa).toContain('«حریم خصوصی و حافظه»');
      expect(fa).toContain('با این کار، شناسایی گوینده از روی صدا فعال نمی‌شود.');
      expect(en + fa).not.toMatch(/[{}]|OpenAI/);
    }
  });
});

describe('hands-free (P3b, §8A.2)', () => {
  const device = () => {
    vi.stubGlobal('AudioWorkletNode', class {});
    vi.stubGlobal('MediaRecorder', class {});
    micDevice();
  };
  const accepted = { play: emptyPlay({ asks: { P3: { lastAskedAt: 1, declined: 0, accepted: true as const } } }) };

  it('the switch shows only where the device can; the P3b sheet before the first enable, then the mic opens', async () => {
    const none = fakeHost(accepted);
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    render(<Extras host={none} />);
    expect(none.setVoice).not.toHaveBeenCalledWith({ handsFree: true });
    device();
    const h = fakeHost(accepted);
    render(<Extras host={h} />);
    expect(h.setVoice).toHaveBeenCalledWith({ handsFree: true });
    act(() => h.fire({ type: 'handsFree' }));
    expect(screen.getByRole('dialog', { name: 'Keep the mic open while we talk?' }).textContent).toContain('close Mochi or go quiet for a minute');
    expect(h.play).toHaveBeenCalledWith({ op: 'askSeen', ask: 'P3b' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn on hands-free' })); });
    expect(h.play).toHaveBeenCalledWith({ op: 'askAccepted', ask: 'P3b' });
    expect(localStorage.getItem(HF_KEY('a'))).toBe('1');
    expect(hf.start).toHaveBeenCalledTimes(1);
    expect(h.setVoice).toHaveBeenCalledWith({ open: true, hearing: false });
    const d = hf.start.mock.calls[0][0] as { onUtterance(b: Blob): void; onHear(): void; onOff(w: string): void; bargeIn(): void };
    act(() => d.onHear());
    expect(h.engineFake.setListening).toHaveBeenCalledWith(true);
    const blob = new Blob(['x']);
    act(() => d.onUtterance(blob));
    expect(h.sendVoice).toHaveBeenCalledWith(blob, true);
    d.bargeIn();
    expect(h.hush).toHaveBeenCalled();
    // a tap on the switch turns it off; a minute of quiet turns it off by itself and says so
    act(() => h.fire({ type: 'handsFree' }));
    expect(hf.stop).toHaveBeenCalledWith('user');
    act(() => d.onOff('idle'));
    expect(h.setVoice).toHaveBeenLastCalledWith({ open: false, hearing: false, note: 'Hands-free is off. Tap to turn it on.' });
    expect(h.engineFake.setListening).toHaveBeenLastCalledWith(false);
  });

  it('declined: hold-to-talk stays and the switch goes for this session; accepted before: no sheet; the mic sheet comes first if P3 was never answered', async () => {
    device();
    const h = fakeHost(accepted);
    render(<Extras host={h} />);
    act(() => h.fire({ type: 'handsFree' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Keep hold-to-talk' })); });
    expect(h.play).toHaveBeenCalledWith({ op: 'askDeclined', ask: 'P3b' });
    expect(h.setVoice).toHaveBeenLastCalledWith({ handsFree: false });
    act(() => h.fire({ type: 'handsFree' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(hf.start).not.toHaveBeenCalled();
    localStorage.setItem(HF_KEY('a'), '1');
    const again = fakeHost(accepted);
    render(<Extras host={again} />);
    await act(async () => { again.fire({ type: 'handsFree' }); });
    expect(hf.start).toHaveBeenCalledTimes(1);
    const fresh = fakeHost();
    render(<Extras host={fresh} />);
    act(() => fresh.fire({ type: 'handsFree' }));
    expect(screen.getByRole('dialog', { name: 'Use your microphone for this conversation?' })).toBeInTheDocument();
  });
});

const growth = () => ({ moments: [
  { id: 'release', kind: 'taught' as const, title: 'I learned how you plan a release', hint: 'Tell me how your team plans a release' },
  { id: 'room-play', kind: 'room' as const, title: 'We found the Play room together', hint: 'Peek into the Play room' },
] });

describe('growth: the confirm step and a lit moment (§4.11, §10.3)', () => {
  it('after a "remember this" save: «Shall I keep this as …?» with the best unlit taught moment; yes posts growth/confirm', async () => {
    const lit = { ...growth(), moments: growth().moments.map((m) => (m.id === 'release' ? { ...m, lit: { at: '2026-10-26T12:00:00Z' } } : m)) };
    const growthConfirm = vi.fn(async () => ({ lit: 'agent' as const, growth: lit }));
    const h = fakeHost({ growth: growth() }, { api: { growthConfirm } });
    render(<Extras host={h} />);
    act(() => h.fire({ type: 'reply', saved: true, said: 'remember this: we plan a release every second Tuesday' }));
    expect(screen.getByRole('dialog', { name: 'Shall I keep this as “I learned how you plan a release”?' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, that’s it' })); });
    expect(growthConfirm).toHaveBeenCalledWith('a', 'release');
    expect(h.adoptGrowth).toHaveBeenCalledWith(lit);
    // adopting it lit the moment: the beat plays with its detail, then the chip and the line at the glow's peak
    expect(h.engineFake.lightMoment).toHaveBeenCalledWith({ detail: 'glint' });
    act(() => h.fire({ type: 'motion', cue: { type: 'litPeak', detail: 'glint', shown: true } }));
    expect(screen.getByRole('status').textContent).toBe('New page in What I’ve learned');
    expect(h.said).toContain('I learned how you plan a release');
    expect(h.engineFake.setDetails).toHaveBeenLastCalledWith({ glint: true, pin: false, charm: false, keepsakes: [], seasonal: null });
  });

  it('no confirm without a save, without a match, or with "Not that one"', async () => {
    const growthConfirm = vi.fn();
    const h = fakeHost({ growth: growth() }, { api: { growthConfirm } });
    render(<Extras host={h} />);
    act(() => h.fire({ type: 'reply', saved: false, said: 'we plan a release' }));
    act(() => h.fire({ type: 'reply', saved: true, said: 'remember this: my cat is Pashmak' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => h.fire({ type: 'reply', saved: true, said: 'remember this: release planning' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Not that one' })); });
    expect(growthConfirm).not.toHaveBeenCalled();
  });

  it('a first room visit lit for this person only (`mine`) lights its floor keepsake', () => {
    const h = fakeHost({ growth: growth() });
    render(<Extras host={h} />);
    h.state.view = { ...h.state.view!, growth: { ...growth(), mine: ['room-play'] } };
    act(() => h.fire({ type: 'view' }));
    expect(h.engineFake.lightMoment).toHaveBeenCalledWith({ detail: 'keepsake', id: 'play' });
  });
});

describe('tips v1 in the page (§7)', () => {
  it('waits for a calm moment, wiggles the cookie, then says the T1 line; long-press gives the reason; recorded once', () => {
    vi.useFakeTimers();
    writeSignals('a', { ...NO_SIGNALS, cookieTaps: 3 });
    const cookie = document.createElement('button');
    const h = fakeHost();
    h.toy = vi.fn(() => cookie);
    h.state.talk = 'thinking';
    render(<Extras host={h} />);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(h.play).not.toHaveBeenCalledWith({ op: 'tipSeen', tip: 'T1' });
    h.state.talk = 'idle';
    act(() => { vi.advanceTimersByTime(2000); });
    expect(cookie).toHaveAttribute('data-tip');
    expect(h.play).toHaveBeenCalledWith({ op: 'tipSeen', tip: 'T1' });
    act(() => { vi.advanceTimersByTime(2600); });
    expect(cookie).not.toHaveAttribute('data-tip');
    expect(h.said).toEqual(['Psst, you can drag the cookie right to my mouth.']);
    act(() => h.fire({ type: 'bubbleHold' }));
    expect(h.said.at(-1)).toBe('You tapped the cookie a few times, so: it can be dragged too.');
    // one a session
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(h.play.mock.calls.filter((c) => (c[0] as { op: string }).op === 'tipSeen')).toHaveLength(1);
  });

  it('a coach chip under the mic with ⓘ (the reason) and × (dismissed for good)', () => {
    vi.useFakeTimers();
    writeSignals('a', { ...NO_SIGNALS, typed: 5 });
    const root = document.createElement('div');
    root.innerHTML = '<button class="pet-mic"></button>';
    document.body.appendChild(root);
    const mic = root.querySelector('.pet-mic')!;
    mic.getBoundingClientRect = () => ({ left: 300, top: 700, width: 40, height: 40, bottom: 740, right: 340, x: 300, y: 700, toJSON: () => '' });
    const h = fakeHost({}, { root });
    render(<Extras host={h} />);
    act(() => { vi.advanceTimersByTime(2000); });
    const chip = screen.getByRole('status');
    expect(chip.textContent).toContain('Hold the mic and just talk to me.');
    expect(chip).toHaveAttribute('data-above');
    fireEvent.click(screen.getByRole('button', { name: 'Why this?' }));
    expect(screen.getByRole('status').textContent).toContain('You’ve typed a few times, and the mic is here too.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(h.play).toHaveBeenCalledWith({ op: 'tipDismissed', tip: 'T4' });
    expect(screen.queryByRole('status')).toBeNull();
    root.remove();
  });
});
