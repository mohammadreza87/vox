import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AdaptiveService } from '../../persistence/service';
import { AdaptiveRepository, accountIdFor, type SpaceKind } from '../../persistence/repository';
import { FileAdaptiveStorage } from '../../persistence/storage';
import { adaptiveOptionsFromManifest } from '../../persistence/config';
import { AdaptiveExperienceService } from '../service';
import { createStudioReminderDelivery } from '../../../studio/reminder-delivery';
import type { Studio } from '../../../studio/service';
import { signInitData } from '../../../studio/auth';
import { handleExperienceRequest } from '../http';
import { pruneFileReminderDelivery, removeReminderDeliveryForRollback } from './rollback';
import { GENERIC_REMINDER_TEXT } from './service';
const BASE = Date.UTC(2026, 9, 19, 12), endpointId = 'synthetic-manager-endpoint';
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function setup(start = BASE, enabled = true) {
  const directory = await mkdtemp(join(tmpdir(), 'vox-reminder-')); dirs.push(directory); let now = start;
  const capabilities = ['core_text', 'reminder_delivery'];
  const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic', enabledCapabilities: capabilities,
    accounts: [{ accountId: accountIdFor(123), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }], approvals: capabilities.map((capability, i) => ({ schemaVersion: 1, id: `synthetic-${i}`, revision: 1,
      createdAt: start, updatedAt: start, jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic', effectiveAt: start,
      reviewExpiresAt: start + 400 * 86_400_000, owner: 'synthetic', approvalReference: 'synthetic-only' })) });
  const state = { members: [{ telegramId: 123, role: 'member' }], agents: [{ id: 'agent1', status: 'active', createdBy: 123, visibility: 'private', access: [], blocked: [] as number[] }] };
  const storeRead = vi.fn(async () => state);
  const fetcher = vi.fn(async () => Response.json({ ok: true, result: { message_id: 99, chat: { id: 123 } } }));
  const factory = () => {
    const adaptive = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(directory)), { ...adaptiveOptionsFromManifest(manifest), now: () => now });
    const experience = new AdaptiveExperienceService(adaptive, { notificationsEnabled: enabled, notificationEndpointId: endpointId });
    const studio = { deps: { store: { read: storeRead, readCommittedForEffect: () => structuredClone(state) }, experience } } as unknown as Studio;
    const delivery = createStudioReminderDelivery(studio, { enabled, endpointId, botToken: '123:synthetic-not-real', webAppUrl: 'https://vox.test/studio', fetcher, now: () => now });
    return { adaptive, experience, studio, delivery };
  };
  const { adaptive, experience, studio, delivery } = factory();
  await adaptive.confirm(123, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
  const command = async (space: SpaceKind = 'work') => ({ space, expectedRevision: (await adaptive.read(123, space)).revision, eventId: randomUUID() });
  async function consent(space: SpaceKind = 'work', granted = true) {
    const current = await adaptive.read(123, space), purpose = 'optional.reminder_delivery';
    const permission = current.purposes.find(p => p.purpose === purpose)!;
    if (!granted) return adaptive.changeConsent(123, { space, purpose, expectedRevision: permission.revision, eventId: randomUUID(), state: 'withdrawn' });
    const shown = await adaptive.present(123, { space, purpose, locale: 'en', expectedRevision: permission.revision, eventId: randomUUID(), deliberateReopen: true });
    await adaptive.changeConsent(123, { space, purpose, expectedRevision: shown.purposes.find(p => p.purpose === purpose)!.revision, receipt: shown.receipt, eventId: randomUUID(), state: 'granted' });
  }
  async function enableChannel(space: SpaceKind = 'work') {
    const presented = await experience.presentReminderChannel(123, await command(space));
    await experience.reminderChannel(123, { ...await command(space), enabled: true, receipt: presented.reminderTelegram!.disclosure!.receipt, disclosureVersion: presented.reminderTelegram!.disclosure!.version });
  }
  async function configure(space: SpaceKind = 'work', timezone: string | null = 'UTC') {
    await consent(space);
    await adaptive.setAgentAccess(123, 'agent1', { ...await command(space), allowed: true });
    await experience.settings(123, { ...await command(space), timezone, dailyCap: 2, quietStartHour: 21, quietEndHour: 8, inboxEnabled: true, proactiveEnabled: false, reminderEnabled: true });
    if (enabled) { await experience.noteReminderRecipient(123, endpointId); await enableChannel(space); }
  }
  async function reminder(space: SpaceKind = 'work', quietHours: 'respect' | 'allow_at_requested_time' = 'respect') {
    const input = { ...await command(space), agentId: 'agent1', label: 'PRIVATE_REMINDER_CANARY', dueAt: now + 1000, quietHours };
    await experience.reminder(123, input); return input.eventId;
  }
  return { adaptive, experience, studio, delivery, directory, manifest, factory, storeRead, fetcher, command, consent, configure, enableChannel, reminder, state, setNow: (value: number) => { now = value; }, now: () => now };
}
const item = async (f: Awaited<ReturnType<typeof setup>>, id: string) => f.adaptive.withAccountDocument(123, d => structuredClone(d.experience.inbox.find(i => i.id === id)!));
describe('ordinary durable reminder scheduling and delivery', () => {
  it('delivers through the real Studio adapter after file-store restart with no app read; exports generic content only', async () => {
    const f = await setup(); await f.configure(); const id = await f.reminder();
    f.setNow(BASE + 1000);
    expect(await f.factory().delivery.drainAccount(123)).toMatchObject({ accepted: 1, claimed: 1 });
    expect(f.fetcher).toHaveBeenCalledOnce();
    const [url, options] = f.fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bot123:synthetic-not-real/sendMessage');
    const body = JSON.parse(String(options.body)); expect(body.text).toBe(GENERIC_REMINDER_TEXT); expect(body.chat_id).toBe(123);
    expect(body.reply_markup.inline_keyboard[0][0].web_app.url).toBe(`https://vox.test/studio?notification=${id}`);
    expect(JSON.stringify(body)).not.toContain('PRIVATE_REMINDER_CANARY');
    expect(await f.factory().delivery.drainAccount(123)).toMatchObject({ accepted: 0, claimed: 0 });
    expect((await item(f, id)).delivery?.state).toBe('accepted');
    const ledger = await f.adaptive.withAccountDocument(123, d => d.experience.reminderDelivery!.ledger);
    expect(ledger[0]).toMatchObject({ state: 'accepted', messageId: '99' }); expect(JSON.stringify(ledger)).not.toContain('PRIVATE_REMINDER_CANARY');
  });
  it('serializes duplicate workers across independent file adapters', async () => {
    const f = await setup(); await f.configure(); await f.reminder(); f.setNow(BASE + 1000);
    const result = await Promise.all([f.factory().delivery.drainAccount(123), f.factory().delivery.drainAccount(123)]);
    expect(result.reduce((sum, r) => sum + r.accepted, 0)).toBe(1); expect(f.fetcher).toHaveBeenCalledOnce();
  });
  it('requires actual recipient proof, separate channel and purpose; defaults never send or seed delivery state', async () => {
    const f = await setup(BASE, false); await f.configure(); await f.reminder(); f.setNow(BASE + 1000);
    expect(await f.delivery.drainAccount(123)).toMatchObject({ claimed: 0 }); expect(f.fetcher).not.toHaveBeenCalled();
    expect(await f.adaptive.withAccountDocument(123, d => d.experience.reminderDelivery)).toBeUndefined();
    await expect(f.experience.reminderChannel(123, { ...await f.command(), enabled: true })).rejects.toMatchObject({ code: 'feature_disabled' });
    const g = await setup(); await g.consent();
    await expect(g.experience.reminderChannel(123, { ...await g.command(), enabled: true })).rejects.toMatchObject({ code: 'private_dm_required' });
  });
  it('does not blindly retry unknown transport outcomes; explicit snooze creates a new generation and keeps the old unknown receipt', async () => {
    const f = await setup(); await f.configure(); const id = await f.reminder(); f.setNow(BASE + 1000);
    f.fetcher.mockRejectedValueOnce(new TypeError('SYNTHETIC_PRIVATE_PROVIDER_ERROR'));
    expect(await f.delivery.drainAccount(123)).toMatchObject({ unknown: 1 });
    expect(await f.factory().delivery.drainAccount(123)).toMatchObject({ claimed: 0 }); expect(f.fetcher).toHaveBeenCalledOnce();
    await f.experience.reminderAction(123, { ...await f.command(), itemId: id, action: 'acknowledge_unknown' });
    expect((await item(f, id)).delivery).toMatchObject({ state: 'unknown', acknowledgedAt: BASE + 1000 });
    await f.experience.reminderAction(123, { ...await f.command(), itemId: id, action: 'snooze', dueAt: BASE + 60_000 });
    f.setNow(BASE + 60_000); expect(await f.factory().delivery.drainAccount(123)).toMatchObject({ accepted: 1 });
    const ledger = await f.adaptive.withAccountDocument(123, d => d.experience.reminderDelivery!.ledger);
    expect(ledger.map(r => r.state)).toEqual(['unknown', 'accepted']); expect((await item(f, id)).delivery?.generation).toBe(2);
    expect(JSON.stringify(ledger)).not.toContain('SYNTHETIC_PRIVATE_PROVIDER_ERROR');
  });
  it.each(['consent', 'agent', 'channel', 'inbox', 'reminders', 'quiet', 'timezone', 'membership', 'blocked', 'endpoint', 'source', 'quiet_boundary'] as const)('fresh final send gate suppresses %s changes during the recipient check', async change => {
    const f = await setup(); await f.configure(); const id = await f.reminder(); f.setNow(BASE + 1000);
    if (change === 'quiet_boundary') f.setNow(Date.UTC(2026, 9, 19, 20, 59, 59));
    let reads = 0;
    f.storeRead.mockImplementation(async () => {
      if (++reads === 3) {
        if (change === 'consent') await f.consent('work', false);
        if (change === 'agent') await f.adaptive.setAgentAccess(123, 'agent1', { ...await f.command(), allowed: false });
        if (change === 'channel') await f.experience.reminderChannel(123, { ...await f.command(), enabled: false });
        if (change === 'source') await f.experience.reminderAction(123, { ...await f.command(), itemId: id, action: 'cancel' });
        if (change === 'endpoint') await f.adaptive.withAccountDocument(123, d => { d.experience.reminderDelivery!.recipient!.endpointId = 'rotated-endpoint'; });
        if (change === 'membership') f.state.members = [];
        if (change === 'blocked') f.state.agents[0].blocked = [123];
        if (change === 'quiet_boundary') f.setNow(Date.UTC(2026, 9, 19, 21));
        if (['inbox', 'reminders', 'quiet', 'timezone'].includes(change)) await f.experience.settings(123, { ...await f.command(), timezone: change === 'timezone' ? 'Pacific/Auckland' : 'UTC', dailyCap: 2,
          quietStartHour: change === 'quiet' ? 0 : 21, quietEndHour: change === 'quiet' ? 23 : 8, inboxEnabled: change !== 'inbox', reminderEnabled: change !== 'reminders', proactiveEnabled: false });
      }
      return f.state;
    });
    expect(await f.delivery.drainAccount(123)).toMatchObject({ accepted: 0 }); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('keeps unknown timezone and quiet-hour alerts queued, and permits only explicit exact-time override', async () => {
    const f = await setup(Date.UTC(2026, 9, 19, 22)); await f.configure('work', null); const first = await f.reminder(); f.setNow(f.now() + 1000);
    expect(await f.delivery.drainAccount(123)).toMatchObject({ claimed: 0 }); expect((await item(f, first)).delivery?.state).toBe('scheduled');
    await f.experience.settings(123, { ...await f.command(), timezone: 'UTC', dailyCap: 2, quietStartHour: 21, quietEndHour: 8, inboxEnabled: true, reminderEnabled: true, proactiveEnabled: false });
    expect(await f.delivery.drainAccount(123)).toMatchObject({ claimed: 0 });
    const exact = await f.reminder('work', 'allow_at_requested_time'); f.setNow(f.now() + 1000);
    expect(await f.delivery.drainAccount(123)).toMatchObject({ accepted: 1 }); expect((await item(f, exact)).delivery?.state).toBe('accepted');
  });
  it.each([
    { start: Date.UTC(2026, 9, 25, 0, 30), later: Date.UTC(2026, 9, 25, 1, 30), end: Date.UTC(2026, 9, 25, 2), quietStart: 3, quietEnd: 4 },
    { start: Date.UTC(2026, 2, 29, 0, 30), later: Date.UTC(2026, 2, 29, 0, 50), end: Date.UTC(2026, 2, 29, 1), quietStart: 2, quietEnd: 4 },
  ])('respects IANA quiet windows across actual DST repeated/skipped hours %#', async test => {
    const f = await setup(test.start); await f.configure('work', 'Europe/Tallinn');
    await f.experience.settings(123, { ...await f.command(), timezone: 'Europe/Tallinn', dailyCap: 2, quietStartHour: test.quietStart, quietEndHour: test.quietEnd, inboxEnabled: true, reminderEnabled: true, proactiveEnabled: false });
    await f.reminder(); f.setNow(test.later); expect(await f.delivery.drainAccount(123)).toMatchObject({ accepted: 0 });
    f.setNow(test.end); expect(await f.delivery.drainAccount(123)).toMatchObject({ accepted: 1 });
  });
  it.each(['claimed', 'dispatching'] as const)('real child-process crash at %s survives restart with safe dedupe', async phase => {
    const f = await setup(); await f.configure(); const id = await f.reminder();
    const script = join(f.directory, 'crash-worker.ts'), marker = join(f.directory, 'request-started');
    const source = `import { writeFileSync } from 'node:fs';
import { AdaptiveService } from '${resolve('src/lib/adaptive/persistence/service.ts')}';
import { AdaptiveRepository } from '${resolve('src/lib/adaptive/persistence/repository.ts')}';
import { FileAdaptiveStorage } from '${resolve('src/lib/adaptive/persistence/storage.ts')}';
import { adaptiveOptionsFromManifest } from '${resolve('src/lib/adaptive/persistence/config.ts')}';
import { AdaptiveExperienceService } from '${resolve('src/lib/adaptive/runtime/service.ts')}';
import { createStudioReminderDelivery } from '${resolve('src/lib/studio/reminder-delivery.ts')}';
async function main(){const adaptive=new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(process.argv[2])),{...adaptiveOptionsFromManifest(process.argv[3]),now:()=>${BASE + 1000}});const experience=new AdaptiveExperienceService(adaptive,{notificationsEnabled:true,notificationEndpointId:'${endpointId}'});let reads=0;const studio={deps:{experience,store:{readCommittedForEffect:()=>(${JSON.stringify(f.state)}),read:async()=>{if(++reads===2&&process.argv[4]==='claimed')process.exit(77);return ${JSON.stringify(f.state)};}}}};const delivery=createStudioReminderDelivery(studio as any,{enabled:true,endpointId:'${endpointId}',botToken:'synthetic',now:()=>${BASE + 1000},fetcher:async()=>{writeFileSync(process.argv[5],'attempt');process.exit(77);}});await delivery.drainAccount(123);}main();`;
    await writeFile(script, source);
    const code = await new Promise<number | null>((done, reject) => {
      const child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), script, f.directory, f.manifest, phase, marker], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
      let error = ''; child.stderr.on('data', b => { error += b.toString(); }); child.on('error', reject); child.on('exit', code => code === 77 ? done(code) : reject(new Error(error || `worker exited ${code}`)));
    });
    expect(code).toBe(77); f.setNow(BASE + 16_001);
    const report = await f.factory().delivery.drainAccount(123);
    if (phase === 'dispatching') { expect(report.accepted).toBe(0); expect((await item(f, id)).delivery?.state).toBe('unknown'); expect(f.fetcher).not.toHaveBeenCalled(); expect(await readFile(marker, 'utf8')).toBe('attempt'); }
    else { expect(report.accepted).toBe(1); expect(f.fetcher).toHaveBeenCalledOnce(); expect(await readdir(f.directory)).not.toContain('request-started'); }
  });
});

describe('authenticated reminder HTTP boundaries', () => {
  async function harness() {
    const f = await setup(); await f.configure(); const id = await f.reminder('personal').catch(() => '');
    // Personal requires its own consent and channel; work authorization cannot create it.
    expect(id).toBe('');
    await f.configure('personal'); const personalId = await f.reminder('personal');
    f.studio.ensureMember = async user => ({ telegramId: user.id, role: 'member', name: 'Synthetic', joinedAt: '' });
    const request = (path: string[], method = 'GET', body?: unknown, telegramId = 123, origin = 'https://vox.test') => handleExperienceRequest(f.studio, f.experience,
      new Request(`https://vox.test/api/studio/experience/${path.join('/')}`, { method, headers: { 'x-telegram-init-data': signInitData({ id: telegramId, first_name: 'Synthetic' }, '123:synthetic'), origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), path, '123:synthetic');
    return { ...f, personalId, request };
  }
  it('resolves only the authenticated own allowed source scope, independently of URL claims', async () => {
    const f = await harness();
    expect(await (await f.request(['reminders', f.personalId])).json()).toEqual({ space: 'personal' });
    expect((await f.request(['reminders', f.personalId], 'GET', undefined, 124)).status).toBe(404);
    f.state.agents[0].blocked.push(123);
    expect((await f.request(['reminders', f.personalId])).status).toBe(404);
  });
  it('rejects recipient injection, cross-origin snooze and wrong scope; withdrawal removes the route', async () => {
    const f = await harness();
    expect((await f.request(['reminder-channel'], 'PUT', { ...await f.command(), enabled: true, telegramId: 999 })).status).toBe(400);
    const input = { ...await f.command('personal'), itemId: f.personalId, action: 'snooze', dueAt: BASE + 60_000 };
    expect((await f.request(['reminder-action'], 'POST', input, 123, 'https://evil.test')).status).toBe(403);
    expect((await f.request(['reminder-action'], 'POST', { ...input, space: 'work' })).status).toBe(404);
    await f.consent('personal', false);
    expect((await f.request(['reminders', f.personalId])).status).toBe(404); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('shows future reminders and can snooze through the real authenticated runtime service', async () => {
    const f = await harness(); const workId = await f.reminder();
    const read = await (await f.request([])).json();
    expect(read.inbox).toHaveLength(0); expect(read.reminders.map((i: { id: string }) => i.id)).toEqual([workId]);
    expect(JSON.stringify(read)).not.toContain(f.personalId);
    const response = await f.request(['reminder-action'], 'POST', { ...await f.command(), itemId: workId, action: 'snooze', dueAt: BASE + 60_000 });
    expect(response.status).toBe(200); expect((await response.json()).reminders[0].dueAt).toBe(BASE + 60_000);
    f.setNow(BASE + 60_000); expect(await f.factory().delivery.drainAccount(123)).toMatchObject({ accepted: 2 });
  });
});

it('rollback projection removes only new delivery fields, preserving private items and original ledger evidence', async () => {
  const f = await setup(); await f.configure(); const id = await f.reminder(); f.setNow(BASE + 1000); await f.delivery.drainAccount(123);
  const original = await f.adaptive.withAccountDocument(123, d => structuredClone(d));
  const projected = removeReminderDeliveryForRollback(original);
  expect(projected.experience.reminderDelivery).toBeUndefined(); expect(projected.experience.inbox.find(i => i.id === id)?.delivery).toBeUndefined();
  expect(original.experience.reminderDelivery?.ledger[0].state).toBe('accepted');
  const expected = structuredClone(original); delete expected.experience.reminderDelivery; for (const item of expected.experience.inbox) delete item.delivery;
  expect(projected).toEqual(expected); expect(projected.experience.inbox[0].label).toBe('PRIVATE_REMINDER_CANARY');
});

it('rechecks Studio block after canonical I/O and before the final fetch', async () => {
  const f = await setup(); await f.configure(); await f.reminder(); f.setNow(BASE + 1000);
  let recipientReads = 0; f.storeRead.mockImplementation(async () => { recipientReads++; return f.state; });
  const original = f.adaptive.withAccountDocument.bind(f.adaptive);
  vi.spyOn(f.adaptive, 'withAccountDocument').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (result === true && recipientReads === 4) f.state.agents[0].blocked.push(123);
    return result;
  });
  expect(await f.delivery.drainAccount(123)).toMatchObject({ accepted: 0, cancelled: 1 });
  expect(recipientReads).toBe(5); expect(f.fetcher).not.toHaveBeenCalled();
});

it('requires explicit scope, stopped producers and exact account CAS for rollback; preview never writes', async () => {
  const f = await setup(); await f.configure(); await f.reminder();
  const filename = (await readdir(f.directory)).find(file => file.endsWith('.json'))!;
  const before = await readFile(join(f.directory, filename), 'utf8');
  const options = { directory: f.directory, accountId: accountIdFor(123) };
  const preview = await pruneFileReminderDelivery(options); expect(preview.changed).toBe(true);
  expect(await readFile(join(f.directory, filename), 'utf8')).toBe(before);
  await expect(pruneFileReminderDelivery({ ...options, apply: true })).rejects.toThrow('rollback_stop_producers_and_digest_required');
  await expect(pruneFileReminderDelivery({ ...options, apply: true, producersStopped: true, expectedContentSha256: '0'.repeat(64) })).rejects.toThrow('rollback_document_changed');
  await pruneFileReminderDelivery({ ...options, apply: true, producersStopped: true, expectedContentSha256: preview.contentSha256 });
  expect((JSON.parse(await readFile(join(f.directory, filename), 'utf8'))).experience.reminderDelivery).toBeUndefined();
});

it.each(['authorization', 'permission', 'approval'] as const)('does not cross %s expiry during the final Studio read', async expiry => {
  const f = await setup(); await f.configure();
  const deadline = BASE + 12 * 60 * 60_000;
  if (expiry === 'permission') await f.adaptive.withAccountDocument(123, d => { d.permissions.find(p => p.id === 'permission:work:optional.reminder_delivery')!.expiresAt = deadline; d.binding!.expiresAt = deadline + 60_000; });
  if (expiry === 'approval') {
    await f.adaptive.withAccountDocument(123, d => { d.binding!.expiresAt = deadline + 60_000; });
    const original = f.adaptive.capabilityStatus.bind(f.adaptive);
    vi.spyOn(f.adaptive, 'capabilityStatus').mockImplementation((d, capability, now) => ({ ...original(d, capability, now), validUntil: deadline }));
  }
  // Bind the channel fingerprint to the adjusted permission/binding authority.
  await f.enableChannel();
  if (expiry === 'authorization') await f.adaptive.withAccountDocument(123, d => { d.experience.reminderDelivery!.work.authorization!.expiresAt = deadline; });
  // New reminder has the current channel revision and remains due at the boundary.
  await f.reminder('work', 'allow_at_requested_time');
  f.setNow(deadline - 1); let reads = 0;
  f.storeRead.mockImplementation(async () => { if (++reads === 5) f.setNow(deadline + 1); return f.state; });
  expect(await f.delivery.drainAccount(123)).toMatchObject({ accepted: 0 }); expect(f.fetcher).not.toHaveBeenCalled();
});

it('does not let quiet-deferred candidates starve an explicit requested-time alert within the per-pass limit', async () => {
  const f = await setup(Date.UTC(2026, 9, 19, 22)); await f.configure();
  await f.reminder(); await f.reminder(); await f.reminder('work', 'allow_at_requested_time'); f.setNow(f.now() + 1000);
  expect(await f.delivery.drainAccount(123, { limit: 1 })).toMatchObject({ accepted: 1 }); expect(f.fetcher).toHaveBeenCalledOnce();
});

describe('explicit durable reminder-only authorization', () => {
  it('delivers a next-day reminder after file restart and interactive expiry without enabling private reads or commands', async () => {
    const f = await setup(); await f.configure();
    const dueAt = BASE + 2 * 86400_000;
    const input = { ...await f.command(), agentId: 'agent1', label: 'NEXT_DAY_PRIVATE', dueAt };
    await f.experience.reminder(123, input);
    f.setNow(dueAt);
    const restarted = f.factory();
    const before = await restarted.adaptive.read(123, 'work'); expect(before.identity.confirmed).toBe(false);
    const snapshot = await restarted.experience.read(123, 'work'); expect(snapshot.reminders).toEqual([]);
    await expect(restarted.experience.reminder(123, { ...await f.command(), agentId: 'agent1', label: 'BLOCKED_CREATE', dueAt: dueAt + 1000 })).rejects.toMatchObject({ code: 'profile_confirmation_required' });
    await expect(restarted.experience.reminderAction(123, { ...await f.command(), itemId: input.eventId, action: 'snooze', dueAt: dueAt + 1000 })).rejects.toMatchObject({ code: 'profile_confirmation_required' });
    expect(await restarted.delivery.drainAccount(123)).toMatchObject({ accepted: 1 }); expect(f.fetcher).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.fetcher.mock.calls)).not.toContain('NEXT_DAY_PRIVATE');
  });
  it('requires a current server presentation receipt and never upgrades legacy enabled channels implicitly', async () => {
    const f = await setup(); await f.configure();
    await f.adaptive.withAccountDocument(123, d => { delete d.experience.reminderDelivery!.work.authorization; });
    expect((await f.experience.read(123, 'work')).reminderTelegram).toMatchObject({ enabled: false, renewalRequired: true });
    await expect(f.experience.reminderChannel(123, { ...await f.command(), enabled: true })).rejects.toMatchObject({ code: 'reminder_disclosure_required' });
    const presented = await f.experience.presentReminderChannel(123, await f.command());
    await expect(f.experience.reminderChannel(123, { ...await f.command(), enabled: true, receipt: 'invented', disclosureVersion: 'generic-reminders-30d-v1' })).rejects.toMatchObject({ code: 'reminder_disclosure_required' });
    f.setNow(BASE + 600_001);
    await expect(f.experience.reminderChannel(123, { ...await f.command(), enabled: true, receipt: presented.reminderTelegram!.disclosure!.receipt, disclosureVersion: 'generic-reminders-30d-v1' })).rejects.toMatchObject({ code: 'reminder_disclosure_required' });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('binds presentation to the recipient and purpose; normal same-person reconfirmation does not extend the authorization', async () => {
    const f = await setup(); await f.configure();
    const original = await f.adaptive.withAccountDocument(123, d => structuredClone(d.experience.reminderDelivery!.work.authorization!));
    const presented = await f.experience.presentReminderChannel(123, await f.command());
    await f.adaptive.withAccountDocument(123, d => { d.experience.reminderDelivery!.recipient!.revision++; });
    await expect(f.experience.reminderChannel(123, { ...await f.command(), enabled: true, receipt: presented.reminderTelegram!.disclosure!.receipt, disclosureVersion: 'generic-reminders-30d-v1' })).rejects.toMatchObject({ code: 'reminder_disclosure_required' });
    await f.enableChannel(); const renewed = await f.adaptive.withAccountDocument(123, d => structuredClone(d.experience.reminderDelivery!.work.authorization!));
    f.setNow(BASE + 86400_000); await f.adaptive.confirm(123, { confirm: true });
    const after = await f.adaptive.withAccountDocument(123, d => d.experience.reminderDelivery!.work.authorization!);
    expect(after.id).toBe(renewed.id); expect(after.expiresAt).toBe(renewed.expiresAt); expect(after.expiresAt).toBe(original.expiresAt);
    expect((await f.experience.read(123, 'work')).reminderTelegram?.enabled).toBe(true);
  });
  it('rejects external due times beyond the disclosed authorization and never sends after its expiry', async () => {
    const f = await setup(); await f.configure();
    const expiry = await f.adaptive.withAccountDocument(123, d => d.experience.reminderDelivery!.work.authorization!.expiresAt);
    await expect(f.experience.reminder(123, { ...await f.command(), agentId: 'agent1', label: 'TOO_LATE', dueAt: expiry })).rejects.toMatchObject({ code: 'reminder_authorization_renewal_required' });
    await f.reminder(); f.setNow(expiry);
    expect(await f.factory().delivery.drainAccount(123)).toMatchObject({ accepted: 0 }); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it.each(['identity_clear', 'recipient', 'purpose', 'grant'] as const)('revokes queued background reminders on %s after interactive expiry', async change => {
    const f = await setup(); await f.configure(); const dueAt = BASE + 2 * 86400_000;
    await f.experience.reminder(123, { ...await f.command(), agentId: 'agent1', label: 'DO_NOT_EXPORT', dueAt });
    f.setNow(dueAt);
    await f.adaptive.withAccountDocument(123, d => {
      if (change === 'identity_clear') delete d.binding;
      if (change === 'recipient') d.experience.reminderDelivery!.recipient!.revision++;
      if (change === 'purpose') { const p = d.permissions.find(p => p.id === 'permission:work:optional.reminder_delivery')!; p.state = 'withdrawn'; p.revision++; p.epoch++; }
      if (change === 'grant') d.agentGrants.find(g => g.agentId === 'agent1' && g.space === 'work')!.allowed = false;
    });
    expect(await f.factory().delivery.drainAccount(123)).toMatchObject({ accepted: 0 }); expect(f.fetcher).not.toHaveBeenCalled();
  });
});

it('synchronous committed-file send fence sees canonical withdrawal during the final awaited Studio read', async () => {
  const f = await setup(); await f.configure(); await f.reminder(); f.setNow(BASE + 1000);
  let reads = 0; f.storeRead.mockImplementation(async () => { if (++reads === 5) await f.consent('work', false); return f.state; });
  expect(await f.delivery.drainAccount(123)).toMatchObject({ accepted: 0, cancelled: 1 });
  expect(reads).toBe(5); expect(f.fetcher).not.toHaveBeenCalled();
});
it('busy committed-file fence defers an unattempted generation and safely retries later', async () => {
  const f = await setup(); await f.configure(); const id = await f.reminder(); f.setNow(BASE + 1000);
  const storage = f.adaptive.repository.storage as FileAdaptiveStorage;
  const original = storage.readCommittedForEffect.bind(storage);
  const { mkdirSync, rmdirSync } = await import('node:fs');
  const filename = (await readdir(f.directory)).find(file => file.endsWith('.json'))!;
  vi.spyOn(storage, 'readCommittedForEffect').mockImplementationOnce(accountId => {
    const lock = join(f.directory, `${filename}.lock`); mkdirSync(lock);
    try { return original(accountId); } finally { rmdirSync(lock); }
  });
  expect(await f.delivery.drainAccount(123)).toMatchObject({ deferred: 1, accepted: 0 }); expect(f.fetcher).not.toHaveBeenCalled();
  expect((await item(f, id)).delivery?.state).toBe('scheduled');
  expect(await f.delivery.drainAccount(123)).toMatchObject({ accepted: 1 }); expect(f.fetcher).toHaveBeenCalledOnce();
});
it('explicit renewal preserves only valid scheduled alerts and never arms inbox-only or unknown items', async () => {
  const f = await setup(); await f.configure(); const scheduled = await f.reminder();
  await f.adaptive.withAccountDocument(123, d => {
    const source = d.experience.inbox.find(i => i.id === scheduled)!;
    d.experience.inbox.push({ ...structuredClone(source), id: 'inbox-only', sourceEventId: 'inbox-only', delivery: undefined });
    d.experience.inbox.push({ ...structuredClone(source), id: 'already-unknown', sourceEventId: 'already-unknown', delivery: { ...source.delivery!, state: 'unknown' } });
  });
  await f.enableChannel();
  f.setNow(BASE + 1000); expect(await f.delivery.drainAccount(123)).toMatchObject({ accepted: 1 });
  expect(f.fetcher).toHaveBeenCalledOnce(); expect((await item(f, 'inbox-only')).delivery).toBeUndefined();
  expect((await item(f, 'already-unknown')).delivery?.state).toBe('unknown');
});
it('renewal refuses transfer of claimed or dispatching attempts with an explicit retry state', async () => {
  const f = await setup(); await f.configure(); const id = await f.reminder();
  const presented = await f.experience.presentReminderChannel(123, await f.command());
  await f.adaptive.withAccountDocument(123, d => { d.experience.inbox.find(i => i.id === id)!.delivery!.state = 'claimed'; });
  await expect(f.experience.reminderChannel(123, { ...await f.command(), enabled: true, receipt: presented.reminderTelegram!.disclosure!.receipt, disclosureVersion: 'generic-reminders-30d-v1' })).rejects.toMatchObject({ code: 'reminder_delivery_busy' });
  expect(f.fetcher).not.toHaveBeenCalled();
});
it('identity clear then reconfirm cannot resurrect old reminder authorization even without an intervening pruner', async () => {
  const f = await setup(); await f.configure(); const id = await f.reminder();
  // Simulate the backend identity-clear seam before an interactive confirmation.
  await f.adaptive.repository.storage.transact(accountIdFor(123), raw => { const d = raw as { binding?: unknown }; delete d.binding; return { document: d, result: null }; });
  await f.adaptive.confirm(123, { confirm: true }); f.setNow(BASE + 1000);
  expect((await f.experience.read(123, 'work')).reminderTelegram?.enabled).toBe(false);
  expect(await f.delivery.drainAccount(123)).toMatchObject({ accepted: 0 }); expect(f.fetcher).not.toHaveBeenCalled();
  expect((await item(f, id)).status).toBe('cancelled');
});
