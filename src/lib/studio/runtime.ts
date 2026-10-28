import { acquireQualifiedMemoryTime, qualifiedMemoryClock, type QualifiedMemoryTime } from '../adaptive/memory-account-time';
import { readMemoryAccountRoot } from '../adaptive/memory-account-lifecycle-file';
import { fileRuntimeArtifactDigest } from './file-runtime-owner';
import {StudioMemoryAccount,assertMemoryAccountEffect} from './memory-account';
import { ensureStudioFileRuntimeOwner, type FileRuntimeOwner } from './file-runtime-owner';
import { StudioTelegramArchive } from './telegram-archive';
import {StudioAssistantTextIntegration,parseAssistantTextKeys} from './assistant-text-integration';
import { createStudioRequestedRoutines } from './requested-routines';
import { RightsUseHoldService } from '../adaptive/rights-use-holds/service';
import { lstatSync } from 'node:fs';
import { RightsFileStorage } from '../adaptive/rights-intake/storage';
import { RightsIntakeService } from '../adaptive/rights-intake/service';
import { RightsRepository } from '../adaptive/rights-intake/repository';
import { parseRightsPolicy } from '../adaptive/rights-intake/policy';
import { assertRightsAccountNow } from './rights-http';
import { createStudioPreferenceLearning } from './preference-learning';
import { FileExperimentStorage } from '../adaptive/experiments/storage';
import { ControlledExperimentService } from '../adaptive/experiments/service';
import { StudioExperimentRuntime } from '../adaptive/experiments/runtime';
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
 *   STUDIO_TTS_PROVIDER      eleven (default) | gemini: speech for Mini App call and pet voice turns
 *                            (tts/, design §8A.3). gemini needs GEMINI_API_KEY (or GOOGLE_API_KEY);
 *                            STUDIO_GEMINI_TTS_MODEL (default gemini-3.8-flash-tts) and
 *                            STUDIO_GEMINI_TTS_VOICE (default Achird) tune it
 *   STUDIO_WEBAPP_URL        public https URL of /studio (menu button)
 *   STUDIO_DATA_DIR          default ./.vox-studio (file storage)
 *   STUDIO_ADAPTIVE_FORMAT   file (default), sqlite-v1 or file-v2; managed formats
 *                            require an explicit quiesced transition before startup
 *   STUDIO_MAINTENANCE=1     optional background sweep; requires file storage,
 *                            STUDIO_BOTS=1 and a persistent polling process
 *   STUDIO_REMINDER_DELIVERY=1  optional Telegram reminders; requires maintenance
 *                            and each person's separate channel confirmation
 *   STUDIO_PET_CHECKINS=on   pet check-ins (default off: nothing is ever sent); run by the
 *                            maintenance loop, or POST /api/studio/pet/checkins/run with
 *                            STUDIO_PET_CHECKINS_TRIGGER_SECRET on webhook deployments
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
 *   STUDIO_SKILL_ROUTING     per-message playbook selection inside triage (docs/SKILL_ROUTING.md):
 *                            on (default) | shadow (ask and log, replies keep the full craft)
 *                            | off (never ask). Any other value is treated as off.
 *   STUDIO_WEB_SEARCH        off = agents never search the web (default: on, per-agent toggle)
 *   STUDIO_PERSONA_MODEL     model for persona design (default: stronger Claude model)
 *   STUDIO_ORG_NAME          default HOOR
 *   STUDIO_CIRCLES           off (default) | reply: agent cards and reply-only DMs for outsiders of
 *                            public agents (S1) | circles: full. Read per use: the kill switch
 *   STUDIO_CIRCLE_CHATS      comma-separated group chat ids where circles may open (pilot allowlist;
 *                            S2 cards, in-group Join, N of M). Read per use; unset = none
 *   STUDIO_NOTE_SELECTOR     explicit (default): notes are proposed only for an explicit "remember
 *                            this" (S3) | decisions: a disabled placeholder that proposes nothing
 *   STUDIO_MAIN_APP_BOT      the manager bot's username, set once its Main Mini App points at STUDIO_WEBAPP_URL
 *                            in BotFather (S4): group cards then open each person's pet over the group
 *                            (t.me/<bot>?startapp=p_…). Read per use; needs STUDIO_CIRCLES=circles; must name
 *                            the VOXX_BOT_TOKEN bot (else ignored); unset = the S2 DM hop
 *
 * Voiceprints (S11L, shadow mode; docs/implementation/VOICE_PROVIDER_INTEGRATION.md):
 *   STUDIO_VOICE_RECOGNITION=1  voiceprint enrollment and shadow verification; capability
 *                            approval and biometric consent are still required (default off)
 *   VOICEPRINT_KEY           base64 of 32 bytes: the dedicated template key. Must never equal
 *                            or derive from STUDIO_SECRET. Required with the flag; alone it
 *                            keeps existing templates deletable (status/delete only)
 *   PYANNOTE_API_KEY         pyannoteAI voiceprint provider (absent = provider unavailable)
 *   PYANNOTE_BASE_URL        optional https origin (EU residency); default https://api.pyannote.ai
 *   VOICE_MATCH_THRESHOLDS_JSON  {"default":{match,uncertain,echo},"orgs":{"<org>":{...}}}
 */

import { isAbsolute, join, parse, relative, resolve, sep } from 'path';
import { AnthropicLLM, type LLM } from '../tireh/llm';
import { parseSkillRouting } from '../tireh/skill-routing';
import { createFileStores } from '../tireh/memory/file-store';
import { FirestoreChatHistoryStore, FirestoreMemoryStore, FirestoreShareOfferStore, FirestoreUpdateDeduper } from '../tireh/memory/firestore-store';
import { TelegramBotClient } from '../tireh/telegram/client';
import { ElevenLabsStudio, OpenAIMedia } from './media';
import { createSpeechSynthesizer, parseTtsProvider } from './tts';
import { svgToPng } from './character/portrait';
import { FirestoreStudioStore } from './firestore-store';
import { FirestoreStudioRateLimiter } from './firestore-ratelimit';
import { Studio, type StudioDeps } from './service';
import { FilePetStore, FirestorePetStore } from './pet-store';
import { FilePetPlayStore, FirestorePetPlayStore } from './pet-play-store';
import { FilePetGrowthStore, FirestorePetGrowthStore } from './pet-growth-store';
import { FilePetCheckinStore, FirestorePetCheckinStore } from './pet-checkins/store';
import { StudioStore, type StudioStorage } from './store';
import { RelationshipLoop, FileRelationshipStore, FirestoreRelationshipStore, FileObservationStore, FirestoreObservationStore, SafeRelationshipObserver, OpenAIFollowUpReview, OpenAIRelationshipFeedback } from '../relationships';
import { StudioRelationshipAssessor } from './relationship-assessor';
import { relationshipConfig } from './relationship-config';
import { AdaptiveService } from '../adaptive/persistence/service';
import { AdaptiveRelationshipService } from '../adaptive/relationships/service';
import { AdaptiveRepository } from '../adaptive/persistence/repository';
import { FileAdaptiveStorage, FirestoreAdaptiveStorage, type AdaptiveStorage } from '../adaptive/persistence/storage';
import { adaptiveOptionsFromManifest } from '../adaptive/persistence/config';
import { openLocalAdaptiveStorage, parseAdaptiveStorageFormat, type AdaptiveStorageFormat } from '../adaptive/persistence/runtime-storage';
import { SharedMemoryRepository } from '../adaptive/shared/repository';
import { FirestoreRevisionSource } from '../tireh/privacy/revisions';
import { SharedMemoryService } from '../adaptive/shared/service';
import { tirehFlags } from '../tireh/flags';
import { auditMemoryStore, auditShareOfferStore, createFileAuditStore, createFileSupersededNoticeStore, FirestoreAuditStore, FirestoreSupersededNoticeStore } from '../tireh/audit';
import { AdaptiveExperienceService } from '../adaptive/runtime/service';
import { AdaptiveObserverService } from '../adaptive/observation/service';
import { AdaptiveLifecycleService } from '../adaptive/lifecycle/service';
import { AdaptiveMaintenanceRunner } from '../adaptive/lifecycle/maintenance';
import { readMaintenanceHealth } from '../adaptive/lifecycle/maintenance-health';
import { DecisionService, OpenAIDecisionProvider } from '../adaptive/decisions';
import { studioDecider } from '../tireh/decisions/service-decider';
import { VoiceIdentityService } from '../adaptive/voice-identity/service';
import { VoiceIdentityRepository } from '../adaptive/voice-identity/repository';
import { localVoiceIdentityOptions } from '../adaptive/voice-identity/runtime-config';
import { canUseAgent } from './permissions';
import { sharedAuthorityFromStudioStore } from './shared-authority';
import { z } from 'zod';
import { ImprovementWorkflow } from '../adaptive/improvement/workflow';
import { validateTrust, type TrustStore } from '../adaptive/improvement/contracts';
import { createStudioReminderDelivery } from './reminder-delivery';
import { digest } from '../adaptive/persistence/repository';
import { parseCirclesMode } from '../circles/codec';
import { FileAgentChoiceStore, FirestoreAgentChoiceStore } from '../circles/choice-store';
import { parseCircleChats } from '../circles/codec';
import { CircleRepository, CIRCLE_COLLECTION } from '../circles/repository';
import { CircleService } from '../circles/service';
import { CircleNotes, NotesRepository, NOTES_COLLECTION } from '../circles/notes';
import { ChannelDrafts, CHANNEL_DRAFT_COLLECTION } from '../circles/channels';
import { parseNoteSelector } from '../circles/note-selector';

/** Internal availability is bound to current committed company roles, never a
 * bootstrap/environment list. Unsupported distributed synchronous reads deny. */
export function internalPilotAuthority(store: StudioStorage) {
  return { currentInternalMember: (accountId: string) => {
    try {
      const match = /^telegram-account:([1-9]\d{0,15})$/.exec(accountId);
      if (!match || !Number.isSafeInteger(Number(match[1]))) return;
      const state = store.readCommittedForEffect?.();
      if (!state) return;
      const rows = state.members.filter(member => member.telegramId === Number(match[1]));
      if (rows.length !== 1 || !['owner', 'superadmin'].includes(rows[0].role)) return;
      const revision = rows[0].learningAuthorityRevision ?? 0;
      if (!Number.isSafeInteger(revision) || revision < 0) return;
      return { allowed: true, authorityVersion: digest([rows[0].telegramId, rows[0].role, rows[0].joinedAt, revision]) };
    } catch { return; }
  } };
}

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
  // Parse only: no operational role, age, consent or jurisdiction is inferred.
  // Invalid supplied policy fails before opening stores or contacting a provider.
  adaptiveOptionsFromManifest(env.STUDIO_ADAPTIVE_POLICY_JSON);

  const production = env.NODE_ENV === 'production';
  const token = env.VOXX_BOT_TOKEN?.trim();
  const superadminIds = parseIds(env.STUDIO_SUPERADMIN_IDS);
  const dataDir = env.STUDIO_DATA_DIR || join(cwd, '.vox-studio');
  const webAppUrl = env.STUDIO_WEBAPP_URL?.trim();
  const storage = env.STUDIO_STORAGE?.trim() || 'file';
  if (storage !== 'file' && storage !== 'firestore') throw new Error('STUDIO_STORAGE must be file or firestore');
  const adaptiveFormat = parseAdaptiveStorageFormat(env.STUDIO_ADAPTIVE_FORMAT, storage, !(env.K_SERVICE || env.FUNCTION_TARGET || env.FUNCTION_NAME || env.VERCEL === '1' || env.STUDIO_PUBLIC_URL?.trim()));
  if(env.STUDIO_ASSISTANT_TEXT_DELIVERY!==undefined&&!['','0','1'].includes(env.STUDIO_ASSISTANT_TEXT_DELIVERY))throw new Error('STUDIO_ASSISTANT_TEXT_DELIVERY must be 0 or 1');
  const assistantTextEnabled=env.STUDIO_ASSISTANT_TEXT_DELIVERY==='1';
  const assistantTextKeys=parseAssistantTextKeys(env.STUDIO_ASSISTANT_TEXT_KEYS_JSON,Date.now());
  if(assistantTextEnabled&&(storage!=='file'||adaptiveFormat!=='file'||env.STUDIO_BOTS!=='1'||env.STUDIO_PUBLIC_URL?.trim()||env.K_SERVICE||env.FUNCTION_TARGET||env.FUNCTION_NAME||env.VERCEL==='1'||!assistantTextKeys))throw new Error('Assistant text delivery requires keys and original FILE persistent singleton polling; production ownership qualification is separate');
  if (env.STUDIO_TELEGRAM_ARCHIVE !== undefined && !['', '0', '1'].includes(env.STUDIO_TELEGRAM_ARCHIVE)) throw new Error('STUDIO_TELEGRAM_ARCHIVE must be 0 or 1');
  if (env.STUDIO_TELEGRAM_ARCHIVE === '1' && (storage !== 'file' || adaptiveFormat !== 'file' || env.STUDIO_BOTS !== '1')) throw new Error('STUDIO_TELEGRAM_ARCHIVE=1 requires canonical FILE and persistent STUDIO_BOTS=1 polling');
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
  const requestedRoutinesEnabled = env.STUDIO_REQUESTED_ROUTINES === '1';
  if (requestedRoutinesEnabled && (env.STUDIO_BOTS !== '1' || storage !== 'file' || publicUrl ||
    env.K_SERVICE || env.FUNCTION_TARGET || env.FUNCTION_NAME || env.VERCEL === '1')) {
    throw new Error('STUDIO_REQUESTED_ROUTINES=1 requires STUDIO_BOTS=1 with file storage in a persistent polling process');
  }
  const reminderDeliveryEnabled = env.STUDIO_REMINDER_DELIVERY === '1';
  if (env.STUDIO_EXPERIMENTS_ENABLED !== undefined && !['', '0', '1'].includes(env.STUDIO_EXPERIMENTS_ENABLED)) {
    throw new Error('STUDIO_EXPERIMENTS_ENABLED must be 0 or 1');
  }
  const experimentsEnabled = env.STUDIO_EXPERIMENTS_ENABLED === '1';
  if (experimentsEnabled && (storage !== 'file' || adaptiveFormat === 'file' || publicUrl ||
    env.K_SERVICE || env.FUNCTION_TARGET || env.FUNCTION_NAME || env.VERCEL === '1')) {
    throw new Error('STUDIO_EXPERIMENTS_ENABLED=1 requires prepared local adaptive storage in a persistent process');
  }
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
  return { production, token, superadminIds, dataDir, webAppUrl, storage, adaptiveFormat, mediaBucket, publicUrl, relationships, scopedRelationshipsEnabled, maintenanceEnabled, reminderDeliveryEnabled, experimentsEnabled, requestedRoutinesEnabled, trustedImprovementKeys,assistantTextEnabled,assistantTextKeys };
}

/** STUDIO_WEB_SEARCH=off keeps every agent offline (web searches are billed per search). */
function chatLLM(env: NodeJS.ProcessEnv): LLM {
  const llm = new AnthropicLLM(env.ANTHROPIC_API_KEY!, env.STUDIO_CHAT_MODEL || 'claude-sonnet-5-5');
  return env.STUDIO_WEB_SEARCH === 'off' ? { identity: llm.identity, committedExportFence: llm.committedExportFence,
    complete: (request) => llm.complete(request) } : llm;
}

async function toJpeg(data: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp(data, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(640, 640, { fit: 'cover' })
    .jpeg({ quality: 88 })
    .toBuffer();
}

const g = globalThis as unknown as { __voxStudio?: Promise<Studio>; __voxPreferenceTasks?: Studio['deps']['preferenceLearning'];
  __voxPreferenceStop?: Promise<{ pending: number }>; __voxPreferenceHooks?: boolean; __voxAdaptiveClose?: () => void; __voxAdaptiveExitHook?: boolean; __voxBotRuntime?: { stop(): Promise<{pending:number}> }; __voxRuntimeStop?: Promise<{pending:number}>; __voxFileRuntimeOwner?:FileRuntimeOwner };
export function stopStudioPreferenceLearning(): Promise<{ pending: number }> {
  return g.__voxPreferenceStop = g.__voxPreferenceTasks?.tasks.close() ?? Promise.resolve({ pending: 0 });
}

type RuntimeStorage = Pick<StudioDeps, 'store' | 'pets' | 'petPlay' | 'petGrowth' | 'petCheckins' | 'choices' | 'circleLedger' | 'notesLedger' | 'channelDrafts' | 'memory' | 'rateLimiter' | 'adaptive' | 'relationshipStore' | 'observations' | 'revisions'> & { sharedStorage: AdaptiveStorage; voiceIdentityStorage: AdaptiveStorage; maintenanceStorage: AdaptiveStorage; closeAdaptive?: () => void };
function fileStorage(dir: string, scopedRelationshipsEnabled: boolean, format: AdaptiveStorageFormat, memoryClock?:()=>number): RuntimeStorage {
  const managed = openLocalAdaptiveStorage(join(dir, 'adaptive'), format);
  try { const store = new StudioStore(dir);
    return { store, pets: new FilePetStore(join(dir, 'pets')), petPlay: new FilePetPlayStore(join(dir, 'pets')), petGrowth: new FilePetGrowthStore(join(dir, 'pets')), petCheckins: new FilePetCheckinStore(join(dir, 'pets')), choices: new FileAgentChoiceStore(join(dir, 'circles')),
    circleLedger: new CircleService(new CircleRepository(new FileAdaptiveStorage(join(dir, 'circles', 'ledger')))),
    notesLedger: new CircleNotes(new NotesRepository(new FileAdaptiveStorage(join(dir, 'circles', 'notes')))),
    channelDrafts: new ChannelDrafts(new FileAdaptiveStorage(join(dir, 'circles', 'channel-drafts'))), memory: createFileStores(join(dir, 'memory.json')),
    relationshipStore: new FileRelationshipStore(join(dir, 'scoped-relationships-v1.json')), observations: new FileObservationStore(join(dir, 'scoped-relationship-observations-v1.json')),
    adaptive: new AdaptiveService(new AdaptiveRepository(managed.storage),
      { ...adaptiveOptionsFromManifest(process.env.STUDIO_ADAPTIVE_POLICY_JSON, internalPilotAuthority(store)), ...(memoryClock?{now:memoryClock}:{}), scopedRelationshipsEnabled, voiceRecognitionEnabled: process.env.STUDIO_VOICE_RECOGNITION === '1' }),
    sharedStorage: new FileAdaptiveStorage(join(dir, 'shared-memory')),
    voiceIdentityStorage: new FileAdaptiveStorage(join(dir, 'voice-identity')),
    maintenanceStorage: new FileAdaptiveStorage(join(dir, 'adaptive-maintenance')), closeAdaptive: managed.close };
  } catch (error) { managed.close(); throw error; }
}

async function firestoreStorage(bucketName: string, scopedRelationshipsEnabled: boolean): Promise<RuntimeStorage> {
  const { getAdminApp, getAdminDb } = await import('@/lib/firebase-admin');
  const { getStorage } = await import('firebase-admin/storage');
  const db = await getAdminDb();
  const bucket = getStorage(await getAdminApp()).bucket(bucketName);
  const store = new FirestoreStudioStore(db, bucket);
  return {
    store,
    pets: new FirestorePetStore(db),
    petPlay: new FirestorePetPlayStore(db),
    petGrowth: new FirestorePetGrowthStore(db),
    petCheckins: new FirestorePetCheckinStore(db),
    choices: new FirestoreAgentChoiceStore(db),
    circleLedger: new CircleService(new CircleRepository(new FirestoreAdaptiveStorage(db, CIRCLE_COLLECTION))),
    notesLedger: new CircleNotes(new NotesRepository(new FirestoreAdaptiveStorage(db, NOTES_COLLECTION))),
    channelDrafts: new ChannelDrafts(new FirestoreAdaptiveStorage(db, CHANNEL_DRAFT_COLLECTION)),
    adaptive: new AdaptiveService(new AdaptiveRepository(new FirestoreAdaptiveStorage(db)),
      { ...adaptiveOptionsFromManifest(process.env.STUDIO_ADAPTIVE_POLICY_JSON, internalPilotAuthority(store)), scopedRelationshipsEnabled, voiceRecognitionEnabled: process.env.STUDIO_VOICE_RECOGNITION === '1' }),
    sharedStorage: new FirestoreAdaptiveStorage(db, 'adaptiveSharedMemory'),
    voiceIdentityStorage: new FirestoreAdaptiveStorage(db, 'adaptiveVoiceIdentity'),
    maintenanceStorage: new FirestoreAdaptiveStorage(db, 'adaptiveMaintenance'),
    rateLimiter: new FirestoreStudioRateLimiter(db),
    // Turn rechecks: one masked getAll of the revision documents.
    revisions: new FirestoreRevisionSource(db),
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
  const fileRuntimeOwner = config.storage === 'file' && config.adaptiveFormat === 'file' ? ensureStudioFileRuntimeOwner(config.dataDir,{requireQualified:config.production||config.assistantTextEnabled}) : undefined;
  if(fileRuntimeOwner)g.__voxFileRuntimeOwner=fileRuntimeOwner;
  const ownerHook = fileRuntimeOwner ? { beforeAuthorize: () => {fileRuntimeOwner.assertCurrent();assertMemoryAccountEffect();}, assertActive: () => fileRuntimeOwner.assertActive(), signal: fileRuntimeOwner.signal } : undefined;
  let memoryTime:QualifiedMemoryTime|undefined;
  if(fileRuntimeOwner){
    const marked=readMemoryAccountRoot(join(config.dataDir,'adaptive')).marked;
    try{memoryTime=await acquireQualifiedMemoryTime({dataRoot:config.dataDir,owner:fileRuntimeOwner,artifactDigest:fileRuntimeArtifactDigest(config.dataDir),purpose:'runtime',signal:fileRuntimeOwner.signal});}
    catch(error){if(marked){fileRuntimeOwner.beginDrain();throw error;}}
  }
  const storage = config.storage === 'firestore' ? await firestoreStorage(config.mediaBucket!, config.scopedRelationshipsEnabled) : fileStorage(config.dataDir, config.scopedRelationshipsEnabled, config.adaptiveFormat,memoryTime?qualifiedMemoryClock(memoryTime):undefined);
  let initialManagerMetadataFailure = false;
  try {
    // Load and persist once so corrupt state or unwritable storage fails startup.
    if (config.production) {
      if (config.storage === 'file') await storage.store.update(() => undefined);
      else await storage.store.read();
    }
    const managerBot = config.token ? new TelegramBotClient(config.token, undefined, ownerHook) : null;
    let managerUsername = env.VOXX_BOT_USERNAME ?? '';
    if (managerBot && config.production) {
      let manager;
      // Bound the read-only credential probe; an unavailable Telegram connection
      // must not leave server startup hanging indefinitely.
      const probe = new TelegramBotClient(config.token!, (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10_000)]) }), ownerHook);
      try { manager = await probe.getMe(); } catch { initialManagerMetadataFailure = true; throw new Error('VOXX_BOT_TOKEN authentication failed (Telegram getMe)'); }
      if (!manager.is_bot || !manager.username) { initialManagerMetadataFailure = true; throw new Error('VOXX_BOT_TOKEN must identify a Telegram bot with a username'); }
      if (managerUsername && managerUsername.replace(/^@/, '').toLowerCase() !== manager.username.toLowerCase()) {
        initialManagerMetadataFailure = true;
        throw new Error('VOXX_BOT_USERNAME does not match VOXX_BOT_TOKEN');
      }
      managerUsername = manager.username;
    } else if (managerBot && !managerUsername) {
      managerUsername = (await managerBot.getMe().catch(() => null))?.username ?? '';
    }
    const openai = env.OPENAI_API_KEY ? new OpenAIMedia(env.OPENAI_API_KEY) : null;
    const eleven = env.ELEVENLABS_API_KEY ? new ElevenLabsStudio(env.ELEVENLABS_API_KEY) : null;
    const ttsProvider = parseTtsProvider(env.STUDIO_TTS_PROVIDER);
    const tts = createSpeechSynthesizer(ttsProvider, { eleven, env });
    if (ttsProvider === 'gemini' && !tts?.canSynthesize) console.warn('[studio] STUDIO_TTS_PROVIDER=gemini without GEMINI_API_KEY or GOOGLE_API_KEY; pet voice replies stay text');
    const authority = new AdaptiveRelationshipService(storage.adaptive!);
    const studio = new Studio({
      store: storage.store,
      fileRuntimeOwner,
      // Wired here, not derived: route bundles carry their own copy of the store classes, so
      // petStoreFor's instanceof checks fail on a Studio built by instrumentation.
      pets: storage.pets,
      petPlay: storage.petPlay,
      petGrowth: storage.petGrowth,
      petCheckins: storage.petCheckins,
      choices: storage.choices,
      circleLedger: storage.circleLedger,
      notesLedger: storage.notesLedger,
      channelDrafts: storage.channelDrafts,
      personaLLM: new AnthropicLLM(env.ANTHROPIC_API_KEY!, env.STUDIO_PERSONA_MODEL || 'claude-sonnet-5-5'),
      chatLLM: chatLLM(env),
      fastLLM: new AnthropicLLM(env.ANTHROPIC_API_KEY!, env.STUDIO_VOICE_MODEL || 'claude-haiku-5-5'),
      openai,
      // Reply triage and stranger decisions; STUDIO_DECISIONS=off skips them.
      decider: openai && env.STUDIO_DECISIONS !== 'off' ? studioDecider(openai, env) : undefined,
      skillRouting: parseSkillRouting(env.STUDIO_SKILL_ROUTING),
      eleven,
      // STUDIO_TTS_PROVIDER: eleven (default) adapts the client above; gemini is the Gemini TTS adapter (tts/gemini.ts).
      tts,
      managerBot,
      managerUsername,
      botFor: (token) => new TelegramBotClient(token, undefined, ownerHook),
      secret: env.STUDIO_SECRET!,
      orgName: env.STUDIO_ORG_NAME ?? 'HOOR',
      superadminIds: config.superadminIds,
      webAppUrl: config.webAppUrl,
      webhookBase: config.publicUrl,
      memory: storage.memory,
      adaptive: storage.adaptive,
      revisions: storage.revisions,
      relationshipAuthority: authority,
      // Content-free per-stage timings for a latency baseline (scripts/stage-timings.ts).
      stageTimings: env.STUDIO_STAGE_TIMINGS === '1',
      circles: () => parseCirclesMode(process.env.STUDIO_CIRCLES),
      circleChats: () => parseCircleChats(process.env.STUDIO_CIRCLE_CHATS),
      noteSelector: () => parseNoteSelector(process.env.STUDIO_NOTE_SELECTOR),
      mainAppBot: () => process.env.STUDIO_MAIN_APP_BOT,
      // Agent-signed initData needs Telegram's Ed25519 signature (production key, auth.ts). The emergency switch
      // STUDIO_INITDATA_SIGNATURE=shadow relaxes it for low-value pet routes only (initdata-trust.ts); read per use.
      initDataSignature: () => (process.env.STUDIO_INITDATA_SIGNATURE?.trim() === 'shadow' ? 'shadow' : 'enforce'),
      integrityAlerts: () => process.env.STUDIO_BOT_INTEGRITY_ALERTS?.trim() !== 'off',
      rateLimiter: storage.rateLimiter,
      imageToJpeg: toJpeg,
      // The portrait edit reference; STUDIO_PORTRAITS=text skips it (PLAN §7 A/B gate).
      svgToPng,
      portraitVia: env.STUDIO_PORTRAITS === 'text' ? 'text' : 'edit',
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
        synchronize: (key, sourceIds) => authority.synchronize(key, sourceIds),
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
    // Connections reach Studio as functions behind a dynamic import (no class crosses a route bundle, no instanceof).
    studio.deps.connectionUsage = async (agentId, viewerTelegramId) => (await import('../connections/runtime')).connectionUsageFor(studio, agentId, viewerTelegramId);
    studio.deps.connectionsRights = async () => (await import('../connections/runtime')).connectionsRightsFor(studio);
    studio.deps.shared = new SharedMemoryService(new SharedMemoryRepository(storage.sharedStorage), storage.adaptive!, sharedAuthorityFromStudioStore(storage.store));
    // S08: content-free vox_audit rows and supersede notices, only when a flag is set at startup.
    { const flags = tirehFlags(); if (flags.auditLog || flags.sharingV2) { const db = config.storage === 'firestore' ? await (await import('@/lib/firebase-admin')).getAdminDb() : null; const audit = db ? new FirestoreAuditStore(db) : createFileAuditStore(join(config.dataDir, 'vox-audit.jsonl')); const notices = db ? new FirestoreSupersededNoticeStore(db) : createFileSupersededNoticeStore(join(config.dataDir, 'supersede-notices.json')); studio.deps.audit = audit; studio.deps.memoryNotices = notices; studio.deps.memory = { ...studio.deps.memory, memories: auditMemoryStore(studio.deps.memory.memories, audit, notices), offers: auditShareOfferStore(studio.deps.memory.offers, audit) }; } }
    const reminderEndpointId = config.reminderDeliveryEnabled && config.token ? studio.relationshipEndpointId(config.token) : undefined;
    studio.deps.experience = new AdaptiveExperienceService(storage.adaptive!, {
      notificationsEnabled: config.reminderDeliveryEnabled,
      notificationEndpointId: reminderEndpointId,
      decisionsEnabled: env.STUDIO_DECISIONS_ENABLED === '1' && !!env.OPENAI_API_KEY,
      ...(env.STUDIO_DECISIONS_ENABLED === '1' && env.OPENAI_API_KEY ? {
        decisions: new DecisionService(OpenAIDecisionProvider.guarded({ apiKey: env.OPENAI_API_KEY })),
      } : {}),
    });
    studio.deps.preferenceLearning = createStudioPreferenceLearning(studio);
    if ((await import('../tireh/flags')).tirehFlags().decisionLog) { const { createDecisionLogSink, createFileDecisionLogStore, FirestoreDecisionLogStore } = await import('../tireh/decisions/log'); studio.deps.decisionLog = createDecisionLogSink(config.storage === 'firestore' ? new FirestoreDecisionLogStore(await (await import('@/lib/firebase-admin')).getAdminDb()) : createFileDecisionLogStore(join(config.dataDir, 'decision-log-v1.jsonl')), { warn: (code) => console.warn(`[decision-log] ${code}`) }); }
    if (config.requestedRoutinesEnabled) {
      studio.deps.requestedRoutinesEnabled = () => process.env.STUDIO_REQUESTED_ROUTINES === '1';
      studio.deps.requestedRoutines = createStudioRequestedRoutines(studio, {
        filePath: join(config.dataDir, 'requested-routines-v1.json'), enabled: studio.deps.requestedRoutinesEnabled,
      });
    }
    if (reminderEndpointId && config.token) {
      studio.deps.reminderEndpointId = reminderEndpointId;
      studio.deps.reminderDelivery = createStudioReminderDelivery(studio, {
        enabled: true, endpointId: reminderEndpointId, botToken: config.token, webAppUrl: config.webAppUrl,
      });
    }
    // Local recognition keeps the canonical explicit enrollment/erasure path.
    // Missing model/inspection/release qualification never enables capture.
    const localVoice = await localVoiceIdentityOptions(env, { storage: config.storage === 'firestore' ? 'firestore' : 'file' });
    studio.deps.voiceIdentity = new VoiceIdentityService(storage.adaptive!, new VoiceIdentityRepository(storage.voiceIdentityStorage), localVoice.options);
    storage.adaptive!.setVoiceIdentityInvalidator(async ({ telegramId, space }) => {
      await studio.deps.voiceIdentity!.invalidate(telegramId, space);
    });
    // S11L: with STUDIO_VOICE_RECOGNITION and VOICEPRINT_KEY unset nothing is wired (base behaviour).
    const voiceprintIdentity = await import('./identity');
    const vp = voiceprintIdentity.voiceprintConfigFromEnv(localVoice.selected ? { ...env, STUDIO_VOICE_RECOGNITION: '0' } : env, { storage: config.storage === 'firestore' ? 'firestore' : 'file', production: config.production });
    if (vp) {
      const store = config.storage === 'firestore'
        ? new voiceprintIdentity.FirestoreVoiceprintStore(await (await import('@/lib/firebase-admin')).getAdminDb())
        : new voiceprintIdentity.FileVoiceprintStore(join(config.dataDir, 'voiceprints-v1.json'));
      studio.deps.voiceprints = new voiceprintIdentity.VoiceprintService({ store, cipher: vp.cipher, provider: vp.provider, thresholds: vp.thresholds,
        orgKey: studio.deps.orgName, adaptive: storage.adaptive!, flags: () => ({ voiceRecognition: vp.enabled }), echoVoices: voiceprintIdentity.echoVoicesFromStudio(studio.deps.store, studio.deps.eleven) });
      // Keeps the existing VoiceIdentityService invalidation and adds voiceprint deletion.
      storage.adaptive!.setVoiceIdentityInvalidator(voiceprintIdentity.chainVoiceInvalidators(studio.deps.voiceIdentity!, studio.deps.voiceprints));
    }
    studio.deps.observer = new AdaptiveObserverService(storage.adaptive!);
    const experimentDirectory = join(config.dataDir, 'controlled-experiments', 'v1');
    const retainedExperiments = config.storage === 'file' && !!lstatSync(join(config.dataDir, 'controlled-experiments'), { throwIfNoEntry: false });
    if (config.experimentsEnabled || retainedExperiments) {
      if (config.publicUrl || env.K_SERVICE || env.FUNCTION_TARGET || env.FUNCTION_NAME || env.VERCEL === '1') {
        throw new Error('Retained experiments require a persistent local lifecycle owner');
      }
      // Enabling the runtime installs no experiment. A separately reviewed,
      // versioned operator configuration is required before any assignment.
      studio.deps.experiments = new StudioExperimentRuntime(
        new ControlledExperimentService(new FileExperimentStorage(experimentDirectory)),
        storage.adaptive!, storage.store, Date.now, config.experimentsEnabled,
      );
      storage.adaptive!.setExperimentLifecycleReconciler(async telegramId => {
        studio.deps.experiments!.reconcileAccount(telegramId);
      });
    }
    studio.deps.lifecycle = new AdaptiveLifecycleService(storage.adaptive!, { shared: studio.deps.shared,
      ...(studio.deps.experiments ? { prepareExperimentExport: (telegramId: number, space: 'work' | 'personal') =>
        studio.deps.experiments!.prepareScopeExport(telegramId, space) } : {}),
    });
    // RI1 supports one persistent process only. The ledger stays separate from
    // both canonical adapters; missing reviewed policy/key leaves intake disabled.
    if (config.storage === 'file' && !config.publicUrl && !env.K_SERVICE && !env.FUNCTION_TARGET && !env.FUNCTION_NAME && env.VERCEL !== '1') {
      const encodedKey = env.STUDIO_RIGHTS_KEY_BASE64;
      const key = encodedKey && /^[A-Za-z0-9+/]{43}=$/.test(encodedKey) ? Buffer.from(encodedKey, 'base64') : undefined;
      studio.deps.rights = new RightsIntakeService(new RightsRepository(new RightsFileStorage(join(config.dataDir, 'rights-intake', 'v1'))), {
        policy: () => parseRightsPolicy(process.env.STUDIO_RIGHTS_POLICY_JSON), key, localUse: new RightsUseHoldService(storage.adaptive!), localErasure: studio.deps.lifecycle,
        assertPrivateMemoryNow: id => assertRightsAccountNow(studio,id,'export'),
        assertAccountNow: id => assertRightsAccountNow(studio, id),
        assertOperatorNow: id => assertRightsAccountNow(studio, id, 'operator'),
        prepareExport: async (id, space) => {
          assertRightsAccountNow(studio, id, 'export');
          const prepared = await studio.deps.lifecycle!.prepareAccountExport(id, space);
          return { data: prepared.data, revalidate: () => { assertRightsAccountNow(studio, id, 'export'); prepared.revalidate(); } };
        },
      });
    }
    // Keep protective clear/disable commands available when capture is switched off.
    if (config.storage === 'file' && config.adaptiveFormat === 'file') studio.deps.telegramArchive = new StudioTelegramArchive(studio, () => process.env.STUDIO_TELEGRAM_ARCHIVE === '1');
    // Composed while off so retained enrollments cannot fall back to legacy and
    // protective edits remain keyless. Never creates a marker/account on boot.
    if(config.storage==='file'&&config.adaptiveFormat==='file'){
      const assistantClock=memoryTime?qualifiedMemoryClock(memoryTime):undefined;
      // Marked runtime dispatch, control retention and retired-key expiry share
      // the admitted upper bound; the initial config parse grants no authority.
      const assistantKeys=assistantClock?parseAssistantTextKeys(env.STUDIO_ASSISTANT_TEXT_KEYS_JSON,assistantClock(),assistantClock):config.assistantTextKeys;
      studio.deps.assistantText=new StudioAssistantTextIntegration(studio,{
        enabled:()=>config.assistantTextEnabled&&env.STUDIO_ASSISTANT_TEXT_DELIVERY==='1',keys:assistantKeys,
        ...(assistantClock?{now:assistantClock}:{}),
      });
    }
    if(config.storage==='file'&&config.adaptiveFormat==='file')studio.deps.memoryAccount=new StudioMemoryAccount(studio,memoryTime?{time:memoryTime,managerToken:()=>{const current=process.env.VOXX_BOT_TOKEN??'';return current===config.token?current:'';}}:{});
    studio.deps.maintenanceHealth = () => readMaintenanceHealth(storage.maintenanceStorage);
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
    g.__voxAdaptiveClose = storage.closeAdaptive;
    if (storage.closeAdaptive && !g.__voxAdaptiveExitHook) {
      g.__voxAdaptiveExitHook = true;
      process.once('exit', () => { g.__voxAdaptiveClose?.(); });
    }
    return studio;
  } catch (error) {
    if (initialManagerMetadataFailure && fileRuntimeOwner) {
      // Only the completed initial store check and read-only getMe probe ran.
      // No Studio, invalidators, providers or task graph has been published.
      // Keep the same healthy epoch for a corrected credential retry; cleanup
      // failure or an actual loss/drain remains terminal, with no reacquisition.
      try { storage.closeAdaptive?.(); fileRuntimeOwner.assertCurrent(); }
      catch (cleanupError) { fileRuntimeOwner.beginDrain(); throw cleanupError; }
    } else { fileRuntimeOwner?.beginDrain(); storage.closeAdaptive?.(); }
    throw error;
  }
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
    g.__voxStudio = create().then(async studio => {
      try {
        await g.__voxPreferenceTasks?.tasks.close();
        g.__voxPreferenceTasks = studio.deps.preferenceLearning;
        if (!g.__voxPreferenceHooks) {
          g.__voxPreferenceHooks = true;
          const stop = () => { void stopStudioRuntime(); };
          studio.deps.fileRuntimeOwner?.onDrain(() => stopStudioRuntime());
          process.once('SIGTERM', stop); process.once('SIGINT', stop);
        }
        return studio;
      } catch (error) { g.__voxAdaptiveClose?.(); g.__voxAdaptiveClose = undefined; throw error; }
    }).catch((e) => {
      g.__voxStudio = undefined;
      throw e;
    });
  }
  return g.__voxStudio.then(studio => { studio.deps.fileRuntimeOwner?.assertCurrent(); return studio; });
}

export function registerStudioBotRuntime(runtime:{stop():Promise<{pending:number}>}):void { g.__voxBotRuntime=runtime; }
export function stopStudioRuntime():Promise<{pending:number}> {
  if(g.__voxRuntimeStop)return g.__voxRuntimeStop;
  // Publish the promise before invoking callbacks that can synchronously re-enter onDrain.
  g.__voxRuntimeStop=Promise.resolve().then(async()=>{
    const studio=await g.__voxStudio?.catch(()=>undefined);
    studio?.deps.fileRuntimeOwner?.beginDrain();
    return g.__voxBotRuntime?.stop() ?? stopStudioPreferenceLearning();
  });
  g.__voxFileRuntimeOwner?.beginDrain();
  return g.__voxRuntimeStop;
}
