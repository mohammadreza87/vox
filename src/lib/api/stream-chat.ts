import { auth } from '@/lib/firebase';

export interface ChatStreamRequest {
  message: string;
  contactId: string;
  systemPrompt?: string;
  conversationHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  aiProvider?: 'deepseek' | 'gemini' | 'claude' | 'openai';
  aiModel?: string;
}

export interface StreamCallbacks {
  onChunk: (chunk: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
}

export interface StreamResult {
  abort: () => void;
}

/**
 * Stream chat response from the API
 * Returns an abort function to cancel the stream
 */
export function streamChat(request: ChatStreamRequest, callbacks: StreamCallbacks): StreamResult {
  const controller = new AbortController();

  (async () => {
    try {
      const token = await auth.currentUser?.getIdToken();

      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Stream request failed: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n').filter((line) => line.startsWith('data: '));

        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6)); // Remove 'data: ' prefix

            if (data.error) {
              callbacks.onError(new Error(data.error));
              return;
            }

            if (data.done) {
              callbacks.onComplete(fullText);
              return;
            }

            if (data.content) {
              fullText += data.content;
              callbacks.onChunk(data.content);
            }
          } catch (parseError) {
            // Skip malformed JSON lines
            console.warn('Failed to parse SSE line:', line);
          }
        }
      }

      // If we exit the loop without receiving done, call complete
      callbacks.onComplete(fullText);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Stream was aborted, don't call error callback
        return;
      }
      callbacks.onError(error instanceof Error ? error : new Error('Stream failed'));
    }
  })();

  return {
    abort: () => controller.abort(),
  };
}
