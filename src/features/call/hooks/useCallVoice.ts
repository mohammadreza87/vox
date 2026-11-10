import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { geminiVoices } from '../lib/gemini-voices.mjs';

const geminiConfigured = process.env.NEXT_PUBLIC_VOX_WEB_CALLS_ONLY === '1' &&
  process.env.NEXT_PUBLIC_VOX_GEMINI_LIVE === '1';

export function useCallVoice(active: boolean) {
  const user = useAuthStore(state => state.user);
  const key = user ? `vox_call_voice_${user.uid}` : null;
  const [preference, setPreference] = useState({ key: '', voice: '', enabled: false });

  useEffect(() => {
    if (!geminiConfigured || !active || !user || !key) return;
    const pending = new AbortController();
    void (async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/gemini-live/availability', {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.any([pending.signal, AbortSignal.timeout(5000)]),
          cache: 'no-store',
        });
        const enabled = response.ok && (await response.json()).enabled === true;
        const voice = enabled ? localStorage.getItem(key) ?? '' : '';
        if (!pending.signal.aborted) {
          setPreference({ key, enabled, voice: geminiVoices.some(option => option.id === voice) ? voice : '' });
        }
      } catch {
        if (!pending.signal.aborted) setPreference({ key, voice: '', enabled: false });
      }
    })();
    return () => {
      pending.abort();
      setPreference({ key: '', voice: '', enabled: false });
    };
  }, [active, key, user]);

  const available = active && key !== null && preference.key === key && preference.enabled;
  const checking = geminiConfigured && active && key !== null && preference.key !== key;
  function saveVoice(voice: string) {
    if (!available || !key || (voice && !geminiVoices.some(option => option.id === voice))) return;
    localStorage.setItem(key, voice);
    setPreference({ key, voice, enabled: true });
  }

  return { available, checking, savedVoice: available ? preference.voice : '', saveVoice };
}
