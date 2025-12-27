import { PlatformAdapter, PlatformAuthData, ShareData } from '../types';

/**
 * Web platform adapter
 * Provides standard web implementations for platform features
 */
export function createWebAdapter(): PlatformAdapter {
  return {
    // Navigation
    goBack: () => {
      if (typeof window !== 'undefined') {
        window.history.back();
      }
    },

    openUrl: (url: string) => {
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },

    share: async (data: ShareData) => {
      if (typeof window === 'undefined') return;

      // Use Web Share API if available
      if (navigator.share) {
        try {
          await navigator.share(data);
        } catch (error) {
          // User cancelled or share failed
          if ((error as Error).name !== 'AbortError') {
            console.error('Share failed:', error);
          }
        }
      } else {
        // Fallback: copy to clipboard
        const text = [data.title, data.text, data.url].filter(Boolean).join('\n');
        await navigator.clipboard.writeText(text);
      }
    },

    // UI
    setHeaderColor: (color: string) => {
      if (typeof document !== 'undefined') {
        // Update theme-color meta tag
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
          meta = document.createElement('meta');
          meta.setAttribute('name', 'theme-color');
          document.head.appendChild(meta);
        }
        meta.setAttribute('content', color);
      }
    },

    setBackgroundColor: (color: string) => {
      if (typeof document !== 'undefined') {
        document.body.style.backgroundColor = color;
      }
    },

    showAlert: async (message: string) => {
      if (typeof window !== 'undefined') {
        window.alert(message);
      }
    },

    showConfirm: async (message: string): Promise<boolean> => {
      if (typeof window !== 'undefined') {
        return window.confirm(message);
      }
      return false;
    },

    // Haptics (Web Vibration API - limited support)
    hapticFeedback: (type) => {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        const patterns: Record<string, number | number[]> = {
          light: 10,
          medium: 25,
          heavy: 50,
          success: [10, 50, 10],
          error: [50, 100, 50],
          warning: [25, 50, 25],
          selection: 5,
        };
        navigator.vibrate(patterns[type] || 10);
      }
    },

    // No cloud storage for web (use localStorage instead)
    cloudStorage: undefined,

    // Auth data - web uses Firebase auth, no platform-specific auth
    getAuthData: async (): Promise<PlatformAuthData | null> => {
      return {
        platform: 'web',
      };
    },
  };
}
