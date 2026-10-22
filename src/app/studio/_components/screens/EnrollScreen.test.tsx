import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnrollScreen, resolveUx07, UX07_COPY, UX07_VARIABLES, type Ux07Variable } from './EnrollScreen';

const mocks = vi.hoisted(() => ({ request: vi.fn(), getUserMedia: vi.fn(), trackStop: vi.fn() }));
vi.mock('../../_lib/client', () => ({
  request: mocks.request,
  haptic: { tap: vi.fn(), soft: vi.fn(), heavy: vi.fn(), select: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

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

const FACTS = Object.fromEntries(UX07_VARIABLES.map(v => [v, `FACT_${v}`])) as Record<Ux07Variable, string>;
const AVAILABLE = { voiceprint: { space: 'work', available: true, consent: 'granted', enrolled: false } };
const ux07 = () => {
  const doc = readFileSync(resolve(process.cwd(), 'docs/implementation/PRIVACY_AND_CONSENT.md'), 'utf8');
  return doc.slice(doc.indexOf('### UX-07'), doc.indexOf('### UX-08'));
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  vi.resetAllMocks();
  recorders = [];
  mocks.request.mockImplementation(async (method: string) => method === 'GET' ? AVAILABLE
    : { voiceprint: { space: 'work', available: true, consent: 'granted', enrolled: method === 'POST' } });
  mocks.getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: mocks.trackStop }] });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: mocks.getUserMedia } });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function startRecording() {
  fireEvent.click(screen.getByRole('checkbox'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: UX07_COPY.en.enroll })); });
  await flush();
}

describe('EnrollScreen', () => {
  it('copies UX-07 verbatim from PRIVACY_AND_CONSENT.md', () => {
    const section = ux07();
    for (const locale of ['en', 'fa'] as const) for (const text of Object.values(UX07_COPY[locale])) expect(section).toContain(text);
    expect(resolveUx07('en').missing).toEqual(['eligible_scope', 'recognition_processor', 'recognition_location', 'sample_deletion_term',
      'template_location', 'template_recipients', 'template_deletion_term']);
    expect(resolveUx07('fa').missing).toContain('sample_deletion_term_fa');
    expect(resolveUx07('en', FACTS)).toMatchObject({ missing: [] });
    expect(resolveUx07('en', FACTS).text).toContain('FACT_recognition_processor');
  });

  it('missing facts keep the literal placeholder and Enroll disabled', async () => {
    render(<EnrollScreen space="work" locale="en" facts={{ eligible_scope: 'Work' }} />);
    await flush();
    expect(screen.getByText(/\{recognition_processor\}/)).toBeInTheDocument();
    expect(screen.getByText('Not available yet: launch details are pending review.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: UX07_COPY.en.enroll })).toBeDisabled();
    expect(mocks.request).toHaveBeenCalledWith('GET', 'voice-enroll?space=work');
  });

  it('with all facts, Enroll stays disabled until the unchecked statement is checked; both actions share one class', async () => {
    render(<EnrollScreen space="work" locale="en" facts={FACTS} />);
    await flush();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    const enroll = screen.getByRole('button', { name: UX07_COPY.en.enroll });
    const alternative = screen.getByRole('button', { name: UX07_COPY.en.alternative });
    expect(enroll).toBeDisabled();
    expect(enroll.className).toBe(alternative.className);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(enroll).toBeEnabled();
  });

  it('renders FA right-to-left with the UX-07 FA text', async () => {
    const { container } = render(<EnrollScreen space="work" locale="fa" facts={FACTS} />);
    await flush();
    const section = container.querySelector('section')!;
    expect(section.getAttribute('dir')).toBe('rtl');
    expect(section.getAttribute('lang')).toBe('fa');
    expect(screen.getByText(UX07_COPY.fa.statement)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: UX07_COPY.fa.enroll })).toBeInTheDocument();
    expect(section.textContent).toContain('FACT_sample_deletion_term_fa');
  });

  it('consent missing shows only the Privacy prompt and no recorder', async () => {
    mocks.request.mockResolvedValue({ voiceprint: { space: 'work', available: false, reason: 'biometric_consent_required', consent: 'missing', enrolled: false } });
    render(<EnrollScreen space="work" locale="en" facts={FACTS} />);
    await flush();
    expect(screen.getByText('Turn on Voice recognition in Privacy and memory first.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a clip under 10 s is not uploaded', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    render(<EnrollScreen space="work" locale="en" facts={FACTS} />);
    await flush();
    await startRecording();
    await act(async () => { vi.advanceTimersByTime(9_000); });
    expect(screen.getByRole('timer')).toHaveTextContent('Recording · 9s');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop' })); });
    await flush();
    expect(mocks.request).not.toHaveBeenCalledWith('POST', expect.anything(), expect.anything());
    expect(screen.getByRole('alert')).toHaveTextContent('Keep talking a little longer');
    expect(mocks.trackStop).toHaveBeenCalled();
  });

  it('a clip of 10 s or more posts FormData with audio, space and statement=accepted', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    render(<EnrollScreen space="personal" locale="en" facts={FACTS} />);
    await flush();
    await startRecording();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop' })); });
    await flush();
    const post = mocks.request.mock.calls.find(c => c[0] === 'POST')!;
    expect(post[1]).toBe('voice-enroll');
    const form = post[2] as FormData;
    expect(form.get('audio')).toBeInstanceOf(Blob);
    expect(form.get('space')).toBe('personal');
    expect(form.get('statement')).toBe('accepted');
    expect(mocks.trackStop).toHaveBeenCalled();
    expect(recorders).toHaveLength(1);
  });

  it('cancel discards the clip and stops every track', async () => {
    render(<EnrollScreen space="work" locale="en" facts={FACTS} />);
    await flush();
    await startRecording();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    await flush();
    expect(mocks.trackStop).toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalledWith('POST', expect.anything(), expect.anything());
    expect(screen.getByRole('button', { name: UX07_COPY.en.enroll })).toBeInTheDocument();
  });

  it('unmount stops all tracks without uploading', async () => {
    const view = render(<EnrollScreen space="work" locale="en" facts={FACTS} />);
    await flush();
    await startRecording();
    view.unmount();
    await flush();
    expect(mocks.trackStop).toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalledWith('POST', expect.anything(), expect.anything());
  });

  it('when enrolled, Delete voiceprint sends DELETE for the space; Use person selection calls onCancel', async () => {
    mocks.request.mockImplementation(async (method: string) => ({ voiceprint: { space: 'work', available: true, consent: 'granted', enrolled: method === 'GET' } }));
    const onCancel = vi.fn();
    render(<EnrollScreen space="work" locale="en" facts={FACTS} onCancel={onCancel} />);
    await flush();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete voiceprint' })); });
    await flush();
    expect(mocks.request).toHaveBeenCalledWith('DELETE', 'voice-enroll?space=work');
    expect(screen.queryByRole('button', { name: 'Delete voiceprint' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: UX07_COPY.en.alternative }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('is not imported by StudioApp and does not import StudioApp or Call.tsx', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/studio/_components/screens/EnrollScreen.tsx'), 'utf8');
    expect(source).not.toMatch(/from '\.\.\/StudioApp'|from '\.\/Call'/);
    const app = readFileSync(resolve(process.cwd(), 'src/app/studio/_components/StudioApp.tsx'), 'utf8');
    expect(app).not.toContain('EnrollScreen');
  });
});
