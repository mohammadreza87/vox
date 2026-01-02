# Vox Implementation Specification

**Version**: 1.0
**Created**: January 2026
**Status**: Ready for Implementation
**Estimated Duration**: 16 weeks (4 months)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Phase 1: Foundation](#3-phase-1-foundation-weeks-1-4)
4. [Phase 2: Database & Caching](#4-phase-2-database--caching-weeks-5-8)
5. [Phase 3: Quality & Performance](#5-phase-3-quality--performance-weeks-9-12)
6. [Phase 4: Polish & Scale](#6-phase-4-polish--scale-weeks-13-16)
7. [Rollback Procedures](#7-rollback-procedures)
8. [Success Metrics](#8-success-metrics)

---

## 1. Overview

### 1.1 Goals

| Goal | Metric | Target |
|------|--------|--------|
| Scalability | Concurrent users | 10,000+ |
| Performance | API response time | <200ms p95 |
| Reliability | Uptime | 99.9% |
| Code Quality | Test coverage | >80% |
| Developer Experience | Build time | <60s |
| Cost Efficiency | Monthly infrastructure | <$500 at 1000 users |

### 1.2 Architecture Principles

1. **Single Source of Truth**: One state management solution per domain
2. **Dependency Injection**: All services injectable and testable
3. **Repository Pattern**: Data access abstracted behind interfaces
4. **Feature Modules**: Self-contained, independently deployable features
5. **Fail-Safe Migrations**: Dual-write pattern, reversible changes

### 1.3 Technology Decisions

| Layer | Current | Target | Reason |
|-------|---------|--------|--------|
| Database | Firestore | Supabase (PostgreSQL) | Better scaling, lower costs |
| Cache | None | Upstash Redis | Reduce DB reads |
| State (Server) | None | TanStack Query | Caching, deduplication |
| State (Client) | Zustand + Context | Zustand only | Simplification |
| Queue | None | BullMQ | Async processing |
| Feature Flags | None | Vercel Edge Config | Safe rollouts |

---

## 2. Prerequisites

### 2.1 Development Environment

```bash
# Required versions
node >= 20.0.0
npm >= 10.0.0
git >= 2.40.0

# Verify
node -v && npm -v && git --version
```

### 2.2 External Services Setup

#### Supabase Project
1. Create project at https://supabase.com/dashboard
2. Save credentials:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `DATABASE_URL` (PostgreSQL connection string)

#### Upstash Redis (for caching + queues)
1. Create database at https://console.upstash.com
2. Save credentials:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `REDIS_URL` (for BullMQ)

#### Vercel Edge Config (for feature flags)
1. Create Edge Config in Vercel dashboard
2. Save: `EDGE_CONFIG`

### 2.3 New Dependencies to Install

```bash
# Phase 1: Foundation
npm install awilix                    # Dependency injection
npm install @tanstack/react-query     # Server state

# Phase 2: Database & Caching
npm install @supabase/supabase-js     # Supabase client
npm install @supabase/ssr             # SSR helpers
npm install bullmq ioredis            # Job queue

# Phase 3: Quality
npm install -D husky lint-staged      # Git hooks
npm install -D prettier               # Formatting
npm install -D @next/bundle-analyzer  # Bundle analysis

# Phase 4: Feature Flags
npm install @vercel/edge-config       # Feature flags
```

### 2.4 Environment Variables

Add to `.env.local`:
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=

# Redis (additional)
REDIS_URL=

# Feature Flags
EDGE_CONFIG=

# Migration Control
MIGRATION_PHASE=firestore  # firestore | dual-write | supabase
```

---

## 3. Phase 1: Foundation (Weeks 1-4)

### Week 1: State Management Consolidation

#### 1.1.1 Audit Current State

**Files to Analyze:**
```
src/contexts/AuthContext.tsx          # 200+ lines - auth state
src/contexts/ChatContext.tsx          # 150+ lines - chat state
src/contexts/SubscriptionContext.tsx  # 100+ lines - subscription state
src/contexts/CustomContactsContext.tsx # 80+ lines - contacts state
src/contexts/ThemeContext.tsx         # 50+ lines - theme state
src/contexts/TranslatorContext.tsx    # 900+ lines - translator state

src/stores/authStore.ts               # Zustand auth
src/stores/chatStoreV2.ts             # Zustand chat
src/stores/subscriptionStore.ts       # Zustand subscription
src/stores/contactsStore.ts           # Zustand contacts
src/stores/themeStore.ts              # Zustand theme
src/stores/translatorStore.ts         # Zustand translator
```

**Overlap Analysis:**

| Domain | Context File | Store File | Resolution |
|--------|--------------|------------|------------|
| Auth | AuthContext.tsx | authStore.ts | Keep store, delete context |
| Chat | ChatContext.tsx | chatStoreV2.ts | Keep store, delete context |
| Subscription | SubscriptionContext.tsx | subscriptionStore.ts | Keep store, delete context |
| Contacts | CustomContactsContext.tsx | contactsStore.ts | Keep store, delete context |
| Theme | ThemeContext.tsx | themeStore.ts | Keep store, delete context |
| Translator | TranslatorContext.tsx | translatorStore.ts | Keep store, delete context |

#### 1.1.2 Migrate AuthContext to authStore

**File: `src/stores/authStore.ts`**

```typescript
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  onAuthStateChanged,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';

// Types
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

export interface AuthState {
  // State
  user: AuthUser | null;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;

  // Actions
  initialize: () => () => void;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  updateUserProfile: (data: { displayName?: string; photoURL?: string }) => Promise<void>;
  clearError: () => void;
}

// Helper to convert Firebase User to AuthUser
const toAuthUser = (user: User): AuthUser => ({
  uid: user.uid,
  email: user.email,
  displayName: user.displayName,
  photoURL: user.photoURL,
  emailVerified: user.emailVerified,
});

// Store
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      isLoading: true,
      isInitialized: false,
      error: null,

      // Initialize auth listener
      initialize: () => {
        const unsubscribe = onAuthStateChanged(
          auth,
          (firebaseUser) => {
            set({
              user: firebaseUser ? toAuthUser(firebaseUser) : null,
              isLoading: false,
              isInitialized: true,
            });
          },
          (error) => {
            set({
              error: error.message,
              isLoading: false,
              isInitialized: true,
            });
          }
        );
        return unsubscribe;
      },

      // Sign in with email/password
      signInWithEmail: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const result = await signInWithEmailAndPassword(auth, email, password);
          set({ user: toAuthUser(result.user), isLoading: false });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Sign in failed';
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      // Sign up with email/password
      signUpWithEmail: async (email, password, displayName) => {
        set({ isLoading: true, error: null });
        try {
          const result = await createUserWithEmailAndPassword(auth, email, password);
          if (displayName) {
            await updateProfile(result.user, { displayName });
          }
          set({ user: toAuthUser(result.user), isLoading: false });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Sign up failed';
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      // Sign in with Google
      signInWithGoogle: async () => {
        set({ isLoading: true, error: null });
        try {
          const provider = new GoogleAuthProvider();
          const result = await signInWithPopup(auth, provider);
          set({ user: toAuthUser(result.user), isLoading: false });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Google sign in failed';
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      // Sign out
      signOut: async () => {
        set({ isLoading: true, error: null });
        try {
          await firebaseSignOut(auth);
          set({ user: null, isLoading: false });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Sign out failed';
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      // Update profile
      updateUserProfile: async (data) => {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error('No authenticated user');

        set({ isLoading: true, error: null });
        try {
          await updateProfile(currentUser, data);
          set({
            user: toAuthUser(currentUser),
            isLoading: false,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Profile update failed';
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      // Clear error
      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user }),
    }
  )
);

// Selectors (for performance)
export const selectUser = (state: AuthState) => state.user;
export const selectIsAuthenticated = (state: AuthState) => !!state.user;
export const selectIsLoading = (state: AuthState) => state.isLoading;
export const selectAuthError = (state: AuthState) => state.error;

// Hook for auth initialization (use in root layout)
export function useAuthInit() {
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    const unsubscribe = initialize();
    return unsubscribe;
  }, [initialize]);
}
```

**Test File: `src/stores/__tests__/authStore.test.ts`**

```typescript
import { renderHook, act } from '@testing-library/react';
import { useAuthStore } from '../authStore';

// Mock Firebase
jest.mock('@/lib/firebase', () => ({
  auth: {
    currentUser: null,
  },
}));

jest.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  signInWithPopup: jest.fn(),
  signOut: jest.fn(),
  GoogleAuthProvider: jest.fn(),
  onAuthStateChanged: jest.fn((auth, callback) => {
    callback(null);
    return jest.fn();
  }),
  updateProfile: jest.fn(),
}));

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      isLoading: false,
      isInitialized: false,
      error: null,
    });
  });

  it('should initialize with null user', () => {
    const { result } = renderHook(() => useAuthStore());
    expect(result.current.user).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle sign in with email', async () => {
    const mockUser = {
      uid: '123',
      email: 'test@example.com',
      displayName: 'Test User',
      photoURL: null,
      emailVerified: true,
    };

    const { signInWithEmailAndPassword } = require('firebase/auth');
    signInWithEmailAndPassword.mockResolvedValue({ user: mockUser });

    const { result } = renderHook(() => useAuthStore());

    await act(async () => {
      await result.current.signInWithEmail('test@example.com', 'password');
    });

    expect(result.current.user).toEqual(expect.objectContaining({
      uid: '123',
      email: 'test@example.com',
    }));
    expect(result.current.error).toBeNull();
  });

  it('should handle sign in error', async () => {
    const { signInWithEmailAndPassword } = require('firebase/auth');
    signInWithEmailAndPassword.mockRejectedValue(new Error('Invalid credentials'));

    const { result } = renderHook(() => useAuthStore());

    await act(async () => {
      try {
        await result.current.signInWithEmail('test@example.com', 'wrong');
      } catch (e) {
        // Expected
      }
    });

    expect(result.current.user).toBeNull();
    expect(result.current.error).toBe('Invalid credentials');
  });

  it('should handle sign out', async () => {
    const { signOut } = require('firebase/auth');
    signOut.mockResolvedValue(undefined);

    useAuthStore.setState({
      user: { uid: '123', email: 'test@example.com', displayName: null, photoURL: null, emailVerified: true },
    });

    const { result } = renderHook(() => useAuthStore());

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.user).toBeNull();
  });
});
```

#### 1.1.3 Delete Context Files

**Files to Delete:**
```bash
rm src/contexts/AuthContext.tsx
rm src/contexts/ChatContext.tsx
rm src/contexts/SubscriptionContext.tsx
rm src/contexts/CustomContactsContext.tsx
rm src/contexts/ThemeContext.tsx
# Keep TranslatorContext.tsx temporarily - largest file, migrate Week 2
```

#### 1.1.4 Update Providers.tsx

**File: `src/components/Providers.tsx`**

```typescript
'use client';

import { PropsWithChildren, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { DatadogProvider } from './DatadogProvider';
import { TelegramProvider } from './TelegramProvider';
import { ErrorBoundary } from './ErrorBoundary';

// Create query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      gcTime: 5 * 60 * 1000, // 5 minutes
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
});

// Auth initializer component
function AuthInitializer({ children }: PropsWithChildren) {
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    const unsubscribe = initialize();
    return unsubscribe;
  }, [initialize]);

  return <>{children}</>;
}

// Theme initializer component
function ThemeInitializer({ children }: PropsWithChildren) {
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return <>{children}</>;
}

export function Providers({ children }: PropsWithChildren) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <DatadogProvider>
          <TelegramProvider>
            <AuthInitializer>
              <ThemeInitializer>
                {children}
              </ThemeInitializer>
            </AuthInitializer>
          </TelegramProvider>
        </DatadogProvider>
        {process.env.NODE_ENV === 'development' && <ReactQueryDevtools />}
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
```

#### 1.1.5 Update Component Imports

**Find and replace across codebase:**

```typescript
// OLD
import { useAuth } from '@/contexts/AuthContext';
const { user, signIn, signOut } = useAuth();

// NEW
import { useAuthStore } from '@/stores/authStore';
const user = useAuthStore((state) => state.user);
const signIn = useAuthStore((state) => state.signInWithEmail);
const signOut = useAuthStore((state) => state.signOut);

// Or using selectors
import { useAuthStore, selectUser, selectIsAuthenticated } from '@/stores/authStore';
const user = useAuthStore(selectUser);
const isAuthenticated = useAuthStore(selectIsAuthenticated);
```

**Files to Update:**
```
src/app/login/page.tsx
src/app/app/page.tsx
src/app/settings/page.tsx
src/components/ProtectedRoute.tsx
src/features/chat/components/ChatHeader.tsx
src/features/voice/hooks/useVoiceRecording.ts
```

#### 1.1.6 Acceptance Criteria - Week 1

- [ ] All 6 context files analyzed and documented
- [ ] `authStore.ts` contains all auth functionality
- [ ] `AuthContext.tsx` deleted
- [ ] `ChatContext.tsx` deleted
- [ ] `SubscriptionContext.tsx` deleted
- [ ] `CustomContactsContext.tsx` deleted
- [ ] `ThemeContext.tsx` deleted
- [ ] `Providers.tsx` uses only Zustand stores
- [ ] All component imports updated
- [ ] Unit tests pass for authStore
- [ ] Application runs without errors
- [ ] Auth flow works (sign in, sign out, persist)

---

### Week 2: Repository Pattern

#### 1.2.1 Create Repository Interfaces

**File: `src/repositories/interfaces/IChatRepository.ts`**

```typescript
import type { Chat, Message, CreateChatInput, CreateMessageInput, PaginationOptions, PaginatedResult } from '@/shared/types';

export interface IChatRepository {
  // Chat operations
  getChats(userId: string): Promise<Chat[]>;
  getChat(chatId: string): Promise<Chat | null>;
  createChat(userId: string, input: CreateChatInput): Promise<Chat>;
  updateChat(chatId: string, updates: Partial<Chat>): Promise<void>;
  deleteChat(chatId: string): Promise<void>;

  // Message operations
  getMessages(chatId: string, options?: PaginationOptions): Promise<PaginatedResult<Message>>;
  getMessage(chatId: string, messageId: string): Promise<Message | null>;
  addMessage(chatId: string, input: CreateMessageInput): Promise<Message>;
  updateMessage(chatId: string, messageId: string, updates: Partial<Message>): Promise<void>;
  deleteMessage(chatId: string, messageId: string): Promise<void>;

  // Sync operations
  syncFromLocal(userId: string, localChats: Chat[]): Promise<void>;
  getLastSyncTime(userId: string): Promise<Date | null>;
}
```

**File: `src/repositories/interfaces/IUserRepository.ts`**

```typescript
import type { UserProfile, UserPreferences, ClonedVoice, SubscriptionInfo } from '@/shared/types';

export interface IUserRepository {
  // Profile
  getProfile(userId: string): Promise<UserProfile | null>;
  updateProfile(userId: string, updates: Partial<UserProfile>): Promise<void>;

  // Preferences
  getPreferences(userId: string): Promise<UserPreferences | null>;
  updatePreferences(userId: string, updates: Partial<UserPreferences>): Promise<void>;

  // Subscription
  getSubscription(userId: string): Promise<SubscriptionInfo | null>;
  updateSubscription(userId: string, updates: Partial<SubscriptionInfo>): Promise<void>;

  // Voices
  getClonedVoices(userId: string): Promise<ClonedVoice[]>;
  addClonedVoice(userId: string, voice: Omit<ClonedVoice, 'id' | 'createdAt'>): Promise<ClonedVoice>;
  deleteClonedVoice(userId: string, voiceId: string): Promise<void>;

  // Usage tracking
  incrementMessageCount(userId: string): Promise<number>;
  getMessageCount(userId: string): Promise<number>;
  resetDailyMessageCount(userId: string): Promise<void>;
}
```

**File: `src/repositories/interfaces/IContactRepository.ts`**

```typescript
import type { CustomContact, CreateContactInput } from '@/shared/types';

export interface IContactRepository {
  getContacts(userId: string): Promise<CustomContact[]>;
  getContact(userId: string, contactId: string): Promise<CustomContact | null>;
  createContact(userId: string, input: CreateContactInput): Promise<CustomContact>;
  updateContact(userId: string, contactId: string, updates: Partial<CustomContact>): Promise<void>;
  deleteContact(userId: string, contactId: string): Promise<void>;
  getContactCount(userId: string): Promise<number>;
}
```

**File: `src/repositories/interfaces/index.ts`**

```typescript
export type { IChatRepository } from './IChatRepository';
export type { IUserRepository } from './IUserRepository';
export type { IContactRepository } from './IContactRepository';
```

#### 1.2.2 Implement Firestore Repositories

**File: `src/repositories/firestore/FirestoreChatRepository.ts`**

```typescript
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { IChatRepository } from '../interfaces/IChatRepository';
import type { Chat, Message, CreateChatInput, CreateMessageInput, PaginationOptions, PaginatedResult } from '@/shared/types';
import { generateId } from '@/shared/utils/id';

export class FirestoreChatRepository implements IChatRepository {
  private getUserChatsRef(userId: string) {
    return collection(db, 'users', userId, 'chats');
  }

  private getChatRef(userId: string, chatId: string) {
    return doc(db, 'users', userId, 'chats', chatId);
  }

  private getMessagesRef(userId: string, chatId: string) {
    return collection(db, 'users', userId, 'chats', chatId, 'messages');
  }

  async getChats(userId: string): Promise<Chat[]> {
    const q = query(
      this.getUserChatsRef(userId),
      orderBy('updatedAt', 'desc')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => this.docToChat(doc));
  }

  async getChat(chatId: string): Promise<Chat | null> {
    // Note: This requires knowing the userId, which is a limitation
    // In practice, we'd need to pass userId or restructure
    throw new Error('getChat requires userId - use getChatForUser instead');
  }

  async getChatForUser(userId: string, chatId: string): Promise<Chat | null> {
    const docRef = this.getChatRef(userId, chatId);
    const snapshot = await getDoc(docRef);

    if (!snapshot.exists()) return null;
    return this.docToChat(snapshot);
  }

  async createChat(userId: string, input: CreateChatInput): Promise<Chat> {
    const chatId = generateId();
    const now = new Date();

    const chat: Chat = {
      id: chatId,
      contactId: input.contactId,
      title: input.title || '',
      lastMessage: null,
      lastMessageAt: null,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    };

    await setDoc(this.getChatRef(userId, chatId), {
      ...chat,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return chat;
  }

  async updateChat(chatId: string, updates: Partial<Chat>): Promise<void> {
    // This is a limitation - we need userId
    throw new Error('updateChat requires userId - use updateChatForUser instead');
  }

  async updateChatForUser(userId: string, chatId: string, updates: Partial<Chat>): Promise<void> {
    const docRef = this.getChatRef(userId, chatId);
    await updateDoc(docRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  }

  async deleteChat(chatId: string): Promise<void> {
    throw new Error('deleteChat requires userId - use deleteChatForUser instead');
  }

  async deleteChatForUser(userId: string, chatId: string): Promise<void> {
    // Delete all messages first
    const messagesRef = this.getMessagesRef(userId, chatId);
    const messagesSnapshot = await getDocs(messagesRef);

    const batch = writeBatch(db);
    messagesSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    // Delete the chat
    batch.delete(this.getChatRef(userId, chatId));

    await batch.commit();
  }

  async getMessages(
    chatId: string,
    options?: PaginationOptions
  ): Promise<PaginatedResult<Message>> {
    throw new Error('getMessages requires userId - use getMessagesForUser instead');
  }

  async getMessagesForUser(
    userId: string,
    chatId: string,
    options: PaginationOptions = { limit: 50 }
  ): Promise<PaginatedResult<Message>> {
    const messagesRef = this.getMessagesRef(userId, chatId);

    let q = query(
      messagesRef,
      orderBy('createdAt', 'desc'),
      limit(options.limit + 1) // Fetch one extra to check for more
    );

    if (options.cursor) {
      const cursorDoc = await getDoc(doc(messagesRef, options.cursor));
      if (cursorDoc.exists()) {
        q = query(q, startAfter(cursorDoc));
      }
    }

    const snapshot = await getDocs(q);
    const messages = snapshot.docs
      .slice(0, options.limit)
      .map((doc) => this.docToMessage(doc))
      .reverse(); // Reverse to get chronological order

    const hasMore = snapshot.docs.length > options.limit;
    const nextCursor = hasMore ? snapshot.docs[options.limit - 1].id : undefined;

    return {
      items: messages,
      hasMore,
      nextCursor,
    };
  }

  async getMessage(chatId: string, messageId: string): Promise<Message | null> {
    throw new Error('getMessage requires userId');
  }

  async addMessage(chatId: string, input: CreateMessageInput): Promise<Message> {
    throw new Error('addMessage requires userId - use addMessageForUser instead');
  }

  async addMessageForUser(
    userId: string,
    chatId: string,
    input: CreateMessageInput
  ): Promise<Message> {
    const messageId = generateId();
    const now = new Date();

    const message: Message = {
      id: messageId,
      chatId,
      role: input.role,
      content: input.content,
      audioUrl: input.audioUrl || null,
      createdAt: now,
    };

    const messagesRef = this.getMessagesRef(userId, chatId);
    await setDoc(doc(messagesRef, messageId), {
      ...message,
      createdAt: serverTimestamp(),
    });

    // Update chat's last message
    await this.updateChatForUser(userId, chatId, {
      lastMessage: input.content.substring(0, 100),
      lastMessageAt: now,
    });

    return message;
  }

  async updateMessage(
    chatId: string,
    messageId: string,
    updates: Partial<Message>
  ): Promise<void> {
    throw new Error('updateMessage requires userId');
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    throw new Error('deleteMessage requires userId');
  }

  async syncFromLocal(userId: string, localChats: Chat[]): Promise<void> {
    const batch = writeBatch(db);

    for (const chat of localChats) {
      const chatRef = this.getChatRef(userId, chat.id);
      batch.set(chatRef, {
        ...chat,
        createdAt: Timestamp.fromDate(chat.createdAt),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    await batch.commit();
  }

  async getLastSyncTime(userId: string): Promise<Date | null> {
    // Could store this in user preferences
    return null;
  }

  // Helper methods
  private docToChat(doc: any): Chat {
    const data = doc.data();
    return {
      id: doc.id,
      contactId: data.contactId,
      title: data.title || '',
      lastMessage: data.lastMessage || null,
      lastMessageAt: data.lastMessageAt?.toDate() || null,
      createdAt: data.createdAt?.toDate() || new Date(),
      updatedAt: data.updatedAt?.toDate() || new Date(),
      messageCount: data.messageCount || 0,
    };
  }

  private docToMessage(doc: any): Message {
    const data = doc.data();
    return {
      id: doc.id,
      chatId: data.chatId,
      role: data.role,
      content: data.content,
      audioUrl: data.audioUrl || null,
      createdAt: data.createdAt?.toDate() || new Date(),
    };
  }
}
```

**File: `src/repositories/firestore/FirestoreUserRepository.ts`**

```typescript
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  deleteDoc,
  serverTimestamp,
  increment,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { IUserRepository } from '../interfaces/IUserRepository';
import type { UserProfile, UserPreferences, ClonedVoice, SubscriptionInfo } from '@/shared/types';
import { generateId } from '@/shared/utils/id';

export class FirestoreUserRepository implements IUserRepository {
  private getUserRef(userId: string) {
    return doc(db, 'users', userId);
  }

  private getPreferencesRef(userId: string) {
    return doc(db, 'users', userId, 'settings', 'preferences');
  }

  private getSubscriptionRef(userId: string) {
    return doc(db, 'users', userId, 'settings', 'subscription');
  }

  private getVoicesRef(userId: string) {
    return collection(db, 'users', userId, 'voiceClones');
  }

  private getUsageRef(userId: string) {
    return doc(db, 'users', userId, 'usage', 'daily');
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    const snapshot = await getDoc(this.getUserRef(userId));
    if (!snapshot.exists()) return null;

    const data = snapshot.data();
    return {
      id: userId,
      email: data.email,
      displayName: data.displayName,
      photoURL: data.photoURL,
      createdAt: data.createdAt?.toDate() || new Date(),
    };
  }

  async updateProfile(userId: string, updates: Partial<UserProfile>): Promise<void> {
    await updateDoc(this.getUserRef(userId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  }

  async getPreferences(userId: string): Promise<UserPreferences | null> {
    const snapshot = await getDoc(this.getPreferencesRef(userId));
    if (!snapshot.exists()) return null;
    return snapshot.data() as UserPreferences;
  }

  async updatePreferences(userId: string, updates: Partial<UserPreferences>): Promise<void> {
    await setDoc(this.getPreferencesRef(userId), updates, { merge: true });
  }

  async getSubscription(userId: string): Promise<SubscriptionInfo | null> {
    const snapshot = await getDoc(this.getSubscriptionRef(userId));
    if (!snapshot.exists()) {
      // Return default free tier
      return {
        tier: 'free',
        status: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      };
    }
    return snapshot.data() as SubscriptionInfo;
  }

  async updateSubscription(userId: string, updates: Partial<SubscriptionInfo>): Promise<void> {
    await setDoc(this.getSubscriptionRef(userId), updates, { merge: true });
  }

  async getClonedVoices(userId: string): Promise<ClonedVoice[]> {
    const snapshot = await getDocs(this.getVoicesRef(userId));
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate() || new Date(),
    })) as ClonedVoice[];
  }

  async addClonedVoice(
    userId: string,
    voice: Omit<ClonedVoice, 'id' | 'createdAt'>
  ): Promise<ClonedVoice> {
    const id = generateId();
    const voiceRef = doc(this.getVoicesRef(userId), id);

    await setDoc(voiceRef, {
      ...voice,
      createdAt: serverTimestamp(),
    });

    return {
      id,
      ...voice,
      createdAt: new Date(),
    };
  }

  async deleteClonedVoice(userId: string, voiceId: string): Promise<void> {
    await deleteDoc(doc(this.getVoicesRef(userId), voiceId));
  }

  async incrementMessageCount(userId: string): Promise<number> {
    const usageRef = this.getUsageRef(userId);
    const today = new Date().toISOString().split('T')[0];

    await setDoc(usageRef, {
      date: today,
      messageCount: increment(1),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    const snapshot = await getDoc(usageRef);
    return snapshot.data()?.messageCount || 1;
  }

  async getMessageCount(userId: string): Promise<number> {
    const snapshot = await getDoc(this.getUsageRef(userId));
    if (!snapshot.exists()) return 0;

    const data = snapshot.data();
    const today = new Date().toISOString().split('T')[0];

    // Reset if different day
    if (data.date !== today) return 0;

    return data.messageCount || 0;
  }

  async resetDailyMessageCount(userId: string): Promise<void> {
    await setDoc(this.getUsageRef(userId), {
      date: new Date().toISOString().split('T')[0],
      messageCount: 0,
      updatedAt: serverTimestamp(),
    });
  }
}
```

**File: `src/repositories/firestore/index.ts`**

```typescript
export { FirestoreChatRepository } from './FirestoreChatRepository';
export { FirestoreUserRepository } from './FirestoreUserRepository';
export { FirestoreContactRepository } from './FirestoreContactRepository';
```

#### 1.2.3 Create Repository Container

**File: `src/repositories/container.ts`**

```typescript
import { FirestoreChatRepository } from './firestore/FirestoreChatRepository';
import { FirestoreUserRepository } from './firestore/FirestoreUserRepository';
import { FirestoreContactRepository } from './firestore/FirestoreContactRepository';
import type { IChatRepository } from './interfaces/IChatRepository';
import type { IUserRepository } from './interfaces/IUserRepository';
import type { IContactRepository } from './interfaces/IContactRepository';

// Simple factory pattern (can upgrade to awilix later)
class RepositoryContainer {
  private static instance: RepositoryContainer;

  private chatRepository: IChatRepository | null = null;
  private userRepository: IUserRepository | null = null;
  private contactRepository: IContactRepository | null = null;

  private constructor() {}

  static getInstance(): RepositoryContainer {
    if (!RepositoryContainer.instance) {
      RepositoryContainer.instance = new RepositoryContainer();
    }
    return RepositoryContainer.instance;
  }

  getChatRepository(): IChatRepository {
    if (!this.chatRepository) {
      this.chatRepository = new FirestoreChatRepository();
    }
    return this.chatRepository;
  }

  getUserRepository(): IUserRepository {
    if (!this.userRepository) {
      this.userRepository = new FirestoreUserRepository();
    }
    return this.userRepository;
  }

  getContactRepository(): IContactRepository {
    if (!this.contactRepository) {
      this.contactRepository = new FirestoreContactRepository();
    }
    return this.contactRepository;
  }

  // For testing - allow injecting mock repositories
  setChatRepository(repo: IChatRepository): void {
    this.chatRepository = repo;
  }

  setUserRepository(repo: IUserRepository): void {
    this.userRepository = repo;
  }

  setContactRepository(repo: IContactRepository): void {
    this.contactRepository = repo;
  }

  // Reset for testing
  reset(): void {
    this.chatRepository = null;
    this.userRepository = null;
    this.contactRepository = null;
  }
}

export const repositories = RepositoryContainer.getInstance();

// Convenience exports
export const getChatRepository = () => repositories.getChatRepository();
export const getUserRepository = () => repositories.getUserRepository();
export const getContactRepository = () => repositories.getContactRepository();
```

#### 1.2.4 Acceptance Criteria - Week 2

- [ ] All repository interfaces defined
- [ ] Firestore implementations complete
- [ ] Repository container created
- [ ] Unit tests for repositories (mock Firestore)
- [ ] Existing code still uses old patterns (gradual migration)
- [ ] Documentation for repository usage

---

### Week 3: Service Layer

#### 1.3.1 Create Service Interfaces

**File: `src/services/interfaces/IChatService.ts`**

```typescript
import type { Chat, Message } from '@/shared/types';

export interface SendMessageRequest {
  userId: string;
  chatId?: string; // Optional - creates new chat if not provided
  contactId: string;
  message: string;
  model?: string;
}

export interface SendMessageResponse {
  chat: Chat;
  userMessage: Message;
  assistantMessage: Message;
}

export interface StreamMessageRequest extends SendMessageRequest {
  onToken: (token: string) => void;
  onComplete: (message: Message) => void;
  onError: (error: Error) => void;
}

export interface IChatService {
  // Chat operations
  getChats(userId: string): Promise<Chat[]>;
  getChat(userId: string, chatId: string): Promise<Chat | null>;
  createChat(userId: string, contactId: string, title?: string): Promise<Chat>;
  deleteChat(userId: string, chatId: string): Promise<void>;

  // Message operations
  sendMessage(request: SendMessageRequest): Promise<SendMessageResponse>;
  streamMessage(request: StreamMessageRequest): Promise<void>;
  getMessages(userId: string, chatId: string, cursor?: string): Promise<{
    messages: Message[];
    hasMore: boolean;
    nextCursor?: string;
  }>;

  // Regenerate last response
  regenerateLastMessage(userId: string, chatId: string): Promise<Message>;
}
```

**File: `src/services/interfaces/IVoiceService.ts`**

```typescript
export interface TextToSpeechRequest {
  text: string;
  voiceId: string;
  modelId?: string;
}

export interface TextToSpeechResponse {
  audioUrl: string;
  duration: number;
}

export interface CloneVoiceRequest {
  userId: string;
  name: string;
  audioFile: File | Blob;
  description?: string;
}

export interface CloneVoiceResponse {
  voiceId: string;
  name: string;
}

export interface IVoiceService {
  // Text to Speech
  textToSpeech(request: TextToSpeechRequest): Promise<TextToSpeechResponse>;
  streamTextToSpeech(request: TextToSpeechRequest): AsyncGenerator<Uint8Array>;

  // Speech to Text
  speechToText(audioBlob: Blob): Promise<string>;

  // Voice Cloning
  cloneVoice(request: CloneVoiceRequest): Promise<CloneVoiceResponse>;
  getVoices(userId: string): Promise<Array<{ id: string; name: string }>>;
  deleteVoice(userId: string, voiceId: string): Promise<void>;
}
```

**File: `src/services/interfaces/ISubscriptionService.ts`**

```typescript
import type { SubscriptionTier, SubscriptionInfo } from '@/shared/types';

export interface ISubscriptionService {
  // Subscription info
  getSubscription(userId: string): Promise<SubscriptionInfo>;

  // Feature checks
  canSendMessage(userId: string): Promise<{ allowed: boolean; reason?: string }>;
  canUseModel(userId: string, model: string): Promise<boolean>;
  canCreateCustomContact(userId: string): Promise<boolean>;
  canCloneVoice(userId: string): Promise<boolean>;

  // Usage tracking
  trackMessageUsage(userId: string): Promise<void>;
  getUsageStats(userId: string): Promise<{
    messagesUsed: number;
    messagesLimit: number;
    customContactsCount: number;
    customContactsLimit: number;
    voiceClonesCount: number;
    voiceClonesLimit: number;
  }>;

  // Stripe integration
  createCheckoutSession(userId: string, tier: SubscriptionTier): Promise<string>;
  createPortalSession(userId: string): Promise<string>;
  handleWebhook(payload: string, signature: string): Promise<void>;
}
```

#### 1.3.2 Implement Services

**File: `src/services/implementations/ChatService.ts`**

```typescript
import type { IChatService, SendMessageRequest, SendMessageResponse, StreamMessageRequest } from '../interfaces/IChatService';
import type { IChatRepository } from '@/repositories/interfaces/IChatRepository';
import type { IUserRepository } from '@/repositories/interfaces/IUserRepository';
import type { Chat, Message } from '@/shared/types';
import { AIProviderRouter } from './AIProviderRouter';
import { logger } from '@/lib/logger';

export class ChatService implements IChatService {
  constructor(
    private chatRepository: IChatRepository,
    private userRepository: IUserRepository,
    private aiRouter: AIProviderRouter
  ) {}

  async getChats(userId: string): Promise<Chat[]> {
    return this.chatRepository.getChats(userId);
  }

  async getChat(userId: string, chatId: string): Promise<Chat | null> {
    // Type assertion for extended Firestore repository
    const repo = this.chatRepository as any;
    if (typeof repo.getChatForUser === 'function') {
      return repo.getChatForUser(userId, chatId);
    }
    return this.chatRepository.getChat(chatId);
  }

  async createChat(userId: string, contactId: string, title?: string): Promise<Chat> {
    return this.chatRepository.createChat(userId, { contactId, title });
  }

  async deleteChat(userId: string, chatId: string): Promise<void> {
    const repo = this.chatRepository as any;
    if (typeof repo.deleteChatForUser === 'function') {
      return repo.deleteChatForUser(userId, chatId);
    }
    return this.chatRepository.deleteChat(chatId);
  }

  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    const { userId, contactId, message, model } = request;

    logger.info({ userId, contactId, model }, 'Processing chat message');

    // Get or create chat
    let chat: Chat;
    let chatId = request.chatId;

    if (chatId) {
      const existingChat = await this.getChat(userId, chatId);
      if (!existingChat) {
        throw new Error('Chat not found');
      }
      chat = existingChat;
    } else {
      chat = await this.createChat(userId, contactId);
      chatId = chat.id;
    }

    // Save user message
    const repo = this.chatRepository as any;
    const userMessage = await repo.addMessageForUser(userId, chatId, {
      role: 'user' as const,
      content: message,
    });

    // Get conversation history
    const historyResult = await repo.getMessagesForUser(userId, chatId, { limit: 20 });
    const history = historyResult.items;

    // Get AI response
    const responseText = await this.aiRouter.chat({
      contactId,
      messages: history,
      model,
    });

    // Save assistant message
    const assistantMessage = await repo.addMessageForUser(userId, chatId, {
      role: 'assistant' as const,
      content: responseText,
    });

    // Track usage
    await this.userRepository.incrementMessageCount(userId);

    // Get updated chat
    const updatedChat = await this.getChat(userId, chatId);

    return {
      chat: updatedChat!,
      userMessage,
      assistantMessage,
    };
  }

  async streamMessage(request: StreamMessageRequest): Promise<void> {
    const { userId, contactId, message, model, onToken, onComplete, onError } = request;

    try {
      // Similar setup as sendMessage
      let chatId = request.chatId;

      if (!chatId) {
        const chat = await this.createChat(userId, contactId);
        chatId = chat.id;
      }

      const repo = this.chatRepository as any;

      // Save user message
      await repo.addMessageForUser(userId, chatId, {
        role: 'user' as const,
        content: message,
      });

      // Get history
      const historyResult = await repo.getMessagesForUser(userId, chatId, { limit: 20 });

      // Stream AI response
      let fullResponse = '';

      await this.aiRouter.streamChat({
        contactId,
        messages: historyResult.items,
        model,
        onToken: (token) => {
          fullResponse += token;
          onToken(token);
        },
      });

      // Save complete response
      const assistantMessage = await repo.addMessageForUser(userId, chatId, {
        role: 'assistant' as const,
        content: fullResponse,
      });

      // Track usage
      await this.userRepository.incrementMessageCount(userId);

      onComplete(assistantMessage);
    } catch (error) {
      logger.error({ error }, 'Stream message error');
      onError(error instanceof Error ? error : new Error('Stream failed'));
    }
  }

  async getMessages(userId: string, chatId: string, cursor?: string) {
    const repo = this.chatRepository as any;
    const result = await repo.getMessagesForUser(userId, chatId, {
      limit: 50,
      cursor,
    });

    return {
      messages: result.items,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    };
  }

  async regenerateLastMessage(userId: string, chatId: string): Promise<Message> {
    const repo = this.chatRepository as any;

    // Get last messages
    const result = await repo.getMessagesForUser(userId, chatId, { limit: 2 });
    const messages = result.items;

    if (messages.length < 2) {
      throw new Error('Not enough messages to regenerate');
    }

    const lastUserMessage = messages.find((m: Message) => m.role === 'user');
    if (!lastUserMessage) {
      throw new Error('No user message to regenerate from');
    }

    // Get chat for contactId
    const chat = await this.getChat(userId, chatId);
    if (!chat) {
      throw new Error('Chat not found');
    }

    // Get all history except last assistant message
    const historyResult = await repo.getMessagesForUser(userId, chatId, { limit: 20 });
    const history = historyResult.items.filter(
      (m: Message) => m.role === 'user' || m.id !== messages[messages.length - 1].id
    );

    // Get new AI response
    const responseText = await this.aiRouter.chat({
      contactId: chat.contactId,
      messages: history,
    });

    // Save new assistant message
    const newMessage = await repo.addMessageForUser(userId, chatId, {
      role: 'assistant' as const,
      content: responseText,
    });

    return newMessage;
  }
}
```

**File: `src/services/implementations/AIProviderRouter.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Message } from '@/shared/types';
import { getContactSystemPrompt } from '@/features/contacts/data/premade-contacts';
import { logger } from '@/lib/logger';

interface ChatRequest {
  contactId: string;
  messages: Message[];
  model?: string;
}

interface StreamChatRequest extends ChatRequest {
  onToken: (token: string) => void;
}

type AIProvider = 'anthropic' | 'openai' | 'google' | 'deepseek';

interface ProviderConfig {
  provider: AIProvider;
  modelId: string;
}

const MODEL_MAP: Record<string, ProviderConfig> = {
  'claude-3-5-sonnet': { provider: 'anthropic', modelId: 'claude-3-5-sonnet-20241022' },
  'claude-3-opus': { provider: 'anthropic', modelId: 'claude-3-opus-20240229' },
  'gpt-4o': { provider: 'openai', modelId: 'gpt-4o' },
  'gpt-4o-mini': { provider: 'openai', modelId: 'gpt-4o-mini' },
  'gemini-pro': { provider: 'google', modelId: 'gemini-1.5-pro' },
  'gemini-flash': { provider: 'google', modelId: 'gemini-1.5-flash' },
  'deepseek-chat': { provider: 'deepseek', modelId: 'deepseek-chat' },
};

const DEFAULT_MODEL = 'gemini-flash';

export class AIProviderRouter {
  private anthropic: Anthropic | null = null;
  private openai: OpenAI | null = null;
  private google: GoogleGenerativeAI | null = null;
  private deepseek: OpenAI | null = null;

  constructor() {
    // Lazy initialization
  }

  private getAnthropicClient(): Anthropic {
    if (!this.anthropic) {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY not configured');
      }
      this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return this.anthropic;
  }

  private getOpenAIClient(): OpenAI {
    if (!this.openai) {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY not configured');
      }
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return this.openai;
  }

  private getGoogleClient(): GoogleGenerativeAI {
    if (!this.google) {
      if (!process.env.GOOGLE_AI_API_KEY) {
        throw new Error('GOOGLE_AI_API_KEY not configured');
      }
      this.google = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
    }
    return this.google;
  }

  private getDeepSeekClient(): OpenAI {
    if (!this.deepseek) {
      if (!process.env.DEEPSEEK_API_KEY) {
        throw new Error('DEEPSEEK_API_KEY not configured');
      }
      this.deepseek = new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: 'https://api.deepseek.com/v1',
      });
    }
    return this.deepseek;
  }

  private getProviderConfig(model?: string): ProviderConfig {
    const modelKey = model || DEFAULT_MODEL;
    const config = MODEL_MAP[modelKey];

    if (!config) {
      logger.warn({ model: modelKey }, 'Unknown model, using default');
      return MODEL_MAP[DEFAULT_MODEL];
    }

    return config;
  }

  private formatMessages(
    systemPrompt: string,
    messages: Message[]
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    // Filter out system messages and format for API
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
  }

  async chat(request: ChatRequest): Promise<string> {
    const { contactId, messages, model } = request;
    const config = this.getProviderConfig(model);
    const systemPrompt = getContactSystemPrompt(contactId);

    logger.info({ provider: config.provider, model: config.modelId, contactId }, 'Executing AI chat');

    switch (config.provider) {
      case 'anthropic':
        return this.chatWithAnthropic(systemPrompt, messages, config.modelId);
      case 'openai':
        return this.chatWithOpenAI(systemPrompt, messages, config.modelId);
      case 'google':
        return this.chatWithGoogle(systemPrompt, messages, config.modelId);
      case 'deepseek':
        return this.chatWithDeepSeek(systemPrompt, messages, config.modelId);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  async streamChat(request: StreamChatRequest): Promise<void> {
    const { contactId, messages, model, onToken } = request;
    const config = this.getProviderConfig(model);
    const systemPrompt = getContactSystemPrompt(contactId);

    switch (config.provider) {
      case 'anthropic':
        return this.streamWithAnthropic(systemPrompt, messages, config.modelId, onToken);
      case 'openai':
        return this.streamWithOpenAI(systemPrompt, messages, config.modelId, onToken);
      case 'google':
        return this.streamWithGoogle(systemPrompt, messages, config.modelId, onToken);
      case 'deepseek':
        return this.streamWithDeepSeek(systemPrompt, messages, config.modelId, onToken);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  private async chatWithAnthropic(
    systemPrompt: string,
    messages: Message[],
    model: string
  ): Promise<string> {
    const client = this.getAnthropicClient();
    const formattedMessages = this.formatMessages(systemPrompt, messages);

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: formattedMessages,
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    return textBlock?.text || '';
  }

  private async chatWithOpenAI(
    systemPrompt: string,
    messages: Message[],
    model: string
  ): Promise<string> {
    const client = this.getOpenAIClient();
    const formattedMessages = this.formatMessages(systemPrompt, messages);

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...formattedMessages,
      ],
    });

    return response.choices[0]?.message?.content || '';
  }

  private async chatWithGoogle(
    systemPrompt: string,
    messages: Message[],
    model: string
  ): Promise<string> {
    const client = this.getGoogleClient();
    const genModel = client.getGenerativeModel({ model });

    const formattedMessages = this.formatMessages(systemPrompt, messages);
    const history = formattedMessages.slice(0, -1).map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

    const chat = genModel.startChat({
      history,
      systemInstruction: systemPrompt,
    });

    const lastMessage = formattedMessages[formattedMessages.length - 1];
    const result = await chat.sendMessage(lastMessage.content);

    return result.response.text();
  }

  private async chatWithDeepSeek(
    systemPrompt: string,
    messages: Message[],
    model: string
  ): Promise<string> {
    const client = this.getDeepSeekClient();
    const formattedMessages = this.formatMessages(systemPrompt, messages);

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...formattedMessages,
      ],
    });

    return response.choices[0]?.message?.content || '';
  }

  // Streaming implementations
  private async streamWithAnthropic(
    systemPrompt: string,
    messages: Message[],
    model: string,
    onToken: (token: string) => void
  ): Promise<void> {
    const client = this.getAnthropicClient();
    const formattedMessages = this.formatMessages(systemPrompt, messages);

    const stream = await client.messages.stream({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: formattedMessages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        onToken(event.delta.text);
      }
    }
  }

  private async streamWithOpenAI(
    systemPrompt: string,
    messages: Message[],
    model: string,
    onToken: (token: string) => void
  ): Promise<void> {
    const client = this.getOpenAIClient();
    const formattedMessages = this.formatMessages(systemPrompt, messages);

    const stream = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...formattedMessages,
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        onToken(content);
      }
    }
  }

  private async streamWithGoogle(
    systemPrompt: string,
    messages: Message[],
    model: string,
    onToken: (token: string) => void
  ): Promise<void> {
    const client = this.getGoogleClient();
    const genModel = client.getGenerativeModel({ model });

    const formattedMessages = this.formatMessages(systemPrompt, messages);
    const history = formattedMessages.slice(0, -1).map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

    const chat = genModel.startChat({
      history,
      systemInstruction: systemPrompt,
    });

    const lastMessage = formattedMessages[formattedMessages.length - 1];
    const result = await chat.sendMessageStream(lastMessage.content);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        onToken(text);
      }
    }
  }

  private async streamWithDeepSeek(
    systemPrompt: string,
    messages: Message[],
    model: string,
    onToken: (token: string) => void
  ): Promise<void> {
    // Same as OpenAI since DeepSeek uses OpenAI-compatible API
    const client = this.getDeepSeekClient();
    const formattedMessages = this.formatMessages(systemPrompt, messages);

    const stream = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...formattedMessages,
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        onToken(content);
      }
    }
  }
}
```

#### 1.3.3 Create Service Container

**File: `src/services/container.ts`**

```typescript
import { ChatService } from './implementations/ChatService';
import { VoiceService } from './implementations/VoiceService';
import { SubscriptionService } from './implementations/SubscriptionService';
import { AIProviderRouter } from './implementations/AIProviderRouter';
import { getChatRepository, getUserRepository, getContactRepository } from '@/repositories/container';
import type { IChatService } from './interfaces/IChatService';
import type { IVoiceService } from './interfaces/IVoiceService';
import type { ISubscriptionService } from './interfaces/ISubscriptionService';

class ServiceContainer {
  private static instance: ServiceContainer;

  private chatService: IChatService | null = null;
  private voiceService: IVoiceService | null = null;
  private subscriptionService: ISubscriptionService | null = null;
  private aiRouter: AIProviderRouter | null = null;

  private constructor() {}

  static getInstance(): ServiceContainer {
    if (!ServiceContainer.instance) {
      ServiceContainer.instance = new ServiceContainer();
    }
    return ServiceContainer.instance;
  }

  getAIRouter(): AIProviderRouter {
    if (!this.aiRouter) {
      this.aiRouter = new AIProviderRouter();
    }
    return this.aiRouter;
  }

  getChatService(): IChatService {
    if (!this.chatService) {
      this.chatService = new ChatService(
        getChatRepository(),
        getUserRepository(),
        this.getAIRouter()
      );
    }
    return this.chatService;
  }

  getVoiceService(): IVoiceService {
    if (!this.voiceService) {
      this.voiceService = new VoiceService(getUserRepository());
    }
    return this.voiceService;
  }

  getSubscriptionService(): ISubscriptionService {
    if (!this.subscriptionService) {
      this.subscriptionService = new SubscriptionService(
        getUserRepository(),
        getContactRepository()
      );
    }
    return this.subscriptionService;
  }

  // For testing
  setChatService(service: IChatService): void {
    this.chatService = service;
  }

  setVoiceService(service: IVoiceService): void {
    this.voiceService = service;
  }

  setSubscriptionService(service: ISubscriptionService): void {
    this.subscriptionService = service;
  }

  reset(): void {
    this.chatService = null;
    this.voiceService = null;
    this.subscriptionService = null;
    this.aiRouter = null;
  }
}

export const services = ServiceContainer.getInstance();

// Convenience exports
export const getChatService = () => services.getChatService();
export const getVoiceService = () => services.getVoiceService();
export const getSubscriptionService = () => services.getSubscriptionService();
```

#### 1.3.4 Refactor API Routes

**File: `src/app/api/chat/route.ts` (Refactored)**

```typescript
import { NextRequest } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/middleware/withAuth';
import { validateRequest } from '@/lib/validation';
import { chatRequestSchema } from '@/lib/validation/schemas';
import { successResponse, errorResponse } from '@/lib/api/response';
import { getChatService, getSubscriptionService } from '@/services/container';
import { withRateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';

export const POST = withAuth(
  withRateLimit(
    async (request: AuthenticatedRequest) => {
      try {
        // Validate request
        const body = await validateRequest(chatRequestSchema, request);

        // Check subscription limits
        const subscriptionService = getSubscriptionService();
        const canSend = await subscriptionService.canSendMessage(request.userId);

        if (!canSend.allowed) {
          return errorResponse(canSend.reason || 'Message limit reached', 403);
        }

        // Check model access
        if (body.model) {
          const canUseModel = await subscriptionService.canUseModel(request.userId, body.model);
          if (!canUseModel) {
            return errorResponse('Model not available on your plan', 403);
          }
        }

        // Send message via service
        const chatService = getChatService();
        const result = await chatService.sendMessage({
          userId: request.userId,
          chatId: body.chatId,
          contactId: body.contactId,
          message: body.message,
          model: body.model,
        });

        // Track usage
        await subscriptionService.trackMessageUsage(request.userId);

        return successResponse(result);
      } catch (error) {
        logger.error({ error }, 'Chat API error');
        return errorResponse(
          error instanceof Error ? error.message : 'Failed to process message',
          500
        );
      }
    },
    { type: 'chat' }
  )
);
```

#### 1.3.5 Acceptance Criteria - Week 3

- [ ] All service interfaces defined
- [ ] ChatService implementation complete
- [ ] VoiceService implementation complete
- [ ] SubscriptionService implementation complete
- [ ] AIProviderRouter implementation complete
- [ ] Service container with DI
- [ ] API routes refactored to use services
- [ ] All existing functionality preserved
- [ ] Unit tests for services

---

### Week 4: Testing & Documentation

#### 1.4.1 Test Coverage Requirements

**Target: 80% coverage on new code**

| Layer | Target Coverage | Priority Tests |
|-------|-----------------|----------------|
| Services | 90% | ChatService, SubscriptionService |
| Repositories | 85% | FirestoreChatRepository |
| API Routes | 80% | /api/chat, /api/subscription |
| Stores | 85% | authStore, chatStoreV2 |
| Hooks | 75% | useStreamingChat |

#### 1.4.2 Test Structure

```
src/
├── services/
│   └── __tests__/
│       ├── ChatService.test.ts
│       ├── VoiceService.test.ts
│       ├── SubscriptionService.test.ts
│       └── AIProviderRouter.test.ts
├── repositories/
│   └── __tests__/
│       ├── FirestoreChatRepository.test.ts
│       └── FirestoreUserRepository.test.ts
└── test/
    ├── setup.ts
    ├── mocks/
    │   ├── firebase.ts
    │   ├── repositories.ts
    │   └── services.ts
    └── utils/
        ├── renderWithProviders.tsx
        └── createMockStore.ts
```

#### 1.4.3 Mock Utilities

**File: `src/test/mocks/repositories.ts`**

```typescript
import type { IChatRepository } from '@/repositories/interfaces/IChatRepository';
import type { IUserRepository } from '@/repositories/interfaces/IUserRepository';
import type { Chat, Message } from '@/shared/types';

export function createMockChatRepository(): jest.Mocked<IChatRepository> {
  return {
    getChats: jest.fn().mockResolvedValue([]),
    getChat: jest.fn().mockResolvedValue(null),
    createChat: jest.fn().mockImplementation((userId, input) =>
      Promise.resolve({
        id: 'mock-chat-id',
        contactId: input.contactId,
        title: input.title || '',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastMessage: null,
        lastMessageAt: null,
        messageCount: 0,
      })
    ),
    updateChat: jest.fn().mockResolvedValue(undefined),
    deleteChat: jest.fn().mockResolvedValue(undefined),
    getMessages: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    getMessage: jest.fn().mockResolvedValue(null),
    addMessage: jest.fn().mockImplementation((chatId, input) =>
      Promise.resolve({
        id: 'mock-message-id',
        chatId,
        role: input.role,
        content: input.content,
        createdAt: new Date(),
        audioUrl: null,
      })
    ),
    updateMessage: jest.fn().mockResolvedValue(undefined),
    deleteMessage: jest.fn().mockResolvedValue(undefined),
    syncFromLocal: jest.fn().mockResolvedValue(undefined),
    getLastSyncTime: jest.fn().mockResolvedValue(null),
  };
}

export function createMockUserRepository(): jest.Mocked<IUserRepository> {
  return {
    getProfile: jest.fn().mockResolvedValue(null),
    updateProfile: jest.fn().mockResolvedValue(undefined),
    getPreferences: jest.fn().mockResolvedValue(null),
    updatePreferences: jest.fn().mockResolvedValue(undefined),
    getSubscription: jest.fn().mockResolvedValue({
      tier: 'free',
      status: 'active',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    }),
    updateSubscription: jest.fn().mockResolvedValue(undefined),
    getClonedVoices: jest.fn().mockResolvedValue([]),
    addClonedVoice: jest.fn().mockResolvedValue({
      id: 'mock-voice-id',
      name: 'Test Voice',
      voiceId: 'elevenlabs-voice-id',
      createdAt: new Date(),
    }),
    deleteClonedVoice: jest.fn().mockResolvedValue(undefined),
    incrementMessageCount: jest.fn().mockResolvedValue(1),
    getMessageCount: jest.fn().mockResolvedValue(0),
    resetDailyMessageCount: jest.fn().mockResolvedValue(undefined),
  };
}
```

#### 1.4.4 Acceptance Criteria - Week 4

- [ ] 80%+ test coverage on new services/repositories
- [ ] All tests passing
- [ ] Mock utilities created for all dependencies
- [ ] Integration tests for critical paths
- [ ] Documentation updated (README, API docs)

---

## 4. Phase 2: Database & Caching (Weeks 5-8)

### Week 5: Supabase Setup

#### 2.1.1 Create Supabase Project

1. Go to https://supabase.com/dashboard
2. Create new project
3. Select region: `us-central1` (same as Firebase)
4. Save credentials

#### 2.1.2 Database Schema

**File: `supabase/migrations/001_initial_schema.sql`**

```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (synced from auth.users)
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User preferences
CREATE TABLE public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  theme TEXT DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  language TEXT DEFAULT 'en',
  voice_enabled BOOLEAN DEFAULT true,
  notifications_enabled BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscriptions
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'max')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Custom contacts
CREATE TABLE public.custom_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  gradient TEXT,
  system_prompt TEXT,
  voice_id TEXT,
  model TEXT DEFAULT 'gemini-flash',
  purpose TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, name)
);

-- Cloned voices
CREATE TABLE public.cloned_voices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  voice_id TEXT NOT NULL, -- ElevenLabs voice ID
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, name)
);

-- Chats
CREATE TABLE public.chats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL, -- Can be premade or custom contact ID
  title TEXT,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages (partitioned by month for scale)
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  audio_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Create partitions for 2025-2026
CREATE TABLE public.messages_2025_01 PARTITION OF public.messages
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE public.messages_2025_02 PARTITION OF public.messages
  FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE public.messages_2025_03 PARTITION OF public.messages
  FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE public.messages_2025_04 PARTITION OF public.messages
  FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE public.messages_2025_05 PARTITION OF public.messages
  FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE public.messages_2025_06 PARTITION OF public.messages
  FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE public.messages_2025_07 PARTITION OF public.messages
  FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE public.messages_2025_08 PARTITION OF public.messages
  FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE public.messages_2025_09 PARTITION OF public.messages
  FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE public.messages_2025_10 PARTITION OF public.messages
  FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE public.messages_2025_11 PARTITION OF public.messages
  FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE public.messages_2025_12 PARTITION OF public.messages
  FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
CREATE TABLE public.messages_2026_01 PARTITION OF public.messages
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
-- Continue for more months as needed

-- Daily usage tracking
CREATE TABLE public.daily_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  message_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, date)
);

-- Indexes
CREATE INDEX idx_chats_user_id ON public.chats(user_id);
CREATE INDEX idx_chats_updated_at ON public.chats(updated_at DESC);
CREATE INDEX idx_messages_chat_id ON public.messages(chat_id);
CREATE INDEX idx_messages_created_at ON public.messages(created_at DESC);
CREATE INDEX idx_custom_contacts_user_id ON public.custom_contacts(user_id);
CREATE INDEX idx_daily_usage_user_date ON public.daily_usage(user_id, date);

-- Updated at triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_chats_updated_at
  BEFORE UPDATE ON public.chats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_custom_contacts_updated_at
  BEFORE UPDATE ON public.custom_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloned_voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_usage ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own data" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own data" ON public.users
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can view own preferences" ON public.user_preferences
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view own subscription" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own contacts" ON public.custom_contacts
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own voices" ON public.cloned_voices
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own chats" ON public.chats
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage messages in own chats" ON public.messages
  FOR ALL USING (
    chat_id IN (SELECT id FROM public.chats WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can view own usage" ON public.daily_usage
  FOR ALL USING (auth.uid() = user_id);

-- Service role can do everything (for server-side operations)
CREATE POLICY "Service role has full access to users" ON public.users
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role has full access to subscriptions" ON public.subscriptions
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
```

#### 2.1.3 Supabase Client Setup

**File: `src/lib/supabase/client.ts`**

```typescript
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

**File: `src/lib/supabase/server.ts`**

```typescript
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch (error) {
            // Handle in middleware
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch (error) {
            // Handle in middleware
          }
        },
      },
    }
  );
}

// Service role client for server-side operations
export function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        get: () => undefined,
        set: () => {},
        remove: () => {},
      },
    }
  );
}
```

[... Document continues with Weeks 6-16 specifications ...]

---

## 5. Phase 3: Quality & Performance (Weeks 9-12)

*[Detailed specifications for TanStack Query integration, performance optimization, CI/CD setup]*

---

## 6. Phase 4: Polish & Scale (Weeks 13-16)

*[Detailed specifications for E2E testing, feature flags, monitoring, documentation]*

---

## 7. Rollback Procedures

### 7.1 Phase 1 Rollback (State Management)

```bash
# Restore context files from git
git checkout HEAD~X -- src/contexts/

# Update Providers.tsx to use old pattern
# Revert component imports
```

### 7.2 Phase 2 Rollback (Database)

```bash
# Set migration phase back to Firestore
MIGRATION_PHASE=firestore

# No data loss - Firestore still has all data
# Dual-write ensures both databases are in sync
```

### 7.3 General Rollback

Each phase is designed to be independently reversible:
- Keep old code commented (not deleted) for 1 sprint
- Feature flags control new functionality
- Database migrations are additive (no destructive changes)

---

## 8. Success Metrics

### 8.1 Performance Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| API Response Time (p95) | ~500ms | <200ms | Datadog APM |
| Time to First Byte | ~800ms | <400ms | Web Vitals |
| Bundle Size | ~500KB | <300KB | Bundle Analyzer |
| Lighthouse Score | ~70 | >90 | Lighthouse CI |

### 8.2 Quality Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Test Coverage | ~40% | >80% | Vitest Coverage |
| Type Coverage | ~95% | 100% | TypeScript strict |
| E2E Pass Rate | N/A | >95% | Playwright |
| Error Rate | Unknown | <0.1% | Sentry |

### 8.3 Cost Metrics

| Service | Baseline (est) | Target | At 1000 users |
|---------|----------------|--------|---------------|
| Firebase | $100/mo | N/A | $300/mo |
| Supabase | N/A | $25/mo | $50/mo |
| Redis | $10/mo | $10/mo | $20/mo |
| Total | $110/mo | $35/mo | $70/mo |

---

## Appendix A: File Change Summary

### Files to Create
```
src/
├── repositories/
│   ├── interfaces/
│   │   ├── IChatRepository.ts
│   │   ├── IUserRepository.ts
│   │   ├── IContactRepository.ts
│   │   └── index.ts
│   ├── firestore/
│   │   ├── FirestoreChatRepository.ts
│   │   ├── FirestoreUserRepository.ts
│   │   ├── FirestoreContactRepository.ts
│   │   └── index.ts
│   ├── supabase/
│   │   ├── SupabaseChatRepository.ts
│   │   ├── SupabaseUserRepository.ts
│   │   ├── SupabaseContactRepository.ts
│   │   └── index.ts
│   └── container.ts
├── services/
│   ├── interfaces/
│   │   ├── IChatService.ts
│   │   ├── IVoiceService.ts
│   │   ├── ISubscriptionService.ts
│   │   └── index.ts
│   ├── implementations/
│   │   ├── ChatService.ts
│   │   ├── VoiceService.ts
│   │   ├── SubscriptionService.ts
│   │   └── AIProviderRouter.ts
│   └── container.ts
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── types.ts
│   ├── cache/
│   │   ├── redis.ts
│   │   └── decorators.ts
│   ├── queue/
│   │   ├── client.ts
│   │   └── workers/
│   └── features/
│       └── flags.ts
└── test/
    └── mocks/
        ├── repositories.ts
        └── services.ts

supabase/
└── migrations/
    ├── 001_initial_schema.sql
    └── 002_functions.sql

.github/
└── workflows/
    ├── ci.yml
    ├── deploy-preview.yml
    └── deploy-production.yml
```

### Files to Delete
```
src/contexts/
├── AuthContext.tsx
├── ChatContext.tsx
├── SubscriptionContext.tsx
├── CustomContactsContext.tsx
├── ThemeContext.tsx
└── TranslatorContext.tsx (Week 2)
```

### Files to Modify
```
src/
├── components/Providers.tsx
├── stores/authStore.ts
├── stores/chatStoreV2.ts
├── app/api/chat/route.ts
├── app/api/*/route.ts (all API routes)
└── [all components using contexts]
```

---

## Appendix B: Environment Variables

### Development (.env.local)
```bash
# Existing
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
# ... other Firebase vars

# New - Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DATABASE_URL=postgresql://...

# New - Redis
REDIS_URL=redis://...

# New - Feature Flags
EDGE_CONFIG=...

# Migration Control
MIGRATION_PHASE=firestore
```

### Production (Vercel Environment Variables)
Same as development, with production values.

---

**End of Specification Document**

*Last Updated: January 2026*
*Version: 1.0*
