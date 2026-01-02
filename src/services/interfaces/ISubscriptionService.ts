/**
 * Subscription Service Interface
 * Defines business logic for subscription and billing
 */

import { SubscriptionTier } from '@/config/subscription';
import { UserSubscription, UsageData, GatedFeature } from '@/shared/types/subscription';

export interface CheckoutRequest {
  tier: SubscriptionTier;
  billingPeriod: 'monthly' | 'annual';
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResponse {
  checkoutUrl: string;
  sessionId: string;
}

export interface ISubscriptionService {
  /**
   * Get current user's subscription
   */
  getSubscription(): Promise<UserSubscription>;

  /**
   * Get current usage data
   */
  getUsage(): Promise<UsageData>;

  /**
   * Check if user can use a feature
   */
  canUseFeature(feature: GatedFeature): Promise<boolean>;

  /**
   * Check if user can send more messages
   */
  canSendMessage(): Promise<boolean>;

  /**
   * Check if user can create more custom contacts
   */
  canCreateCustomContact(): Promise<boolean>;

  /**
   * Check if user can use a specific AI model
   */
  canUseModel(modelId: string): Promise<boolean>;

  /**
   * Increment message count
   */
  incrementMessageCount(): Promise<void>;

  /**
   * Create checkout session for upgrade
   */
  createCheckoutSession(request: CheckoutRequest): Promise<CheckoutResponse>;

  /**
   * Create billing portal session
   */
  createPortalSession(returnUrl: string): Promise<{ portalUrl: string }>;

  /**
   * Refresh subscription status
   */
  refreshSubscription(): Promise<UserSubscription>;
}
