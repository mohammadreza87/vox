import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FirestoreStudioStore } from '../firestore-store';
import { AGENT_UPDATES, handleAgentUpdate, handleManagerUpdate, isValidWebhookSecret, MANAGER_UPDATES, registerWebhooks, STRANGER_VOICE_PLACEHOLDER, webhookSecret } from '../updates';
import type { TelegramUpdate } from '../../tireh/telegram/client';
import { hire, ID, makeStudio, SECRET, seedOrg, T0, type FakeTelegram, type Harness } from './helpers';
import type { AdaptiveExperienceService } from '../../adaptive/runtime/service';

describe('webhook secrets', () => {
  it('derives a distinct, Telegram-safe secret per bot', () => {
    const a = webhookSecret(SECRET, 'manager');
    const b = webhookSecret(SECRET, 'ag-1');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    expect(webhookSecret('another-secret-that-is-32-chars-long!!', 'manager')).not.toBe(a);
  });

  it('only accepts the secret of the bot the route is for', () => {
    expect(isValidWebhookSecret(SECRET, 'ag-1', webhookSecret(SECRET, 'ag-1'))).toBe(true);
    expect(isValidWebhookSecret(SECRET, 'ag-1', webhookSecret(SECRET, 'manager'))).toBe(false);
    expect(isValidWebhookSecret(SECRET, 'ag-1', null)).toBe(false);
    expect(isValidWebhookSecret(SECRET, 'ag-1', '')).toBe(false);
  });
});

describe('manager onboarding', () => {
  it('records reminder reachability only from an approved member in their own private manager DM', async () => {
    const h = makeStudio(), { alice } = await seedOrg(h);
    const noteReminderRecipient = vi.fn(async () => undefined);
    h.studio.deps.experience = { noteReminderRecipient } as unknown as AdaptiveExperienceService;
    h.studio.deps.reminderEndpointId = 'credential-bound-endpoint';
    const message = { message_id: 1, date: 0, text: 'Hello',
      chat: { id: alice.telegramId, type: 'private' as const },
      from: { id: alice.telegramId, is_bot: false, first_name: 'Alice' } };
    await handleManagerUpdate(h.studio, { update_id: 1, message });
    expect(noteReminderRecipient).toHaveBeenCalledWith(alice.telegramId, 'credential-bound-endpoint');
    noteReminderRecipient.mockClear();
    await handleManagerUpdate(h.studio, { update_id: 2, message: { ...message, chat: { id: -42, type: 'group' } } });
    await handleManagerUpdate(h.studio, { update_id: 3, message: { ...message, chat: { id: alice.telegramId + 1, type: 'private' } } });
    await handleManagerUpdate(h.studio, { update_id: 4, message: { ...message, chat: { id: 9090, type: 'private' }, from: { id: 9090, is_bot: false, first_name: 'Pending' } } });
    expect(noteReminderRecipient).not.toHaveBeenCalled();
  });
  it.each(['/start', 'Hello, can I get access?'])('shows an unapproved person their User ID and how to request access after %s', async (text) => {
    const h = makeStudio();
    await handleManagerUpdate(h.studio, {
      update_id: 1,
      message: {
        message_id: 1, date: 0, text, chat: { id: 7070, type: 'private' },
        from: { id: 7070, is_bot: false, first_name: 'Neda', last_name: 'Karimi', username: 'neda' },
      },
    });
    expect(h.manager.sendMessage).toHaveBeenCalledWith(7070, expect.stringContaining('Share your User ID with an admin to get access.'), {});
    const reply = h.manager.sendMessage.mock.calls[0][1];
    expect(reply).toContain('Username: @neda\nFirst name: Neda\nLast name: Karimi\nUser ID: 7070');
    expect((await h.store.read()).members[0].role).toBe('pending');
  });

  it('keeps showing approved people their own account details on ordinary private messages', async () => {
    const h = makeStudio();
    const { alice } = await seedOrg(h);
    await handleManagerUpdate(h.studio, {
      update_id: 1,
      message: {
        message_id: 1, date: 0, text: 'Hello', chat: { id: alice.telegramId, type: 'private' },
        from: { id: alice.telegramId, is_bot: false, first_name: 'Alice' },
      },
    });
    const reply = h.manager.sendMessage.mock.calls[0][1];
    expect(reply).toContain('Spawn, call and manage');
    expect(reply).toContain(`User ID: ${alice.telegramId}`);
    expect((await h.store.read()).members.find(member => member.telegramId === alice.telegramId)?.role).toBe('member');
  });
});

describe('serverless mode', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeStudio();
  });

  it('registerWebhooks points VoxxBot and every active agent at this deployment', async () => {
    const org = await seedOrg(h);
    const { agent, bot } = await hire(h, org.alice);
    h.studio.deps.webAppUrl = 'https://vox.example/studio';
    const result = await registerWebhooks(h.studio, 'https://vox.example/');
    expect(result).toEqual({ manager: true, agents: [agent.id], failed: [] });
    expect(h.manager.setWebhook).toHaveBeenCalledWith('https://vox.example/api/studio/telegram/manager', webhookSecret(SECRET, 'manager'), MANAGER_UPDATES);
    expect(bot().setWebhook).toHaveBeenCalledWith(`https://vox.example/api/studio/telegram/${agent.id}`, webhookSecret(SECRET, agent.id), AGENT_UPDATES);
    expect(h.manager.setChatMenuButton).toHaveBeenCalledWith('Open Studio', 'https://vox.example/studio');
  });

  it('a newly hired bot gets its webhook before any profile call', async () => {
    h.studio.deps.webhookBase = 'https://vox.example';
    const org = await seedOrg(h);
    const { agent, bot } = await hire(h, org.alice);
    const b = bot();
    expect(b.setWebhook).toHaveBeenCalledWith(`https://vox.example/api/studio/telegram/${agent.id}`, webhookSecret(SECRET, agent.id), AGENT_UPDATES);
    expect(b.setWebhook.mock.invocationCallOrder[0]).toBeLessThan(b.setMyName.mock.invocationCallOrder[0]);
  });

  it('long-polling mode never sets agent webhooks', async () => {
    const org = await seedOrg(h);
    const { bot } = await hire(h, org.alice);
    expect(bot().setWebhook).not.toHaveBeenCalled();
  });
});

/** Minimal in-memory Firestore + bucket, enough for FirestoreStudioStore. */
function fakeFirestore() {
  const docs = new Map<string, Record<string, unknown>>();
  const ref = (path: string) => ({
    path,
    get: async () => ({ get: (field: string) => docs.get(path)?.[field] }),
  });
  let failNextCommit = false;
  return {
    docs,
    failNextCommit: () => { failNextCommit = true; },
    db: {
      doc: ref,
      runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
        const writes: Array<[string, Record<string, unknown>]> = [];
        const tx = {
          get: async (r: { path: string }) => ({ get: (field: string) => docs.get(r.path)?.[field] }),
          set: (r: { path: string }, data: Record<string, unknown>) => { writes.push([r.path, data]); },
        };
        const out = await fn(tx);
        if (failNextCommit) { failNextCommit = false; throw new Error('commit failed'); }
        for (const [p, d] of writes) docs.set(p, d);
        return out;
      },
    },
  };
}

function fakeBucket() {
  const files = new Map<string, Buffer>();
  return {
    files,
    bucket: {
      file: (path: string) => ({
        save: vi.fn(async (data: Buffer) => { files.set(path, data); }),
        download: async () => [files.get(path)!] as [Buffer],
        exists: async () => [files.has(path)] as [boolean],
      }),
    },
  };
}

describe('FirestoreStudioStore', () => {
  const make = () => {
    const fs = fakeFirestore();
    const b = fakeBucket();
    const store = new FirestoreStudioStore(fs.db as never, b.bucket);
    return { fs, b, store };
  };

  it('starts empty and round-trips updates through one document', async () => {
    const { store, fs } = make();
    expect(await store.read()).toEqual({ members: [], agents: [], groups: [], audit: [] });
    await store.update((s) => { s.members.push({ telegramId: 1, name: 'A', role: 'member', joinedAt: 'x' }); });
    expect((await store.read()).members).toHaveLength(1);
    expect(typeof fs.docs.get('studio/state')?.json).toBe('string');
  });

  it('a throwing update or failed commit changes nothing', async () => {
    const { store, fs } = make();
    await expect(store.update(() => { throw new Error('nope'); })).rejects.toThrow('nope');
    fs.failNextCommit();
    await expect(store.update((s) => { s.groups.push({} as never); })).rejects.toThrow('commit failed');
    expect(await store.read()).toEqual({ members: [], agents: [], groups: [], audit: [] });
  });

  it('returns copies and trims the audit trail to fit one document', async () => {
    const { store } = make();
    const members = await store.update((s) => { s.members.push({ telegramId: 1, name: 'A', role: 'member', joinedAt: 'x' }); return s.members; });
    members[0].name = 'Mutated';
    expect((await store.read()).members[0].name).toBe('A');
    for (let i = 0; i < 6; i++) await store.update((s) => { for (let j = 0; j < 100; j++) s.audit.push({ at: 'x', actor: i, action: 'a' }); });
    expect((await store.read()).audit).toHaveLength(500);
  });

  it('keeps media in the bucket under safe names only', async () => {
    const { store, b } = make();
    await store.saveMedia('av-1.jpg', Buffer.from('img'));
    expect(b.files.get('studio/media/av-1.jpg')?.toString()).toBe('img');
    expect((await store.readMedia('av-1.jpg'))?.toString()).toBe('img');
    expect(await store.readMedia('missing.jpg')).toBeNull();
    await expect(store.saveMedia('../x.jpg', Buffer.from('x'))).rejects.toThrow('Unsafe media file name');
    expect(await store.readMedia('../studio.json')).toBeNull();
  });
});

describe('voice notes from outside the team never reach speech-to-text (PRIV-023)', () => {
  let nextUpdate = 910_000;
  const voice = { file_id: 'synthetic-voice-file', duration: 3, mime_type: 'audio/ogg' };
  function strangerVoiceNote(): TelegramUpdate {
    const id = nextUpdate++;
    return { update_id: id, message: { message_id: id, date: 0, voice,
      from: { id: ID.stranger, is_bot: false, first_name: 'Sam' }, chat: { id: ID.stranger, type: 'private' } } };
  }
  function expectNoSpeechToText(h: Harness, bot: FakeTelegram) {
    expect(bot.downloadFile).not.toHaveBeenCalled();
    expect(h.openai.transcribe).not.toHaveBeenCalled();
    expect(h.eleven.transcribe).not.toHaveBeenCalled();
  }

  it.each(['reply', 'decline', 'ignore', 'block'] as const)('a stranger voice note to a public agent is decided (%s) without download or transcription', async (action) => {
    const h = makeStudio();
    const org = await seedOrg(h);
    const { agent, bot } = await hire(h, org.alice, {}, undefined, 'public');
    const decided: unknown[] = [];
    const chat = h.chatLLM;
    h.studio.deps.chatLLM = { complete: async (request) => {
      if (!request.system.includes('Decide, in character')) return chat.complete(request);
      decided.push(request.messages);
      return JSON.stringify({ action, message: 'Synthetic in-character answer.' });
    } };

    await handleAgentUpdate(h.studio, agent.id, strangerVoiceNote());

    expect(decided).toEqual([[{ role: 'user', content: STRANGER_VOICE_PLACEHOLDER }]]);
    expectNoSpeechToText(h, bot());
    // Nothing from the voice note is ever composed into a reply prompt.
    expect(chat.replyPrompts).toEqual([]);
    const sent = bot().sendMessage.mock.calls.map((call) => call[1]);
    if (action === 'reply') expect(sent).toEqual([expect.stringContaining('Could you type it instead?')]);
    else if (action === 'ignore') expect(sent).toEqual([]);
    else expect(sent).toEqual(['Synthetic in-character answer.']);
    expect((await h.store.read()).agents.find((a) => a.id === agent.id)?.blocked ?? []).toEqual(action === 'block' ? [ID.stranger] : []);
  });

  it('a voice note addressed to the agent in a group flagged hasGuests is never downloaded or transcribed', async () => {
    const h = makeStudio();
    const org = await seedOrg(h);
    const { agent, bot, botId } = await hire(h, org.alice);
    const chatId = -4242;
    await h.store.update((s) => {
      s.groups.push({ chatId, title: 'Mixed room', memberIds: [ID.alice, ID.bob], hasGuests: true, agentIds: [agent.id], addedAt: T0.toISOString() });
    });
    const id = nextUpdate++;
    await handleAgentUpdate(h.studio, agent.id, { update_id: id, message: { message_id: id, date: 0, voice,
      from: { id: ID.bob, is_bot: false, first_name: 'Bob' }, chat: { id: chatId, type: 'supergroup', title: 'Mixed room' },
      // Replying to the agent's own message addresses it without any text.
      reply_to_message: { message_id: 1, date: 0, chat: { id: chatId, type: 'supergroup' }, from: { id: botId, is_bot: true, first_name: 'Nova' } } } });

    expectNoSpeechToText(h, bot());
    expect(h.chatLLM.replyPrompts).toEqual([]);
    expect(bot().sendMessage).toHaveBeenCalledTimes(1);
    expect(bot().sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('Could you type it instead?'), { replyTo: id });
  });
});
