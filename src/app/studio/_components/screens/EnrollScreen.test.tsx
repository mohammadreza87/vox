import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EN_COPY, EnrollScreen, FA_COPY } from './EnrollScreen';

const mocks = vi.hoisted(() => ({ request: vi.fn(), getUserMedia: vi.fn(), trackStop: vi.fn() }));
vi.mock('../../_lib/client', () => ({ request: mocks.request }));

class FakeMediaRecorder {
  static isTypeSupported(type: string) { return type === 'audio/webm;codecs=opus'; }
  state = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(readonly stream: unknown, readonly options?: { mimeType?: string }) { recorders.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['opus-bytes']) }); this.onstop?.(); }
}
let recorders: FakeMediaRecorder[] = [];

const AVAILABLE = { space: 'work', available: true, enrolled: false };
const ux07 = () => {
  const doc = readFileSync(resolve(process.cwd(), 'docs/implementation/PRIVACY_AND_CONSENT.md'), 'utf8');
  return doc.slice(doc.indexOf('### UX-07'), doc.indexOf('### UX-08'));
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  vi.resetAllMocks();
  recorders = [];
  mocks.request.mockImplementation(async (method: string) => method === 'GET' ? AVAILABLE : { space: 'work', available: true, enrolled: true });
  mocks.getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: mocks.trackStop }] });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: mocks.getUserMedia } });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function startRecording() {
  fireEvent.click(screen.getByRole('checkbox'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: EN_COPY.enroll })); });
  await flush();
}

describe('EnrollScreen', () => {
  it('starts with the statement unchecked and Enroll disabled', async () => {
    render(<EnrollScreen space="work" />);
    await flush();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: EN_COPY.enroll })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: EN_COPY.enroll })).toBeEnabled();
    expect(mocks.request).toHaveBeenCalledWith('GET', 'voice-enroll?space=work');
  });

  it('uses the UX-07 copy verbatim with literal placeholders', async () => {
    const section = ux07();
    for (const text of [...Object.values(EN_COPY), ...Object.values(FA_COPY)]) expect(section).toContain(text);
    render(<EnrollScreen space="work" />);
    await flush();
    expect(screen.getByText(content => content.includes('{eligible_scope}') && content.includes('{recognition_processor}'))).toBeInTheDocument();
    expect(screen.getByText(EN_COPY.statement)).toBeInTheDocument();
  });

  it('renders Farsi right-to-left with the Farsi buttons', async () => {
    const { container } = render(<EnrollScreen space="personal" locale="fa" />);
    await flush();
    expect(container.querySelector('section')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: FA_COPY.enroll })).toBeDisabled();
    expect(screen.getByRole('button', { name: FA_COPY.personSelection })).toBeInTheDocument();
    expect(screen.getByText(content => content.includes('{sample_deletion_term_fa}'))).toBeInTheDocument();
  });

  it('records with a visible bounded state and posts the sample with the explicit statement', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    render(<EnrollScreen space="work" />);
    await flush();
    await startRecording();
    expect(mocks.getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true } });
    expect(recorders[0].options).toEqual({ mimeType: 'audio/webm;codecs=opus' });
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
    act(() => { vi.advanceTimersByTime(12_500); });
    expect(screen.getByText(/Recording · 12s/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop' })); });
    await flush();
    const post = mocks.request.mock.calls.find(c => c[0] === 'POST')!;
    expect(post[1]).toBe('voice-enroll');
    const form = post[2] as FormData;
    expect(form.get('statement')).toBe('enroll_my_voice');
    expect(form.get('space')).toBe('work');
    expect(form.get('audio')).toBeInstanceOf(Blob);
    expect(mocks.trackStop).toHaveBeenCalled();
  });

  it('auto-stops at 30 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    render(<EnrollScreen space="work" />);
    await flush();
    await startRecording();
    act(() => { vi.advanceTimersByTime(30_000); });
    await flush();
    expect(mocks.request.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(1);
  });

  it('cancel stops every track and sends nothing; unmount stops tracks', async () => {
    const first = render(<EnrollScreen space="work" />);
    await flush();
    await startRecording();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();
    expect(mocks.trackStop).toHaveBeenCalled();
    expect(mocks.request.mock.calls.some(c => c[0] === 'POST')).toBe(false);
    first.unmount();
    mocks.trackStop.mockClear();
    render(<EnrollScreen space="work" />);
    await flush();
    await startRecording();
    cleanup();
    expect(mocks.trackStop).toHaveBeenCalled();
    expect(mocks.request.mock.calls.some(c => c[0] === 'POST')).toBe(false);
  });

  it('deletes an enrolled voiceprint', async () => {
    mocks.request.mockImplementation(async (method: string) => method === 'GET'
      ? { space: 'work', available: true, enrolled: true, provider: 'pyannoteai', modelVersion: 'pyannoteai-voiceprint-v1', createdAt: '2026-10-20T12:00:00.000Z' }
      : { space: 'work', available: true, enrolled: false });
    render(<EnrollScreen space="work" />);
    await flush();
    expect(screen.getByText(/pyannoteai-voiceprint-v1/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete voiceprint' })); });
    expect(mocks.request).toHaveBeenCalledWith('DELETE', 'voice-enroll?space=work');
    await flush();
    expect(screen.queryByRole('button', { name: 'Delete voiceprint' })).toBeNull();
  });

  it('shows the unavailable reason and keeps Enroll disabled', async () => {
    mocks.request.mockResolvedValue({ space: 'work', available: false, reason: 'biometric_consent_required', enrolled: false });
    render(<EnrollScreen space="work" />);
    await flush();
    expect(screen.getByText('Turn on Voice recognition in Privacy first.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: EN_COPY.enroll })).toBeDisabled();
  });

  it('Use person selection calls the callback', async () => {
    const onUsePersonSelection = vi.fn();
    render(<EnrollScreen space="work" onUsePersonSelection={onUsePersonSelection} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: EN_COPY.personSelection }));
    expect(onUsePersonSelection).toHaveBeenCalledTimes(1);
  });
});
