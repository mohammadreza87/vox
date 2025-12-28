// User-specific localStorage key helpers
import { ClonedVoice } from '@/shared/types';

export const getChatsKey = (userId: string | null) => {
  return userId ? `vox-chats-${userId}` : 'vox-chats-anonymous';
};

export const getCustomContactsKey = (userId: string | null) => {
  return userId ? `vox-customContacts-${userId}` : 'vox-customContacts-anonymous';
};

export const getClonedVoicesKey = (userId: string | null) => {
  return userId ? `vox-clonedVoices-${userId}` : 'vox-clonedVoices-anonymous';
};

export const getTranslatorVoiceKey = (userId: string | null) => {
  return userId ? `vox_translator_voice_${userId}` : 'vox_translator_voice';
};

// Get all cloned voices from both contact creation and translator
export const getAllClonedVoices = (userId: string | null): ClonedVoice[] => {
  if (typeof window === 'undefined') return [];

  const voices: ClonedVoice[] = [];

  // Get voices from contact cloning
  try {
    const contactVoicesKey = getClonedVoicesKey(userId);
    const contactVoices = localStorage.getItem(contactVoicesKey);
    if (contactVoices) {
      const parsed = JSON.parse(contactVoices) as ClonedVoice[];
      voices.push(...parsed.map(v => ({ ...v, source: 'contact' as const })));
    }
  } catch (e) {
    console.error('Error loading contact cloned voices:', e);
  }

  // Get voice from translator
  try {
    const translatorVoiceKey = getTranslatorVoiceKey(userId);
    const translatorVoice = localStorage.getItem(translatorVoiceKey);
    if (translatorVoice) {
      const parsed = JSON.parse(translatorVoice);
      if (parsed && parsed.voiceId) {
        voices.push({
          id: `translator-${parsed.voiceId}`,
          voiceId: parsed.voiceId,
          name: parsed.name || 'Translator Voice',
          createdAt: parsed.createdAt || new Date().toISOString(),
          source: 'translator',
          sourceLanguage: parsed.sourceLanguage,
        });
      }
    }
  } catch (e) {
    console.error('Error loading translator voice:', e);
  }

  return voices;
};

// Save a cloned voice to the contact voices storage
export const saveClonedVoice = (userId: string | null, voice: ClonedVoice): void => {
  if (typeof window === 'undefined') return;

  try {
    const key = getClonedVoicesKey(userId);
    const existing = localStorage.getItem(key);
    const voices: ClonedVoice[] = existing ? JSON.parse(existing) : [];

    // Check if voice already exists
    if (!voices.some(v => v.voiceId === voice.voiceId)) {
      voices.push({ ...voice, source: 'contact' });
      localStorage.setItem(key, JSON.stringify(voices));
    }
  } catch (e) {
    console.error('Error saving cloned voice:', e);
  }
};

// Import a translator voice into the contact voices storage
export const importTranslatorVoice = (userId: string | null): ClonedVoice | null => {
  if (typeof window === 'undefined') return null;

  try {
    const translatorVoiceKey = getTranslatorVoiceKey(userId);
    const translatorVoice = localStorage.getItem(translatorVoiceKey);
    if (!translatorVoice) return null;

    const parsed = JSON.parse(translatorVoice);
    if (!parsed || !parsed.voiceId) return null;

    const voice: ClonedVoice = {
      id: `translator-${parsed.voiceId}`,
      voiceId: parsed.voiceId,
      name: parsed.name || 'Translator Voice',
      createdAt: parsed.createdAt || new Date().toISOString(),
      source: 'translator',
      sourceLanguage: parsed.sourceLanguage,
    };

    // Save to contact voices as well
    const key = getClonedVoicesKey(userId);
    const existing = localStorage.getItem(key);
    const voices: ClonedVoice[] = existing ? JSON.parse(existing) : [];

    if (!voices.some(v => v.voiceId === voice.voiceId)) {
      voices.push(voice);
      localStorage.setItem(key, JSON.stringify(voices));
    }

    return voice;
  } catch (e) {
    console.error('Error importing translator voice:', e);
    return null;
  }
};
