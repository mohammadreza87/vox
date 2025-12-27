'use client';

import { ReactNode, useEffect, useState } from 'react';
import { AppRoot } from '@telegram-apps/telegram-ui';
import '@telegram-apps/telegram-ui/dist/styles.css';
import { useThemeStore } from '@/stores/themeStore';
import { usePlatformStore } from '@/stores/platformStore';
import { isTelegramMiniApp, getTelegramWebApp } from '@/lib/platform';

interface TelegramProviderProps {
  children: ReactNode;
}

// Key for storing Telegram session in localStorage
const TELEGRAM_SESSION_KEY = 'telegram_session';

export function TelegramProvider({ children }: TelegramProviderProps) {
  const { theme } = useThemeStore();
  const { info, setTelegramUser, setTelegramSession } = usePlatformStore();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') return;

    // Check if we're in Telegram
    if (!isTelegramMiniApp()) {
      setIsReady(true);
      return;
    }

    const webApp = getTelegramWebApp();
    if (!webApp) {
      setIsReady(true);
      return;
    }

    // Initialize Telegram WebApp
    webApp.ready();
    webApp.expand();

    // Set user from Telegram
    if (webApp.initDataUnsafe.user) {
      setTelegramUser(webApp.initDataUnsafe.user);
    }

    // Authenticate with our backend
    authenticateWithBackend(webApp.initData).then(() => {
      setIsReady(true);
    });
  }, [setTelegramUser, setTelegramSession]);

  const authenticateWithBackend = async (initData: string) => {
    try {
      // Check if we have a valid session already
      const existingSession = localStorage.getItem(TELEGRAM_SESSION_KEY);
      if (existingSession) {
        try {
          const session = JSON.parse(existingSession);
          if (session.exp > Date.now()) {
            setTelegramSession(session);
            console.log('Using existing Telegram session');
            return;
          }
        } catch {
          localStorage.removeItem(TELEGRAM_SESSION_KEY);
        }
      }

      const response = await fetch('/api/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      });

      if (!response.ok) {
        console.error('Telegram auth failed:', await response.text());
        return;
      }

      const data = await response.json();

      // Store session token
      if (data.sessionToken && data.user) {
        const session = {
          token: data.sessionToken,
          userId: data.user.id,
          telegramId: data.user.telegramId,
          exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
        };
        localStorage.setItem(TELEGRAM_SESSION_KEY, JSON.stringify(session));
        setTelegramSession(session);
        console.log('Telegram auto-login successful');
      }
    } catch (error) {
      console.error('Telegram auth error:', error);
    }
  };

  // Don't render until ready
  if (!isReady) {
    return null;
  }

  // Only wrap with AppRoot if in Telegram
  if (!info.isTelegram) {
    return <>{children}</>;
  }

  return (
    <AppRoot
      appearance={theme === 'dark' ? 'dark' : 'light'}
      platform="ios"
    >
      {children}
    </AppRoot>
  );
}
