import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceRecognitionPanel } from './VoiceRecognitionPanel';
import { voiceIdentityApi, captureVoiceSample, type VoiceIdentitySnapshot } from '../_lib/voice-identity-client';
import { adaptiveApi } from '../_lib/adaptive-client';
vi.mock('../_lib/voice-identity-client', () => ({ voiceDeviceId: () => '11111111-1111-4111-8111-111111111111', captureVoiceSample: vi.fn(),
  voiceIdentityApi: { read: vi.fn(), present: vi.fn(), enroll: vi.fn(), begin: vi.fn(), sample: vi.fn(), cancel: vi.fn(), remove: vi.fn() } }));
vi.mock('../_lib/adaptive-client', () => ({ adaptiveApi: { read: vi.fn(), consent: vi.fn() } }));
const make = (more: Partial<VoiceIdentitySnapshot> = {}): VoiceIdentitySnapshot => ({ scope: { space: 'work', deviceId: '11111111-1111-4111-8111-111111111111' }, revision: 1,
  available: true, consent: 'granted', enrollment: 'none', deletion: 'not_required', backupExpiry: 'operator_policy', ...more });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(voiceIdentityApi.read).mockResolvedValue(make());
  vi.mocked(voiceIdentityApi.present).mockResolvedValue(make({ revision: 2, receipt: '33333333-3333-4333-8333-333333333333', notice: { version: 'voice-enrollment-v1', locale: 'en', title: 'Own voice disclosure', body: 'Synthetic reviewed test disclosure', copyHash: 'synthetic' } }));
  vi.mocked(voiceIdentityApi.enroll).mockResolvedValue(make({ revision: 3 }));
  vi.mocked(voiceIdentityApi.begin).mockResolvedValue(make({ revision: 4, capture: { id: '44444444-4444-4444-8444-444444444444', mode: 'enroll', challenge: '123456', expiresAt: Date.now() + 30_000, maxBytes: 1_000_000, maxDurationMs: 10_000 } }));
  vi.mocked(voiceIdentityApi.cancel).mockResolvedValue(make({ revision: 5 }));
  vi.mocked(voiceIdentityApi.remove).mockResolvedValue(make({ revision: 6, deletion: 'online_completed' }));
});
describe('VoiceRecognitionPanel', () => {
  it('explains an unqualified local engine without inviting microphone capture', async () => {
    vi.mocked(voiceIdentityApi.read).mockResolvedValueOnce(make({ available: false, reason: 'inspection_not_qualified' }));
    render(<VoiceRecognitionPanel space="work" />);
    expect(await screen.findByText(/Local voice recognition is still being tested/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Review enrollment' })).toBeNull();
    expect(captureVoiceSample).not.toHaveBeenCalled();
  });
  it('shows unavailable state and manual fallback without recording or prompting', async () => {
    vi.mocked(voiceIdentityApi.read).mockResolvedValueOnce(make({ available: false, reason: 'provider_unavailable', consent: 'not_asked' }));
    render(<VoiceRecognitionPanel space="work" />);
    expect(await screen.findByText(/Recognition is unavailable/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Enroll my voice' })).toBeNull();
    expect(captureVoiceSample).not.toHaveBeenCalled(); expect(voiceIdentityApi.begin).not.toHaveBeenCalled();
    expect(screen.getByText(/Text, ordinary calls and authenticated profile selection remain available/)).toBeVisible();
  });
  it('renders Persian RTL status and deletion controls while enrollment is unavailable', async () => {
    vi.mocked(voiceIdentityApi.read).mockResolvedValueOnce(make({ available: false, reason: 'approval_missing', enrollment: 'purge_pending', deletion: 'provider_pending' }));
    render(<VoiceRecognitionPanel space="personal" locale="fa" />);
    const panel = await screen.findByRole('region', { name: 'تشخیص اختیاری صدا' });
    expect(panel).toHaveAttribute('dir', 'rtl'); expect(panel).toHaveAttribute('lang', 'fa');
    expect(await screen.findByText(/حذف نزد ارائه‌دهنده در انتظار است/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'حذف ثبت صدا در این فضا' }));
    await waitFor(() => expect(voiceIdentityApi.remove).toHaveBeenCalledWith(expect.objectContaining({ space: 'personal' })));
  });
  it('requires displayed disclosure and a separate unchecked self-only statement, then server intent before microphone denial', async () => {
    vi.mocked(captureVoiceSample).mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
    render(<VoiceRecognitionPanel space="work" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review enrollment' }));
    expect(await screen.findByText('Synthetic reviewed test disclosure')).toBeVisible();
    const enroll = screen.getByRole('button', { name: 'Enroll my voice' }); expect(enroll).toBeDisabled();
    const check = screen.getByRole('checkbox'); expect(check).not.toBeChecked();
    fireEvent.click(check); fireEvent.click(enroll);
    expect(await screen.findByText(/Microphone permission was denied/)).toBeVisible();
    expect(voiceIdentityApi.enroll).toHaveBeenCalledBefore(vi.mocked(voiceIdentityApi.begin));
    expect(voiceIdentityApi.begin).toHaveBeenCalledBefore(vi.mocked(captureVoiceSample));
    expect(voiceIdentityApi.sample).not.toHaveBeenCalled(); expect(voiceIdentityApi.cancel).toHaveBeenCalled();
  });
  it('global off stays available during capture, immediately aborts local recording and withdraws the canonical space choice', async () => {
    let captureSignal: AbortSignal | undefined;
    vi.mocked(captureVoiceSample).mockImplementation((_capture, signal) => { captureSignal = signal; return new Promise(() => undefined); });
    vi.mocked(adaptiveApi.read).mockResolvedValue({ purposes: [{ purpose: 'optional.biometric_recognition', revision: 7 }] } as never);
    vi.mocked(adaptiveApi.consent).mockResolvedValue({} as never);
    render(<VoiceRecognitionPanel space="work" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review enrollment' }));
    fireEvent.click(await screen.findByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Enroll my voice' }));
    expect(await screen.findByRole('button', { name: 'Cancel capture' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Turn recognition off in this space' }));
    expect(captureSignal?.aborted).toBe(true);
    await waitFor(() => expect(adaptiveApi.consent).toHaveBeenCalledWith('work', 'optional.biometric_recognition', 7, 'withdrawn'));
  });
  it('ignores responses from an old scope', async () => {
    let resolve!: (v: VoiceIdentitySnapshot) => void;
    vi.mocked(voiceIdentityApi.read).mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValueOnce(make({ available: false, reason: 'biometric_consent_required' }));
    const { rerender } = render(<VoiceRecognitionPanel space="work" />);
    rerender(<VoiceRecognitionPanel space="personal" />);
    expect(await screen.findByText(/Review the separate Voice recognition choice/)).toBeVisible();
    await act(async () => resolve(make({ enrollment: 'enrolled' })));
    expect(screen.queryByRole('button', { name: 'Test my voice' })).toBeNull();
  });
});
