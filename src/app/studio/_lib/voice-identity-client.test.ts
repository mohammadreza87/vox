import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureVoiceSample } from './voice-identity-client';
const capture = () => ({ id: 'synthetic', mode: 'enroll' as const, challenge: '123456', expiresAt: Date.now() + 30_000, maxBytes: 100, maxDurationMs: 10_000 });
afterEach(() => vi.unstubAllGlobals());
describe('bounded explicit voice capture', () => {
  it('does not prompt for an already cancelled or expired capture', async () => {
    const getUserMedia = vi.fn(); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    const abort = new AbortController(); abort.abort();
    await expect(captureVoiceSample(capture(), abort.signal)).rejects.toThrow('capture_cancelled');
    await expect(captureVoiceSample({ ...capture(), expiresAt: 1 }, new AbortController().signal)).rejects.toThrow('capture_cancelled');
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it('releases tracks when cancellation happens while the OS permission prompt is unresolved', async () => {
    const stop = vi.fn(); let grant!: (value: MediaStream) => void;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(() => new Promise(resolve => { grant = resolve; })) } });
    vi.stubGlobal('MediaRecorder', class { static isTypeSupported() { return true; } });
    const abort = new AbortController(), job = captureVoiceSample(capture(), abort.signal);
    abort.abort(); grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await expect(job).rejects.toThrow('capture_cancelled'); expect(stop).toHaveBeenCalledOnce();
  });
  it('propagates actual microphone denial without trying another capture route', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    vi.stubGlobal('MediaRecorder', class { static isTypeSupported() { return true; } });
    await expect(captureVoiceSample(capture(), new AbortController().signal)).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(getUserMedia).toHaveBeenCalledOnce();
  });
});
