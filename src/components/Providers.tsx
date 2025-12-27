'use client';

import { ReactNode } from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ChatProvider } from '@/contexts/ChatContext';
import { SubscriptionProvider } from '@/contexts/SubscriptionContext';
import { CustomContactsProvider } from '@/contexts/CustomContactsContext';
import { TranslatorProvider } from '@/contexts/TranslatorContext';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';
import { TelegramProvider } from '@/components/TelegramProvider';
// Zustand stores (Phase 2 - gradually migrate to these)
// import { StoreProvider } from '@/stores';

// Feature flag for gradual migration to Zustand stores
// Set to true to enable Zustand stores (Phase 2 migration)
const USE_ZUSTAND_STORES = false;

/**
 * Providers component
 *
 * Currently uses React Context for state management.
 * Phase 2 migration will replace contexts with Zustand stores.
 *
 * To migrate:
 * 1. Set USE_ZUSTAND_STORES = true
 * 2. Update components to use hooks from '@/stores' instead of '@/contexts/*'
 * 3. Remove old context providers once all consumers are migrated
 */
export function Providers({ children }: { children: ReactNode }) {
  // During migration, both systems will coexist
  // Old contexts continue to work while we migrate consumers to Zustand hooks
  return (
    <AuthProvider>
      <ThemeProvider>
        <TelegramProvider>
          <SubscriptionProvider>
            <CustomContactsProvider>
              <TranslatorProvider>
                <ChatProvider>
                  {children}
                  <UpgradeModal />
                </ChatProvider>
              </TranslatorProvider>
            </CustomContactsProvider>
          </SubscriptionProvider>
        </TelegramProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}

/**
 * Future Providers (Zustand-based)
 * Uncomment and use when ready to migrate
 */
// export function ProvidersV2({ children }: { children: ReactNode }) {
//   return (
//     <StoreProvider>
//       <TelegramProvider>
//         {children}
//         <UpgradeModal />
//       </TelegramProvider>
//     </StoreProvider>
//   );
// }
