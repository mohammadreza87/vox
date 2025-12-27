// Platform types for web and Telegram Mini App support

export type PlatformType = 'web' | 'telegram' | 'pwa';

export interface PlatformInfo {
  type: PlatformType;
  isTelegram: boolean;
  isWeb: boolean;
  isPWA: boolean;
  isMobile: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  version?: string;
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    query_id?: string;
    user?: TelegramUser;
    auth_date: number;
    hash: string;
  };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: {
    bg_color?: string;
    text_color?: string;
    hint_color?: string;
    link_color?: string;
    button_color?: string;
    button_text_color?: string;
    secondary_bg_color?: string;
  };
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  headerColor: string;
  backgroundColor: string;
  isClosingConfirmationEnabled: boolean;
  // Methods
  ready: () => void;
  expand: () => void;
  close: () => void;
  enableClosingConfirmation: () => void;
  disableClosingConfirmation: () => void;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  showAlert: (message: string, callback?: () => void) => void;
  showConfirm: (message: string, callback?: (confirmed: boolean) => void) => void;
  showPopup: (params: TelegramPopupParams, callback?: (buttonId: string) => void) => void;
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink: (url: string) => void;
  openInvoice: (url: string, callback?: (status: string) => void) => void;
  requestWriteAccess: (callback?: (granted: boolean) => void) => void;
  requestContact: (callback?: (shared: boolean) => void) => void;
  switchInlineQuery: (query: string, chooseChatTypes?: string[]) => void;
  sendData: (data: string) => void;
  // Haptic feedback
  HapticFeedback: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
  // Main button
  MainButton: TelegramMainButton;
  // Back button
  BackButton: TelegramBackButton;
  // Cloud storage
  CloudStorage: TelegramCloudStorage;
}

export interface TelegramPopupParams {
  title?: string;
  message: string;
  buttons?: Array<{
    id?: string;
    type?: 'default' | 'ok' | 'close' | 'cancel' | 'destructive';
    text?: string;
  }>;
}

export interface TelegramMainButton {
  text: string;
  color: string;
  textColor: string;
  isVisible: boolean;
  isActive: boolean;
  isProgressVisible: boolean;
  setText: (text: string) => void;
  onClick: (callback: () => void) => void;
  offClick: (callback: () => void) => void;
  show: () => void;
  hide: () => void;
  enable: () => void;
  disable: () => void;
  showProgress: (leaveActive?: boolean) => void;
  hideProgress: () => void;
  setParams: (params: {
    text?: string;
    color?: string;
    text_color?: string;
    is_active?: boolean;
    is_visible?: boolean;
  }) => void;
}

export interface TelegramBackButton {
  isVisible: boolean;
  onClick: (callback: () => void) => void;
  offClick: (callback: () => void) => void;
  show: () => void;
  hide: () => void;
}

export interface TelegramCloudStorage {
  setItem: (key: string, value: string, callback?: (error: Error | null, stored: boolean) => void) => void;
  getItem: (key: string, callback: (error: Error | null, value: string) => void) => void;
  getItems: (keys: string[], callback: (error: Error | null, values: Record<string, string>) => void) => void;
  removeItem: (key: string, callback?: (error: Error | null, removed: boolean) => void) => void;
  removeItems: (keys: string[], callback?: (error: Error | null, removed: boolean) => void) => void;
  getKeys: (callback: (error: Error | null, keys: string[]) => void) => void;
}

// Platform adapter interface
export interface PlatformAdapter {
  // Navigation
  goBack: () => void;
  openUrl: (url: string) => void;
  share: (data: ShareData) => Promise<void>;

  // UI
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  showAlert: (message: string) => Promise<void>;
  showConfirm: (message: string) => Promise<boolean>;

  // Haptics
  hapticFeedback: (type: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning' | 'selection') => void;

  // Storage (for Telegram Cloud Storage)
  cloudStorage?: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<boolean>;
    remove: (key: string) => Promise<boolean>;
    keys: () => Promise<string[]>;
  };

  // Auth
  getAuthData: () => Promise<PlatformAuthData | null>;
}

export interface PlatformAuthData {
  platform: PlatformType;
  telegramUser?: TelegramUser;
  initData?: string;
}

export interface ShareData {
  title?: string;
  text?: string;
  url?: string;
}

// Declare global Telegram object
declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}
