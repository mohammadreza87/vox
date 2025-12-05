'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { auth } from '@/lib/firebase';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Initialize with the correct theme to avoid mismatch
  // The inline script in layout.tsx has already applied the dark class if needed
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      // Check what the blocking script already set
      const isDark = document.documentElement.classList.contains('dark');
      return isDark ? 'dark' : 'light';
    }
    // SSR fallback - will be corrected on hydration
    return 'light';
  });
  const [mounted, setMounted] = useState(false);
  const hasLoadedFromCloud = useRef(false);
  const previousUserId = useRef<string | null>(null);

  // Load theme preference from cloud
  const loadThemeFromCloud = useCallback(async () => {
    if (!user) return null;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return null;

      const response = await fetch('/api/user/data', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) return null;

      const data = await response.json();
      return data.preferences?.theme as Theme | null;
    } catch (error) {
      console.error('Error loading theme from cloud:', error);
      return null;
    }
  }, [user]);

  // Save theme preference to cloud
  const saveThemeToCloud = useCallback(async (themeToSave: Theme) => {
    if (!user) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      await fetch('/api/user/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ preferences: { theme: themeToSave } }),
      });
    } catch (error) {
      console.error('Error saving theme to cloud:', error);
    }
  }, [user]);

  // Initial mount and sync with blocking script
  useEffect(() => {
    setMounted(true);
    // Sync state with what the blocking script already applied
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'dark' : 'light');
  }, []);

  // Load theme from cloud when user logs in
  useEffect(() => {
    const currentUserId = user?.uid || null;

    // Only load from cloud when user changes and is logged in
    if (currentUserId && currentUserId !== previousUserId.current) {
      previousUserId.current = currentUserId;

      const loadTheme = async () => {
        const cloudTheme = await loadThemeFromCloud();
        if (cloudTheme) {
          setTheme(cloudTheme);
          localStorage.setItem('theme', cloudTheme);
          // Apply the theme immediately
          if (cloudTheme === 'dark') {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
        } else {
          // No cloud preference - sync current preference to cloud
          const localTheme = localStorage.getItem('theme') as Theme | null;
          if (localTheme) {
            saveThemeToCloud(localTheme);
          }
        }
        hasLoadedFromCloud.current = true;
      };

      loadTheme();
    } else if (!currentUserId) {
      previousUserId.current = null;
      hasLoadedFromCloud.current = false;
    }
  }, [user, loadThemeFromCloud, saveThemeToCloud]);

  // Apply theme changes
  useEffect(() => {
    if (!mounted) return;

    // Update document class
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // Save to localStorage
    localStorage.setItem('theme', theme);
  }, [theme, mounted]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const newTheme = prev === 'light' ? 'dark' : 'light';
      // Save to cloud when user toggles
      if (user) {
        saveThemeToCloud(newTheme);
      }
      return newTheme;
    });
  }, [user, saveThemeToCloud]);

  // Always render children - the blocking script prevents flash
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
