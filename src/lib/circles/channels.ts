/**
 * Circles S5, channels (GROUP_AGENTS_SPEC F9, §9 S5, §13): post-only. Wire formats, EN/FA copy and the
 * post-draft store. A channel is never an audience: subscribers are anonymous, nothing is read from the
 * channel (no channel_post subscription) and nothing from it is stored. A post is drafted from the persona
 * alone (no memory, org context or notes), previewed to the host who asked for it, and sent only on Post.
 *  - Callbacks (≤64 bytes): `pp:<draft>.<n>` post to the draft's nth channel · `pe` edit · `px` cancel ·
 *    `ps` notify on/off. The draft id is 12 random characters; the store is keyed by agent and tapper, so a
 *    tap only ever finds the tapper's own drafts.
 *  - Drafts are content-free: the channels offered, the notify choice, sha256 of the previewed text, the DM
 *    message ids and an expiry. The text itself lives only in the host's preview message (DM) or the Studio
 *    sheet. A document whose drafts are all gone is blanked; forget me / rights erasure blank it for every agent.
 *  - The [Meet <agent> 🐾] button opens `t.me/<bot>?start=c_<channelCode>`; the code is an HMAC of the chat
 *    id under the Studio secret (opaque, never the raw id), and S1 routes c_ to the agent DM card.
 */

import { createHash, createHmac, randomBytes } from 'crypto';
import { z } from 'zod';
import { committedLoader, CommittedReadBusy, type AdaptiveStorage } from '../adaptive/persistence/storage';
import { startPayload } from './codec';
import type { CircleLocale } from './notice';

export const CHANNEL_DRAFT_COLLECTION = 'adaptiveChannelDrafts';
/** A preview answers Post for 30 minutes. */
export const DRAFT_TTL_MS = 30 * 60_000;
/** Open drafts per (agent, host); the oldest goes first. */
export const MAX_DRAFTS = 3;
/** Channels one agent may be in (one Post button each on a preview); a further add is refused. */
export const MAX_DRAFT_CHANNELS = 5;
/** Post text cap: Telegram allows 4096; the rest is headroom. */
export const MAX_POST_CHARS = 3500;
/** `admin=` is required for channel links: post (and edit) messages, nothing else. */
export const CHANNEL_RIGHTS = 'post_messages+edit_messages';

export const channelLink = (botUsername: string) => `https://t.me/${botUsername}?startchannel&admin=${CHANNEL_RIGHTS}`;
export const channelCode = (secret: string, chatId: number) => createHmac('sha256', secret).update(`channel-code:${chatId}`).digest('base64url').slice(0, 16);
export const meetUrl = (botUsername: string, code: string) => `https://t.me/${botUsername}?start=${startPayload('channel', code)}`;
export const textHash = (text: string) => createHash('sha256').update(text).digest('hex');
export const newDraftId = () => randomBytes(9).toString('base64url');
/** What a preview shows and Post sends: trimmed, capped, never empty. */
export const postText = (text: string) => text.trim().slice(0, MAX_POST_CHARS).trim();
/** Button labels cut by code point: a UTF-16 cut can split an emoji, and Telegram refuses the keyboard. */
export const clip = (text: string, max: number) => Array.from(text).slice(0, max).join('');

export type PostAction = 'pp' | 'pe' | 'px' | 'ps';
const DRAFT_ID = /^[A-Za-z0-9_-]{12}$/;
const POST_CALLBACK = /^(p[pexs]):([A-Za-z0-9_-]{12})(?:\.([0-4]))?$/;

export function postCallback(action: PostAction, id: string, index?: number): string {
  if (!DRAFT_ID.test(id) || (action === 'pp') !== (index !== undefined) || (index !== undefined && !(Number.isInteger(index) && index >= 0 && index < MAX_DRAFT_CHANNELS))) throw new Error('invalid_post_callback');
  return `${action}:${id}${index === undefined ? '' : `.${index}`}`;
}

export function parsePostCallback(data?: string): { action: PostAction; id: string; index?: number } | null {
  const match = data && Buffer.byteLength(data) <= 64 ? POST_CALLBACK.exec(data) : null;
  if (!match || (match[1] === 'pp') !== (match[3] !== undefined)) return null;
  return { action: match[1] as PostAction, id: match[2], ...(match[3] !== undefined ? { index: Number(match[3]) } : {}) };
}

/** `/post <text or brief>` (optionally `/post@bot`); null when the message is not /post. */
export function parsePostCommand(text?: string): { brief: string } | null {
  const match = /^\/post(?:@\S+)?(?:\s+([\s\S]*))?$/i.exec((text ?? '').trim());
  return match ? { brief: (match[1] ?? '').trim() } : null;
}

/* ---------- copy (EN/FA, meaning parity) ---------- */

const COPY = {
  en: {
    post: 'Post', postTo: (t: string) => `Post to ${t}`, edit: 'Edit', cancel: 'Cancel',
    notifyOn: '🔔 Notify subscribers', notifyOff: '🔕 Post silently',
    meet: (n: string) => `Meet ${n} 🐾`,
    noChannels: (n: string) => `${n} isn't in any channel yet. Open ${n} in Studio, then Groups → Add to a channel.`,
    notPublic: (n: string) => `${n} posts to channels only while public.`,
    needBrief: 'Send /post followed by the text, or what the post should be about.',
    unavailable: "I can't write posts right now. Try again in a minute.",
    expired: 'This preview has expired. Send /post for a fresh one.',
    posted: (t: string) => `Posted to ${t} ✓`,
    failed: "Telegram didn't take the post. Check I'm still an admin who can post there, then tap Post again.",
    unsure: "Telegram didn't confirm the post. Check the channel before you send /post again.",
    gone: (n: string) => `${n} isn't in that channel any more.`,
    noAccess: "You can't post with this agent any more.",
    needsRights: (n: string, t: string) => `Allow ${n} to post in ${t}: in the channel's admin settings, turn on Post messages for ${n}.`,
    full: (n: string) => `${n} is already in ${MAX_DRAFT_CHANNELS} channels, the most it can post to, so it left this one. Remove it from another channel first.`,
    cancelled: 'Cancelled. Nothing was posted.',
    editPrompt: 'Send the new text for this post, word for word.',
    editPlaceholder: 'New post text',
    replaced: 'Replaced by your edit below.',
  },
  fa: {
    post: 'ارسال', postTo: (t: string) => `ارسال به ${t}`, edit: 'ویرایش', cancel: 'لغو',
    notifyOn: '🔔 با اعلان برای مشترکان', notifyOff: '🔕 ارسال بی‌صدا',
    meet: (n: string) => `آشنایی با ${n} 🐾`,
    noChannels: (n: string) => `${n} هنوز در هیچ کانالی نیست. ${n} را در استودیو باز کنید، بعد گروه‌ها ← افزودن به کانال.`,
    notPublic: (n: string) => `${n} فقط وقتی عمومی است در کانال‌ها پست می‌گذارد.`,
    needBrief: '/post را همراه با متن پست، یا موضوعی که پست درباره‌اش باشد، بفرستید.',
    unavailable: 'الان نمی‌توانم پست بنویسم. یک دقیقه دیگر دوباره امتحان کنید.',
    expired: 'این پیش‌نمایش منقضی شده است. برای پیش‌نمایش تازه /post را بفرستید.',
    posted: (t: string) => `در ${t} ارسال شد ✓`,
    failed: 'تلگرام پست را نپذیرفت. بررسی کنید هنوز مدیری هستم که می‌تواند آنجا پست بگذارد، بعد دوباره «ارسال» را بزنید.',
    unsure: 'تلگرام ارسال پست را تأیید نکرد. پیش از فرستادن دوبارهٔ /post کانال را بررسی کنید.',
    gone: (n: string) => `${n} دیگر در آن کانال نیست.`,
    noAccess: 'دیگر نمی‌توانید با این عامل پست بگذارید.',
    needsRights: (n: string, t: string) => `به ${n} اجازه دهید در ${t} پست بگذارد: در تنظیمات مدیران کانال، «ارسال پست» را برای ${n} روشن کنید.`,
    full: (n: string) => `${n} همین حالا در ${MAX_DRAFT_CHANNELS} کانال است، بیشترین تعدادی که می‌تواند در آن پست بگذارد، پس از این کانال خارج شد. اول آن را از کانال دیگری بردارید.`,
    cancelled: 'لغو شد. چیزی ارسال نشد.',
    editPrompt: 'متن تازه این پست را کلمه‌به‌کلمه بفرستید.',
    editPlaceholder: 'متن تازه پست',
    replaced: 'با ویرایش شما در پایین جایگزین شد.',
  },
} as const;

export const channelCopy = (locale: CircleLocale) => COPY[locale];

/* ---------- drafts ---------- */

export interface ChannelDraft {
  id: string;
  chatIds: number[];
  silent: boolean;
  textHash: string;
  createdAt: string;
  expiresAt: string;
  via: 'dm' | 'studio';
  /** DM: the preview message (its buttons go when it is posted, cancelled or replaced) and the edit prompt. */
  previewMessageId?: number;
  promptMessageId?: number;
}
interface DraftDocument { v: 1; drafts: ChannelDraft[] }

const iso = z.string().max(40).refine((v) => Number.isFinite(Date.parse(v)));
const messageId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const draftSchema = z.object({
  id: z.string().regex(DRAFT_ID), chatIds: z.array(z.number().int().refine((v) => v !== 0 && Number.isSafeInteger(v))).min(1).max(MAX_DRAFT_CHANNELS),
  silent: z.boolean(), textHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: iso, expiresAt: iso, via: z.enum(['dm', 'studio']),
  previewMessageId: messageId.optional(), promptMessageId: messageId.optional(),
}).strict();
const documentSchema = z.object({ v: z.literal(1), drafts: z.array(draftSchema).max(MAX_DRAFTS) }).strict();

/** Keyed by agent and Telegram user (hashed again by the storage): a draft is only ever its host's. */
export const draftKey = (agentId: string, telegramId: number) => `channel-drafts:v1:${createHash('sha256').update(`${agentId}:${telegramId}`).digest('hex')}`;

const UNCHANGED = Symbol('channels.unchanged');
type Unchanged = { [UNCHANGED]: true; result: unknown };
const isUnchanged = (value: unknown): value is Unchanged => !!value && typeof value === 'object' && UNCHANGED in value;

/**
 * One small document per (agent, host) on AdaptiveStorage (file `<dataDir>/circles/channel-drafts`, Firestore
 * `adaptiveChannelDrafts`). Every write drops expired drafts and blanks (null) a document left with none; a
 * read that finds expired drafts commits that; a write that changes nothing commits nothing.
 */
export class ChannelDrafts {
  constructor(readonly storage: AdaptiveStorage) {}

  /** The host's live drafts for this agent; expired ones found here are dropped for good. */
  async list(agentId: string, telegramId: number, now: Date): Promise<ChannelDraft[]> {
    const doc = await this.load(draftKey(agentId, telegramId)), alive = live(doc, now);
    if (doc && alive.length < doc.drafts.length) await this.update(agentId, telegramId, now, (drafts) => ({ drafts, result: undefined }));
    return alive;
  }

  /** Read-modify-write of the live drafts; `fn` may rerun. */
  update<T>(agentId: string, telegramId: number, now: Date, fn: (drafts: ChannelDraft[]) => { drafts: ChannelDraft[]; result: T }): Promise<T> {
    return this.transact(draftKey(agentId, telegramId), (raw) => {
      const before = raw === null ? null : documentSchema.parse(raw) as DraftDocument;
      const { drafts, result } = fn(live(before, now).map((d) => structuredClone(d)));
      const next: DraftDocument | null = drafts.length ? { v: 1, drafts: drafts.slice(-MAX_DRAFTS) } : null;
      if (JSON.stringify(next) === JSON.stringify(before)) throw { [UNCHANGED]: true, result } satisfies Unchanged;
      return { document: next && documentSchema.parse(JSON.parse(JSON.stringify(next))), result };
    });
  }

  /**
   * Takes a live draft out (Post or Cancel): only one tap ever gets it. `hash`: only while its text is still
   * the one the tap checked (an Edit committing meanwhile wins, and this tap gets nothing).
   */
  take(agentId: string, telegramId: number, id: string, now: Date, hash?: string): Promise<ChannelDraft | null> {
    return this.update(agentId, telegramId, now, (drafts) => {
      const found = drafts.find((d) => d.id === id && (hash === undefined || d.textHash === hash)) ?? null;
      return { drafts: found ? drafts.filter((d) => d !== found) : drafts, result: found };
    });
  }

  /** Puts a taken draft back (Telegram refused the post, so nothing went out): Post works again until it expires. */
  restore(agentId: string, telegramId: number, draft: ChannelDraft, now: Date): Promise<boolean> {
    return this.update(agentId, telegramId, now, (drafts) => Date.parse(draft.expiresAt) <= now.getTime() || drafts.some((d) => d.id === draft.id)
      ? { drafts, result: false } : { drafts: [...drafts, draft], result: true });
  }

  /** Forget me / rights erasure: this person's drafts for every agent are blanked; returns how many documents held any. */
  async eraseUser(telegramId: number, agentIds: readonly string[]): Promise<number> {
    let erased = 0;
    for (const agentId of new Set(agentIds)) {
      // A committed read first: no write (and no lock) where this person never drafted.
      if (await this.load(draftKey(agentId, telegramId)) === null) continue;
      if (await this.transact(draftKey(agentId, telegramId), (raw) => {
        if (raw === null) throw { [UNCHANGED]: true, result: false } satisfies Unchanged;
        return { document: null, result: true };
      })) erased++;
    }
    return erased;
  }

  private async transact<T>(key: string, mutate: (raw: unknown | null) => { document: unknown; result: T }): Promise<T> {
    try { return await this.storage.transact(key, mutate); }
    catch (error) { if (isUnchanged(error)) return error.result as T; throw error; }
  }

  private async load(key: string): Promise<DraftDocument | null> {
    const load = committedLoader(this.storage);
    let raw: unknown | null | undefined;
    if (load) {
      try { raw = (await load(key)).value; }
      catch (error) { if (!(error instanceof CommittedReadBusy)) throw error; }
    }
    if (raw === undefined) raw = await this.transact(key, (current) => { throw { [UNCHANGED]: true, result: current } satisfies Unchanged; });
    return raw === null ? null : documentSchema.parse(raw) as DraftDocument;
  }
}

function live(doc: DraftDocument | null, now: Date): ChannelDraft[] {
  return (doc?.drafts ?? []).filter((d) => Date.parse(d.expiresAt) > now.getTime());
}
