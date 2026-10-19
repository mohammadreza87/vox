/**
 * Minimal Telegram Bot API client for persona bots. One instance per bot.
 * `fetch` is injectable so the whole gateway can be tested offline.
 */

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration: number; mime_type?: string; file_size?: number };
  reply_to_message?: TelegramMessage;
  entities?: Array<{ type: string; offset: number; length: number }>;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramChatMemberUpdated {
  chat: TelegramChat;
  from: TelegramUser;
  date: number;
  old_chat_member: { status: string; user: TelegramUser };
  new_chat_member: { status: string; user: TelegramUser };
}

export interface TelegramManagedBotUpdated {
  user: TelegramUser;
  bot: TelegramUser;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  my_chat_member?: TelegramChatMemberUpdated;
  managed_bot?: TelegramManagedBotUpdated;
}

export type InlineButton = { text: string; callback_data: string } | { text: string; web_app: { url: string } } | { text: string; url: string };

export interface InlineKeyboard {
  inline_keyboard: Array<Array<InlineButton>>;
}

type FetchFn = typeof fetch;

export class TelegramApiError extends Error {
  constructor(readonly method: string, readonly description: string) {
    super(`Telegram ${method} failed: ${description}`);
  }
}

export class TelegramBotClient {
  private readonly base: string;
  private readonly fileBase: string;

  constructor(token: string, private readonly fetchFn: FetchFn = fetch) {
    this.base = `https://api.telegram.org/bot${token}`;
    this.fileBase = `https://api.telegram.org/file/bot${token}`;
  }

  private async call<T>(method: string, body: Record<string, unknown> | FormData): Promise<T> {
    const isForm = body instanceof FormData;
    const response = await this.fetchFn(`${this.base}/${method}`, {
      method: 'POST',
      headers: isForm ? undefined : { 'Content-Type': 'application/json' },
      body: isForm ? body : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!json.ok) throw new TelegramApiError(method, json.description ?? `HTTP ${response.status}`);
    return json.result as T;
  }

  sendMessage(
    chatId: number,
    text: string,
    options: { replyTo?: number; keyboard?: InlineKeyboard } = {}
  ): Promise<TelegramMessage> {
    return this.call('sendMessage', {
      chat_id: chatId,
      text: text.slice(0, 4096),
      ...(options.replyTo ? { reply_parameters: { message_id: options.replyTo, allow_sending_without_reply: true } } : {}),
      ...(options.keyboard ? { reply_markup: options.keyboard } : {}),
    });
  }

  sendVoice(
    chatId: number,
    audio: ArrayBuffer,
    options: { caption?: string; replyTo?: number; mimeType?: string; filename?: string } = {}
  ): Promise<TelegramMessage> {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append(
      'voice',
      new Blob([audio], { type: options.mimeType ?? 'audio/mpeg' }),
      options.filename ?? 'voice.mp3'
    );
    if (options.caption) form.append('caption', options.caption.slice(0, 1024));
    if (options.replyTo) {
      form.append('reply_parameters', JSON.stringify({ message_id: options.replyTo, allow_sending_without_reply: true }));
    }
    return this.call('sendVoice', form);
  }

  sendChatAction(chatId: number, action: 'typing' | 'record_voice'): Promise<boolean> {
    return this.call('sendChatAction', { chat_id: chatId, action });
  }

  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    return this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
  }

  editMessageText(chatId: number, messageId: number, text: string): Promise<unknown> {
    return this.call('editMessageText', { chat_id: chatId, message_id: messageId, text });
  }

  async downloadFile(fileId: string, maxBytes = 20 * 1024 * 1024): Promise<ArrayBuffer> {
    const file = await this.call<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId });
    if (!file.file_path) throw new TelegramApiError('getFile', 'no file_path');
    if (file.file_size && file.file_size > maxBytes) throw new TelegramApiError('getFile', 'file too large');
    const response = await this.fetchFn(`${this.fileBase}/${file.file_path}`);
    if (!response.ok) throw new TelegramApiError('downloadFile', `HTTP ${response.status}`);
    return response.arrayBuffer();
  }

  getMe(): Promise<TelegramUser> {
    return this.call('getMe', {});
  }

  deleteWebhook(): Promise<boolean> {
    return this.call('deleteWebhook', { drop_pending_updates: false });
  }

  /** Long polling; `timeoutSeconds` is how long Telegram holds the request open */
  getUpdates(
    offset: number | undefined,
    timeoutSeconds = 30,
    allowedUpdates: string[] = ['message', 'callback_query']
  ): Promise<TelegramUpdate[]> {
    return this.call('getUpdates', {
      ...(offset !== undefined ? { offset } : {}),
      timeout: timeoutSeconds,
      allowed_updates: allowedUpdates,
    });
  }

  // ---- managed bots (Bot API 9.6) and bot profile -------------------------

  getManagedBotToken(botUserId: number): Promise<string> {
    return this.call('getManagedBotToken', { user_id: botUserId });
  }

  setMyName(name: string): Promise<boolean> {
    return this.call('setMyName', { name: name.slice(0, 64) });
  }

  setMyDescription(description: string): Promise<boolean> {
    return this.call('setMyDescription', { description: description.slice(0, 512) });
  }

  setMyShortDescription(shortDescription: string): Promise<boolean> {
    return this.call('setMyShortDescription', { short_description: shortDescription.slice(0, 120) });
  }

  setMyCommands(commands: Array<{ command: string; description: string }>): Promise<boolean> {
    return this.call('setMyCommands', { commands });
  }

  /** Telegram profile photos must be JPG */
  setMyProfilePhoto(jpeg: Buffer): Promise<boolean> {
    const form = new FormData();
    form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://avatar' }));
    form.append('avatar', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'avatar.jpg');
    return this.call('setMyProfilePhoto', form);
  }

  setChatMenuButton(text: string, webAppUrl: string): Promise<boolean> {
    return this.call('setChatMenuButton', { menu_button: { type: 'web_app', text, web_app: { url: webAppUrl } } });
  }

  getChatMemberCount(chatId: number): Promise<number> {
    return this.call('getChatMemberCount', { chat_id: chatId });
  }

  leaveChat(chatId: number): Promise<boolean> {
    return this.call('leaveChat', { chat_id: chatId });
  }

  setWebhook(url: string, secretToken: string, allowedUpdates: string[] = ['message', 'callback_query']): Promise<boolean> {
    return this.call('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: allowedUpdates,
      drop_pending_updates: false,
    });
  }
}
