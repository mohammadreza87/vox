/**
 * Auth Store
 * Manages user authentication state with Firebase
 *
 * This is the SINGLE SOURCE OF TRUTH for authentication state.
 * Do NOT use AuthContext - it is deprecated and will be removed.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
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

// Types
export interface AuthState {
  user: User | null;
  loading: boolean;
  initialized: boolean;
  error: string | null;
}

export interface AuthActions {
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  updateUserProfile: (data: { displayName?: string; photoURL?: string }) => Promise<void>;
}

export type AuthStore = AuthState & AuthActions;

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      // State
      user: null,
      loading: true,
      initialized: false,
      error: null,

      // Actions
      setUser: (user) => set({ user, error: null }),
      setLoading: (loading) => set({ loading }),
      setInitialized: (initialized) => set({ initialized }),
      setError: (error) => set({ error }),
      clearError: () => set({ error: null }),

      signIn: async (email: string, password: string) => {
        set({ loading: true, error: null });
        try {
          await signInWithEmailAndPassword(auth, email, password);
        } catch (error) {
          const message = getFirebaseErrorMessage(error);
          set({ error: message, loading: false });
          throw error;
        }
      },

      signUp: async (email: string, password: string, displayName: string) => {
        set({ loading: true, error: null });
        try {
          const result = await createUserWithEmailAndPassword(auth, email, password);
          await updateProfile(result.user, { displayName });
        } catch (error) {
          const message = getFirebaseErrorMessage(error);
          set({ error: message, loading: false });
          throw error;
        }
      },

      signInWithGoogle: async () => {
        set({ loading: true, error: null });
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
            const message = getFirebaseErrorMessage(error);
            set({ error: message, loading: false });
            throw error;
          }
        }
      },

      logout: async () => {
        set({ loading: true, error: null });
        try {
          await signOut(auth);
          set({ user: null, loading: false });
        } catch (error) {
          const message = getFirebaseErrorMessage(error);
          set({ error: message, loading: false });
          throw error;
        }
      },

      updateUserProfile: async (data: { displayName?: string; photoURL?: string }) => {
        if (!auth.currentUser) {
          set({ error: 'No user logged in' });
          throw new Error('No user logged in');
        }
        set({ loading: true, error: null });
        try {
          await updateProfile(auth.currentUser, data);
          // Force refresh the user state
          set({ user: { ...auth.currentUser } as User, loading: false });
        } catch (error) {
          const message = getFirebaseErrorMessage(error);
          set({ error: message, loading: false });
          throw error;
        }
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      // Only persist minimal user info for faster hydration
      partialize: (state) => ({
        // We don't persist the full user object as Firebase handles session
        // Just store a flag that user was previously logged in for UI optimization
      }),
    }
  )
);

/**
 * Convert Firebase error codes to user-friendly messages
 */
function getFirebaseErrorMessage(error: unknown): string {
  const firebaseError = error as { code?: string; message?: string };

  switch (firebaseError.code) {
    case 'auth/email-already-in-use':
      return 'This email is already registered. Please sign in instead.';
    case 'auth/invalid-email':
      return 'Invalid email address.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled.';
    case 'auth/weak-password':
      return 'Password is too weak. Please use at least 6 characters.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/user-not-found':
      return 'No account found with this email.';
    case 'auth/wrong-password':
      return 'Incorrect password.';
    case 'auth/invalid-credential':
      return 'Invalid email or password.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your connection.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in popup was closed.';
    case 'auth/popup-blocked':
      return 'Sign-in popup was blocked. Please allow popups.';
    default:
      return firebaseError.message || 'An error occurred. Please try again.';
  }
}

/**
 * Initialize auth listener - call this once at app startup
 * Returns unsubscribe function for cleanup
 */
export function initAuthListener(): () => void {
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
      store.setError(getFirebaseErrorMessage(error));
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

// Selectors for optimized re-renders
export const selectUser = (state: AuthStore) => state.user;
export const selectIsAuthenticated = (state: AuthStore) => !!state.user;
export const selectIsLoading = (state: AuthStore) => state.loading;
export const selectIsInitialized = (state: AuthStore) => state.initialized;
export const selectAuthError = (state: AuthStore) => state.error;
