'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Card } from '@/shared/components';
import { ArrowLeft, Volume2, Sparkles, Check, Mic, Square, Shuffle, Upload, Camera, Image as ImageIcon, Trash2, Play, Loader2, Brain } from 'lucide-react';
import { ContactCategory, AIProvider, AI_MODELS, ClonedVoice } from '@/shared/types';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';

// Pre-made voice options from ElevenLabs
const VOICE_OPTIONS = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Rachel', gender: 'female', accent: 'American', description: 'Warm and professional' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male', accent: 'American', description: 'Deep and authoritative' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', gender: 'male', accent: 'American', description: 'Friendly and casual' },
  { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', gender: 'female', accent: 'British', description: 'Calm and soothing' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', gender: 'female', accent: 'American', description: 'Energetic and enthusiastic' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Bella', gender: 'female', accent: 'American', description: 'Soft and gentle' },
];

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
  const [voiceId, setVoiceId] = useState(VOICE_OPTIONS[0].id);
  const [voiceName, setVoiceName] = useState(VOICE_OPTIONS[0].name);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState<Blob | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isCloning, setIsCloning] = useState(false);
  const [clonedVoiceId, setClonedVoiceId] = useState<string | null>(null);

  // Avatar state
  const [avatarType, setAvatarType] = useState<AvatarType>('emoji');
  const [emoji, setEmoji] = useState('🤖');
  const [avatarImage, setAvatarImage] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // AI Model state
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');
  const [aiModel, setAiModel] = useState('gemini-2.0-flash');

  const [isCreating, setIsCreating] = useState(false);

  // Saved cloned voices
  const [savedVoices, setSavedVoices] = useState<ClonedVoice[]>([]);

  // Load saved voices from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = JSON.parse(localStorage.getItem('clonedVoices') || '[]');
        setSavedVoices(saved);
      } catch (e) {
        console.error('Error loading saved voices:', e);
      }
    }
  }, []);

  // Load contact data for editing
  useEffect(() => {
    if (editContactId && typeof window !== 'undefined') {
      try {
        const contacts = JSON.parse(localStorage.getItem('customContacts') || '[]');
        const contactToEdit = contacts.find((c: { id: string }) => c.id === editContactId);
        if (contactToEdit) {
          setIsEditMode(true);
          setName(contactToEdit.name || '');
          setPurpose(contactToEdit.purpose || '');
          setPersonality(contactToEdit.personality || '');
          setCategory(contactToEdit.category || 'custom');
          setVoiceId(contactToEdit.voiceId || VOICE_OPTIONS[0].id);
          setVoiceName(contactToEdit.voiceName || VOICE_OPTIONS[0].name);
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
      } catch (e) {
        console.error('Error loading contact for editing:', e);
      }
    }
  }, [editContactId]);

  // Get models for selected provider
  const availableModels = AI_MODELS.filter(m => m.provider === aiProvider);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedVoice = VOICE_OPTIONS.find((v) => v.id === voiceId);

  // Clean up recording interval
  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
  }, []);

  // Voice Recording Functions
  const startRecording = async () => {
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
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not access microphone. Please allow microphone access.');
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
    if (recordedAudio) {
      const audio = new Audio(URL.createObjectURL(recordedAudio));
      audio.play();
    }
  };

  const deleteRecording = () => {
    setRecordedAudio(null);
    setRecordingDuration(0);
    setClonedVoiceId(null);
  };

  // Clone voice using ElevenLabs API
  const cloneVoice = async () => {
    if (!recordedAudio) return;

    setIsCloning(true);
    try {
      const voiceName = name.trim() ? `${name}'s Voice` : `Cloned Voice ${Date.now()}`;
      const formData = new FormData();
      formData.append('name', voiceName);
      formData.append('files', recordedAudio, 'voice_sample.wav');
      formData.append('description', `Cloned voice for ${name}`);

      const response = await fetch('/api/clone-voice', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to clone voice');
      }

      const data = await response.json();
      setClonedVoiceId(data.voice_id);
      setVoiceId(data.voice_id);
      setVoiceName(voiceName);

      // Save the cloned voice to localStorage
      const newClonedVoice: ClonedVoice = {
        id: `cloned-${Date.now()}`,
        voiceId: data.voice_id,
        name: voiceName,
        createdAt: new Date().toISOString(),
      };
      const existingVoices = JSON.parse(localStorage.getItem('clonedVoices') || '[]');
      existingVoices.push(newClonedVoice);
      localStorage.setItem('clonedVoices', JSON.stringify(existingVoices));
      setSavedVoices(existingVoices);

      alert('Voice cloned and saved successfully!');
    } catch (error) {
      console.error('Error cloning voice:', error);
      alert('Failed to clone voice. This feature requires an ElevenLabs paid plan.');
    } finally {
      setIsCloning(false);
    }
  };

  // Random voice selection
  const selectRandomVoice = () => {
    const randomIndex = Math.floor(Math.random() * VOICE_OPTIONS.length);
    const randomVoice = VOICE_OPTIONS[randomIndex];
    setVoiceId(randomVoice.id);
    setVoiceName(randomVoice.name);
  };

  // Delete a saved cloned voice
  const deleteSavedVoice = (voiceIdToDelete: string) => {
    const deletedVoice = savedVoices.find(v => v.id === voiceIdToDelete);
    const updatedVoices = savedVoices.filter(v => v.id !== voiceIdToDelete);
    localStorage.setItem('clonedVoices', JSON.stringify(updatedVoices));
    setSavedVoices(updatedVoices);
    // Reset selection if the deleted voice was selected
    if (deletedVoice && voiceId === deletedVoice.voiceId) {
      setVoiceId(VOICE_OPTIONS[0].id);
      setVoiceName(VOICE_OPTIONS[0].name);
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
    setIsCreating(true);

    // Determine final voice ID
    let finalVoiceId = voiceId;
    let finalVoiceName = voiceName;

    if (voiceSelectionType === 'random') {
      const randomIndex = Math.floor(Math.random() * VOICE_OPTIONS.length);
      finalVoiceId = VOICE_OPTIONS[randomIndex].id;
      finalVoiceName = VOICE_OPTIONS[randomIndex].name;
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

    // For now, store in localStorage (replace with Firestore)
    const contactData = {
      id: isEditMode && editContactId ? editContactId : `custom-${Date.now()}`,
      name,
      purpose,
      personality,
      systemPrompt,
      voiceId: finalVoiceId,
      voiceName: finalVoiceName,
      avatarEmoji: avatarType === 'emoji' ? emoji : undefined,
      avatarImage: avatarType === 'image' ? avatarImage : undefined,
      category,
      isPreMade: false,
      gradient: 'from-violet-500 to-indigo-600',
      aiProvider,
      aiModel,
      createdAt: isEditMode ? undefined : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Store in localStorage
    const existingContacts = JSON.parse(localStorage.getItem('customContacts') || '[]');

    if (isEditMode && editContactId) {
      // Update existing contact
      const contactIndex = existingContacts.findIndex((c: { id: string }) => c.id === editContactId);
      if (contactIndex !== -1) {
        // Preserve original createdAt
        contactData.createdAt = existingContacts[contactIndex].createdAt;
        existingContacts[contactIndex] = contactData;
      }
    } else {
      // Add new contact
      existingContacts.push(contactData);
    }

    localStorage.setItem('customContacts', JSON.stringify(existingContacts));

    // Small delay to ensure localStorage is synced before navigation
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
    <div className="min-h-full bg-[var(--background)] overflow-auto" style={{ minHeight: '100dvh' }}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[var(--background)] border-b border-[var(--foreground)]/10">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link
            href="/app"
            className="w-10 h-10 rounded-full bg-[var(--color-beige)] flex items-center justify-center hover:opacity-80 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-[var(--foreground)]" />
          </Link>
          <div>
            <h1 className="font-bold text-[var(--foreground)]">{isEditMode ? 'Edit AI Contact' : 'Create AI Contact'}</h1>
            <p className="text-sm text-[var(--foreground)]/60">Step {step} of 3</p>
          </div>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="max-w-2xl mx-auto px-6 pt-4">
        <div className="flex gap-2">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-2 flex-1 rounded-full transition-colors ${
                s <= step ? 'bg-[#FF6D1F]' : 'bg-[var(--color-beige)]'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Form */}
      <main className="max-w-2xl mx-auto px-6 py-8">
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
                  className="w-full px-4 py-3 bg-[var(--color-beige)] border border-[var(--foreground)]/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#FF6D1F] text-[var(--foreground)]"
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
                  className="w-full px-4 py-3 bg-[var(--color-beige)] border border-[var(--foreground)]/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#FF6D1F] text-[var(--foreground)]"
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
                          : 'border-[var(--foreground)]/10 bg-[var(--color-beige)] text-[var(--foreground)]/70 hover:border-[var(--foreground)]/20'
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
                className="w-full px-4 py-3 bg-[var(--color-beige)] border border-[var(--foreground)]/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#FF6D1F] text-[var(--foreground)] resize-none"
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
                    className="px-3 py-1.5 bg-[var(--color-beige)] text-[var(--foreground)] text-sm rounded-full hover:opacity-80 transition-colors"
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
                      : 'border-[var(--foreground)]/10 bg-[var(--color-beige)] hover:border-[var(--foreground)]/20'
                  }`}
                >
                  <Volume2 className="w-5 h-5 text-[#FF6D1F]" />
                  <span className="text-xs font-medium text-[var(--foreground)]">Select Voice</span>
                </button>
                <button
                  onClick={() => setVoiceSelectionType('record')}
                  className={`flex flex-col items-center gap-2 px-2 py-3 rounded-2xl border transition-colors ${
                    voiceSelectionType === 'record'
                      ? 'border-[#FF6D1F] bg-[#FF6D1F]/10'
                      : 'border-[var(--foreground)]/10 bg-[var(--color-beige)] hover:border-[var(--foreground)]/20'
                  }`}
                >
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
                      : 'border-[var(--foreground)]/10 bg-[var(--color-beige)] hover:border-[var(--foreground)]/20'
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
                        <button
                          key={voice.id}
                          onClick={() => {
                            setVoiceId(voice.voiceId);
                            setVoiceName(voice.name);
                          }}
                          className={`flex items-center gap-4 px-4 py-3 rounded-2xl border transition-colors ${
                            voiceId === voice.voiceId
                              ? 'border-[#FF6D1F] bg-[#FF6D1F]/10'
                              : 'border-[var(--foreground)]/10 bg-[var(--color-beige)] hover:border-[var(--foreground)]/20'
                          }`}
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
                          {voiceId === voice.voiceId && (
                            <Check className="w-5 h-5 text-[#FF6D1F]" />
                          )}
                        </button>
                      ))}
                      <p className="text-xs font-medium text-[var(--foreground)]/60 px-1 mt-2">Pre-made Voices</p>
                    </>
                  )}
                  {VOICE_OPTIONS.map((voice) => (
                    <button
                      key={voice.id}
                      onClick={() => {
                        setVoiceId(voice.id);
                        setVoiceName(voice.name);
                      }}
                      className={`flex items-center gap-4 px-4 py-3 rounded-2xl border transition-colors ${
                        voiceId === voice.id
                          ? 'border-[#FF6D1F] bg-[#FF6D1F]/10'
                          : 'border-[var(--foreground)]/10 bg-[var(--color-beige)] hover:border-[var(--foreground)]/20'
                      }`}
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
                      {voiceId === voice.id && (
                        <Check className="w-5 h-5 text-[#FF6D1F]" />
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Voice Recording (Clone) */}
              {voiceSelectionType === 'record' && (
                <div className="space-y-4">
                  <div className="bg-[var(--color-beige)] rounded-2xl p-4 border border-[var(--foreground)]/10">
                    <p className="text-sm text-[var(--foreground)]/70 mb-4">
                      Record at least 30 seconds of clear speech to clone a voice. Speak naturally in a quiet environment.
                    </p>

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
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center gap-4">
                          <button
                            onClick={playRecordedAudio}
                            className="w-12 h-12 rounded-full bg-[#FF6D1F] flex items-center justify-center hover:bg-[#e5621b]"
                          >
                            <Play className="w-6 h-6 text-white" />
                          </button>
                          <div className="flex-1">
                            <p className="font-medium text-[var(--foreground)]">Recording Complete</p>
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
                <div className="bg-[var(--color-beige)] rounded-2xl p-4 border border-[var(--foreground)]/10">
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
                      : 'border-[var(--foreground)]/10 bg-[var(--color-beige)] hover:border-[var(--foreground)]/20'
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
                      : 'border-[var(--foreground)]/10 bg-[var(--color-beige)] hover:border-[var(--foreground)]/20'
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
                          : 'border-[var(--foreground)]/10 bg-[var(--color-beige)] hover:border-[var(--foreground)]/20'
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
                        : 'border-[var(--foreground)]/10 bg-[var(--color-beige)] hover:border-[var(--foreground)]/20'
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
                {availableModels.map((model) => (
                  <button
                    key={model.model}
                    onClick={() => setAiModel(model.model)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                      aiModel === model.model
                        ? 'border-[#FF6D1F] bg-[#FF6D1F]/10'
                        : 'border-[var(--foreground)]/10 bg-[var(--color-beige)] hover:border-[var(--foreground)]/20'
                    }`}
                  >
                    <div className="flex-1 text-left">
                      <p className="font-medium text-[var(--foreground)]">{model.name}</p>
                      <p className="text-sm text-[var(--foreground)]/60">{model.description}</p>
                    </div>
                    {aiModel === model.model && (
                      <Check className="w-5 h-5 text-[#FF6D1F]" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview */}
            <Card className="bg-[var(--color-beige)] border-[var(--foreground)]/10">
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
