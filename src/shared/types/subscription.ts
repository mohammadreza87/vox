// Subscription-related types for Firestore and application state

import { SubscriptionTier } from '@/config/subscription';

export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete' | null;

export interface UserSubscription {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface UsageData {
  messagesUsedToday: number;
  messagesDailyReset: Date;
  customContactsCount: number;
  clonedVoicesCount: number;
}

export interface UserDocument {
  email: string;
  displayName: string;
  createdAt: Date;
  subscription: UserSubscription;
  usage: UsageData;
}

// Default values for new users
export const DEFAULT_SUBSCRIPTION: UserSubscription = {
  tier: 'free',
  status: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  stripePriceId: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

export const DEFAULT_USAGE: UsageData = {
  messagesUsedToday: 0,
  messagesDailyReset: new Date(),
  customContactsCount: 0,
  clonedVoicesCount: 0,
};

// Feature flags for UI
export type GatedFeature =
  | 'voice-cloning'
  | 'edit-default-bots'
  | 'advanced-models'
  | 'custom-contacts'
  | 'daily-messages';

export interface FeatureGateInfo {
  feature: GatedFeature;
  requiredTier: SubscriptionTier;
  title: string;
  description: string;
}

export const FEATURE_GATE_INFO: Record<GatedFeature, FeatureGateInfo> = {
  'voice-cloning': {
    feature: 'voice-cloning',
    requiredTier: 'pro',
    title: 'Voice Cloning',
    description: 'Clone any voice to create personalized AI assistants that sound exactly how you want.',
  },
  'edit-default-bots': {
    feature: 'edit-default-bots',
    requiredTier: 'pro',
    title: 'Customize Default Bots',
    description: 'Personalize the pre-made AI assistants with your own prompts and settings.',
  },
  'advanced-models': {
    feature: 'advanced-models',
    requiredTier: 'pro',
    title: 'Advanced AI Models',
    description: 'Access more powerful AI models like GPT-4o, Claude Sonnet, and Gemini Pro.',
  },
  'custom-contacts': {
    feature: 'custom-contacts',
    requiredTier: 'pro',
    title: 'More Custom Contacts',
    description: 'Create more custom AI contacts to fit your needs.',
  },
  'daily-messages': {
    feature: 'daily-messages',
    requiredTier: 'pro',
    title: 'More Daily Messages',
    description: 'Send more messages each day with increased limits.',
  },
};
