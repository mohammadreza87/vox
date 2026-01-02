/**
 * Firestore User Repository
 * Implements IUserRepository using Firebase Firestore
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
  increment,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ClonedVoice, PreMadeContactConfig } from '@/shared/types';
import { UserSubscription, UsageData } from '@/shared/types/subscription';
import { IUserRepository, UserProfile, UserSettings } from '../interfaces/IUserRepository';
import { SUBSCRIPTION_TIERS } from '@/config/subscription';

export class FirestoreUserRepository implements IUserRepository {
  private readonly usersCollection = 'users';
  private readonly contactsSubcollection = 'customContacts';
  private readonly voicesSubcollection = 'clonedVoices';

  async getUser(userId: string): Promise<UserProfile | null> {
    const userRef = doc(db, this.usersCollection, userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      return null;
    }

    return this.mapToUserProfile(userId, userSnap.data());
  }

  async upsertUser(userId: string, data: Partial<UserProfile>): Promise<UserProfile> {
    const userRef = doc(db, this.usersCollection, userId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      await updateDoc(userRef, {
        ...data,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(userRef, {
        email: data.email || '',
        displayName: data.displayName || null,
        photoURL: data.photoURL || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        // Default subscription
        tier: 'free',
        subscription: {
          tier: 'free',
          status: 'active',
          features: SUBSCRIPTION_TIERS.free.features,
        },
        usage: {
          messagesThisMonth: 0,
          customContactsCount: 0,
          lastResetAt: new Date().toISOString(),
        },
      });
    }

    const updatedSnap = await getDoc(userRef);
    return this.mapToUserProfile(userId, updatedSnap.data()!);
  }

  async getSettings(userId: string): Promise<UserSettings | null> {
    const userRef = doc(db, this.usersCollection, userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      return null;
    }

    const data = userSnap.data();
    return {
      theme: data.settings?.theme || 'light',
      language: data.settings?.language || 'en',
      notifications: data.settings?.notifications ?? true,
    };
  }

  async updateSettings(userId: string, settings: Partial<UserSettings>): Promise<void> {
    const userRef = doc(db, this.usersCollection, userId);
    await updateDoc(userRef, {
      settings: settings,
      updatedAt: serverTimestamp(),
    });
  }

  async getSubscription(userId: string): Promise<UserSubscription | null> {
    const userRef = doc(db, this.usersCollection, userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      return null;
    }

    const data = userSnap.data();
    return data.subscription || null;
  }

  async updateSubscription(userId: string, subscription: Partial<UserSubscription>): Promise<void> {
    const userRef = doc(db, this.usersCollection, userId);
    await updateDoc(userRef, {
      subscription,
      tier: subscription.tier,
      updatedAt: serverTimestamp(),
    });
  }

  async getUsage(userId: string): Promise<UsageData | null> {
    const userRef = doc(db, this.usersCollection, userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      return null;
    }

    const data = userSnap.data();
    return data.usage || null;
  }

  async incrementMessageCount(userId: string): Promise<void> {
    const userRef = doc(db, this.usersCollection, userId);
    await updateDoc(userRef, {
      'usage.messagesThisMonth': increment(1),
      updatedAt: serverTimestamp(),
    });
  }

  async getCustomContacts(userId: string): Promise<PreMadeContactConfig[]> {
    const contactsRef = collection(db, this.usersCollection, userId, this.contactsSubcollection);
    const snapshot = await getDocs(contactsRef);

    return snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    })) as PreMadeContactConfig[];
  }

  async addCustomContact(userId: string, contact: PreMadeContactConfig): Promise<void> {
    const contactRef = doc(
      db,
      this.usersCollection,
      userId,
      this.contactsSubcollection,
      contact.id
    );

    await setDoc(contactRef, {
      ...contact,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Update contacts count
    const userRef = doc(db, this.usersCollection, userId);
    await updateDoc(userRef, {
      'usage.customContactsCount': increment(1),
    });
  }

  async updateCustomContact(
    userId: string,
    contactId: string,
    updates: Partial<PreMadeContactConfig>
  ): Promise<void> {
    const contactRef = doc(
      db,
      this.usersCollection,
      userId,
      this.contactsSubcollection,
      contactId
    );

    await updateDoc(contactRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  }

  async deleteCustomContact(userId: string, contactId: string): Promise<void> {
    const contactRef = doc(
      db,
      this.usersCollection,
      userId,
      this.contactsSubcollection,
      contactId
    );

    await deleteDoc(contactRef);

    // Update contacts count
    const userRef = doc(db, this.usersCollection, userId);
    await updateDoc(userRef, {
      'usage.customContactsCount': increment(-1),
    });
  }

  async getClonedVoices(userId: string): Promise<ClonedVoice[]> {
    const voicesRef = collection(db, this.usersCollection, userId, this.voicesSubcollection);
    const snapshot = await getDocs(voicesRef);

    return snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
      createdAt: this.toDateString(docSnap.data().createdAt),
    })) as ClonedVoice[];
  }

  async addClonedVoice(userId: string, voice: ClonedVoice): Promise<void> {
    const voiceRef = doc(
      db,
      this.usersCollection,
      userId,
      this.voicesSubcollection,
      voice.id
    );

    await setDoc(voiceRef, {
      ...voice,
      createdAt: serverTimestamp(),
    });
  }

  async deleteClonedVoice(userId: string, voiceId: string): Promise<void> {
    const voiceRef = doc(
      db,
      this.usersCollection,
      userId,
      this.voicesSubcollection,
      voiceId
    );

    await deleteDoc(voiceRef);
  }

  async setDefaultTranslatorVoice(userId: string, voiceId: string | null): Promise<void> {
    const userRef = doc(db, this.usersCollection, userId);
    await updateDoc(userRef, {
      defaultTranslatorVoiceId: voiceId,
      updatedAt: serverTimestamp(),
    });
  }

  private mapToUserProfile(id: string, data: Record<string, unknown>): UserProfile {
    return {
      id,
      email: data.email as string,
      displayName: (data.displayName as string) || null,
      photoURL: (data.photoURL as string) || null,
      createdAt: this.toDate(data.createdAt),
      updatedAt: this.toDate(data.updatedAt),
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

  private toDateString(value: unknown): string {
    return this.toDate(value).toISOString();
  }
}
