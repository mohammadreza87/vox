'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { auth } from '@/lib/firebase';

/**
 * Queued audio item with status tracking
 */
interface QueuedAudio {
  index: number;
  text: string;
  audio: Blob | null;
  status: 'pending' | 'loading' | 'ready' | 'playing' | 'done' | 'error';
}

/**
 * Options for the audio queue hook
 */
interface UseAudioQueueOptions {
  voiceId?: string;
  onSentenceStart?: (index: number, text: string) => void;
  onSentenceEnd?: (index: number) => void;
  onQueueComplete?: () => void;
  onError?: (error: string) => void;
}

/**
 * Return type for useAudioQueue hook
 */
interface UseAudioQueueReturn {
  /** Add a sentence to the queue (triggers TTS generation) */
  queueSentence: (text: string, index: number) => void;
  /** Stop playback and clear queue */
  stop: () => void;
  /** Clear queue without stopping current playback */
  clear: () => void;
  /** Currently playing sentence index */
  currentIndex: number | null;
  /** Start playback (usually called automatically) */
  startPlayback: () => void;
  /** Get status of a specific queue item */
  getStatus: (index: number) => QueuedAudio['status'] | undefined;
  /** Check if queue is currently playing */
  isPlaying: boolean;
}

/**
 * Helper function to convert base64 to Blob
 */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);

  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }

  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

/**
 * Audio Queue Manager Hook
 *
 * Manages a queue of TTS audio chunks, generating them in parallel
 * and playing them sequentially. Designed for progressive TTS where
 * sentences are queued as they're detected in streaming text.
 */
export function useAudioQueue(options: UseAudioQueueOptions = {}): UseAudioQueueReturn {
  const queueRef = useRef<Map<number, QueuedAudio>>(new Map());
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const nextIndexToPlayRef = useRef(0);
  const isMountedRef = useRef(true);

  // Use ref to track options to avoid stale closures
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Track mounted state
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Generate TTS audio for a text string
   */
  const generateTTS = useCallback(
    async (text: string): Promise<Blob> => {
      const token = await auth?.currentUser?.getIdToken();
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          text,
          voiceId: optionsRef.current.voiceId,
        }),
      });

      if (!response.ok) {
        throw new Error(`TTS request failed: ${response.status}`);
      }

      const data = await response.json();
      if (!data.audio) {
        console.error('[AudioQueue] TTS response missing audio:', data);
        throw new Error(data.error || 'No audio data in response');
      }

      const blob = base64ToBlob(data.audio, 'audio/mpeg');
      console.log('[AudioQueue] Generated TTS blob:', { size: blob.size, type: blob.type });

      if (blob.size === 0) {
        throw new Error('Generated audio blob is empty');
      }

      return blob;
    },
    [] // Dependencies handled via ref
  );

  /**
   * Play an audio item from the queue
   */
  const playItem = useCallback(async (item: QueuedAudio) => {
    if (!item.audio || !isMountedRef.current) {
      console.warn('[AudioQueue] Cannot play item:', {
        hasAudio: !!item.audio,
        isMounted: isMountedRef.current,
      });
      return;
    }

    console.log('[AudioQueue] Playing item:', {
      index: item.index,
      text: item.text.substring(0, 50) + '...',
      blobSize: item.audio.size,
    });

    isPlayingRef.current = true;
    setIsPlaying(true);
    item.status = 'playing';
    setCurrentIndex(item.index);
    optionsRef.current.onSentenceStart?.(item.index, item.text);

    const url = URL.createObjectURL(item.audio);

    // Clean up previous audio - remove handlers first to prevent spurious errors
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
    }

    audioRef.current = new Audio(url);

    audioRef.current.onended = () => {
      URL.revokeObjectURL(url);
      item.status = 'done';
      isPlayingRef.current = false;
      nextIndexToPlayRef.current = item.index + 1;
      optionsRef.current.onSentenceEnd?.(item.index);

      if (!isMountedRef.current) return;

      // Check if there's a next item ready
      const nextItem = queueRef.current.get(item.index + 1);
      if (nextItem && nextItem.status === 'ready' && nextItem.audio) {
        playItem(nextItem);
      } else if (!nextItem) {
        // No more items - queue is complete
        setCurrentIndex(null);
        setIsPlaying(false);
        optionsRef.current.onQueueComplete?.();
      }
      // If nextItem exists but isn't ready yet, tryPlayNext will be called
      // when it becomes ready
    };

    audioRef.current.onerror = () => {
      const audio = audioRef.current;

      // Ignore errors from cleaned-up audio elements (happens during transitions)
      if (!audio) {
        console.log('[AudioQueue] Ignoring error from cleaned-up audio element');
        return;
      }

      const errorCode = audio.error?.code;
      const errorMessage = audio.error?.message || 'Unknown audio error';

      // Ignore "Empty src attribute" errors - these happen during cleanup
      if (errorMessage.includes('Empty src')) {
        console.log('[AudioQueue] Ignoring empty src error (cleanup artifact)');
        return;
      }

      console.error('[AudioQueue] Audio element error:', {
        code: errorCode,
        message: errorMessage,
        networkState: audio.networkState,
        readyState: audio.readyState,
      });
      URL.revokeObjectURL(url);
      item.status = 'error';
      isPlayingRef.current = false;
      setIsPlaying(false);
      optionsRef.current.onError?.(`Audio playback failed: ${errorMessage}`);
    };

    try {
      await audioRef.current.play();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[AudioQueue] Playback error:', error);

      // Check if it's an autoplay policy error
      if (errorMessage.includes('user didn\'t interact') || errorMessage.includes('NotAllowedError')) {
        console.warn('[AudioQueue] Autoplay blocked - user interaction required');
        optionsRef.current.onError?.('Autoplay blocked - please interact with the page first');
      } else {
        optionsRef.current.onError?.(`Failed to start audio: ${errorMessage}`);
      }

      URL.revokeObjectURL(url);
      item.status = 'error';
      isPlayingRef.current = false;
      setIsPlaying(false);
    }
  }, []);

  /**
   * Try to play the next item in the queue
   */
  const tryPlayNext = useCallback(() => {
    if (isPlayingRef.current || !isMountedRef.current) return;

    const nextItem = queueRef.current.get(nextIndexToPlayRef.current);
    if (nextItem?.status === 'ready' && nextItem.audio) {
      playItem(nextItem);
    }
  }, [playItem]);

  /**
   * Queue a sentence for TTS generation and playback
   */
  const queueSentence = useCallback(
    (text: string, index: number) => {
      // Don't queue if already exists
      if (queueRef.current.has(index)) {
        return;
      }

      const item: QueuedAudio = {
        index,
        text,
        audio: null,
        status: 'loading',
      };
      queueRef.current.set(index, item);

      // Start TTS generation
      generateTTS(text)
        .then((blob) => {
          if (!isMountedRef.current) return;

          const queueItem = queueRef.current.get(index);
          if (queueItem) {
            queueItem.audio = blob;
            queueItem.status = 'ready';

            // Try to play if this is the next item and we're not already playing
            if (index === nextIndexToPlayRef.current) {
              tryPlayNext();
            }
          }
        })
        .catch((error) => {
          console.error('[AudioQueue] TTS generation failed:', error);
          const queueItem = queueRef.current.get(index);
          if (queueItem) {
            queueItem.status = 'error';
          }
          optionsRef.current.onError?.(`TTS failed for sentence ${index}`);
        });
    },
    [generateTTS, tryPlayNext]
  );

  /**
   * Stop playback and clear the queue
   */
  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    queueRef.current.clear();
    isPlayingRef.current = false;
    nextIndexToPlayRef.current = 0;
    setCurrentIndex(null);
    setIsPlaying(false);
  }, []);

  /**
   * Clear the queue without stopping current playback
   */
  const clear = useCallback(() => {
    // Keep current playing item, remove the rest
    const currentItem = currentIndex !== null ? queueRef.current.get(currentIndex) : null;
    queueRef.current.clear();
    if (currentItem) {
      queueRef.current.set(currentIndex!, currentItem);
    }
  }, [currentIndex]);

  /**
   * Get status of a specific queue item
   */
  const getStatus = useCallback((index: number): QueuedAudio['status'] | undefined => {
    return queueRef.current.get(index)?.status;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, []);

  return {
    queueSentence,
    stop,
    clear,
    currentIndex,
    startPlayback: tryPlayNext,
    getStatus,
    isPlaying,
  };
}
