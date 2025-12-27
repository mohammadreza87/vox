'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { Button, LoadingScreen } from '@/shared/components';
import { TelegramLoginButton, TelegramLoginUser } from '@/shared/components/TelegramLoginButton';
import { Volume2, Mail, Lock, User, Loader2 } from 'lucide-react';
import { getAuthErrorMessage } from '@/lib/auth-errors';
import { isTelegramMiniApp } from '@/lib/platform';
import { usePlatformStore } from '@/stores/platformStore';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading, signIn, signUp, signInWithGoogle } = useAuth();
  const { telegramSession, telegramUser } = usePlatformStore();
  const [isTelegram, setIsTelegram] = useState(false);
  const [checkingTelegram, setCheckingTelegram] = useState(true);
  const [processingTelegramRedirect, setProcessingTelegramRedirect] = useState(false);
  const [error, setError] = useState('');
  const telegramRedirectProcessed = useRef(false);

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

  // Handle Telegram Login Widget redirect flow
  // When user clicks "Log in as X", Telegram redirects back with query params
  useEffect(() => {
    if (telegramRedirectProcessed.current) return;

    const id = searchParams.get('id');
    const hash = searchParams.get('hash');
    const authDate = searchParams.get('auth_date');

    if (id && hash && authDate) {
      telegramRedirectProcessed.current = true;
      setProcessingTelegramRedirect(true);

      // Build user object from query params
      const tgUser: TelegramLoginUser = {
        id: parseInt(id, 10),
        first_name: searchParams.get('first_name') || '',
        last_name: searchParams.get('last_name') || undefined,
        username: searchParams.get('username') || undefined,
        photo_url: searchParams.get('photo_url') || undefined,
        auth_date: parseInt(authDate, 10),
        hash: hash,
      };

      // Clean up URL (remove query params)
      window.history.replaceState({}, '', '/login');

      // Process the auth inline
      (async () => {
        try {
          const response = await fetch('/api/auth/telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: tgUser }),
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || 'Telegram authentication failed');
          }

          if (data.sessionToken && data.user) {
            const session = {
              token: data.sessionToken,
              userId: data.user.id,
              telegramId: data.user.telegramId,
              exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
            };
            localStorage.setItem('telegram_session', JSON.stringify(session));
            router.push('/app');
          } else {
            throw new Error('No authentication token received');
          }
        } catch (err) {
          console.error('Telegram Sign-In Error:', err);
          setProcessingTelegramRedirect(false);
          setError(err instanceof Error ? err.message : 'Telegram authentication failed');
        }
      })();
    }
  }, [searchParams, router]);

  // Redirect to app if Telegram session is valid
  useEffect(() => {
    if (isTelegram && telegramSession && telegramSession.exp > Date.now()) {
      router.replace('/app');
    }
  }, [isTelegram, telegramSession, router]);

  // Redirect to app if Firebase user is logged in
  useEffect(() => {
    if (!authLoading && user) {
      router.push('/app');
    }
  }, [user, authLoading, router]);

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [showTelegramLogin, setShowTelegramLogin] = useState(false);

  // Check if we should show Telegram login widget (not on localhost, not in Telegram Mini App)
  useEffect(() => {
    const isLocalhost = window.location.hostname === 'localhost' ||
                        window.location.hostname === '127.0.0.1';
    const inTelegram = isTelegramMiniApp();
    setShowTelegramLogin(!isLocalhost && !inTelegram);
  }, []);

  // Show loading screen if in Telegram (auto-login in progress) or processing redirect
  if ((isTelegram && checkingTelegram) || processingTelegramRedirect) {
    return <LoadingScreen message="Signing in..." />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isSignUp) {
        await signUp(email, password, displayName);
      } else {
        await signIn(email, password);
      }
      router.push('/app');
    } catch (err: unknown) {
      setError(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);

    try {
      await signInWithGoogle();
      // Note: If using redirect, the page will navigate away
      // The redirect result is handled in AuthContext
      router.push('/app');
    } catch (err: unknown) {
      console.error('Google Sign-In Error:', err);
      setError(getAuthErrorMessage(err));
      setLoading(false);
    }
    // Don't set loading to false here - redirect will navigate away
  };

  const handleTelegramAuth = async (tgUser: TelegramLoginUser) => {
    setError('');
    setLoading(true);

    try {
      // Send to our API for verification
      const response = await fetch('/api/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: tgUser }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Telegram authentication failed');
      }

      // Store session token
      if (data.sessionToken && data.user) {
        const session = {
          token: data.sessionToken,
          userId: data.user.id,
          telegramId: data.user.telegramId,
          exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
        };
        localStorage.setItem('telegram_session', JSON.stringify(session));
        router.push('/app');
      } else {
        throw new Error('No authentication token received');
      }
    } catch (err: unknown) {
      console.error('Telegram Sign-In Error:', err);
      setError(err instanceof Error ? err.message : 'Telegram authentication failed');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col transition-colors overflow-auto relative" style={{ minHeight: '100dvh' }}>
      {/* Animated gradient background */}
      <div className="glass-background" />

      {/* Header */}
      <header className="p-6 flex items-center justify-center relative z-10">
        <Link href="/" className="flex items-center gap-2 w-fit">
          <div className="w-10 h-10 bg-gradient-to-br from-[#FF6D1F] to-[#ff8a4c] rounded-xl flex items-center justify-center shadow-lg shadow-[#FF6D1F]/30">
            <Volume2 className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-bold text-[var(--foreground)]">Vox</span>
        </Link>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-6 pb-12 relative z-10">
        <div className="w-full max-w-md">
          <div className="glass-dark rounded-3xl p-8 shadow-2xl transition-colors">
            <h1 className="text-2xl font-bold text-[var(--foreground)] text-center mb-2">
              {isSignUp ? 'Create Account' : 'Welcome Back'}
            </h1>
            <p className="text-[var(--foreground)]/60 text-center mb-8">
              {isSignUp
                ? 'Sign up to start talking with AI contacts'
                : 'Sign in to continue your conversations'}
            </p>

            {/* Error Message */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-500 px-4 py-3 rounded-2xl mb-6 text-sm">
                {error}
              </div>
            )}

            {/* Social Sign In Buttons */}
            <div className="space-y-3 mb-6">
              {/* Google Sign In */}
              <button
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 glass-light rounded-2xl hover:bg-white/30 transition-all disabled:opacity-50"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                <span className="text-[var(--foreground)] font-medium">Continue with Google</span>
              </button>

              {/* Telegram Sign In - only show on non-localhost */}
              {showTelegramLogin && (
                <div className="flex justify-center">
                  <TelegramLoginButton
                    onAuth={handleTelegramAuth}
                    buttonSize="large"
                    cornerRadius={16}
                    showUserPhoto={true}
                  />
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-4 mb-6">
              <div className="flex-1 h-px bg-[var(--foreground)]/10" />
              <span className="text-[var(--foreground)]/40 text-sm">or</span>
              <div className="flex-1 h-px bg-[var(--foreground)]/10" />
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {isSignUp && (
                <div>
                  <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
                    Name
                  </label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--foreground)]/40" />
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
                      required={isSignUp}
                      className="w-full pl-12 pr-4 py-3 glass-input rounded-2xl focus:outline-none text-[var(--foreground)] transition-colors"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--foreground)]/40" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full pl-12 pr-4 py-3 glass-input rounded-2xl focus:outline-none text-[var(--foreground)] transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--foreground)]/40" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    minLength={6}
                    className="w-full pl-12 pr-4 py-3 glass-input rounded-2xl focus:outline-none text-[var(--foreground)] transition-colors"
                  />
                </div>
              </div>

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    {isSignUp ? 'Creating Account...' : 'Signing In...'}
                  </>
                ) : isSignUp ? (
                  'Create Account'
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>

            {/* Toggle Sign Up / Sign In */}
            <p className="text-center mt-6 text-[var(--foreground)]/60">
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError('');
                }}
                className="text-[#FF6D1F] font-medium hover:underline"
              >
                {isSignUp ? 'Sign In' : 'Sign Up'}
              </button>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
