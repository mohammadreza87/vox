import { PlatformAdapter, PlatformAuthData, ShareData, TelegramWebApp } from '../types';
import { getTelegramWebApp } from '../detect';

/**
 * Telegram Mini App platform adapter
 * Provides Telegram-specific implementations for platform features
 */
export function createTelegramAdapter(): PlatformAdapter {
  const getWebApp = (): TelegramWebApp | null => getTelegramWebApp();

  return {
    // Navigation
    goBack: () => {
      const webApp = getWebApp();
      if (webApp) {
        // Check if we can go back in history
        if (window.history.length > 1) {
          window.history.back();
        } else {
          // Close the Mini App
          webApp.close();
        }
      }
    },

    openUrl: (url: string) => {
      const webApp = getWebApp();
      if (webApp) {
        // Check if it's a Telegram link
        if (url.includes('t.me') || url.includes('telegram.me')) {
          webApp.openTelegramLink(url);
        } else {
          webApp.openLink(url, { try_instant_view: true });
        }
      } else if (typeof window !== 'undefined') {
        window.open(url, '_blank');
      }
    },

    share: async (data: ShareData) => {
      const webApp = getWebApp();
      if (webApp) {
        // Use Telegram's native share via inline query
        const text = [data.title, data.text, data.url].filter(Boolean).join(' ');
        webApp.switchInlineQuery(text, ['users', 'groups', 'channels']);
      } else if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share(data);
      }
    },

    // UI
    setHeaderColor: (color: string) => {
      const webApp = getWebApp();
      if (webApp) {
        webApp.setHeaderColor(color);
      }
    },

    setBackgroundColor: (color: string) => {
      const webApp = getWebApp();
      if (webApp) {
        webApp.setBackgroundColor(color);
      }
    },

    showAlert: async (message: string) => {
      const webApp = getWebApp();
      return new Promise<void>((resolve) => {
        if (webApp) {
          webApp.showAlert(message, () => resolve());
        } else {
          window.alert(message);
          resolve();
        }
      });
    },

    showConfirm: async (message: string): Promise<boolean> => {
      const webApp = getWebApp();
      return new Promise<boolean>((resolve) => {
        if (webApp) {
          webApp.showConfirm(message, (confirmed) => resolve(confirmed));
        } else {
          resolve(window.confirm(message));
        }
      });
    },

    // Haptics - Telegram has excellent haptic support
    hapticFeedback: (type) => {
      const webApp = getWebApp();
      if (!webApp?.HapticFeedback) return;

      switch (type) {
        case 'light':
          webApp.HapticFeedback.impactOccurred('light');
          break;
        case 'medium':
          webApp.HapticFeedback.impactOccurred('medium');
          break;
        case 'heavy':
          webApp.HapticFeedback.impactOccurred('heavy');
          break;
        case 'success':
          webApp.HapticFeedback.notificationOccurred('success');
          break;
        case 'error':
          webApp.HapticFeedback.notificationOccurred('error');
          break;
        case 'warning':
          webApp.HapticFeedback.notificationOccurred('warning');
          break;
        case 'selection':
          webApp.HapticFeedback.selectionChanged();
          break;
      }
    },

    // Telegram Cloud Storage
    cloudStorage: {
      get: async (key: string): Promise<string | null> => {
        const webApp = getWebApp();
        if (!webApp?.CloudStorage) return null;

        return new Promise((resolve) => {
          webApp.CloudStorage.getItem(key, (error, value) => {
            if (error) {
              console.error('CloudStorage get error:', error);
              resolve(null);
            } else {
              resolve(value || null);
            }
          });
        });
      },

      set: async (key: string, value: string): Promise<boolean> => {
        const webApp = getWebApp();
        if (!webApp?.CloudStorage) return false;

        return new Promise((resolve) => {
          webApp.CloudStorage.setItem(key, value, (error, stored) => {
            if (error) {
              console.error('CloudStorage set error:', error);
              resolve(false);
            } else {
              resolve(stored);
            }
          });
        });
      },

      remove: async (key: string): Promise<boolean> => {
        const webApp = getWebApp();
        if (!webApp?.CloudStorage) return false;

        return new Promise((resolve) => {
          webApp.CloudStorage.removeItem(key, (error, removed) => {
            if (error) {
              console.error('CloudStorage remove error:', error);
              resolve(false);
            } else {
              resolve(removed);
            }
          });
        });
      },

      keys: async (): Promise<string[]> => {
        const webApp = getWebApp();
        if (!webApp?.CloudStorage) return [];

        return new Promise((resolve) => {
          webApp.CloudStorage.getKeys((error, keys) => {
            if (error) {
              console.error('CloudStorage keys error:', error);
              resolve([]);
            } else {
              resolve(keys || []);
            }
          });
        });
      },
    },

    // Auth data - Telegram provides user data through initData
    getAuthData: async (): Promise<PlatformAuthData | null> => {
      const webApp = getWebApp();
      if (!webApp) return null;

      const { user } = webApp.initDataUnsafe;
      if (!user) return null;

      return {
        platform: 'telegram',
        telegramUser: user,
        initData: webApp.initData,
      };
    },
  };
}

/**
 * Initialize Telegram Mini App
 * Call this early in the app lifecycle
 */
export function initializeTelegramApp(): void {
  const webApp = getTelegramWebApp();
  if (!webApp) return;

  // Mark the app as ready
  webApp.ready();

  // Expand to full height
  webApp.expand();

  // Enable closing confirmation for unsaved changes
  webApp.enableClosingConfirmation();
}

/**
 * Setup Telegram back button handler
 */
export function setupTelegramBackButton(onBack: () => void): () => void {
  const webApp = getTelegramWebApp();
  if (!webApp?.BackButton) {
    return () => {};
  }

  webApp.BackButton.onClick(onBack);
  webApp.BackButton.show();

  // Return cleanup function
  return () => {
    webApp.BackButton.offClick(onBack);
    webApp.BackButton.hide();
  };
}

/**
 * Setup Telegram main button
 */
export function setupTelegramMainButton(
  text: string,
  onClick: () => void,
  options?: {
    color?: string;
    textColor?: string;
    isActive?: boolean;
  }
): () => void {
  const webApp = getTelegramWebApp();
  if (!webApp?.MainButton) {
    return () => {};
  }

  webApp.MainButton.setParams({
    text,
    color: options?.color,
    text_color: options?.textColor,
    is_active: options?.isActive ?? true,
    is_visible: true,
  });

  webApp.MainButton.onClick(onClick);
  webApp.MainButton.show();

  // Return cleanup function
  return () => {
    webApp.MainButton.offClick(onClick);
    webApp.MainButton.hide();
  };
}
