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

import { isAbsolute, join, parse, relative, resolve, sep } from 'path';
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

/** Validate deployment configuration without accessing disk or external services. */
export function validateStudioConfig(env: NodeJS.ProcessEnv, cwd = process.cwd()) {
  if (!env.STUDIO_SECRET || env.STUDIO_SECRET.trim().length < 32) throw new Error('STUDIO_SECRET (≥32 chars) is required');
  if (!env.ANTHROPIC_API_KEY?.trim()) throw new Error('ANTHROPIC_API_KEY is required');

  const production = env.NODE_ENV === 'production';
  const token = env.VOXX_BOT_TOKEN?.trim();
  const superadminIds = parseIds(env.STUDIO_SUPERADMIN_IDS);
  const dataDir = env.STUDIO_DATA_DIR || join(cwd, '.vox-studio');
  const webAppUrl = env.STUDIO_WEBAPP_URL?.trim();

  if (production) {
    if (!token || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('A valid VOXX_BOT_TOKEN is required in production');
    const rawIds = (env.STUDIO_SUPERADMIN_IDS ?? '').split(/[,\s]+/).filter(Boolean);
    if (!rawIds.length || rawIds.some((id) => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
      throw new Error('STUDIO_SUPERADMIN_IDS must contain positive Telegram user IDs in production');
    }
    let url: URL;
    try { url = new URL(webAppUrl ?? ''); } catch { throw new Error('STUDIO_WEBAPP_URL must be an HTTPS /studio URL in production'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname.replace(/\/$/, '') !== '/studio' || url.search || url.hash) {
      throw new Error('STUDIO_WEBAPP_URL must be an HTTPS /studio URL in production');
    }
    if (!env.STUDIO_DATA_DIR || !isAbsolute(dataDir)) throw new Error('STUDIO_DATA_DIR must be an explicit absolute persistent directory in production');
    const resolvedDir = resolve(dataDir);
    const within = (parent: string) => {
      const path = relative(resolve(parent), resolvedDir);
      return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
    };
    if (resolvedDir === parse(resolvedDir).root || resolvedDir === resolve(cwd) || within(join(cwd, 'public')) || within(join(cwd, '.next'))) {
      throw new Error('STUDIO_DATA_DIR must be a private data directory outside public and .next');
    }
  }

  return { production, token, superadminIds, dataDir, webAppUrl };
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
  const config = validateStudioConfig(env);
  const store = new StudioStore(config.dataDir);
  // Load and persist once so corrupt state or unwritable storage fails startup.
  if (config.production) await store.update(() => undefined);
  const managerBot = config.token ? new TelegramBotClient(config.token) : null;
  let managerUsername = env.VOXX_BOT_USERNAME ?? '';
  if (managerBot && config.production) {
    let manager;
    // Bound the read-only credential probe; an unavailable Telegram connection
    // must not leave server startup hanging indefinitely.
    const probe = new TelegramBotClient(config.token!, (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }));
    try { manager = await probe.getMe(); } catch { throw new Error('VOXX_BOT_TOKEN authentication failed (Telegram getMe)'); }
    if (!manager.is_bot || !manager.username) throw new Error('VOXX_BOT_TOKEN must identify a Telegram bot with a username');
    if (managerUsername && managerUsername.replace(/^@/, '').toLowerCase() !== manager.username.toLowerCase()) {
      throw new Error('VOXX_BOT_USERNAME does not match VOXX_BOT_TOKEN');
    }
    managerUsername = manager.username;
  } else if (managerBot && !managerUsername) {
    managerUsername = (await managerBot.getMe().catch(() => null))?.username ?? '';
  }
  return new Studio({
    store,
    personaLLM: new AnthropicLLM(env.ANTHROPIC_API_KEY!, env.STUDIO_PERSONA_MODEL || 'claude-sonnet-5-5'),
    chatLLM: new AnthropicLLM(env.ANTHROPIC_API_KEY!, env.STUDIO_CHAT_MODEL || 'claude-haiku-5-5'),
    openai: env.OPENAI_API_KEY ? new OpenAIMedia(env.OPENAI_API_KEY) : null,
    eleven: env.ELEVENLABS_API_KEY ? new ElevenLabsStudio(env.ELEVENLABS_API_KEY) : null,
    managerBot,
    managerUsername,
    botFor: (token) => new TelegramBotClient(token),
    secret: env.STUDIO_SECRET!,
    orgName: env.STUDIO_ORG_NAME ?? 'HOOR',
    superadminIds: config.superadminIds,
    webAppUrl: config.webAppUrl,
    memory: createFileStores(join(config.dataDir, 'memory.json')),
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
