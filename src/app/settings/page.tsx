'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, User, Volume2, CreditCard, Crown, ExternalLink, Loader2, Sun, Moon, Palette } from 'lucide-react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/shared/components/Button';
import { auth } from '@/lib/firebase';
import { cn } from '@/shared/utils/cn';
import { useEntranceAnimation } from '@/hooks/useAnimations';

// Storage key for user settings
const getUserSettingsKey = (userId: string | null) =>
  userId ? `vox_user_settings_${userId}` : 'vox_user_settings';

interface UserSettings {
  displayName: string;
  fullName: string;
  voxCallName: string; // What the user wants Vox to call them
}

const DEFAULT_SETTINGS: UserSettings = {
  displayName: '',
  fullName: '',
  voxCallName: '',
};

export default function SettingsPage() {
  return (
    <ProtectedRoute>
      <SettingsContent />
    </ProtectedRoute>
  );
}

function SettingsContent() {
  const router = useRouter();
  const { user, updateUserProfile } = useAuth();
  const { tier, subscription, isLoading: subscriptionLoading, refreshSubscription } = useSubscription();
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [isSaving, setIsSaving] = useState(false);
  const [isManagingSubscription, setIsManagingSubscription] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // GSAP Animation refs - single page entrance
  const { ref: pageRef } = useEntranceAnimation('fadeUp', { delay: 0 });

  // Open Stripe Customer Portal
  const handleManageSubscription = async () => {
    setIsManagingSubscription(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch('/api/stripe/create-portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          returnUrl: window.location.href,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to open portal');
      }

      const { url } = await response.json();
      window.location.href = url;
    } catch (error) {
      console.error('Error opening subscription portal:', error);
      setSaveMessage({ type: 'error', text: 'Failed to open subscription management. Please try again.' });
    } finally {
      setIsManagingSubscription(false);
    }
  };

  // Get tier display info
  const getTierInfo = () => {
    switch (tier) {
      case 'max':
        return { name: 'Max', color: 'bg-purple-500', textColor: 'text-purple-500' };
      case 'pro':
        return { name: 'Pro', color: 'bg-[#FF6D1F]', textColor: 'text-[#FF6D1F]' };
      default:
        return { name: 'Free', color: 'bg-gray-400', textColor: 'text-gray-500' };
    }
  };

  const tierInfo = getTierInfo();

  // Load settings on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && user) {
      const storageKey = getUserSettingsKey(user.uid);
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setSettings({
            displayName: user.displayName || parsed.displayName || '',
            fullName: parsed.fullName || '',
            voxCallName: parsed.voxCallName || '',
          });
        } catch {
          setSettings({
            ...DEFAULT_SETTINGS,
            displayName: user.displayName || '',
          });
        }
      } else {
        setSettings({
          ...DEFAULT_SETTINGS,
          displayName: user.displayName || '',
        });
      }
    }
  }, [user]);

  const handleSave = async () => {
    if (!user) return;

    setIsSaving(true);
    setSaveMessage(null);

    try {
      // Update Firebase display name if changed
      if (settings.displayName !== user.displayName) {
        await updateUserProfile({ displayName: settings.displayName });
      }

      // Save other settings to localStorage
      const storageKey = getUserSettingsKey(user.uid);
      localStorage.setItem(storageKey, JSON.stringify(settings));

      setSaveMessage({ type: 'success', text: 'Settings saved successfully!' });

      // Clear message after 3 seconds
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveMessage({ type: 'error', text: 'Failed to save settings. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div ref={pageRef} className="liquid-glass min-h-full overflow-auto relative" style={{ minHeight: '100dvh' }}>
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50">
        <div className="mx-4 mt-4">
          <div className="max-w-2xl mx-auto liquid-card rounded-2xl px-6 py-4 flex items-center justify-between">
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 text-[var(--foreground)]/70 hover:text-[var(--foreground)] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back</span>
            </button>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Settings</h1>
            <div className="w-20" /> {/* Spacer */}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-28 pb-8 relative z-10">
        {/* Profile Section */}
        <div className="liquid-card rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FF6D1F] to-[#ff8a4c] flex items-center justify-center shadow-lg shadow-[#FF6D1F]/30">
              <User className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Profile</h2>
          </div>

          <div className="space-y-4">
            {/* Display Name */}
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)]/70 mb-2">
                Display Name
              </label>
              <input
                type="text"
                value={settings.displayName}
                onChange={(e) => setSettings({ ...settings, displayName: e.target.value })}
                placeholder="How you appear in the app"
                className="w-full px-4 py-3 liquid-input rounded-xl"
              />
              <p className="text-xs text-[var(--foreground)]/50 mt-1">
                This is shown in your profile and chat bubbles
              </p>
            </div>

            {/* Full Name */}
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)]/70 mb-2">
                Full Name
              </label>
              <input
                type="text"
                value={settings.fullName}
                onChange={(e) => setSettings({ ...settings, fullName: e.target.value })}
                placeholder="Your full name"
                className="w-full px-4 py-3 liquid-input rounded-xl"
              />
            </div>
          </div>
        </div>

        {/* Appearance Section */}
        <div className="liquid-card rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FF6D1F] to-[#ff8a4c] flex items-center justify-center shadow-lg shadow-[#FF6D1F]/30">
              <Palette className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Appearance</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)]/70 mb-3">
                Theme
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => setTheme('light')}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 p-4 rounded-xl transition-all",
                    theme === 'light'
                      ? "liquid-button"
                      : "liquid-card hover:bg-white/20"
                  )}
                >
                  <Sun className="w-5 h-5" />
                  <span className="font-medium">Light</span>
                </button>
                <button
                  onClick={() => setTheme('dark')}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 p-4 rounded-xl transition-all",
                    theme === 'dark'
                      ? "liquid-button"
                      : "liquid-card hover:bg-white/20"
                  )}
                >
                  <Moon className="w-5 h-5" />
                  <span className="font-medium">Dark</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Vox Preferences Section */}
        <div className="liquid-card rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FF6D1F] to-[#ff8a4c] flex items-center justify-center shadow-lg shadow-[#FF6D1F]/30">
              <Volume2 className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Vox Preferences</h2>
          </div>

          <div className="space-y-4">
            {/* Vox Call Name */}
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)]/70 mb-2">
                What should Vox call you?
              </label>
              <input
                type="text"
                value={settings.voxCallName}
                onChange={(e) => setSettings({ ...settings, voxCallName: e.target.value })}
                placeholder="e.g., Alex, Boss, Friend"
                className="w-full px-4 py-3 liquid-input rounded-xl"
              />
              <p className="text-xs text-[var(--foreground)]/50 mt-1">
                AI contacts will use this name when talking to you
              </p>
            </div>
          </div>
        </div>

        {/* Subscription Section */}
        <div className="liquid-card rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FF6D1F] to-[#ff8a4c] flex items-center justify-center shadow-lg shadow-[#FF6D1F]/30">
              <CreditCard className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Subscription</h2>
          </div>

          <div className="space-y-4">
            {/* Current Plan */}
            <div className="flex items-center justify-between p-4 liquid-card rounded-xl">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full ${tierInfo.color} flex items-center justify-center`}>
                  <Crown className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="font-medium text-[var(--foreground)]">
                    {tierInfo.name} Plan
                  </p>
                  <p className="text-sm text-[var(--foreground)]/50">
                    {tier === 'free' ? 'Limited features' : tier === 'pro' ? '$9.99/month' : '$19.99/month'}
                  </p>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${tierInfo.color} text-white`}>
                {subscription.status === 'active' ? 'Active' : tier === 'free' ? 'Free' : subscription.status || 'Active'}
              </span>
            </div>

            {/* Subscription Details for paid tiers */}
            {tier !== 'free' && subscription.currentPeriodEnd && (
              <div className="px-4 py-3 liquid-card rounded-xl">
                <p className="text-sm text-[var(--foreground)]/70">
                  {subscription.cancelAtPeriodEnd ? (
                    <>Subscription ends on <span className="font-medium text-[var(--foreground)]">{new Date(subscription.currentPeriodEnd).toLocaleDateString()}</span></>
                  ) : (
                    <>Next billing date: <span className="font-medium text-[var(--foreground)]">{new Date(subscription.currentPeriodEnd).toLocaleDateString()}</span></>
                  )}
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col gap-2">
              {tier !== 'free' ? (
                <Button
                  onClick={handleManageSubscription}
                  disabled={isManagingSubscription}
                  variant="secondary"
                  className="w-full justify-center liquid-card hover:bg-white/20"
                  isLoading={isManagingSubscription}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Manage Subscription
                </Button>
              ) : (
                <Button
                  onClick={() => router.push('/pricing')}
                  variant="primary"
                  className="w-full justify-center liquid-button"
                >
                  <Crown className="w-4 h-4 mr-2" />
                  Upgrade to Pro
                </Button>
              )}

              {tier === 'pro' && (
                <Button
                  onClick={() => router.push('/pricing')}
                  variant="secondary"
                  className="w-full justify-center liquid-card hover:bg-white/20"
                >
                  <Crown className="w-4 h-4 mr-2" />
                  Upgrade to Max
                </Button>
              )}
            </div>

            <p className="text-xs text-[var(--foreground)]/50 text-center">
              {tier !== 'free'
                ? 'Manage your subscription, update payment method, or cancel anytime'
                : 'Unlock more features with a Pro or Max subscription'}
            </p>
          </div>
        </div>

        {/* Account Info (Read-only) */}
        <div className="liquid-card rounded-2xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">Account</h2>
          <div className="space-y-3">
            <div>
              <p className="text-sm text-[var(--foreground)]/50">Email</p>
              <p className="text-[var(--foreground)]">{user?.email}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--foreground)]/50">User ID</p>
              <p className="text-[var(--foreground)] text-sm font-mono">{user?.uid}</p>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex flex-col items-center gap-3">
          {saveMessage && (
            <div className={`px-4 py-2 rounded-xl text-sm ${saveMessage.type === 'success' ? 'bg-green-500/20 text-green-600' : 'bg-red-500/20 text-red-500'}`}>
              {saveMessage.text}
            </div>
          )}
          <Button
            onClick={handleSave}
            disabled={isSaving}
            variant="primary"
            size="lg"
            className="w-full max-w-xs liquid-button rounded-xl"
            isLoading={isSaving}
          >
            <Save className="w-5 h-5 mr-2" />
            Save Changes
          </Button>
        </div>
      </main>
    </div>
  );
}
