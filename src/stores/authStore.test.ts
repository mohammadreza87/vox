import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  useAuthStore,
  initAuthListener,
  getCurrentUserId,
  selectUser,
  selectIsAuthenticated,
  selectIsLoading,
  selectIsInitialized,
  selectAuthError,
} from './authStore';

// Mock Firebase Auth
const mockSignInWithEmailAndPassword = vi.fn();
const mockCreateUserWithEmailAndPassword = vi.fn();
const mockSignOut = vi.fn();
const mockSignInWithPopup = vi.fn();
const mockSignInWithRedirect = vi.fn();
const mockGetRedirectResult = vi.fn();
const mockUpdateProfile = vi.fn();
const mockOnAuthStateChanged = vi.fn();

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
  signInWithEmailAndPassword: (...args: unknown[]) => mockSignInWithEmailAndPassword(...args),
  createUserWithEmailAndPassword: (...args: unknown[]) =>
    mockCreateUserWithEmailAndPassword(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  signInWithPopup: (...args: unknown[]) => mockSignInWithPopup(...args),
  signInWithRedirect: (...args: unknown[]) => mockSignInWithRedirect(...args),
  getRedirectResult: (...args: unknown[]) => mockGetRedirectResult(...args),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
  GoogleAuthProvider: class MockGoogleAuthProvider {},
}));

// Mock Firebase instance
vi.mock('@/lib/firebase', () => ({
  auth: {
    currentUser: null,
  },
}));

const { auth } = await import('@/lib/firebase');

describe('authStore', () => {
  const mockUser = {
    uid: 'user-123',
    email: 'test@example.com',
    displayName: 'Test User',
    photoURL: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      loading: true,
      initialized: false,
      error: null,
    });
    mockGetRedirectResult.mockResolvedValue(null);
    mockOnAuthStateChanged.mockReturnValue(() => {});
  });

  describe('Initial State', () => {
    it('has correct initial state', () => {
      const state = useAuthStore.getState();
      expect(state.user).toBe(null);
      expect(state.loading).toBe(true);
      expect(state.initialized).toBe(false);
      expect(state.error).toBe(null);
    });
  });

  describe('Error State', () => {
    it('sets error', () => {
      useAuthStore.getState().setError('Test error');
      expect(useAuthStore.getState().error).toBe('Test error');
    });

    it('clears error', () => {
      useAuthStore.setState({ error: 'Existing error' });
      useAuthStore.getState().clearError();
      expect(useAuthStore.getState().error).toBe(null);
    });

    it('clears error when setting user', () => {
      useAuthStore.setState({ error: 'Existing error' });
      useAuthStore.getState().setUser(mockUser as never);
      expect(useAuthStore.getState().error).toBe(null);
    });
  });

  describe('setUser', () => {
    it('sets user', () => {
      useAuthStore.getState().setUser(mockUser as never);
      expect(useAuthStore.getState().user).toEqual(mockUser);
    });

    it('clears user', () => {
      useAuthStore.setState({ user: mockUser as never });
      useAuthStore.getState().setUser(null);
      expect(useAuthStore.getState().user).toBe(null);
    });
  });

  describe('setLoading', () => {
    it('sets loading state', () => {
      useAuthStore.getState().setLoading(false);
      expect(useAuthStore.getState().loading).toBe(false);
    });
  });

  describe('setInitialized', () => {
    it('sets initialized state', () => {
      useAuthStore.getState().setInitialized(true);
      expect(useAuthStore.getState().initialized).toBe(true);
    });
  });

  describe('signIn', () => {
    it('calls Firebase signInWithEmailAndPassword', async () => {
      mockSignInWithEmailAndPassword.mockResolvedValueOnce({ user: mockUser });

      await useAuthStore.getState().signIn('test@example.com', 'password123');

      expect(mockSignInWithEmailAndPassword).toHaveBeenCalledWith(
        auth,
        'test@example.com',
        'password123'
      );
    });

    it('clears error before signing in', async () => {
      useAuthStore.setState({ error: 'Previous error' });
      mockSignInWithEmailAndPassword.mockResolvedValueOnce({ user: mockUser });

      await useAuthStore.getState().signIn('test@example.com', 'password123');

      // Error should be cleared during sign in
      expect(useAuthStore.getState().error).toBe(null);
    });

    it('sets error state on failure', async () => {
      const firebaseError = { code: 'auth/wrong-password', message: 'Wrong password' };
      mockSignInWithEmailAndPassword.mockRejectedValueOnce(firebaseError);

      await expect(useAuthStore.getState().signIn('test@example.com', 'wrong')).rejects.toBeDefined();

      expect(useAuthStore.getState().error).toBe('Incorrect password.');
      expect(useAuthStore.getState().loading).toBe(false);
    });

    it('sets user-friendly error for invalid credentials', async () => {
      const firebaseError = { code: 'auth/invalid-credential', message: 'Invalid' };
      mockSignInWithEmailAndPassword.mockRejectedValueOnce(firebaseError);

      await expect(useAuthStore.getState().signIn('test@example.com', 'wrong')).rejects.toBeDefined();

      expect(useAuthStore.getState().error).toBe('Invalid email or password.');
    });

    it('sets user-friendly error for too many requests', async () => {
      const firebaseError = { code: 'auth/too-many-requests', message: 'Too many' };
      mockSignInWithEmailAndPassword.mockRejectedValueOnce(firebaseError);

      await expect(useAuthStore.getState().signIn('test@example.com', 'wrong')).rejects.toBeDefined();

      expect(useAuthStore.getState().error).toBe('Too many failed attempts. Please try again later.');
    });

    it('throws on error', async () => {
      mockSignInWithEmailAndPassword.mockRejectedValueOnce(new Error('Invalid credentials'));

      await expect(useAuthStore.getState().signIn('test@example.com', 'wrong')).rejects.toThrow(
        'Invalid credentials'
      );
    });
  });

  describe('signUp', () => {
    it('creates user and updates profile', async () => {
      mockCreateUserWithEmailAndPassword.mockResolvedValueOnce({ user: mockUser });
      mockUpdateProfile.mockResolvedValueOnce(undefined);

      await useAuthStore.getState().signUp('test@example.com', 'password123', 'Test User');

      expect(mockCreateUserWithEmailAndPassword).toHaveBeenCalledWith(
        auth,
        'test@example.com',
        'password123'
      );
      expect(mockUpdateProfile).toHaveBeenCalledWith(mockUser, { displayName: 'Test User' });
    });
  });

  describe('signInWithGoogle', () => {
    it('uses popup by default', async () => {
      mockSignInWithPopup.mockResolvedValueOnce({ user: mockUser });

      await useAuthStore.getState().signInWithGoogle();

      expect(mockSignInWithPopup).toHaveBeenCalled();
    });

    it('falls back to redirect on popup blocked', async () => {
      mockSignInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
      mockSignInWithRedirect.mockResolvedValueOnce(undefined);

      await useAuthStore.getState().signInWithGoogle();

      expect(mockSignInWithRedirect).toHaveBeenCalled();
    });

    it('throws on other errors', async () => {
      mockSignInWithPopup.mockRejectedValueOnce(new Error('Network error'));

      await expect(useAuthStore.getState().signInWithGoogle()).rejects.toThrow('Network error');
    });
  });

  describe('logout', () => {
    it('calls Firebase signOut', async () => {
      mockSignOut.mockResolvedValueOnce(undefined);

      await useAuthStore.getState().logout();

      expect(mockSignOut).toHaveBeenCalledWith(auth);
    });
  });

  describe('updateUserProfile', () => {
    it('updates profile when logged in', async () => {
      (auth as { currentUser: unknown }).currentUser = mockUser;
      mockUpdateProfile.mockResolvedValueOnce(undefined);

      await useAuthStore.getState().updateUserProfile({ displayName: 'New Name' });

      expect(mockUpdateProfile).toHaveBeenCalledWith(mockUser, { displayName: 'New Name' });
    });

    it('throws when not logged in', async () => {
      (auth as { currentUser: unknown }).currentUser = null;

      await expect(
        useAuthStore.getState().updateUserProfile({ displayName: 'New Name' })
      ).rejects.toThrow('No user logged in');
    });
  });

  describe('initAuthListener', () => {
    it('sets up auth state listener', () => {
      initAuthListener();

      expect(mockOnAuthStateChanged).toHaveBeenCalled();
      expect(mockGetRedirectResult).toHaveBeenCalled();
    });

    it('returns unsubscribe function', () => {
      const mockUnsubscribe = vi.fn();
      mockOnAuthStateChanged.mockReturnValue(mockUnsubscribe);

      const unsubscribe = initAuthListener();

      expect(unsubscribe).toBe(mockUnsubscribe);
    });

    it('updates store on auth state change', () => {
      let authCallback: ((user: unknown) => void) | null = null;
      mockOnAuthStateChanged.mockImplementation((_, callback) => {
        authCallback = callback;
        return () => {};
      });

      initAuthListener();

      // Simulate auth state change
      authCallback?.(mockUser);

      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(useAuthStore.getState().loading).toBe(false);
      expect(useAuthStore.getState().initialized).toBe(true);
    });

    it('handles redirect result', async () => {
      mockGetRedirectResult.mockResolvedValueOnce({ user: mockUser });
      mockOnAuthStateChanged.mockReturnValue(() => {});

      initAuthListener();

      // Wait for redirect result
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(useAuthStore.getState().user).toEqual(mockUser);
    });
  });

  describe('getCurrentUserId', () => {
    it('returns user id when logged in', () => {
      useAuthStore.setState({ user: mockUser as never });

      expect(getCurrentUserId()).toBe('user-123');
    });

    it('returns null when not logged in', () => {
      useAuthStore.setState({ user: null });

      expect(getCurrentUserId()).toBe(null);
    });
  });

  describe('Selectors', () => {
    it('selectUser returns user', () => {
      useAuthStore.setState({ user: mockUser as never });
      const state = useAuthStore.getState();
      expect(selectUser(state)).toEqual(mockUser);
    });

    it('selectIsAuthenticated returns true when user exists', () => {
      useAuthStore.setState({ user: mockUser as never });
      const state = useAuthStore.getState();
      expect(selectIsAuthenticated(state)).toBe(true);
    });

    it('selectIsAuthenticated returns false when no user', () => {
      useAuthStore.setState({ user: null });
      const state = useAuthStore.getState();
      expect(selectIsAuthenticated(state)).toBe(false);
    });

    it('selectIsLoading returns loading state', () => {
      useAuthStore.setState({ loading: true });
      expect(selectIsLoading(useAuthStore.getState())).toBe(true);

      useAuthStore.setState({ loading: false });
      expect(selectIsLoading(useAuthStore.getState())).toBe(false);
    });

    it('selectIsInitialized returns initialized state', () => {
      useAuthStore.setState({ initialized: false });
      expect(selectIsInitialized(useAuthStore.getState())).toBe(false);

      useAuthStore.setState({ initialized: true });
      expect(selectIsInitialized(useAuthStore.getState())).toBe(true);
    });

    it('selectAuthError returns error state', () => {
      useAuthStore.setState({ error: null });
      expect(selectAuthError(useAuthStore.getState())).toBe(null);

      useAuthStore.setState({ error: 'Test error' });
      expect(selectAuthError(useAuthStore.getState())).toBe('Test error');
    });
  });

  describe('signUp error handling', () => {
    it('sets error state on email already in use', async () => {
      const firebaseError = { code: 'auth/email-already-in-use', message: 'Email in use' };
      mockCreateUserWithEmailAndPassword.mockRejectedValueOnce(firebaseError);

      await expect(
        useAuthStore.getState().signUp('test@example.com', 'password123', 'Test')
      ).rejects.toBeDefined();

      expect(useAuthStore.getState().error).toBe('This email is already registered. Please sign in instead.');
    });

    it('sets error state on weak password', async () => {
      const firebaseError = { code: 'auth/weak-password', message: 'Weak password' };
      mockCreateUserWithEmailAndPassword.mockRejectedValueOnce(firebaseError);

      await expect(
        useAuthStore.getState().signUp('test@example.com', '123', 'Test')
      ).rejects.toBeDefined();

      expect(useAuthStore.getState().error).toBe('Password is too weak. Please use at least 6 characters.');
    });
  });
});
