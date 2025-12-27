'use client';

import { useState, useCallback, useRef } from 'react';
import { streamChat, ChatStreamRequest } from '@/lib/api/stream-chat';

export interface UseStreamingChatOptions {
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

export interface UseStreamingChatReturn {
  /** The text being streamed, updated with each chunk */
  streamingText: string;
  /** Whether streaming is currently in progress */
  isStreaming: boolean;
  /** Start a new streaming request */
  startStream: (request: ChatStreamRequest) => void;
  /** Cancel the current stream */
  cancelStream: () => void;
  /** Reset the streaming state */
  reset: () => void;
}

/**
 * React hook for streaming chat responses
 *
 * @example
 * ```tsx
 * const { streamingText, isStreaming, startStream, cancelStream } = useStreamingChat({
 *   onComplete: (text) => console.log('Complete:', text),
 *   onError: (error) => console.error('Error:', error),
 * });
 *
 * const handleSend = () => {
 *   startStream({
 *     message: 'Hello!',
 *     contactId: 'alice',
 *     conversationHistory: [],
 *   });
 * };
 * ```
 */
export function useStreamingChat(options: UseStreamingChatOptions = {}): UseStreamingChatReturn {
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);

  const startStream = useCallback(
    (request: ChatStreamRequest) => {
      // Cancel any existing stream
      if (abortRef.current) {
        abortRef.current();
      }

      setIsStreaming(true);
      setStreamingText('');

      const { abort } = streamChat(request, {
        onChunk: (chunk) => {
          setStreamingText((prev) => prev + chunk);
        },
        onComplete: (fullText) => {
          setIsStreaming(false);
          options.onComplete?.(fullText);
        },
        onError: (error) => {
          setIsStreaming(false);
          options.onError?.(error);
        },
      });

      abortRef.current = abort;
    },
    [options]
  );

  const cancelStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const reset = useCallback(() => {
    cancelStream();
    setStreamingText('');
  }, [cancelStream]);

  return {
    streamingText,
    isStreaming,
    startStream,
    cancelStream,
    reset,
  };
}
