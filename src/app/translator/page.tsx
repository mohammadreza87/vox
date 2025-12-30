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
  Play,
  StopCircle,
  Upload,
  Phone,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { LiveTranslationModal } from '@/features/call';
import { useEntranceAnimation } from '@/hooks/useAnimations';
import { ClonedVoice } from '@/shared/types';

// MediaRecorder state for Whisper-based speech-to-text

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
    availableClonedVoices,
    useExistingVoice,
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
            availableClonedVoices={availableClonedVoices}
            useExistingVoice={useExistingVoice}
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
  availableClonedVoices,
  useExistingVoice,
}: {
  onComplete: () => void;
  sourceLanguage: LanguageCode;
  setSourceLanguage: (lang: LanguageCode) => void;
  getSampleText: (lang: LanguageCode) => string;
  saveTranslatorVoice: (voice: { voiceId: string; name: string; sourceLanguage: LanguageCode; createdAt: string }) => void;
  availableClonedVoices: ClonedVoice[];
  useExistingVoice: (voice: ClonedVoice, sourceLanguage: LanguageCode) => void;
}) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [voiceSelectionType, setVoiceSelectionType] = useState<'record' | 'existing'>('record');
  const [selectedExistingVoice, setSelectedExistingVoice] = useState<ClonedVoice | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState<Blob | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlayingRecording, setIsPlayingRecording] = useState(false);
  const [showUploadOption, setShowUploadOption] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sampleText = getSampleText(sourceLanguage);
  const selectedLang = SUPPORTED_LANGUAGES.find(l => l.code === sourceLanguage);

  // Detect Telegram WebApp
  const isInTelegram = typeof window !== 'undefined' && (
    window.navigator.userAgent.includes('Telegram') ||
    (window as any).Telegram?.WebApp
  );

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

      // Show upload option as fallback
      setShowUploadOption(true);

      // Provide helpful error messages based on error type
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setError('No microphone detected. Please check your device settings or upload an audio file instead.');
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Microphone access denied. Please allow access in browser settings or upload an audio file.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setError('Microphone is busy or unavailable. Try closing other apps or upload an audio file.');
      } else {
        setError('Could not access microphone. Please upload an audio file instead.');
      }
    }
  };

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check if it's an audio file
    if (!file.type.startsWith('audio/')) {
      setError('Please select an audio file (MP3, WAV, M4A, etc.)');
      return;
    }

    // Check file size (max 25MB)
    if (file.size > 25 * 1024 * 1024) {
      setError('File too large. Maximum size is 25MB.');
      return;
    }

    setError(null);
    setRecordedAudio(file);
    setRecordingDuration(30); // Assume uploaded files are adequate length
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

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.error || 'Failed to clone voice');
      }

      // Unwrap standardized API response format
      const data = responseData.data || responseData;
      console.log('Voice cloning response:', data);

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
            <h2 className="text-2xl font-bold text-[var(--foreground)] mb-2">Choose Your Voice</h2>
            <p className="text-[var(--foreground)]/60">Record a new voice or use an existing one</p>
          </div>

          {/* Voice selection type tabs - only show if there are existing voices */}
          {availableClonedVoices.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => setVoiceSelectionType('record')}
                className={cn(
                  "flex-1 py-3 px-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2",
                  voiceSelectionType === 'record'
                    ? "liquid-button"
                    : "liquid-card hover:bg-white/20"
                )}
              >
                <Mic className="w-4 h-4" />
                Record New
              </button>
              <button
                onClick={() => setVoiceSelectionType('existing')}
                className={cn(
                  "flex-1 py-3 px-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2",
                  voiceSelectionType === 'existing'
                    ? "liquid-button"
                    : "liquid-card hover:bg-white/20"
                )}
              >
                <Volume2 className="w-4 h-4" />
                Use Existing ({availableClonedVoices.length})
              </button>
            </div>
          )}

          {voiceSelectionType === 'existing' && availableClonedVoices.length > 0 ? (
            /* Existing voice selection */
            <div className="space-y-3">
              <p className="text-sm text-[var(--foreground)]/60 text-center">
                Select a voice you've created before
              </p>
              {availableClonedVoices.map((voice) => (
                <button
                  key={voice.id}
                  onClick={() => setSelectedExistingVoice(voice)}
                  className={cn(
                    "w-full p-4 rounded-xl transition-all flex items-center gap-3 text-left",
                    selectedExistingVoice?.id === voice.id
                      ? "liquid-button"
                      : "liquid-card hover:bg-white/20"
                  )}
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                    <Volume2 className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[var(--foreground)] truncate">{voice.name}</p>
                    <p className="text-xs text-[var(--foreground)]/60">
                      Created {new Date(voice.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  {selectedExistingVoice?.id === voice.id && (
                    <Check className="w-5 h-5 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          ) : (
            /* Recording flow */
            <>
              {/* Sample text to read */}
              <div className="liquid-card rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{selectedLang?.flag}</span>
                  <span className="text-sm font-medium text-[var(--foreground)]">{selectedLang?.name}</span>
                </div>
                <p className="text-[var(--foreground)]/80 leading-relaxed">{sampleText}</p>
              </div>

              {/* Hidden file input for uploads */}
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                className="hidden"
              />

              {/* Recording controls */}
              <div className="flex flex-col items-center gap-4">
                {!recordedAudio ? (
                  <>
                    {/* Record button */}
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
                      <>
                        <p className="text-sm text-[var(--foreground)]/60">Tap to start recording</p>

                        {/* Upload option - always available as alternative */}
                        <div className="w-full mt-6 space-y-3">
                          <div className="flex items-center gap-3">
                            <div className="flex-1 h-px bg-white/10" />
                            <span className="text-xs text-[var(--foreground)]/40">or</span>
                            <div className="flex-1 h-px bg-white/10" />
                          </div>
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl liquid-card hover:bg-white/20 text-[var(--foreground)]/70 transition-colors"
                          >
                            <Upload className="w-4 h-4" />
                            Upload Audio File
                          </button>
                        </div>
                      </>
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
            </>
          )}

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
            {voiceSelectionType === 'existing' ? (
              <button
                onClick={() => {
                  if (selectedExistingVoice) {
                    useExistingVoice(selectedExistingVoice, sourceLanguage);
                    onComplete();
                  }
                }}
                disabled={!selectedExistingVoice}
                className={cn(
                  "flex-1 py-4 rounded-xl font-medium transition-all",
                  selectedExistingVoice
                    ? "liquid-button"
                    : "liquid-card text-[var(--foreground)]/40 cursor-not-allowed"
                )}
              >
                Use This Voice
              </button>
            ) : (
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
            )}
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
  sourceAudioUrl?: string; // Audio in source language
  timestamp: Date;
  speaker: 'me' | 'other';
}

// Translator Interface Component - Simplified single message view
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
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [currentText, setCurrentText] = useState('');
  const [inputText, setInputText] = useState(''); // Text input fallback

  // Last translation result (only show the most recent)
  const [lastTranslation, setLastTranslation] = useState<TranslationMessage | null>(null);

  // Live translation modal state
  const [isLiveTranslateOpen, setIsLiveTranslateOpen] = useState(false);

  // Audio playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingLang, setPlayingLang] = useState<'source' | 'target' | null>(null);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState<'source' | 'target' | null>(null);

  // Language picker state
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [showTargetPicker, setShowTargetPicker] = useState(false);

  // Recording support (using MediaRecorder + Whisper)
  const [recordingSupported, setRecordingSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const sourceLang = SUPPORTED_LANGUAGES.find(l => l.code === sourceLanguage);
  const targetLang = SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage);

  // Check if MediaRecorder is supported
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isSupported = typeof MediaRecorder !== 'undefined' && navigator.mediaDevices?.getUserMedia;
      setRecordingSupported(!!isSupported);
      if (!isSupported) {
        console.log('MediaRecorder not supported');
      }
    }
  }, []);

  // Stop audio helper
  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
      setPlayingLang(null);
    }
  }, []);

  // Play audio from URL
  const playAudioUrl = useCallback(async (audioUrl: string, lang: 'source' | 'target') => {
    stopAudio();

    try {
      const audioElement = new Audio();
      audioElement.src = audioUrl;
      audioElement.preload = 'auto';
      audioRef.current = audioElement;
      setIsPlaying(true);
      setPlayingLang(lang);

      audioElement.onended = () => {
        setIsPlaying(false);
        setPlayingLang(null);
      };

      audioElement.onerror = (e) => {
        console.error('Audio playback error:', e);
        setIsPlaying(false);
        setPlayingLang(null);
      };

      // Wait for audio to be ready
      await new Promise<void>((resolve, reject) => {
        audioElement.oncanplaythrough = () => resolve();
        audioElement.onerror = () => reject(new Error('Failed to load audio'));
        // Timeout after 10 seconds
        setTimeout(() => reject(new Error('Audio load timeout')), 10000);
      });

      await audioElement.play();
    } catch (error) {
      console.error('Audio play error:', error);
      setIsPlaying(false);
      setPlayingLang(null);
    }
  }, [stopAudio]);

  // Generate and play audio for a specific language
  const playInLanguage = useCallback(async (text: string, language: LanguageCode, langType: 'source' | 'target') => {
    if (isPlaying && playingLang === langType) {
      stopAudio();
      return;
    }

    // Check if we already have this audio cached
    if (langType === 'target' && lastTranslation?.audioUrl) {
      await playAudioUrl(lastTranslation.audioUrl, 'target');
      return;
    }
    if (langType === 'source' && lastTranslation?.sourceAudioUrl) {
      await playAudioUrl(lastTranslation.sourceAudioUrl, 'source');
      return;
    }

    // Generate new audio
    setIsGeneratingAudio(langType);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          text,
          voiceId,
        }),
      });

      if (!response.ok) throw new Error('TTS failed');

      const responseData = await response.json();
      // Handle standardized response format
      const data = responseData.data || responseData;
      if (data.audio) {
        const audioBlob = base64ToBlob(data.audio, 'audio/mpeg');
        const audioUrl = URL.createObjectURL(audioBlob);

        // Cache the audio URL
        if (lastTranslation) {
          setLastTranslation(prev => prev ? {
            ...prev,
            [langType === 'source' ? 'sourceAudioUrl' : 'audioUrl']: audioUrl
          } : prev);
        }

        await playAudioUrl(audioUrl, langType);
      }
    } catch (error) {
      console.error('TTS error:', error);
    } finally {
      setIsGeneratingAudio(null);
    }
  }, [isPlaying, playingLang, lastTranslation, voiceId, stopAudio, playAudioUrl]);

  // Start recording using MediaRecorder
  const startRecording = useCallback(async () => {
    console.log('startRecording called');
    setError(null);
    stopAudio();
    setCurrentText('');
    audioChunksRef.current = [];

    try {
      console.log('Requesting microphone permission...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      console.log('Microphone permission granted');
      mediaStreamRef.current = stream;

      // Determine best supported format
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
        mimeType = 'audio/ogg';
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        setIsRecording(false);
        setError('Recording failed. Please try again.');
      };

      mediaRecorder.start(100); // Collect data every 100ms
      setIsRecording(true);
      console.log('Recording started successfully');
    } catch (err: any) {
      console.error('Failed to start recording:', err);
      setIsRecording(false);

      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setError('No microphone found. Please connect a microphone.');
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Microphone access denied. Please allow microphone in browser settings.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setError('Microphone is in use by another app.');
      } else {
        setError('Could not access microphone. Please check your device settings.');
      }
    }
  }, [stopAudio]);

  // Stop recording and transcribe with Whisper, then translate
  const stopRecording = useCallback(async () => {
    console.log('stopRecording called');

    if (!mediaRecorderRef.current) {
      console.log('No media recorder ref');
      return;
    }

    setIsRecording(false);

    // Stop the media recorder and wait for it to finish
    const mediaRecorder = mediaRecorderRef.current;
    const stream = mediaStreamRef.current;

    await new Promise<void>((resolve) => {
      mediaRecorder.onstop = () => resolve();
      mediaRecorder.stop();
    });

    // Stop all tracks
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Check if we have audio data
    if (audioChunksRef.current.length === 0) {
      console.log('No audio chunks');
      setError('No audio recorded. Please try again.');
      return;
    }

    // Create audio blob
    const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
    console.log('Audio blob created, size:', audioBlob.size, 'type:', audioBlob.type);

    if (audioBlob.size < 1000) {
      console.log('Audio too short');
      setError('Recording too short. Hold the button and speak.');
      return;
    }

    // Transcribe with Whisper
    setIsTranscribing(true);
    setCurrentText('Transcribing...');

    try {
      const token = await auth.currentUser?.getIdToken();

      // Send to STT API
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('language', sourceLang?.name || sourceLanguage);

      console.log('Sending to STT API...');
      const sttResponse = await fetch('/api/stt', {
        method: 'POST',
        headers: {
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: formData,
      });

      const sttData = await sttResponse.json();
      console.log('STT response:', sttData);

      if (!sttResponse.ok) {
        throw new Error(sttData.error || 'Transcription failed');
      }

      const text = sttData.text?.trim();
      if (!text) {
        setCurrentText('');
        setError('No speech detected. Hold the button and speak clearly.');
        setIsTranscribing(false);
        return;
      }

      console.log('Transcribed text:', text);
      setCurrentText(text);
      setIsTranscribing(false);

      // Now translate
      setIsTranslating(true);

      const translateResponse = await fetch('/api/translate', {
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

      const responseData = await translateResponse.json();
      console.log('Translate response:', responseData);
      if (!translateResponse.ok) throw new Error(responseData.error || 'Translation failed');

      // Handle both direct and standardized response formats
      const data = responseData.data || responseData;

      let translatedAudioUrl: string | undefined;
      if (data.audio) {
        console.log('Audio data received, length:', data.audio.length);
        const audioB = base64ToBlob(data.audio, 'audio/mpeg');
        translatedAudioUrl = URL.createObjectURL(audioB);
        console.log('Audio URL created:', translatedAudioUrl);
      } else {
        console.warn('No audio in response');
      }

      const newTranslation: TranslationMessage = {
        id: Date.now().toString(),
        sourceText: text,
        translatedText: data.translatedText,
        sourceLanguage,
        targetLanguage,
        audioUrl: translatedAudioUrl,
        timestamp: new Date(),
        speaker: 'me',
      };

      setLastTranslation(newTranslation);
      setCurrentText('');

      // Auto-play the translated audio
      if (translatedAudioUrl) {
        await playAudioUrl(translatedAudioUrl, 'target');
      }
    } catch (err) {
      console.error('Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to process recording');
      setCurrentText('');
    } finally {
      setIsTranscribing(false);
      setIsTranslating(false);
    }
  }, [sourceLanguage, targetLanguage, voiceId, sourceLang, targetLang, playAudioUrl]);

  // Translate from text input (fallback for when speech doesn't work)
  const translateText = useCallback(async (text: string) => {
    if (!text.trim() || isTranslating) return;

    setError(null);
    setIsTranslating(true);
    setCurrentText(text);

    try {
      const token = await auth.currentUser?.getIdToken();
      console.log('Translating text:', text);

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

      const responseData = await response.json();
      console.log('Translate response:', responseData);

      if (!response.ok) {
        throw new Error(responseData.error || 'Translation failed');
      }

      const data = responseData.data || responseData;

      let audioUrl: string | undefined;
      if (data.audio) {
        console.log('Audio received, creating blob...');
        const audioBlob = base64ToBlob(data.audio, 'audio/mpeg');
        audioUrl = URL.createObjectURL(audioBlob);
        console.log('Audio URL:', audioUrl);
      }

      const newTranslation: TranslationMessage = {
        id: Date.now().toString(),
        sourceText: text,
        translatedText: data.translatedText,
        sourceLanguage,
        targetLanguage,
        audioUrl,
        timestamp: new Date(),
        speaker: 'me',
      };

      setLastTranslation(newTranslation);
      setInputText('');
      setCurrentText('');

      // Auto-play the translated audio
      if (audioUrl) {
        console.log('Playing audio...');
        await playAudioUrl(audioUrl, 'target');
      }
    } catch (err) {
      console.error('Translation error:', err);
      setError(err instanceof Error ? err.message : 'Translation failed');
    } finally {
      setIsTranslating(false);
    }
  }, [sourceLanguage, targetLanguage, voiceId, sourceLang, targetLang, playAudioUrl, isTranslating]);

  // Swap languages
  const swapLanguages = () => {
    const temp = sourceLanguage;
    setSourceLanguage(targetLanguage);
    setTargetLanguage(temp);
    setLastTranslation(null); // Clear when swapping
    setError(null);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Language selector bar */}
      <div className="p-4 border-b border-white/10">
        <div className="max-w-2xl mx-auto flex items-center justify-center gap-4">
          {/* Source language */}
          <div className="relative">
            <button
              onClick={() => {
                setShowSourcePicker(!showSourcePicker);
                setShowTargetPicker(false);
              }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl liquid-card hover:bg-white/20 transition-colors"
            >
              <span className="text-2xl">{sourceLang?.flag}</span>
              <span className="font-medium text-[var(--foreground)]">{sourceLang?.name}</span>
              <ChevronDown className={cn("w-4 h-4 text-[var(--foreground)]/60 transition-transform", showSourcePicker && "rotate-180")} />
            </button>
            {showSourcePicker && (
              <LanguagePicker
                selected={sourceLanguage}
                onSelect={(lang) => {
                  setSourceLanguage(lang);
                  setShowSourcePicker(false);
                  // Clear only when source language changes (source text won't match)
                  setLastTranslation(null);
                }}
                exclude={targetLanguage}
              />
            )}
          </div>

          {/* Swap button */}
          <button
            onClick={swapLanguages}
            className="w-12 h-12 rounded-full liquid-button flex items-center justify-center hover:scale-105 transition-transform"
          >
            <ArrowRightLeft className="w-5 h-5" />
          </button>

          {/* Target language */}
          <div className="relative">
            <button
              onClick={() => {
                setShowTargetPicker(!showTargetPicker);
                setShowSourcePicker(false);
              }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl liquid-card hover:bg-white/20 transition-colors"
            >
              <span className="text-2xl">{targetLang?.flag}</span>
              <span className="font-medium text-[var(--foreground)]">{targetLang?.name}</span>
              <ChevronDown className={cn("w-4 h-4 text-[var(--foreground)]/60 transition-transform", showTargetPicker && "rotate-180")} />
            </button>
            {showTargetPicker && (
              <LanguagePicker
                selected={targetLanguage}
                onSelect={async (lang) => {
                  setShowTargetPicker(false);
                  setTargetLanguage(lang);
                  // If there's existing source text, re-translate to new language
                  if (lastTranslation?.sourceText) {
                    // Clear the audio URL since it's for the old language
                    setLastTranslation(prev => prev ? { ...prev, audioUrl: undefined, targetLanguage: lang } : null);
                    // Re-translate
                    const newTargetLang = SUPPORTED_LANGUAGES.find(l => l.code === lang);
                    setIsTranslating(true);
                    try {
                      const token = await auth.currentUser?.getIdToken();
                      const response = await fetch('/api/translate', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          ...(token && { Authorization: `Bearer ${token}` }),
                        },
                        body: JSON.stringify({
                          text: lastTranslation.sourceText,
                          sourceLanguage: sourceLang?.name || sourceLanguage,
                          targetLanguage: newTargetLang?.name || lang,
                          voiceId,
                        }),
                      });
                      const responseData = await response.json();
                      if (response.ok) {
                        const data = responseData.data || responseData;
                        let audioUrl: string | undefined;
                        if (data.audio) {
                          const audioBlob = base64ToBlob(data.audio, 'audio/mpeg');
                          audioUrl = URL.createObjectURL(audioBlob);
                        }
                        setLastTranslation(prev => prev ? {
                          ...prev,
                          translatedText: data.translatedText,
                          targetLanguage: lang,
                          audioUrl,
                        } : null);
                        if (audioUrl) {
                          await playAudioUrl(audioUrl, 'target');
                        }
                      }
                    } catch (err) {
                      console.error('Re-translation error:', err);
                    } finally {
                      setIsTranslating(false);
                    }
                  }
                }}
                exclude={sourceLanguage}
              />
            )}
          </div>
        </div>
      </div>

      {/* Main content area - shows last translation only */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto h-full flex flex-col justify-center">
          {!lastTranslation && !isRecording && !currentText && !isTranslating && !isTranscribing ? (
            /* Empty state */
            <div className="text-center py-8">
              <div className="w-24 h-24 liquid-card rounded-full flex items-center justify-center mx-auto mb-6">
                <Languages className="w-12 h-12 text-[#FF6D1F]" />
              </div>
              <h3 className="text-xl font-bold text-[var(--foreground)] mb-2">Ready to Translate</h3>
              <p className="text-[var(--foreground)]/60 max-w-xs mx-auto mb-6">
                {recordingSupported
                  ? `Type or speak in ${sourceLang?.name}`
                  : `Type in ${sourceLang?.name} to translate`
                }
              </p>

              {/* Live Translate Button */}
              <button
                onClick={() => setIsLiveTranslateOpen(true)}
                className="inline-flex items-center gap-3 px-6 py-4 rounded-2xl bg-gradient-to-r from-[#FF6D1F] to-[#ff8a4c] text-white font-semibold shadow-lg shadow-[#FF6D1F]/30 hover:scale-105 transition-transform"
              >
                <Phone className="w-5 h-5" />
                <div className="text-left">
                  <div className="text-base">Live Translate</div>
                  <div className="text-xs opacity-80">Real-time voice translation</div>
                </div>
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Source text (what you said) */}
              {(currentText || lastTranslation?.sourceText) && (
                <div className="liquid-card rounded-2xl p-5 bg-[#FF6D1F]/10 border border-[#FF6D1F]/30">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{sourceLang?.flag}</span>
                      <span className="text-sm font-medium text-[var(--foreground)]">{sourceLang?.name}</span>
                    </div>
                    {lastTranslation && (
                      <button
                        onClick={() => playInLanguage(lastTranslation.sourceText, sourceLanguage, 'source')}
                        disabled={isGeneratingAudio === 'source'}
                        className={cn(
                          "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all",
                          playingLang === 'source'
                            ? "bg-green-500/20 text-green-500"
                            : "liquid-card hover:bg-white/20 text-[var(--foreground)]/70"
                        )}
                      >
                        {isGeneratingAudio === 'source' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Volume2 className={cn("w-4 h-4", playingLang === 'source' && "animate-pulse")} />
                        )}
                        {playingLang === 'source' ? 'Stop' : 'Play'}
                      </button>
                    )}
                  </div>
                  <p className="text-[var(--foreground)] text-lg leading-relaxed">
                    {currentText || lastTranslation?.sourceText}
                  </p>
                  {isRecording && (
                    <div className="flex items-center gap-2 mt-3">
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-xs text-[var(--foreground)]/50">Listening...</span>
                    </div>
                  )}
                </div>
              )}

              {/* Transcribing/Translation loading */}
              {(isTranscribing || isTranslating) && (
                <div className="liquid-card rounded-2xl p-5 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-[#FF6D1F] mr-3" />
                  <span className="text-[var(--foreground)]/60">
                    {isTranscribing ? 'Transcribing...' : 'Translating...'}
                  </span>
                </div>
              )}

              {/* Translated text */}
              {lastTranslation && !isTranslating && (
                <div className="liquid-card rounded-2xl p-5 border border-white/20">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{targetLang?.flag}</span>
                      <span className="text-sm font-medium text-[var(--foreground)]">{targetLang?.name}</span>
                    </div>
                    <button
                      onClick={() => playInLanguage(lastTranslation.translatedText, targetLanguage, 'target')}
                      disabled={isGeneratingAudio === 'target'}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all",
                        playingLang === 'target'
                          ? "bg-green-500/20 text-green-500"
                          : "liquid-button"
                      )}
                    >
                      {isGeneratingAudio === 'target' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Volume2 className={cn("w-4 h-4", playingLang === 'target' && "animate-pulse")} />
                      )}
                      {playingLang === 'target' ? 'Stop' : 'Play'}
                    </button>
                  </div>
                  <p className="text-[var(--foreground)] text-xl font-medium leading-relaxed">
                    {lastTranslation.translatedText}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-4 mb-2 p-3 rounded-xl bg-red-500/20 border border-red-500/30">
          <p className="text-red-400 text-sm text-center">{error}</p>
        </div>
      )}

      {/* Input area - text input with optional mic */}
      <div className="p-4 border-t border-white/10" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          {/* Text input */}
          <div className="flex-1 relative">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  translateText(inputText);
                }
              }}
              placeholder={`Type in ${sourceLang?.name || 'your language'}...`}
              disabled={isTranslating}
              className="w-full px-4 py-3 rounded-xl liquid-card bg-white/5 text-[var(--foreground)] placeholder-[var(--foreground)]/40 focus:outline-none focus:ring-2 focus:ring-[#FF6D1F]/50"
            />
          </div>

          {/* Send button */}
          <button
            onClick={() => translateText(inputText)}
            disabled={!inputText.trim() || isTranslating}
            className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center transition-all",
              inputText.trim() && !isTranslating
                ? "liquid-button"
                : "liquid-card opacity-50"
            )}
          >
            {isTranslating ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <ArrowRightLeft className="w-5 h-5" />
            )}
          </button>

          {/* Mic button (if supported) */}
          {recordingSupported && (
            <SimpleMicButton
              isRecording={isRecording}
              isProcessing={isTranslating || isTranscribing}
              onStart={startRecording}
              onStop={stopRecording}
            />
          )}
        </div>

        {!recordingSupported && (
          <p className="text-center text-xs text-[var(--foreground)]/40 mt-2">
            Voice input not available in this browser
          </p>
        )}
      </div>

      {/* Live Translation Modal */}
      <LiveTranslationModal
        isOpen={isLiveTranslateOpen}
        onClose={() => setIsLiveTranslateOpen(false)}
        sourceLanguage={sourceLanguage}
        targetLanguage={targetLanguage}
        voiceId={voiceId}
        onSwapLanguages={swapLanguages}
      />
    </div>
  );
}

// Simple Mic Button Component
function SimpleMicButton({
  isRecording,
  isProcessing,
  onStart,
  onStop,
}: {
  isRecording: boolean;
  isProcessing: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Use refs to avoid stale closures in event handlers
  const isRecordingRef = useRef(isRecording);
  const isProcessingRef = useRef(isProcessing);
  const onStartRef = useRef(onStart);
  const onStopRef = useRef(onStop);

  // Keep refs in sync
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(() => {
    onStartRef.current = onStart;
  }, [onStart]);

  useEffect(() => {
    onStopRef.current = onStop;
  }, [onStop]);

  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;

    const handlePointerDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      button.setPointerCapture(e.pointerId);
      if (!isProcessingRef.current && !isRecordingRef.current) {
        console.log('Mic button: pointer down, starting...');
        onStartRef.current();
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Mic button: pointer up, isRecording:', isRecordingRef.current);
      if (button.hasPointerCapture(e.pointerId)) {
        button.releasePointerCapture(e.pointerId);
      }
      // Always try to stop if we think we're recording
      if (isRecordingRef.current) {
        console.log('Mic button: stopping...');
        onStopRef.current();
      }
    };

    const handleContextMenu = (e: Event) => {
      e.preventDefault();
    };

    // Also handle click for single tap (not press-and-hold)
    const handleClick = (e: MouseEvent) => {
      e.preventDefault();
      console.log('Mic button: click detected');
    };

    button.addEventListener('pointerdown', handlePointerDown);
    button.addEventListener('pointerup', handlePointerUp);
    button.addEventListener('pointercancel', handlePointerUp);
    button.addEventListener('contextmenu', handleContextMenu);
    button.addEventListener('click', handleClick);

    return () => {
      button.removeEventListener('pointerdown', handlePointerDown);
      button.removeEventListener('pointerup', handlePointerUp);
      button.removeEventListener('pointercancel', handlePointerUp);
      button.removeEventListener('contextmenu', handleContextMenu);
      button.removeEventListener('click', handleClick);
    };
  }, []); // Empty deps - handlers use refs

  return (
    <button
      ref={buttonRef}
      disabled={isProcessing}
      className={cn(
        "w-20 h-20 rounded-full flex items-center justify-center transition-all select-none relative",
        isRecording
          ? "bg-red-500 liquid-recording"
          : isProcessing
          ? "liquid-card cursor-wait"
          : "liquid-button hover:scale-105"
      )}
      style={{ touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
    >
      {isProcessing ? (
        <Loader2 className="w-8 h-8 text-[var(--foreground)]/60 animate-spin" />
      ) : isRecording ? (
        <MicOff className="w-8 h-8 text-white relative z-10" />
      ) : (
        <Mic className="w-8 h-8 text-white" />
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
    <div className="absolute top-full left-0 mt-2 w-64 liquid-glass rounded-xl shadow-xl max-h-60 overflow-y-auto z-50 border border-white/10">
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
          <div className="flex-1 min-w-0">
            <p className="font-medium text-[var(--foreground)] truncate">{lang.name}</p>
            <p className="text-xs text-[var(--foreground)]/60 truncate">{lang.nativeName}</p>
          </div>
          {selected === lang.code && (
            <Check className="w-4 h-4 text-[#FF6D1F] flex-shrink-0" />
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

