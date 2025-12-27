import { PlatformInfo, PlatformType, TelegramWebApp } from './types';

/**
 * Detect the current platform (web, telegram, or pwa)
 */
export function detectPlatform(): PlatformType {
  if (typeof window === 'undefined') {
    return 'web';
  }

  // Check for Telegram Mini App
  if (isTelegramMiniApp()) {
    return 'telegram';
  }

  // Check for PWA (installed web app)
  if (isPWA()) {
    return 'pwa';
  }

  return 'web';
}

/**
 * Check if running inside Telegram Mini App
 */
export function isTelegramMiniApp(): boolean {
  if (typeof window === 'undefined') return false;

  // Check for Telegram WebApp object
  if (window.Telegram?.WebApp) {
    const webApp = window.Telegram.WebApp;
    // Verify we have valid init data (not just the object existing)
    return Boolean(webApp.initData && webApp.initData.length > 0);
  }

  // Fallback: check URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.has('tgWebAppData') || urlParams.has('tgWebAppStartParam');
}

/**
 * Check if running as PWA (installed web app)
 */
export function isPWA(): boolean {
  if (typeof window === 'undefined') return false;

  // Check display-mode media query
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

  // iOS Safari check
  const isIOSStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return isStandalone || isIOSStandalone;
}

/**
 * Check if on mobile device
 */
export function isMobile(): boolean {
  if (typeof window === 'undefined') return false;

  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

/**
 * Check if on iOS
 */
export function isIOS(): boolean {
  if (typeof window === 'undefined') return false;

  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Check if on Android
 */
export function isAndroid(): boolean {
  if (typeof window === 'undefined') return false;

  return /Android/i.test(navigator.userAgent);
}

/**
 * Get Telegram WebApp instance (if available)
 */
export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp || null;
}

/**
 * Get comprehensive platform information
 */
export function getPlatformInfo(): PlatformInfo {
  const type = detectPlatform();
  const telegramApp = getTelegramWebApp();

  return {
    type,
    isTelegram: type === 'telegram',
    isWeb: type === 'web',
    isPWA: type === 'pwa',
    isMobile: isMobile(),
    isIOS: isIOS(),
    isAndroid: isAndroid(),
    version: telegramApp?.version,
  };
}

/**
 * Get Telegram theme colors (if in Telegram)
 */
export function getTelegramTheme() {
  const telegramApp = getTelegramWebApp();
  if (!telegramApp) return null;

  return {
    colorScheme: telegramApp.colorScheme,
    bgColor: telegramApp.themeParams.bg_color,
    textColor: telegramApp.themeParams.text_color,
    hintColor: telegramApp.themeParams.hint_color,
    linkColor: telegramApp.themeParams.link_color,
    buttonColor: telegramApp.themeParams.button_color,
    buttonTextColor: telegramApp.themeParams.button_text_color,
    secondaryBgColor: telegramApp.themeParams.secondary_bg_color,
  };
}

/**
 * Get safe area insets for notched devices
 */
export function getSafeAreaInsets() {
  if (typeof window === 'undefined') {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }

  const style = getComputedStyle(document.documentElement);

  return {
    top: parseInt(style.getPropertyValue('--sat') || '0', 10) ||
         parseInt(style.getPropertyValue('env(safe-area-inset-top)') || '0', 10),
    bottom: parseInt(style.getPropertyValue('--sab') || '0', 10) ||
            parseInt(style.getPropertyValue('env(safe-area-inset-bottom)') || '0', 10),
    left: parseInt(style.getPropertyValue('--sal') || '0', 10) ||
          parseInt(style.getPropertyValue('env(safe-area-inset-left)') || '0', 10),
    right: parseInt(style.getPropertyValue('--sar') || '0', 10) ||
           parseInt(style.getPropertyValue('env(safe-area-inset-right)') || '0', 10),
  };
}
