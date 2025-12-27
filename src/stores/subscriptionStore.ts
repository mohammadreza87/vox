/**
 * Subscription Store
 * Manages subscription tier, usage limits, and feature gating
 */

import { create } from 'zustand';
import {
  SUBSCRIPTION_TIERS,
  canUseModel as checkModelAccess,
  canCreateCustomContact as checkContactLimit,
  canSendMessage as checkMessageLimit,
} from '@/config/subscription';
import {
  GatedFeature,
  FEATURE_GATE_INFO,
  DEFAULT_SUBSCRIPTION,
  DEFAULT_USAGE,
} from '@/shared/types/subscription';
import type { SubscriptionStore } from './types';
import { getAuthToken } from './middleware/sync';

export const useSubscriptionStore = create<SubscriptionStore>((set, get) => ({
  // State
  tier: 'free',
  subscription: DEFAULT_SUBSCRIPTION,
  usage: DEFAULT_USAGE,
  isLoading: true,
  upgradeModalFeature: null,

  // Actions
  setSubscription: (subscription) => set({ subscription, tier: subscription.tier }),
  setUsage: (usage) => set({ usage }),
  setLoading: (isLoading) => set({ isLoading }),

  fetchSubscription: async () => {
    const token = await getAuthToken();
    if (!token) {
      set({
        subscription: DEFAULT_SUBSCRIPTION,
        usage: DEFAULT_USAGE,
        tier: 'free',
        isLoading: false,
      });
      return;
    }

    try {
      const response = await fetch('/api/user/subscription', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        set({
          subscription: data.subscription,
          tier: data.subscription.tier,
          usage: {
            ...data.usage,
            messagesDailyReset: new Date(data.usage.messagesDailyReset),
          },
        });
      }
    } catch (error) {
      console.error('Error fetching subscription:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  refreshSubscription: async () => {
    set({ isLoading: true });
    await get().fetchSubscription();
  },

  incrementLocalMessageCount: () => {
    set((state) => ({
      usage: {
        ...state.usage,
        messagesUsedToday: state.usage.messagesUsedToday + 1,
      },
    }));
  },

  updateLocalContactsCount: (count: number) => {
    set((state) => ({
      usage: {
        ...state.usage,
        customContactsCount: count,
      },
    }));
  },

  showUpgradeModal: (feature: GatedFeature) => set({ upgradeModalFeature: feature }),
  hideUpgradeModal: () => set({ upgradeModalFeature: null }),
}));

// Selectors (computed values)
export const useSubscriptionSelectors = () => {
  const { tier, usage } = useSubscriptionStore();

  const tierFeatures = SUBSCRIPTION_TIERS[tier].features;

  return {
    dailyMessageLimit: tierFeatures.dailyMessageLimit,
    messagesUsedToday: usage.messagesUsedToday,
    messagesRemaining: Math.max(0, tierFeatures.dailyMessageLimit - usage.messagesUsedToday),
    customContactsLimit: tierFeatures.customContactsLimit,
    customContactsUsed: usage.customContactsCount,
    canUseVoiceCloning: tierFeatures.voiceCloning,
    canEditDefaultBots: tierFeatures.editDefaultBots,
    canUseModel: (modelId: string) => checkModelAccess(tier, modelId),
    canCreateCustomContact: checkContactLimit(tier, usage.customContactsCount),
    canSendMessage: checkMessageLimit(tier, usage.messagesUsedToday),
    isPro: tier === 'pro' || tier === 'max',
    isMax: tier === 'max',
    getFeatureInfo: (feature: GatedFeature) => FEATURE_GATE_INFO[feature],
  };
};

/**
 * Initialize subscription - call this when user logs in
 */
export async function initSubscription(): Promise<void> {
  const store = useSubscriptionStore.getState();
  await store.fetchSubscription();
}
