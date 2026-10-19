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
 *   STUDIO_DATA_DIR          default ./.vox-studio
 *   STUDIO_CHAT_MODEL        model for replies (default: fast Claude model)
 *   STUDIO_PERSONA_MODEL     model for persona design (default: stronger Claude model)
 *   STUDIO_ORG_NAME          default HOOR
 */

import { join } from 'path';
import { AnthropicLLM } from '../tireh/llm';
import { createFileStores } from '../tireh/memory/file-store';
import { TelegramBotClient } from '../tireh/telegram/client';
import { ElevenLabsStudio, OpenAIMedia } from './media';
import { Studio } from './service';
import { StudioStore } from './store';

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

async function create(): Promise<Studio> {
  const env = process.env;
  if (!env.STUDIO_SECRET || env.STUDIO_SECRET.length < 32) throw new Error('STUDIO_SECRET (≥32 chars) is required');
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required');
  const dir = env.STUDIO_DATA_DIR ?? join(process.cwd(), '.vox-studio');
  const store = new StudioStore(dir);
  const managerBot = env.VOXX_BOT_TOKEN ? new TelegramBotClient(env.VOXX_BOT_TOKEN) : null;
  let managerUsername = env.VOXX_BOT_USERNAME ?? '';
  if (managerBot && !managerUsername) {
    managerUsername = (await managerBot.getMe().catch(() => null))?.username ?? '';
  }
  return new Studio({
    store,
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
    memory: createFileStores(join(dir, 'memory.json')),
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
