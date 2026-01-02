/**
 * User Repository Interface
 * Defines the contract for user data access operations.
 */

import { ClonedVoice, PreMadeContactConfig } from '@/shared/types';
import { UserSubscription, UsageData } from '@/shared/types/subscription';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSettings {
  theme: 'light' | 'dark';
  language: string;
  notifications: boolean;
}

export interface IUserRepository {
  /**
   * Get user profile by ID
   */
  getUser(userId: string): Promise<UserProfile | null>;

  /**
   * Create or update user profile
   */
  upsertUser(userId: string, data: Partial<UserProfile>): Promise<UserProfile>;

  /**
   * Get user settings
   */
  getSettings(userId: string): Promise<UserSettings | null>;

  /**
   * Update user settings
   */
  updateSettings(userId: string, settings: Partial<UserSettings>): Promise<void>;

  /**
   * Get user subscription
   */
  getSubscription(userId: string): Promise<UserSubscription | null>;

  /**
   * Update user subscription
   */
  updateSubscription(userId: string, subscription: Partial<UserSubscription>): Promise<void>;

  /**
   * Get usage data
   */
  getUsage(userId: string): Promise<UsageData | null>;

  /**
   * Increment message count
   */
  incrementMessageCount(userId: string): Promise<void>;

  /**
   * Get custom contacts
   */
  getCustomContacts(userId: string): Promise<PreMadeContactConfig[]>;

  /**
   * Add custom contact
   */
  addCustomContact(userId: string, contact: PreMadeContactConfig): Promise<void>;

  /**
   * Update custom contact
   */
  updateCustomContact(userId: string, contactId: string, updates: Partial<PreMadeContactConfig>): Promise<void>;

  /**
   * Delete custom contact
   */
  deleteCustomContact(userId: string, contactId: string): Promise<void>;

  /**
   * Get cloned voices
   */
  getClonedVoices(userId: string): Promise<ClonedVoice[]>;

  /**
   * Add cloned voice
   */
  addClonedVoice(userId: string, voice: ClonedVoice): Promise<void>;

  /**
   * Delete cloned voice
   */
  deleteClonedVoice(userId: string, voiceId: string): Promise<void>;

  /**
   * Set default translator voice
   */
  setDefaultTranslatorVoice(userId: string, voiceId: string | null): Promise<void>;
}
