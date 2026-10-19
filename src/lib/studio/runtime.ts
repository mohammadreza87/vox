/**
 * Production wiring for Vox Studio, from environment variables.
 *
 * Required:
 *   STUDIO_SECRET            ≥32 chars; encrypts agent bot tokens at rest
 *   VOXX_BOT_TOKEN           the manager bot (@VoxxBot), with bot management
 *                            enabled in @BotFather's Mini App
 *   STUDIO_SUPERADMIN_IDS    comma-separated Telegram user ids of the founding owners
 *   ANTHROPIC_API_KEY        Claude: persona design and every reply
 * Optional:
 *   OPENAI_API_KEY           avatars (gpt-image) and speech-to-text
 *   ELEVENLABS_API_KEY       voice design, voice library, speech
 *   STUDIO_WEBAPP_URL        public https URL of /studio (menu button)
 *   STUDIO_DATA_DIR          default ./.vox-studio (file storage)
 *   STUDIO_MAINTENANCE=1     optional background sweep; requires file storage,
 *                            STUDIO_BOTS=1 and a persistent polling process
 *   STUDIO_REMINDER_DELIVERY=1  optional Telegram reminders; requires maintenance
 *                            and each person's separate channel confirmation
 *
 * Serverless production (Firebase):
 *   STUDIO_STORAGE=firestore  state in Firestore, media in Cloud Storage,
 *                            memories in the TIREH Firestore collections
 *   STUDIO_MEDIA_BUCKET      default NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
 *   STUDIO_PUBLIC_URL        https base URL; switches bots to webhooks
 *                            (/api/studio/telegram/[key]) instead of polling
 *   STUDIO_CHAT_MODEL        model for chat replies (default: claude-sonnet-5-5)
 *   STUDIO_VOICE_MODEL       model for live calls (default: claude-haiku-5-5, the fastest)
 *   STUDIO_DECISIONS         off = no OpenAI Decisions triage (default: on with OPENAI_API_KEY)
 *   STUDIO_WEB_SEARCH        off = agents never search the web (default: on, per-agent toggle)
 *   STUDIO_PERSONA_MODEL     model for persona design (default: stronger Claude model)
 *   STUDIO_ORG_NAME          default HOOR
 */

import { isAbsolute, join, parse, relative, resolve, sep } from 'path';
import { AnthropicLLM, type LLM } from '../tireh/llm';
import { createHash } from 'crypto';
import OpenAI from 'openai';
import { createFileStores } from '../tireh/memory/file-store';
import { FirestoreChatHistoryStore, FirestoreMemoryStore, FirestoreShareOfferStore, FirestoreUpdateDeduper } from '../tireh/memory/firestore-store';
import { TelegramBotClient } from '../tireh/telegram/client';
import { ElevenLabsStudio, OpenAIMedia } from './media';
import { FirestoreStudioStore } from './firestore-store';
import { FirestoreStudioRateLimiter } from './firestore-ratelimit';
import { Studio, type StudioDeps } from './service';
import { StudioStore } from './store';
import { RelationshipLoop, FileRelationshipStore, FirestoreRelationshipStore, FileObservationStore, FirestoreObservationStore, SafeRelationshipObserver, OpenAIFollowUpReview, OpenAIRelationshipFeedback } from '../relationships';
import { StudioRelationshipAssessor } from './relationship-assessor';
import { relationshipConfig } from './relationship-config';
import { AdaptiveService } from '../adaptive/persistence/service';
import { AdaptiveRelationshipService } from '../adaptive/relationships/service';
import { AdaptiveRepository } from '../adaptive/persistence/repository';
import { FileAdaptiveStorage, FirestoreAdaptiveStorage, type AdaptiveStorage } from '../adaptive/persistence/storage';
import { adaptiveOptionsFromManifest } from '../adaptive/persistence/config';
import { SharedMemoryRepository } from '../adaptive/shared/repository';
import { SharedMemoryService } from '../adaptive/shared/service';
import { AdaptiveExperienceService } from '../adaptive/runtime/service';
import { AdaptiveObserverService } from '../adaptive/observation/service';
import { AdaptiveLifecycleService } from '../adaptive/lifecycle/service';
import { AdaptiveMaintenanceRunner } from '../adaptive/lifecycle/maintenance';
import { DecisionService, OpenAIDecisionProvider } from '../adaptive/decisions';
import { VoiceIdentityService } from '../adaptive/voice-identity/service';
import { VoiceIdentityRepository } from '../adaptive/voice-identity/repository';
import { canUseAgent } from './permissions';
import { groupId } from './org-bridge';
import { z } from 'zod';
import { ImprovementWorkflow } from '../adaptive/improvement/workflow';
import { validateTrust, type TrustStore } from '../adaptive/improvement/contracts';
import { createStudioReminderDelivery } from './reminder-delivery';

function improvementTrust(raw: string | undefined, storage: string): TrustStore | undefined {
  if (!raw?.trim()) return undefined;
  if (storage !== 'file') throw new Error('STUDIO_IMPROVEMENT_TRUST_JSON requires file storage; distributed workflow support is unavailable');
  try {
    const trust = z.record(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), z.object({
      role: z.enum(['analyst', 'author', 'evaluator', 'human']),
      publicKey: z.string().min(1).max(4096).refine(pem => /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(pem)),
    }).strict()).refine(keys => Object.keys(keys).length <= 32).parse(JSON.parse(raw));
    validateTrust(trust); return trust;
  } catch { throw new Error('STUDIO_IMPROVEMENT_TRUST_JSON is invalid'); }
}

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
  const storage = env.STUDIO_STORAGE?.trim() || 'file';
  if (storage !== 'file' && storage !== 'firestore') throw new Error('STUDIO_STORAGE must be file or firestore');
  const mediaBucket = env.STUDIO_MEDIA_BUCKET?.trim() || env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  let publicUrl = env.STUDIO_PUBLIC_URL?.trim() || undefined;
  if (publicUrl && env.STUDIO_BOTS === '1') throw new Error('STUDIO_PUBLIC_URL webhooks cannot run with STUDIO_BOTS=1 long polling');
  if (storage === 'firestore' && !mediaBucket) throw new Error('STUDIO_MEDIA_BUCKET is required with STUDIO_STORAGE=firestore');

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
    const serverless = Boolean(env.K_SERVICE || env.FUNCTION_TARGET || env.FUNCTION_NAME || env.VERCEL === '1');
    if (storage === 'file') {
      if (serverless || publicUrl) throw new Error('Serverless and webhook deployments require STUDIO_STORAGE=firestore');
      if (!env.STUDIO_DATA_DIR || !isAbsolute(dataDir)) throw new Error('STUDIO_DATA_DIR must be an explicit absolute persistent directory in production');
      const resolvedDir = resolve(dataDir);
      const within = (parent: string) => {
        const path = relative(resolve(parent), resolvedDir);
        return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
      };
      if (resolvedDir === parse(resolvedDir).root || resolvedDir === resolve(cwd) || within(join(cwd, 'public')) || within(join(cwd, '.next'))) {
        throw new Error('STUDIO_DATA_DIR must be a private data directory outside public and .next');
      }
    } else {
      if (env.STUDIO_BOTS === '1') throw new Error('STUDIO_STORAGE=firestore production deployments require webhooks, not STUDIO_BOTS=1');
      let base: URL;
      try { base = new URL(publicUrl ?? ''); } catch { throw new Error('STUDIO_PUBLIC_URL must be an HTTPS origin with STUDIO_STORAGE=firestore'); }
      if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
        throw new Error('STUDIO_PUBLIC_URL must be an HTTPS origin with STUDIO_STORAGE=firestore');
      }
      publicUrl = base.origin;
      if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(mediaBucket!)) throw new Error('STUDIO_MEDIA_BUCKET must be a Cloud Storage bucket name');
    }
  }

  const relationships = relationshipConfig(env);
  const scopedRelationshipsEnabled = env.STUDIO_SCOPED_RELATIONSHIPS === '1';
  const maintenanceEnabled = env.STUDIO_MAINTENANCE === '1';
  const reminderDeliveryEnabled = env.STUDIO_REMINDER_DELIVERY === '1';
  // The only scheduler is startBots' in-process interval. Webhooks/serverless
  // have no scheduled maintenance entrypoint and must not advertise activation.
  if (maintenanceEnabled && (env.STUDIO_BOTS !== '1' || storage !== 'file' || publicUrl ||
    env.K_SERVICE || env.FUNCTION_TARGET || env.FUNCTION_NAME || env.VERCEL === '1')) {
    throw new Error('STUDIO_MAINTENANCE=1 requires STUDIO_BOTS=1 with file storage in a persistent polling process; webhook and serverless maintenance are unsupported');
  }
  if (reminderDeliveryEnabled && (!maintenanceEnabled || !token)) {
    throw new Error('STUDIO_REMINDER_DELIVERY=1 requires STUDIO_MAINTENANCE=1 and a configured manager bot');
  }
  const trustedImprovementKeys = improvementTrust(env.STUDIO_IMPROVEMENT_TRUST_JSON, storage);
  return { production, token, superadminIds, dataDir, webAppUrl, storage, mediaBucket, publicUrl, relationships, scopedRelationshipsEnabled, maintenanceEnabled, reminderDeliveryEnabled, trustedImprovementKeys };
}

/** STUDIO_WEB_SEARCH=off keeps every agent offline (web searches are billed per search). */
function chatLLM(env: NodeJS.ProcessEnv): LLM {
  const llm = new AnthropicLLM(env.ANTHROPIC_API_KEY!, env.STUDIO_CHAT_MODEL || 'claude-sonnet-5-5');
  return env.STUDIO_WEB_SEARCH === 'off' ? { identity: llm.identity, complete: (request) => llm.complete(request) } : llm;
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

type RuntimeStorage = Pick<StudioDeps, 'store' | 'memory' | 'rateLimiter' | 'adaptive' | 'relationshipStore' | 'observations'> & { sharedStorage: AdaptiveStorage; voiceIdentityStorage: AdaptiveStorage; maintenanceStorage: AdaptiveStorage };
function fileStorage(dir: string, scopedRelationshipsEnabled: boolean): RuntimeStorage {
  return { store: new StudioStore(dir), memory: createFileStores(join(dir, 'memory.json')),
    relationshipStore: new FileRelationshipStore(join(dir, 'scoped-relationships-v1.json')), observations: new FileObservationStore(join(dir, 'scoped-relationship-observations-v1.json')),
    adaptive: new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(join(dir, 'adaptive'))),
      { ...adaptiveOptionsFromManifest(process.env.STUDIO_ADAPTIVE_POLICY_JSON), scopedRelationshipsEnabled }),
    sharedStorage: new FileAdaptiveStorage(join(dir, 'shared-memory')),
    voiceIdentityStorage: new FileAdaptiveStorage(join(dir, 'voice-identity')),
    maintenanceStorage: new FileAdaptiveStorage(join(dir, 'adaptive-maintenance')) };
}

async function firestoreStorage(bucketName: string, scopedRelationshipsEnabled: boolean): Promise<RuntimeStorage> {
  const { getAdminApp, getAdminDb } = await import('@/lib/firebase-admin');
  const { getStorage } = await import('firebase-admin/storage');
  const db = await getAdminDb();
  const bucket = getStorage(await getAdminApp()).bucket(bucketName);
  return {
    store: new FirestoreStudioStore(db, bucket),
    adaptive: new AdaptiveService(new AdaptiveRepository(new FirestoreAdaptiveStorage(db)),
      { ...adaptiveOptionsFromManifest(process.env.STUDIO_ADAPTIVE_POLICY_JSON), scopedRelationshipsEnabled }),
    sharedStorage: new FirestoreAdaptiveStorage(db, 'adaptiveSharedMemory'),
    voiceIdentityStorage: new FirestoreAdaptiveStorage(db, 'adaptiveVoiceIdentity'),
    maintenanceStorage: new FirestoreAdaptiveStorage(db, 'adaptiveMaintenance'),
    rateLimiter: new FirestoreStudioRateLimiter(db),
    relationshipStore: new FirestoreRelationshipStore(db, 'vox_scoped_relationships_v1'),
    observations: new FirestoreObservationStore(db, 'vox_scoped_relationship_observations_v1'),
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
  const config = validateStudioConfig(env);
  const storage = config.storage === 'firestore' ? await firestoreStorage(config.mediaBucket!, config.scopedRelationshipsEnabled) : fileStorage(config.dataDir, config.scopedRelationshipsEnabled);
  // Load and persist once so corrupt state or unwritable storage fails startup.
  if (config.production) {
    if (config.storage === 'file') await storage.store.update(() => undefined);
    else await storage.store.read();
  }
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
  const openai = env.OPENAI_API_KEY ? new OpenAIMedia(env.OPENAI_API_KEY) : null;
  const authority = new AdaptiveRelationshipService(storage.adaptive!);
  const studio = new Studio({
    store: storage.store,
    personaLLM: new AnthropicLLM(env.ANTHROPIC_API_KEY!, env.STUDIO_PERSONA_MODEL || 'claude-sonnet-5-5'),
    chatLLM: chatLLM(env),
    fastLLM: new AnthropicLLM(env.ANTHROPIC_API_KEY!, env.STUDIO_VOICE_MODEL || 'claude-haiku-5-5'),
    openai,
    // Reply triage and stranger decisions; STUDIO_DECISIONS=off skips them.
    decider: openai && env.STUDIO_DECISIONS !== 'off' ? openai : undefined,
    eleven: env.ELEVENLABS_API_KEY ? new ElevenLabsStudio(env.ELEVENLABS_API_KEY) : null,
    managerBot,
    managerUsername,
    botFor: (token) => new TelegramBotClient(token),
    secret: env.STUDIO_SECRET!,
    orgName: env.STUDIO_ORG_NAME ?? 'HOOR',
    superadminIds: config.superadminIds,
    webAppUrl: config.webAppUrl,
    webhookBase: config.publicUrl,
    memory: storage.memory,
    adaptive: storage.adaptive,
    relationshipAuthority: authority,
    rateLimiter: storage.rateLimiter,
    imageToJpeg: toJpeg,
    relationshipStore: storage.relationshipStore,
    observations: storage.observations,
    relationshipConfig: config.relationships,
    relationships: new RelationshipLoop({
      store: storage.relationshipStore!,
      mode: config.scopedRelationshipsEnabled ? config.relationships.mode : 'off',
      authorize: async ({ key, sourceIds, phase, expectedFingerprint }) => {
        if (!config.scopedRelationshipsEnabled || !key.scope) return null;
        const match = /^telegram-account:([1-9]\d{0,15})$/.exec(key.scope.accountId);
        const telegramId = match ? Number(match[1]) : NaN;
        if (!Number.isSafeInteger(telegramId) || !await studio.relationshipCohortEnabled(key.personaId, telegramId)) return null;
        return authority.authorize(key, sourceIds, phase, expectedFingerprint);
      },
      applyScopedControl: async (key, action, until) => {
        const match = /^telegram-account:([1-9]\d{0,15})$/.exec(key.scope?.accountId ?? '');
        const telegramId = match ? Number(match[1]) : NaN;
        if (!key.scope || !Number.isSafeInteger(telegramId)) throw new Error('Invalid scoped relationship control');
        await authority.control(telegramId, key.personaId, key.scope.space, action, until?.getTime());
        await studio.deps.relationships!.control(key, action, { until });
      },
      assessor: new StudioRelationshipAssessor(new AnthropicLLM(env.ANTHROPIC_API_KEY!, env.STUDIO_VOICE_MODEL || 'claude-haiku-5-5')),
      decisions: env.OPENAI_API_KEY ? new OpenAIFollowUpReview(env.OPENAI_API_KEY) : undefined,
      feedback: env.OPENAI_API_KEY ? new OpenAIRelationshipFeedback(env.OPENAI_API_KEY) : undefined,
      observer: new SafeRelationshipObserver(storage.observations!, env.STUDIO_SECRET!),
    }),
  });
  // The callback runs after the adaptive account transaction. It never calls
  // status/context/authority, which would recursively re-enter that account.
  storage.adaptive!.setRelationshipInvalidator(async ({ telegramId, space, agentId, sourceIds, reason }) => {
    const accountId = `telegram-account:${telegramId}`;
    for (const key of await storage.relationshipStore!.keysForAccount(accountId)) {
      if (key.scope?.accountId !== accountId || key.scope.space !== space || (agentId && key.personaId !== agentId)) continue;
      await studio.deps.relationships!.invalidate(key, { sourceIds, reason });
    }
  });
  studio.deps.shared = new SharedMemoryService(new SharedMemoryRepository(storage.sharedStorage), storage.adaptive!, {
    member: async telegramId => {
      const state = await storage.store.read();
      const member = state.members.find(m => m.telegramId === telegramId);
      return { active: !!member && member.role !== 'pending', agentIds: member ? state.agents.filter(a => a.status === 'active' && canUseAgent(member, a)).map(a => a.id) : [] };
    },
    agent: async id => ({ active: (await storage.store.read()).agents.some(a => a.id === id && a.status === 'active') }),
    group: async id => {
      const state = await storage.store.read();
      const group = state.groups.find(g => groupId(g.chatId) === id);
      if (!group) return null;
      const memberTelegramIds = [...group.memberIds].sort((a, b) => a - b);
      const hasGuests = group.hasGuests || memberTelegramIds.some(id => !state.members.some(m => m.telegramId === id && m.role !== 'pending'));
      return { memberTelegramIds, hasGuests, revision: createHash('sha256').update(JSON.stringify([id, memberTelegramIds, hasGuests, group.audienceEpoch ?? 0])).digest('hex') };
    },
  });
  const reminderEndpointId = config.reminderDeliveryEnabled && config.token ? studio.relationshipEndpointId(config.token) : undefined;
  studio.deps.experience = new AdaptiveExperienceService(storage.adaptive!, {
    notificationsEnabled: config.reminderDeliveryEnabled,
    notificationEndpointId: reminderEndpointId,
    decisionsEnabled: env.STUDIO_DECISIONS_ENABLED === '1' && !!env.OPENAI_API_KEY,
    ...(env.STUDIO_DECISIONS_ENABLED === '1' && env.OPENAI_API_KEY ? {
      decisions: new DecisionService(new OpenAIDecisionProvider(new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 0 }))),
    } : {}),
  });
  if (reminderEndpointId && config.token) {
    studio.deps.reminderEndpointId = reminderEndpointId;
    studio.deps.reminderDelivery = createStudioReminderDelivery(studio, {
      enabled: true, endpointId: reminderEndpointId, botToken: config.token, webAppUrl: config.webAppUrl,
    });
  }
  // No matching provider is qualified by this release. Status/delete remain
  // reachable, while every capture/enrollment operation fails before audio.
  studio.deps.voiceIdentity = new VoiceIdentityService(storage.adaptive!, new VoiceIdentityRepository(storage.voiceIdentityStorage), { enabled: false });
  storage.adaptive!.setVoiceIdentityInvalidator(async ({ telegramId, space }) => {
    await studio.deps.voiceIdentity!.invalidate(telegramId, space);
  });
  studio.deps.observer = new AdaptiveObserverService(storage.adaptive!);
  studio.deps.lifecycle = new AdaptiveLifecycleService(storage.adaptive!, { shared: studio.deps.shared });
  if (config.maintenanceEnabled) studio.deps.maintenance = new AdaptiveMaintenanceRunner(studio.deps.lifecycle,
    storage.adaptive!.repository.storage, storage.maintenanceStorage, {
      afterAccount: (telegramId, context) => maintainAdaptiveAccount(studio, telegramId, context.signal),
    });
  if (config.trustedImprovementKeys) {
    const workflow = new ImprovementWorkflow({ root: join(config.dataDir, 'improvement-review'), trust: config.trustedImprovementKeys });
    // Server/runtime receives only the report capability, with no signing material
    // and no proposal, candidate, evaluation or release mutation methods.
    studio.deps.improvement = { report: () => workflow.report() };
  }
  return studio;
}

export async function maintainAdaptiveAccount(studio: Studio, telegramId: number, signal?: AbortSignal): Promise<void> {
  const results = await Promise.allSettled([
      (async () => {
        const state = await studio.deps.store.read();
        const member = state.members.find(m => m.telegramId === telegramId && m.role !== 'pending');
        const allowedAgentIds = member ? state.agents.filter(a => a.status === 'active' && canUseAgent(member, a) && !(a.blocked ?? []).includes(telegramId)).map(a => a.id) : [];
        return studio.deps.observer!.process(telegramId, { limit: 20, allowedAgentIds });
      })(),
      // No Studio read is a prerequisite for independent biometric cleanup.
      studio.deps.voiceIdentity!.maintenanceAccount(telegramId),
      studio.deps.reminderDelivery?.drainAccount(telegramId, { signal }),
    ]);
  if (results.some(result => result.status === 'rejected') ||
      results[0].status === 'fulfilled' && results[0].value.failed ||
      results[1].status === 'fulfilled' && results[1].value.pending) throw new Error('Adaptive maintenance incomplete');
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
