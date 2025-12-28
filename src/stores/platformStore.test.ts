import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePlatformStore } from './platformStore';

// Mock platform utilities
vi.mock('@/lib/platform', () => ({
  getPlatformInfo: vi.fn(() => ({
    type: 'web',
    isTelegram: false,
    isWeb: true,
    isPWA: false,
    isMobile: false,
    isIOS: false,
    isAndroid: false,
  })),
  getPlatformAdapter: vi.fn(() => ({
    goBack: vi.fn(),
    openUrl: vi.fn(),
    share: vi.fn(),
    showAlert: vi.fn(),
    showConfirm: vi.fn(() => Promise.resolve(true)),
    hapticFeedback: vi.fn(),
  })),
  getTelegramWebApp: vi.fn(() => null),
  initializeTelegramApp: vi.fn(),
}));

const { getPlatformInfo, getPlatformAdapter, getTelegramWebApp } = await import('@/lib/platform');

describe('platformStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlatformStore.setState({
      platform: 'web',
      info: {
        type: 'web',
        isTelegram: false,
        isWeb: true,
        isPWA: false,
        isMobile: false,
        isIOS: false,
        isAndroid: false,
      },
      adapter: null,
      isInitialized: false,
      telegramUser: null,
      telegramTheme: null,
      telegramSession: null,
    });
  });

  describe('Initial State', () => {
    it('has correct initial state', () => {
      const state = usePlatformStore.getState();
      expect(state.platform).toBe('web');
      expect(state.isInitialized).toBe(false);
      expect(state.telegramUser).toBe(null);
      expect(state.info.isTelegram).toBe(false);
    });
  });

  describe('initialize', () => {
    it('initializes platform info', () => {
      usePlatformStore.getState().initialize();

      expect(getPlatformInfo).toHaveBeenCalled();
      expect(getPlatformAdapter).toHaveBeenCalled();
      expect(usePlatformStore.getState().isInitialized).toBe(true);
    });

    it('detects web platform', () => {
      vi.mocked(getPlatformInfo).mockReturnValue({
        type: 'web',
        isTelegram: false,
        isWeb: true,
        isPWA: false,
        isMobile: false,
        isIOS: false,
        isAndroid: false,
      });

      usePlatformStore.getState().initialize();

      expect(usePlatformStore.getState().platform).toBe('web');
      expect(usePlatformStore.getState().info.isWeb).toBe(true);
    });

    it('detects Telegram platform', () => {
      vi.mocked(getPlatformInfo).mockReturnValue({
        type: 'telegram',
        isTelegram: true,
        isWeb: false,
        isPWA: false,
        isMobile: true,
        isIOS: false,
        isAndroid: true,
      });

      vi.mocked(getTelegramWebApp).mockReturnValue({
        initDataUnsafe: {
          user: {
            id: 123456,
            first_name: 'Test',
            last_name: 'User',
            username: 'testuser',
          },
        },
        colorScheme: 'dark',
      } as never);

      usePlatformStore.getState().initialize();

      expect(usePlatformStore.getState().platform).toBe('telegram');
      expect(usePlatformStore.getState().info.isTelegram).toBe(true);
      expect(usePlatformStore.getState().telegramTheme).toBe('dark');
    });
  });

  describe('setTelegramUser', () => {
    it('sets telegram user', () => {
      const telegramUser = {
        id: 123456,
        first_name: 'Test',
        last_name: 'User',
        username: 'testuser',
      };

      usePlatformStore.getState().setTelegramUser(telegramUser as never);

      expect(usePlatformStore.getState().telegramUser).toEqual(telegramUser);
    });

    it('clears telegram user', () => {
      usePlatformStore.setState({
        telegramUser: { id: 123456, first_name: 'Test' } as never,
      });

      usePlatformStore.getState().setTelegramUser(null);

      expect(usePlatformStore.getState().telegramUser).toBe(null);
    });
  });

  describe('setTelegramSession', () => {
    it('sets telegram session', () => {
      const session = {
        token: 'test-token',
        userId: 'user-123',
        telegramId: 123456,
        exp: Date.now() + 3600000,
      };

      usePlatformStore.getState().setTelegramSession(session);

      expect(usePlatformStore.getState().telegramSession).toEqual(session);
    });
  });

  describe('isAuthenticated', () => {
    it('returns false when no session', () => {
      expect(usePlatformStore.getState().isAuthenticated()).toBe(false);
    });

    it('returns true when session is valid', () => {
      usePlatformStore.setState({
        telegramSession: {
          token: 'test-token',
          userId: 'user-123',
          telegramId: 123456,
          exp: Date.now() + 3600000,
        },
      });

      expect(usePlatformStore.getState().isAuthenticated()).toBe(true);
    });

    it('returns false when session is expired', () => {
      usePlatformStore.setState({
        telegramSession: {
          token: 'test-token',
          userId: 'user-123',
          telegramId: 123456,
          exp: Date.now() - 1000,
        },
      });

      expect(usePlatformStore.getState().isAuthenticated()).toBe(false);
    });
  });

  describe('Convenience Methods', () => {
    it('goBack delegates to adapter', () => {
      const mockGoBack = vi.fn();
      usePlatformStore.setState({
        adapter: {
          goBack: mockGoBack,
          openUrl: vi.fn(),
          share: vi.fn(),
          showAlert: vi.fn(),
          showConfirm: vi.fn(),
          hapticFeedback: vi.fn(),
        } as never,
      });

      usePlatformStore.getState().goBack();

      expect(mockGoBack).toHaveBeenCalled();
    });

    it('openUrl delegates to adapter', () => {
      const mockOpenUrl = vi.fn();
      usePlatformStore.setState({
        adapter: {
          goBack: vi.fn(),
          openUrl: mockOpenUrl,
          share: vi.fn(),
          showAlert: vi.fn(),
          showConfirm: vi.fn(),
          hapticFeedback: vi.fn(),
        } as never,
      });

      usePlatformStore.getState().openUrl('https://example.com');

      expect(mockOpenUrl).toHaveBeenCalledWith('https://example.com');
    });

    it('share delegates to adapter', async () => {
      const mockShare = vi.fn().mockResolvedValue(undefined);
      usePlatformStore.setState({
        adapter: {
          goBack: vi.fn(),
          openUrl: vi.fn(),
          share: mockShare,
          showAlert: vi.fn(),
          showConfirm: vi.fn(),
          hapticFeedback: vi.fn(),
        } as never,
      });

      await usePlatformStore.getState().share({ title: 'Test', text: 'Hello' });

      expect(mockShare).toHaveBeenCalledWith({ title: 'Test', text: 'Hello' });
    });

    it('hapticFeedback delegates to adapter', () => {
      const mockHaptic = vi.fn();
      usePlatformStore.setState({
        adapter: {
          goBack: vi.fn(),
          openUrl: vi.fn(),
          share: vi.fn(),
          showAlert: vi.fn(),
          showConfirm: vi.fn(),
          hapticFeedback: mockHaptic,
        } as never,
      });

      usePlatformStore.getState().hapticFeedback('success');

      expect(mockHaptic).toHaveBeenCalledWith('success');
    });
  });
});
