import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { accountIdFor } from '../persistence/repository';
import { setupVoiceIdentity, scope, NOW } from './test-fixtures';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('optional voice identity lifecycle with synthetic provider protocol only', () => {
  it('defaults off with no provider; even a capability manifest cannot manufacture enrollment', async () => {
    const { service, provider, consent } = await setupVoiceIdentity(false);
    expect(await service.read(123, scope)).toMatchObject({ available: false, reason: 'provider_unavailable', enrollment: 'none' });
    await expect(consent()).rejects.toMatchObject({ code: 'capability_unavailable' });
    await expect(service.present(123, scope, 0, 'en')).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(provider.inspect).not.toHaveBeenCalled(); expect(provider.extract).not.toHaveBeenCalled();
  });
  it('requires canonical opt-in AND separate current disclosure before one-use capture', async () => {
    const { service, consent, intent, begin, provider } = await setupVoiceIdentity();
    expect((await service.read(123, scope)).reason).toBe('biometric_consent_required');
    await expect(service.present(123, scope, 0, 'en')).rejects.toMatchObject({ code: 'biometric_consent_required' });
    await consent();
    await expect(service.begin(123, scope, 0, 'enroll')).rejects.toMatchObject({ code: 'enrollment_required' });
    await intent(); const capture = await begin();
    const audio = new Uint8Array([1, 2, 3]);
    expect((await service.process(123, scope, capture.capture!.id, audio, 'audio/webm')).status.enrollment).toBe('enrolled');
    expect(audio).toEqual(new Uint8Array(3));
    await expect(service.process(123, scope, capture.capture!.id, new Uint8Array([1]), 'audio/webm')).rejects.toMatchObject({ code: 'capture_expired' });
    expect(provider.extract).toHaveBeenCalledTimes(1);
  });
  it('persists only authenticated encrypted opaque templates; restart, account/device/space isolation and AAD hold', async () => {
    const { service, consent, enroll, directory, factory, cipher, repository } = await setupVoiceIdentity();
    await consent(); await enroll();
    expect((await factory().read(123, scope)).enrollment).toBe('enrolled');
    expect((await service.read(124, scope)).enrollment).toBe('none');
    expect((await service.read(123, { ...scope, space: 'personal' })).enrollment).toBe('none');
    expect((await service.read(123, { ...scope, deviceId: '22222222-2222-4222-8222-222222222222' })).enrollment).toBe('none');
    const files = await readdir(join(directory, 'voice'));
    for (const file of files.filter(f => f.endsWith('.json'))) {
      const bytes = await readFile(join(directory, 'voice', file), 'utf8');
      expect(bytes).not.toContain('SYNTHETIC_AUDIO_CANARY'); expect(bytes).not.toContain('SYNTHETIC_OPAQUE_TEMPLATE_CANARY');
    }
    const row = await repository.transaction(accountIdFor(123), (await service.adaptive.read(123, 'work')).identity.personId!, scope, r => structuredClone(r));
    expect(() => cipher.decrypt(row.template!, { ...scope, accountId: accountIdFor(124), personId: row.personId, epoch: row.templateEpoch! })).toThrow();
    expect(() => cipher.decrypt(row.template!, { ...scope, space: 'personal', accountId: accountIdFor(123), personId: row.personId, epoch: row.templateEpoch! })).toThrow();
  });
  it('returns only a self hint and never changes verified identity, bindings, permissions or searches other profiles', async () => {
    const { adaptive, service, provider, consent, enroll, begin } = await setupVoiceIdentity();
    await consent(); await enroll(); const before = await adaptive.read(123, 'work');
    const capture = await begin('test');
    const result = await service.process(123, scope, capture.capture!.id, new Uint8Array([3, 2, 1]), 'audio/webm');
    expect(result.hint).toEqual({ outcome: 'possible_self', authenticationRequired: true, identityChanged: false });
    expect(vi.mocked(provider.compare).mock.calls[0][0].candidates.map(c => c.id)).toEqual(['self']);
    const after = await adaptive.read(123, 'work'); expect(after.identity).toEqual(before.identity); expect(after.purposes).toEqual(before.purposes);
    vi.mocked(provider.compare).mockResolvedValueOnce({ candidateId: 'external-victim' });
    const other = await begin('test');
    expect((await service.process(123, scope, other.capture!.id, new Uint8Array([1]), 'audio/webm')).hint?.outcome).toBe('unknown');
  });
  it.each(['mixed', 'replay', 'synthetic', 'unknown'])('abstains for %s before extracting any query template', async () => {
    const { service, provider, consent, intent, begin } = await setupVoiceIdentity();
    await consent(); await intent(); const capture = await begin();
    vi.mocked(provider.inspect).mockResolvedValueOnce('unknown');
    const result = await service.process(123, scope, capture.capture!.id, new Uint8Array([1]), 'audio/webm');
    expect(result.hint?.outcome).toBe('unknown'); expect(provider.extract).not.toHaveBeenCalled(); expect(provider.compare).not.toHaveBeenCalled();
  });
  it('withdrawal and in-flight deletion suppress late extraction and cannot replay old intent after regrant', async () => {
    const { service, provider, consent, intent, begin } = await setupVoiceIdentity();
    await consent(); await intent(); const capture = await begin();
    let release!: (value: Uint8Array) => void;
    vi.mocked(provider.extract).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const job = service.process(123, scope, capture.capture!.id, new Uint8Array([1]), 'audio/webm');
    const rejection = expect(job).rejects.toMatchObject({ code: 'capture_cancelled' });
    await vi.waitFor(() => expect(release).toBeDefined());
    await consent('work', 'withdrawn'); await service.invalidate(123, 'work');
    const late = new Uint8Array([9, 9]); release(late); await rejection;
    expect(late).toEqual(new Uint8Array(2)); expect((await service.read(123, scope)).enrollment).toBe('none');
    await consent(); await expect(service.process(123, scope, capture.capture!.id, new Uint8Array([1]), 'audio/webm')).rejects.toMatchObject({ code: 'capture_expired' });
    expect(provider.compare).not.toHaveBeenCalled();
  });
  it('delete is retryable, denies matching immediately on provider failure and removes ciphertext after acknowledgement', async () => {
    const { service, provider, consent, enroll, repository } = await setupVoiceIdentity();
    await consent(); await enroll(); vi.mocked(provider.purge).mockRejectedValue(new Error('synthetic purge outage'));
    expect(await service.remove(123, scope)).toMatchObject({ enrollment: 'purge_pending', deletion: 'provider_pending' });
    const current = await service.read(123, scope);
    await expect(service.begin(123, scope, current.revision, 'test')).rejects.toMatchObject({ code: 'biometric_consent_required' });
    vi.mocked(provider.purge).mockResolvedValue(undefined);
    expect(await service.remove(123, scope)).toMatchObject({ enrollment: 'none', deletion: 'online_completed', backupExpiry: 'operator_policy' });
    const rows = await repository.all(accountIdFor(123), (await service.adaptive.read(123, 'work')).identity.personId!, r => r);
    expect(rows[0].template).toBeUndefined(); expect(rows[0].capture).toBeUndefined(); expect(rows[0].epoch).toBeGreaterThan(0);
  });
  it('cancels obsolete captures, expired leases, revoked approval and changed binding before provider extraction', async () => {
    const { adaptive, service, provider, consent, intent, begin, setNow, approval } = await setupVoiceIdentity();
    await consent(); await intent(); const first = await begin(); const second = await begin();
    await expect(service.process(123, scope, first.capture!.id, new Uint8Array([1]), 'audio/webm')).rejects.toMatchObject({ code: 'capture_expired' });
    setNow(NOW + 31_000);
    await expect(service.process(123, scope, second.capture!.id, new Uint8Array([1]), 'audio/webm')).rejects.toMatchObject({ code: 'capture_expired' });
    setNow(NOW); await adaptive.confirm(123, { confirm: true, adultConfirmed: true });
    expect((await service.read(123, scope)).enrollment).toBe('none');
    await expect(begin()).rejects.toMatchObject({ code: 'enrollment_required' });
    approval.expiresAt = NOW; expect((await service.read(123, scope)).available).toBe(false);
    expect(provider.extract).not.toHaveBeenCalled();
  });
  it('canonical withdrawal invalidates all devices in that space while a profile change invalidates every space', async () => {
    const { adaptive, service, consent, enroll, provider } = await setupVoiceIdentity();
    const second = { ...scope, deviceId: '22222222-2222-4222-8222-222222222222' };
    const personal = { ...scope, space: 'personal' as const };
    await consent(); await consent('personal'); await enroll(); await enroll(second); await enroll(personal);
    await consent('work', 'withdrawn');
    expect((await service.read(123, scope)).deletion).toBe('online_completed');
    expect((await service.read(123, second)).deletion).toBe('online_completed');
    expect((await service.read(123, personal)).enrollment).toBe('enrolled');
    expect(provider.purge).toHaveBeenCalledTimes(2);
    await adaptive.confirm(123, { confirm: true, adultConfirmed: true });
    expect((await service.read(123, personal)).deletion).toBe('online_completed');
    expect(provider.purge).toHaveBeenCalledTimes(3);
  });
  it('maintenance expires templates and an expired profile cannot recurse or revive enrollment', async () => {
    const { service, repository, adaptive, consent, enroll, approval, setNow } = await setupVoiceIdentity();
    approval.templateTtlMs = 1000;
    await consent(); await enroll(); setNow(NOW + 1001);
    expect(await service.maintenanceAccount(123)).toEqual({ pending: 0 });
    const personId = (await adaptive.read(123, 'work')).identity.personId!;
    expect((await repository.transaction(accountIdFor(123), personId, scope, r => r.template))).toBeUndefined();
    setNow(NOW + 13 * 3600_000);
    expect((await service.read(123, scope)).available).toBe(false);
    expect((await service.read(123, scope)).enrollment).toBe('none');
  });

  it('a restored voice-store snapshot cannot resurrect deleted enrollment before or after a new canonical grant', async () => {
    const { service, repository, adaptive, consent, enroll } = await setupVoiceIdentity();
    await consent(); await enroll();
    const accountId = accountIdFor(123), personId = (await adaptive.read(123, 'work')).identity.personId!;
    const old = await repository.storage.transact(accountId, current => ({ document: current, result: current }));
    await service.remove(123, scope);
    expect((await adaptive.read(123, 'work')).purposes.find(p => p.purpose === 'optional.biometric_recognition')!.state).toBe('withdrawn');
    await repository.storage.transact(accountId, () => ({ document: old, result: undefined }));
    expect((await service.read(123, scope)).enrollment).toBe('none');
    await consent();
    await repository.storage.transact(accountId, () => ({ document: old, result: undefined }));
    expect((await service.read(123, scope)).enrollment).toBe('none');
    expect(await repository.transaction(accountId, personId, scope, row => row.template)).toBeUndefined();
  });

  it('bounds a broken extraction by the remaining capture lease, wipes local audio and erases its late result', async () => {
    const { service, provider, consent, intent, begin, setNow } = await setupVoiceIdentity();
    await consent(); await intent(); const capture = await begin(); setNow(NOW + 29_500);
    let release!: (value: Uint8Array) => void;
    vi.mocked(provider.extract).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const audio = new Uint8Array([8, 9, 10]), job = service.process(123, scope, capture.capture!.id, audio, 'audio/webm');
    const rejected = expect(job).rejects.toMatchObject({ code: 'capture_cancelled' });
    await vi.waitFor(() => expect(release).toBeDefined());
    await vi.advanceTimersByTimeAsync(501); await rejected;
    expect(audio).toEqual(new Uint8Array(3));
    const late = new Uint8Array([3, 4]); release(late); await Promise.resolve();
    expect(late).toEqual(new Uint8Array(2));
    expect((await service.read(123, scope)).enrollment).toBe('none');
  });
  it('bounds a broken comparison and wipes query and reference buffers even if it ignores abort', async () => {
    const { service, provider, consent, enroll, begin, setNow } = await setupVoiceIdentity();
    await consent(); await enroll(); const capture = await begin('test'); setNow(NOW + 29_500);
    let query: Uint8Array | undefined, reference: Uint8Array | undefined;
    vi.mocked(provider.compare).mockImplementationOnce(input => { query = input.query; reference = input.candidates[0].template; return new Promise(() => undefined); });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const audio = new Uint8Array([1]), job = service.process(123, scope, capture.capture!.id, audio, 'audio/webm');
    const rejected = expect(job).rejects.toMatchObject({ code: 'capture_cancelled' });
    await vi.waitFor(() => expect(query).toBeDefined()); await vi.advanceTimersByTimeAsync(501); await rejected;
    expect([...query!].every(value => value === 0)).toBe(true); expect([...reference!].every(value => value === 0)).toBe(true); expect(audio[0]).toBe(0);
  });
  it('returns durable provider_pending by purge deadline and ignores a late acknowledgement until an explicit retry', async () => {
    const { service, provider, consent, enroll } = await setupVoiceIdentity(); await consent(); await enroll();
    let release!: () => void, signal: AbortSignal | undefined, template: Uint8Array | undefined;
    vi.mocked(provider.purge).mockImplementationOnce(input => { signal = input.signal; template = input.template; return new Promise<void>(resolve => { release = resolve; }); });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const abort = new AbortController(); setTimeout(() => abort.abort(), ms); return abort.signal; });
    const deletion = service.remove(123, scope);
    await vi.waitFor(() => expect(release).toBeDefined()); await vi.advanceTimersByTimeAsync(5001);
    expect(await deletion).toMatchObject({ deletion: 'provider_pending', enrollment: 'purge_pending' });
    expect(signal?.aborted).toBe(true); expect([...template!].every(value => value === 0)).toBe(true);
    release(); await Promise.resolve();
    expect((await service.read(123, scope)).deletion).toBe('provider_pending');
    vi.useRealTimers();
    expect((await service.remove(123, scope)).deletion).toBe('online_completed');
  });
  it('never invokes a provider for an already cancelled process request', async () => {
    const { service, provider, consent, intent, begin } = await setupVoiceIdentity();
    await consent(); await intent(); const capture = await begin(); const controller = new AbortController(); controller.abort();
    const audio = new Uint8Array([1, 2]);
    await expect(service.process(123, scope, capture.capture!.id, audio, 'audio/webm', controller.signal)).rejects.toMatchObject({ code: 'capture_cancelled' });
    expect(provider.inspect).not.toHaveBeenCalled(); expect(provider.extract).not.toHaveBeenCalled(); expect(audio).toEqual(new Uint8Array(2));
  });

  it('40 disabled device-session status visits and cancellations do not allocate durable rows', async () => {
    const { service, repository, adaptive } = await setupVoiceIdentity(false);
    const accountId = accountIdFor(123), personId = (await adaptive.read(123, 'work')).identity.personId!;
    for (let i = 1; i <= 40; i++) {
      const current = { ...scope, deviceId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` };
      expect(await service.read(123, current)).toMatchObject({ available: false, reason: 'provider_unavailable', revision: 0 });
      if (i % 10 === 0) expect((await service.cancel(123, current)).revision).toBe(0);
    }
    expect(await repository.all(accountId, personId, rows => rows.length)).toBe(0);
  });
  it('reclaims only legacy empty placeholders while preserving active templates, pending purge and revocation evidence', async () => {
    const { service, repository, adaptive, consent, enroll } = await setupVoiceIdentity();
    await consent(); await enroll();
    const accountId = accountIdFor(123), personId = (await adaptive.read(123, 'work')).identity.personId!;
    const pendingId = '22222222-2222-4222-8222-222222222222', revokedId = '33333333-3333-4333-8333-333333333333';
    const before = await repository.all(accountId, personId, rows => {
      rows.push({ ...structuredClone(rows[0]), deviceId: pendingId, intent: 'revoked', deletion: 'provider_pending' });
      rows.push({ ...scope, deviceId: revokedId, personId, revision: 4, epoch: 7, intent: 'revoked', deletion: 'online_completed',
        evidence: { copyHash: 'preserve-enrollment-evidence', locale: 'en', decidedAt: NOW, statement: 'enroll_my_voice' } });
      for (let i = 1; i <= 17; i++) rows.push({ ...scope, deviceId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, personId,
        revision: 0, epoch: 0, intent: 'not_asked', deletion: 'not_required' });
      return structuredClone(rows.filter(r => [scope.deviceId, pendingId, revokedId].includes(r.deviceId)));
    });
    const next = { ...scope, deviceId: '44444444-4444-4444-8444-444444444444' };
    expect((await service.read(123, next)).revision).toBe(0);
    expect(await repository.all(accountId, personId, rows => rows.length)).toBe(20);
    const presented = await service.present(123, next, 0, 'en'); expect(presented.receipt).toBeDefined();
    const after = await repository.all(accountId, personId, rows => structuredClone(rows));
    expect(after).toHaveLength(20);
    expect(after.filter(r => [scope.deviceId, pendingId, revokedId].includes(r.deviceId))).toEqual(before);
    expect(after.find(r => r.deviceId === next.deviceId)?.receipt).toBeDefined();
  });
  it('full protected capacity still permits unlimited status reads and refuses allocation without pruning revocations', async () => {
    const { service, repository, adaptive, consent } = await setupVoiceIdentity(); await consent();
    const accountId = accountIdFor(123), personId = (await adaptive.read(123, 'work')).identity.personId!;
    const before = await repository.all(accountId, personId, rows => {
      for (let i = 1; i <= 20; i++) rows.push({ ...scope, deviceId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, personId,
        revision: 2, epoch: i, intent: 'revoked', deletion: 'online_completed' });
      return structuredClone(rows);
    });
    for (let i = 21; i <= 50; i++) expect((await service.read(123, { ...scope, deviceId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` })).enrollment).toBe('none');
    await expect(service.present(123, scope, 0, 'en')).rejects.toMatchObject({ status: 409, code: 'storage_capacity' });
    expect(await repository.all(accountId, personId, rows => rows)).toEqual(before);
  });

});
