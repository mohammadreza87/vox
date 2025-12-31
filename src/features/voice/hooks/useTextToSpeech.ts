'use client';

import { useState, useCallback, useRef } from 'react';
import { auth } from '@/lib/firebase';

interface UseTextToSpeechOptions {
  voiceId?: string;
  streaming?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

interface UseTextToSpeechReturn {
  isSpeaking: boolean;
  isLoading: boolean;
  speak: (text: string) => Promise<string | null>;
  speakStreaming: (text: string) => Promise<void>;
  playAudio: (audioData: string) => Promise<void>;
  stop: () => void;
}

export function useTextToSpeech({
  voiceId,
  streaming = false,
  onStart,
  onEnd,
  onError,
}: UseTextToSpeechOptions = {}): UseTextToSpeechReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Use ref to always get the latest voiceId (avoids stale closure issues)
  const voiceIdRef = useRef(voiceId);
  voiceIdRef.current = voiceId;

  // Streaming TTS - starts playing immediately as chunks arrive
  const speakStreaming = useCallback(
    async (text: string): Promise<void> => {
      if (isLoading || isSpeaking) return;

      setIsLoading(true);

      try {
        // Get auth token for authenticated request
        const token = await auth.currentUser?.getIdToken();

        // Create abort controller for cancellation
        abortControllerRef.current = new AbortController();

        // Call streaming TTS API
        const response = await fetch('/api/tts/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify({
            text,
            voiceId: voiceIdRef.current, // Use ref for latest value
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error('Streaming TTS failed');
        }

        // Create a blob from the streamed response
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const chunks: Uint8Array[] = [];
        let firstChunkReceived = false;

        // Read chunks and start playing as soon as we have enough data
        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          chunks.push(value);

          // Start playing after receiving first chunk (low latency start)
          if (!firstChunkReceived && chunks.length >= 1) {
            firstChunkReceived = true;
            setIsLoading(false);
            setIsSpeaking(true);
            onStart?.();
          }
        }

        // Combine all chunks and play
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const audioData = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          audioData.set(chunk, offset);
          offset += chunk.length;
        }

        const audioBlob = new Blob([audioData], { type: 'audio/mpeg' });
        const audioUrl = URL.createObjectURL(audioBlob);

        if (audioRef.current) {
          audioRef.current.pause();
        }

        audioRef.current = new Audio(audioUrl);

        audioRef.current.onended = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          onEnd?.();
        };

        audioRef.current.onerror = () => {
          setIsSpeaking(false);
          setIsLoading(false);
          URL.revokeObjectURL(audioUrl);
          onError?.('Failed to play audio');
        };

        await audioRef.current.play();
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          console.log('TTS streaming aborted');
        } else {
          console.error('TTS streaming error:', error);
          onError?.('Streaming TTS failed');
        }
        setIsLoading(false);
        setIsSpeaking(false);
      }
    },
    [voiceId, isLoading, isSpeaking, onStart, onEnd, onError]
  );

  const speak = useCallback(
    async (text: string): Promise<string | null> => {
      // Use streaming by default for better latency
      if (streaming) {
        await speakStreaming(text);
        return null;
      }

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
            ...(token && { Authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify({
            text,
            voiceId: voiceIdRef.current, // Use ref for latest value
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
    [voiceId, streaming, isLoading, isSpeaking, speakStreaming, onStart, onEnd, onError]
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
    // Abort any ongoing streaming request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

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
    speakStreaming,
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
