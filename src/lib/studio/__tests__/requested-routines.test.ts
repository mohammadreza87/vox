import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { TelegramMessage } from '../../tireh/telegram/client';
import { createStudioRequestedRoutines, handleRequestedRoutineMessage, hasExplicitDailyIntent, noteRequestedRoutineActivity, parseDailyCommand } from '../requested-routines';
import { startBots } from '../bots';
import { handleAgentUpdate } from '../updates';
import { validateStudioConfig } from '../runtime';
import { makeStudio, seedOrg, hire, ID, SECRET, type Harness } from './helpers';
import type { RoutineBinding } from '../routines';

let h: Harness;
let hired: Awaited<ReturnType<typeof hire>>;
let enabled: boolean;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let binding: RoutineBinding;
const message = (text: string, id = 1, userId = ID.superadmin): TelegramMessage => ({ message_id: id, date: 1, text, from: { id: userId, first_name: 'Synthetic', is_bot: false }, chat: { id: userId, type: 'private' } });
const send = (text: string, id = 1, extra: Partial<TelegramMessage> = {}) => handleRequestedRoutineMessage(h.studio, hired.agent.id, { ...message(text, id), ...extra }, h.studio.relationshipEndpointId(hired.token));
const lastReply = () => hired.bot().sendMessage.mock.calls.at(-1)?.[1] ?? '';

beforeEach(async () => {
  h = makeStudio(); const org = await seedOrg(h); hired = await hire(h, org.superadmin);
  enabled = true;
  fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 432, chat: { id: ID.superadmin } } }), { status: 200 }));
  h.studio.deps.requestedRoutinesEnabled = () => enabled;
  h.studio.deps.requestedRoutines = createStudioRequestedRoutines(h.studio, { filePath: join(h.dir, 'routines.json'), enabled: () => enabled, fetcher, now: () => h.clock.now });
  binding = { memberId: `telegram-account:${ID.superadmin}`, agentId: hired.agent.id, telegramUserId: String(ID.superadmin), telegramChatId: String(ID.superadmin), telegramBotId: String(hired.botId), tokenFingerprint: createHash('sha256').update(hired.token).digest('hex') };
  hired.bot().sendMessage.mockClear();
});
afterEach(() => { vi.useRealTimers(); h.studio.deps.requestedRoutines?.close(); rmSync(h.dir, { recursive: true, force: true }); });

describe('explicit daily command and bounded natural intent', () => {
  it('validates fixed and adaptive commands with real IANA zones', () => {
    expect(parseDailyCommand('/daily Europe/Tallinn teach slang')).toMatchObject({ type: 'create', timing: 'adaptive', timeZone: 'Europe/Tallinn' });
    expect(parseDailyCommand('/daily 09:30 Europe/Tallinn teach slang')).toMatchObject({ type: 'create', timing: 'fixed', localTime: '09:30' });
    expect(parseDailyCommand('/daily 29:30 Mars/Olympus slang')).toEqual({ type: 'help' });
    expect(parseDailyCommand('/daily stop')).toEqual({ type: 'stop' });
    expect(hasExplicitDailyIntent('Please teach me a slang phrase every day')).toBe(true);
    for (const text of ['What does daily mean?', 'She said send me slang daily', 'Do not send me slang daily', '> send me slang daily', 'If I ask you to send me slang daily']) expect(hasExplicitDailyIntent(text)).toBe(false);
  });
  it.each([
    ['please pause daily lessons', 'pause'], ['please pause my daily lessons', 'pause'],
    ['stop sending me daily slang', 'stop'], ['cancel my daily routine', 'stop'],
    ['please resume my daily lessons', 'resume'], ['continue my daily lessons', 'resume'],
    ['درس روزانه را متوقف کن', 'stop'], ['درس روزانه را لغو کن', 'stop'],
    ['لطفاً درس‌های روزانه‌ام را موقتا متوقف کن', 'pause'], ['درس روزانه رو ادامه بده', 'resume'],
    ['درس روزانه را از سر بگیر', 'resume'], ['دیگه هر روز اصطلاح نفرست', 'stop'],
  ])('parses explicit natural control %s as %s', (text, type) => {
    expect(parseDailyCommand(text)).toEqual({ type });
  });
  it.each(['stop', 'pause', 'continue', 'stop doing that', 'لطفا متوقف کن', 'ادامه بده', '> stop sending me daily slang', 'She said cancel my daily routine', 'درس روزانه را لغو نکن', 'درس روزانه را موقتا متوقف نکن', 'او گفت درس روزانه را لغو کن', '«درس روزانه را لغو کن»'])('does not infer a daily control from %s', text => {
    expect(parseDailyCommand(text)).toBeNull();
  });
  it.each(['please pause daily lessons', 'please pause my daily lessons', 'لطفاً درس‌های روزانه‌ام را موقتا متوقف کن'])('preserves the persisted definition and suppresses delivery on natural pause: %s', async text => {
    await send('/daily Europe/Tallinn teach slang');
    const original = (await h.studio.deps.requestedRoutines!.manage(binding, { type: 'list' })).routines[0];
    expect(await send(text, 2)).toBe(true); expect(lastReply()).toContain('paused');
    const paused = (await h.studio.deps.requestedRoutines!.manage(binding, { type: 'list' })).routines[0];
    expect(paused).toMatchObject({ id: original.id, status: 'paused', instruction: original.instruction, timeZone: original.timeZone, timing: original.timing, nextRunAt: null });
    await h.studio.deps.requestedRoutines!.tick(); expect(fetcher).not.toHaveBeenCalled();
    await send('درس روزانه را ادامه بده', 3);
    expect((await h.studio.deps.requestedRoutines!.manage(binding, { type: 'list' })).routines[0]).toMatchObject({ status: 'active', instruction: original.instruction });
  });
  it.each(['stop sending me daily slang', 'cancel my daily routine', 'درس روزانه را لغو کن'])('stops delivery and clears retained lesson instruction on natural cancel: %s', async text => {
    await send('/daily Europe/Tallinn teach slang');
    expect(await send(text, 2)).toBe(true); expect(lastReply()).toContain('stopped');
    const stopped = (await h.studio.deps.requestedRoutines!.manage(binding, { type: 'list' })).routines[0];
    expect(stopped).toMatchObject({ status: 'stopped', instruction: '', recentLessons: [], nextRunAt: null });
    await h.studio.deps.requestedRoutines!.tick(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('persists before confirmation and supports list, pause, resume, change, stop', async () => {
    await send('/daily Europe/Tallinn teach slang');
    expect(lastReply()).toContain('suitable daytime moment');
    const routine = (await h.studio.deps.requestedRoutines!.manage(binding, { type: 'list' })).routines[0];
    expect(routine.timing).toBe('adaptive');
    await send('/daily list', 2); expect(lastReply()).toContain(routine.id);
    await send('/daily pause', 3); expect(lastReply()).toContain('paused');
    await send(`/daily resume ${routine.id}`, 4); expect(lastReply()).toContain('daytime');
    await send(`/daily change ${routine.id} 14:30 Europe/Tallinn teach idioms`, 5); expect(lastReply()).toContain('14:30');
    await send('/daily stop', 6); expect(lastReply()).toContain('stopped');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('asks only for timezone, then binds the direct answer to the pending request', async () => {
    const classifier = vi.spyOn(h.studio.deps.chatLLM, 'complete').mockResolvedValue(JSON.stringify({ intent: 'create', instruction: 'Teach one slang phrase', localTime: null, timeZone: null }));
    await send('Please teach me slang every day');
    expect(lastReply()).toContain('Which IANA timezone');
    expect((await h.studio.deps.requestedRoutines!.manage(binding, { type: 'list' })).routines).toHaveLength(0);
    await send('Europe/Tallinn', 2);
    expect(lastReply()).toContain('suitable daytime moment');
    expect(classifier).toHaveBeenCalledTimes(1);
    expect(classifier.mock.calls[0][0].signal).toBeDefined();
  });
  it('clears pending requests on stop and never revives them after token rotation', async () => {
    vi.spyOn(h.studio.deps.chatLLM, 'complete').mockResolvedValue(JSON.stringify({ intent: 'create', instruction: 'slang', localTime: null, timeZone: null }));
    await send('Teach slang every day');
    await send('/daily stop', 2);
    expect(await send('Europe/Tallinn', 3)).toBe(false);
    await send('Teach slang every day', 4);
    expect(await handleRequestedRoutineMessage(h.studio, hired.agent.id, message('Europe/Tallinn', 5), 'rotated-endpoint')).toBe(false);
    expect((await h.studio.deps.requestedRoutines!.manage(binding, { type: 'list' })).routines).toHaveLength(0);
  });
  it('clears pending creation on natural cancellation and requires selection for multiple routines', async () => {
    vi.spyOn(h.studio.deps.chatLLM, 'complete').mockResolvedValue(JSON.stringify({ intent: 'create', instruction: 'slang', localTime: null, timeZone: null }));
    await send('Teach slang every day');
    await send('stop sending me daily slang', 2);
    expect(await send('Europe/Tallinn', 3)).toBe(false);
    await send('/daily Europe/Tallinn teach slang', 4);
    await send('/daily Europe/Tallinn teach idioms', 5);
    await send('pause my daily lessons', 6); expect(lastReply()).toContain('Include the routine ID');
    expect((await h.studio.deps.requestedRoutines!.manage(binding, { type: 'list' })).routines.every(r => r.status === 'active')).toBe(true);
  });
  it('does not classify ordinary messages or schedule forwarded or quoted input', async () => {
    const classifier = vi.spyOn(h.studio.deps.chatLLM, 'complete');
    expect(await send('Explain the word daily')).toBe(false);
    await send('Teach slang every day', 2, { forward_origin: { type: 'user' } } as Partial<TelegramMessage>);
    expect(lastReply()).toContain('directly');
    await send('/daily Europe/Tallinn teach slang', 3, { entities: [{ type: 'blockquote', offset: 0, length: 10 }] });
    expect(classifier).not.toHaveBeenCalled();
    expect((await h.studio.deps.requestedRoutines!.manage(binding, { type: 'list' })).routines).toHaveLength(0);
  });
  it('blocks groups, mismatched private recipients, endpoint mismatch and non-owner cohorts', async () => {
    expect(await send('/daily Europe/Tallinn slang', 1, { chat: { type: 'group', id: -5 } })).toBe(true);
    await send('/daily Europe/Tallinn slang', 2, { chat: { type: 'private', id: 123 } });
    await handleRequestedRoutineMessage(h.studio, hired.agent.id, message('/daily Europe/Tallinn slang', 3), 'wrong-endpoint');
    await send('/daily Europe/Tallinn slang', 4, { from: { id: ID.alice, is_bot: false, first_name: 'Alice' }, chat: { type: 'private', id: ID.alice } });
    expect(lastReply()).toContain('unavailable');
    expect((await h.studio.deps.requestedRoutines!.manage(binding, { type: 'list' })).routines).toHaveLength(0);
  });
  it('handles disabled daily intent before normal gateway chat can promise a schedule', async () => {
    enabled = false;
    const generate = vi.spyOn(h.studio.deps.chatLLM, 'complete');
    await handleAgentUpdate(h.studio, hired.agent.id, { update_id: 1, message: message('Please teach slang every day') }, h.studio.relationshipEndpointId(hired.token));
    expect(lastReply()).toContain('Nothing has been scheduled');
    expect(generate).not.toHaveBeenCalled();
  });
  it('rejects invalid classifier output and storage failures without confirming a schedule', async () => {
    vi.spyOn(h.studio.deps.chatLLM, 'complete').mockResolvedValue('{"intent":"create","instruction":"slang","timeZone":"Unknown/Invalid"}');
    await send('Teach slang every day'); expect(lastReply()).not.toContain('Scheduled daily');
    vi.spyOn(h.studio.deps.requestedRoutines!, 'manage').mockRejectedValue(new Error('disk_unavailable'));
    await send('/daily Europe/Tallinn slang', 2); expect(lastReply()).toContain('Nothing new is confirmed');
  });
});

describe('runtime generation and transport fences', () => {
  const createFixed = async () => h.studio.deps.requestedRoutines!.manage(binding, { type: 'create', inboundMessageId: 'fixed', instruction: 'Teach slang', localTime: '13:01', timeZone: 'Europe/Tallinn' });
  it('uses only persona and explicit instruction, posts once through the captured bot and records acceptance', async () => {
    await createFixed(); h.clock.now = new Date('2026-10-19T10:01:00Z');
    const generate = vi.spyOn(h.studio.deps.chatLLM, 'complete').mockImplementation(async request => {
      expect(await request.authorize!()).toBe(true); expect(request.authorizeNow!()).toBe(true);
      expect(request.system).toContain('Nova'); expect(request.messages).toEqual([{ role: 'user', content: JSON.stringify({ instruction: 'Teach slang', recentOwnLessons: [] }) }]);
      return 'Slang: break a leg means good luck.';
    });
    const result = await h.studio.deps.requestedRoutines!.tick();
    expect(result.accepted).toBe(1); expect(generate).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain(`/bot${hired.token}/sendMessage`);
    expect((await h.studio.deps.requestedRoutines!.manage(binding, { type: 'list' })).routines[0].recentLessons[0]).toContain('break a leg');
  });
  it('defers adaptive delivery during own recent private activity without asking the model', async () => {
    await send('/daily Europe/Tallinn slang');
    noteRequestedRoutineActivity(h.studio, hired.agent.id, message('hello'));
    const generate = vi.spyOn(h.studio.deps.chatLLM, 'complete');
    await h.studio.deps.requestedRoutines!.tick(); expect(generate).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('bounds timing decisions to validated send/defer results using content-free activity', async () => {
    await send('/daily Europe/Tallinn slang');
    const generate = vi.spyOn(h.studio.deps.chatLLM, 'complete').mockResolvedValueOnce('{"action":"send","retryAfterMinutes":60}').mockResolvedValueOnce('A concise slang lesson.');
    await h.studio.deps.requestedRoutines!.tick();
    expect(generate).toHaveBeenCalledTimes(2); expect(generate.mock.calls[0][0].messages[0].content).toContain('lastPrivateInteractionAt'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('suppresses send when role, kill switch or bot identity changes during generation', async () => {
    await createFixed(); h.clock.now = new Date('2026-10-19T10:01:00Z');
    vi.spyOn(h.studio.deps.chatLLM, 'complete').mockImplementation(async () => { enabled = false; return 'Lesson'; });
    await h.studio.deps.requestedRoutines!.tick(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['role', 'token', 'fired', 'blocked'] as const)('suppresses delivery when %s changes during generation', async kind => {
    await createFixed(); h.clock.now = new Date('2026-10-19T10:01:00Z');
    vi.spyOn(h.studio.deps.chatLLM, 'complete').mockImplementation(async request => {
      await h.store.update(state => {
        if (kind === 'role') state.members.find(m => m.telegramId === ID.superadmin)!.role = 'member';
        else if (kind === 'token') state.agents[0].tokenEnc = 'rotated';
        else if (kind === 'fired') state.agents[0].status = 'fired';
        else state.agents[0].blocked = [ID.superadmin];
      });
      expect(request.authorizeNow!()).toBe(false);
      return 'Lesson';
    });
    await h.studio.deps.requestedRoutines!.tick(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('serializes routine ticks every minute, honors kill switch, and closes on runner stop', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    const tick = vi.spyOn(h.studio.deps.requestedRoutines!, 'tick').mockImplementation(async () => { await blocked; return { claimed: 0, accepted: 0, failed: 0, unknown: 0 }; });
    const close = vi.spyOn(h.studio.deps.requestedRoutines!, 'close');
    const runner = startBots(h.studio);
    try {
      await vi.advanceTimersByTimeAsync(0); expect(tick).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(120_000); expect(tick).toHaveBeenCalledTimes(1);
      finish(); await vi.advanceTimersByTimeAsync(0);
      enabled = false; await vi.advanceTimersByTimeAsync(60_000); expect(tick).toHaveBeenCalledTimes(1);
      enabled = true; await vi.advanceTimersByTimeAsync(60_000); expect(tick).toHaveBeenCalledTimes(2);
      runner.stop(); expect(close).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000); expect(tick).toHaveBeenCalledTimes(2);
    } finally { finish(); runner.stop(); }
  });
  it('does not retry unknown Telegram acceptance', async () => {
    await createFixed(); h.clock.now = new Date('2026-10-19T10:01:00Z');
    vi.spyOn(h.studio.deps.chatLLM, 'complete').mockResolvedValue('Lesson'); fetcher.mockRejectedValue(new Error('socket_timeout'));
    const result = await h.studio.deps.requestedRoutines!.tick(); expect(result.unknown).toBe(1);
    await h.studio.deps.requestedRoutines!.tick(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('fails startup outside persistent file polling runtime and defaults off', () => {
    const base = { STUDIO_SECRET: SECRET, ANTHROPIC_API_KEY: 'synthetic' };
    expect(validateStudioConfig(base).requestedRoutinesEnabled).toBe(false);
    expect(() => validateStudioConfig({ ...base, STUDIO_REQUESTED_ROUTINES: '1' })).toThrow(/persistent polling/);
    expect(() => validateStudioConfig({ ...base, STUDIO_REQUESTED_ROUTINES: '1', STUDIO_BOTS: '1', STUDIO_PUBLIC_URL: 'https://synthetic.invalid' })).toThrow();
    expect(validateStudioConfig({ ...base, STUDIO_REQUESTED_ROUTINES: '1', STUDIO_BOTS: '1' }).requestedRoutinesEnabled).toBe(true);
  });
});
