import { create } from 'zustand';
import {
  PlatformInfo,
  PlatformType,
  PlatformAdapter,
  TelegramUser,
  getPlatformInfo,
  getPlatformAdapter,
  getTelegramWebApp,
  initializeTelegramApp,
} from '@/lib/platform';

// Telegram session data
interface TelegramSession {
  token: string;
  userId: string;
  telegramId: number;
  exp: number;
}

interface PlatformState {
  // Platform info
  platform: PlatformType;
  info: PlatformInfo;
  adapter: PlatformAdapter | null;
  isInitialized: boolean;

  // Telegram-specific
  telegramUser: TelegramUser | null;
  telegramTheme: 'light' | 'dark' | null;
  telegramSession: TelegramSession | null;

  // Actions
  initialize: () => void;
  setTelegramUser: (user: TelegramUser | null) => void;
  setTelegramSession: (session: TelegramSession | null) => void;
  isAuthenticated: () => boolean;

  // Convenience methods (delegate to adapter)
  goBack: () => void;
  openUrl: (url: string) => void;
  share: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  showAlert: (message: string) => Promise<void>;
  showConfirm: (message: string) => Promise<boolean>;
  hapticFeedback: (type: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning' | 'selection') => void;
}

export const usePlatformStore = create<PlatformState>((set, get) => ({
  // Initial state
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

  // Initialize platform detection
  initialize: () => {
    if (typeof window === 'undefined') return;

    const info = getPlatformInfo();
    const adapter = getPlatformAdapter();

    // Initialize Telegram if needed
    if (info.isTelegram) {
      initializeTelegramApp();

      const webApp = getTelegramWebApp();
      if (webApp) {
        set({
          telegramUser: webApp.initDataUnsafe.user || null,
          telegramTheme: webApp.colorScheme,
        });
      }
    }

    set({
      platform: info.type,
      info,
      adapter,
      isInitialized: true,
    });
  },

  setTelegramUser: (user) => {
    set({ telegramUser: user });
  },

  setTelegramSession: (session) => {
    set({ telegramSession: session });
  },

  isAuthenticated: () => {
    const { telegramSession } = get();
    if (telegramSession && telegramSession.exp > Date.now()) {
      return true;
    }
    return false;
  },

  // Convenience methods
  goBack: () => {
    const { adapter } = get();
    adapter?.goBack();
  },

  openUrl: (url: string) => {
    const { adapter } = get();
    adapter?.openUrl(url);
  },

  share: async (data) => {
    const { adapter } = get();
    if (adapter) {
      await adapter.share(data);
    }
  },

  showAlert: async (message: string) => {
    const { adapter } = get();
    if (adapter) {
      await adapter.showAlert(message);
    }
  },

  showConfirm: async (message: string): Promise<boolean> => {
    const { adapter } = get();
    if (adapter) {
      return adapter.showConfirm(message);
    }
    return false;
  },

  hapticFeedback: (type) => {
    const { adapter } = get();
    adapter?.hapticFeedback(type);
  },
}));

// Selector hooks for common use cases
export const usePlatform = () => usePlatformStore((state) => state.platform);
export const useIsTelegram = () => usePlatformStore((state) => state.info.isTelegram);
export const useIsMobile = () => usePlatformStore((state) => state.info.isMobile);
export const useTelegramUser = () => usePlatformStore((state) => state.telegramUser);
export const usePlatformAdapter = () => usePlatformStore((state) => state.adapter);
