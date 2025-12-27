'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Card } from '@/shared/components';
import { ArrowLeft, Volume2, Sparkles, Check, Mic, Square, Shuffle, Upload, Camera, Image as ImageIcon, Trash2, Play, Loader2, Brain, Lock, Crown, StopCircle } from 'lucide-react';
import { ContactCategory, AIProvider, AI_MODELS, ClonedVoice } from '@/shared/types';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useCustomContacts } from '@/contexts/CustomContactsContext';
import { getClonedVoicesKey } from '@/shared/utils/storage';
import { getModelTier } from '@/config/subscription';
import { PreMadeContactConfig } from '@/shared/types';

// Default voice options (used as fallback before API loads)
const DEFAULT_VOICE_OPTIONS = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'Female', accent: 'American', description: 'Confident and warm' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'Male', accent: 'American', description: 'Deep and confident' },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', gender: 'Male', accent: 'American', description: 'Easy going, casual' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', gender: 'Female', accent: 'American', description: 'Sunny and quirky' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', gender: 'Male', accent: 'Australian', description: 'Confident and energetic' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'Male', accent: 'British', description: 'Warm and captivating' },
];

// Voice option type
interface VoiceOption {
  id: string;
  name: string;
  gender: string;
  accent: string;
  description: string;
  previewUrl?: string;
}

// Helper to convert saved cloned voices to voice options format
const clonedVoiceToOption = (voice: { voiceId: string; name: string }) => ({
  id: voice.voiceId,
  name: voice.name,
  gender: 'custom' as const,
  accent: 'Cloned',
  description: 'Your cloned voice',
});

const EMOJI_OPTIONS = ['🤖', '🧠', '💼', '📚', '🎯', '💡', '🌟', '🎨', '🏋️', '🧘', '👨‍🍳', '🎵', '✈️', '💰', '🔬'];

const CATEGORY_OPTIONS: { value: ContactCategory; label: string; emoji: string }[] = [
  { value: 'career', label: 'Career & Business', emoji: '💼' },
  { value: 'education', label: 'Learning & Education', emoji: '📚' },
  { value: 'wellness', label: 'Health & Wellness', emoji: '🧘' },
  { value: 'productivity', label: 'Productivity', emoji: '🎯' },
  { value: 'creative', label: 'Creative', emoji: '🎨' },
  { value: 'custom', label: 'Other', emoji: '✨' },
];

type VoiceSelectionType = 'premade' | 'record' | 'random';
type AvatarType = 'emoji' | 'image';

export default function CreateContactPage() {
  return (
    <ProtectedRoute>
      <CreateContactPageContent />
    </ProtectedRoute>
  );
}

function CreateContactPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { tier, canUseVoiceCloning, canUseModel, canCreateCustomContact, showUpgradeModal, customContactsUsed, customContactsLimit } = useSubscription();
  const { getContact, addContact, updateContact } = useCustomContacts();

  // Check if editing existing contact
  const editContactId = searchParams.get('edit');
  const [isEditMode, setIsEditMode] = useState(false);

  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [personality, setPersonality] = useState('');
  const [category, setCategory] = useState<ContactCategory>('custom');

  // Voice state
  const [voiceSelectionType, setVoiceSelectionType] = useState<VoiceSelectionType>('premade');
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_OPTIONS[0].id);
  const [voiceName, setVoiceName] = useState(DEFAULT_VOICE_OPTIONS[0].name);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState<Blob | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isCloning, setIsCloning] = useState(false);
  const [clonedVoiceId, setClonedVoiceId] = useState<string | null>(null);
  const [isPlayingRecording, setIsPlayingRecording] = useState(false);
  const recordedAudioRef = useRef<HTMLAudioElement | null>(null);

  // Avatar state
  const [avatarType, setAvatarType] = useState<AvatarType>('emoji');
  const [emoji, setEmoji] = useState('🤖');
  const [avatarImage, setAvatarImage] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // AI Model state - defaults set by useEffect based on tier
  const [aiProvider, setAiProvider] = useState<AIProvider>('deepseek');
  const [aiModel, setAiModel] = useState('deepseek-chat');

  const [isCreating, setIsCreating] = useState(false);

  // Saved cloned voices
  const [savedVoices, setSavedVoices] = useState<ClonedVoice[]>([]);

  // Voice options from API
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>(DEFAULT_VOICE_OPTIONS);
  const [isLoadingVoices, setIsLoadingVoices] = useState(true);

  // Voice preview state
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Load saved voices from localStorage (user-specific)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const storageKey = getClonedVoicesKey(user?.uid || null);
        const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
        setSavedVoices(saved);
      } catch (e) {
        console.error('Error loading saved voices:', e);
      }
    }
  }, [user]);

  // Fetch voice options from API (with real preview URLs)
  useEffect(() => {
    const fetchVoices = async () => {
      try {
        const response = await fetch('/api/voices');
        if (response.ok) {
          const data = await response.json();
          if (data.voices && data.voices.length > 0) {
            setVoiceOptions(data.voices);
          }
        }
      } catch (error) {
        console.error('Error fetching voices:', error);
        // Keep default voices on error
      } finally {
        setIsLoadingVoices(false);
      }
    };

    fetchVoices();
  }, []);

  // Load contact data for editing (from context)
  useEffect(() => {
    if (editContactId) {
      const contactToEdit = getContact(editContactId);
      if (contactToEdit) {
        setIsEditMode(true);
        setName(contactToEdit.name || '');
        setPurpose(contactToEdit.purpose || '');
        setPersonality(contactToEdit.personality || '');
        setCategory(contactToEdit.category || 'custom');
        setVoiceId(contactToEdit.voiceId || DEFAULT_VOICE_OPTIONS[0].id);
        setVoiceName(contactToEdit.voiceName || DEFAULT_VOICE_OPTIONS[0].name);
        setEmoji(contactToEdit.avatarEmoji || '🤖');
        if (contactToEdit.avatarImage) {
          setAvatarImage(contactToEdit.avatarImage);
          setAvatarType('image');
        }
        if (contactToEdit.aiProvider) {
          setAiProvider(contactToEdit.aiProvider);
        }
        if (contactToEdit.aiModel) {
          setAiModel(contactToEdit.aiModel);
        }
        // Always set to premade since cloned voices are now shown in the premade list
        setVoiceSelectionType('premade');
      }
    }
  }, [editContactId, getContact]);

  // Set default model based on subscription tier (only when not editing)
  const [hasSetTierDefault, setHasSetTierDefault] = useState(false);
  useEffect(() => {
    // Only set default if not editing and haven't set it yet
    if (!editContactId && !hasSetTierDefault && tier) {
      const defaultProvider: AIProvider = tier === 'free' ? 'deepseek' : 'openai';
      const defaultModel = tier === 'free' ? 'deepseek-chat' : 'gpt-4o';
      setAiProvider(defaultProvider);
      setAiModel(defaultModel);
      setHasSetTierDefault(true);
    }
  }, [tier, editContactId, hasSetTierDefault]);

  // Get models for selected provider
  const availableModels = AI_MODELS.filter(m => m.provider === aiProvider);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedVoice = voiceOptions.find((v) => v.id === voiceId);

  // Clean up recording interval
  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
  }, []);

  // Recording error state
  const [recordingError, setRecordingError] = useState<string | null>(null);

  // Voice Recording Functions
  const startRecording = async () => {
    setRecordingError(null);
    try {
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
        setRecordingDuration(d => d + 1);
      }, 1000);
    } catch (error: any) {
      console.error('Error starting recording:', error);

      // Provide helpful error messages based on error type
      if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        setRecordingError('No microphone found. Please connect a microphone and try again.');
      } else if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setRecordingError('Microphone access denied. Please allow microphone access in your browser settings.');
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        setRecordingError('Microphone is in use by another app. Please close other apps using the microphone.');
      } else {
        setRecordingError('Could not access microphone. Please check your device settings.');
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

  const deleteRecording = () => {
    // Stop any playing audio first
    if (recordedAudioRef.current) {
      recordedAudioRef.current.pause();
      recordedAudioRef.current = null;
    }
    setIsPlayingRecording(false);
    setRecordedAudio(null);
    setRecordingDuration(0);
    setClonedVoiceId(null);
  };

  // Voice Preview Functions
  const stopPreview = useCallback(() => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    setPreviewingVoiceId(null);
    setIsLoadingPreview(false);
  }, []);

  const previewVoice = useCallback(async (voiceIdToPreview: string, voiceNameToPreview: string, previewUrl?: string) => {
    // If already previewing this voice, stop it
    if (previewingVoiceId === voiceIdToPreview) {
      stopPreview();
      return;
    }

    // Stop any current preview
    stopPreview();

    setIsLoadingPreview(true);
    setPreviewingVoiceId(voiceIdToPreview);

    try {
      // For pre-made voices with preview URL, use the direct URL (instant!)
      if (previewUrl) {
        const audio = new Audio(previewUrl);
        previewAudioRef.current = audio;

        audio.oncanplaythrough = () => {
          setIsLoadingPreview(false);
        };

        audio.onended = () => {
          setPreviewingVoiceId(null);
        };

        audio.onerror = () => {
          // Fallback to TTS API if preview URL fails
          previewVoiceWithTTS(voiceIdToPreview, voiceNameToPreview);
        };

        await audio.play();
        setIsLoadingPreview(false);
        return;
      }

      // For cloned voices, use TTS API
      await previewVoiceWithTTS(voiceIdToPreview, voiceNameToPreview);
    } catch (error) {
      console.error('Voice preview error:', error);
      setPreviewingVoiceId(null);
      setIsLoadingPreview(false);
    }
  }, [previewingVoiceId, stopPreview]);

  // Helper function for TTS-based preview (used for cloned voices or fallback)
  const previewVoiceWithTTS = useCallback(async (voiceIdToPreview: string, voiceNameToPreview: string) => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const sampleText = `Hi, I'm ${voiceNameToPreview}. This is a preview of how I sound.`;

      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          text: sampleText,
          voiceId: voiceIdToPreview,
        }),
      });

      const data = await response.json();

      if (data.audio) {
        const audioBlob = base64ToBlob(data.audio, 'audio/mpeg');
        const audioUrl = URL.createObjectURL(audioBlob);

        const audio = new Audio(audioUrl);
        previewAudioRef.current = audio;

        audio.onended = () => {
          setPreviewingVoiceId(null);
          URL.revokeObjectURL(audioUrl);
        };

        audio.onerror = () => {
          setPreviewingVoiceId(null);
          URL.revokeObjectURL(audioUrl);
        };

        setIsLoadingPreview(false);
        await audio.play();
      } else {
        // Fallback to browser TTS
        if ('speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance(`Hi, I'm ${voiceNameToPreview}. This is a preview.`);
          utterance.onend = () => setPreviewingVoiceId(null);
          utterance.onerror = () => setPreviewingVoiceId(null);
          setIsLoadingPreview(false);
          window.speechSynthesis.speak(utterance);
        } else {
          setPreviewingVoiceId(null);
          setIsLoadingPreview(false);
        }
      }
    } catch (error) {
      console.error('TTS preview error:', error);
      setPreviewingVoiceId(null);
      setIsLoadingPreview(false);
    }
  }, []);

  // Helper function to convert base64 to Blob
  const base64ToBlob = (base64: string, mimeType: string): Blob => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  };

  // Clone voice using ElevenLabs API
  const cloneVoice = async () => {
    if (!recordedAudio) return;

    setIsCloning(true);
    try {
      // Get auth token for the API call
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        alert('You must be logged in to clone a voice');
        setIsCloning(false);
        return;
      }

      const voiceName = name.trim() ? `${name}'s Voice` : `Cloned Voice ${Date.now()}`;
      const formData = new FormData();
      formData.append('name', voiceName);
      formData.append('files', recordedAudio, 'voice_sample.wav');
      formData.append('description', `Cloned voice for ${name}`);

      const response = await fetch('/api/clone-voice', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to clone voice');
      }

      const data = await response.json();
      setClonedVoiceId(data.voice_id);
      setVoiceId(data.voice_id);
      setVoiceName(voiceName);

      // Save the cloned voice to localStorage (user-specific)
      const newClonedVoice: ClonedVoice = {
        id: `cloned-${Date.now()}`,
        voiceId: data.voice_id,
        name: voiceName,
        createdAt: new Date().toISOString(),
      };
      const voicesStorageKey = getClonedVoicesKey(user?.uid || null);
      const existingVoices = JSON.parse(localStorage.getItem(voicesStorageKey) || '[]');
      existingVoices.push(newClonedVoice);
      localStorage.setItem(voicesStorageKey, JSON.stringify(existingVoices));
      setSavedVoices(existingVoices);

      // Auto-preview the newly cloned voice
      setTimeout(() => {
        previewVoice(data.voice_id, voiceName);
      }, 500);
    } catch (error) {
      console.error('Error cloning voice:', error);
      alert('Failed to clone voice. This feature requires an ElevenLabs paid plan.');
    } finally {
      setIsCloning(false);
    }
  };

  // Random voice selection
  const selectRandomVoice = () => {
    const randomIndex = Math.floor(Math.random() * voiceOptions.length);
    const randomVoice = voiceOptions[randomIndex];
    setVoiceId(randomVoice.id);
    setVoiceName(randomVoice.name);
  };

  // Delete a saved cloned voice (user-specific)
  const deleteSavedVoice = (voiceIdToDelete: string) => {
    const deletedVoice = savedVoices.find(v => v.id === voiceIdToDelete);
    const updatedVoices = savedVoices.filter(v => v.id !== voiceIdToDelete);
    const voicesStorageKey = getClonedVoicesKey(user?.uid || null);
    localStorage.setItem(voicesStorageKey, JSON.stringify(updatedVoices));
    setSavedVoices(updatedVoices);
    // Reset selection if the deleted voice was selected
    if (deletedVoice && voiceId === deletedVoice.voiceId) {
      setVoiceId(voiceOptions[0]?.id || DEFAULT_VOICE_OPTIONS[0].id);
      setVoiceName(voiceOptions[0]?.name || DEFAULT_VOICE_OPTIONS[0].name);
    }
  };

  // Image upload
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be less than 5MB');
      return;
    }

    setIsUploadingImage(true);
    try {
      // Create a preview immediately
      const reader = new FileReader();
      reader.onload = (e) => {
        setAvatarImage(e.target?.result as string);
      };
      reader.readAsDataURL(file);

      // Upload to Firebase Storage if user is logged in
      if (user) {
        const storageRef = ref(storage, `avatars/${user.uid}/${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(storageRef);
        setAvatarImage(downloadURL);
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      // Keep the local preview even if upload fails
    } finally {
      setIsUploadingImage(false);
    }
  };

  const deleteAvatarImage = () => {
    setAvatarImage(null);
    setAvatarType('emoji');
  };

  const handleCreate = async () => {
    // Check if user can create a new contact (only for new contacts, not edits)
    if (!isEditMode && !canCreateCustomContact) {
      showUpgradeModal('custom-contacts');
      return;
    }

    setIsCreating(true);

    // Determine final voice ID
    let finalVoiceId = voiceId;
    let finalVoiceName = voiceName;

    if (voiceSelectionType === 'random') {
      const randomIndex = Math.floor(Math.random() * voiceOptions.length);
      finalVoiceId = voiceOptions[randomIndex].id;
      finalVoiceName = voiceOptions[randomIndex].name;
    } else if (voiceSelectionType === 'record' && clonedVoiceId) {
      finalVoiceId = clonedVoiceId;
      finalVoiceName = `${name}'s Voice`;
    }

    // Generate system prompt based on inputs
    const systemPrompt = `You are ${name}, a helpful AI assistant. Your purpose is: ${purpose}.

Your personality: ${personality}

Guidelines:
- Stay in character at all times
- Be helpful and conversational
- Keep responses concise (2-3 sentences) unless more detail is needed
- Remember the context of the conversation`;

    // Get existing contact for createdAt preservation
    const existingContact = isEditMode && editContactId ? getContact(editContactId) : null;

    const contactData: PreMadeContactConfig = {
      id: isEditMode && editContactId ? editContactId : `custom-${Date.now()}`,
      name,
      purpose,
      personality,
      systemPrompt,
      voiceId: finalVoiceId,
      voiceName: finalVoiceName,
      avatarEmoji: emoji, // Always include emoji as fallback
      avatarImage: avatarType === 'image' ? avatarImage || undefined : undefined,
      category,
      isPreMade: false,
      gradient: 'from-violet-500 to-indigo-600',
      aiProvider,
      aiModel,
      createdAt: isEditMode && existingContact?.createdAt ? existingContact.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Use context methods for cloud-synced storage
    if (isEditMode && editContactId) {
      updateContact(editContactId, contactData);
    } else {
      addContact(contactData);
    }

    // Small delay to ensure sync before navigation
    await new Promise(resolve => setTimeout(resolve, 100));

    // Navigate to app with contact selected
    router.push(`/app?contact=${contactData.id}`);
  };

  const canProceed = () => {
    switch (step) {
      case 1:
        return name.trim().length >= 2 && purpose.trim().length >= 5;
      case 2:
        return personality.trim().length >= 10;
      case 3:
        const hasVoice = voiceSelectionType === 'premade' || voiceSelectionType === 'random' || (voiceSelectionType === 'record' && (clonedVoiceId || recordedAudio));
        const hasAvatar = avatarType === 'emoji' || (avatarType === 'image' && avatarImage);
        return hasVoice && hasAvatar;
      default:
        return false;
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-full overflow-auto relative" style={{ minHeight: '100dvh' }}>
      {/* Animated gradient background */}
      <div className="glass-background" />

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50">
        <div className="mx-4 mt-4">
          <div className="max-w-2xl mx-auto glass rounded-2xl px-6 py-4 flex items-center gap-4">
            <Link
              href="/app"
              className="w-10 h-10 rounded-full glass-light flex items-center justify-center hover:opacity-80 transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-[var(--foreground)]" />
            </Link>
            <div>
              <h1 className="font-bold text-[var(--foreground)]">{isEditMode ? 'Edit AI Contact' : 'Create AI Contact'}</h1>
              <p className="text-sm text-[var(--foreground)]/60">Step {step} of 3</p>
            </div>
          </div>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="max-w-2xl mx-auto px-6 pt-28 relative z-10">
        <div className="flex gap-2">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-2 flex-1 rounded-full transition-colors ${
                s <= step ? 'bg-[#FF6D1F] shadow-lg shadow-[#FF6D1F]/30' : 'glass-light'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Form */}
      <main className="max-w-2xl mx-auto px-6 py-8 relative z-10">
        {/* Step 1: Basic Info */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-[var(--foreground)] mb-2">
                Who is your AI contact?
              </h2>
              <p className="text-[var(--foreground)]/70">
                Give your AI a name and define what they&apos;ll help you with.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Alex, Coach Smith, Professor Oak"
                  className="w-full px-4 py-3 glass-input rounded-2xl focus:outline-none text-[var(--foreground)]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
                  Purpose / Role
                </label>
                <input
                  type="text"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="e.g., Interview Coach, Spanish Tutor, Fitness Trainer"
                  className="w-full px-4 py-3 glass-input rounded-2xl focus:outline-none text-[var(--foreground)]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
                  Category
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORY_OPTIONS.map((cat) => (
                    <button
                      key={cat.value}
                      onClick={() => setCategory(cat.value)}
                      className={`flex items-center gap-2 px-4 py-3 rounded-2xl border transition-colors ${
                        category === cat.value
                          ? 'border-[#FF6D1F] bg-[#FF6D1F]/10 text-[var(--foreground)]'
                          : 'glass-light text-[var(--foreground)]/70 hover:bg-white/30'
                      }`}
                    >
                      <span>{cat.emoji}</span>
                      <span className="text-sm font-medium">{cat.label}</span>
                      {category === cat.value && (
                        <Check className="w-4 h-4 ml-auto text-[#FF6D1F]" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Personality */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-[var(--foreground)] mb-2">
                Define the personality
              </h2>
              <p className="text-[var(--foreground)]/70">
                Describe how {name} should behave and communicate.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
                Personality & Communication Style
              </label>
              <textarea
                value={personality}
                onChange={(e) => setPersonality(e.target.value)}
                placeholder={`Example: ${name} is patient and encouraging. They explain complex topics simply and always celebrate small wins. They use analogies to help understand difficult concepts and ask follow-up questions to ensure understanding.`}
                rows={6}
                className="w-full px-4 py-3 glass-input rounded-2xl focus:outline-none text-[var(--foreground)] resize-none"
              />
              <p className="text-sm text-[var(--foreground)]/60 mt-2">
                Tip: Be specific! Include communication style, tone, and any special behaviors.
              </p>
            </div>

            {/* Quick personality templates */}
            <div>
              <p className="text-sm font-medium text-[var(--foreground)] mb-2">Quick templates:</p>
              <div className="flex flex-wrap gap-2">
                {[
                  'Patient and encouraging teacher',
                  'Direct and no-nonsense coach',
                  'Warm and empathetic listener',
                  'Energetic and enthusiastic motivator',
                ].map((template) => (
                  <button
                    key={template}
                    onClick={() => setPersonality(template + '. ' + personality)}
                    className="px-3 py-1.5 glass-light text-[var(--foreground)] text-sm rounded-full hover:bg-white/30 transition-colors"
                  >
                    + {template}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Voice & Avatar */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-[var(--foreground)] mb-2">
                Choose voice & appearance
              </h2>
              <p className="text-[var(--foreground)]/70">
                Select a voice and avatar for {name}.
              </p>
            </div>

            {/* Voice Selection Type */}
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-3">
                Voice Option
              </label>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <button
                  onClick={() => setVoiceSelectionType('premade')}
                  className={`flex flex-col items-center gap-2 px-2 py-3 rounded-2xl border transition-colors ${
                    voiceSelectionType === 'premade'
                      ? 'border-[#FF6D1F] bg-[#FF6D1F]/10'
                      : 'glass-light hover:bg-white/30'
                  }`}
                >
                  <Volume2 className="w-5 h-5 text-[#FF6D1F]" />
                  <span className="text-xs font-medium text-[var(--foreground)]">Select Voice</span>
                </button>
                <button
                  onClick={() => {
                    if (!canUseVoiceCloning) {
                      showUpgradeModal('voice-cloning');
                      return;
                    }
                    setVoiceSelectionType('record');
                  }}
                  className={`flex flex-col items-center gap-2 px-2 py-3 rounded-2xl border transition-colors relative ${
                    voiceSelectionType === 'record'
                      ? 'border-[#FF6D1F] bg-[#FF6D1F]/10'
                      : 'glass-light hover:bg-white/30'
                  } ${!canUseVoiceCloning ? 'opacity-70' : ''}`}
                >
                  {!canUseVoiceCloning && (
                    <div className="absolute -top-1 -right-1 bg-[#FF6D1F] rounded-full p-0.5">
                      <Crown className="w-3 h-3 text-white" />
                    </div>
                  )}
                  <Mic className="w-5 h-5 text-[#FF6D1F]" />
                  <span className="text-xs font-medium text-[var(--foreground)]">Clone New</span>
                </button>
                <button
                  onClick={() => {
                    setVoiceSelectionType('random');
                    selectRandomVoice();
                  }}
                  className={`flex flex-col items-center gap-2 px-2 py-3 rounded-2xl border transition-colors ${
                    voiceSelectionType === 'random'
                      ? 'border-[#FF6D1F] bg-[#FF6D1F]/10'
                      : 'glass-light hover:bg-white/30'
                  }`}
                >
                  <Shuffle className="w-5 h-5 text-[#FF6D1F]" />
                  <span className="text-xs font-medium text-[var(--foreground)]">Random</span>
                </button>
              </div>

              {/* Pre-made Voice Selection */}
              {voiceSelectionType === 'premade' && (
                <div className="grid gap-2 max-h-64 overflow-y-auto">
                  {/* Saved cloned voices first */}
                  {savedVoices.length > 0 && (
                    <>
                      <p className="text-xs font-medium text-[var(--foreground)]/60 px-1">Your Cloned Voices</p>
                      {savedVoices.map((voice) => (
                        <div
                          key={voice.id}
                          className={`flex items-center gap-4 px-4 py-3 rounded-2xl border transition-colors ${
                            voiceId === voice.voiceId
                              ? 'border-[#FF6D1F] bg-[#FF6D1F]/10'
                              : 'glass-light hover:bg-white/30'
                          }`}
                        >
                          <button
                            onClick={() => {
                              setVoiceId(voice.voiceId);
                              setVoiceName(voice.name);
                            }}
                            className="flex items-center gap-4 flex-1"
                          >
                            <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                              <Mic className="w-5 h-5 text-white" />
                            </div>
                            <div className="flex-1 text-left">
                              <p className="font-medium text-[var(--foreground)]">{voice.name}</p>
                              <p className="text-sm text-[var(--foreground)]/60">
                                Cloned • Your voice
                              </p>
                            </div>
                          </button>
                          {/* Preview button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              previewVoice(voice.voiceId, voice.name);
                            }}
                            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                              previewingVoiceId === voice.voiceId
                                ? 'bg-green-500 text-white'
                                : 'bg-[var(--foreground)]/10 hover:bg-[var(--foreground)]/20 text-[var(--foreground)]'
                            }`}
                            title="Preview voice"
                          >
                            {isLoadingPreview && previewingVoiceId === voice.voiceId ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : previewingVoiceId === voice.voiceId ? (
                              <StopCircle className="w-4 h-4" />
                            ) : (
                              <Play className="w-4 h-4" />
                            )}
                          </button>
                          {voiceId === voice.voiceId && (
                            <Check className="w-5 h-5 text-[#FF6D1F]" />
                          )}
                        </div>
                      ))}
                      <p className="text-xs font-medium text-[var(--foreground)]/60 px-1 mt-2">Pre-made Voices</p>
                    </>
                  )}
                  {voiceOptions.map((voice) => (
                    <div
                      key={voice.id}
                      className={`flex items-center gap-4 px-4 py-3 rounded-2xl border transition-colors ${
                        voiceId === voice.id
                          ? 'border-[#FF6D1F] bg-[#FF6D1F]/10'
                          : 'glass-light hover:bg-white/30'
                      }`}
                    >
                      <button
                        onClick={() => {
                          setVoiceId(voice.id);
                          setVoiceName(voice.name);
                        }}
                        className="flex items-center gap-4 flex-1"
                      >
                        <div className="w-10 h-10 rounded-full bg-[#FF6D1F] flex items-center justify-center">
                          <Volume2 className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1 text-left">
                          <p className="font-medium text-[var(--foreground)]">{voice.name}</p>
                          <p className="text-sm text-[var(--foreground)]/60">
                            {voice.gender} • {voice.accent} • {voice.description}
                          </p>
                        </div>
                      </button>
                      {/* Preview button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          previewVoice(voice.id, voice.name, voice.previewUrl);
                        }}
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                          previewingVoiceId === voice.id
                            ? 'bg-green-500 text-white'
                            : 'bg-[var(--foreground)]/10 hover:bg-[var(--foreground)]/20 text-[var(--foreground)]'
                        }`}
                        title="Preview voice"
                      >
                        {isLoadingPreview && previewingVoiceId === voice.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : previewingVoiceId === voice.id ? (
                          <StopCircle className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </button>
                      {voiceId === voice.id && (
                        <Check className="w-5 h-5 text-[#FF6D1F]" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Voice Recording (Clone) */}
              {voiceSelectionType === 'record' && (
                <div className="space-y-4">
                  <div className="glass-light rounded-2xl p-4">
                    <p className="text-sm text-[var(--foreground)]/70 mb-3">
                      Read the following text aloud to clone your voice. Speak naturally in a quiet environment.
                    </p>

                    {/* Sample text to read */}
                    <div className="bg-[var(--foreground)]/5 rounded-xl p-4 mb-4 border border-[var(--foreground)]/10">
                      <p className="text-sm text-[var(--foreground)]/80 leading-relaxed italic">
                        &quot;The quick brown fox jumps over the lazy dog, while a clever zebra gazes quietly across the field. Small waves ripple under the bright evening sky, and mixed voices echo through the open air. Every unique sound shapes the way we speak, from sharp consonants to warm vowels. As you read this passage, try to keep a steady pace and clear tone so the system can capture your natural voice.&quot;
                      </p>
                    </div>

                    {!recordedAudio ? (
                      <div className="flex flex-col items-center gap-4">
                        <button
                          onClick={isRecording ? stopRecording : startRecording}
                          className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                            isRecording
                              ? 'bg-red-500 animate-pulse'
                              : 'bg-[#FF6D1F] hover:bg-[#e5621b]'
                          }`}
                        >
                          {isRecording ? (
                            <Square className="w-8 h-8 text-white" />
                          ) : (
                            <Mic className="w-8 h-8 text-white" />
                          )}
                        </button>
                        {isRecording && (
                          <p className="text-lg font-mono text-[var(--foreground)]">
                            {formatDuration(recordingDuration)}
                          </p>
                        )}
                        <p className="text-sm text-[var(--foreground)]/60">
                          {isRecording ? 'Recording... Click to stop' : 'Click to start recording'}
                        </p>
                        {recordingError && (
                          <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                            <p className="text-sm text-red-500 text-center">{recordingError}</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center gap-4">
                          <button
                            onClick={playRecordedAudio}
                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                              isPlayingRecording
                                ? 'bg-green-500 hover:bg-green-600 animate-pulse'
                                : 'bg-[#FF6D1F] hover:bg-[#e5621b]'
                            }`}
                          >
                            {isPlayingRecording ? (
                              <StopCircle className="w-6 h-6 text-white" />
                            ) : (
                              <Play className="w-6 h-6 text-white" />
                            )}
                          </button>
                          <div className="flex-1">
                            <p className="font-medium text-[var(--foreground)]">
                              {isPlayingRecording ? 'Playing...' : 'Recording Complete'}
                            </p>
                            <p className="text-sm text-[var(--foreground)]/60">
                              Duration: {formatDuration(recordingDuration)}
                            </p>
                          </div>
                          <button
                            onClick={deleteRecording}
                            className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center hover:bg-red-500/20"
                          >
                            <Trash2 className="w-5 h-5 text-red-500" />
                          </button>
                        </div>

                        {!clonedVoiceId && (
                          <Button
                            onClick={cloneVoice}
                            disabled={isCloning}
                            isLoading={isCloning}
                            className="w-full"
                          >
                            {isCloning ? 'Cloning Voice...' : 'Clone This Voice'}
                          </Button>
                        )}

                        {clonedVoiceId && (
                          <div className="flex items-center gap-2 text-green-500">
                            <Check className="w-5 h-5" />
                            <span>Voice cloned successfully!</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-[var(--foreground)]/50">
                    Note: Voice cloning requires an ElevenLabs paid plan. You must have consent to clone someone&apos;s voice.
                  </p>
                </div>
              )}

              {/* Random Voice */}
              {voiceSelectionType === 'random' && (
                <div className="glass-light rounded-2xl p-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-[#FF6D1F] flex items-center justify-center">
                      <Shuffle className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-[var(--foreground)]">Random Voice Selected</p>
                      <p className="text-sm text-[var(--foreground)]/60">
                        Current: {voiceName}
                      </p>
                    </div>
                    <button
                      onClick={selectRandomVoice}
                      className="px-4 py-2 bg-[#FF6D1F] text-white rounded-xl hover:bg-[#e5621b]"
                    >
                      Shuffle
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Avatar Selection */}
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-3">
                Avatar
              </label>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <button
                  onClick={() => setAvatarType('emoji')}
                  className={`flex flex-col items-center gap-2 px-4 py-3 rounded-2xl border transition-colors ${
                    avatarType === 'emoji'
                      ? 'border-[#FF6D1F] bg-[#FF6D1F]/10'
                      : 'glass-light hover:bg-white/30'
                  }`}
                >
                  <span className="text-2xl">😊</span>
                  <span className="text-sm font-medium text-[var(--foreground)]">Emoji</span>
                </button>
                <button
                  onClick={() => setAvatarType('image')}
                  className={`flex flex-col items-center gap-2 px-4 py-3 rounded-2xl border transition-colors ${
                    avatarType === 'image'
                      ? 'border-[#FF6D1F] bg-[#FF6D1F]/10'
                      : 'glass-light hover:bg-white/30'
                  }`}
                >
                  <ImageIcon className="w-6 h-6 text-[#FF6D1F]" />
                  <span className="text-sm font-medium text-[var(--foreground)]">Upload Image</span>
                </button>
              </div>

              {/* Emoji Selection */}
              {avatarType === 'emoji' && (
                <div className="flex flex-wrap gap-2">
                  {EMOJI_OPTIONS.map((e) => (
                    <button
                      key={e}
                      onClick={() => setEmoji(e)}
                      className={`w-12 h-12 text-2xl rounded-xl border transition-all ${
                        emoji === e
                          ? 'border-[#FF6D1F] bg-[#FF6D1F]/10 scale-110'
                          : 'glass-light hover:bg-white/30'
                      }`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}

              {/* Image Upload */}
              {avatarType === 'image' && (
                <div className="space-y-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />

                  {!avatarImage ? (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploadingImage}
                      className="w-full h-32 border-2 border-dashed border-[var(--foreground)]/20 rounded-2xl flex flex-col items-center justify-center gap-2 hover:border-[#FF6D1F] transition-colors"
                    >
                      {isUploadingImage ? (
                        <Loader2 className="w-8 h-8 text-[#FF6D1F] animate-spin" />
                      ) : (
                        <>
                          <Upload className="w-8 h-8 text-[var(--foreground)]/40" />
                          <span className="text-sm text-[var(--foreground)]/60">Click to upload image</span>
                          <span className="text-xs text-[var(--foreground)]/40">PNG, JPG up to 5MB</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="relative w-32 h-32 mx-auto">
                      <img
                        src={avatarImage}
                        alt="Avatar preview"
                        className="w-full h-full object-cover rounded-full border-4 border-[#FF6D1F]"
                      />
                      <button
                        onClick={deleteAvatarImage}
                        className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600"
                      >
                        <Trash2 className="w-4 h-4 text-white" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* AI Model Selection */}
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-3">
                <Brain className="w-4 h-4 inline mr-2" />
                AI Model
              </label>

              {/* Provider Selection */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                {(['gemini', 'claude', 'openai', 'deepseek'] as AIProvider[]).map((provider) => (
                  <button
                    key={provider}
                    onClick={() => {
                      setAiProvider(provider);
                      // Set default model for the provider
                      const defaultModel = AI_MODELS.find(m => m.provider === provider);
                      if (defaultModel) setAiModel(defaultModel.model);
                    }}
                    className={`flex flex-col items-center gap-1 px-2 py-3 rounded-xl border transition-colors ${
                      aiProvider === provider
                        ? 'border-[#FF6D1F] bg-[#FF6D1F]/10'
                        : 'glass-light hover:bg-white/30'
                    }`}
                  >
                    <span className="text-lg">
                      {provider === 'gemini' && '✨'}
                      {provider === 'claude' && '🟠'}
                      {provider === 'openai' && '🟢'}
                      {provider === 'deepseek' && '🔵'}
                    </span>
                    <span className="text-xs font-medium text-[var(--foreground)] capitalize">{provider}</span>
                  </button>
                ))}
              </div>

              {/* Model Selection */}
              <div className="space-y-2">
                {availableModels.map((model) => {
                  const isLocked = !canUseModel(model.model);
                  const modelTier = getModelTier(model.model);
                  return (
                    <button
                      key={model.model}
                      onClick={() => {
                        if (isLocked) {
                          showUpgradeModal('advanced-models');
                          return;
                        }
                        setAiModel(model.model);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                        aiModel === model.model
                          ? 'border-[#FF6D1F] bg-[#FF6D1F]/10'
                          : 'glass-light hover:bg-white/30'
                      } ${isLocked ? 'opacity-60' : ''}`}
                    >
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-[var(--foreground)]">{model.name}</p>
                          {isLocked && modelTier && (
                            <span className="text-xs px-2 py-0.5 bg-[#FF6D1F]/20 text-[#FF6D1F] rounded-full flex items-center gap-1">
                              <Crown className="w-3 h-3" />
                              {modelTier === 'max' ? 'Max' : 'Pro'}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-[var(--foreground)]/60">{model.description}</p>
                      </div>
                      {aiModel === model.model && !isLocked && (
                        <Check className="w-5 h-5 text-[#FF6D1F]" />
                      )}
                      {isLocked && (
                        <Lock className="w-5 h-5 text-[var(--foreground)]/40" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preview */}
            <Card className="glass-light">
              <div className="flex items-center gap-4">
                {avatarType === 'emoji' || !avatarImage ? (
                  <div className="w-16 h-16 rounded-full bg-[#FF6D1F] flex items-center justify-center text-3xl">
                    {emoji}
                  </div>
                ) : (
                  <img
                    src={avatarImage}
                    alt="Avatar"
                    className="w-16 h-16 rounded-full object-cover border-2 border-[#FF6D1F]"
                  />
                )}
                <div>
                  <h3 className="font-bold text-[var(--foreground)]">{name || 'Your Contact'}</h3>
                  <p className="text-[#FF6D1F] font-medium">{purpose || 'Purpose'}</p>
                  <p className="text-sm text-[var(--foreground)]/60">
                    Voice: {voiceSelectionType === 'record' && clonedVoiceId ? `${name}'s Voice` : voiceName}
                  </p>
                  <p className="text-sm text-[var(--foreground)]/60">
                    AI: {AI_MODELS.find(m => m.model === aiModel)?.name || aiModel}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="flex gap-4 mt-8">
          {step > 1 && (
            <Button
              variant="secondary"
              onClick={() => setStep(step - 1)}
              className="flex-1"
            >
              Back
            </Button>
          )}

          {step < 3 ? (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed()}
              className="flex-1"
            >
              Continue
            </Button>
          ) : (
            <Button
              onClick={handleCreate}
              disabled={!canProceed() || isCreating}
              isLoading={isCreating}
              className="flex-1"
            >
              <Sparkles className="w-5 h-5 mr-2" />
              {isEditMode ? `Save ${name}` : `Create ${name}`}
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
