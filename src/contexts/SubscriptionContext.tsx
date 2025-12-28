'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
  SubscriptionTier,
  SUBSCRIPTION_TIERS,
  canUseModel as checkModelAccess,
  canCreateCustomContact as checkContactLimit,
  canSendMessage as checkMessageLimit,
} from '@/config/subscription';
import {
  UserSubscription,
  UsageData,
  GatedFeature,
  FEATURE_GATE_INFO,
  DEFAULT_SUBSCRIPTION,
  DEFAULT_USAGE,
} from '@/shared/types/subscription';
import { auth } from '@/lib/firebase';

interface SubscriptionContextType {
  // State
  tier: SubscriptionTier;
  subscription: UserSubscription;
  usage: UsageData;
  isLoading: boolean;

  // Limits
  dailyMessageLimit: number;
  messagesUsedToday: number;
  messagesRemaining: number;
  customContactsLimit: number;
  customContactsUsed: number;

  // Feature checks
  canUseVoiceCloning: boolean;
  canEditDefaultBots: boolean;
  canUseModel: (modelId: string) => boolean;
  canCreateCustomContact: boolean;
  canSendMessage: boolean;
  isPro: boolean;
  isMax: boolean;

  // Actions
  refreshSubscription: () => Promise<void>;
  incrementLocalMessageCount: () => void;
  updateLocalContactsCount: (count: number) => void;

  // Upgrade modal
  upgradeModalFeature: GatedFeature | null;
  showUpgradeModal: (feature: GatedFeature) => void;
  hideUpgradeModal: () => void;
  getFeatureInfo: (feature: GatedFeature) => typeof FEATURE_GATE_INFO[GatedFeature];
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<UserSubscription>(DEFAULT_SUBSCRIPTION);
  const [usage, setUsage] = useState<UsageData>(DEFAULT_USAGE);
  const [isLoading, setIsLoading] = useState(true);
  const [upgradeModalFeature, setUpgradeModalFeature] = useState<GatedFeature | null>(null);

  const tier = subscription.tier;

  // Fetch subscription data from server
  const fetchSubscription = useCallback(async () => {
    if (!user) {
      setSubscription(DEFAULT_SUBSCRIPTION);
      setUsage(DEFAULT_USAGE);
      setIsLoading(false);
      return;
    }

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        setIsLoading(false);
        return;
      }

      const response = await fetch('/api/user/subscription', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const responseData = await response.json();
        // Handle both old format and new standardized format (data.data.subscription)
        const data = responseData.data || responseData;
        setSubscription(data.subscription);
        setUsage({
          ...data.usage,
          messagesDailyReset: new Date(data.usage.messagesDailyReset),
        });
      }
    } catch (error) {
      console.error('Error fetching subscription:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Refresh subscription data
  const refreshSubscription = useCallback(async () => {
    setIsLoading(true);
    await fetchSubscription();
  }, [fetchSubscription]);

  // Fetch on mount and when user changes
  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  // Get tier features
  const tierFeatures = SUBSCRIPTION_TIERS[tier].features;

  // Computed values
  const dailyMessageLimit = tierFeatures.dailyMessageLimit;
  const messagesUsedToday = usage.messagesUsedToday;
  const messagesRemaining = Math.max(0, dailyMessageLimit - messagesUsedToday);
  const customContactsLimit = tierFeatures.customContactsLimit;
  const customContactsUsed = usage.customContactsCount;

  // Feature checks
  const canUseVoiceCloning = tierFeatures.voiceCloning;
  const canEditDefaultBots = tierFeatures.editDefaultBots;
  const canUseModel = useCallback(
    (modelId: string) => checkModelAccess(tier, modelId),
    [tier]
  );
  const canCreateCustomContact = checkContactLimit(tier, customContactsUsed);
  const canSendMessage = checkMessageLimit(tier, messagesUsedToday);
  const isPro = tier === 'pro' || tier === 'max';
  const isMax = tier === 'max';

  // Local state updates (optimistic)
  const incrementLocalMessageCount = useCallback(() => {
    setUsage(prev => ({
      ...prev,
      messagesUsedToday: prev.messagesUsedToday + 1,
    }));
  }, []);

  const updateLocalContactsCount = useCallback((count: number) => {
    setUsage(prev => ({
      ...prev,
      customContactsCount: count,
    }));
  }, []);

  // Upgrade modal
  const showUpgradeModal = useCallback((feature: GatedFeature) => {
    setUpgradeModalFeature(feature);
  }, []);

  const hideUpgradeModal = useCallback(() => {
    setUpgradeModalFeature(null);
  }, []);

  const getFeatureInfo = useCallback((feature: GatedFeature) => {
    return FEATURE_GATE_INFO[feature];
  }, []);

  return (
    <SubscriptionContext.Provider
      value={{
        tier,
        subscription,
        usage,
        isLoading,
        dailyMessageLimit,
        messagesUsedToday,
        messagesRemaining,
        customContactsLimit,
        customContactsUsed,
        canUseVoiceCloning,
        canEditDefaultBots,
        canUseModel,
        canCreateCustomContact,
        canSendMessage,
        isPro,
        isMax,
        refreshSubscription,
        incrementLocalMessageCount,
        updateLocalContactsCount,
        upgradeModalFeature,
        showUpgradeModal,
        hideUpgradeModal,
        getFeatureInfo,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (context === undefined) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
}
