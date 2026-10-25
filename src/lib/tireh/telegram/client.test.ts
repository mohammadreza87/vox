import { describe, expect, it, vi } from 'vitest';
import { TelegramApiError, TelegramBotClient } from './client';

function fakeFetch(result: unknown = true) {
  return vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ ok: true, result })));
}

/** The test DOM's Blob predates Blob.arrayBuffer(). */
function bytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('setMyProfilePhoto wire shape (Bot API 9.4, InputProfilePhotoStatic)', () => {
  it('posts multipart with a static photo attached as a JPEG file and no JSON content type', async () => {
    const fetch = fakeFetch();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(await new TelegramBotClient('123:abc', fetch).setMyProfilePhoto(jpeg)).toBe(true);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://api.telegram.org/bot123:abc/setMyProfilePhoto');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toBeUndefined();
    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('photo')).toBe('{"type":"static","photo":"attach://avatar"}');
    const file = form.get('avatar') as Blob & { name?: string };
    expect(file).toBeInstanceOf(Blob);
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toBe('avatar.jpg');
    expect(Buffer.from(await bytes(file)).equals(jpeg)).toBe(true);
  });

  it('surfaces a refusal as a TelegramApiError', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, description: 'Bad Request: PHOTO_INVALID' })));
    await expect(new TelegramBotClient('123:abc', fetch).setMyProfilePhoto(Buffer.from('x'))).rejects.toBeInstanceOf(TelegramApiError);
  });
});

describe('Circles wire options (silent sends, keyboard edits, alerts)', () => {
  const body = (fetch: ReturnType<typeof fakeFetch>, call = 0) => JSON.parse(String(fetch.mock.calls[call][1]?.body)) as Record<string, unknown>;

  it('adds disable_notification, reply_markup and show_alert only when asked, so existing calls are unchanged', async () => {
    const fetch = fakeFetch({ message_id: 1, chat: { id: 5, type: 'private' }, date: 0 });
    const bot = new TelegramBotClient('123:abc', fetch);
    const keyboard = { inline_keyboard: [[{ text: 'Open', web_app: { url: 'https://x.example/p' } }]] };
    await bot.sendMessage(5, 'hi');
    await bot.sendMessage(5, 'quiet', { silent: true });
    await bot.editMessageText(5, 9, 'edited');
    await bot.editMessageText(5, 9, 'edited', keyboard);
    await bot.answerCallbackQuery('q1', 'toast');
    await bot.answerCallbackQuery('q2', 'alert', true);
    expect([0, 1, 2, 3, 4, 5].map((i) => body(fetch, i))).toEqual([
      { chat_id: 5, text: 'hi' },
      { chat_id: 5, text: 'quiet', disable_notification: true },
      { chat_id: 5, message_id: 9, text: 'edited' },
      { chat_id: 5, message_id: 9, text: 'edited', reply_markup: keyboard },
      { callback_query_id: 'q1', text: 'toast' },
      { callback_query_id: 'q2', text: 'alert', show_alert: true },
    ]);
  });

  it('Circles S5: a force-reply prompt (placeholder capped at 64) and getChat for a channel\'s linked comments group', async () => {
    const fetch = fakeFetch({ id: -100, type: 'channel', title: 'News', linked_chat_id: -101 });
    const bot = new TelegramBotClient('123:abc', fetch);
    await bot.sendMessage(5, 'Send the new text', { replyTo: 9, forceReply: { placeholder: 'p'.repeat(80) } });
    await bot.sendMessage(5, 'keyboard wins', { keyboard: { inline_keyboard: [] }, forceReply: {} });
    expect(await bot.getChat(-100)).toMatchObject({ linked_chat_id: -101 });
    expect(body(fetch, 0)).toEqual({ chat_id: 5, text: 'Send the new text', reply_parameters: { message_id: 9, allow_sending_without_reply: true },
      reply_markup: { force_reply: true, input_field_placeholder: 'p'.repeat(64) } });
    expect(body(fetch, 1)).toEqual({ chat_id: 5, text: 'keyboard wins', reply_markup: { inline_keyboard: [] } });
    expect(String(fetch.mock.calls[2][0])).toBe('https://api.telegram.org/bot123:abc/getChat');
    expect(body(fetch, 2)).toEqual({ chat_id: -100 });
  });
});

describe('command menus with a scope and language (Settings v2)', () => {
  const body = (fetch: ReturnType<typeof fakeFetch>, i = 0) => JSON.parse(String(fetch.mock.calls[i][1]?.body));
  const commands = [{ command: 'settings', description: 'All my settings' }];
  it('without a target the body is exactly {commands}, as before scopes existed', async () => {
    const fetch = fakeFetch();
    await new TelegramBotClient('1:a', fetch).setMyCommands(commands);
    expect(String(fetch.mock.calls[0][0])).toBe('https://api.telegram.org/bot1:a/setMyCommands');
    expect(body(fetch)).toEqual({ commands });
  });
  it('sends scope and language_code when given', async () => {
    const fetch = fakeFetch();
    await new TelegramBotClient('1:a', fetch).setMyCommands(commands, { scope: { type: 'all_private_chats' }, languageCode: 'fa' });
    expect(body(fetch)).toEqual({ commands, scope: { type: 'all_private_chats' }, language_code: 'fa' });
  });
  it('deleteMyCommands removes one scope and language', async () => {
    const fetch = fakeFetch();
    const client = new TelegramBotClient('1:a', fetch);
    await client.deleteMyCommands({ scope: { type: 'all_group_chats' }, languageCode: 'fa' });
    await client.deleteMyCommands();
    expect(String(fetch.mock.calls[0][0])).toBe('https://api.telegram.org/bot1:a/deleteMyCommands');
    expect(body(fetch, 0)).toEqual({ scope: { type: 'all_group_chats' }, language_code: 'fa' });
    expect(body(fetch, 1)).toEqual({});
  });
  it('sendVoice carries an inline keyboard and a silent flag when asked, and neither otherwise', async () => {
    const fetch = fakeFetch({ message_id: 1, chat: { id: 5, type: 'private' }, date: 0 });
    const client = new TelegramBotClient('1:a', fetch);
    const keyboard = { inline_keyboard: [[{ text: 'Change voice in Vox', url: 'https://t.me/VoxxBot?start=s_AbCd-_12_v' }]] };
    await client.sendVoice(5, new ArrayBuffer(4), { caption: 'I sound “Warm”.', keyboard, silent: true });
    await client.sendVoice(5, new ArrayBuffer(4));
    const [withKeyboard, plain] = fetch.mock.calls.map((c) => c[1]?.body as FormData);
    expect(withKeyboard.get('reply_markup')).toBe(JSON.stringify(keyboard));
    expect(withKeyboard.get('disable_notification')).toBe('true');
    expect(plain.get('reply_markup')).toBeNull();
    expect(plain.get('disable_notification')).toBeNull();
  });
});
