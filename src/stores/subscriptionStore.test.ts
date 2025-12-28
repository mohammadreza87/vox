import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSubscriptionStore, useSubscriptionSelectors, initSubscription } from './subscriptionStore';
import { DEFAULT_SUBSCRIPTION, DEFAULT_USAGE } from '@/shared/types/subscription';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock sync middleware
vi.mock('./middleware/sync', () => ({
  getAuthToken: vi.fn(() => Promise.resolve('test-token')),
}));

const { getAuthToken } = await import('./middleware/sync');

describe('subscriptionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    useSubscriptionStore.setState({
      tier: 'free',
      subscription: DEFAULT_SUBSCRIPTION,
      usage: DEFAULT_USAGE,
      isLoading: true,
      upgradeModalFeature: null,
    });
  });

  describe('Initial State', () => {
    it('has correct initial state', () => {
      const state = useSubscriptionStore.getState();
      expect(state.tier).toBe('free');
      expect(state.isLoading).toBe(true);
      expect(state.upgradeModalFeature).toBe(null);
    });
  });

  describe('setSubscription', () => {
    it('updates subscription and tier', () => {
      const newSubscription = {
        ...DEFAULT_SUBSCRIPTION,
        tier: 'pro' as const,
        status: 'active' as const,
      };

      useSubscriptionStore.getState().setSubscription(newSubscription);

      expect(useSubscriptionStore.getState().subscription).toEqual(newSubscription);
      expect(useSubscriptionStore.getState().tier).toBe('pro');
    });
  });

  describe('setUsage', () => {
    it('updates usage data', () => {
      const newUsage = {
        ...DEFAULT_USAGE,
        messagesUsedToday: 50,
        customContactsCount: 3,
      };

      useSubscriptionStore.getState().setUsage(newUsage);

      expect(useSubscriptionStore.getState().usage).toEqual(newUsage);
    });
  });

  describe('setLoading', () => {
    it('updates loading state', () => {
      useSubscriptionStore.getState().setLoading(false);
      expect(useSubscriptionStore.getState().isLoading).toBe(false);

      useSubscriptionStore.getState().setLoading(true);
      expect(useSubscriptionStore.getState().isLoading).toBe(true);
    });
  });

  describe('fetchSubscription', () => {
    it('fetches subscription from API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            subscription: {
              tier: 'pro',
              status: 'active',
            },
            usage: {
              messagesUsedToday: 25,
              messagesDailyReset: new Date().toISOString(),
              customContactsCount: 2,
            },
          }),
      });

      await useSubscriptionStore.getState().fetchSubscription();

      expect(mockFetch).toHaveBeenCalledWith('/api/user/subscription', {
        headers: { Authorization: 'Bearer test-token' },
      });
      expect(useSubscriptionStore.getState().tier).toBe('pro');
      expect(useSubscriptionStore.getState().usage.messagesUsedToday).toBe(25);
      expect(useSubscriptionStore.getState().isLoading).toBe(false);
    });

    it('sets free tier when no token', async () => {
      vi.mocked(getAuthToken).mockResolvedValueOnce(null);

      await useSubscriptionStore.getState().fetchSubscription();

      expect(useSubscriptionStore.getState().tier).toBe('free');
      expect(useSubscriptionStore.getState().isLoading).toBe(false);
    });

    it('handles API error gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await useSubscriptionStore.getState().fetchSubscription();

      expect(useSubscriptionStore.getState().isLoading).toBe(false);
    });

    it('handles network error gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await useSubscriptionStore.getState().fetchSubscription();

      expect(useSubscriptionStore.getState().isLoading).toBe(false);
    });
  });

  describe('refreshSubscription', () => {
    it('sets loading and fetches subscription', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            subscription: { tier: 'max' },
            usage: {
              messagesUsedToday: 100,
              messagesDailyReset: new Date().toISOString(),
            },
          }),
      });

      await useSubscriptionStore.getState().refreshSubscription();

      expect(useSubscriptionStore.getState().tier).toBe('max');
    });
  });

  describe('incrementLocalMessageCount', () => {
    it('increments message count by 1', () => {
      useSubscriptionStore.setState({
        usage: { ...DEFAULT_USAGE, messagesUsedToday: 10 },
      });

      useSubscriptionStore.getState().incrementLocalMessageCount();

      expect(useSubscriptionStore.getState().usage.messagesUsedToday).toBe(11);
    });
  });

  describe('updateLocalContactsCount', () => {
    it('updates contacts count', () => {
      useSubscriptionStore.getState().updateLocalContactsCount(5);

      expect(useSubscriptionStore.getState().usage.customContactsCount).toBe(5);
    });
  });

  describe('Upgrade Modal', () => {
    it('shows upgrade modal', () => {
      useSubscriptionStore.getState().showUpgradeModal('voiceCloning');

      expect(useSubscriptionStore.getState().upgradeModalFeature).toBe('voiceCloning');
    });

    it('hides upgrade modal', () => {
      useSubscriptionStore.setState({ upgradeModalFeature: 'voiceCloning' });

      useSubscriptionStore.getState().hideUpgradeModal();

      expect(useSubscriptionStore.getState().upgradeModalFeature).toBe(null);
    });
  });

  describe('initSubscription', () => {
    it('calls fetchSubscription', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            subscription: { tier: 'pro' },
            usage: {
              messagesUsedToday: 0,
              messagesDailyReset: new Date().toISOString(),
            },
          }),
      });

      await initSubscription();

      expect(mockFetch).toHaveBeenCalled();
    });
  });
});

// Note: useSubscriptionSelectors is a React hook and needs to be tested in a React component context.
// The hook functionality is tested indirectly through the store state tests above.
