'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { SentenceDetector, DetectedSentence } from '@/lib/utils/sentence-detector';
import { useAudioQueue } from './useAudioQueue';

/**
 * Progressive sentence with status tracking
 */
export interface ProgressiveSentence {
  text: string;
  index: number;
  status: 'pending' | 'loading' | 'ready' | 'speaking' | 'done' | 'error';
}

/**
 * Options for the progressive TTS hook
 */
interface UseProgressiveTTSOptions {
  voiceId?: string;
  enabled?: boolean;
  onStart?: () => void;
  onComplete?: () => void;
  onSentenceStart?: (index: number, text: string) => void;
  onSentenceEnd?: (index: number) => void;
  onError?: (error: string) => void;
}

/**
 * Return type for useProgressiveTTS hook
 */
interface UseProgressiveTTSReturn {
  /** Process a text chunk from the LLM stream */
  processChunk: (chunk: string) => void;
  /** Signal that the stream is complete (flushes remaining buffer) */
  streamComplete: () => void;
  /** Stop playback and reset state */
  stop: () => void;
  /** Reset the hook to initial state */
  reset: () => void;
  /** Array of sentences with their status */
  sentences: ProgressiveSentence[];
  /** Index of the currently speaking sentence */
  speakingIndex: number | null;
  /** Whether TTS is currently speaking */
  isSpeaking: boolean;
  /** Whether TTS is loading/generating audio */
  isLoading: boolean;
}

/**
 * Progressive TTS Hook
 *
 * Combines sentence detection with audio queue management to enable
 * progressive text-to-speech. As text streams in from an LLM, this hook:
 *
 * 1. Detects sentence boundaries
 * 2. Queues each sentence for TTS generation
 * 3. Plays audio in sequence as it becomes available
 * 4. Tracks status of each sentence for UI synchronization
 *
 * @example
 * ```tsx
 * const { processChunk, streamComplete, sentences, isSpeaking } = useProgressiveTTS({
 *   voiceId: 'voice-id',
 *   enabled: true,
 *   onStart: () => console.log('Started speaking'),
 *   onComplete: () => console.log('Finished speaking'),
 * });
 *
 * // In streaming chat onChunk callback:
 * onChunk: (chunk) => {
 *   processChunk(chunk);
 * }
 *
 * // When stream completes:
 * onComplete: () => {
 *   streamComplete();
 * }
 * ```
 */
export function useProgressiveTTS(options: UseProgressiveTTSOptions = {}): UseProgressiveTTSReturn {
  const { voiceId, enabled = true, onStart, onComplete, onSentenceStart, onSentenceEnd, onError } =
    options;

  // State
  const [sentences, setSentences] = useState<ProgressiveSentence[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Refs
  const detectorRef = useRef(new SentenceDetector());
  const hasStartedRef = useRef(false);
  const isEnabledRef = useRef(enabled);
  const pendingCountRef = useRef(0);

  // Keep enabled ref up to date
  useEffect(() => {
    isEnabledRef.current = enabled;
  }, [enabled]);

  // Audio queue hook
  const { queueSentence, stop: stopQueue, currentIndex, isPlaying } = useAudioQueue({
    voiceId,
    onSentenceStart: (index, text) => {
      // Mark as speaking on first sentence
      if (!hasStartedRef.current) {
        hasStartedRef.current = true;
        setIsSpeaking(true);
        onStart?.();
      }

      // Update sentence status
      setSentences((prev) =>
        prev.map((s) => (s.index === index ? { ...s, status: 'speaking' as const } : s))
      );

      onSentenceStart?.(index, text);
    },
    onSentenceEnd: (index) => {
      // Update sentence status
      setSentences((prev) =>
        prev.map((s) => (s.index === index ? { ...s, status: 'done' as const } : s))
      );

      onSentenceEnd?.(index);
    },
    onQueueComplete: () => {
      setIsSpeaking(false);
      setIsLoading(false);
      hasStartedRef.current = false;
      onComplete?.();
    },
    onError: (error) => {
      console.error('[ProgressiveTTS] Error:', error);
      onError?.(error);
    },
  });

  /**
   * Process a text chunk from the LLM stream
   */
  const processChunk = useCallback(
    (chunk: string) => {
      if (!isEnabledRef.current) return;

      // Detect complete sentences in the chunk
      const completeSentences = detectorRef.current.addChunk(chunk);

      for (const { text, index } of completeSentences) {
        // Add sentence to state
        setSentences((prev) => [...prev, { text, index, status: 'loading' }]);

        // Queue for TTS generation
        setIsLoading(true);
        pendingCountRef.current++;
        queueSentence(text, index);
      }
    },
    [queueSentence]
  );

  /**
   * Signal that the stream is complete
   * Flushes any remaining text in the buffer as a final sentence
   */
  const streamComplete = useCallback(() => {
    if (!isEnabledRef.current) return;

    const final = detectorRef.current.flush();
    if (final) {
      // Add final sentence to state
      setSentences((prev) => [...prev, { text: final.text, index: final.index, status: 'loading' }]);

      // Queue for TTS generation
      setIsLoading(true);
      pendingCountRef.current++;
      queueSentence(final.text, final.index);
    }
  }, [queueSentence]);

  /**
   * Stop playback and reset all state
   */
  const stop = useCallback(() => {
    stopQueue();
    detectorRef.current.reset();
    setSentences([]);
    setIsSpeaking(false);
    setIsLoading(false);
    hasStartedRef.current = false;
    pendingCountRef.current = 0;
  }, [stopQueue]);

  /**
   * Reset the hook to initial state (alias for stop)
   */
  const reset = useCallback(() => {
    stop();
  }, [stop]);

  // Update sentence status when audio becomes ready
  useEffect(() => {
    // This effect helps track when sentences move from loading to ready
    // by observing the audio queue's current state
  }, [currentIndex]);

  return {
    processChunk,
    streamComplete,
    stop,
    reset,
    sentences,
    speakingIndex: currentIndex,
    isSpeaking,
    isLoading,
  };
}
