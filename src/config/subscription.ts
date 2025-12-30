// Subscription tier configuration

export type SubscriptionTier = 'free' | 'pro' | 'max';
export type BillingInterval = 'monthly' | 'annual';

// Models available per tier
export const FREE_MODELS = [
  'deepseek-chat',
];

export const PRO_MODELS = [
  ...FREE_MODELS,
  'gemini-2.0-flash-001',
  'gemini-2.0-pro-exp-02-05',
  'gpt-4o-mini',
  'claude-3-5-haiku-20241022',
  'gpt-4o',
  'claude-sonnet-4-20250514',
];

export const MAX_MODELS = [
  ...PRO_MODELS,
  'deepseek-reasoner',
];

export interface TierFeatures {
  dailyMessageLimit: number;
  customContactsLimit: number;
  voiceCloning: boolean;
  editDefaultBots: boolean;
  availableModels: string[];
}

export interface TierConfig {
  name: string;
  monthlyPrice: number; // in cents
  annualPrice: number; // in cents (with 20% discount)
  stripePriceIds?: {
    monthly: string;
    annual: string;
  };
  features: TierFeatures;
}

export const SUBSCRIPTION_TIERS: Record<SubscriptionTier, TierConfig> = {
  free: {
    name: 'Free',
    monthlyPrice: 0,
    annualPrice: 0,
    features: {
      dailyMessageLimit: Infinity, // Unlimited for now
      customContactsLimit: Infinity, // Unlimited for now
      voiceCloning: true,
      editDefaultBots: true,
      availableModels: MAX_MODELS, // All models available
    },
  },
  pro: {
    name: 'Pro',
    monthlyPrice: 999, // $9.99
    annualPrice: 9590, // $95.90/year (20% off from $119.88)
    stripePriceIds: {
      monthly: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY || '',
      annual: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_ANNUAL || '',
    },
    features: {
      dailyMessageLimit: 200,
      customContactsLimit: 5,
      voiceCloning: true,
      editDefaultBots: true,
      availableModels: PRO_MODELS,
    },
  },
  max: {
    name: 'Max',
    monthlyPrice: 1999, // $19.99
    annualPrice: 19190, // $191.90/year (20% off from $239.88)
    stripePriceIds: {
      monthly: process.env.NEXT_PUBLIC_STRIPE_PRICE_MAX_MONTHLY || '',
      annual: process.env.NEXT_PUBLIC_STRIPE_PRICE_MAX_ANNUAL || '',
    },
    features: {
      dailyMessageLimit: Infinity,
      customContactsLimit: Infinity,
      voiceCloning: true,
      editDefaultBots: true,
      availableModels: MAX_MODELS,
    },
  },
};

// Helper functions
export function getTierFeatures(tier: SubscriptionTier): TierFeatures {
  return SUBSCRIPTION_TIERS[tier].features;
}

export function canUseModel(tier: SubscriptionTier, modelId: string): boolean {
  const features = getTierFeatures(tier);
  return features.availableModels.includes(modelId);
}

export function getModelTier(modelId: string): SubscriptionTier | null {
  if (FREE_MODELS.includes(modelId)) return 'free';
  if (PRO_MODELS.includes(modelId)) return 'pro';
  if (MAX_MODELS.includes(modelId)) return 'max';
  return null;
}

export function canCreateCustomContact(tier: SubscriptionTier, currentCount: number): boolean {
  const features = getTierFeatures(tier);
  return currentCount < features.customContactsLimit;
}

export function canSendMessage(tier: SubscriptionTier, usedToday: number): boolean {
  const features = getTierFeatures(tier);
  return usedToday < features.dailyMessageLimit;
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function getAnnualSavings(tier: SubscriptionTier): number {
  const config = SUBSCRIPTION_TIERS[tier];
  if (!config.monthlyPrice) return 0;
  const yearlyAtMonthly = config.monthlyPrice * 12;
  return yearlyAtMonthly - config.annualPrice;
}
