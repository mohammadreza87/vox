import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore, initAuthListener, getCurrentUserId } from './authStore';

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
});
