/**
 * Translator Store
 * Manages translator voice and language settings
 */

import { create } from 'zustand';
import { getCurrentUserId } from './authStore';
import type { TranslatorStore, TranslatorVoice, LanguageCode } from './types';

const TRANSLATOR_VOICE_KEY = 'vox_translator_voice';
const TRANSLATOR_SETTINGS_KEY = 'vox_translator_settings';
const FAVORITE_LANGUAGES_KEY = 'vox_favorite_languages';

/**
 * Get favorite languages from localStorage
 */
export function getFavoriteLanguages(userId?: string | null): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const key = userId ? `${FAVORITE_LANGUAGES_KEY}_${userId}` : FAVORITE_LANGUAGES_KEY;
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

/**
 * Toggle a language as favorite
 */
export function toggleFavoriteLanguage(langCode: string, userId?: string | null): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const key = userId ? `${FAVORITE_LANGUAGES_KEY}_${userId}` : FAVORITE_LANGUAGES_KEY;
    const favorites = getFavoriteLanguages(userId);
    const index = favorites.indexOf(langCode);
    if (index > -1) {
      favorites.splice(index, 1);
    } else {
      favorites.push(langCode);
    }
    localStorage.setItem(key, JSON.stringify(favorites));
    return favorites;
  } catch {
    return [];
  }
}

// Supported languages by ElevenLabs multilingual model (v3 supports 70+ languages)
export const SUPPORTED_LANGUAGES = [
  // Major Western European Languages
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱' },

  // Nordic Languages
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', flag: '🇳🇴' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', flag: '🇩🇰' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', flag: '🇫🇮' },
  { code: 'is', name: 'Icelandic', nativeName: 'Íslenska', flag: '🇮🇸' },

  // Baltic Languages
  { code: 'et', name: 'Estonian', nativeName: 'Eesti', flag: '🇪🇪' },
  { code: 'lv', name: 'Latvian', nativeName: 'Latviešu', flag: '🇱🇻' },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių', flag: '🇱🇹' },

  // Central European Languages
  { code: 'pl', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', flag: '🇨🇿' },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina', flag: '🇸🇰' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', flag: '🇭🇺' },
  { code: 'sl', name: 'Slovenian', nativeName: 'Slovenščina', flag: '🇸🇮' },

  // Balkan Languages
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski', flag: '🇭🇷' },
  { code: 'sr', name: 'Serbian', nativeName: 'Српски', flag: '🇷🇸' },
  { code: 'bs', name: 'Bosnian', nativeName: 'Bosanski', flag: '🇧🇦' },
  { code: 'mk', name: 'Macedonian', nativeName: 'Македонски', flag: '🇲🇰' },
  { code: 'sq', name: 'Albanian', nativeName: 'Shqip', flag: '🇦🇱' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български', flag: '🇧🇬' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', flag: '🇷🇴' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', flag: '🇬🇷' },

  // Eastern European Languages
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', flag: '🇺🇦' },
  { code: 'be', name: 'Belarusian', nativeName: 'Беларуская', flag: '🇧🇾' },

  // Iberian Regional Languages
  { code: 'ca', name: 'Catalan', nativeName: 'Català', flag: '🇪🇸' },
  { code: 'gl', name: 'Galician', nativeName: 'Galego', flag: '🇪🇸' },
  { code: 'eu', name: 'Basque', nativeName: 'Euskara', flag: '🇪🇸' },

  // Celtic Languages
  { code: 'ga', name: 'Irish', nativeName: 'Gaeilge', flag: '🇮🇪' },
  { code: 'cy', name: 'Welsh', nativeName: 'Cymraeg', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },

  // Middle Eastern Languages
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', flag: '🇮🇱' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی', flag: '🇮🇷' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },

  // Caucasus Languages
  { code: 'ka', name: 'Georgian', nativeName: 'ქართული', flag: '🇬🇪' },
  { code: 'hy', name: 'Armenian', nativeName: 'Հdelays', flag: '🇦🇲' },
  { code: 'az', name: 'Azerbaijani', nativeName: 'Azərbaycan', flag: '🇦🇿' },

  // Central Asian Languages
  { code: 'kk', name: 'Kazakh', nativeName: 'Қазақша', flag: '🇰🇿' },
  { code: 'uz', name: 'Uzbek', nativeName: 'Oʻzbek', flag: '🇺🇿' },

  // South Asian Languages
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', flag: '🇧🇩' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', flag: '🇵🇰' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', flag: '🇮🇳' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', flag: '🇮🇳' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', flag: '🇮🇳' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', flag: '🇮🇳' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', flag: '🇮🇳' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', flag: '🇮🇳' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', flag: '🇮🇳' },
  { code: 'ne', name: 'Nepali', nativeName: 'नेपाली', flag: '🇳🇵' },
  { code: 'si', name: 'Sinhala', nativeName: 'සිංහල', flag: '🇱🇰' },

  // Southeast Asian Languages
  { code: 'th', name: 'Thai', nativeName: 'ไทย', flag: '🇹🇭' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', flag: '🇲🇾' },
  { code: 'fil', name: 'Filipino', nativeName: 'Filipino', flag: '🇵🇭' },
  { code: 'my', name: 'Myanmar', nativeName: 'မြန်မာ', flag: '🇲🇲' },

  // East Asian Languages
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },

  // African Languages
  { code: 'af', name: 'Afrikaans', nativeName: 'Afrikaans', flag: '🇿🇦' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', flag: '🇰🇪' },
  { code: 'am', name: 'Amharic', nativeName: 'አማርኛ', flag: '🇪🇹' },
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
