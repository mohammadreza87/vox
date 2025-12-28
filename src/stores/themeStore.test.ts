import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useThemeStore } from './themeStore';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock authStore
vi.mock('./authStore', () => ({
  getCurrentUserId: vi.fn(() => null),
}));

// Mock sync middleware
vi.mock('./middleware/sync', () => ({
  getAuthToken: vi.fn(() => null),
}));

describe('themeStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    vi.mocked(localStorage.setItem).mockClear();
    useThemeStore.setState({
      theme: 'light',
      mounted: false,
    });
    vi.mocked(document.documentElement.classList.contains).mockReturnValue(false);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Initial State', () => {
    it('has correct initial state', () => {
      const state = useThemeStore.getState();
      expect(state.theme).toBe('light');
      expect(state.mounted).toBe(false);
    });
  });

  describe('setTheme', () => {
    it('updates theme to dark', () => {
      useThemeStore.getState().setTheme('dark');
      expect(useThemeStore.getState().theme).toBe('dark');
    });

    it('updates theme to light', () => {
      useThemeStore.setState({ theme: 'dark' });
      useThemeStore.getState().setTheme('light');
      expect(useThemeStore.getState().theme).toBe('light');
    });

    it('saves theme to localStorage', () => {
      useThemeStore.getState().setTheme('dark');
      expect(localStorage.setItem).toHaveBeenCalledWith('theme', 'dark');
    });

    it('applies theme to document', () => {
      useThemeStore.getState().setTheme('dark');
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
    });
  });

  describe('toggleTheme', () => {
    it('toggles from light to dark', () => {
      useThemeStore.setState({ theme: 'light' });
      useThemeStore.getState().toggleTheme();
      expect(useThemeStore.getState().theme).toBe('dark');
    });

    it('toggles from dark to light', () => {
      useThemeStore.setState({ theme: 'dark' });
      useThemeStore.getState().toggleTheme();
      expect(useThemeStore.getState().theme).toBe('light');
    });
  });

  describe('setMounted', () => {
    it('sets mounted to true', () => {
      useThemeStore.getState().setMounted(true);
      expect(useThemeStore.getState().mounted).toBe(true);
    });

    it('sets mounted to false', () => {
      useThemeStore.setState({ mounted: true });
      useThemeStore.getState().setMounted(false);
      expect(useThemeStore.getState().mounted).toBe(false);
    });
  });

  describe('syncFromDocument', () => {
    it('syncs dark theme from document', () => {
      vi.mocked(document.documentElement.classList.contains).mockReturnValue(true);
      useThemeStore.getState().syncFromDocument();
      expect(useThemeStore.getState().theme).toBe('dark');
    });

    it('syncs light theme from document', () => {
      vi.mocked(document.documentElement.classList.contains).mockReturnValue(false);
      useThemeStore.getState().syncFromDocument();
      expect(useThemeStore.getState().theme).toBe('light');
    });
  });

  describe('applyTheme', () => {
    it('adds dark class for dark theme', () => {
      useThemeStore.getState().applyTheme('dark');
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
    });

    it('removes dark class for light theme', () => {
      useThemeStore.getState().applyTheme('light');
      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark');
    });
  });
});
