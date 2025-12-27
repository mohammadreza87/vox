/**
 * Auth Store
 * Manages user authentication state with Firebase
 */

import { create } from 'zustand';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  updateProfile,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import type { AuthStore } from './types';

export const useAuthStore = create<AuthStore>((set, get) => ({
  // State
  user: null,
  loading: true,
  initialized: false,

  // Actions
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  setInitialized: (initialized) => set({ initialized }),

  signIn: async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  },

  signUp: async (email: string, password: string, displayName: string) => {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(result.user, { displayName });
  },

  signInWithGoogle: async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      const firebaseError = error as { code?: string };
      // If popup fails, use redirect as fallback
      if (
        firebaseError.code === 'auth/popup-closed-by-user' ||
        firebaseError.code === 'auth/popup-blocked' ||
        firebaseError.code === 'auth/cancelled-popup-request'
      ) {
        await signInWithRedirect(auth, provider);
      } else {
        throw error;
      }
    }
  },

  logout: async () => {
    await signOut(auth);
  },

  updateUserProfile: async (data: { displayName?: string; photoURL?: string }) => {
    if (!auth.currentUser) throw new Error('No user logged in');
    await updateProfile(auth.currentUser, data);
    // Force refresh the user state
    set({ user: { ...auth.currentUser } as User });
  },
}));

/**
 * Initialize auth listener - call this once at app startup
 */
export function initAuthListener() {
  const store = useAuthStore.getState();

  // Check for redirect result
  getRedirectResult(auth)
    .then((result) => {
      if (result?.user) {
        store.setUser(result.user);
      }
    })
    .catch((error) => {
      console.error('Redirect result error:', error);
    });

  // Listen for auth state changes
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    store.setUser(user);
    store.setLoading(false);
    store.setInitialized(true);
  });

  return unsubscribe;
}

/**
 * Hook to get current user ID (useful for other stores)
 */
export function getCurrentUserId(): string | null {
  return useAuthStore.getState().user?.uid || null;
}
