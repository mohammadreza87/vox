'use client';

import { useState, useCallback, useRef } from 'react';
import { auth } from '@/lib/firebase';

interface UseTextToSpeechOptions {
  voiceId?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

interface UseTextToSpeechReturn {
  isSpeaking: boolean;
  isLoading: boolean;
  speak: (text: string) => Promise<string | null>;
  playAudio: (audioData: string) => Promise<void>;
  stop: () => void;
}

export function useTextToSpeech({
  voiceId,
  onStart,
  onEnd,
  onError,
}: UseTextToSpeechOptions = {}): UseTextToSpeechReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speak = useCallback(
    async (text: string): Promise<string | null> => {
      if (isLoading || isSpeaking) return null;

      setIsLoading(true);

      try {
        // Get auth token for authenticated request
        const token = await auth.currentUser?.getIdToken();

        // Call our TTS API
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` }),
          },
          body: JSON.stringify({
            text,
            voiceId,
          }),
        });

        const data = await response.json();

        if (data.error && !data.audio) {
          // API key not configured - use browser TTS as fallback
          console.log('Using browser TTS fallback');
          useBrowserTTS(text);
          return null;
        }

        if (data.audio) {
          // Play ElevenLabs audio
          const audioBlob = base64ToBlob(data.audio, 'audio/mpeg');
          const audioUrl = URL.createObjectURL(audioBlob);

          if (audioRef.current) {
            audioRef.current.pause();
          }

          audioRef.current = new Audio(audioUrl);

          audioRef.current.onplay = () => {
            setIsSpeaking(true);
            setIsLoading(false);
            onStart?.();
          };

          audioRef.current.onended = () => {
            setIsSpeaking(false);
            onEnd?.();
          };

          audioRef.current.onerror = () => {
            setIsSpeaking(false);
            setIsLoading(false);
            onError?.('Failed to play audio');
          };

          await audioRef.current.play();

          // Return base64 audio data for caching
          return data.audio;
        }
      } catch (error) {
        console.error('TTS error:', error);
        setIsLoading(false);
        setIsSpeaking(false);

        // Fallback to browser TTS
        useBrowserTTS(text);
      }
      return null;
    },
    [voiceId, isLoading, isSpeaking, onStart, onEnd, onError]
  );

  const playAudio = useCallback(
    async (audioData: string) => {
      if (isSpeaking) return;

      try {
        const audioBlob = base64ToBlob(audioData, 'audio/mpeg');
        const audioUrl = URL.createObjectURL(audioBlob);

        if (audioRef.current) {
          audioRef.current.pause();
        }

        audioRef.current = new Audio(audioUrl);

        audioRef.current.onplay = () => {
          setIsSpeaking(true);
          onStart?.();
        };

        audioRef.current.onended = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          onEnd?.();
        };

        audioRef.current.onerror = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          onError?.('Failed to play audio');
        };

        await audioRef.current.play();
      } catch (error) {
        console.error('Play audio error:', error);
        onError?.('Failed to play cached audio');
      }
    },
    [isSpeaking, onStart, onEnd, onError]
  );

  const useBrowserTTS = useCallback(
    (text: string) => {
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1;
        utterance.pitch = 1;

        utterance.onstart = () => {
          setIsSpeaking(true);
          setIsLoading(false);
          onStart?.();
        };

        utterance.onend = () => {
          setIsSpeaking(false);
          onEnd?.();
        };

        utterance.onerror = () => {
          setIsSpeaking(false);
          setIsLoading(false);
          onError?.('Browser TTS failed');
        };

        window.speechSynthesis.speak(utterance);
      } else {
        setIsLoading(false);
        onError?.('Text-to-speech not supported');
      }
    },
    [onStart, onEnd, onError]
  );

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    setIsSpeaking(false);
    setIsLoading(false);
  }, []);

  return {
    isSpeaking,
    isLoading,
    speak,
    playAudio,
    stop,
  };
}

// Helper function to convert base64 to Blob
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);

  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }

  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}
