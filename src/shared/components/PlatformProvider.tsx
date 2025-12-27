'use client';

import { ReactNode, useEffect } from 'react';
import { usePlatformStore } from '@/stores/platformStore';
import { useThemeStore } from '@/stores/themeStore';
import { getTelegramWebApp } from '@/lib/platform';

interface PlatformProviderProps {
  children: ReactNode;
}

/**
 * Platform provider component
 * Initializes platform detection and syncs with Telegram theme
 */
export function PlatformProvider({ children }: PlatformProviderProps) {
  const initialize = usePlatformStore((state) => state.initialize);
  const isInitialized = usePlatformStore((state) => state.isInitialized);
  const info = usePlatformStore((state) => state.info);
  const { setTheme } = useThemeStore();

  // Initialize platform on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Sync theme with Telegram
  useEffect(() => {
    if (!info.isTelegram) return;

    const webApp = getTelegramWebApp();
    if (!webApp) return;

    // Set initial theme from Telegram
    setTheme(webApp.colorScheme);

    // Listen for theme changes (Telegram can change theme while app is open)
    const handleThemeChange = () => {
      const newWebApp = getTelegramWebApp();
      if (newWebApp) {
        setTheme(newWebApp.colorScheme);
      }
    };

    // Telegram doesn't have a direct theme change event,
    // but we can poll or use visibility change as a proxy
    document.addEventListener('visibilitychange', handleThemeChange);

    return () => {
      document.removeEventListener('visibilitychange', handleThemeChange);
    };
  }, [info.isTelegram, setTheme]);

  // Apply Telegram colors to CSS variables
  useEffect(() => {
    if (!info.isTelegram) return;

    const webApp = getTelegramWebApp();
    if (!webApp?.themeParams) return;

    const root = document.documentElement;
    const { themeParams } = webApp;

    // Map Telegram theme colors to CSS variables
    if (themeParams.bg_color) {
      root.style.setProperty('--telegram-bg', themeParams.bg_color);
    }
    if (themeParams.text_color) {
      root.style.setProperty('--telegram-text', themeParams.text_color);
    }
    if (themeParams.hint_color) {
      root.style.setProperty('--telegram-hint', themeParams.hint_color);
    }
    if (themeParams.link_color) {
      root.style.setProperty('--telegram-link', themeParams.link_color);
    }
    if (themeParams.button_color) {
      root.style.setProperty('--telegram-button', themeParams.button_color);
    }
    if (themeParams.button_text_color) {
      root.style.setProperty('--telegram-button-text', themeParams.button_text_color);
    }
    if (themeParams.secondary_bg_color) {
      root.style.setProperty('--telegram-secondary-bg', themeParams.secondary_bg_color);
    }
  }, [info.isTelegram]);

  // Show nothing until initialized (prevents flash)
  if (!isInitialized && typeof window !== 'undefined') {
    return null;
  }

  return <>{children}</>;
}
