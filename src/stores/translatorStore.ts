/**
 * Translator Store
 * Manages translator voice and language settings
 */

import { create } from 'zustand';
import { getCurrentUserId } from './authStore';
import type { TranslatorStore, TranslatorVoice, LanguageCode } from './types';

const TRANSLATOR_VOICE_KEY = 'vox_translator_voice';
const TRANSLATOR_SETTINGS_KEY = 'vox_translator_settings';

// Supported languages by ElevenLabs multilingual model
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', flag: '🇨🇿' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'fil', name: 'Filipino', nativeName: 'Filipino', flag: '🇵🇭' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български', flag: '🇧🇬' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', flag: '🇷🇴' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', flag: '🇬🇷' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', flag: '🇫🇮' },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski', flag: '🇭🇷' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', flag: '🇲🇾' },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina', flag: '🇸🇰' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', flag: '🇩🇰' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', flag: '🇮🇳' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', flag: '🇺🇦' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', flag: '🇭🇺' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', flag: '🇳🇴' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', flag: '🇻🇳' },
] as const;

// Sample texts for voice cloning
export { SAMPLE_TEXTS } from '@/contexts/TranslatorContext';

export const useTranslatorStore = create<TranslatorStore>((set, get) => ({
  // State
  isSetupComplete: false,
  translatorVoice: null,
  sourceLanguage: 'en',
  targetLanguage: 'es',

  // Actions
  setSourceLanguage: (lang: LanguageCode) => {
    set({ sourceLanguage: lang });
    saveSettings(get());
  },

  setTargetLanguage: (lang: LanguageCode) => {
    set({ targetLanguage: lang });
    saveSettings(get());
  },

  saveTranslatorVoice: (voice: TranslatorVoice) => {
    set({ translatorVoice: voice, isSetupComplete: true });

    if (typeof window !== 'undefined') {
      const key = getVoiceStorageKey();
      localStorage.setItem(key, JSON.stringify(voice));
    }
  },

  clearTranslatorVoice: () => {
    set({ translatorVoice: null, isSetupComplete: false });

    if (typeof window !== 'undefined') {
      const key = getVoiceStorageKey();
      localStorage.removeItem(key);
    }
  },

  loadSettings: () => {
    if (typeof window === 'undefined') return;

    try {
      // Load voice
      const voiceKey = getVoiceStorageKey();
      const savedVoice = localStorage.getItem(voiceKey);
      if (savedVoice) {
        const voice = JSON.parse(savedVoice);
        set({ translatorVoice: voice, isSetupComplete: true });
      }

      // Load settings
      const settingsKey = getSettingsStorageKey();
      const savedSettings = localStorage.getItem(settingsKey);
      if (savedSettings) {
        const { sourceLanguage, targetLanguage } = JSON.parse(savedSettings);
        if (sourceLanguage) set({ sourceLanguage });
        if (targetLanguage) set({ targetLanguage });
      }
    } catch (error) {
      console.error('Error loading translator settings:', error);
    }
  },
}));

// Storage key helpers
function getVoiceStorageKey(): string {
  const userId = getCurrentUserId();
  return userId ? `${TRANSLATOR_VOICE_KEY}_${userId}` : TRANSLATOR_VOICE_KEY;
}

function getSettingsStorageKey(): string {
  const userId = getCurrentUserId();
  return userId ? `${TRANSLATOR_SETTINGS_KEY}_${userId}` : TRANSLATOR_SETTINGS_KEY;
}

function saveSettings(state: TranslatorStore): void {
  if (typeof window === 'undefined') return;

  const key = getSettingsStorageKey();
  localStorage.setItem(
    key,
    JSON.stringify({
      sourceLanguage: state.sourceLanguage,
      targetLanguage: state.targetLanguage,
    })
  );
}

/**
 * Get sample text for a language
 */
export function getSampleText(lang: LanguageCode): string {
  // Import from context for now - will be moved to shared utils
  const { SAMPLE_TEXTS } = require('@/contexts/TranslatorContext');
  return SAMPLE_TEXTS[lang] || SAMPLE_TEXTS.en;
}

/**
 * Initialize translator - call this on mount
 */
export function initTranslator(): void {
  const store = useTranslatorStore.getState();
  store.loadSettings();
}
