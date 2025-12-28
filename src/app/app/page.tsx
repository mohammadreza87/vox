'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
import { useChat } from '@/contexts/ChatContext';
import { PRE_MADE_CONTACTS, getPreMadeContact } from '@/features/contacts/data/premade-contacts';
import { useVoiceRecording } from '@/features/voice/hooks/useVoiceRecording';
import { useTextToSpeech } from '@/features/voice/hooks/useTextToSpeech';
import { useStreamingChat } from '@/hooks/useStreamingChat';
import { ChatErrorBoundary } from '@/components/ChatErrorBoundary';
import { Avatar } from '@/shared/components';
import { Message, PreMadeContactConfig, Chat } from '@/shared/types';
import {
  Cell,
  Section,
  List,
  Avatar as TgAvatar,
  Badge,
  IconButton,
  Placeholder,
  SegmentedControl,
  Input,
} from '@telegram-apps/telegram-ui';
import {
  Volume2,
  LogOut,
  MessageCircle,
  Users,
  Plus,
  Search,
  Send,
  Mic,
  MicOff,
  Loader2,
  VolumeX,
  ArrowLeft,
  RotateCcw,
  Trash2,
  Pencil,
  Settings,
  CreditCard,
  ChevronUp,
  Languages,
} from 'lucide-react';
// ThemeToggle removed - now only in settings
import { cn } from '@/shared/utils/cn';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useCustomContacts } from '@/contexts/CustomContactsContext';
import { auth } from '@/lib/firebase';
import { useEntranceAnimation, useTabAnimation } from '@/hooks/useAnimations';
import gsap from 'gsap';

type TabType = 'contacts' | 'chats' | 'translator';

export default function AppPage() {
  return (
    <ProtectedRoute>
      <AppContent />
    </ProtectedRoute>
  );
}

function AppContent() {
  const { user, logout } = useAuth();
  const { chats, activeChat, setActiveChat, startChat, addMessage, updateMessage, deleteChat, getChatByContactId, isLoading: isLoadingChats } = useChat();
  const { canEditDefaultBots, showUpgradeModal, tier } = useSubscription();
  const { customContacts, deleteContact: deleteCustomContact, addContact } = useCustomContacts();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<TabType>('contacts');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContact, setSelectedContact] = useState<PreMadeContactConfig | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  // isLoading state removed - now using isStreaming from useStreamingChat hook
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [showMobileSidebar, setShowMobileSidebar] = useState(true);
  const [initialContactLoaded, setInitialContactLoaded] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // GSAP Animation refs - single page entrance
  const { ref: pageRef } = useEntranceAnimation('fadeIn', { delay: 0 });

  // Tab content animation - triggers on tab change
  const tabContentRef = useTabAnimation(activeTab, { animation: 'fadeUp' });

  const allContacts = [...PRE_MADE_CONTACTS, ...customContacts];

  // Handle contact query parameter
  useEffect(() => {
    const contactId = searchParams.get('contact');
    if (!contactId) return;

    // Skip if already loaded this contact
    if (initialContactLoaded && selectedContact?.id === contactId) return;

    const contact = getPreMadeContact(contactId) ||
      customContacts.find(c => c.id === contactId);
    if (contact) {
      handleSelectContact(contact);
      setInitialContactLoaded(true);
    }
  }, [searchParams, customContacts, initialContactLoaded, selectedContact]);

  // Voice recording hook
  const {
    isRecording,
    isSupported: isVoiceSupported,
    transcript,
    startRecording,
    stopRecording,
    resetTranscript,
  } = useVoiceRecording({
    onError: (error) => console.error('Voice recording error:', error),
  });

  // Text-to-speech hook
  const {
    isSpeaking,
    speak,
    playAudio,
    stop: stopSpeaking,
  } = useTextToSpeech({
    voiceId: selectedContact?.voiceId,
    onEnd: () => console.log('Finished speaking'),
  });

  // Streaming chat hook
  const streamingMessageIdRef = useRef<string | null>(null);
  const { streamingText, isStreaming, startStream, cancelStream } = useStreamingChat({
    onComplete: async (fullText) => {
      // Generate TTS and auto-play after streaming completes
      if (autoSpeak && selectedContact && activeChat && streamingMessageIdRef.current) {
        const messageId = streamingMessageIdRef.current;
        setPlayingMessageId(messageId); // Show playing state
        const audioData = await speak(fullText);
        if (audioData) {
          updateMessage(activeChat.id, messageId, { audioUrl: audioData });
          setMessages((prev) =>
            prev.map((msg) => (msg.id === messageId ? { ...msg, audioUrl: audioData } : msg))
          );
          // Auto-play the generated audio
          await playAudio(audioData);
        }
        setPlayingMessageId(null);
      }
      streamingMessageIdRef.current = null;
    },
    onError: (error) => {
      console.error('Streaming error:', error);
      streamingMessageIdRef.current = null;
      setPlayingMessageId(null);
    },
  });

  // State for tracking which message is currently playing
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle transcript from voice recording
  useEffect(() => {
    if (transcript && !isRecording) {
      handleSendMessage(transcript);
      resetTranscript();
    }
  }, [isRecording, transcript]);

  // Filter contacts by search
  const filteredContacts = allContacts.filter(contact =>
    contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.purpose.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filter chats by search
  const filteredChats = chats.filter(chat =>
    chat.contactName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    chat.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getGreeting = (contact: PreMadeContactConfig): string => {
    switch (contact.id) {
      case 'alice-interview-coach':
        return "Hi! I'm Alice, your interview coach. What position are you preparing for today?";
      case 'carlos-spanish-tutor':
        return "¡Hola! I'm Carlos, your Spanish tutor. What's your current level with Spanish?";
      case 'marcus-startup-mentor':
        return "Hey, Marcus here. What are you working on? Let's see if I can help.";
      case 'sam-wellness-coach':
        return "Hello, I'm Dr. Sam. How are you feeling today?";
      case 'mia-cooking-assistant':
        return "Hey there! I'm Chef Mia! What would you like to cook today?";
      case 'lingua-translator':
        return "Hello! I'm Lingua, your universal translator. Tell me what to translate and which language you want it in!";
      default:
        return `Hi! I'm ${contact.name}, your ${contact.purpose}. How can I help you today?`;
    }
  };

  const handleSelectContact = (contact: PreMadeContactConfig) => {
    setSelectedContact(contact);
    setShowMobileSidebar(false);

    // Check if there's an existing chat
    const existingChat = getChatByContactId(contact.id);
    if (existingChat) {
      setActiveChat(existingChat);
      setMessages(existingChat.messages);
    } else {
      // Start new chat
      const newChat = startChat(contact);
      const greeting: Message = {
        id: 'greeting',
        contactId: contact.id,
        role: 'assistant',
        content: getGreeting(contact),
        audioUrl: null,
        createdAt: new Date(),
      };
      setMessages([greeting]);
      addMessage(newChat.id, greeting);
    }
  };

  const handleSelectChat = (chat: Chat) => {
    const contact = getPreMadeContact(chat.contactId) ||
      customContacts.find(c => c.id === chat.contactId);

    if (contact) {
      setSelectedContact(contact);
      setActiveChat(chat);
      setMessages(chat.messages);
      setShowMobileSidebar(false);
    }
  };

  const handleSendMessage = useCallback(async (content: string) => {
    if (!selectedContact || !content.trim() || !activeChat) return;

    stopSpeaking();
    cancelStream();

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      contactId: selectedContact.id,
      role: 'user',
      content,
      audioUrl: null,
      createdAt: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    addMessage(activeChat.id, userMessage);

    // Create placeholder AI message for streaming
    const messageId = `ai-${Date.now()}`;
    streamingMessageIdRef.current = messageId;

    const aiPlaceholder: Message = {
      id: messageId,
      contactId: selectedContact.id,
      role: 'assistant',
      content: '', // Will be filled by streaming
      audioUrl: null,
      createdAt: new Date(),
    };

    setMessages((prev) => [...prev, aiPlaceholder]);

    const conversationHistory = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Start streaming
    startStream({
      message: content,
      contactId: selectedContact.id,
      systemPrompt: selectedContact.systemPrompt,
      conversationHistory,
      aiProvider: selectedContact.aiProvider,
      aiModel: selectedContact.aiModel,
    });
  }, [selectedContact, activeChat, messages, stopSpeaking, cancelStream, addMessage, startStream]);

  // Update AI message content as streaming chunks arrive
  useEffect(() => {
    if (!isStreaming && !streamingText) return;

    const messageId = streamingMessageIdRef.current;
    if (!messageId) return;

    setMessages((prev) =>
      prev.map((msg) => (msg.id === messageId ? { ...msg, content: streamingText } : msg))
    );

    // When streaming completes, save the final message
    if (!isStreaming && streamingText && activeChat) {
      const finalMessage = {
        id: messageId,
        contactId: activeChat.contactId,
        role: 'assistant' as const,
        content: streamingText,
        audioUrl: null,
        createdAt: new Date(),
      };
      addMessage(activeChat.id, finalMessage);
    }
  }, [streamingText, isStreaming, activeChat, addMessage]);

  // Handle replay of cached audio
  const handleReplayAudio = useCallback(async (message: Message) => {
    if (isSpeaking) {
      stopSpeaking();
      setPlayingMessageId(null);
      return;
    }

    if (message.audioUrl) {
      // Play cached audio
      setPlayingMessageId(message.id);
      await playAudio(message.audioUrl);
      setPlayingMessageId(null);
    } else if (selectedContact) {
      // Generate new audio and cache it
      setPlayingMessageId(message.id);
      const audioData = await speak(message.content);
      if (audioData && activeChat) {
        updateMessage(activeChat.id, message.id, { audioUrl: audioData });
        setMessages(prev => prev.map(msg =>
          msg.id === message.id ? { ...msg, audioUrl: audioData } : msg
        ));
      }
      setPlayingMessageId(null);
    }
  }, [isSpeaking, stopSpeaking, playAudio, speak, selectedContact, activeChat, updateMessage]);

  // Handle delete chat
  const handleDeleteChat = useCallback((chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this chat?')) {
      deleteChat(chatId);
      if (activeChat?.id === chatId) {
        setSelectedContact(null);
        setMessages([]);
      }
    }
  }, [deleteChat, activeChat]);

  // Handle delete custom contact
  const handleDeleteContact = useCallback((contactId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this contact? This will also delete all associated chats.')) {
      deleteCustomContact(contactId);

      if (selectedContact?.id === contactId) {
        setSelectedContact(null);
        setMessages([]);
      }

      const associatedChat = getChatByContactId(contactId);
      if (associatedChat) {
        deleteChat(associatedChat.id);
      }
    }
  }, [selectedContact, getChatByContactId, deleteChat, deleteCustomContact]);

  // Handle edit custom contact
  const handleEditContact = useCallback((contactId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/create?edit=${contactId}`);
  }, [router]);

  // Check if contact is custom (can be deleted)
  const isCustomContact = useCallback((contactId: string) => {
    return contactId.startsWith('custom-');
  }, []);

  // Handle edit for both custom and pre-made contacts
  const handleEditAnyContact = useCallback((contact: PreMadeContactConfig, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCustomContact(contact.id)) {
      router.push(`/create?edit=${contact.id}`);
    } else {
      if (!canEditDefaultBots) {
        showUpgradeModal('edit-default-bots');
        return;
      }
      const customId = `custom-${Date.now()}`;
      const customContact = {
        ...contact,
        id: customId,
        isPreMade: false,
        createdAt: new Date().toISOString(),
      };
      addContact(customContact);
      router.push(`/create?edit=${customId}`);
    }
  }, [router, isCustomContact, canEditDefaultBots, showUpgradeModal, addContact]);

  const handleStartRecording = () => {
    if (isVoiceSupported) {
      stopSpeaking();
      startRecording();
    }
  };

  const handleStopRecording = () => {
    stopRecording();
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return new Date(date).toLocaleDateString();
  };

  return (
    <div ref={pageRef} className="h-full flex overflow-hidden relative" style={{ height: '100dvh' }}>
      {/* Animated gradient background */}
      <div className="glass-background" />

      {/* Sidebar */}
      <div
        className={cn(
          "w-full md:w-[340px] lg:w-[400px] xl:w-[440px] flex flex-col transition-all z-10",
          showMobileSidebar ? "flex" : "hidden md:flex"
        )}
      >
        {/* Sidebar Glass Panel */}
        <div className="m-2 md:m-3 flex-1 flex flex-col liquid-glass overflow-hidden">
          {/* Sidebar Header */}
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 liquid-avatar">
                  <Volume2 className="w-5 h-5" />
                </div>
                <span className="text-xl font-bold text-[var(--foreground)]">Vox</span>
              </div>
            </div>

            {/* Tabs */}
            <div className="liquid-tabs">
              <button
                onClick={() => setActiveTab('contacts')}
                className={cn("liquid-tab", activeTab === 'contacts' && "active")}
              >
                <Users className="w-4 h-4" />
                Contacts
              </button>
              <button
                onClick={() => setActiveTab('chats')}
                className={cn("liquid-tab", activeTab === 'chats' && "active")}
              >
                <MessageCircle className="w-4 h-4" />
                Chats
                {chats.length > 0 && (
                  <span className="liquid-badge text-[10px] py-0.5 px-1.5 ml-1">
                    {chats.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('translator')}
                className={cn("liquid-tab", activeTab === 'translator' && "active")}
              >
                <Languages className="w-4 h-4" />
                Translate
              </button>
            </div>
          </div>

          {/* Search - hide for translator tab */}
          {activeTab !== 'translator' && (
            <div className="p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--foreground)]/40 z-10" />
                <input
                  type="text"
                  placeholder={activeTab === 'contacts' ? "Search contacts..." : "Search chats..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 liquid-input"
                />
              </div>
            </div>
          )}

          {/* List */}
          <div ref={tabContentRef} className="flex-1 overflow-y-auto px-3 pb-4">
            {activeTab === 'contacts' ? (
              <div className="space-y-1">
                {/* Create New Contact Button */}
                <Link href="/create" className="liquid-list-item group">
                  <div className="w-12 h-12 rounded-full liquid-card flex items-center justify-center group-hover:scale-105 transition-transform">
                    <Plus className="w-6 h-6 text-[#FF6D1F]" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-[var(--foreground)]">Create Contact</p>
                    <p className="text-sm text-[var(--foreground)]/60">Add custom AI assistant</p>
                  </div>
                </Link>

                {/* Contacts List */}
                {filteredContacts.map(contact => (
                  <div
                    key={contact.id}
                    className={cn(
                      "liquid-list-item group",
                      selectedContact?.id === contact.id && "selected"
                    )}
                  >
                    <button
                      onClick={() => handleSelectContact(contact)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <Avatar src={contact.avatarImage} fallback={contact.avatarEmoji} size="md" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-[var(--foreground)] truncate">{contact.name}</p>
                        <p className="text-sm text-[#FF6D1F] truncate">{contact.purpose}</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => handleEditAnyContact(contact, e)}
                        className="p-2 rounded-full liquid-card text-[var(--foreground)]/60 hover:text-[#FF6D1F] transition-all"
                        title={isCustomContact(contact.id) ? "Edit contact" : "Customize contact"}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {isCustomContact(contact.id) && (
                        <button
                          onClick={(e) => handleDeleteContact(contact.id, e)}
                          className="p-2 rounded-full liquid-card text-[var(--foreground)]/60 hover:text-red-500 transition-all"
                          title="Delete contact"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : activeTab === 'chats' ? (
              <div className="space-y-1">
                {isLoadingChats ? (
                  /* Loading skeleton for chats */
                  <div className="space-y-2 animate-pulse">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="liquid-list-item">
                        <div className="flex items-center gap-3 w-full">
                          <div className="w-12 h-12 rounded-full bg-[var(--foreground)]/10" />
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-[var(--foreground)]/10 rounded w-1/3" />
                            <div className="h-3 bg-[var(--foreground)]/10 rounded w-2/3" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : filteredChats.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 liquid-card rounded-full flex items-center justify-center mx-auto mb-3">
                      <MessageCircle className="w-8 h-8 text-[var(--foreground)]/30" />
                    </div>
                    <p className="text-[var(--foreground)]/60 font-medium">No chats yet</p>
                    <p className="text-sm text-[var(--foreground)]/40 mt-1">Start a conversation with a contact</p>
                  </div>
                ) : (
                  filteredChats.map(chat => (
                    <div
                      key={chat.id}
                      className={cn(
                        "liquid-list-item group",
                        activeChat?.id === chat.id && "selected"
                      )}
                    >
                      <button
                        onClick={() => handleSelectChat(chat)}
                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                      >
                        <div className="relative">
                          <Avatar src={chat.contactImage} fallback={chat.contactEmoji} size="md" />
                          <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 liquid-fab" style={{ width: '14px', height: '14px' }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-[var(--foreground)] truncate">{chat.contactName}</p>
                            <span className="text-xs text-[var(--foreground)]/40">{formatTime(chat.lastMessageAt)}</span>
                          </div>
                          <p className="text-sm text-[var(--foreground)]/60 truncate">{chat.lastMessage || 'Start chatting...'}</p>
                        </div>
                      </button>
                      <button
                        onClick={(e) => handleDeleteChat(chat.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-2 rounded-full liquid-card text-[var(--foreground)]/60 hover:text-red-500 transition-all"
                        title="Delete chat"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            ) : (
              /* Translator Tab Content */
              <div className="flex flex-col items-center justify-center h-full py-8 px-4">
                <div className="w-20 h-20 liquid-card rounded-full flex items-center justify-center mb-4">
                  <Languages className="w-10 h-10 text-[#FF6D1F]" />
                </div>
                <h3 className="text-xl font-bold text-[var(--foreground)] mb-2">Voice Translator</h3>
                <p className="text-[var(--foreground)]/60 text-center mb-6 max-w-xs">
                  Speak in any language and hear the translation in your own cloned voice
                </p>
                <Link
                  href="/translator"
                  className="liquid-button px-6 py-3 rounded-xl font-medium flex items-center gap-2"
                >
                  <Languages className="w-5 h-5" />
                  Open Translator
                </Link>
              </div>
            )}
          </div>

          {/* User Info with Dropdown */}
          <div className="p-4 border-t border-white/10 relative" ref={userMenuRef}>
            {/* Dropdown Menu (opens upward) */}
            {showUserMenu && (
              <div className="absolute bottom-full left-4 right-4 mb-2 liquid-glass overflow-hidden z-50">
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    router.push('/settings');
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 transition-colors text-left"
                >
                  <Settings className="w-5 h-5 text-[var(--foreground)]/60" />
                  <span className="text-[var(--foreground)]">Settings</span>
                </button>
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    router.push('/pricing');
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 transition-colors text-left border-t border-white/5"
                >
                  <CreditCard className="w-5 h-5 text-[var(--foreground)]/60" />
                  <div className="flex-1">
                    <span className="text-[var(--foreground)]">Plans</span>
                    <span className="ml-2 liquid-badge text-[10px]">{tier}</span>
                  </div>
                </button>
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    logout();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-500/10 transition-colors text-left border-t border-white/5"
                >
                  <LogOut className="w-5 h-5 text-red-500" />
                  <span className="text-red-500">Logout</span>
                </button>
              </div>
            )}

            {/* User Info Button */}
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="w-full liquid-list-item"
            >
              <div className="liquid-avatar text-sm">
                {user?.displayName?.[0] || user?.email?.[0] || '?'}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="font-medium text-[var(--foreground)] truncate">{user?.displayName || 'User'}</p>
                <p className="text-xs text-[var(--foreground)]/60 truncate">{user?.email}</p>
              </div>
              <ChevronUp className={cn(
                "w-5 h-5 text-[var(--foreground)]/40 transition-transform",
                showUserMenu && "rotate-180"
              )} />
            </button>
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div
        className={cn(
          "flex-1 flex flex-col z-10",
          !showMobileSidebar ? "flex" : "hidden md:flex"
        )}
      >
        <div className="m-2 md:m-3 md:ml-0 flex-1 flex flex-col liquid-glass overflow-hidden">
          {selectedContact ? (
            <>
              {/* Chat Header */}
              <div className="p-4 border-b border-white/10 flex items-center gap-3">
                <button
                  onClick={() => setShowMobileSidebar(true)}
                  className="md:hidden w-10 h-10 rounded-full liquid-card flex items-center justify-center hover:scale-105 transition-transform"
                >
                  <ArrowLeft className="w-5 h-5 text-[var(--foreground)]" />
                </button>
                <Avatar src={selectedContact.avatarImage} fallback={selectedContact.avatarEmoji} size="md" />
                <button
                  onClick={(e) => handleEditAnyContact(selectedContact, e)}
                  className="flex-1 text-left hover:opacity-70 transition-opacity group"
                  title={isCustomContact(selectedContact.id) ? "Click to edit" : "Click to customize"}
                >
                  <div className="flex items-center gap-2">
                    <h2 className="font-bold text-[var(--foreground)]">{selectedContact.name}</h2>
                    <Pencil className="w-3 h-3 text-[var(--foreground)]/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="text-sm text-[#FF6D1F]">{selectedContact.purpose}</p>
                </button>
                <button
                  onClick={() => setAutoSpeak(!autoSpeak)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all",
                    autoSpeak
                      ? "liquid-button"
                      : "liquid-card text-[var(--foreground)]/60"
                  )}
                >
                  {autoSpeak ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  {autoSpeak ? 'On' : 'Off'}
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map(message => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex gap-3 group",
                      message.role === 'user' ? "flex-row-reverse" : "flex-row"
                    )}
                  >
                    {message.role === 'user' ? (
                      <div className="liquid-avatar text-sm flex-shrink-0" style={{ width: '40px', height: '40px' }}>
                        {user?.displayName?.[0] || '?'}
                      </div>
                    ) : (
                      <Avatar src={selectedContact.avatarImage} fallback={selectedContact.avatarEmoji} size="sm" className="flex-shrink-0" />
                    )}
                    <div className="flex flex-col gap-1 max-w-[75%]">
                      <div className={message.role === 'user' ? "liquid-msg-sent" : "liquid-msg-received"}>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                      </div>
                      {/* Replay button for assistant messages - always visible for mobile */}
                      {message.role === 'assistant' && message.content && (
                        <button
                          onClick={() => handleReplayAudio(message)}
                          disabled={isSpeaking && playingMessageId !== message.id}
                          className={cn(
                            "self-start flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-all",
                            playingMessageId === message.id
                              ? "liquid-button"
                              : "liquid-card text-[var(--foreground)]/60 hover:text-[#FF6D1F]"
                          )}
                          title={message.audioUrl ? "Replay audio (cached)" : "Play audio"}
                        >
                          {playingMessageId === message.id ? (
                            <>
                              <VolumeX className="w-3 h-3" />
                              Stop
                            </>
                          ) : (
                            <>
                              <Volume2 className="w-3 h-3" />
                              {message.audioUrl ? "Replay" : "Play"}
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {/* Show typing indicator only when streaming starts with empty content */}
                {isStreaming && !streamingText && (
                  <div className="flex items-center gap-3">
                    <Avatar src={selectedContact.avatarImage} fallback={selectedContact.avatarEmoji} size="sm" />
                    <div className="liquid-msg-received">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 bg-[#FF6D1F] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 bg-[#FF6D1F] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 bg-[#FF6D1F] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <ChatInputArea
                onSendMessage={handleSendMessage}
                onStartRecording={handleStartRecording}
                onStopRecording={handleStopRecording}
                isRecording={isRecording}
                isLoading={isStreaming}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-24 h-24 liquid-card rounded-full flex items-center justify-center mx-auto mb-4">
                  <MessageCircle className="w-12 h-12 text-[var(--foreground)]/20" />
                </div>
                <h2 className="text-xl font-bold text-[var(--foreground)] mb-2">Select a conversation</h2>
                <p className="text-[var(--foreground)]/60">Choose a contact to start chatting</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Chat Input Component
function ChatInputArea({
  onSendMessage,
  onStartRecording,
  onStopRecording,
  isRecording,
  isLoading,
}: {
  onSendMessage: (message: string) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  isRecording: boolean;
  isLoading: boolean;
}) {
  const [message, setMessage] = useState('');
  const micButtonRef = useRef<HTMLButtonElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  // Handle press-and-hold for mic button
  useEffect(() => {
    const button = micButtonRef.current;
    if (!button) return;

    const handlePointerDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      button.setPointerCapture(e.pointerId);
      onStartRecording();
    };

    const handlePointerUp = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (button.hasPointerCapture(e.pointerId)) {
        button.releasePointerCapture(e.pointerId);
      }
      onStopRecording();
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
  }, [onStartRecording, onStopRecording]);

  return (
    <div className="p-4 border-t border-white/10" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <form onSubmit={handleSubmit} className="flex items-center gap-3">
        <button
          ref={micButtonRef}
          type="button"
          disabled={isLoading}
          className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center transition-all select-none relative",
            isRecording
              ? "liquid-fab liquid-recording"
              : "liquid-card text-[var(--foreground)] hover:scale-105"
          )}
          style={{ touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
        >
          {isRecording ? <MicOff className="w-6 h-6 relative z-10" /> : <Mic className="w-6 h-6" />}
        </button>

        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={isRecording ? 'Listening...' : 'Type a message...'}
          disabled={isLoading || isRecording}
          className="flex-1 px-4 py-3 liquid-input"
        />

        <button
          type="submit"
          disabled={!message.trim() || isLoading}
          className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center transition-all",
            message.trim() && !isLoading
              ? "liquid-fab hover:scale-105"
              : "liquid-card text-[var(--foreground)]/40"
          )}
        >
          {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-5 h-5" />}
        </button>
      </form>
    </div>
  );
}
