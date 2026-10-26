/**
 * H4 (F263): the recording timer uses the locale's digits and unit inside <bdi>,
 * so an RTL line never carries Western digits with a Latin 's'. EN is unchanged.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnrollScreen, UX07_COPY, UX07_VARIABLES, type Ux07Variable } from './EnrollScreen';

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
  constructor(readonly stream: unknown, readonly options?: { mimeType?: string }) {}
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.onstop?.(); }
}

const FACTS = Object.fromEntries(UX07_VARIABLES.map(v => [v, `FACT_${v}`])) as Record<Ux07Variable, string>;
const AVAILABLE = { voiceprint: { space: 'work', available: true, consent: 'granted', enrolled: false } };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.request.mockImplementation(async () => AVAILABLE);
  mocks.getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: mocks.trackStop }] });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: mocks.getUserMedia } });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function recordFor(locale: 'en' | 'fa', ms: number) {
  render(<EnrollScreen space="work" locale={locale} facts={FACTS} />);
  await flush();
  fireEvent.click(screen.getByRole('checkbox'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: UX07_COPY[locale].enroll })); });
  await flush();
  await act(async () => { vi.advanceTimersByTime(ms); });
  return screen.getByRole('timer');
}

describe('EnrollScreen recording timer', () => {
  it('EN keeps "Recording · 12s", with the number and unit in a bdi element', async () => {
    const timer = await recordFor('en', 12_000);
    expect(timer).toHaveTextContent('Recording · 12s');
    const bdi = timer.querySelector('bdi');
    expect(bdi?.textContent).toBe('12s');
  });

  it('FA shows Persian digits and ثانیه inside a bdi element', async () => {
    const timer = await recordFor('fa', 12_000);
    const bdi = timer.querySelector('bdi');
    expect(bdi).not.toBeNull();
    expect(bdi?.textContent).toContain('۱۲');
    expect(bdi?.textContent).toContain('ثانیه');
    expect(bdi?.textContent).toBe('۱۲ ثانیه');
    expect(timer.textContent).not.toMatch(/[0-9]|\ds\b/);
    expect(timer).toHaveTextContent('در حال ضبط · ۱۲ ثانیه');
  });
});
