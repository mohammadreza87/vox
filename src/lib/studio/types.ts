/**
 * Vox Studio — domain types.
 *
 * Studio is the Telegram Mini App inside @VoxxBot where HOOR members create
 * ("spawn") AI agents with Claude, give them a voice (ElevenLabs) and an avatar
 * (OpenAI images), publish them as real Telegram bots (managed bots), and run
 * the organization: roles, a 7-day forming period, permanent personality lock,
 * fire & re-hire.
 */

import type { AgentGrowth } from '../pet/growth';

export type Role = 'owner' | 'superadmin' | 'admin' | 'member' | 'pending';

export interface GroupBehavior {
  participation: 'mentions' | 'balanced' | 'active';
  remember: boolean;
}

export interface Member {
  /** Monotonic source authority; absent legacy value is zero. */
  learningAuthorityRevision?: number;
  telegramId: number;
  name: string;
  username?: string;
  role: Role;
  joinedAt: string;
  approvedBy?: number;
}

export type Presentation = 'feminine' | 'masculine' | 'neutral';
export type CloudFamily = 'puff' | 'tower' | 'drift';
export type Hue = 'apricot' | 'rose' | 'butter' | 'matcha' | 'lagoon' | 'sky' | 'lilac' | 'ash';

export const HUES: Hue[] = ['apricot', 'rose', 'butter', 'matcha', 'lagoon', 'sky', 'lilac', 'ash'];

/** What Claude drafts and the creator refines during the forming period. */
export interface PersonaSpec {
  name: string;
  role: string;
  tagline: string;
  backstory: string;
  personality: string;
  communicationStyle: string;
  values: string[];
  expertise: string[];
  wontDo: string;
  languages: string[];
  culture: string;
  presentation: Presentation;
  age: string;
  accent: string;
  /** Description fed to ElevenLabs Voice Design */
  voiceBrief: string;
  /** Legacy free-text avatar hint; no longer requested or read (portraits use the look's accessory) */
  avatarHint: string;
  /** How they treat people outside the org when public: what they share, when they stop */
  withStrangers?: string;
  /** 0 (guarded) … 100 (chatty with anyone): how readily they engage strangers */
  openness?: number;
  /** Library role this agent was built from (skills/catalog.ts); absent for custom agents. */
  roleId?: string;
  /** Library skills the agent carries, at most MAX_AGENT_SKILLS; rendered into its system prompt. */
  skillIds?: string[];
  /** Two or three short exchanges in the agent's own voice; few-shot style anchors for replies. */
  voiceExamples?: VoiceExample[];
  /** Two to four positions they hold about their field, each with a reason. */
  opinions?: string[];
  /** Habits that make them useful in a conversation (not catchphrases). */
  signatureMoves?: string[];
  /** Small things that bother them at work, said with good humour. */
  petPeeves?: string[];
}

export interface VoiceExample {
  user: string;
  reply: string;
}

/** Optional inputs to the spawn brief; Claude fills the gaps. */
export interface SpawnBrief {
  description?: string;
  presentation?: Presentation;
  age?: string;
  culture?: string;
  languages?: string[];
  accent?: string;
  domain?: string;
  role?: string;
  /** 0..100 sliders; send only the ones the creator moved */
  traits?: { warmDirect?: number; playfulSerious?: number; conciseExpansive?: number };
  /** Library role picked or accepted by the creator (validated against the catalog). */
  roleId?: string;
  /** Skills the creator kept on; defaults to the role's skills. */
  skillIds?: string[];
  /** How the role was chosen, content-free, for diagnostics. */
  routing?: { source: 'decisions' | 'local' | 'picked' | 'successor'; confidence?: number };
}

export interface CloudFeatures {
  cheeks: boolean;
  lashes: boolean;
  brows: boolean;
}

/**
 * How an agent looks. The live cloud character (hue, family, features) always
 * exists and animates in calls; `avatar` is the still image used as the
 * Telegram profile photo and in lists — generated with OpenAI or uploaded.
 */
export interface AgentLook {
  hue: Hue;
  family: CloudFamily;
  features: CloudFeatures;
  /** Character v2 (all optional so legacy looks render unchanged). Default 'cloud'. */
  species?: CloudSpecies;
  /** Default 'none' */
  hair?: HairStyle;
  /** Default 'deep' */
  hairTone?: HairTone;
  /** Default 'none' */
  accessory?: Accessory;
  /** Default per accessory */
  accent?: AccentColor;
  /** Media file name under the studio data dir, served by /api/studio/media/[file] */
  avatar?: string;
  avatarSource?: 'generated' | 'custom';
  avatarVariants?: string[];
  /** Per generated variant: lookKey() of the look it was drawn from */
  avatarLooks?: Record<string, string>;
  /** Per generated variant: how it was drawn (reference edit or text-only fallback), for portrait QA */
  avatarVia?: Record<string, 'edit' | 'text'>;
}

export type CloudSpecies = 'cloud' | 'cat' | 'dog' | 'bunny' | 'bear' | 'owl' | 'chick';
export type HairStyle = 'none' | 'tuft' | 'fringe' | 'bun' | 'curls' | 'spiky' | 'pony';
export type HairTone = 'deep' | 'cream' | 'cocoa' | 'ink' | Hue;
export type Accessory = 'none' | 'glasses' | 'specs' | 'beret' | 'cap' | 'beanie' | 'headphones'
  | 'headset' | 'bow' | 'flower' | 'star' | 'bowtie';
export type AccentColor = 'ink' | 'cream' | 'volt' | 'coral' | 'navy' | 'berry' | 'cocoa' | Hue;
/** Forming stage of the progressive face: 1 wisp · 2 puff · 3 shaped · 4 formed */
export type Stage = 1 | 2 | 3 | 4;

/** The fields that define how the character looks (no photo fields). */
export type CharacterLook = Pick<AgentLook, 'hue' | 'family' | 'features' | 'species' | 'hair' | 'hairTone' | 'accessory' | 'accent'>;
export type LookPatch = Partial<CharacterLook>;

export interface AgentVoice {
  provider: 'elevenlabs';
  voiceId: string;
  label: string;
  source: 'design' | 'library' | 'default';
  /** What the person picked when voiceId is the account's own copy: the library voice id or the Voice Design preview id */
  sourceId?: string;
  /**
   * The agent's Gemini voice (design §8A.3, open decision 16: the provider is chosen per agent at hire). Used when the
   * server speaks through Gemini (STUDIO_TTS_PROVIDER=gemini): a prebuilt voice name from Google's list and an optional
   * natural-language style note. Absent: STUDIO_GEMINI_TTS_VOICE (default Achird) with the persona's voice brief as style.
   * An ElevenLabs voice id is never reused by Gemini, and no person's voice is ever replicated (PRIV-025).
   */
  gemini?: { voiceName: string; style?: string };
}

export type AgentStatus = 'draft' | 'awaiting_bot' | 'active' | 'fired';

export type MemoryPolicy = 'transfer' | 'archive' | 'delete';

/** Durable delivery state; old agents without a receipt are reconciled on startup. */
export interface TelegramProfileSync {
  fingerprint: string;
  status: 'pending' | 'synced' | 'error';
  failed: string[];
  attempts: number;
  updatedAt: string;
  retryAt?: string;
  /** Hash of each step's desired value at its last success; absent on legacy receipts */
  steps?: Partial<Record<ProfileStep, string>>;
}

export type ProfileStep = 'webhook' | 'name' | 'photo' | 'short description' | 'description' | 'commands' | 'menu' | 'token' | 'profile' | 'inactive';

export interface Agent {
  /** Monotonic source authority; never decrement or restore. */
  learningAuthorityRevision?: number;
  id: string;
  status: AgentStatus;
  persona: PersonaSpec;
  look: AgentLook;
  voice?: AgentVoice;
  /**
   * Growth moments (design §4.11): definitions only, drafted at spawn (persona.ts) or the role family's default set,
   * editable by the creator while forming and fixed after lockAt. Absent on agents hired before growth existed (the pet
   * shows the default set). Kept under about 6 KB (open decision 15). Lit records live in `studio_pet_growth/{agentId}`.
   */
  growth?: AgentGrowth;
  /** Draft voice previews from Voice Design, kept until one is chosen */
  voicePreviews?: Array<{ generatedVoiceId: string; file: string }>;
  createdBy: number;
  createdAt: string;
  /** Set when the Telegram bot exists; starts the 7-day forming period */
  hiredAt?: string;
  lockAt?: string;
  bot?: { id: number; username: string };
  profileSync?: TelegramProfileSync;
  /** Automatic profile pushes wait until then: the look editor is open and pushes once on close (stored so every instance sees it) */
  profileHeldUntil?: string;
  /** Next portrait mood, reserved in the store so parallel single-portrait requests on any instance differ */
  portraitSeq?: number;
  /** AES-GCM encrypted bot token */
  tokenEnc?: string;
  suggestedUsername?: string;
  isAdmin: boolean;
  /**
   * Who can talk to the agent in direct messages (groups it was added to are
   * always open to their members):
   *  private  creator, the allow-list in `access`, and admins (default)
   *  org      every approved member
   *  public   anyone on Telegram; the agent decides how to treat strangers
   * Missing on older agents: derived from `access`.
   */
  visibility?: AgentVisibility;
  /** Allow-list of Telegram ids for private agents ('everyone' on older agents) */
  access: 'everyone' | number[];
  /** Telegram ids this agent stopped talking to */
  blocked?: number[];
  identityVersion: number;
  /** Searches the web for live information when it helps (missing = on) */
  liveWeb?: boolean;
  /**
   * Circles S4: the owner set this bot's Main Mini App in BotFather, so its group cards open the pet with
   * `t.me/<bot>?startapp=` (verified with this agent's token). Missing = the manager bot's route, or the DM hop.
   */
  mainMiniApp?: boolean;
  groupBehavior?: GroupBehavior;
  successorOf?: string;
  firedAt?: string;
  firedBy?: number;
  firedReason?: string;
  memoryPolicy?: MemoryPolicy;
}

export type AgentVisibility = 'private' | 'org' | 'public';

/** Someone outside the org who talked to a public agent or shares a group with one. */
export interface Guest {
  telegramId: number;
  name: string;
  username?: string;
  firstSeen: string;
}

export interface StudioGroup {
  chatId: number;
  title: string;
  /** Telegram ids of HOOR members seen in or added to this group */
  memberIds: number[];
  /** True when the chat has more members than the HOOR people we know of */
  hasGuests: boolean;
  /** Monotonic audience epoch; leave/rejoin must not restore old sharing rights. */
  audienceEpoch?: number;
  agentIds: string[];
  /** Declared history policy; absent = since_membership. Never widens a record by itself. */
  historyPolicy?: 'since_membership' | 'all_authorized_history';
  addedBy?: number;
  addedAt: string;
  /** Content-free throttle shared by all agents in this group. */
  proactive?: { lastAt: string; messageId: number; windowAt: string; count: number };
  /** Retired ID floor per agent; legacy max-watermarks stay permanently denied. */
  memoryWatermarks?: Record<string, number>;
  /** Claimed IDs above the floor, bounded to the most recent 256-message-ID range. */
  memoryClaims?: Record<string, number[]>;
  /** Circles (later slices): absent = 'group'. */
  kind?: 'group' | 'channel';
  /** 22 random base64url chars, rotatable; a routing hint only, never authority. */
  joinCode?: string;
  /** Denormalized, fail-closed hint; the circle document is authoritative. */
  circle?: { enabled: boolean; revision: string; card?: { agentId: string; messageId: number; editedAt?: string } };
}

/** A person's choice for one agent (Circles S1): what the agent DM card offered and what they tapped.
 * Kept outside StudioState, one record per (agent, person): circles/choice-store.ts. */
export type JoinChoice = 'joined' | 'reply_only' | 'declined';
export type JoinSurface = 'dm_card' | 'group_card' | 'mini_app';

/** What was shown, captured when shown (PRIV-010/012). */
export interface JoinNotice {
  id: string;
  version: string;
  /** sha256 of the exact rendered text plus button labels */
  copyHash: string;
  locale: 'en' | 'fa';
  presentedAt: string;
}

export interface AgentJoin {
  agentId: string;
  telegramId: number;
  choice: JoinChoice;
  notice: JoinNotice;
  /** Always later than notice.presentedAt */
  decidedAt: string;
  surface: JoinSurface;
  /** Monotonic per (agent, person); bumps on every decision */
  revision: number;
  /** callback_query.id or a server id */
  eventId: string;
  receiptId?: string;
  /** Set only on Join (PRIV-004) */
  adultDeclaredAt?: string;
}

/** A card shown to one person; its callbacks are honoured only for that person, once, until expiry. */
export interface JoinReceipt {
  id: string;
  agentId: string;
  telegramId: number;
  surface: JoinSurface;
  notice: JoinNotice;
  /** The group a j_ link resolved to, after a membership check */
  chatId?: number;
  expiresAt: string;
  consumedAt?: string;
}

export interface AuditEntry {
  at: string;
  actor: number | string;
  action: string;
  target?: string;
  detail?: string;
}

export interface StudioState {
  members: Member[];
  agents: Agent[];
  groups: StudioGroup[];
  audit: AuditEntry[];
  guests?: Guest[];
  /** Daily message counts for guests: key `${agentId}:${telegramId}` */
  guestUsage?: Record<string, { day: string; count: number }>;
  /** The shared ElevenLabs agent behind live calls (created on first call) */
  voiceAgent?: { id: string; llmUrl: string; secretId: string; keyId?: string; version: number };
}

export const FORMING_DAYS = 7;
