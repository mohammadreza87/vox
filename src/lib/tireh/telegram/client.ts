import {assertExportAuthority, ExportAuthorityError} from '../voice';
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
  /** IETF tag of the user's Telegram language; picks card copy only, never authority. */
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
}

export interface TelegramPhotoSize { file_id: string; file_unique_id?: string; width: number; height: number; file_size?: number }

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  edit_date?: number;
  text?: string;
  caption?: string;
  new_chat_members?: TelegramUser[];
  left_chat_member?: TelegramUser;
  voice?: { file_id: string; duration: number; mime_type?: string; file_size?: number };
  photo?: TelegramPhotoSize[];
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  reply_to_message?: TelegramMessage;
  entities?: Array<{ type: string; offset: number; length: number; user?: TelegramUser }>;
  caption_entities?: Array<{ type: string; offset: number; length: number; user?: TelegramUser }>;
  /** A channel post Telegram copied into its linked discussion group (sent on the channel's behalf). */
  is_automatic_forward?: boolean;
  sender_chat?: TelegramChat;
}

/** getChat's answer, as far as Vox reads it: a channel's linked discussion group. */
export interface TelegramChatFullInfo extends TelegramChat {
  linked_chat_id?: number;
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
  old_chat_member: { status: string; user: TelegramUser; is_member?: boolean };
  new_chat_member: { status: string; user: TelegramUser; is_member?: boolean; can_post_messages?: boolean };
}

export interface TelegramManagedBotUpdated {
  user: TelegramUser;
  bot: TelegramUser;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  my_chat_member?: TelegramChatMemberUpdated;
  chat_member?: TelegramChatMemberUpdated;
  managed_bot?: TelegramManagedBotUpdated;
}

export type InlineButton = { text: string; callback_data: string } | { text: string; web_app: { url: string } } | { text: string; url: string };

export interface InlineKeyboard {
  inline_keyboard: Array<Array<InlineButton>>;
}

/** Where a command menu applies (Telegram BotCommandScope). */
export type BotCommandScope =
  | { type: 'default' | 'all_private_chats' | 'all_group_chats' | 'all_chat_administrators' }
  | { type: 'chat' | 'chat_administrators'; chat_id: number }
  | { type: 'chat_member'; chat_id: number; user_id: number };
/** A menu's scope and language; neither = the default menu for every language. */
export interface BotCommandsTarget { scope?: BotCommandScope; languageCode?: string }
const commandsTarget = (o: BotCommandsTarget) => ({ ...(o.scope ? { scope: o.scope } : {}), ...(o.languageCode ? { language_code: o.languageCode } : {}) });

type FetchFn = typeof fetch;

const CONNECT_RETRY_DELAYS_MS = [250, 1000];
const SNAPSHOT_DOCUMENT_FILENAME = /^vox-snapshot-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-(?:[0-9]|1[0-5]|manifest)\.json$/;

function retryDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new ExportAuthorityError());};
    const timer = setTimeout(() => {signal?.removeEventListener('abort', abort); resolve();}, milliseconds);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, {once: true});
  });
}

function isConnectTimeout(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const cause = error.cause;
  return typeof cause === 'object' && cause !== null
    && 'code' in cause && cause.code === 'UND_ERR_CONNECT_TIMEOUT';
}

export class TelegramApiError extends Error {
  /** Telegram's error_code when it sent one (its contents "are subject to change": never the only signal). */
  constructor(readonly method: string, readonly description: string, readonly errorCode?: number) {
    super(`Telegram ${method} failed: ${description}`);
  }
}

/** getWebhookInfo, trimmed to what the integrity check reads. `url` is empty while the bot uses getUpdates. */
export interface TelegramWebhookInfo { url: string; pending_update_count?: number }

export class TelegramBotClient {
  readonly committedSendFence = true as const;
  private readonly base: string;
  private readonly fileBase: string;

  constructor(token: string, private readonly fetchFn: FetchFn = fetch) {
    this.base = `https://api.telegram.org/bot${token}`;
    this.fileBase = `https://api.telegram.org/file/bot${token}`;
  }

  private async call<T>(method: string, body: Record<string, unknown> | FormData, signal?: AbortSignal, authorizeNow?: () => boolean): Promise<T> {
    const isForm = body instanceof FormData;
    const options: RequestInit = {
      method: 'POST',
      signal,
      headers: isForm ? undefined : { 'Content-Type': 'application/json' },
      body: isForm ? body : JSON.stringify(body),
    };
    let response: Response;
    for (let attempt = 0; ; attempt++) {
      try {
        assertExportAuthority({signal, authorizeNow});
        response = await this.fetchFn(`${this.base}/${method}`, options);
        break;
      } catch (error) {
        // A failed connection never sent the request. Retry only this known
        // pre-send failure: socket/read timeouts can mean Telegram already
        // accepted a message, so replaying those could send duplicate replies.
        const delay = CONNECT_RETRY_DELAYS_MS[attempt];
        if (delay === undefined || !isConnectTimeout(error)) throw error;
        await retryDelay(delay, signal);
      }
    }
    // Response/body errors must not replay a potentially accepted POST.
    const json = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: unknown };
    if (!json.ok) throw new TelegramApiError(method, json.description ?? `HTTP ${response.status}`,
      Number.isSafeInteger(json.error_code) ? json.error_code as number : Number.isSafeInteger(response.status) && response.status >= 400 ? response.status : undefined);
    return json.result as T;
  }

  sendMessage(
    chatId: number,
    text: string,
    options: {
      replyTo?: number; keyboard?: InlineKeyboard; signal?: AbortSignal; authorizeNow?: () => boolean; silent?: boolean; forceReply?: { placeholder?: string };
      /** No link preview card, so a link in the text never makes Telegram fetch it. */
      noPreview?: boolean;
      /** Telegram blocks forwarding and saving of the message. */
      protectContent?: boolean;
    } = {}
  ): Promise<TelegramMessage> {
    return this.call('sendMessage', {
      chat_id: chatId,
      text: text.slice(0, 4096),
      ...(options.replyTo ? { reply_parameters: { message_id: options.replyTo, allow_sending_without_reply: true } } : {}),
      ...(options.keyboard ? { reply_markup: options.keyboard }
        : options.forceReply ? { reply_markup: { force_reply: true, ...(options.forceReply.placeholder ? { input_field_placeholder: options.forceReply.placeholder.slice(0, 64) } : {}) } } : {}),
      ...(options.silent ? { disable_notification: true } : {}),
      ...(options.noPreview ? { link_preview_options: { is_disabled: true } } : {}),
      ...(options.protectContent ? { protect_content: true } : {}),
    }, options.signal, options.authorizeNow);
  }

  /** Telegram lets a bot delete its own messages in a private chat only within 48 hours of sending; later it refuses. */
  deleteMessage(chatId: number, messageId: number): Promise<boolean> {
    return this.call('deleteMessage', { chat_id: chatId, message_id: messageId });
  }

  sendVoice(
    chatId: number,
    audio: ArrayBuffer,
    options: { caption?: string; replyTo?: number; mimeType?: string; filename?: string; signal?: AbortSignal; authorizeNow?: () => boolean; keyboard?: InlineKeyboard; silent?: boolean } = {}
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
    if (options.keyboard) form.append('reply_markup', JSON.stringify(options.keyboard));
    if (options.silent) form.append('disable_notification', 'true');
    return this.call('sendVoice', form, options.signal, options.authorizeNow);
  }

  sendChatAction(chatId: number, action: 'typing' | 'record_voice'): Promise<boolean> {
    return this.call('sendChatAction', { chat_id: chatId, action });
  }

  /** Immutable memory artifacts. Authority is checked again at the actual POST;
   * uncertain response failures are never automatically replayed. */
  sendDocument(chatId: number, bytes: Uint8Array, options: { filename: string; authorizeNow: () => boolean; signal?: AbortSignal }): Promise<TelegramMessage> {
    // Snapshot operations use generated UUIDv4 IDs and at most sixteen chunks.
    // Compare the full match so a trailing newline cannot pass the `$` anchor.
    const snapshotMatch = SNAPSHOT_DOCUMENT_FILENAME.exec(options.filename);
    const snapshotFilename = snapshotMatch !== null && snapshotMatch[0] === options.filename;
    if (bytes.byteLength > 128 * 1024 || !(/^vox-(events|manifest)-[A-Za-z0-9-]+\.json$/.test(options.filename) || snapshotFilename)) throw new Error('Invalid archive document');
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('document', new Blob([new Uint8Array(bytes)], { type: 'application/json' }), options.filename);
    form.append('disable_notification', 'true');
    return this.call('sendDocument', form, options.signal, options.authorizeNow);
  }

  /** Bounded streaming download: metadata and response headers are hints; the
   * byte counter is authoritative before allocating the final artifact. */
  async downloadDocument(fileId: string, options: { maxBytes: number; authorizeNow: () => boolean; signal?: AbortSignal }): Promise<Uint8Array> {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > 128 * 1024) throw new Error('Invalid archive download limit');
    const file = await this.call<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId }, options.signal, options.authorizeNow);
    assertExportAuthority(options);
    if (!file.file_path || (file.file_size !== undefined && (!Number.isSafeInteger(file.file_size) || file.file_size < 0 || file.file_size > options.maxBytes))) throw new Error('Archive file unavailable');
    const response = await this.fetchFn(`${this.fileBase}/${file.file_path}`, { signal: options.signal });
    assertExportAuthority(options);
    if (!response.ok || !response.body) throw new Error('Archive file unavailable');
    const declared = response.headers.get('content-length');
    if (declared !== null && (!Number.isSafeInteger(Number(declared)) || Number(declared) > options.maxBytes || Number(declared) < 0)) {
      await response.body.cancel(); throw new Error('Archive file too large');
    }
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        assertExportAuthority(options);
        const next = await reader.read();
        assertExportAuthority(options);
        if (next.done) break;
        size += next.value.byteLength;
        if (size > options.maxBytes) throw new Error('Archive file too large');
        chunks.push(next.value);
      }
    } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }

  /** showAlert: a modal only the tapper sees (Circles receipts), instead of a passing toast. */
  answerCallbackQuery(callbackQueryId: string, text?: string, showAlert?: boolean): Promise<boolean> {
    return this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}), ...(showAlert ? { show_alert: true } : {}) });
  }

  /** Edits never notify. A keyboard replaces the message's buttons; without one Telegram removes them. */
  editMessageText(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard): Promise<unknown> {
    return this.call('editMessageText', { chat_id: chatId, message_id: messageId, text, ...(keyboard ? { reply_markup: keyboard } : {}) });
  }

  async downloadFile(fileId: string, maxBytes = 20 * 1024 * 1024): Promise<ArrayBuffer> {
    const file = await this.call<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId });
    if (!file.file_path) throw new TelegramApiError('getFile', 'no file_path');
    if (file.file_size && file.file_size > maxBytes) throw new TelegramApiError('getFile', 'file too large');
    const response = await this.fetchFn(`${this.fileBase}/${file.file_path}`);
    if (!response.ok) throw new TelegramApiError('downloadFile', `HTTP ${response.status}`);
    return response.arrayBuffer();
  }

  /**
   * Bounded image download for one turn (S12). Errors are fixed strings: they
   * never carry the URL, the bot token, the file path or any bytes.
   */
  async downloadImage(fileId: string, options: { maxBytes: number; signal?: AbortSignal }): Promise<Uint8Array> {
    const file = await this.call<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId }, options.signal);
    if (!file.file_path) throw new TelegramApiError('getFile', 'no file_path');
    if (typeof file.file_size === 'number' && file.file_size > options.maxBytes) throw new TelegramApiError('getFile', 'file too large');
    const response = await this.fetchFn(`${this.fileBase}/${file.file_path}`, { signal: options.signal });
    if (!response.ok) throw new TelegramApiError('downloadFile', `HTTP ${response.status}`);
    const declared = Number(response.headers?.get('content-length'));
    if (Number.isFinite(declared) && declared > options.maxBytes) throw new TelegramApiError('downloadFile', 'file too large');
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > options.maxBytes) throw new TelegramApiError('downloadFile', 'file too large');
    return new Uint8Array(buffer);
  }

  getMe(): Promise<TelegramUser> {
    return this.call('getMe', {});
  }

  deleteWebhook(): Promise<boolean> {
    return this.call('deleteWebhook', { drop_pending_updates: false });
  }

  /** Read-only: whether a webhook is set (and where). Used to detect a token holder redirecting this bot's updates. */
  getWebhookInfo(): Promise<TelegramWebhookInfo> {
    return this.call('getWebhookInfo', {});
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

  /** Without a target the body is exactly `{commands}` (the default menu), as before scopes existed. */
  setMyCommands(commands: Array<{ command: string; description: string }>, target: BotCommandsTarget = {}): Promise<boolean> {
    return this.call('setMyCommands', { commands, ...commandsTarget(target) });
  }

  /** Removes the menu for one scope and language; Telegram then falls back to the broader one. */
  deleteMyCommands(target: BotCommandsTarget = {}): Promise<boolean> {
    return this.call('deleteMyCommands', commandsTarget(target));
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

  /** Back to Telegram's default menu (the command list), e.g. when an agent retires. */
  resetChatMenuButton(): Promise<boolean> {
    return this.call('setChatMenuButton', { menu_button: { type: 'default' } });
  }

  /** can_post_messages: an administrator's right to post, in channels only. */
  getChatMember(chatId: number, userId: number): Promise<{ status: string; user: TelegramUser; is_member?: boolean; can_post_messages?: boolean }> {
    return this.call('getChatMember', { chat_id: chatId, user_id: userId });
  }

  getChat(chatId: number): Promise<TelegramChatFullInfo> {
    return this.call('getChat', { chat_id: chatId });
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
