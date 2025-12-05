'use client';

import { useEffect } from 'react';
import { X, Sparkles, Crown, Zap } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { SUBSCRIPTION_TIERS, formatPrice } from '@/config/subscription';
import { FEATURE_GATE_INFO, GatedFeature } from '@/shared/types/subscription';
import { useRouter } from 'next/navigation';

export function UpgradeModal() {
  const router = useRouter();
  const { upgradeModalFeature, hideUpgradeModal, tier } = useSubscription();

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hideUpgradeModal();
      }
    };

    if (upgradeModalFeature) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [upgradeModalFeature, hideUpgradeModal]);

  if (!upgradeModalFeature) return null;

  const featureInfo = FEATURE_GATE_INFO[upgradeModalFeature];
  const requiredTier = featureInfo.requiredTier;
  const tierConfig = SUBSCRIPTION_TIERS[requiredTier];

  const handleViewPlans = () => {
    hideUpgradeModal();
    router.push('/pricing');
  };

  const getIcon = (feature: GatedFeature) => {
    switch (feature) {
      case 'voice-cloning':
        return <Sparkles className="w-12 h-12 text-[#FF6D1F]" />;
      case 'advanced-models':
        return <Zap className="w-12 h-12 text-[#FF6D1F]" />;
      default:
        return <Crown className="w-12 h-12 text-[#FF6D1F]" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={hideUpgradeModal}
      />

      {/* Modal */}
      <div className="relative glass-dark rounded-3xl shadow-2xl max-w-md w-full p-8 animate-in fade-in zoom-in-95 duration-200">
        {/* Close button */}
        <button
          onClick={hideUpgradeModal}
          className="absolute top-4 right-4 p-2 rounded-full glass-light hover:bg-white/30 transition-colors"
        >
          <X className="w-5 h-5 text-[var(--foreground)]/60" />
        </button>

        {/* Content */}
        <div className="text-center">
          {/* Icon */}
          <div className="mb-6 flex justify-center">
            <div className="p-4 bg-[#FF6D1F]/10 rounded-full">
              {getIcon(upgradeModalFeature)}
            </div>
          </div>

          {/* Title */}
          <h2 className="text-2xl font-bold text-[var(--foreground)] mb-2">
            Unlock {featureInfo.title}
          </h2>

          {/* Description */}
          <p className="text-[var(--foreground)]/70 mb-6">
            {featureInfo.description}
          </p>

          {/* Tier badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 glass-light rounded-full mb-6">
            <Crown className="w-4 h-4 text-[#FF6D1F]" />
            <span className="text-sm font-semibold text-[#FF6D1F]">
              Available on {tierConfig.name} and above
            </span>
          </div>

          {/* Price info */}
          <div className="mb-6">
            <p className="text-3xl font-bold text-[var(--foreground)]">
              {formatPrice(tierConfig.monthlyPrice)}
              <span className="text-base font-normal text-[var(--foreground)]/60">/month</span>
            </p>
            <p className="text-sm text-[var(--foreground)]/60 mt-1">
              or {formatPrice(tierConfig.annualPrice)}/year (save 20%)
            </p>
          </div>

          {/* Current tier info */}
          {tier !== 'free' && (
            <p className="text-sm text-[var(--foreground)]/60 mb-4">
              You&apos;re currently on the {SUBSCRIPTION_TIERS[tier].name} plan
            </p>
          )}

          {/* CTA Buttons */}
          <div className="flex flex-col gap-3">
            <Button onClick={handleViewPlans} size="lg" className="w-full btn-primary rounded-xl">
              View Plans
            </Button>
            <Button
              onClick={hideUpgradeModal}
              variant="ghost"
              size="lg"
              className="w-full glass-light rounded-xl"
            >
              Maybe Later
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
