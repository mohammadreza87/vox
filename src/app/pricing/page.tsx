'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ArrowLeft, Sparkles, Crown, Zap } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import {
  SUBSCRIPTION_TIERS,
  SubscriptionTier,
  formatPrice,
  getAnnualSavings,
} from '@/config/subscription';
import { auth } from '@/lib/firebase';
import { useEntranceAnimation } from '@/hooks/useAnimations';
import { useTelegramPayment } from '@/hooks/useTelegramPayment';
import { isTelegramMiniApp } from '@/lib/platform';

type BillingInterval = 'monthly' | 'annual';

const TIER_ORDER: SubscriptionTier[] = ['free', 'pro', 'max'];

const TIER_ICONS: Record<SubscriptionTier, React.ReactNode> = {
  free: <Zap className="w-6 h-6" />,
  pro: <Sparkles className="w-6 h-6" />,
  max: <Crown className="w-6 h-6" />,
};

const TIER_COLORS: Record<SubscriptionTier, string> = {
  free: 'from-gray-500 to-gray-600',
  pro: 'from-[#FF6D1F] to-[#ff8a4c]',
  max: 'from-purple-500 to-purple-600',
};

const FEATURES: Record<SubscriptionTier, string[]> = {
  free: [
    '20 messages per day',
    '1 custom contact',
    'Basic AI models',
    'Pre-made AI contacts',
    'Voice chat',
  ],
  pro: [
    '200 messages per day',
    '5 custom contacts',
    'Voice cloning',
    'Edit default bots',
    'Advanced AI models',
    'Priority support',
  ],
  max: [
    'Unlimited messages',
    'Unlimited custom contacts',
    'Voice cloning',
    'Edit default bots',
    'All AI models',
    'Priority support',
    'Early access to features',
  ],
};

export default function PricingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { tier: currentTier, isLoading } = useSubscription();
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('monthly');
  const [loadingTier, setLoadingTier] = useState<SubscriptionTier | null>(null);
  const [isTelegram, setIsTelegram] = useState(false);

  // Telegram payment hook
  const { openPayment: openTelegramPayment, loading: telegramLoading, error: telegramError } = useTelegramPayment();

  // Check if in Telegram Mini App
  useEffect(() => {
    setIsTelegram(isTelegramMiniApp());
  }, []);

  // GSAP Animation refs - single page entrance
  const { ref: pageRef } = useEntranceAnimation('fadeUp', { delay: 0 });

  const handleSubscribe = async (tier: SubscriptionTier) => {
    if (tier === 'free') {
      router.push('/app');
      return;
    }

    if (!user) {
      router.push('/login?redirect=/pricing');
      return;
    }

    setLoadingTier(tier);

    try {
      // Use Telegram payments if in Mini App
      if (isTelegram) {
        const telegramPriceId = billingInterval === 'monthly'
          ? `${tier}_monthly` as const
          : `${tier}_annual` as const;

        await openTelegramPayment(telegramPriceId);
        setLoadingTier(null);
        return;
      }

      // Otherwise use Stripe
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const priceId = billingInterval === 'monthly'
        ? SUBSCRIPTION_TIERS[tier].stripePriceIds?.monthly
        : SUBSCRIPTION_TIERS[tier].stripePriceIds?.annual;

      if (!priceId) {
        throw new Error('Price not configured');
      }

      const response = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          priceId,
          successUrl: `${window.location.origin}/app?checkout=success`,
          cancelUrl: `${window.location.origin}/pricing?checkout=canceled`,
        }),
      });

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Failed to create checkout session');
      }
    } catch (error) {
      console.error('Error creating checkout:', error);
      alert(telegramError || 'Failed to start checkout. Please try again.');
    } finally {
      setLoadingTier(null);
    }
  };

  const getButtonText = (tier: SubscriptionTier) => {
    if (isLoading) return 'Loading...';
    if (loadingTier === tier) return 'Redirecting...';
    if (tier === currentTier) return 'Current Plan';
    if (tier === 'free') return 'Get Started';
    if (TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(currentTier)) return 'Downgrade';
    return 'Upgrade';
  };

  const isButtonDisabled = (tier: SubscriptionTier) => {
    return isLoading || loadingTier !== null || tier === currentTier;
  };

  return (
    <div ref={pageRef} className="min-h-full overflow-auto relative" style={{ minHeight: '100dvh' }}>
      {/* Animated gradient background */}
      <div className="glass-background" />

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50">
        <div className="mx-4 mt-4">
          <div className="max-w-6xl mx-auto glass rounded-2xl px-6 py-4 flex items-center justify-between">
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 text-[var(--foreground)]/70 hover:text-[var(--foreground)] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back</span>
            </button>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Pricing</h1>
            <div className="w-20" /> {/* Spacer */}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pt-28 pb-12 relative z-10">
        {/* Title */}
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-[var(--foreground)] mb-4">
            Choose Your Plan
          </h2>
          <p className="text-lg text-[var(--foreground)]/70 max-w-2xl mx-auto">
            Unlock the full potential of Vox with advanced AI models, voice cloning, and more.
          </p>
        </div>

        {/* Billing Toggle */}
        <div className="flex justify-center mb-12">
          <div className="inline-flex items-center gap-2 glass px-2 py-2 rounded-full">
            <button
              onClick={() => setBillingInterval('monthly')}
              className={`px-6 py-2 rounded-full font-medium transition-all ${
                billingInterval === 'monthly'
                  ? 'bg-gradient-to-r from-[#FF6D1F] to-[#ff8a4c] text-white shadow-lg shadow-[#FF6D1F]/30'
                  : 'text-[var(--foreground)]/60 hover:text-[var(--foreground)]'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingInterval('annual')}
              className={`px-6 py-2 rounded-full font-medium transition-all flex items-center gap-2 ${
                billingInterval === 'annual'
                  ? 'bg-gradient-to-r from-[#FF6D1F] to-[#ff8a4c] text-white shadow-lg shadow-[#FF6D1F]/30'
                  : 'text-[var(--foreground)]/60 hover:text-[var(--foreground)]'
              }`}
            >
              Annual
              <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {TIER_ORDER.map((tier) => {
            const config = SUBSCRIPTION_TIERS[tier];
            const price = billingInterval === 'monthly'
              ? config.monthlyPrice
              : Math.round(config.annualPrice / 12);
            const isPopular = tier === 'pro';
            const isCurrent = tier === currentTier;

            return (
              <div
                key={tier}
                className={`relative rounded-3xl p-8 transition-all ${
                  isPopular
                    ? 'bg-gradient-to-br from-[#FF6D1F] to-[#ff8a4c] text-white shadow-xl shadow-[#FF6D1F]/30 scale-105'
                    : 'glass-light'
                } ${isCurrent ? 'ring-2 ring-[#FF6D1F] ring-offset-2 ring-offset-transparent' : ''}`}
              >
                {/* Popular badge */}
                {isPopular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="bg-white text-[#FF6D1F] px-4 py-1 rounded-full text-sm font-semibold shadow-lg">
                      Most Popular
                    </span>
                  </div>
                )}

                {/* Current badge */}
                {isCurrent && !isPopular && (
                  <div className="absolute -top-4 right-4">
                    <span className="bg-green-500 text-white px-3 py-1 rounded-full text-xs font-semibold">
                      Current
                    </span>
                  </div>
                )}

                {/* Header */}
                <div className="flex items-center gap-3 mb-4">
                  <div className={`p-2 rounded-xl ${
                    isPopular
                      ? 'bg-white/20 text-white'
                      : `bg-gradient-to-br ${TIER_COLORS[tier]} text-white`
                  }`}>
                    {TIER_ICONS[tier]}
                  </div>
                  <h3 className={`text-2xl font-bold ${isPopular ? 'text-white' : 'text-[var(--foreground)]'}`}>
                    {config.name}
                  </h3>
                </div>

                {/* Price */}
                <div className="mb-6">
                  <div className="flex items-baseline gap-1">
                    <span className={`text-4xl font-bold ${isPopular ? 'text-white' : 'text-[var(--foreground)]'}`}>
                      {tier === 'free' ? 'Free' : formatPrice(price)}
                    </span>
                    {tier !== 'free' && (
                      <span className={isPopular ? 'text-white/80' : 'text-[var(--foreground)]/60'}>/month</span>
                    )}
                  </div>
                  {tier !== 'free' && billingInterval === 'annual' && (
                    <p className={`text-sm mt-1 ${isPopular ? 'text-white/90' : 'text-green-600'}`}>
                      Save {formatPrice(getAnnualSavings(tier))}/year
                    </p>
                  )}
                </div>

                {/* Features */}
                <ul className="space-y-3 mb-8">
                  {FEATURES[tier].map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <Check className={`w-5 h-5 flex-shrink-0 mt-0.5 ${isPopular ? 'text-white' : 'text-green-500'}`} />
                      <span className={isPopular ? 'text-white/90' : 'text-[var(--foreground)]/80'}>{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA Button */}
                <Button
                  onClick={() => handleSubscribe(tier)}
                  disabled={isButtonDisabled(tier)}
                  variant={isPopular ? 'secondary' : 'primary'}
                  size="lg"
                  className={`w-full ${
                    isPopular
                      ? 'bg-white text-[#FF6D1F] hover:bg-white/90'
                      : 'btn-primary'
                  }`}
                  isLoading={loadingTier === tier}
                >
                  {getButtonText(tier)}
                </Button>
              </div>
            );
          })}
        </div>

        {/* FAQ Section */}
        <div className="max-w-3xl mx-auto">
          <h3 className="text-2xl font-bold text-[var(--foreground)] text-center mb-8">
            Frequently Asked Questions
          </h3>
          <div className="space-y-4">
            <div className="glass-light rounded-2xl p-6">
              <h4 className="font-semibold text-[var(--foreground)] mb-2">
                Can I cancel anytime?
              </h4>
              <p className="text-[var(--foreground)]/70">
                Yes! You can cancel your subscription at any time. You&apos;ll continue to have access until the end of your billing period.
              </p>
            </div>
            <div className="glass-light rounded-2xl p-6">
              <h4 className="font-semibold text-[var(--foreground)] mb-2">
                What happens to my data if I downgrade?
              </h4>
              <p className="text-[var(--foreground)]/70">
                Your data is safe. Custom contacts and cloned voices will remain, but you may not be able to create new ones beyond your plan&apos;s limits.
              </p>
            </div>
            <div className="glass-light rounded-2xl p-6">
              <h4 className="font-semibold text-[var(--foreground)] mb-2">
                Do you offer refunds?
              </h4>
              <p className="text-[var(--foreground)]/70">
                We offer a 7-day money-back guarantee for new subscribers. Contact us within 7 days of your first payment for a full refund.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
