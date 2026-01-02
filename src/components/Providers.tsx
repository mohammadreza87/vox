'use client';

import { ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initAuthListener, useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { initSubscription } from '@/stores/subscriptionStore';
import { initChatsV2 } from '@/stores/chatStoreV2';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';
import { TelegramProvider } from '@/components/TelegramProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// DEPRECATED: These contexts are being migrated to Zustand stores
// They are kept temporarily for backwards compatibility during migration
// TODO: Remove after all consumers are migrated
import { TranslatorProvider } from '@/contexts/TranslatorContext';

/**
 * Create QueryClient with sensible defaults
 */
function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000, // 1 minute
        gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
        retry: 2,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: 1,
      },
    },
  });
}

// Singleton query client to prevent hydration issues
let queryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    // Server: always create a new query client
    return createQueryClient();
  }
  // Browser: reuse client across app
  if (!queryClient) {
    queryClient = createQueryClient();
  }
  return queryClient;
}

/**
 * Initialize all stores when user auth state changes
 */
function StoreInitializer({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const user = useAuthStore((state) => state.user);
  const initialized = useAuthStore((state) => state.initialized);

  // Initialize auth listener on mount
  useEffect(() => {
    setMounted(true);
    const unsubscribe = initAuthListener();
    return () => unsubscribe();
  }, []);

  // Initialize other stores when user changes
  useEffect(() => {
    if (initialized && user) {
      // Initialize subscription and chats for logged-in user
      initSubscription();
      initChatsV2();
    }
  }, [user, initialized]);

  // Prevent flash of incorrect theme
  if (!mounted) {
    return null;
  }

  return <>{children}</>;
}

/**
 * Apply theme from store to document
 */
function ThemeApplier({ children }: { children: ReactNode }) {
  const theme = useThemeStore((state) => state.theme);
  const mounted = useThemeStore((state) => state.mounted);
  const setMounted = useThemeStore((state) => state.setMounted);

  useEffect(() => {
    setMounted(true);
  }, [setMounted]);

  useEffect(() => {
    if (mounted) {
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }
  }, [theme, mounted]);

  return <>{children}</>;
}

/**
 * Main Providers component
 *
 * Architecture:
 * - QueryClientProvider: Server state management (API caching, deduplication)
 * - StoreInitializer: Zustand store initialization and auth listener
 * - ThemeApplier: Applies theme class to document
 * - TelegramProvider: Telegram Mini App integration
 * - TranslatorProvider: DEPRECATED - will be migrated to store
 *
 * Migration Status:
 * - AuthContext -> authStore ✅ DONE
 * - ThemeContext -> themeStore ✅ DONE
 * - SubscriptionContext -> subscriptionStore ✅ DONE
 * - ChatContext -> chatStoreV2 ✅ DONE
 * - CustomContactsContext -> contactsStore ✅ DONE
 * - TranslatorContext -> translatorStore 🔄 IN PROGRESS
 */
export function Providers({ children }: { children: ReactNode }) {
  const client = getQueryClient();

  return (
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <StoreInitializer>
          <ThemeApplier>
            <TelegramProvider>
              {/* TranslatorProvider kept temporarily for backwards compatibility */}
              <TranslatorProvider>
                {children}
                <UpgradeModal />
              </TranslatorProvider>
            </TelegramProvider>
          </ThemeApplier>
        </StoreInitializer>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
