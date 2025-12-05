'use client';

import { ReactNode } from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ChatProvider } from '@/contexts/ChatContext';
import { SubscriptionProvider } from '@/contexts/SubscriptionContext';
import { CustomContactsProvider } from '@/contexts/CustomContactsContext';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ThemeProvider>
        <SubscriptionProvider>
          <CustomContactsProvider>
            <ChatProvider>
              {children}
              <UpgradeModal />
            </ChatProvider>
          </CustomContactsProvider>
        </SubscriptionProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
