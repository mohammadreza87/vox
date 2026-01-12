/**
 * Firestore Memory Repository
 * Implements IMemoryRepository using Firebase Firestore
 *
 * Schema: users/{userId}/contactMemories/{contactId}
 */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  serverTimestamp,
  Timestamp,
  arrayUnion,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  ContactMemory,
  MemoryFact,
  SessionSummary,
} from '@/shared/types';
import {
  IMemoryRepository,
  SaveFactsInput,
  SaveSessionInput,
  UpdateLastInteractionInput,
} from '../interfaces/IMemoryRepository';

export class FirestoreMemoryRepository implements IMemoryRepository {
  private readonly usersCollection = 'users';
  private readonly memoriesSubcollection = 'contactMemories';

  private getDb() {
    if (!db) {
      throw new Error('Firestore is not initialized. Please check your Firebase configuration.');
    }
    return db;
  }

  private getMemoryRef(userId: string, contactId: string) {
    return doc(this.getDb(), this.usersCollection, userId, this.memoriesSubcollection, contactId);
  }

  async getMemory(userId: string, contactId: string): Promise<ContactMemory | null> {
    const memoryRef = this.getMemoryRef(userId, contactId);
    const memorySnap = await getDoc(memoryRef);

    if (!memorySnap.exists()) {
      return null;
    }

    return this.mapToContactMemory(contactId, userId, memorySnap.data());
  }

  async getMemoriesForContacts(userId: string, contactIds: string[]): Promise<Map<string, ContactMemory>> {
    const result = new Map<string, ContactMemory>();

    // Batch fetch memories for multiple contacts
    const promises = contactIds.map(async (contactId) => {
      const memory = await this.getMemory(userId, contactId);
      if (memory) {
        result.set(contactId, memory);
      }
    });

    await Promise.all(promises);
    return result;
  }

  async createMemory(userId: string, contactId: string): Promise<ContactMemory> {
    const memoryRef = this.getMemoryRef(userId, contactId);

    const initialMemory = {
      contactId,
      userId,
      facts: [],
      sessions: [],
      lastInteraction: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(memoryRef, initialMemory);

    return {
      contactId,
      userId,
      facts: [],
      sessions: [],
      lastInteraction: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async saveFacts(userId: string, contactId: string, input: SaveFactsInput): Promise<void> {
    const memoryRef = this.getMemoryRef(userId, contactId);
    const memorySnap = await getDoc(memoryRef);

    const newFacts: MemoryFact[] = input.facts.map((f) => ({
      ...f,
      extractedAt: new Date(),
    }));

    if (!memorySnap.exists()) {
      // Create new memory document with facts
      await setDoc(memoryRef, {
        contactId,
        userId,
        facts: newFacts.map((f) => ({
          ...f,
          extractedAt: Timestamp.fromDate(f.extractedAt),
        })),
        sessions: [],
        lastInteraction: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      // Merge with existing facts (update by key, add new)
      const existingData = memorySnap.data();
      const existingFacts: MemoryFact[] = (existingData.facts || []).map(this.mapToMemoryFact);

      // Create a map of existing facts by key
      const factsMap = new Map<string, MemoryFact>();
      for (const fact of existingFacts) {
        factsMap.set(fact.key, fact);
      }

      // Update or add new facts
      for (const newFact of newFacts) {
        factsMap.set(newFact.key, newFact);
      }

      // Convert back to array
      const mergedFacts = Array.from(factsMap.values());

      await updateDoc(memoryRef, {
        facts: mergedFacts.map((f) => ({
          ...f,
          extractedAt: Timestamp.fromDate(f.extractedAt),
        })),
        updatedAt: serverTimestamp(),
      });
    }
  }

  async saveSession(userId: string, contactId: string, input: SaveSessionInput): Promise<void> {
    const memoryRef = this.getMemoryRef(userId, contactId);
    const memorySnap = await getDoc(memoryRef);

    const newSession: SessionSummary = {
      id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      date: new Date(),
      type: input.type,
      duration: input.duration,
      messageCount: input.messageCount,
      summary: input.summary,
      keyTopics: input.keyTopics,
      userMood: input.userMood,
    };

    const sessionData = {
      ...newSession,
      date: Timestamp.fromDate(newSession.date),
    };

    if (!memorySnap.exists()) {
      // Create new memory document with session
      await setDoc(memoryRef, {
        contactId,
        userId,
        facts: [],
        sessions: [sessionData],
        lastInteraction: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      // Add to existing sessions
      await updateDoc(memoryRef, {
        sessions: arrayUnion(sessionData),
        updatedAt: serverTimestamp(),
      });
    }
  }

  async updateLastInteraction(userId: string, contactId: string, input: UpdateLastInteractionInput): Promise<void> {
    const memoryRef = this.getMemoryRef(userId, contactId);
    const memorySnap = await getDoc(memoryRef);

    const lastInteraction = {
      date: Timestamp.fromDate(new Date()),
      type: input.type,
      lastTopic: input.lastTopic,
      nextSteps: input.nextSteps || null,
    };

    if (!memorySnap.exists()) {
      // Create new memory document
      await setDoc(memoryRef, {
        contactId,
        userId,
        facts: [],
        sessions: [],
        lastInteraction,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(memoryRef, {
        lastInteraction,
        updatedAt: serverTimestamp(),
      });
    }
  }

  async getFacts(userId: string, contactId: string): Promise<MemoryFact[]> {
    const memory = await this.getMemory(userId, contactId);
    return memory?.facts || [];
  }

  async getSessions(userId: string, contactId: string, limit?: number): Promise<SessionSummary[]> {
    const memory = await this.getMemory(userId, contactId);
    const sessions = memory?.sessions || [];

    // Sort by date descending and apply limit
    const sorted = sessions.sort((a, b) => b.date.getTime() - a.date.getTime());
    return limit ? sorted.slice(0, limit) : sorted;
  }

  async deleteFact(userId: string, contactId: string, factKey: string): Promise<void> {
    const memoryRef = this.getMemoryRef(userId, contactId);
    const memorySnap = await getDoc(memoryRef);

    if (!memorySnap.exists()) {
      return;
    }

    const existingData = memorySnap.data();
    const existingFacts: MemoryFact[] = (existingData.facts || []).map(this.mapToMemoryFact);

    const filteredFacts = existingFacts.filter((f) => f.key !== factKey);

    await updateDoc(memoryRef, {
      facts: filteredFacts.map((f) => ({
        ...f,
        extractedAt: Timestamp.fromDate(f.extractedAt),
      })),
      updatedAt: serverTimestamp(),
    });
  }

  async clearMemory(userId: string, contactId: string): Promise<void> {
    const memoryRef = this.getMemoryRef(userId, contactId);
    const memorySnap = await getDoc(memoryRef);

    if (!memorySnap.exists()) {
      return;
    }

    await updateDoc(memoryRef, {
      facts: [],
      sessions: [],
      lastInteraction: null,
      updatedAt: serverTimestamp(),
    });
  }

  async deleteMemory(userId: string, contactId: string): Promise<void> {
    const memoryRef = this.getMemoryRef(userId, contactId);
    await deleteDoc(memoryRef);
  }

  // Helper methods

  private mapToContactMemory(
    contactId: string,
    userId: string,
    data: Record<string, unknown>
  ): ContactMemory {
    return {
      contactId,
      userId,
      facts: ((data.facts as unknown[]) || []).map(this.mapToMemoryFact),
      sessions: ((data.sessions as unknown[]) || []).map(this.mapToSessionSummary),
      lastInteraction: data.lastInteraction
        ? this.mapToLastInteraction(data.lastInteraction as Record<string, unknown>)
        : null,
      createdAt: this.toDate(data.createdAt),
      updatedAt: this.toDate(data.updatedAt),
    };
  }

  private mapToMemoryFact = (data: unknown): MemoryFact => {
    const factData = data as Record<string, unknown>;
    return {
      key: factData.key as string,
      value: factData.value as string,
      source: factData.source as 'chat' | 'call',
      confidence: (factData.confidence as number) || 1,
      extractedAt: this.toDate(factData.extractedAt),
    };
  };

  private mapToSessionSummary = (data: unknown): SessionSummary => {
    const sessionData = data as Record<string, unknown>;
    return {
      id: sessionData.id as string,
      date: this.toDate(sessionData.date),
      type: sessionData.type as 'chat' | 'call',
      duration: sessionData.duration as number | undefined,
      messageCount: sessionData.messageCount as number | undefined,
      summary: sessionData.summary as string,
      keyTopics: (sessionData.keyTopics as string[]) || [],
      userMood: sessionData.userMood as string | undefined,
    };
  };

  private mapToLastInteraction(data: Record<string, unknown>) {
    return {
      date: this.toDate(data.date),
      type: data.type as 'chat' | 'call',
      lastTopic: data.lastTopic as string,
      nextSteps: data.nextSteps as string | undefined,
    };
  }

  private toDate(value: unknown): Date {
    if (value instanceof Timestamp) {
      return value.toDate();
    }
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'string') {
      return new Date(value);
    }
    return new Date();
  }
}
