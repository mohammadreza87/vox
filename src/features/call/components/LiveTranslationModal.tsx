'use client';

import { useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, PhoneOff, Mic, MicOff, X, Languages, ArrowRightLeft } from 'lucide-react';
import { useCall, CallStatus } from '../hooks/useCall';
import { SUPPORTED_LANGUAGES, LanguageCode } from '@/contexts/TranslatorContext';
import { cn } from '@/shared/utils/cn';

interface LiveTranslationModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  voiceId: string;
  onSwapLanguages?: () => void;
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
      return 'Ready - Speak in either language';
    case 'speaking':
      return 'Translating...';
    case 'listening':
      return 'Listening...';
    case 'ended':
      return 'Session ended';
    case 'error':
      return 'Error';
    default:
      return '';
  }
}

export function LiveTranslationModal({
  isOpen,
  onClose,
  sourceLanguage,
  targetLanguage,
  voiceId,
  onSwapLanguages,
}: LiveTranslationModalProps) {
  const [hasStarted, setHasStarted] = useState(false);

  const sourceLang = SUPPORTED_LANGUAGES.find(l => l.code === sourceLanguage);
  const targetLang = SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage);

  // Build the translator system prompt
  const translatorPrompt = `You are a real-time voice translator. Your ONLY job is to translate speech between ${sourceLang?.name || sourceLanguage} and ${targetLang?.name || targetLanguage}.

RULES:
1. When you hear ${sourceLang?.name}, translate it to ${targetLang?.name} and speak the translation
2. When you hear ${targetLang?.name}, translate it to ${sourceLang?.name} and speak the translation
3. ONLY respond with the translation - no explanations, no "here's the translation", just the translated text
4. Maintain the tone and emotion of the original speech
5. If something is unclear, translate your best interpretation
6. Be fast and natural - this is for real-time conversation

You are a translator, not a conversationalist. Never add your own commentary.`;

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
      // Auto-close modal after session ends
      setTimeout(() => {
        setHasStarted(false);
        onClose();
      }, 1500);
    },
  });

  // Start translation session when modal opens
  useEffect(() => {
    if (isOpen && !hasStarted && callStatus === 'idle') {
      setHasStarted(true);
      startCall({
        id: 'live-translator',
        name: 'Live Translator',
        voiceId: voiceId,
        systemPrompt: translatorPrompt,
        personality: undefined,
      });
    }
  }, [isOpen, hasStarted, callStatus, startCall, voiceId, translatorPrompt]);

  // Reset hasStarted when modal closes
  useEffect(() => {
    if (!isOpen) {
      setHasStarted(false);
    }
  }, [isOpen]);

  const handleEndCall = useCallback(() => {
    endCall();
  }, [endCall]);

  const handleClose = useCallback(() => {
    if (isCallActive) {
      endCall();
    }
    setHasStarted(false);
    onClose();
  }, [isCallActive, endCall, onClose]);

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

            {/* Header */}
            <div className="flex flex-col items-center">
              {/* Translator icon */}
              <div className="relative">
                <div className={cn(
                  "w-20 h-20 rounded-full bg-gradient-to-br from-[#FF6D1F] to-[#ff8a4c] flex items-center justify-center",
                  callStatus === 'speaking' && 'ring-4 ring-[#FF6D1F] ring-opacity-50 animate-pulse'
                )}>
                  <Languages className="w-10 h-10 text-white" />
                </div>
                {/* Status indicator */}
                {isCallActive && (
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-green-500 border-2 border-[#2a2520] flex items-center justify-center">
                    <Phone className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>

              {/* Title */}
              <h2 className="mt-4 text-2xl font-semibold text-white">
                Live Translation
              </h2>

              {/* Language display */}
              <div className="mt-3 flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10">
                  <span className="text-xl">{sourceLang?.flag}</span>
                  <span className="text-sm text-white">{sourceLang?.name}</span>
                </div>

                {onSwapLanguages && (
                  <button
                    onClick={onSwapLanguages}
                    className="p-2 rounded-full hover:bg-white/10 transition-colors"
                    disabled={isCallActive}
                  >
                    <ArrowRightLeft className="w-4 h-4 text-gray-400" />
                  </button>
                )}

                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10">
                  <span className="text-xl">{targetLang?.flag}</span>
                  <span className="text-sm text-white">{targetLang?.name}</span>
                </div>
              </div>

              {/* Status text */}
              <p className="mt-3 text-gray-400">
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

                {/* End/Retry button */}
                {callStatus === 'error' ? (
                  <button
                    onClick={() => {
                      setHasStarted(false);
                      startCall({
                        id: 'live-translator',
                        name: 'Live Translator',
                        voiceId: voiceId,
                        systemPrompt: translatorPrompt,
                        personality: undefined,
                      });
                      setHasStarted(true);
                    }}
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
                <p className="mt-6 text-sm text-gray-500 text-center max-w-xs">
                  Speak in {sourceLang?.name} or {targetLang?.name}. The AI will automatically translate to the other language.
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
