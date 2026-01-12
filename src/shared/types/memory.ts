/**
 * Memory Types for Context Engineering
 *
 * Schema Structure:
 * users/{userId}/contactMemories/{contactId}
 *   ├── facts[] (semantic memory - learned facts about user)
 *   ├── sessions[] (episodic memory - conversation summaries)
 *   └── lastInteraction (continuation context)
 */

// ============================================
// MEMORY FACT (Semantic Memory)
// ============================================

/**
 * A fact learned about the user from conversations
 * Examples: "user's name is John", "user is learning Spanish for a trip"
 */
export interface MemoryFact {
  key: string;            // Identifier, e.g., "user_name", "learning_goal"
  value: string;          // The actual fact
  source: 'chat' | 'call';
  confidence: number;     // 0-1, how confident we are in this fact
  extractedAt: Date;
}

// ============================================
// SESSION SUMMARY (Episodic Memory)
// ============================================

/**
 * Summary of a conversation session (chat or call)
 */
export interface SessionSummary {
  id: string;
  date: Date;
  type: 'chat' | 'call';
  duration?: number;        // Duration in seconds (for calls)
  messageCount?: number;    // Number of messages (for chats)
  summary: string;          // AI-generated summary of the session
  keyTopics: string[];      // Main topics discussed
  userMood?: string;        // Detected user mood/sentiment
}

// ============================================
// LAST INTERACTION (Continuation Context)
// ============================================

/**
 * Context about where the conversation left off
 * Used for "picking up where we left off"
 */
export interface LastInteraction {
  date: Date;
  type: 'chat' | 'call';
  lastTopic: string;        // What was being discussed
  nextSteps?: string;       // What was planned for next time
}

// ============================================
// CONTACT MEMORY (Main Document)
// ============================================

/**
 * Complete memory document for a contact
 * Stored at: users/{userId}/contactMemories/{contactId}
 */
export interface ContactMemory {
  contactId: string;
  userId: string;

  // Semantic memory - facts about the user
  facts: MemoryFact[];

  // Episodic memory - session summaries
  sessions: SessionSummary[];

  // Continuation context
  lastInteraction: LastInteraction | null;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// API REQUEST/RESPONSE TYPES
// ============================================

/**
 * Request to extract memories from a conversation
 */
export interface ExtractMemoryRequest {
  contactId: string;
  messages: {
    role: 'user' | 'assistant' | 'agent';
    content: string;
    timestamp?: number;
  }[];
  type: 'chat' | 'call';
  duration?: number;        // For calls, duration in seconds
}

/**
 * Response from memory extraction
 */
export interface ExtractMemoryResponse {
  facts: Omit<MemoryFact, 'extractedAt'>[];
  session: Omit<SessionSummary, 'id' | 'date'>;
  lastInteraction: Omit<LastInteraction, 'date'>;
}

/**
 * Request to get memory context for a contact
 */
export interface GetMemoryContextRequest {
  contactId: string;
  maxFacts?: number;        // Limit number of facts (default: 10)
  maxSessions?: number;     // Limit number of sessions (default: 3)
}

/**
 * Memory context formatted for injection into prompts
 */
export interface MemoryContext {
  // Formatted string for system prompt injection
  contextString: string;

  // Raw data for other uses
  facts: MemoryFact[];
  recentSessions: SessionSummary[];
  lastInteraction: LastInteraction | null;

  // Stats
  totalSessions: number;
  totalFacts: number;
}

// ============================================
// MEMORY EXTRACTION RESULT (Internal)
// ============================================

/**
 * Result from LLM memory extraction
 */
export interface MemoryExtractionResult {
  facts: {
    key: string;
    value: string;
    confidence: number;
  }[];
  summary: string;
  keyTopics: string[];
  lastTopic: string;
  nextSteps?: string;
  userMood?: string;
}
