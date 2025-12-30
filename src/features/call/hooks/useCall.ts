'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useConversation } from '@elevenlabs/react';
import { useAuth } from '@/contexts/AuthContext';

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
  const { user } = useAuth();
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [currentContact, setCurrentContact] = useState<Contact | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [showTimeWarning, setShowTimeWarning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  const callStartTimeRef = useRef<number | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const conversation = useConversation({
    onConnect: () => {
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
    onDisconnect: () => {
      console.log('[Call] Disconnected');
      cleanup();
      setCallStatus('ended');
      options.onCallEnd?.();
    },
    onMessage: (message) => {
      console.log('[Call] Message:', message);
    },
    onError: (error) => {
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

    try {
      setCallStatus('connecting');
      setCurrentContact(contact);
      setErrorMessage(null);
      setCallDuration(0);

      // Get auth token
      const token = await user.getIdToken();
      if (!token) {
        throw new Error('Failed to get authentication token');
      }

      // Get signed URL from our API
      const response = await fetch('/api/convai/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          contactId: contact.id,
          contactName: contact.name,
          voiceId: contact.voiceId,
          systemPrompt: contact.systemPrompt || `You are ${contact.name}, a helpful AI assistant.`,
          personality: contact.personality,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to start call');
      }

      const { signedUrl } = await response.json();

      // Build full system prompt with personality
      const fullSystemPrompt = contact.personality
        ? `${contact.systemPrompt}\n\nPersonality: ${contact.personality}`
        : contact.systemPrompt;

      // Build overrides on client side - includes voice, prompt, and first message
      const overrides = {
        agent: {
          prompt: {
            prompt: fullSystemPrompt,
          },
          firstMessage: `Hi! I'm ${contact.name}. How can I help you today?`,
        },
        tts: {
          voiceId: contact.voiceId,
        },
      };

      console.log('[Call] Starting with overrides:', { voiceId: contact.voiceId, promptLength: fullSystemPrompt?.length });

      // Start the conversation with ElevenLabs
      await conversation.startSession({
        signedUrl,
        overrides,
      });

    } catch (error) {
      console.error('[Call] Failed to start:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to start call');
      setCallStatus('error');
      setCurrentContact(null);
    }
  }, [user, conversation]);

  const endCall = useCallback(async () => {
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
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    conversation.setVolume({ volume: newMuted ? 0 : 1 });
  }, [isMuted, conversation]);

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
