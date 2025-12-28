import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTranslatorStore, SUPPORTED_LANGUAGES, initTranslator } from './translatorStore';

// Mock authStore
vi.mock('./authStore', () => ({
  getCurrentUserId: vi.fn(() => null),
}));

const { getCurrentUserId } = await import('./authStore');

describe('translatorStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    vi.mocked(localStorage.setItem).mockClear();
    vi.mocked(localStorage.removeItem).mockClear();
    useTranslatorStore.setState({
      isSetupComplete: false,
      translatorVoice: null,
      sourceLanguage: 'en',
      targetLanguage: 'es',
    });
  });

  describe('Initial State', () => {
    it('has correct initial state', () => {
      const state = useTranslatorStore.getState();
      expect(state.isSetupComplete).toBe(false);
      expect(state.translatorVoice).toBe(null);
      expect(state.sourceLanguage).toBe('en');
      expect(state.targetLanguage).toBe('es');
    });
  });

  describe('SUPPORTED_LANGUAGES', () => {
    it('contains English', () => {
      const english = SUPPORTED_LANGUAGES.find((l) => l.code === 'en');
      expect(english).toBeDefined();
      expect(english?.name).toBe('English');
    });

    it('contains Spanish', () => {
      const spanish = SUPPORTED_LANGUAGES.find((l) => l.code === 'es');
      expect(spanish).toBeDefined();
      expect(spanish?.name).toBe('Spanish');
    });

    it('has at least 20 languages', () => {
      expect(SUPPORTED_LANGUAGES.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe('setSourceLanguage', () => {
    it('updates source language', () => {
      useTranslatorStore.getState().setSourceLanguage('fr');
      expect(useTranslatorStore.getState().sourceLanguage).toBe('fr');
    });

    it('saves to localStorage', () => {
      useTranslatorStore.getState().setSourceLanguage('de');
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'vox_translator_settings',
        expect.stringContaining('"sourceLanguage":"de"')
      );
    });
  });

  describe('setTargetLanguage', () => {
    it('updates target language', () => {
      useTranslatorStore.getState().setTargetLanguage('ja');
      expect(useTranslatorStore.getState().targetLanguage).toBe('ja');
    });

    it('saves to localStorage', () => {
      useTranslatorStore.getState().setTargetLanguage('ko');
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'vox_translator_settings',
        expect.stringContaining('"targetLanguage":"ko"')
      );
    });
  });

  describe('saveTranslatorVoice', () => {
    const mockVoice = {
      voiceId: 'voice-123',
      name: 'My Voice',
      sourceLanguage: 'en',
      createdAt: new Date().toISOString(),
    };

    it('saves voice and sets setup complete', () => {
      useTranslatorStore.getState().saveTranslatorVoice(mockVoice);

      const state = useTranslatorStore.getState();
      expect(state.translatorVoice).toEqual(mockVoice);
      expect(state.isSetupComplete).toBe(true);
    });

    it('saves voice to localStorage', () => {
      useTranslatorStore.getState().saveTranslatorVoice(mockVoice);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'vox_translator_voice',
        expect.stringContaining('"voiceId":"voice-123"')
      );
    });

    it('saves to user-specific key when logged in', () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123');

      useTranslatorStore.getState().saveTranslatorVoice(mockVoice);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'vox_translator_voice_user-123',
        expect.any(String)
      );
    });
  });

  describe('clearTranslatorVoice', () => {
    it('clears voice and setup status', () => {
      useTranslatorStore.setState({
        translatorVoice: {
          voiceId: 'voice-123',
          name: 'My Voice',
          sourceLanguage: 'en',
          createdAt: new Date().toISOString(),
        },
        isSetupComplete: true,
      });

      useTranslatorStore.getState().clearTranslatorVoice();

      const state = useTranslatorStore.getState();
      expect(state.translatorVoice).toBe(null);
      expect(state.isSetupComplete).toBe(false);
    });

    it('removes voice from localStorage', () => {
      vi.mocked(getCurrentUserId).mockReturnValue(null); // Ensure no user
      useTranslatorStore.getState().clearTranslatorVoice();

      expect(localStorage.removeItem).toHaveBeenCalledWith('vox_translator_voice');
    });
  });

  describe('loadSettings', () => {
    it('handles missing localStorage gracefully', () => {
      vi.mocked(localStorage.getItem).mockReturnValue(null);

      useTranslatorStore.getState().loadSettings();

      const state = useTranslatorStore.getState();
      expect(state.translatorVoice).toBe(null);
      expect(state.sourceLanguage).toBe('en');
      expect(state.targetLanguage).toBe('es');
    });

    it('handles corrupted localStorage gracefully', () => {
      vi.mocked(localStorage.getItem).mockReturnValue('invalid-json');

      expect(() => {
        useTranslatorStore.getState().loadSettings();
      }).not.toThrow();
    });
  });

  describe('initTranslator', () => {
    it('calls loadSettings without error', () => {
      vi.mocked(localStorage.getItem).mockReturnValue(null);

      expect(() => {
        initTranslator();
      }).not.toThrow();
    });
  });
});
