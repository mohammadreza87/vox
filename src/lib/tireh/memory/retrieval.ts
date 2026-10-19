/**
 * Select the memories a persona may use in a conversation, most relevant first.
 */

import type { ChatContext, MemoryRecord } from '../types';
import type { OrgDirectory } from '../org/directory';
import { audienceOf, isVisibleInChat } from './visibility';

const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'been', 'before', 'from', 'have', 'just', 'like', 'more',
  'should', 'some', 'that', 'than', 'their', 'them', 'then', 'there', 'they', 'this', 'what',
  'when', 'where', 'which', 'will', 'with', 'would', 'your',
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 3 && !STOPWORDS.has(t))
  );
}

export interface RetrievalOptions {
  query: string;
  limit?: number;
  now?: Date;
}

export function selectMemories(
  org: OrgDirectory,
  memories: MemoryRecord[],
  chat: ChatContext,
  { query, limit = 20, now = new Date() }: RetrievalOptions
): MemoryRecord[] {
  const audience = audienceOf(chat);
  const queryTokens = tokens(query);

  const scored = memories
    .filter((m) => isVisibleInChat(org, m, chat))
    .map((memory) => {
      const memoryTokens = tokens(`${memory.content} ${memory.topic ?? ''}`);
      let overlap = 0;
      for (const t of memoryTokens) if (queryTokens.has(t)) overlap++;

      const ageDays = (now.getTime() - memory.updatedAt.getTime()) / 86_400_000;
      const recency = Math.max(0, 1 - ageDays / 90);
      const aboutAudience = memory.aboutPersonIds.some((id) => audience.includes(id)) ? 1 : 0;
      const typeBoost = memory.type === 'decision' ? 0.5 : memory.type === 'relationship' ? 0.3 : 0;

      return { memory, score: overlap * 2 + aboutAudience + recency + typeBoost + memory.confidence * 0.5 };
    });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.memory);
}

/** Groups of memories that share a topic and disagree, for the persona to surface */
export function findConflicts(memories: MemoryRecord[]): MemoryRecord[][] {
  const byTopic = new Map<string, MemoryRecord[]>();
  for (const memory of memories) {
    if (!memory.topic) continue;
    const key = memory.topic.toLowerCase().trim();
    byTopic.set(key, [...(byTopic.get(key) ?? []), memory]);
  }
  return [...byTopic.values()].filter(
    (group) => group.length > 1 && new Set(group.map((m) => m.content.trim().toLowerCase())).size > 1
  );
}
