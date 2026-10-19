/**
 * Run TIREH personas locally against real Telegram, without deploying.
 *
 *   npm run tireh:local
 *
 * Uses long polling (your machine pulls updates from Telegram), so no public
 * URL or webhook is needed. Any webhook set on the bot is removed while this
 * runs; re-register it with scripts/tireh-set-webhooks.mjs when you deploy.
 *
 * Reads .env.local / environment:
 *   TIREH_BOT_TOKEN_<PERSONA>   e.g. TIREH_BOT_TOKEN_ARIA (required, one per persona to run)
 *   TIREH_ORG_CONFIG_PATH       defaults to ./tireh.org.json
 *   ANTHROPIC_API_KEY or GEMINI_API_KEY (+ TIREH_LLM_PROVIDER=gemini)
 *   ELEVENLABS_API_KEY          optional, enables voice
 *   TIREH_STORE                 "file" (default, ./.tireh-local.json) or "firestore"
 *
 * Relative imports only (no "@/" aliases) so tsx can run it directly.
 */

import { existsSync } from 'fs';
import { PersonaGateway } from '../src/lib/tireh/gateway';
import { createLLMFromEnv } from '../src/lib/tireh/llm';
import { loadOrgConfig } from '../src/lib/tireh/org/config';
import { OrgDirectory } from '../src/lib/tireh/org/directory';
import { createFileStores } from '../src/lib/tireh/memory/file-store';
import { TelegramBotClient } from '../src/lib/tireh/telegram/client';
import { ElevenLabsVoiceService } from '../src/lib/tireh/voice';

const env = process.env;

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function createStores() {
  if (env.TIREH_STORE === 'firestore') {
    const { initializeApp, cert } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    if (!env.SERVICE_ACCOUNT_KEY) fail('TIREH_STORE=firestore needs SERVICE_ACCOUNT_KEY');
    const db = getFirestore(initializeApp({ credential: cert(JSON.parse(env.SERVICE_ACCOUNT_KEY)) }));
    const stores = await import('../src/lib/tireh/memory/firestore-store');
    return {
      memories: new stores.FirestoreMemoryStore(db),
      offers: new stores.FirestoreShareOfferStore(db),
      history: new stores.FirestoreChatHistoryStore(db),
      deduper: new stores.FirestoreUpdateDeduper(db),
      label: 'Firestore',
    };
  }
  const path = env.TIREH_LOCAL_STORE_PATH ?? '.tireh-local.json';
  return { ...createFileStores(path), label: path };
}

async function main() {
  if (!env.TIREH_ORG_CONFIG && !env.TIREH_ORG_CONFIG_PATH) {
    if (!existsSync('tireh.org.json')) {
      fail('No org config. Copy tireh.org.example.json to tireh.org.json and add your Telegram ID.');
    }
    env.TIREH_ORG_CONFIG_PATH = 'tireh.org.json';
  }
  const config = loadOrgConfig(env);

  // Only run personas whose bot token is present
  const bots = new Map<string, TelegramBotClient>();
  for (const persona of config.personas) {
    const token = env[`TIREH_BOT_TOKEN_${persona.id.toUpperCase().replace(/-/g, '_')}`];
    if (!token) continue;
    const bot = new TelegramBotClient(token);
    const me = await bot.getMe().catch((e) => fail(`${persona.name}: bot token rejected by Telegram (${e.message})`));
    // Mentions in groups depend on the real bot username
    persona.telegramUsername = me.username;
    await bot.deleteWebhook();
    bots.set(persona.id, bot);
    console.log(`✓ ${persona.name} (${persona.role}) → @${me.username}`);
  }
  if (bots.size === 0) fail('No persona bot tokens found. Set e.g. TIREH_BOT_TOKEN_ARIA.');

  const org = new OrgDirectory(config);
  const known = config.people.filter((p) => p.telegramUserId).map((p) => p.name);
  if (known.length === 0) {
    console.warn('! No Telegram IDs in the config yet. Message the bot: it will reply with your ID.');
  } else {
    console.log(`✓ Can talk: ${known.join(', ')}`);
  }

  const stores = await createStores();
  const voice = env.ELEVENLABS_API_KEY ? new ElevenLabsVoiceService(env.ELEVENLABS_API_KEY) : null;
  console.log(`✓ Memory: ${stores.label}`);
  console.log(`✓ Voice: ${voice ? 'on (ElevenLabs)' : 'off (set ELEVENLABS_API_KEY to enable)'}`);

  const gateway = new PersonaGateway({
    org,
    llm: createLLMFromEnv(env),
    memories: stores.memories,
    offers: stores.offers,
    history: stores.history,
    deduper: stores.deduper,
    voice,
    botFor: (id) => bots.get(id) ?? fail(`no bot for ${id}`),
    logger: console,
  });

  console.log('\nListening on Telegram. Ctrl+C to stop.\n');

  let running = true;
  process.on('SIGINT', () => {
    running = false;
    console.log('\nStopping…');
    setTimeout(() => process.exit(0), 500);
  });

  await Promise.all(
    [...bots.entries()].map(async ([personaId, bot]) => {
      let offset: number | undefined;
      while (running) {
        try {
          const updates = await bot.getUpdates(offset, 30);
          for (const update of updates) {
            offset = update.update_id + 1;
            const who = update.message?.from?.first_name ?? update.callback_query?.from.first_name ?? '?';
            const what = update.message?.text ?? (update.message?.voice ? '[voice]' : update.callback_query ? '[button]' : '');
            const result = await gateway.handleUpdate(personaId, update).catch((error) => {
              console.error(`  ✗ ${personaId}:`, error);
              return 'error';
            });
            console.log(`  ${personaId} ← ${who}: ${what.slice(0, 60)}  → ${result}`);
          }
        } catch (error) {
          console.error(`  ✗ polling ${personaId}:`, (error as Error).message);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    })
  );
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
