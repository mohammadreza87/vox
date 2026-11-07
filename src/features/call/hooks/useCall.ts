'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useConversation } from '@elevenlabs/react';
import { useAuthStore } from '@/stores/authStore';
import { getMemoryService } from '@/services/container';
import { buildPromptWithMemory, extractAndSaveMemory, shouldExtractMemory } from '@/lib/memory/context';

export type CallStatus = 'idle' | 'connecting' | 'connected' | 'speaking' | 'listening' | 'ended' | 'error';

interface Contact {
  id: string;
  name: string;
  voiceId: string;
  systemPrompt?: string;
  personality?: string;
}

interface UseCallOptions {
  onCallStart?: () => void;
  onCallEnd?: () => void;
  onError?: (error: Error) => void;
}

const MAX_CALL_DURATION = 5 * 60 * 1000; // 5 minutes
const WARNING_TIME = 30 * 1000; // 30 seconds before end

export function useCall(options: UseCallOptions = {}) {
  const user = useAuthStore((state) => state.user);
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [currentContact, setCurrentContact] = useState<Contact | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [showTimeWarning, setShowTimeWarning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  const pendingCallRef = useRef<AbortController | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Memory integration refs
  const transcriptRef = useRef<{ role: 'user' | 'assistant'; content: string; timestamp: number }[]>([]);
  const currentContactRef = useRef<Contact | null>(null);

  const conversation = useConversation({
    micMuted: isMuted,
    onConnect: () => {
      if (pendingCallRef.current?.signal.aborted) return;
      console.log('[Call] Connected');
      setCallStatus('connected');
      callStartTimeRef.current = Date.now();

      // Start duration timer
      durationIntervalRef.current = setInterval(() => {
        if (callStartTimeRef.current) {
          setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
        }
      }, 1000);

      // Set warning timeout (4:30)
      warningTimeoutRef.current = setTimeout(() => {
        setShowTimeWarning(true);
      }, MAX_CALL_DURATION - WARNING_TIME);

      // Set end timeout (5:00)
      timeoutRef.current = setTimeout(() => {
        console.log('[Call] Max duration reached, ending call');
        endCall();
      }, MAX_CALL_DURATION);

      options.onCallStart?.();
    },
    onDisconnect: async () => {
      console.log('[Call] Disconnected');

      // Save memory from call transcript
      const contact = currentContactRef.current;
      const transcript = transcriptRef.current;
      const duration = callStartTimeRef.current
        ? Math.floor((Date.now() - callStartTimeRef.current) / 1000)
        : 0;

      if (process.env.NEXT_PUBLIC_VOX_WEB_CALLS_ONLY !== '1' && contact && shouldExtractMemory(transcript)) {
        try {
          const token = await user?.getIdToken();
          if (token) {
            await extractAndSaveMemory({
              contactId: contact.id,
              messages: transcript,
              type: 'call',
              duration,
              authToken: token,
            });
            console.log('[Call] Memory saved successfully');
          }
        } catch (err) {
          console.error('[Call] Failed to save memory:', err);
        }
      }

      // Reset transcript
      transcriptRef.current = [];
      currentContactRef.current = null;

      cleanup();
      setCallStatus('ended');
      options.onCallEnd?.();
    },
    onMessage: (message) => {
      // Capture transcript for memory extraction
      // ElevenLabs message format: { source: 'user' | 'ai', message: string }
      const msg = message as { source?: string; message?: string };
      if (process.env.NEXT_PUBLIC_VOX_WEB_CALLS_ONLY !== '1' && msg.message) {
        transcriptRef.current.push({
          role: msg.source === 'user' ? 'user' : 'assistant',
          content: msg.message,
          timestamp: Date.now(),
        });
      }
    },
    onError: (error) => {
      if (pendingCallRef.current?.signal.aborted) return;
      console.error('[Call] Error:', error);
      setErrorMessage(String(error) || 'An error occurred');
      setCallStatus('error');
      options.onError?.(new Error(String(error)));
    },
    onModeChange: (mode) => {
      console.log('[Call] Mode changed:', mode);
      if (mode.mode === 'speaking') {
        setCallStatus('speaking');
      } else if (mode.mode === 'listening') {
        setCallStatus('listening');
      }
    },
  });

  const cleanup = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (warningTimeoutRef.current) {
      clearTimeout(warningTimeoutRef.current);
      warningTimeoutRef.current = null;
    }
    callStartTimeRef.current = null;
    setShowTimeWarning(false);
  }, []);

  const startCall = useCallback(async (contact: Contact) => {
    if (!user) {
      setErrorMessage('Please sign in to make calls');
      setCallStatus('error');
      return;
    }

    if (pendingCallRef.current) return;
    const pending = new AbortController();
    pendingCallRef.current = pending;
    try {
      setCallStatus('connecting');
      setCurrentContact(contact);
      currentContactRef.current = contact;
      transcriptRef.current = []; // Reset transcript for new call
      setErrorMessage(null);
      setCallDuration(0);
      setIsMuted(false);

      // Get auth token
      const token = await user.getIdToken();
      if (!token) {
        throw new Error('Failed to get authentication token');
      }

      // Fetch memory context for this contact
      let memoryContext = null;
      let memoryGreeting = `Hi! I'm ${contact.name}. How can I help you today?`;
      if (process.env.NEXT_PUBLIC_VOX_WEB_CALLS_ONLY !== '1') {
        try {
          const memoryService = getMemoryService();
          memoryContext = await memoryService.buildContextForContact(contact.id);
          memoryGreeting = await memoryService.generateGreeting(contact.id, contact.name);
        } catch (err) {
          console.warn('[Call] Failed to load memory context:', err);
        }
      }

      if (pending.signal.aborted) return;
      // Get signed URL from our API
      const response = await fetch('/api/convai/session', {
        method: 'POST',
        signal: pending.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          contactName: contact.name,
          voiceId: contact.voiceId,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to start call');
      }

      const { signedUrl } = await response.json();

      // Build full system prompt with personality
      let fullSystemPrompt = contact.personality
        ? `${contact.systemPrompt}\n\nPersonality: ${contact.personality}`
        : contact.systemPrompt;

      // Enrich system prompt with memory context
      if (memoryContext) {
        fullSystemPrompt = buildPromptWithMemory(fullSystemPrompt || '', memoryContext);
      }

      // Build overrides on client side - includes voice, prompt, and first message
      const overrides = {
        agent: {
          prompt: {
            prompt: fullSystemPrompt,
          },
          firstMessage: memoryGreeting,
        },
        tts: {
          voiceId: contact.voiceId,
        },
      };

      console.log('[Call] Starting with memory-enriched overrides:', {
        voiceId: contact.voiceId,
        promptLength: fullSystemPrompt?.length,
        hasMemory: !!memoryContext?.contextString,
      });

      if (pending.signal.aborted) return;
      await conversation.startSession({ signedUrl, overrides });
      if (pending.signal.aborted) await conversation.endSession();
    } catch (error) {
      if (pending.signal.aborted) return;
      console.error('[Call] Failed to start:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to start call');
      setCallStatus('error');
      setCurrentContact(null);
      currentContactRef.current = null;
    } finally {
      pendingCallRef.current = null;
    }
  }, [user, conversation]);

  const endCall = useCallback(async () => {
    pendingCallRef.current?.abort();
    try {
      await conversation.endSession();
    } catch (error) {
      console.error('[Call] Error ending session:', error);
    }
    cleanup();
    setCallStatus('idle');
    setCurrentContact(null);
  }, [conversation, cleanup]);

  const toggleMute = useCallback(() => {
    setIsMuted(muted => !muted);
  }, []);

  // Cleanup on unmount - use refs to avoid stale closure
  const callStatusRef = useRef(callStatus);
  const conversationRef = useRef(conversation);

  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  useEffect(() => {
    return () => {
      pendingCallRef.current?.abort();
      cleanup();
      if (callStatusRef.current !== 'idle' && callStatusRef.current !== 'ended') {
        conversationRef.current.endSession().catch(console.error);
      }
    };
  }, [cleanup]);

  return {
    callStatus,
    currentContact,
    callDuration,
    showTimeWarning,
    errorMessage,
    isMuted,
    startCall,
    endCall,
    toggleMute,
    isCallActive: callStatus !== 'idle' && callStatus !== 'ended' && callStatus !== 'error',
  };
}
