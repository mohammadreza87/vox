/**
 * Cached User Repository
 * Wraps any IUserRepository with Redis caching
 */

import { ClonedVoice, PreMadeContactConfig } from '@/shared/types';
import { UserSubscription, UsageData } from '@/shared/types/subscription';
import { IUserRepository, UserProfile, UserSettings } from '../interfaces/IUserRepository';
import {
  cacheGet,
  cacheSet,
  cacheDelete,
  CACHE_KEYS,
  CACHE_TTL,
} from '@/lib/cache';

export class CachedUserRepository implements IUserRepository {
  constructor(private readonly repository: IUserRepository) {}

  async getUser(userId: string): Promise<UserProfile | null> {
    const cacheKey = `${CACHE_KEYS.USER}${userId}`;

    const cached = await cacheGet<UserProfile>(cacheKey);
    if (cached) {
      return cached;
    }

    const user = await this.repository.getUser(userId);

    if (user) {
      await cacheSet(cacheKey, user, CACHE_TTL.LONG);
    }

    return user;
  }

  async upsertUser(userId: string, data: Partial<UserProfile>): Promise<UserProfile> {
    const user = await this.repository.upsertUser(userId, data);

    // Update cache
    await cacheSet(`${CACHE_KEYS.USER}${userId}`, user, CACHE_TTL.LONG);

    return user;
  }

  async getSettings(userId: string): Promise<UserSettings | null> {
    // Settings are not frequently accessed, delegate directly
    return this.repository.getSettings(userId);
  }

  async updateSettings(userId: string, settings: Partial<UserSettings>): Promise<void> {
    await this.repository.updateSettings(userId, settings);
  }

  async getSubscription(userId: string): Promise<UserSubscription | null> {
    const cacheKey = `${CACHE_KEYS.SUBSCRIPTION}${userId}`;

    const cached = await cacheGet<UserSubscription>(cacheKey);
    if (cached) {
      return cached;
    }

    const subscription = await this.repository.getSubscription(userId);

    if (subscription) {
      await cacheSet(cacheKey, subscription, CACHE_TTL.SUBSCRIPTION);
    }

    return subscription;
  }

  async updateSubscription(userId: string, subscription: Partial<UserSubscription>): Promise<void> {
    await this.repository.updateSubscription(userId, subscription);

    // Invalidate subscription cache
    await cacheDelete(`${CACHE_KEYS.SUBSCRIPTION}${userId}`);
  }

  async getUsage(userId: string): Promise<UsageData | null> {
    const cacheKey = `${CACHE_KEYS.USAGE}${userId}`;

    const cached = await cacheGet<UsageData>(cacheKey);
    if (cached) {
      return cached;
    }

    const usage = await this.repository.getUsage(userId);

    if (usage) {
      // Short TTL for usage as it changes frequently
      await cacheSet(cacheKey, usage, CACHE_TTL.SHORT);
    }

    return usage;
  }

  async incrementMessageCount(userId: string): Promise<void> {
    await this.repository.incrementMessageCount(userId);

    // Invalidate usage cache
    await cacheDelete(`${CACHE_KEYS.USAGE}${userId}`);
  }

  async getCustomContacts(userId: string): Promise<PreMadeContactConfig[]> {
    const cacheKey = `${CACHE_KEYS.CONTACTS}${userId}`;

    const cached = await cacheGet<PreMadeContactConfig[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const contacts = await this.repository.getCustomContacts(userId);

    await cacheSet(cacheKey, contacts, CACHE_TTL.MEDIUM);

    return contacts;
  }

  async addCustomContact(userId: string, contact: PreMadeContactConfig): Promise<void> {
    await this.repository.addCustomContact(userId, contact);

    // Invalidate contacts cache
    await cacheDelete(`${CACHE_KEYS.CONTACTS}${userId}`);
  }

  async updateCustomContact(
    userId: string,
    contactId: string,
    updates: Partial<PreMadeContactConfig>
  ): Promise<void> {
    await this.repository.updateCustomContact(userId, contactId, updates);

    // Invalidate contacts cache
    await cacheDelete(`${CACHE_KEYS.CONTACTS}${userId}`);
  }

  async deleteCustomContact(userId: string, contactId: string): Promise<void> {
    await this.repository.deleteCustomContact(userId, contactId);

    // Invalidate contacts cache
    await cacheDelete(`${CACHE_KEYS.CONTACTS}${userId}`);
  }

  async getClonedVoices(userId: string): Promise<ClonedVoice[]> {
    const cacheKey = `${CACHE_KEYS.VOICES}${userId}`;

    const cached = await cacheGet<ClonedVoice[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const voices = await this.repository.getClonedVoices(userId);

    await cacheSet(cacheKey, voices, CACHE_TTL.LONG);

    return voices;
  }

  async addClonedVoice(userId: string, voice: ClonedVoice): Promise<void> {
    await this.repository.addClonedVoice(userId, voice);

    // Invalidate voices cache
    await cacheDelete(`${CACHE_KEYS.VOICES}${userId}`);
  }

  async deleteClonedVoice(userId: string, voiceId: string): Promise<void> {
    await this.repository.deleteClonedVoice(userId, voiceId);

    // Invalidate voices cache
    await cacheDelete(`${CACHE_KEYS.VOICES}${userId}`);
  }

  async setDefaultTranslatorVoice(userId: string, voiceId: string | null): Promise<void> {
    await this.repository.setDefaultTranslatorVoice(userId, voiceId);

    // Invalidate user cache
    await cacheDelete(`${CACHE_KEYS.USER}${userId}`);
  }
}
