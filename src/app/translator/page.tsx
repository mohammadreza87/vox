'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslator, SUPPORTED_LANGUAGES, LanguageCode } from '@/contexts/TranslatorContext';
import { auth } from '@/lib/firebase';
import { getAuthToken } from '@/lib/auth-header';
import {
  Volume2,
  Mic,
  MicOff,
  ArrowLeft,
  Languages,
  Check,
  RefreshCw,
  ArrowRightLeft,
  Loader2,
  Settings,
  Trash2,
  Square,
  ChevronDown,
  MessageSquare,
  History,
  AlertCircle,
  Play,
  StopCircle,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useEntranceAnimation } from '@/hooks/useAnimations';

// Web Speech API types
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

export default function TranslatorPage() {
  return (
    <ProtectedRoute>
      <TranslatorContent />
    </ProtectedRoute>
  );
}

function TranslatorContent() {
  const { user } = useAuth();
  const {
    isSetupComplete,
    translatorVoice,
    sourceLanguage,
    targetLanguage,
    setSourceLanguage,
    setTargetLanguage,
    saveTranslatorVoice,
    clearTranslatorVoice,
    getSampleText,
  } = useTranslator();

  const [showSetup, setShowSetup] = useState(!isSetupComplete);
  const [showSettings, setShowSettings] = useState(false);

  // GSAP Animation refs - single page entrance
  const { ref: pageRef } = useEntranceAnimation('fadeUp', { delay: 0 });

  useEffect(() => {
    setShowSetup(!isSetupComplete);
  }, [isSetupComplete]);

  return (
    <div ref={pageRef} className="liquid-glass h-full flex flex-col overflow-hidden relative" style={{ height: '100dvh' }}>
      {/* Header */}
      <header className="relative z-10 p-4 border-b border-white/10 liquid-glass">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/app" className="w-10 h-10 rounded-full liquid-card flex items-center justify-center hover:bg-white/20 transition-colors">
              <ArrowLeft className="w-5 h-5 text-[var(--foreground)]" />
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-gradient-to-br from-[#FF6D1F] to-[#ff8a4c] rounded-xl flex items-center justify-center shadow-lg shadow-[#FF6D1F]/30">
                <Languages className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-[var(--foreground)]">Translator</h1>
                <p className="text-xs text-[var(--foreground)]/60">Speak in your voice, any language</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isSetupComplete && (
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center transition-colors",
                  showSettings ? "liquid-button" : "liquid-card hover:bg-white/20"
                )}
              >
                <Settings className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative z-10">
        {showSetup ? (
          <SetupFlow
            onComplete={() => setShowSetup(false)}
            sourceLanguage={sourceLanguage}
            setSourceLanguage={setSourceLanguage}
            getSampleText={getSampleText}
            saveTranslatorVoice={saveTranslatorVoice}
          />
        ) : showSettings ? (
          <SettingsView
            translatorVoice={translatorVoice}
            onClearVoice={() => {
              clearTranslatorVoice();
              setShowSettings(false);
            }}
            onClose={() => setShowSettings(false)}
            onReconfigure={() => {
              setShowSettings(false);
              setShowSetup(true);
            }}
          />
        ) : (
          <TranslatorInterface
            sourceLanguage={sourceLanguage}
            targetLanguage={targetLanguage}
            setSourceLanguage={setSourceLanguage}
            setTargetLanguage={setTargetLanguage}
            voiceId={translatorVoice?.voiceId || ''}
          />
        )}
      </main>
    </div>
  );
}

// Setup Flow Component
function SetupFlow({
  onComplete,
  sourceLanguage,
  setSourceLanguage,
  getSampleText,
  saveTranslatorVoice,
}: {
  onComplete: () => void;
  sourceLanguage: LanguageCode;
  setSourceLanguage: (lang: LanguageCode) => void;
  getSampleText: (lang: LanguageCode) => string;
  saveTranslatorVoice: (voice: { voiceId: string; name: string; sourceLanguage: LanguageCode; createdAt: string }) => void;
}) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState<Blob | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlayingRecording, setIsPlayingRecording] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const sampleText = getSampleText(sourceLanguage);
  const selectedLang = SUPPORTED_LANGUAGES.find(l => l.code === sourceLanguage);

  // Recording functions
  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        setRecordedAudio(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error('Failed to start recording:', err);

      // Provide helpful error messages based on error type
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setError('No microphone found. Please connect a microphone and try again.');
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Microphone access denied. Please allow microphone access in your browser settings.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setError('Microphone is in use by another app. Please close other apps using the microphone.');
      } else {
        setError('Could not access microphone. Please check your device settings.');
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    }
  };

  const resetRecording = () => {
    // Stop any playing audio first
    if (recordedAudioRef.current) {
      recordedAudioRef.current.pause();
      recordedAudioRef.current = null;
    }
    setIsPlayingRecording(false);
    setRecordedAudio(null);
    setRecordingDuration(0);
    setError(null);
  };

  const playRecordedAudio = () => {
    if (!recordedAudio) return;

    // If already playing, stop it
    if (isPlayingRecording && recordedAudioRef.current) {
      recordedAudioRef.current.pause();
      recordedAudioRef.current = null;
      setIsPlayingRecording(false);
      return;
    }

    // Create and play audio
    const audio = new Audio(URL.createObjectURL(recordedAudio));
    recordedAudioRef.current = audio;
    setIsPlayingRecording(true);

    audio.onended = () => {
      setIsPlayingRecording(false);
      recordedAudioRef.current = null;
    };

    audio.onerror = () => {
      setIsPlayingRecording(false);
      recordedAudioRef.current = null;
    };

    audio.play().catch(() => {
      setIsPlayingRecording(false);
      recordedAudioRef.current = null;
    });
  };

  // Clone voice and complete setup
  const handleCloneVoice = async () => {
    if (!recordedAudio || !user) return;

    setIsCloning(true);
    setError(null);

    try {
      const token = await auth.currentUser?.getIdToken();
      const formData = new FormData();
      formData.append('name', `${user.displayName || 'User'}'s Translator Voice`);
      formData.append('description', `Translator voice for ${selectedLang?.name || sourceLanguage}`);
      formData.append('files', recordedAudio, 'voice_sample.wav');

      const response = await fetch('/api/clone-voice', {
        method: 'POST',
        headers: {
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to clone voice');
      }

      saveTranslatorVoice({
        voiceId: data.voice_id,
        name: data.name,
        sourceLanguage,
        createdAt: new Date().toISOString(),
      });

      onComplete();
    } catch (err) {
      console.error('Voice cloning error:', err);
      setError(err instanceof Error ? err.message : 'Failed to clone voice. Please try again.');
    } finally {
      setIsCloning(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {[1, 2].map((s) => (
          <div
            key={s}
            className={cn(
              "w-3 h-3 rounded-full transition-all",
              step >= s ? "bg-[#FF6D1F]" : "bg-white/20"
            )}
          />
        ))}
      </div>

      {step === 1 ? (
        <div className="liquid-card rounded-2xl p-6 space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-[#FF6D1F] to-[#ff8a4c] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[#FF6D1F]/30">
              <Languages className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-[var(--foreground)] mb-2">Select Your Language</h2>
            <p className="text-[var(--foreground)]/60">Choose the language you'll speak in</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => setSourceLanguage(lang.code)}
                className={cn(
                  "flex items-center gap-2 p-3 rounded-xl transition-all text-left",
                  sourceLanguage === lang.code
                    ? "liquid-button"
                    : "liquid-card hover:bg-white/20"
                )}
              >
                <span className="text-xl">{lang.flag}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{lang.name}</p>
                  <p className="text-xs opacity-70 truncate">{lang.nativeName}</p>
                </div>
                {sourceLanguage === lang.code && (
                  <Check className="w-4 h-4 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>

          <button
            onClick={() => setStep(2)}
            className="w-full liquid-button py-4 rounded-xl font-medium"
          >
            Continue with {selectedLang?.name}
          </button>
        </div>
      ) : (
        <div className="liquid-card rounded-2xl p-6 space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-[#FF6D1F] to-[#ff8a4c] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[#FF6D1F]/30">
              <Mic className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-[var(--foreground)] mb-2">Record Your Voice</h2>
            <p className="text-[var(--foreground)]/60">Read the text below clearly (minimum 30 seconds)</p>
          </div>

          {/* Sample text to read */}
          <div className="liquid-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">{selectedLang?.flag}</span>
              <span className="text-sm font-medium text-[var(--foreground)]">{selectedLang?.name}</span>
            </div>
            <p className="text-[var(--foreground)]/80 leading-relaxed">{sampleText}</p>
          </div>

          {/* Recording controls */}
          <div className="flex flex-col items-center gap-4">
            {!recordedAudio ? (
              <>
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  className={cn(
                    "w-24 h-24 rounded-full flex items-center justify-center transition-all relative",
                    isRecording
                      ? "bg-red-500 hover:bg-red-600 liquid-recording"
                      : "liquid-button"
                  )}
                >
                  {isRecording ? (
                    <Square className="w-10 h-10 text-white relative z-10" />
                  ) : (
                    <Mic className="w-10 h-10 text-white" />
                  )}
                </button>
                {isRecording && (
                  <div className="text-center">
                    <p className="text-2xl font-mono font-bold text-[var(--foreground)]">
                      {formatDuration(recordingDuration)}
                    </p>
                    <p className="text-sm text-[var(--foreground)]/60">Recording...</p>
                  </div>
                )}
                {!isRecording && (
                  <p className="text-sm text-[var(--foreground)]/60">Tap to start recording</p>
                )}
              </>
            ) : (
              <div className="w-full space-y-4">
                <div className="liquid-card rounded-xl p-4 flex items-center gap-3">
                  <button
                    onClick={playRecordedAudio}
                    className={cn(
                      "w-12 h-12 rounded-full flex items-center justify-center transition-all flex-shrink-0",
                      isPlayingRecording
                        ? "bg-green-500 hover:bg-green-600 animate-pulse"
                        : "bg-[#FF6D1F] hover:bg-[#e5621b]"
                    )}
                  >
                    {isPlayingRecording ? (
                      <StopCircle className="w-6 h-6 text-white" />
                    ) : (
                      <Play className="w-6 h-6 text-white" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[var(--foreground)]">
                      {isPlayingRecording ? 'Playing...' : 'Voice Sample'}
                    </p>
                    <p className="text-sm text-[var(--foreground)]/60">{formatDuration(recordingDuration)}</p>
                  </div>
                  <button
                    onClick={resetRecording}
                    className="p-2 rounded-full liquid-card hover:bg-white/20 text-[var(--foreground)]/60 hover:text-red-500 transition-colors flex-shrink-0"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                {recordingDuration < 30 && (
                  <p className="text-sm text-amber-500 text-center">
                    Recording should be at least 30 seconds for best results
                  </p>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30">
              <p className="text-red-500 text-sm text-center">{error}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="flex-1 py-4 rounded-xl font-medium liquid-card hover:bg-white/20 text-[var(--foreground)]"
            >
              Back
            </button>
            <button
              onClick={handleCloneVoice}
              disabled={!recordedAudio || isCloning}
              className={cn(
                "flex-1 py-4 rounded-xl font-medium transition-all",
                recordedAudio && !isCloning
                  ? "liquid-button"
                  : "liquid-card text-[var(--foreground)]/40 cursor-not-allowed"
              )}
            >
              {isCloning ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Cloning...
                </span>
              ) : (
                'Create Voice'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Settings View Component
function SettingsView({
  translatorVoice,
  onClearVoice,
  onClose,
  onReconfigure,
}: {
  translatorVoice: { voiceId: string; name: string; sourceLanguage: LanguageCode; createdAt: string } | null;
  onClearVoice: () => void;
  onClose: () => void;
  onReconfigure: () => void;
}) {
  const sourceLang = SUPPORTED_LANGUAGES.find(l => l.code === translatorVoice?.sourceLanguage);

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="liquid-card rounded-2xl p-6 space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-[var(--foreground)] mb-2">Translator Settings</h2>
          <p className="text-[var(--foreground)]/60">Manage your translator voice</p>
        </div>

        {translatorVoice && (
          <div className="liquid-card rounded-xl p-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#FF6D1F] to-[#ff8a4c] flex items-center justify-center">
                <Mic className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-[var(--foreground)]">{translatorVoice.name}</p>
                <p className="text-sm text-[var(--foreground)]/60 flex items-center gap-1">
                  <span>{sourceLang?.flag}</span>
                  <span>{sourceLang?.name}</span>
                </p>
                <p className="text-xs text-[var(--foreground)]/40">
                  Created {new Date(translatorVoice.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={onReconfigure}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-xl liquid-card hover:bg-white/20 text-[var(--foreground)] transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
            Re-record Voice
          </button>

          <button
            onClick={() => {
              if (confirm('Are you sure you want to delete your translator voice? You will need to set it up again.')) {
                onClearVoice();
              }
            }}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-xl hover:bg-red-500/10 text-red-500 transition-colors"
          >
            <Trash2 className="w-5 h-5" />
            Delete Voice
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full liquid-button py-4 rounded-xl font-medium"
        >
          Done
        </button>
      </div>
    </div>
  );
}

// Message type for conversation history
interface TranslationMessage {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  audioUrl?: string;
  timestamp: Date;
  speaker: 'me' | 'other';
}

// Translator Interface Component - Split screen two-way conversation
function TranslatorInterface({
  sourceLanguage,
  targetLanguage,
  setSourceLanguage,
  setTargetLanguage,
  voiceId,
}: {
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  setSourceLanguage: (lang: LanguageCode) => void;
  setTargetLanguage: (lang: LanguageCode) => void;
  voiceId: string;
}) {
  // View mode: 'conversation' (split screen) or 'history' (unified chat)
  const [viewMode, setViewMode] = useState<'conversation' | 'history'>('conversation');

  // State for "me" side (bottom half - I speak my language)
  const [isRecordingMe, setIsRecordingMe] = useState(false);
  const [isTranslatingMe, setIsTranslatingMe] = useState(false);
  const [currentTextMe, setCurrentTextMe] = useState('');

  // State for "other" side (top half - other person speaks their language)
  const [isRecordingOther, setIsRecordingOther] = useState(false);
  const [isTranslatingOther, setIsTranslatingOther] = useState(false);
  const [currentTextOther, setCurrentTextOther] = useState('');

  // Unified conversation history (all messages from both sides)
  const [allMessages, setAllMessages] = useState<TranslationMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isClearingHistory, setIsClearingHistory] = useState(false);

  // Shared state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [showTargetPicker, setShowTargetPicker] = useState(false);

  // Refs
  const recognitionMeRef = useRef<SpeechRecognitionInstance | null>(null);
  const recognitionOtherRef = useRef<SpeechRecognitionInstance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentTextMeRef = useRef<string>('');
  const currentTextOtherRef = useRef<string>('');

  const sourceLang = SUPPORTED_LANGUAGES.find(l => l.code === sourceLanguage);
  const targetLang = SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages]);

  // Keep refs in sync
  useEffect(() => {
    currentTextMeRef.current = currentTextMe;
  }, [currentTextMe]);

  useEffect(() => {
    currentTextOtherRef.current = currentTextOther;
  }, [currentTextOther]);

  // Initialize speech recognition instances
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const windowWithSpeech = window as typeof window & {
        SpeechRecognition?: new () => SpeechRecognitionInstance;
        webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
      };
      const SpeechRecognitionAPI = windowWithSpeech.SpeechRecognition || windowWithSpeech.webkitSpeechRecognition;
      if (SpeechRecognitionAPI) {
        recognitionMeRef.current = new SpeechRecognitionAPI();
        recognitionMeRef.current.continuous = true;
        recognitionMeRef.current.interimResults = true;

        recognitionOtherRef.current = new SpeechRecognitionAPI();
        recognitionOtherRef.current.continuous = true;
        recognitionOtherRef.current.interimResults = true;
      }
    }
  }, []);

  // Load conversation history from server
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const token = await getAuthToken();
        if (!token) {
          setIsLoadingHistory(false);
          return;
        }

        const response = await fetch('/api/translator/messages?limit=100', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          const messages: TranslationMessage[] = data.messages.map((m: {
            id: string;
            sourceText: string;
            translatedText: string;
            sourceLanguage: string;
            targetLanguage: string;
            speaker: 'me' | 'other';
            timestamp: string;
          }) => ({
            ...m,
            timestamp: new Date(m.timestamp),
          }));
          setAllMessages(messages);
        }
      } catch (error) {
        console.error('Error loading translator history:', error);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    loadHistory();
  }, []);

  // Save message to server
  const saveMessageToServer = useCallback(async (message: TranslationMessage) => {
    try {
      const token = await getAuthToken();
      if (!token) return;

      await fetch('/api/translator/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sourceText: message.sourceText,
          translatedText: message.translatedText,
          sourceLanguage: message.sourceLanguage,
          targetLanguage: message.targetLanguage,
          speaker: message.speaker,
          timestamp: message.timestamp.toISOString(),
        }),
      });
    } catch (error) {
      console.error('Error saving message to server:', error);
    }
  }, []);

  // Clear all history
  const clearHistory = useCallback(async () => {
    if (!confirm('Are you sure you want to clear all conversation history? This cannot be undone.')) {
      return;
    }

    setIsClearingHistory(true);
    try {
      const token = await getAuthToken();
      if (!token) return;

      const response = await fetch('/api/translator/messages', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        setAllMessages([]);
      }
    } catch (error) {
      console.error('Error clearing history:', error);
    } finally {
      setIsClearingHistory(false);
    }
  }, []);

  // Stop audio helper
  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
      setPlayingMessageId(null);
    }
  }, []);

  // Play audio helper
  const playAudio = useCallback(async (audioUrl: string, messageId: string) => {
    stopAudio();

    const audioElement = new Audio(audioUrl);
    audioRef.current = audioElement;
    setIsPlaying(true);
    setPlayingMessageId(messageId);

    audioElement.onended = () => {
      setIsPlaying(false);
      setPlayingMessageId(null);
    };

    audioElement.onerror = () => {
      setIsPlaying(false);
      setPlayingMessageId(null);
    };

    try {
      await audioElement.play();
    } catch (playError) {
      console.warn('Auto-play blocked:', playError);
      setIsPlaying(false);
      setPlayingMessageId(null);
    }
  }, [stopAudio]);

  // Start recording for "me" side (I speak in my language -> translated to their language)
  const startRecordingMe = useCallback(() => {
    if (!recognitionMeRef.current || isRecordingOther) return;

    stopAudio();
    setCurrentTextMe('');
    currentTextMeRef.current = '';

    recognitionMeRef.current.lang = sourceLanguage;

    recognitionMeRef.current.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setCurrentTextMe(transcript);
      currentTextMeRef.current = transcript;
    };

    recognitionMeRef.current.onerror = (event) => {
      console.error('Speech recognition error (me):', event.error);
      setIsRecordingMe(false);
    };

    try {
      recognitionMeRef.current.start();
      setIsRecordingMe(true);
    } catch (err) {
      try {
        recognitionMeRef.current.abort();
        recognitionMeRef.current.start();
        setIsRecordingMe(true);
      } catch {
        console.error('Could not start recognition (me)');
      }
    }
  }, [sourceLanguage, isRecordingOther, stopAudio]);

  // Stop recording for "me" side
  const stopRecordingMe = useCallback(async () => {
    if (!recognitionMeRef.current) return;

    recognitionMeRef.current.stop();
    setIsRecordingMe(false);

    await new Promise(resolve => setTimeout(resolve, 100));

    const text = currentTextMeRef.current;
    if (!text.trim()) return;

    setIsTranslatingMe(true);
    const messageId = Date.now().toString();

    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          text,
          sourceLanguage: sourceLang?.name || sourceLanguage,
          targetLanguage: targetLang?.name || targetLanguage,
          voiceId,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Translation failed');

      let audioUrl: string | undefined;
      if (data.audio) {
        const audioBlob = base64ToBlob(data.audio, 'audio/mpeg');
        audioUrl = URL.createObjectURL(audioBlob);
      }

      const newMessage: TranslationMessage = {
        id: messageId,
        sourceText: text,
        translatedText: data.translatedText,
        sourceLanguage,
        targetLanguage,
        audioUrl,
        timestamp: new Date(),
        speaker: 'me',
      };

      setAllMessages(prev => [...prev, newMessage]);
      setCurrentTextMe('');
      currentTextMeRef.current = '';

      // Save to server (don't await to not block playback)
      saveMessageToServer(newMessage);

      if (audioUrl) {
        await playAudio(audioUrl, messageId);
      }
    } catch (error) {
      console.error('Translation error (me):', error);
    } finally {
      setIsTranslatingMe(false);
    }
  }, [sourceLanguage, targetLanguage, voiceId, sourceLang, targetLang, playAudio, saveMessageToServer]);

  // Start recording for "other" side (they speak in their language -> translated to my language)
  const startRecordingOther = useCallback(() => {
    if (!recognitionOtherRef.current || isRecordingMe) return;

    stopAudio();
    setCurrentTextOther('');
    currentTextOtherRef.current = '';

    recognitionOtherRef.current.lang = targetLanguage;

    recognitionOtherRef.current.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setCurrentTextOther(transcript);
      currentTextOtherRef.current = transcript;
    };

    recognitionOtherRef.current.onerror = (event) => {
      console.error('Speech recognition error (other):', event.error);
      setIsRecordingOther(false);
    };

    try {
      recognitionOtherRef.current.start();
      setIsRecordingOther(true);
    } catch (err) {
      try {
        recognitionOtherRef.current.abort();
        recognitionOtherRef.current.start();
        setIsRecordingOther(true);
      } catch {
        console.error('Could not start recognition (other)');
      }
    }
  }, [targetLanguage, isRecordingMe, stopAudio]);

  // Stop recording for "other" side
  const stopRecordingOther = useCallback(async () => {
    if (!recognitionOtherRef.current) return;

    recognitionOtherRef.current.stop();
    setIsRecordingOther(false);

    await new Promise(resolve => setTimeout(resolve, 100));

    const text = currentTextOtherRef.current;
    if (!text.trim()) return;

    setIsTranslatingOther(true);
    const messageId = Date.now().toString();

    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          text,
          sourceLanguage: targetLang?.name || targetLanguage,
          targetLanguage: sourceLang?.name || sourceLanguage,
          voiceId,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Translation failed');

      let audioUrl: string | undefined;
      if (data.audio) {
        const audioBlob = base64ToBlob(data.audio, 'audio/mpeg');
        audioUrl = URL.createObjectURL(audioBlob);
      }

      const newMessage: TranslationMessage = {
        id: messageId,
        sourceText: text,
        translatedText: data.translatedText,
        sourceLanguage: targetLanguage,
        targetLanguage: sourceLanguage,
        audioUrl,
        timestamp: new Date(),
        speaker: 'other',
      };

      setAllMessages(prev => [...prev, newMessage]);
      setCurrentTextOther('');
      currentTextOtherRef.current = '';

      // Save to server (don't await to not block playback)
      saveMessageToServer(newMessage);

      if (audioUrl) {
        await playAudio(audioUrl, messageId);
      }
    } catch (error) {
      console.error('Translation error (other):', error);
    } finally {
      setIsTranslatingOther(false);
    }
  }, [sourceLanguage, targetLanguage, voiceId, sourceLang, targetLang, playAudio, saveMessageToServer]);

  // Swap languages
  const swapLanguages = () => {
    const temp = sourceLanguage;
    setSourceLanguage(targetLanguage);
    setTargetLanguage(temp);
  };

  // Filter messages by speaker for split view
  const messagesMe = allMessages.filter(m => m.speaker === 'me');
  const messagesOther = allMessages.filter(m => m.speaker === 'other');

  return (
    <div className="h-full flex flex-col">
      {/* Tab switcher */}
      <div className="p-2 border-b border-white/10">
        <div className="max-w-2xl mx-auto flex gap-2">
          <button
            onClick={() => setViewMode('conversation')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-xl transition-all",
              viewMode === 'conversation'
                ? "liquid-button"
                : "liquid-card hover:bg-white/20"
            )}
          >
            <MessageSquare className="w-4 h-4" />
            <span className="text-sm font-medium">Conversation</span>
          </button>
          <button
            onClick={() => setViewMode('history')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-xl transition-all",
              viewMode === 'history'
                ? "liquid-button"
                : "liquid-card hover:bg-white/20"
            )}
          >
            <History className="w-4 h-4" />
            <span className="text-sm font-medium">History</span>
            {allMessages.length > 0 && (
              <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded-full">{allMessages.length}</span>
            )}
          </button>
        </div>
      </div>

      {viewMode === 'history' ? (
        /* HISTORY VIEW - Chat-like unified conversation */
        <div className="flex-1 flex flex-col">
          {/* Language bar with clear button */}
          <div className="p-3 border-b border-white/10">
            <div className="max-w-2xl mx-auto flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">{sourceLang?.flag}</span>
                <ArrowRightLeft className="w-4 h-4 text-[var(--foreground)]/40" />
                <span className="text-lg">{targetLang?.flag}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-[var(--foreground)]/50">
                  {allMessages.length} message{allMessages.length !== 1 ? 's' : ''}
                </span>
                {allMessages.length > 0 && (
                  <button
                    onClick={clearHistory}
                    disabled={isClearingHistory}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    {isClearingHistory ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="max-w-2xl mx-auto space-y-4">
              {isLoadingHistory ? (
                <div className="flex flex-col items-center justify-center h-full py-16 text-center">
                  <Loader2 className="w-8 h-8 text-[#FF6D1F] animate-spin mb-4" />
                  <p className="text-[var(--foreground)]/60 text-sm">Loading history...</p>
                </div>
              ) : allMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-16 text-center">
                  <div className="w-16 h-16 liquid-card rounded-full flex items-center justify-center mb-4">
                    <History className="w-8 h-8 text-[#FF6D1F]" />
                  </div>
                  <h3 className="text-lg font-bold text-[var(--foreground)] mb-2">No History Yet</h3>
                  <p className="text-[var(--foreground)]/60 text-sm max-w-xs">
                    Start a conversation to see your translation history here.
                  </p>
                </div>
              ) : (
                <>
                  {allMessages.map((message) => {
                    const msgSourceLang = SUPPORTED_LANGUAGES.find(l => l.code === message.sourceLanguage);
                    const msgTargetLang = SUPPORTED_LANGUAGES.find(l => l.code === message.targetLanguage);
                    const isCurrentlyPlaying = playingMessageId === message.id && isPlaying;
                    const isFromMe = message.speaker === 'me';

                    return (
                      <div key={message.id} className={cn("flex", isFromMe ? "justify-end" : "justify-start")}>
                        <div className={cn("max-w-[85%] space-y-2", isFromMe ? "items-end" : "items-start")}>
                          {/* Speaker & time */}
                          <div className={cn("flex items-center gap-2 text-xs text-[var(--foreground)]/50", isFromMe && "flex-row-reverse")}>
                            <span>{isFromMe ? 'You' : 'Other'}</span>
                            <span>•</span>
                            <span>{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>

                          {/* Original message */}
                          <div className={cn(
                            "liquid-card rounded-2xl p-3",
                            isFromMe
                              ? "rounded-tr-sm bg-[#FF6D1F]/20"
                              : "rounded-tl-sm bg-purple-500/20"
                          )}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-sm">{msgSourceLang?.flag}</span>
                              <span className="text-xs text-[var(--foreground)]/50">{msgSourceLang?.name}</span>
                            </div>
                            <p className="text-[var(--foreground)] text-sm">{message.sourceText}</p>
                          </div>

                          {/* Translation */}
                          <div className={cn(
                            "liquid-card rounded-2xl p-3",
                            isFromMe ? "rounded-tr-sm" : "rounded-tl-sm"
                          )}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-sm">{msgTargetLang?.flag}</span>
                              <span className="text-xs text-[var(--foreground)]/50">{msgTargetLang?.name}</span>
                            </div>
                            <p className="text-[var(--foreground)] text-sm mb-2">{message.translatedText}</p>
                            {message.audioUrl && (
                              <button
                                onClick={() => isCurrentlyPlaying ? stopAudio() : playAudio(message.audioUrl!, message.id)}
                                className={cn(
                                  "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs transition-all",
                                  isCurrentlyPlaying ? "bg-green-500/20 text-green-500" : "liquid-card hover:bg-white/20 text-[var(--foreground)]/70"
                                )}
                              >
                                <Volume2 className={cn("w-3 h-3", isCurrentlyPlaying && "animate-pulse")} />
                                {isCurrentlyPlaying ? 'Playing' : 'Play'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* CONVERSATION VIEW - Split screen */
        <>
          {/* TOP HALF - Other person's side (rotated 180 degrees so they can read it) */}
          <div className="flex-1 flex flex-col border-b-2 border-white/20 rotate-180">
            {/* Other's language header */}
            <div className="p-3 border-b border-white/10">
              <div className="max-w-2xl mx-auto">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 relative">
                    <button
                      onClick={() => {
                        setShowTargetPicker(!showTargetPicker);
                        setShowSourcePicker(false);
                      }}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl liquid-card hover:bg-white/20 transition-colors"
                    >
                      <span className="text-lg">{targetLang?.flag}</span>
                      <span className="font-medium text-sm text-[var(--foreground)]">{targetLang?.name}</span>
                      <ChevronDown className={cn("w-4 h-4 text-[var(--foreground)]/60 transition-transform", showTargetPicker && "rotate-180")} />
                    </button>
                    {showTargetPicker && (
                      <div className="absolute top-full left-0 mt-2 z-50 rotate-180">
                        <LanguagePicker
                          selected={targetLanguage}
                          onSelect={(lang) => {
                            setTargetLanguage(lang);
                            setShowTargetPicker(false);
                          }}
                          exclude={sourceLanguage}
                        />
                      </div>
                    )}
                  </div>
                  <button
                    onClick={swapLanguages}
                    className="w-8 h-8 rounded-full liquid-card hover:bg-white/20 flex items-center justify-center transition-colors"
                  >
                    <ArrowRightLeft className="w-4 h-4 text-[var(--foreground)]" />
                  </button>
                </div>
              </div>
            </div>

            {/* Other's messages area */}
            <div className="flex-1 overflow-y-auto p-3">
              <div className="max-w-2xl mx-auto space-y-3">
                {messagesOther.length === 0 && !isRecordingOther && !currentTextOther ? (
                  <div className="flex flex-col items-center justify-center h-full py-8 text-center">
                    <p className="text-[var(--foreground)]/40 text-sm">
                      Press and hold to speak in {targetLang?.name}
                    </p>
                  </div>
                ) : (
                  <>
                    {messagesOther.map((message) => {
                      const isCurrentlyPlaying = playingMessageId === message.id && isPlaying;
                      return (
                        <div key={message.id} className="space-y-2">
                          <div className="liquid-card rounded-2xl p-3 bg-purple-500/20">
                            <p className="text-[var(--foreground)] text-sm">{message.sourceText}</p>
                          </div>
                          <div className="liquid-card rounded-2xl p-3">
                            <p className="text-[var(--foreground)] text-sm mb-2">{message.translatedText}</p>
                            {message.audioUrl && (
                              <button
                                onClick={() => isCurrentlyPlaying ? stopAudio() : playAudio(message.audioUrl!, message.id)}
                                className={cn(
                                  "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs transition-all",
                                  isCurrentlyPlaying ? "bg-green-500/20 text-green-500" : "liquid-card hover:bg-white/20 text-[var(--foreground)]/70"
                                )}
                              >
                                <Volume2 className={cn("w-3 h-3", isCurrentlyPlaying && "animate-pulse")} />
                                {isCurrentlyPlaying ? 'Playing' : 'Play'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {(isRecordingOther || currentTextOther) && (
                      <div className="liquid-card rounded-2xl p-3 bg-purple-500/20">
                        <p className={cn("text-[var(--foreground)] text-sm", !currentTextOther && "opacity-50 italic")}>
                          {currentTextOther || 'Listening...'}
                        </p>
                        {isRecordingOther && (
                          <div className="flex items-center gap-2 mt-2">
                            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-xs text-[var(--foreground)]/50">Recording</span>
                          </div>
                        )}
                      </div>
                    )}

                    {isTranslatingOther && (
                      <div className="liquid-card rounded-2xl p-3">
                        <div className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin text-[#FF6D1F]" />
                          <span className="text-[var(--foreground)]/60 text-sm">Translating...</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Other's mic button */}
            <div className="p-3 flex justify-center">
              <ConversationMicButton
                isRecording={isRecordingOther}
                isTranslating={isTranslatingOther}
                isPlaying={isPlaying && messagesOther.some(m => m.id === playingMessageId)}
                disabled={isRecordingMe || isTranslatingMe}
                onStart={startRecordingOther}
                onStop={stopRecordingOther}
                onStopAudio={stopAudio}
                color="purple"
              />
            </div>
          </div>

          {/* BOTTOM HALF - My side */}
          <div className="flex-1 flex flex-col">
            {/* My language header */}
            <div className="p-3 border-b border-white/10">
              <div className="max-w-2xl mx-auto">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 relative">
                    <button
                      onClick={() => {
                        setShowSourcePicker(!showSourcePicker);
                        setShowTargetPicker(false);
                      }}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl liquid-card hover:bg-white/20 transition-colors"
                    >
                      <span className="text-lg">{sourceLang?.flag}</span>
                      <span className="font-medium text-sm text-[var(--foreground)]">{sourceLang?.name}</span>
                      <ChevronDown className={cn("w-4 h-4 text-[var(--foreground)]/60 transition-transform", showSourcePicker && "rotate-180")} />
                    </button>
                    {showSourcePicker && (
                      <LanguagePicker
                        selected={sourceLanguage}
                        onSelect={(lang) => {
                          setSourceLanguage(lang);
                          setShowSourcePicker(false);
                        }}
                        exclude={targetLanguage}
                      />
                    )}
                  </div>
                  <span className="text-xs text-[var(--foreground)]/50">You</span>
                </div>
              </div>
            </div>

            {/* My messages area */}
            <div className="flex-1 overflow-y-auto p-3">
              <div className="max-w-2xl mx-auto space-y-3">
                {messagesMe.length === 0 && !isRecordingMe && !currentTextMe ? (
                  <div className="flex flex-col items-center justify-center h-full py-8 text-center">
                    <p className="text-[var(--foreground)]/40 text-sm">
                      Press and hold to speak in {sourceLang?.name}
                    </p>
                  </div>
                ) : (
                  <>
                    {messagesMe.map((message) => {
                      const isCurrentlyPlaying = playingMessageId === message.id && isPlaying;
                      return (
                        <div key={message.id} className="space-y-2">
                          <div className="liquid-card rounded-2xl p-3 bg-[#FF6D1F]/20">
                            <p className="text-[var(--foreground)] text-sm">{message.sourceText}</p>
                          </div>
                          <div className="liquid-card rounded-2xl p-3">
                            <p className="text-[var(--foreground)] text-sm mb-2">{message.translatedText}</p>
                            {message.audioUrl && (
                              <button
                                onClick={() => isCurrentlyPlaying ? stopAudio() : playAudio(message.audioUrl!, message.id)}
                                className={cn(
                                  "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs transition-all",
                                  isCurrentlyPlaying ? "bg-green-500/20 text-green-500" : "liquid-card hover:bg-white/20 text-[var(--foreground)]/70"
                                )}
                              >
                                <Volume2 className={cn("w-3 h-3", isCurrentlyPlaying && "animate-pulse")} />
                                {isCurrentlyPlaying ? 'Playing' : 'Play'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {(isRecordingMe || currentTextMe) && (
                      <div className="liquid-card rounded-2xl p-3 bg-[#FF6D1F]/20">
                        <p className={cn("text-[var(--foreground)] text-sm", !currentTextMe && "opacity-50 italic")}>
                          {currentTextMe || 'Listening...'}
                        </p>
                        {isRecordingMe && (
                          <div className="flex items-center gap-2 mt-2">
                            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-xs text-[var(--foreground)]/50">Recording</span>
                          </div>
                        )}
                      </div>
                    )}

                    {isTranslatingMe && (
                      <div className="liquid-card rounded-2xl p-3">
                        <div className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin text-[#FF6D1F]" />
                          <span className="text-[var(--foreground)]/60 text-sm">Translating...</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* My mic button */}
            <div className="p-3 flex justify-center" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
              <ConversationMicButton
                isRecording={isRecordingMe}
                isTranslating={isTranslatingMe}
                isPlaying={isPlaying && messagesMe.some(m => m.id === playingMessageId)}
                disabled={isRecordingOther || isTranslatingOther}
                onStart={startRecordingMe}
                onStop={stopRecordingMe}
                onStopAudio={stopAudio}
                color="orange"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Conversation Mic Button Component
function ConversationMicButton({
  isRecording,
  isTranslating,
  isPlaying,
  disabled,
  onStart,
  onStop,
  onStopAudio,
  color,
}: {
  isRecording: boolean;
  isTranslating: boolean;
  isPlaying: boolean;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
  onStopAudio: () => void;
  color: 'orange' | 'purple';
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;

    const handlePointerDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      button.setPointerCapture(e.pointerId);
      if (isPlaying) {
        onStopAudio();
      } else if (!isTranslating && !disabled) {
        onStart();
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (button.hasPointerCapture(e.pointerId)) {
        button.releasePointerCapture(e.pointerId);
      }
      if (isRecording) {
        onStop();
      }
    };

    const handleContextMenu = (e: Event) => {
      e.preventDefault();
    };

    button.addEventListener('pointerdown', handlePointerDown);
    button.addEventListener('pointerup', handlePointerUp);
    button.addEventListener('pointercancel', handlePointerUp);
    button.addEventListener('contextmenu', handleContextMenu);

    return () => {
      button.removeEventListener('pointerdown', handlePointerDown);
      button.removeEventListener('pointerup', handlePointerUp);
      button.removeEventListener('pointercancel', handlePointerUp);
      button.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [isRecording, isTranslating, isPlaying, disabled, onStart, onStop, onStopAudio]);

  const bgColor = color === 'orange' ? 'from-[#FF6D1F] to-[#ff8a4c]' : 'from-purple-500 to-purple-600';

  return (
    <button
      ref={buttonRef}
      disabled={isTranslating || disabled}
      className={cn(
        "w-16 h-16 rounded-full flex items-center justify-center transition-all select-none relative",
        isRecording
          ? "bg-red-500 liquid-recording"
          : isPlaying
          ? "bg-green-500"
          : isTranslating
          ? "liquid-card cursor-wait"
          : disabled
          ? "liquid-card opacity-50 cursor-not-allowed"
          : `bg-gradient-to-br ${bgColor} shadow-lg`
      )}
      style={{ touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
    >
      {isTranslating ? (
        <Loader2 className="w-6 h-6 text-[var(--foreground)]/60 animate-spin" />
      ) : isPlaying ? (
        <Volume2 className="w-6 h-6 text-white relative z-10" />
      ) : isRecording ? (
        <MicOff className="w-6 h-6 text-white relative z-10" />
      ) : (
        <Mic className="w-6 h-6 text-white" />
      )}
    </button>
  );
}

// Language Picker Component
function LanguagePicker({
  selected,
  onSelect,
  exclude,
}: {
  selected: LanguageCode;
  onSelect: (lang: LanguageCode) => void;
  exclude?: LanguageCode;
}) {
  const filteredLanguages = SUPPORTED_LANGUAGES.filter(l => l.code !== exclude);

  return (
    <div className="absolute top-full left-0 right-0 mt-2 liquid-glass rounded-xl shadow-xl max-h-60 overflow-y-auto z-50">
      {filteredLanguages.map((lang) => (
        <button
          key={lang.code}
          onClick={() => onSelect(lang.code)}
          className={cn(
            "w-full flex items-center gap-3 p-3 hover:bg-white/10 transition-colors text-left",
            selected === lang.code && "bg-[#FF6D1F]/20"
          )}
        >
          <span className="text-xl">{lang.flag}</span>
          <div className="flex-1">
            <p className="font-medium text-[var(--foreground)]">{lang.name}</p>
            <p className="text-xs text-[var(--foreground)]/60">{lang.nativeName}</p>
          </div>
          {selected === lang.code && (
            <Check className="w-4 h-4 text-[#FF6D1F]" />
          )}
        </button>
      ))}
    </div>
  );
}

// Helper function
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}
