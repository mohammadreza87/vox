'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { usePlatformStore } from '@/stores/platformStore';
import { isTelegramMiniApp } from '@/lib/platform';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const user = useAuthStore((state) => state.user);
  const authLoading = useAuthStore((state) => state.loading);
  const { telegramSession } = usePlatformStore();
  const router = useRouter();
  const [isTelegram, setIsTelegram] = useState(false);
  const [checkingTelegram, setCheckingTelegram] = useState(true);

  // Check if in Telegram Mini App
  useEffect(() => {
    const inTelegram = isTelegramMiniApp();
    setIsTelegram(inTelegram);

    // Give TelegramProvider time to authenticate
    if (inTelegram) {
      const timer = setTimeout(() => {
        setCheckingTelegram(false);
      }, 2000);
      return () => clearTimeout(timer);
    } else {
      setCheckingTelegram(false);
    }
  }, []);

  // Check if Telegram session is valid
  const hasTelegramSession = telegramSession && telegramSession.exp > Date.now();

  // Determine if user is authenticated (either Firebase or Telegram)
  const isAuthenticated = user || hasTelegramSession;

  useEffect(() => {
    // Wait for both auth checks to complete
    if (authLoading || (isTelegram && checkingTelegram)) {
      return;
    }

    // Redirect to login if not authenticated
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [user, authLoading, isTelegram, checkingTelegram, isAuthenticated, router]);

  // Show loading while checking auth
  if (authLoading || (isTelegram && checkingTelegram)) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center transition-colors">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#FF6D1F] mx-auto mb-4" />
          <p className="text-[var(--foreground)]/60">Loading...</p>
        </div>
      </div>
    );
  }

  // Show nothing while redirecting
  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
