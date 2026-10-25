/**
 * Settings v2 quiet Telegram records: silent, content-light, from the agent's own bot, skipped silently when the
 * person never started that bot (and not retried for a day), never sent with the flag off. Plus the voice/skills
 * records for the creator and the /ask handoff in the agent's private chat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInitData } from '../auth';
import { handleStudioRequest } from '../http';
import { receiptText } from '../receipts';
import { connectPageUrl, CONNECTORS_COMMANDS, handleAgentUpdate } from '../updates';
import { TelegramApiError, type TelegramUpdate } from '../../tireh/telegram/client';
import { connectionReceipts } from '../../connections/receipts';
import type { ConnectionsSnapshot } from '../../connections/contracts';
import { agentShortCode } from '../../circles/codec';
import { hire, ID, makeStudio, SECRET, seedOrg, type Harness } from './helpers';

const BOT_TOKEN = '555:fixture-receipts-token';
let h: Harness;
let org: Awaited<ReturnType<typeof seedOrg>>;
let nova: Awaited<ReturnType<typeof hire>>;

beforeEach(async () => {
  vi.stubEnv('STUDIO_SETTINGS_V2', '1');
  h = makeStudio();
  h.studio.deps.webAppUrl = 'https://vox.example/studio';
  org = await seedOrg(h);
  nova = await hire(h, org.alice, { name: 'Nova' });
});
afterEach(() => { vi.unstubAllEnvs(); });

const bot = () => h.bots.get(nova.token)!;
const sent = () => bot().sendMessage.mock.calls;
const forbidden = () => new TelegramApiError('sendMessage', "Forbidden: bot can't initiate conversation with a user");

describe('StudioReceipts', () => {
  it('sends a silent, content-light record from the agent\'s own bot', async () => {
    bot().sendMessage.mockClear();
    expect(await h.studio.receipts.send({ agentId: nova.agent.id, telegramId: ID.bob, kind: 'access', provider: 'Gmail', hours: 8 })).toBe('sent');
    expect(sent()).toEqual([[ID.bob, 'Record: you let Nova use Gmail for 8 hours. It asks before each use.', { silent: true }]]);
  });

  it('skips silently when the person never started the bot, and does not retry within a day', async () => {
    bot().sendMessage.mockClear();
    bot().sendMessage.mockRejectedValueOnce(forbidden());
    expect(await h.studio.receipts.send({ agentId: nova.agent.id, telegramId: ID.bob, kind: 'connected', provider: 'Gmail' })).toBe('skipped');
    expect(await h.studio.receipts.send({ agentId: nova.agent.id, telegramId: ID.bob, kind: 'disconnected', provider: 'Gmail' })).toBe('skipped');
    expect(sent()).toHaveLength(1);
    expect(h.logger.warn).not.toHaveBeenCalledWith('[studio] receipt_failed');
  });

  it('respects a signed allows_write_to_pm=false, the flag, and a missing or retired agent', async () => {
    bot().sendMessage.mockClear();
    expect(await h.studio.receipts.send({ agentId: nova.agent.id, telegramId: ID.bob, kind: 'connected', provider: 'Gmail', allowsWriteToPm: false })).toBe('skipped');
    expect(await h.studio.receipts.send({ agentId: 'missing', telegramId: ID.bob, kind: 'connected', provider: 'Gmail' })).toBe('skipped');
    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    expect(await h.studio.receipts.send({ agentId: nova.agent.id, telegramId: ID.bob, kind: 'connected', provider: 'Gmail' })).toBe('skipped');
    expect(sent()).toEqual([]);
  });

  it('other Telegram failures are logged once and never thrown', async () => {
    bot().sendMessage.mockRejectedValue(new Error('socket hang up'));
    expect(await h.studio.receipts.send({ agentId: nova.agent.id, telegramId: ID.bob, kind: 'connected', provider: 'Gmail' })).toBe('failed');
    expect(await h.studio.receipts.send({ agentId: nova.agent.id, telegramId: ID.alice, kind: 'connected', provider: 'Gmail' })).toBe('failed');
    expect(h.logger.warn.mock.calls.filter(c => c[0] === '[studio] receipt_failed')).toHaveLength(1);
  });

  it('speaks Persian when the person does, with Persian digits', () => {
    expect(receiptText({ agentId: 'a', telegramId: 1, kind: 'access', provider: 'Gmail', hours: 8, locale: 'fa' }, 'نوا')).toBe('ثبت: به نوا اجازه دادید ۸ ساعت از Gmail استفاده کند. پیش از هر استفاده از شما می‌پرسد.');
    expect(receiptText({ agentId: 'a', telegramId: 1, kind: 'skills', count: 5, max: 8, locale: 'fa' }, 'نوا')).toContain('۵ از ۸');
  });
});

describe('connection records from a before/after snapshot', () => {
  const connection = (id: string, providerId: string, lifecycle: string, extra: Record<string, unknown> = {}) => ({ id, providerId, displayLabel: 'PRIVATE_ACCOUNT_LABEL', revision: 1, lifecycle, health: 'healthy', checkedAt: null, revocationEpoch: 0, agentId: 'a1', ...extra });
  const grant = (id: string, connectionId: string, expiresAt: number) => ({ id, connectionId, agentId: 'a1', status: 'active', expiresAt });
  const snap = (connections: unknown[], grants: unknown[] = []) => ({ connections, grants, operations: [] }) as unknown as ConnectionsSnapshot;
  const now = Date.UTC(2026, 9, 25);
  it('names a provider or an MCP host only: never the account label, the server path or an id', () => {
    const mcp = { mcp: { canonicalResourceUri: 'https://mcp.private-host.net/team/secret-path/mcp', catalog: null } };
    const out = connectionReceipts(snap([connection('c1', 'gmail', 'pending'), connection('c2', 'remote_mcp', 'pending', mcp)]),
      snap([connection('c1', 'gmail', 'connected'), connection('c2', 'remote_mcp', 'connected', mcp)], [grant('g1', 'c1', now + 8 * 3_600_000)]), now);
    expect(out).toEqual([
      { agentId: 'a1', kind: 'connected', provider: 'Gmail' },
      { agentId: 'a1', kind: 'mcp_added', host: 'mcp.private-host.net' },
      { agentId: 'a1', kind: 'access', provider: 'Gmail', hours: 8 },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/PRIVATE_ACCOUNT_LABEL|secret-path|c1|c2|g1/);
  });
  it('an ended access on a still-connected account, and a disconnect, each say so once', () => {
    const before = snap([connection('c1', 'gmail', 'connected')], [grant('g1', 'c1', now + 1)]);
    expect(connectionReceipts(before, snap([connection('c1', 'gmail', 'connected')]), now)).toEqual([{ agentId: 'a1', kind: 'access_ended', provider: 'Gmail' }]);
    expect(connectionReceipts(before, snap([connection('c1', 'gmail', 'revoked')]), now)).toEqual([{ agentId: 'a1', kind: 'disconnected', provider: 'Gmail' }]);
    // Unbound (legacy) connections leave no record.
    expect(connectionReceipts(snap([connection('c3', 'gmail', 'pending', { agentId: undefined })]), snap([connection('c3', 'gmail', 'connected', { agentId: undefined })]), now)).toEqual([]);
  });
  it('removing a setup that never finished changes no one\'s access: no record', () => {
    const mcp = { mcp: { canonicalResourceUri: 'https://example.com/mcp', catalog: null } };
    expect(connectionReceipts(snap([connection('c1', 'remote_mcp', 'pending', mcp)]), snap([connection('c1', 'remote_mcp', 'revoked', mcp)]), now)).toEqual([]);
    expect(connectionReceipts(snap([connection('c2', 'gmail', 'pending')]), snap([connection('c2', 'gmail', 'deleted')]), now)).toEqual([]);
    // A paused (once usable) one does say so.
    expect(connectionReceipts(snap([connection('c3', 'gmail', 'paused')]), snap([connection('c3', 'gmail', 'revoked')]), now)).toEqual([{ agentId: 'a1', kind: 'disconnected', provider: 'Gmail' }]);
  });
  it('revoking access that had already run out (as Renew does) records only the new access, not an "ended" now', () => {
    const before = snap([connection('c1', 'gmail', 'connected')], [grant('g1', 'c1', now - 3_600_000)]);
    const revoked = snap([connection('c1', 'gmail', 'connected')], [{ ...grant('g1', 'c1', now - 3_600_000), status: 'revoked' }]);
    expect(connectionReceipts(before, revoked, now)).toEqual([]);
    const renewed = snap([connection('c1', 'gmail', 'connected')], [{ ...grant('g1', 'c1', now - 3_600_000), status: 'revoked' }, grant('g2', 'c1', now + 8 * 3_600_000)]);
    expect(connectionReceipts(revoked, renewed, now)).toEqual([{ agentId: 'a1', kind: 'access', provider: 'Gmail', hours: 8 }]);
  });
});

describe('voice and skills records for the creator', () => {
  const patch = (body: unknown, as = ID.alice, language_code?: string) => {
    const req = new Request(`http://localhost/api/studio/agents/${nova.agent.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json',
      'x-telegram-init-data': signInitData({ id: as, first_name: 'A', ...(language_code ? { language_code } : {}) }, BOT_TOKEN) }, body: JSON.stringify(body) });
    return handleStudioRequest(h.studio, req, ['agents', nova.agent.id], { botToken: BOT_TOKEN, devUser: null });
  };
  it('a committed skills change sends the creator a quiet record; an unchanged save sends nothing', async () => {
    bot().sendMessage.mockClear();
    expect((await patch({ persona: { skillIds: ['core.decision-memo'] } })).status).toBe(200);
    await h.studio.receipts.flush();
    expect(sent()).toEqual([[ID.alice, 'Record: Nova’s skills changed (1 of 8).', { silent: true }]]);
    expect((await patch({ persona: { tagline: 'Same skills' } })).status).toBe(200);
    await h.studio.receipts.flush();
    expect(sent()).toHaveLength(1);
  });
  it('flag off: no record', async () => {
    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    bot().sendMessage.mockClear();
    expect((await patch({ persona: { skillIds: ['core.decision-memo'] } })).status).toBe(200);
    await h.studio.receipts.flush();
    expect(sent()).toEqual([]);
  });

  const voice = (body: unknown, language_code?: string) => {
    const req = new Request(`http://localhost/api/studio/agents/${nova.agent.id}/voice`, { method: 'POST', headers: { 'content-type': 'application/json',
      'x-telegram-init-data': signInitData({ id: ID.alice, first_name: 'A', ...(language_code ? { language_code } : {}) }, BOT_TOKEN) }, body: JSON.stringify(body) });
    return handleStudioRequest(h.studio, req, ['agents', nova.agent.id, 'voice'], { botToken: BOT_TOKEN, devUser: null });
  };
  it('each voice choice (library, built-in, designed) sends the creator one quiet record of the new label; re-choosing or designing previews sends none', async () => {
    bot().sendMessage.mockClear();
    expect((await voice({ action: 'choose-library', publicOwnerId: 'o1', voiceId: 'v1', name: 'Sam' })).status).toBe(200);
    await h.studio.receipts.flush();
    expect(sent()).toEqual([[ID.alice, 'Record: Nova’s voice is now Sam · voice library.', { silent: true }]]);
    // The same voice again changes nothing.
    expect((await voice({ action: 'choose-library', publicOwnerId: 'o1', voiceId: 'v1', name: 'Sam' })).status).toBe(200);
    // Designing only makes previews: the voice in use is unchanged.
    expect((await voice({ action: 'design', description: 'A warm low voice with a light Tehran accent' })).status).toBe(200);
    await h.studio.receipts.flush();
    expect(sent()).toHaveLength(1);
    expect((await voice({ action: 'choose-default', voiceId: 'fixture-sarah' }, 'fa')).status).toBe(200);
    await h.studio.receipts.flush();
    expect(sent()[1]).toEqual([ID.alice, 'ثبت: صدای Nova اکنون Sarah · built-in است.', { silent: true }]);
    expect((await voice({ action: 'choose-design', generatedVoiceId: 'gen-1' })).status).toBe(200);
    await h.studio.receipts.flush();
    expect(sent()).toHaveLength(3);
    expect(sent()[2][1]).toMatch(/^Record: Nova’s voice is now Designed voice · /);
    expect(sent().every(([, , options]) => (options as { silent?: boolean }).silent === true)).toBe(true);
  });
  it('flag off: a voice change sends no record', async () => {
    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    bot().sendMessage.mockClear();
    expect((await voice({ action: 'choose-default', voiceId: 'fixture-sarah' })).status).toBe(200);
    await h.studio.receipts.flush();
    expect(sent()).toEqual([]);
  });
  it('a refused voice change (not the creator) sends no record', async () => {
    bot().sendMessage.mockClear();
    const req = new Request(`http://localhost/api/studio/agents/${nova.agent.id}/voice`, { method: 'POST', headers: { 'content-type': 'application/json',
      'x-telegram-init-data': signInitData({ id: ID.bob, first_name: 'B' }, BOT_TOKEN) }, body: JSON.stringify({ action: 'choose-default', voiceId: 'fixture-sarah' }) });
    expect((await handleStudioRequest(h.studio, req, ['agents', nova.agent.id, 'voice'], { botToken: BOT_TOKEN, devUser: null })).status).toBe(403);
    await h.studio.receipts.flush();
    expect(sent()).toEqual([]);
  });
});

describe('/ask in the agent\'s private chat hands off to its Connections Mini App', () => {
  let n = 9000;
  const dm = (from: number, text: string, chat: { id: number; type: string } = { id: from, type: 'private' }, language_code?: string): TelegramUpdate =>
    ({ update_id: ++n, message: { message_id: n, date: 0, text, from: { id: from, is_bot: false, first_name: 'X', ...(language_code ? { language_code } : {}) }, chat } }) as TelegramUpdate;
  it('a member gets a quiet web_app button; nothing reaches the model or the chat history', async () => {
    bot().sendMessage.mockClear();
    const before = h.chatLLM.replyRequests.length + h.chatLLM.extractionCalls;
    const append = vi.spyOn(h.studio.deps.memory.history, 'append');
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/ask'));
    // Part 3: a Studio member also gets "Open in Vox" (Settings › Nova › Connectors through the manager bot).
    expect(sent()).toEqual([[ID.bob, 'Open Connectors to ask Nova with an app you connected. Each use is reviewed there, and answers stay private to you.',
      { silent: true, keyboard: { inline_keyboard: [[{ text: 'Open Connectors', web_app: { url: `https://vox.example/studio/connect/${nova.agent.id}?ask=1` } }],
        [{ text: 'Open in Vox', url: `https://t.me/VoxxBot?start=s_${agentShortCode(SECRET, nova.agent.id)}_c` }]] } }]]);
    expect(h.chatLLM.replyRequests.length + h.chatLLM.extractionCalls).toBe(before);
    expect(append).not.toHaveBeenCalled();
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/connectors@nova_bot', undefined, 'fa'));
    expect(sent()[1][1]).toContain('اتصال‌ها');
  });
  it('flag off: /ask takes today\'s path (no handoff button)', async () => {
    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    bot().sendMessage.mockClear();
    const append = vi.spyOn(h.studio.deps.memory.history, 'append');
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/ask')).catch(() => undefined);
    expect(JSON.stringify(sent())).not.toContain('studio/connect');
    expect(append.mock.calls.length + h.chatLLM.replyRequests.length).toBeGreaterThan(0);
  });
  it('answers exactly the commands the settings registry declares for Connectors & plugins', async () => {
    const { settingCommands } = await import('../../../app/studio/_lib/settings/registry');
    const entry = settingCommands().find((c) => c.id === 'agent.connectors')!;
    expect([entry.command, ...entry.aliases ?? []].sort()).toEqual([...CONNECTORS_COMMANDS].sort());
    for (const command of [entry.command, ...entry.aliases ?? []]) {
      bot().sendMessage.mockClear();
      await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, `/${command}`));
      expect(JSON.stringify(sent())).toContain('studio/connect');
    }
    // A command the registry does not declare is not handed off.
    bot().sendMessage.mockClear();
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/connect')).catch(() => undefined);
    expect(JSON.stringify(sent())).not.toContain('studio/connect');
  });
  it('builds only an HTTPS Mini App URL', () => {
    expect(connectPageUrl('http://vox.example/studio', 'a1')).toBeNull();
    expect(connectPageUrl(undefined, 'a1')).toBeNull();
    expect(connectPageUrl('https://vox.example/studio', '../x')).toBeNull();
    expect(connectPageUrl('https://vox.example/studio', 'a1')).toBe('https://vox.example/studio/connect/a1?ask=1');
  });
});
