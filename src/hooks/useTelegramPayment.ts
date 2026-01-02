'use client';

import { useState, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { usePlatformStore } from '@/stores/platformStore';
import { getTelegramWebApp } from '@/lib/platform';

type PriceId = 'pro_monthly' | 'pro_annual' | 'max_monthly' | 'max_annual';

export function useTelegramPayment() {
  const user = useAuthStore((state) => state.user);
  const { telegramUser } = usePlatformStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPayment = useCallback(async (priceId: PriceId) => {
    if (!user?.uid || !telegramUser?.id) {
      setError('User not authenticated');
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      // Create invoice link
      const response = await fetch('/api/telegram/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceId,
          userId: user.uid,
          telegramId: telegramUser.id,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create payment');
      }

      // Open payment in Telegram
      const webApp = getTelegramWebApp();
      if (webApp?.openInvoice) {
        // Use Telegram's native invoice UI
        webApp.openInvoice(data.invoiceLink, (status) => {
          if (status === 'paid') {
            // Payment successful - reload subscription data
            window.location.reload();
          } else if (status === 'cancelled') {
            setError('Payment was cancelled');
          } else if (status === 'failed') {
            setError('Payment failed. Please try again.');
          }
        });
      } else {
        // Fallback: open invoice link in browser
        window.open(data.invoiceLink, '_blank');
      }

      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Payment failed';
      setError(errorMessage);
      return false;
    } finally {
      setLoading(false);
    }
  }, [user, telegramUser]);

  return {
    openPayment,
    loading,
    error,
    clearError: () => setError(null),
  };
}
