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
  id: string;                 // internal id, e.g. "gameend-team"
  name: string;
  telegramChatId: number;
  memberIds: string[];        // everyone who can read the group
  projectId?: string;         // decisions here become project memory
  companyId?: string;
  /** People outside the organization can read this group: only its own memories are usable */
  hasGuests?: boolean;
}

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
  identityVersion: number;    // bump only via an approved, versioned change
  replyWithVoice: 'never' | 'mirror' | 'always';
  /** How this persona treats people outside the organization (public personas) */
  strangerPolicy?: string;
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
  | { kind: 'group'; groupId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'company'; companyId: string }
  | { kind: 'org' };

export type MemoryType = 'fact' | 'decision' | 'preference' | 'event' | 'relationship';

/** personal = about someone's private life; never leaves private scope */
export type MemorySensitivity = 'normal' | 'personal' | 'confidential';

export interface MemorySource {
  personId: string;           // who said it
  chatKind: 'private' | 'group';
  groupId?: string;
  telegramMessageId?: number;
  at: Date;
}

export interface MemoryRecord {
  id: string;
  personaId: string;
  content: string;
  type: MemoryType;
  scope: MemoryScope;
  sensitivity: MemorySensitivity;
  source: MemorySource;
  aboutPersonIds: string[];   // whom the memory is about
  topic?: string;             // short key used to detect conflicts
  supersedes?: string;        // id of an older memory this replaces
  supersededBy?: string;
  confidence: number;         // 0-1
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
  status: 'pending' | 'approved' | 'declined';
  createdAt: Date;
}

// ============================================
// CONVERSATION
// ============================================

export interface ChatMessage {
  role: 'user' | 'assistant';
  personId?: string;          // set for user messages
  text: string;
  at: Date;
  telegramMessageId?: number;
}

/** Where a conversation happens and who can read it */
export type ChatContext =
  | { kind: 'private'; chatKey: string; personId: string }
  | { kind: 'group'; chatKey: string; group: Group };
