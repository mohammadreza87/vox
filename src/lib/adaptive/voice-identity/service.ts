import { randomUUID, randomInt } from 'crypto';
import type { AdaptiveService } from '../persistence/service';
import { AdaptiveError } from '../persistence/service';
import { accountIdFor, digest, spaceIdFor, type SpaceKind } from '../persistence/repository';
import { MAX_VOICE_BYTES, MAX_VOICE_DURATION_MS, VOICE_NOTICE_VERSION, type VoiceHint, type VoiceIdentitySnapshot, type VoiceNotice, type VoiceScope } from './contracts';
import type { VoiceIdentityProvider, VoiceProviderApproval } from './provider';
import { VoiceIdentityRepository, VoiceTemplateCipher, voiceDigest, type VoiceIdentityRow } from './repository';
const fail = (status: number, code: string): never => { throw new AdaptiveError(status, code); };
const CAPTURE_TTL = 30_000;
/** A cancellation signal alone cannot bound a broken adapter. Always race it;
 * late opaque extraction results are erased rather than installed. */
function boundedProvider<T>(work: Promise<T>, signal: AbortSignal, eraseLate?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => { if (!settled) { settled = true; reject(new AdaptiveError(409, 'capture_cancelled')); } };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void work.then(value => {
      if (settled) { try { eraseLate?.(value); } catch { /* Untrusted late adapter result. */ } return; }
      settled = true; signal.removeEventListener('abort', abort); resolve(value);
    }, error => { if (!settled) { settled = true; signal.removeEventListener('abort', abort); reject(error); } });
  });
}
async function boundedPurgeBatch<T>(values: readonly T[], work: (value: T) => Promise<void>): Promise<void> {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(5, values.length) }, async () => {
    while (index < values.length) await work(values[index++]);
  }));
}
interface Authority { accountId: string; personId: string; fingerprint: string; allowed: boolean; reason?: string; expiresAt: number; consent: VoiceIdentitySnapshot['consent'] }
export interface VoiceIdentityOptions {
  provider?: VoiceIdentityProvider; providerApproval?: VoiceProviderApproval; cipher?: VoiceTemplateCipher;
  enabled?: boolean; now?: () => number;
}
/** Deliberate self-only capture. No call stream, passive enrollment, global search,
 * identity mutation, memory grant, transcript or audio persistence exists here. */
export class VoiceIdentityService {
  private readonly now: () => number;
  private readonly active = new Map<string, Set<AbortController>>();
  constructor(readonly adaptive: AdaptiveService, readonly repository: VoiceIdentityRepository, private readonly options: VoiceIdentityOptions = {}) {
    this.now = options.now ?? Date.now;
  }
  private providerReady(): boolean {
    const p = this.options.provider, a = this.options.providerApproval, now = this.now();
    return this.options.enabled === true && !!p && !!a && !!this.options.cipher && p.retention === 'request_only' &&
      a.providerId === p.id && a.providerVersion === p.version && a.location === p.location && !!a.approvalReference &&
      a.noticeVersion === VOICE_NOTICE_VERSION && Number.isSafeInteger(a.expiresAt) && a.expiresAt > now &&
      Number.isSafeInteger(a.templateTtlMs) && a.templateTtlMs > 0 && a.templateTtlMs <= 180 * 86400_000 &&
      Number.isSafeInteger(a.consentTtlMs) && a.consentTtlMs > 0 && a.consentTtlMs <= 365 * 86400_000 &&
      !!a.disclosure.en.trim() && !!a.disclosure.fa.trim();
  }
  private authority(telegramId: number, space: SpaceKind): Promise<Authority> {
    return this.adaptive.withAccountDocument(telegramId, (d, now) => {
      const p = d.permissions.find(p => p.spaceId === spaceIdFor(d.accountId, space) && p.purpose === 'optional.biometric_recognition')!;
      const eligibility = this.adaptive.capabilityStatus(d, 'biometric_recognition', now);
      const confirmed = this.adaptive.isProfileConfirmed(d, now), provider = this.providerReady();
      const allowed = confirmed && provider && this.adaptive.isPurposeAllowed(d, space, 'optional.biometric_recognition', now);
      return { accountId: d.accountId, personId: d.personId, allowed,
        fingerprint: voiceDigest([d.accountId, d.personId, d.binding, p.epoch, p.state, p.expiresAt, eligibility, this.options.providerApproval]),
        reason: !confirmed ? 'profile_confirmation_required' : !provider ? 'provider_unavailable' : !eligibility.eligible ? eligibility.reason : p.state !== 'granted' || p.expiresAt <= now ? 'biometric_consent_required' : undefined,
        expiresAt: Math.min(p.expiresAt, eligibility.validUntil ?? now, d.binding?.expiresAt ?? now, this.options.providerApproval?.expiresAt ?? now),
        consent: p.state === 'granted' && p.expiresAt > now ? 'granted' : p.state === 'withdrawn' ? 'withdrawn' : p.state === 'expired' || p.expiresAt <= now && p.state === 'granted' ? 'expired' : 'not_asked' };
    });
  }
  private key(accountId: string, scope: VoiceScope): string { return JSON.stringify([accountId, scope.space, scope.deviceId]); }
  private stop(accountId: string, scope: VoiceScope): void {
    for (const controller of this.active.get(this.key(accountId, scope)) ?? []) controller.abort();
  }
  private snapshot(a: Authority, row: VoiceIdentityRow): VoiceIdentitySnapshot {
    const available = a.allowed;
    return { scope: { space: row.space, deviceId: row.deviceId }, revision: row.revision, available,
      ...(!available ? { reason: a.reason } : {}), consent: a.consent,
      enrollment: row.deletion === 'provider_pending' ? 'purge_pending' : row.intent === 'accepted' && !!row.template ? 'enrolled' : 'none',
      ...(row.templateExpiresAt ? { expiresAt: row.templateExpiresAt } : {}), deletion: row.deletion, backupExpiry: 'operator_policy' };
  }
  private notice(locale: 'en' | 'fa'): VoiceNotice {
    const title = locale === 'en' ? 'Enroll only your own voice' : 'فقط صدای خودتان را ثبت کنید';
    // The release owner must supply exact approved processor/location/retention copy.
    const body = this.options.providerApproval!.disclosure[locale];
    return { version: VOICE_NOTICE_VERSION, locale, title, body, copyHash: voiceDigest([VOICE_NOTICE_VERSION, locale, title, body]) };
  }
  private revoke(row: VoiceIdentityRow, state: 'revoked' | 'expired' = 'revoked'): void {
    row.intent = state; row.revision++; row.epoch++;
    delete row.capture; delete row.receipt; delete row.authority; delete row.intentExpiresAt;
    if (row.template) row.deletion = 'provider_pending';
    else row.deletion = 'online_completed';
  }
  private async purge(a: Pick<Authority, 'accountId' | 'personId'>, scope: VoiceScope, retry = false): Promise<void> {
    const row = await this.repository.transaction(a.accountId, a.personId, scope, row => {
      if (row.deletion !== 'provider_pending' || !row.template || (!retry && row.lastPurgeAt !== undefined)) return null;
      row.lastPurgeAt = this.now(); return structuredClone(row);
    });
    if (!row || row.deletion !== 'provider_pending' || !row.template) return;
    const p = this.options.provider, cipher = this.options.cipher;
    if (!p || !cipher || row.providerId !== p.id || row.providerVersion !== p.version || row.templateEpoch === undefined) return;
    let template: Uint8Array | undefined;
    try {
      template = cipher.decrypt(row.template, { ...scope, ...a, epoch: row.templateEpoch });
      const signal = AbortSignal.timeout(5000);
      await boundedProvider(p.purge({ template, signal }), signal);
      await this.repository.transaction(a.accountId, a.personId, scope, current => {
        if (current.deletion !== 'provider_pending' || voiceDigest(current.template) !== voiceDigest(row.template)) return;
        delete current.template; delete current.templateEpoch; delete current.templateExpiresAt; delete current.providerId; delete current.providerVersion;
        current.deletion = 'online_completed'; current.revision++;
      });
    } catch { /* Suppression is durable; the visible pending state is retryable. */ }
    finally { template?.fill(0); }
  }
  async read(telegramId: number, scope: VoiceScope): Promise<VoiceIdentitySnapshot> {
    const a = await this.authority(telegramId, scope.space), now = this.now();
    const revoked = await this.repository.transaction(a.accountId, a.personId, scope, row => {
      if (row.intent !== 'accepted') return false;
      if (!a.allowed || row.authority !== a.fingerprint || (row.intentExpiresAt ?? 0) <= now || row.template && (row.templateExpiresAt ?? 0) <= now) {
        this.revoke(row, (row.intentExpiresAt ?? 0) <= now ? 'expired' : 'revoked'); return true;
      }
      return false;
    });
    if (revoked) this.stop(a.accountId, scope);
    if (revoked) await this.purge(a, scope);
    return this.repository.transaction(a.accountId, a.personId, scope, row => this.snapshot(a, row));
  }
  async present(telegramId: number, scope: VoiceScope, expectedRevision: number, locale: 'en' | 'fa'): Promise<VoiceIdentitySnapshot> {
    await this.read(telegramId, scope);
    const a = await this.authority(telegramId, scope.space);
    if (!a.allowed) return fail(403, a.reason ?? 'voice_unavailable');
    const notice = this.notice(locale), receipt = randomUUID();
    return this.repository.transaction(a.accountId, a.personId, scope, row => {
      if (row.revision !== expectedRevision) return fail(409, 'revision_conflict');
      if (row.template || row.deletion === 'provider_pending') return fail(409, 'delete_before_reenrollment');
      row.receipt = { id: receipt, expiresAt: Math.min(this.now() + 10 * 60_000, a.expiresAt), copyHash: notice.copyHash, locale, authority: a.fingerprint };
      row.revision++;
      return { ...this.snapshot(a, row), notice, receipt };
    });
  }
  async acceptEnrollment(telegramId: number, scope: VoiceScope, expectedRevision: number, receipt: string): Promise<VoiceIdentitySnapshot> {
    const a = await this.authority(telegramId, scope.space), now = this.now();
    if (!a.allowed) return fail(403, a.reason ?? 'voice_unavailable');
    return this.repository.transaction(a.accountId, a.personId, scope, row => {
      if (row.revision !== expectedRevision) return fail(409, 'revision_conflict');
      const r = row.receipt;
      if (!r || r.id !== receipt || r.expiresAt <= now || r.authority !== a.fingerprint || r.copyHash !== this.notice(r.locale).copyHash) return fail(409, 'enrollment_disclosure_required');
      if (row.template || row.deletion === 'provider_pending') return fail(409, 'delete_before_reenrollment');
      row.intent = 'accepted'; row.epoch++; row.revision++; row.authority = a.fingerprint;
      row.intentExpiresAt = Math.min(a.expiresAt, now + this.options.providerApproval!.consentTtlMs);
      row.noticeVersion = VOICE_NOTICE_VERSION;
      row.evidence = { copyHash: r.copyHash, locale: r.locale, decidedAt: now, statement: 'enroll_my_voice' };
      delete row.receipt;
      return this.snapshot(a, row);
    });
  }
  async begin(telegramId: number, scope: VoiceScope, expectedRevision: number, mode: 'enroll' | 'test'): Promise<VoiceIdentitySnapshot> {
    await this.read(telegramId, scope);
    const a = await this.authority(telegramId, scope.space), now = this.now();
    if (!a.allowed) return fail(403, a.reason ?? 'voice_unavailable');
    const result = await this.repository.transaction(a.accountId, a.personId, scope, row => {
      if (row.revision !== expectedRevision) return fail(409, 'revision_conflict');
      if (row.intent !== 'accepted' || row.authority !== a.fingerprint || row.deletion === 'provider_pending') return fail(403, 'enrollment_required');
      if (mode === 'test' && !row.template || mode === 'enroll' && row.template) return fail(409, 'enrollment_state_conflict');
      row.epoch++;
      row.capture = { id: randomUUID(), mode, challenge: String(randomInt(100000, 999999)),
        expiresAt: Math.min(now + CAPTURE_TTL, a.expiresAt, row.intentExpiresAt!), epoch: row.epoch, authority: a.fingerprint };
      row.revision++;
      return { ...this.snapshot(a, row), capture: { ...row.capture, maxBytes: MAX_VOICE_BYTES, maxDurationMs: MAX_VOICE_DURATION_MS } };
    });
    this.stop(a.accountId, scope);
    return result;
  }
  async cancel(telegramId: number, scope: VoiceScope): Promise<VoiceIdentitySnapshot> {
    const a = await this.authority(telegramId, scope.space);
    this.stop(a.accountId, scope);
    await this.repository.transaction(a.accountId, a.personId, scope, row => { delete row.capture; row.epoch++; row.revision++; });
    return this.read(telegramId, scope);
  }
  async preflight(telegramId: number, scope: VoiceScope, captureId: string): Promise<void> {
    const a = await this.authority(telegramId, scope.space);
    if (!a.allowed) return fail(403, a.reason ?? 'voice_unavailable');
    await this.repository.transaction(a.accountId, a.personId, scope, row => {
      if (row.intent !== 'accepted' || row.authority !== a.fingerprint || !row.capture || row.capture.id !== captureId || row.capture.epoch !== row.epoch || row.capture.expiresAt <= this.now()) return fail(409, 'capture_expired');
    });
  }
  async process(telegramId: number, scope: VoiceScope, captureId: string, audio: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<{ status: VoiceIdentitySnapshot; hint?: VoiceHint }> {
    let query: Uint8Array | undefined, reference: Uint8Array | undefined;
    const controller = new AbortController();
    const onAbort = () => controller.abort(); signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    let timeout = setTimeout(() => controller.abort(), CAPTURE_TTL);
    let activeKey: string | undefined;
    try {
      if (!audio.byteLength || audio.byteLength > MAX_VOICE_BYTES || !['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'].includes(mimeType.split(';')[0])) return fail(400, 'invalid_voice_sample');
      const a = await this.authority(telegramId, scope.space), now = this.now();
      if (!a.allowed) return fail(403, a.reason ?? 'voice_unavailable');
      const row = await this.repository.transaction(a.accountId, a.personId, scope, row => {
        const c = row.capture;
        if (row.intent !== 'accepted' || row.authority !== a.fingerprint || !c || c.id !== captureId || c.expiresAt <= now || c.authority !== a.fingerprint || c.epoch !== row.epoch) return fail(409, 'capture_expired');
        const result = structuredClone(row); delete row.capture; row.revision++; return result;
      });
      clearTimeout(timeout);
      timeout = setTimeout(() => controller.abort(), Math.max(0, row.capture!.expiresAt - this.now()));
      activeKey = this.key(a.accountId, scope);
      const controllers = this.active.get(activeKey) ?? new Set<AbortController>(); controllers.add(controller); this.active.set(activeKey, controllers);
      const fresh = async () => {
        if (controller.signal.aborted) return fail(409, 'capture_cancelled');
        const latest = await this.authority(telegramId, scope.space);
        const valid = await this.repository.transaction(a.accountId, a.personId, scope, r => r.intent === 'accepted' && r.epoch === row.epoch && r.authority === latest.fingerprint && (r.intentExpiresAt ?? 0) > this.now());
        if (!latest.allowed || !valid || row.capture!.expiresAt <= this.now() || controller.signal.aborted) return fail(409, 'capture_cancelled');
      };
      const provider = this.options.provider!;
      await fresh();
      const inspection = await boundedProvider(provider.inspect({ audio, mimeType, challenge: row.capture!.challenge, maxDurationMs: MAX_VOICE_DURATION_MS, signal: controller.signal }), controller.signal);
      await fresh();
      if (inspection !== 'eligible_single_live') return { status: await this.read(telegramId, scope), hint: { outcome: 'unknown', authenticationRequired: true, identityChanged: false } };
      query = await boundedProvider(provider.extract({ audio, mimeType, signal: controller.signal }), controller.signal, value => value.fill(0));
      await fresh();
      if (!query.byteLength || query.byteLength > 65_536) return fail(502, 'invalid_provider_template');
      if (row.capture!.mode === 'enroll') {
        const encrypted = this.options.cipher!.encrypt(query, { ...scope, accountId: a.accountId, personId: a.personId, epoch: row.epoch });
        await fresh();
        await this.repository.transaction(a.accountId, a.personId, scope, current => {
          if (current.epoch !== row.epoch || current.intent !== 'accepted' || current.template) return fail(409, 'capture_cancelled');
          current.template = encrypted; current.templateEpoch = row.epoch; current.templateExpiresAt = Math.min(current.intentExpiresAt!, this.now() + this.options.providerApproval!.templateTtlMs);
          current.providerId = provider.id; current.providerVersion = provider.version; current.deletion = 'not_required'; delete current.lastPurgeAt; current.revision++;
        });
        return { status: await this.read(telegramId, scope) };
      }
      if (!row.template || row.templateEpoch === undefined || (row.templateExpiresAt ?? 0) <= this.now()) return fail(409, 'enrollment_required');
      reference = this.options.cipher!.decrypt(row.template, { ...scope, accountId: a.accountId, personId: a.personId, epoch: row.templateEpoch });
      await fresh();
      const match = await boundedProvider(provider.compare({ query, candidates: [{ id: 'self', template: reference }], signal: controller.signal }), controller.signal);
      await fresh();
      return { status: await this.read(telegramId, scope), hint: { outcome: match.candidateId === 'self' ? 'possible_self' : 'unknown', authenticationRequired: true, identityChanged: false } };
    } finally {
      audio.fill(0); query?.fill(0); reference?.fill(0); clearTimeout(timeout); signal?.removeEventListener('abort', onAbort);
      if (activeKey) { const controllers = this.active.get(activeKey); controllers?.delete(controller); if (!controllers?.size) this.active.delete(activeKey); }
    }
  }
  /** Hook runs after canonical permission/profile invalidation is committed. It
   * disables every device in the affected space before any awaited provider purge. */
  async invalidate(telegramId: number, space?: SpaceKind, retry = false): Promise<{ pending: number }> {
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return fail(401, 'authentication_required');
    const accountId = accountIdFor(telegramId);
    const a = { accountId, personId: `account-profile:${digest(accountId).slice(0, 32)}` };
    const scopes = await this.repository.all(a.accountId, a.personId, rows => rows.filter(r => !space || r.space === space).map(row => {
      if (row.intent === 'accepted' || row.capture || row.receipt) this.revoke(row);
      return { space: row.space, deviceId: row.deviceId };
    }));
    for (const scope of scopes) this.stop(a.accountId, scope);
    await boundedPurgeBatch(scopes, scope => this.purge(a, scope, retry));
    return this.repository.all(a.accountId, a.personId, rows => ({ pending: rows.filter(r => (!space || r.space === space) && r.deletion === 'provider_pending').length }));
  }
  /** Deployment maintenance iterates only its explicit account registry. Never
   * scans an identity directory or feeds biometric content into general jobs. */
  async maintenanceAccount(telegramId: number): Promise<{ pending: number }> {
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return fail(401, 'authentication_required');
    const started = this.now(), accountId = accountIdFor(telegramId), personId = `account-profile:${digest(accountId).slice(0, 32)}`;
    // At most two canonical reads, regardless of device count. Their invalidator
    // can attempt each newly revoked template only once, never recursively retry.
    const authorities = { work: await this.authority(telegramId, 'work'), personal: await this.authority(telegramId, 'personal') };
    const scopes = await this.repository.all(accountId, personId, rows => rows.flatMap(row => {
      const authority = authorities[row.space];
      if (row.intent === 'accepted' && (!authority.allowed || row.authority !== authority.fingerprint || (row.intentExpiresAt ?? 0) <= this.now() || row.template && (row.templateExpiresAt ?? 0) <= this.now())) this.revoke(row, 'expired');
      if (row.deletion !== 'provider_pending' || !row.template || row.lastPurgeAt !== undefined && row.lastPurgeAt >= started) return [];
      return [{ space: row.space, deviceId: row.deviceId }];
    }));
    for (const scope of scopes) this.stop(accountId, scope);
    // Five workers x 5s deadlines bound the 20-row store to <=20s of
    // provider waiting; canonical-hook and retry stages together <=25s.
    await boundedPurgeBatch(scopes, scope => this.purge({ accountId, personId }, scope, true));
    return this.repository.all(accountId, personId, rows => ({ pending: rows.filter(r => r.deletion === 'provider_pending').length }));
  }
  async remove(telegramId: number, scope: VoiceScope): Promise<VoiceIdentitySnapshot> {
    // Delete withdraws the canonical permission for the entire selected space.
    // Its durable epoch prevents an older separate voice-store snapshot from
    // reviving an enrollment after this deletion.
    const privacy = await this.adaptive.readAuthority(telegramId, scope.space);
    const permission = privacy.purposes.find(p => p.purpose === 'optional.biometric_recognition')!;
    const canonicalChanged = privacy.identity.confirmed && permission.state === 'granted';
    if (canonicalChanged) {
      await this.adaptive.changeConsent(telegramId, { space: scope.space, purpose: permission.purpose,
        expectedRevision: permission.revision, eventId: randomUUID(), state: 'withdrawn' });
    }
    await this.invalidate(telegramId, scope.space, !canonicalChanged);
    return this.read(telegramId, scope);
  }
}
