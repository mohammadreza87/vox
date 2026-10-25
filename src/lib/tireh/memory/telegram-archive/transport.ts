import type { TelegramBotClient } from '../../telegram/client';
import { ArchiveUnavailableError, type ArchiveTransport } from './contracts';

/** A transport instance belongs to exactly one persona bot. Download bytes are
 * never persisted or logged here; the service validates the trusted digest. */
export class TelegramArchiveTransport implements ArchiveTransport {
  constructor(private readonly bot: TelegramBotClient, private readonly authorizeNow: () => boolean) {}
  async upload(chatId: number, filename: string, bytes: Uint8Array, authorizeNow: () => boolean) {
    const message = await this.bot.sendDocument(chatId, bytes, { filename,
      authorizeNow: () => this.authorizeNow() && authorizeNow() });
    if (message.chat.id !== chatId || message.chat.type !== 'private' || !message.document?.file_id || !Number.isSafeInteger(message.message_id) || message.message_id < 1) throw new ArchiveUnavailableError('integrity');
    return { fileId: message.document.file_id, messageId: message.message_id };
  }
  download(fileId: string, maxBytes: number) {
    return this.bot.downloadDocument(fileId, { maxBytes, authorizeNow: this.authorizeNow });
  }
}
