/**
 * Subscription API Module
 * Handles subscription status, checkout, and billing
 */

import { api } from '../client';
import { SubscriptionResponse, CreateCheckoutResponse, CreatePortalResponse } from '../types';
import { UserSubscription, UsageData, DEFAULT_SUBSCRIPTION, DEFAULT_USAGE } from '@/shared/types/subscription';

// ============================================
// SUBSCRIPTION STATUS
// ============================================

/**
 * Get subscription and usage data
 */
export async function getSubscription(): Promise<{ subscription: UserSubscription; usage: UsageData }> {
  try {
    const response = await api.get<SubscriptionResponse>('/api/user/subscription');
    return {
      subscription: response.subscription,
      usage: {
        ...response.usage,
        messagesDailyReset: new Date(response.usage.messagesDailyReset),
      },
    };
  } catch {
    return {
      subscription: DEFAULT_SUBSCRIPTION,
      usage: DEFAULT_USAGE,
    };
  }
}

// ============================================
// STRIPE CHECKOUT
// ============================================

/**
 * Create Stripe checkout session for upgrading
 */
export async function createCheckoutSession(priceId: string): Promise<string> {
  const response = await api.post<CreateCheckoutResponse>('/api/stripe/checkout', {
    priceId,
  });
  return response.url;
}

/**
 * Create Stripe billing portal session
 */
export async function createPortalSession(): Promise<string> {
  const response = await api.post<CreatePortalResponse>('/api/stripe/portal');
  return response.url;
}

// ============================================
// USAGE TRACKING
// ============================================

/**
 * Increment message count (called after sending a message)
 */
export async function incrementMessageCount(): Promise<void> {
  await api.post('/api/user/usage/increment-message');
}

/**
 * Update custom contacts count
 */
export async function updateContactsCount(count: number): Promise<void> {
  await api.post('/api/user/usage/contacts', { count });
}
