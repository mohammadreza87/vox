/**
 * Production wiring for Vox Studio, from environment variables.
 *
 * Required:
 *   STUDIO_SECRET            ≥32 chars; encrypts agent bot tokens at rest
 *   VOXX_BOT_TOKEN           the manager bot (@VoxxBot), with bot management
 *                            enabled in @BotFather's Mini App
 *   STUDIO_SUPERADMIN_IDS    comma-separated Telegram user ids (bootstrap)
 *   ANTHROPIC_API_KEY        Claude: persona design and every reply
 * Optional:
 *   OPENAI_API_KEY           avatars (gpt-image) and speech-to-text
 *   ELEVENLABS_API_KEY       voice design, voice library, speech
 *   STUDIO_WEBAPP_URL        public https URL of /studio (menu button)
 *   STUDIO_DATA_DIR          default ./.vox-studio (file storage)
 *
 * Serverless production (Firebase):
 *   STUDIO_STORAGE=firestore  state in Firestore, media in Cloud Storage,
 *                            memories in the TIREH Firestore collections
 *   STUDIO_MEDIA_BUCKET      default NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
 *   STUDIO_PUBLIC_URL        https base URL; switches bots to webhooks
 *                            (/api/studio/telegram/[key]) instead of polling
 *   STUDIO_CHAT_MODEL        model for replies (default: fast Claude model)
 *   STUDIO_PERSONA_MODEL     model for persona design (default: stronger Claude model)
 *   STUDIO_ORG_NAME          default HOOR
 */

import { join } from 'path';
import { AnthropicLLM } from '../tireh/llm';
import { createFileStores } from '../tireh/memory/file-store';
import { FirestoreChatHistoryStore, FirestoreMemoryStore, FirestoreShareOfferStore, FirestoreUpdateDeduper } from '../tireh/memory/firestore-store';
import { TelegramBotClient } from '../tireh/telegram/client';
import { ElevenLabsStudio, OpenAIMedia } from './media';
import { FirestoreStudioStore } from './firestore-store';
import { Studio, type StudioDeps } from './service';
import { StudioStore, type StudioStorage } from './store';

export function parseIds(raw: string | undefined): number[] {
  return (raw ?? '')
    .split(/[,\s]+/)
    .map((x) => Number.parseInt(x, 10))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

async function toJpeg(data: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp(data, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(640, 640, { fit: 'cover' })
    .jpeg({ quality: 88 })
    .toBuffer();
}

const g = globalThis as unknown as { __voxStudio?: Promise<Studio> };

function fileStorage(dir: string): { store: StudioStorage; memory: StudioDeps['memory'] } {
  return { store: new StudioStore(dir), memory: createFileStores(join(dir, 'memory.json')) };
}

async function firestoreStorage(): Promise<{ store: StudioStorage; memory: StudioDeps['memory'] }> {
  const { getAdminApp, getAdminDb } = await import('@/lib/firebase-admin');
  const { getStorage } = await import('firebase-admin/storage');
  const db = await getAdminDb();
  const bucketName = process.env.STUDIO_MEDIA_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) throw new Error('STUDIO_MEDIA_BUCKET is required with STUDIO_STORAGE=firestore');
  const bucket = getStorage(await getAdminApp()).bucket(bucketName);
  return {
    store: new FirestoreStudioStore(db, bucket),
    memory: {
      memories: new FirestoreMemoryStore(db),
      offers: new FirestoreShareOfferStore(db),
      history: new FirestoreChatHistoryStore(db),
      deduper: new FirestoreUpdateDeduper(db),
    },
  };
}

async function create(): Promise<Studio> {
  const env = process.env;
  if (!env.STUDIO_SECRET || env.STUDIO_SECRET.length < 32) throw new Error('STUDIO_SECRET (≥32 chars) is required');
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required');
  const storage = env.STUDIO_STORAGE === 'firestore' ? await firestoreStorage() : fileStorage(env.STUDIO_DATA_DIR ?? join(process.cwd(), '.vox-studio'));
  const managerBot = env.VOXX_BOT_TOKEN ? new TelegramBotClient(env.VOXX_BOT_TOKEN) : null;
  let managerUsername = env.VOXX_BOT_USERNAME ?? '';
  if (managerBot && !managerUsername) {
    managerUsername = (await managerBot.getMe().catch(() => null))?.username ?? '';
  }
  return new Studio({
    store: storage.store,
    personaLLM: new AnthropicLLM(env.ANTHROPIC_API_KEY, env.STUDIO_PERSONA_MODEL ?? 'claude-sonnet-5-5'),
    chatLLM: new AnthropicLLM(env.ANTHROPIC_API_KEY, env.STUDIO_CHAT_MODEL ?? 'claude-haiku-5-5'),
    openai: env.OPENAI_API_KEY ? new OpenAIMedia(env.OPENAI_API_KEY) : null,
    eleven: env.ELEVENLABS_API_KEY ? new ElevenLabsStudio(env.ELEVENLABS_API_KEY) : null,
    managerBot,
    managerUsername,
    botFor: (token) => new TelegramBotClient(token),
    secret: env.STUDIO_SECRET,
    orgName: env.STUDIO_ORG_NAME ?? 'HOOR',
    superadminIds: parseIds(env.STUDIO_SUPERADMIN_IDS),
    webAppUrl: env.STUDIO_WEBAPP_URL,
    webhookBase: env.STUDIO_PUBLIC_URL || undefined,
    memory: storage.memory,
    imageToJpeg: toJpeg,
  });
}

export function getStudio(): Promise<Studio> {
  if (!g.__voxStudio) {
    g.__voxStudio = create().catch((e) => {
      g.__voxStudio = undefined;
      throw e;
    });
  }
  return g.__voxStudio;
}
