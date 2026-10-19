/**
 * Vox Studio — domain types.
 *
 * Studio is the Telegram Mini App inside @VoxxBot where HOOR members create
 * ("spawn") AI agents with Claude, give them a voice (ElevenLabs) and an avatar
 * (OpenAI images), publish them as real Telegram bots (managed bots), and run
 * the organization: roles, a 7-day forming period, permanent personality lock,
 * fire & re-hire.
 */

export type Role = 'owner' | 'superadmin' | 'admin' | 'member' | 'pending';

export interface GroupBehavior {
  participation: 'mentions' | 'balanced' | 'active';
  remember: boolean;
}

export interface Member {
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
  /** Short accessory/feature hint for the avatar, respectful of culture */
  avatarHint: string;
  /** How they treat people outside the org when public: what they share, when they stop */
  withStrangers?: string;
  /** 0 (guarded) … 100 (chatty with anyone): how readily they engage strangers */
  openness?: number;
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
  /** 0..100 sliders */
  traits?: { warmDirect?: number; playfulSerious?: number; conciseExpansive?: number };
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
  /** Media file name under the studio data dir, served by /api/studio/media/[file] */
  avatar?: string;
  avatarSource?: 'generated' | 'custom';
  avatarVariants?: string[];
}

export interface AgentVoice {
  provider: 'elevenlabs';
  voiceId: string;
  label: string;
  source: 'design' | 'library';
}

export type AgentStatus = 'draft' | 'awaiting_bot' | 'active' | 'fired';

export type MemoryPolicy = 'transfer' | 'archive' | 'delete';

export interface Agent {
  id: string;
  status: AgentStatus;
  persona: PersonaSpec;
  look: AgentLook;
  voice?: AgentVoice;
  /** Draft voice previews from Voice Design, kept until one is chosen */
  voicePreviews?: Array<{ generatedVoiceId: string; file: string }>;
  createdBy: number;
  createdAt: string;
  /** Set when the Telegram bot exists; starts the 7-day forming period */
  hiredAt?: string;
  lockAt?: string;
  bot?: { id: number; username: string };
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
  agentIds: string[];
  addedBy?: number;
  addedAt: string;
  /** Content-free throttle shared by all agents in this group. */
  proactive?: { lastAt: string; messageId: number; windowAt: string; count: number };
  /** Retired ID floor per agent; legacy max-watermarks stay permanently denied. */
  memoryWatermarks?: Record<string, number>;
  /** Claimed IDs above the floor, bounded to the most recent 256-message-ID range. */
  memoryClaims?: Record<string, number[]>;
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
