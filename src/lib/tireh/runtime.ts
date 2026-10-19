/**
 * Production wiring for the persona gateway (Firestore, Anthropic/Gemini,
 * ElevenLabs, one Telegram bot per persona).
 *
 * Env:
 *   TIREH_WEBHOOK_SECRET          required; Telegram sends it on every webhook call
 *   TIREH_BOT_TOKEN_<PERSONA_ID>  bot token per persona, e.g. TIREH_BOT_TOKEN_ARIA
 *   TIREH_ORG_CONFIG / TIREH_ORG_CONFIG_PATH   org config (see org/config.ts)
 *   ANTHROPIC_API_KEY or GEMINI_API_KEY (+ TIREH_LLM_PROVIDER / TIREH_LLM_MODEL)
 *   ELEVENLABS_API_KEY            optional; enables voice in and out
 */

import { getAdminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { PersonaGateway } from './gateway';
import { createLLMFromEnv } from './llm';
import { loadOrgConfig } from './org/config';
import { OrgDirectory } from './org/directory';
import {
  FirestoreChatHistoryStore,
  FirestoreMemoryStore,
  FirestoreShareOfferStore,
  FirestoreUpdateDeduper,
} from './memory/firestore-store';
import { TelegramBotClient } from './telegram/client';
import { ElevenLabsVoiceService } from './voice';

export function botTokenEnvName(personaId: string): string {
  return `TIREH_BOT_TOKEN_${personaId.toUpperCase().replace(/-/g, '_')}`;
}

export function getBotToken(personaId: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[botTokenEnvName(personaId)];
}

let gatewayPromise: Promise<PersonaGateway> | null = null;

async function createGateway(): Promise<PersonaGateway> {
  const org = new OrgDirectory(loadOrgConfig());
  const db = await getAdminDb();
  const bots = new Map<string, TelegramBotClient>();

  return new PersonaGateway({
    org,
    llm: createLLMFromEnv(),
    memories: new FirestoreMemoryStore(db),
    offers: new FirestoreShareOfferStore(db),
    history: new FirestoreChatHistoryStore(db),
    deduper: new FirestoreUpdateDeduper(db),
    voice: process.env.ELEVENLABS_API_KEY ? new ElevenLabsVoiceService(process.env.ELEVENLABS_API_KEY) : null,
    botFor(personaId) {
      let bot = bots.get(personaId);
      if (!bot) {
        const token = getBotToken(personaId);
        if (!token) throw new Error(`${botTokenEnvName(personaId)} is not set`);
        bot = new TelegramBotClient(token);
        bots.set(personaId, bot);
      }
      return bot;
    },
    // Preserve the fixed structured diagnostic fields at the Pino destination.
    logger,
  });
}

export function getPersonaGateway(): Promise<PersonaGateway> {
  if (!gatewayPromise) {
    gatewayPromise = createGateway().catch((error) => {
      gatewayPromise = null; // allow a retry after fixing config
      throw error;
    });
  }
  return gatewayPromise;
}
