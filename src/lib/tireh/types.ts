/**
 * TIREH shared personas — core domain types
 *
 * A persona (e.g. Aria, product lead) is ONE identity for the whole
 * organization: same name, voice and personality for everyone. Each person
 * builds their own private relationship memory with her, groups and projects
 * build shared memory, and visibility rules decide what she may use in any
 * given conversation.
 */

// ============================================
// ORGANIZATION
// ============================================

export interface Person {
  id: string;                 // stable internal id, e.g. "reza"
  name: string;               // display name
  role: string;               // e.g. "HOOR / Super Admin", "Executive"
  telegramUserId?: number;    // Telegram account that authenticates this person
  managerId?: string;         // primary reporting parent (person id)
  companyIds: string[];
  projectIds: string[];
  notes?: string;             // short public profile line
  /** Someone outside the organization talking to a public persona. Sees only
   *  their own private memories and the groups they are in. */
  guest?: boolean;
}

/** Non-reporting relationships, e.g. "co-founders", "siblings" */
export interface Relationship {
  a: string;                  // person id
  b: string;                  // person id
  label: string;              // human readable, e.g. "co-founders"
}

export interface Company {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  name: string;
  companyId: string;
  memberIds: string[];        // person ids
  description?: string;
}

/** A Telegram group registered with TIREH. Unregistered groups are refused. */
export interface Group {
  audienceEpoch?: number;
  id: string;                 // internal id, e.g. "gameend-team"
  name: string;
  telegramChatId: number;
  memberIds: string[];        // everyone who can read the group
  projectId?: string;         // related project; sharing still requires explicit approval
  companyId?: string;
  /** People outside the organization can read this group: only its own memories are usable */
  hasGuests?: boolean;
  /** Only these invited agents may observe this group (legacy config may omit). */
  agentIds?: string[];
  /** Who sees group-scoped history from before they joined. Default since_membership; only an explicit, audited admin re-snapshot widens. */
  historyPolicy?: 'since_membership' | 'all_authorized_history';
}

export type GroupParticipation = 'mentions' | 'balanced' | 'active';

export interface PersonaVoice {
  elevenLabsVoiceId: string;
  description: string;        // provider-independent description (accent, pace…)
}

export interface Persona {
  id: string;                 // e.g. "aria"
  name: string;               // e.g. "Aria"
  role: string;               // e.g. "Product Lead"
  personality: string;
  communicationStyle: string;
  values: string[];
  voice: PersonaVoice;
  ownerId: string;            // accountable human (reporting parent)
  telegramUsername?: string;  // bot username without "@"
  telegramId?: number;
  groupParticipation?: GroupParticipation;
  groupRemember?: boolean;
  groupObservation?: boolean;
  identityVersion: number;    // bump only via an approved, versioned change
  replyWithVoice: 'never' | 'mirror' | 'always';
  /** How this persona treats people outside the organization (public personas) */
  strangerPolicy?: string;
  /** May search the web for live information (news, prices, weather, scores) */
  webSearch?: boolean;
  /**
   * Who they are and how they talk, already rendered (background, habits,
   * opinions, trade-offs). When absent the prompt falls back to
   * personality / communicationStyle / values.
   */
  character?: string;
  /** Role knowledge and skill playbooks, already rendered; stable per agent version. */
  craft?: string;
  /**
   * The same craft split for per-message skill selection (docs/SKILL_ROUTING.md),
   * already rendered. Present only when there are at least two routable skills;
   * turns without a selection keep using `craft` in full.
   */
  skillSet?: PersonaSkillSet;
  /** Short exchanges in the persona's own voice: style examples, never memories. */
  voiceExamples?: Array<{ user: string; reply: string }>;
}

export interface PersonaSkillSet {
  /** The rendered role block (may be empty for an agent with skills but no role). */
  role: string;
  /** Safety, scope and referral playbooks: always in the prompt, never offered to selection. */
  pinned: Array<{ id: string; playbook: string }>;
  /** Playbooks selection may choose between, best kept first; at most MAX_ROUTABLE_SKILLS. */
  routable: Array<{ id: string; title: string; whenToUse: string; playbook: string }>;
}

export interface OrgConfig {
  organization: { id: string; name: string };
  people: Person[];
  relationships: Relationship[];
  companies: Company[];
  projects: Project[];
  groups: Group[];
  personas: Persona[];
}

// ============================================
// MEMORY
// ============================================

/**
 * Who may see a memory.
 *  - private:  only that person (their relationship with the persona)
 *  - group:    members of a registered Telegram group
 *  - project:  project members
 *  - company:  company members
 *  - org:      everyone in the organization
 */
export type MemoryScope =
  | { kind: 'private'; personId: string }
  | { kind: 'people'; personIds: string[] }
  | { kind: 'group'; groupId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'company'; companyId: string }
  | { kind: 'org' };

export type MemoryType = 'fact' | 'decision' | 'preference' | 'event' | 'relationship';

/** personal = about someone's private life; never leaves private scope */
export type MemorySensitivity = 'normal' | 'personal' | 'confidential';
export type MemorySpace = 'work' | 'personal';
export type MemoryStatus = 'asserted' | 'inferred' | 'confirmed' | 'disputed';

export interface MemorySource {
  /** Opaque source event lineage; never source text. */
  eventIds?: string[];
  /** Context dependencies, distinct from this record's own source events. */
  derivedFromEventIds?: string[];
  personId: string;           // who said it
  chatKind: 'private' | 'group';
  groupId?: string;
  telegramMessageId?: number;
  at: Date;
}

export interface MemoryRecord {
  id: string;
  personaId: string;
  /** Historical recipients fixed at explicit authorization; absence denotes legacy data. */
  authorizedPersonIds?: string[];
  content: string;
  type: MemoryType;
  scope: MemoryScope;
  /** Audience at creation/explicit sharing. Membership changes never widen it. */
  /** Changes on every explicit sharing mutation, invalidating old offers. */
  shareVersion?: number;
  sensitivity: MemorySensitivity;
  source: MemorySource;
  aboutPersonIds: string[];   // whom the memory is about
  topic?: string;             // short key used to detect conflicts
  supersedes?: string;        // id of an older memory this replaces
  supersededBy?: string;
  confidence: number;         // 0-1
  /** v2 (all optional on read; legacy rows load with memoryV2() defaults). */
  space?: MemorySpace;            // default 'work'
  status?: MemoryStatus;          // default 'asserted'
  validFrom?: Date;               // default source.at
  invalidatedAt?: Date;           // set with invalidatedBy by an UPDATE; never a hard delete
  invalidatedBy?: string;         // id of the replacing record
  importance?: number;            // integer 1-10; default decision 7, preference 6, otherwise 5
  lastRetrievedAt?: Date;         // default undefined (treated as updatedAt)
  retrievalCount?: number;        // default 0
  expiresAt?: Date;               // v2 retrieval skips expiresAt <= now
  reviewAfter?: Date;
  subjectConfirmed?: boolean;     // default false
  contentHash?: string;           // sha256 hex of content.normalize('NFKC').trim()
  embedding?: number[];           // only when sensitivity === 'normal'; Firestore stores FieldValue.vector()
  embeddingModel?: string;        // 'text-embedding-3-small'
  embeddingVersion?: number;      // EMBEDDING_VERSION = 1
  createdAt: Date;
  updatedAt: Date;
}

/** A private work memory the persona offered to share more widely */
export interface ShareOffer {
  id: string;
  personaId: string;
  memoryId: string;
  ownerPersonId: string;      // only this person may approve
  proposedScope: MemoryScope;
  /** Exact audience previewed when the offer was created. */
  proposedAudiencePersonIds?: string[];
  memoryShareVersion?: number;
  status: 'pending' | 'approved' | 'declined';
  createdAt: Date;
}

// ============================================
// CONVERSATION
// ============================================

export interface ChatMessage {
  /** Server-created boundary stamp. Unstamped legacy rows are never replayed. */
  privacy?: { policyKey: string; memoryRevision: number; sourceEventIds: string[]; memoryIds: string[] };
  role: 'user' | 'assistant';
  personId?: string;          // set for user messages
  text: string;
  at: Date;
  telegramMessageId?: number;
  /** Group context collected under the group-only memory policy. */
  groupPolicyVersion?: 1;
  /** Delivered follow-up correlation; never model authority. */
  relationshipIntentionId?: string;
  audiencePersonIds?: string[];
  privacyEpoch?: number;
  /** Addressing result captured with Telegram entity/reply metadata intact. */
  groupOtherTarget?: boolean;
  /**
   * S12 retention verdict for both rows of an image turn (STUDIO_IMAGES only;
   * absent otherwise). Content-free. `suppressed` rows never reach memory
   * extraction on that turn or any later one; while a `people` row is in the
   * extraction window, extraction carries the image people rule.
   */
  imageDerived?: { suppressed: boolean; people: boolean };
}

/** Where a conversation happens and who can read it */
export type ChatContext =
  | { kind: 'private'; chatKey: string; personId: string }
  | { kind: 'group'; chatKey: string; group: Group };
