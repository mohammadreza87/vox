import { PlatformAdapter, PlatformType } from '../types';
import { detectPlatform } from '../detect';
import { createWebAdapter } from './web';
import { createTelegramAdapter } from './telegram';

let cachedAdapter: PlatformAdapter | null = null;
let cachedPlatformType: PlatformType | null = null;

/**
 * Get the platform adapter for the current platform
 * Automatically detects and returns the appropriate adapter
 */
export function getPlatformAdapter(): PlatformAdapter {
  const currentPlatform = detectPlatform();

  // Return cached adapter if platform hasn't changed
  if (cachedAdapter && cachedPlatformType === currentPlatform) {
    return cachedAdapter;
  }

  // Create new adapter based on platform
  switch (currentPlatform) {
    case 'telegram':
      cachedAdapter = createTelegramAdapter();
      break;
    case 'pwa':
    case 'web':
    default:
      cachedAdapter = createWebAdapter();
      break;
  }

  cachedPlatformType = currentPlatform;
  return cachedAdapter;
}

/**
 * Create a platform adapter for a specific platform type
 */
export function createPlatformAdapter(platform: PlatformType): PlatformAdapter {
  switch (platform) {
    case 'telegram':
      return createTelegramAdapter();
    case 'pwa':
    case 'web':
    default:
      return createWebAdapter();
  }
}

export { createWebAdapter } from './web';
export { createTelegramAdapter, initializeTelegramApp, setupTelegramBackButton, setupTelegramMainButton } from './telegram';
