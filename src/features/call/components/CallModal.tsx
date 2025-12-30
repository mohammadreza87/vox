'use client';

import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, PhoneOff, Mic, MicOff, X } from 'lucide-react';
import { Avatar } from '@/shared/components/Avatar';
import { useCall, CallStatus } from '../hooks/useCall';

interface Contact {
  id: string;
  name: string;
  voiceId: string;
  voiceName?: string;
  avatarEmoji?: string;
  avatarImage?: string;
  systemPrompt?: string;
  personality?: string;
  purpose?: string;
}

interface CallModalProps {
  contact: Contact | null;
  isOpen: boolean;
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getStatusText(status: CallStatus): string {
  switch (status) {
    case 'connecting':
      return 'Connecting...';
    case 'connected':
      return 'Connected';
    case 'speaking':
      return 'Speaking...';
    case 'listening':
      return 'Listening...';
    case 'ended':
      return 'Call ended';
    case 'error':
      return 'Error';
    default:
      return '';
  }
}

export function CallModal({ contact, isOpen, onClose }: CallModalProps) {
  const {
    callStatus,
    callDuration,
    showTimeWarning,
    errorMessage,
    isMuted,
    startCall,
    endCall,
    toggleMute,
    isCallActive,
  } = useCall({
    onCallEnd: () => {
      // Auto-close modal after call ends
      setTimeout(onClose, 1500);
    },
  });

  // Start call when modal opens with a contact (only once)
  useEffect(() => {
    if (isOpen && contact && callStatus === 'idle') {
      startCall({
        id: contact.id,
        name: contact.name,
        voiceId: contact.voiceId,
        systemPrompt: contact.systemPrompt || contact.purpose || `You are ${contact.name}, a helpful AI assistant.`,
        personality: contact.personality,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, contact?.id]);

  const handleEndCall = useCallback(() => {
    endCall();
  }, [endCall]);

  const handleClose = useCallback(() => {
    if (isCallActive) {
      endCall();
    }
    onClose();
  }, [isCallActive, endCall, onClose]);

  if (!contact) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative w-full max-w-md mx-4 p-8 rounded-3xl bg-gradient-to-b from-[#2a2520] to-[#1a1815] border border-[#3d3530]"
          >
            {/* Close button */}
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>

            {/* Contact info */}
            <div className="flex flex-col items-center">
              {/* Avatar with pulse animation when speaking */}
              <div className="relative">
                <Avatar
                  src={contact.avatarImage}
                  fallback={contact.avatarEmoji || contact.name[0]}
                  size="xl"
                  className={callStatus === 'speaking' ? 'ring-4 ring-[#FF6D1F] ring-opacity-50 animate-pulse' : ''}
                />
                {/* Status indicator */}
                {isCallActive && (
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-green-500 border-2 border-[#2a2520] flex items-center justify-center">
                    <Phone className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>

              {/* Name */}
              <h2 className="mt-4 text-2xl font-semibold text-white">
                {contact.name}
              </h2>

              {/* Status text */}
              <p className="mt-1 text-gray-400">
                {getStatusText(callStatus)}
              </p>

              {/* Duration */}
              {isCallActive && (
                <p className={`mt-2 text-lg font-mono ${showTimeWarning ? 'text-orange-400' : 'text-white'}`}>
                  {formatDuration(callDuration)}
                  {showTimeWarning && (
                    <span className="ml-2 text-sm text-orange-400">
                      (ending soon)
                    </span>
                  )}
                </p>
              )}

              {/* Error message */}
              {errorMessage && (
                <p className="mt-2 text-sm text-red-400 text-center">
                  {errorMessage}
                </p>
              )}

              {/* Voice activity indicator */}
              {isCallActive && (
                <div className="mt-6 flex items-center gap-1 h-6">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className={`w-1 rounded-full transition-all duration-300 ${
                        callStatus === 'speaking'
                          ? 'bg-[#FF6D1F] animate-pulse'
                          : callStatus === 'listening'
                          ? 'bg-green-400 animate-pulse'
                          : 'bg-gray-600'
                      }`}
                      style={{
                        height: callStatus === 'speaking' || callStatus === 'listening'
                          ? `${12 + Math.random() * 12}px`
                          : '8px',
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Controls */}
              <div className="mt-8 flex items-center gap-6">
                {/* Mute button */}
                {isCallActive && (
                  <button
                    onClick={toggleMute}
                    className={`p-4 rounded-full transition-colors ${
                      isMuted
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    {isMuted ? (
                      <MicOff className="w-6 h-6" />
                    ) : (
                      <Mic className="w-6 h-6" />
                    )}
                  </button>
                )}

                {/* End/Retry call button */}
                {callStatus === 'error' ? (
                  <button
                    onClick={() => startCall({
                      id: contact.id,
                      name: contact.name,
                      voiceId: contact.voiceId,
                      systemPrompt: contact.systemPrompt || contact.purpose,
                      personality: contact.personality,
                    })}
                    className="p-4 rounded-full bg-[#FF6D1F] text-white hover:bg-[#FF6D1F]/80 transition-colors"
                  >
                    <Phone className="w-6 h-6" />
                  </button>
                ) : (callStatus === 'connecting' || isCallActive) ? (
                  <button
                    onClick={handleEndCall}
                    className="p-4 rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors"
                  >
                    <PhoneOff className="w-6 h-6" />
                  </button>
                ) : null}
              </div>

              {/* Instructions */}
              {isCallActive && (
                <p className="mt-6 text-sm text-gray-500 text-center">
                  Speak naturally. The AI will respond with {contact.name}&apos;s voice.
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
