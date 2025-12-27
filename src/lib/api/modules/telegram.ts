import { api } from '../client';
import type { TelegramUser } from '@/lib/platform/types';

interface TelegramAuthResponse {
  success: boolean;
  user: {
    id: string;
    telegramId: number;
    firstName: string;
    lastName?: string;
    username?: string;
    isPremium?: boolean;
  };
  isNewUser: boolean;
}

interface TelegramAuthStatusResponse {
  enabled: boolean;
}

/**
 * Telegram API module
 */
export const telegramApi = {
  /**
   * Authenticate with Telegram Mini App init data
   */
  authenticate: async (initData: string): Promise<TelegramAuthResponse> => {
    return api.post<TelegramAuthResponse>('/api/auth/telegram', {
      initData,
    });
  },

  /**
   * Check if Telegram auth is enabled
   */
  getAuthStatus: async (): Promise<TelegramAuthStatusResponse> => {
    return api.get<TelegramAuthStatusResponse>('/api/auth/telegram');
  },
};

/**
 * Helper to format Telegram user display name
 */
export function formatTelegramUserName(user: TelegramUser): string {
  const parts = [user.first_name];
  if (user.last_name) {
    parts.push(user.last_name);
  }
  return parts.join(' ');
}

/**
 * Helper to get Telegram user avatar URL
 */
export function getTelegramAvatarUrl(user: TelegramUser): string | null {
  return user.photo_url || null;
}

/**
 * Helper to create a unique user ID from Telegram user
 */
export function getTelegramUserId(user: TelegramUser): string {
  return `telegram_${user.id}`;
}
