/**
 * Theme Store
 * Manages theme state with localStorage persistence and cloud sync
 */

import { create } from 'zustand';
import type { Theme, ThemeStore } from './types';
import { getCurrentUserId } from './authStore';
import { getAuthToken } from './middleware/sync';

const THEME_STORAGE_KEY = 'theme';

export const useThemeStore = create<ThemeStore>((set, get) => ({
  // State
  theme: 'light',
  mounted: false,

  // Actions
  setTheme: (theme: Theme) => {
    set({ theme });
    get().applyTheme(theme);

    // Save to localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }

    // Sync to cloud if user is logged in
    const userId = getCurrentUserId();
    if (userId) {
      syncThemeToCloud(theme);
    }
  },

  toggleTheme: () => {
    const newTheme = get().theme === 'light' ? 'dark' : 'light';
    get().setTheme(newTheme);
  },

  setMounted: (mounted: boolean) => set({ mounted }),

  syncFromDocument: () => {
    if (typeof window !== 'undefined') {
      const isDark = document.documentElement.classList.contains('dark');
      set({ theme: isDark ? 'dark' : 'light' });
    }
  },

  applyTheme: (theme: Theme) => {
    if (typeof window === 'undefined') return;

    // Update document class
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // Update theme-color meta tag
    const themeColor = theme === 'dark' ? '#0a0a0a' : '#f5f5f7';
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', themeColor);
    }
  },
}));

/**
 * Sync theme to cloud
 */
async function syncThemeToCloud(theme: Theme): Promise<void> {
  const token = await getAuthToken();
  if (!token) return;

  try {
    await fetch('/api/user/data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ preferences: { theme } }),
    });
  } catch (error) {
    console.error('Error saving theme to cloud:', error);
  }
}

/**
 * Load theme from cloud
 */
async function loadThemeFromCloud(): Promise<Theme | null> {
  const token = await getAuthToken();
  if (!token) return null;

  try {
    const response = await fetch('/api/user/data', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    return (data.preferences?.theme as Theme) || null;
  } catch (error) {
    console.error('Error loading theme from cloud:', error);
    return null;
  }
}

/**
 * Initialize theme - call this once at app startup (after auth is ready)
 */
export async function initTheme(userId: string | null): Promise<void> {
  const store = useThemeStore.getState();

  // Sync with what the blocking script already applied
  store.syncFromDocument();
  store.setMounted(true);

  // If user is logged in, try to load theme from cloud
  if (userId) {
    const cloudTheme = await loadThemeFromCloud();
    if (cloudTheme) {
      store.setTheme(cloudTheme);
    } else {
      // No cloud preference - sync current preference to cloud
      const localTheme = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
      if (localTheme) {
        syncThemeToCloud(localTheme);
      }
    }
  }
}
