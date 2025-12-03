'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';
import { useChat } from '@/contexts/ChatContext';
import { PRE_MADE_CONTACTS, getPreMadeContact } from '@/features/contacts/data/premade-contacts';
import { useVoiceRecording } from '@/features/voice/hooks/useVoiceRecording';
import { useTextToSpeech } from '@/features/voice/hooks/useTextToSpeech';
import { Avatar } from '@/shared/components';
import { Message, PreMadeContactConfig, Chat } from '@/shared/types';
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
  MoreVertical,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';

type TabType = 'contacts' | 'chats';

export default function AppPage() {
  return (
    <ProtectedRoute>
      <AppContent />
    </ProtectedRoute>
  );
}

function AppContent() {
  const { user, logout } = useAuth();
  const { chats, activeChat, setActiveChat, startChat, addMessage, updateMessage, deleteChat, getChatByContactId } = useChat();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<TabType>('chats');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContact, setSelectedContact] = useState<PreMadeContactConfig | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [showMobileSidebar, setShowMobileSidebar] = useState(true);
  const [initialContactLoaded, setInitialContactLoaded] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load custom contacts from localStorage
  const [customContacts, setCustomContacts] = useState<PreMadeContactConfig[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = JSON.parse(localStorage.getItem('customContacts') || '[]');
        setCustomContacts(saved);
      } catch (e) {
        console.error('Error loading custom contacts:', e);
      }
    }
  }, []);

  const allContacts = [...PRE_MADE_CONTACTS, ...customContacts];

  // Handle contact query parameter
  useEffect(() => {
    if (initialContactLoaded) return;

    const contactId = searchParams.get('contact');
    if (contactId && allContacts.length > 0) {
      const contact = getPreMadeContact(contactId) ||
        customContacts.find(c => c.id === contactId);
      if (contact) {
        handleSelectContact(contact);
        setInitialContactLoaded(true);
      }
    }
  }, [searchParams, allContacts, customContacts, initialContactLoaded]);

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

  // State for tracking which message is currently playing
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      contactId: selectedContact.id,
      role: 'user',
      content,
      audioUrl: null,
      createdAt: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    addMessage(activeChat.id, userMessage);
    setIsLoading(true);

    try {
      const conversationHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          contactId: selectedContact.id,
          systemPrompt: selectedContact.systemPrompt,
          conversationHistory,
          aiProvider: selectedContact.aiProvider,
          aiModel: selectedContact.aiModel,
        }),
      });

      const data = await response.json();
      const messageId = `ai-${Date.now()}`;

      const aiResponse: Message = {
        id: messageId,
        contactId: selectedContact.id,
        role: 'assistant',
        content: data.content,
        audioUrl: null,
        createdAt: new Date(),
      };

      setMessages(prev => [...prev, aiResponse]);
      addMessage(activeChat.id, aiResponse);

      if (autoSpeak) {
        // Get audio and save it with the message
        const audioData = await speak(data.content);
        if (audioData) {
          // Update the message with audio data
          updateMessage(activeChat.id, messageId, { audioUrl: audioData });
          setMessages(prev => prev.map(msg =>
            msg.id === messageId ? { ...msg, audioUrl: audioData } : msg
          ));
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        contactId: selectedContact.id,
        role: 'assistant',
        content: "I'm sorry, I'm having trouble connecting right now. Please try again.",
        audioUrl: null,
        createdAt: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedContact, activeChat, messages, autoSpeak, speak, stopSpeaking, addMessage, updateMessage]);

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
      // Remove from localStorage
      const updatedContacts = customContacts.filter(c => c.id !== contactId);
      localStorage.setItem('customContacts', JSON.stringify(updatedContacts));
      setCustomContacts(updatedContacts);

      // Clear selection if this contact was selected
      if (selectedContact?.id === contactId) {
        setSelectedContact(null);
        setMessages([]);
      }

      // Delete associated chat
      const associatedChat = getChatByContactId(contactId);
      if (associatedChat) {
        deleteChat(associatedChat.id);
      }
    }
  }, [customContacts, selectedContact, getChatByContactId, deleteChat]);

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
  // Pre-made contacts will be copied to custom contacts when edited
  const handleEditAnyContact = useCallback((contact: PreMadeContactConfig, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCustomContact(contact.id)) {
      // Direct edit for custom contacts
      router.push(`/create?edit=${contact.id}`);
    } else {
      // Copy pre-made contact to custom and edit
      const customId = `custom-${Date.now()}`;
      const customContact = {
        ...contact,
        id: customId,
        isPreMade: false,
        createdAt: new Date().toISOString(),
      };
      const existingContacts = JSON.parse(localStorage.getItem('customContacts') || '[]');
      existingContacts.push(customContact);
      localStorage.setItem('customContacts', JSON.stringify(existingContacts));
      setCustomContacts(existingContacts);
      router.push(`/create?edit=${customId}`);
    }
  }, [router, isCustomContact]);

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
    <div className="h-full flex bg-[var(--background)] transition-colors overflow-hidden" style={{ height: '100dvh' }}>
      {/* Sidebar */}
      <div className={cn(
        "w-full md:w-80 lg:w-96 border-r border-[var(--foreground)]/10 flex flex-col bg-[var(--background)] transition-all",
        showMobileSidebar ? "flex" : "hidden md:flex"
      )}>
        {/* Sidebar Header */}
        <div className="p-4 border-b border-[var(--foreground)]/10">
          <div className="flex items-center justify-between mb-4">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-10 h-10 bg-[#FF6D1F] rounded-xl flex items-center justify-center">
                <Volume2 className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-[var(--foreground)]">Vox</span>
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <button
                onClick={logout}
                className="w-10 h-10 rounded-full bg-[var(--color-beige)] flex items-center justify-center hover:opacity-80 transition-all"
                title="Sign out"
              >
                <LogOut className="w-5 h-5 text-[var(--foreground)]" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex bg-[var(--color-beige)] rounded-xl p-1">
            <button
              onClick={() => setActiveTab('chats')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-medium transition-all",
                activeTab === 'chats'
                  ? "bg-[#FF6D1F] text-white"
                  : "text-[var(--foreground)]/60 hover:text-[var(--foreground)]"
              )}
            >
              <MessageCircle className="w-4 h-4" />
              Chats
              {chats.length > 0 && (
                <span className={cn(
                  "text-xs px-2 py-0.5 rounded-full",
                  activeTab === 'chats' ? "bg-white/20 text-white" : "bg-[var(--foreground)]/20 text-[var(--foreground)]"
                )}>
                  {chats.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('contacts')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-medium transition-all",
                activeTab === 'contacts'
                  ? "bg-[#FF6D1F] text-white"
                  : "text-[var(--foreground)]/60 hover:text-[var(--foreground)]"
              )}
            >
              <Users className="w-4 h-4" />
              Contacts
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--foreground)]/40" />
            <input
              type="text"
              placeholder={activeTab === 'contacts' ? "Search contacts..." : "Search chats..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[var(--color-beige)] border border-[var(--foreground)]/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FF6D1F] text-[var(--foreground)] placeholder-[var(--foreground)]/40 text-sm transition-colors"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'contacts' ? (
            <div className="px-4 pb-4 space-y-2">
              {/* Create New Contact Button */}
              <Link
                href="/create"
                className="flex items-center gap-3 p-3 rounded-xl bg-[var(--color-beige)] border border-dashed border-[var(--foreground)]/20 hover:border-[#FF6D1F] transition-all"
              >
                <div className="w-12 h-12 rounded-full bg-[#FF6D1F]/10 flex items-center justify-center">
                  <Plus className="w-6 h-6 text-[#FF6D1F]" />
                </div>
                <div>
                  <p className="font-medium text-[var(--foreground)]">Create Contact</p>
                  <p className="text-sm text-[var(--foreground)]/60">Add custom AI assistant</p>
                </div>
              </Link>

              {/* Contacts List */}
              {filteredContacts.map(contact => (
                <div
                  key={contact.id}
                  className={cn(
                    "group w-full flex items-center gap-3 p-3 rounded-xl transition-all",
                    selectedContact?.id === contact.id
                      ? "bg-[#FF6D1F]/10 border border-[#FF6D1F]/30"
                      : "bg-[var(--color-beige)] border border-transparent hover:border-[var(--foreground)]/10"
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
                      className="p-2 rounded-full hover:bg-[var(--foreground)]/10 text-[var(--foreground)]/40 hover:text-[#FF6D1F] transition-all"
                      title={isCustomContact(contact.id) ? "Edit contact" : "Customize contact"}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    {isCustomContact(contact.id) && (
                      <button
                        onClick={(e) => handleDeleteContact(contact.id, e)}
                        className="p-2 rounded-full hover:bg-red-100 dark:hover:bg-red-900/20 text-[var(--foreground)]/40 hover:text-red-500 transition-all"
                        title="Delete contact"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 pb-4 space-y-2">
              {filteredChats.length === 0 ? (
                <div className="text-center py-12">
                  <MessageCircle className="w-12 h-12 text-[var(--foreground)]/20 mx-auto mb-3" />
                  <p className="text-[var(--foreground)]/60">No chats yet</p>
                  <p className="text-sm text-[var(--foreground)]/40 mt-1">Start a conversation with a contact</p>
                </div>
              ) : (
                filteredChats.map(chat => (
                  <div
                    key={chat.id}
                    className={cn(
                      "group w-full flex items-center gap-3 p-3 rounded-xl transition-all",
                      activeChat?.id === chat.id
                        ? "bg-[#FF6D1F]/10 border border-[#FF6D1F]/30"
                        : "bg-[var(--color-beige)] border border-transparent hover:border-[var(--foreground)]/10"
                    )}
                  >
                    <button
                      onClick={() => handleSelectChat(chat)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <div className="relative">
                        <Avatar src={chat.contactImage} fallback={chat.contactEmoji} size="md" />
                        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-[#FF6D1F] rounded-full border-2 border-[var(--background)]" />
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
                      className="opacity-0 group-hover:opacity-100 p-2 rounded-full hover:bg-red-100 dark:hover:bg-red-900/20 text-[var(--foreground)]/40 hover:text-red-500 transition-all"
                      title="Delete chat"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* User Info */}
        <div className="p-4 border-t border-[var(--foreground)]/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--color-beige)] flex items-center justify-center">
              <span className="text-lg">{user?.displayName?.[0] || user?.email?.[0] || '?'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-[var(--foreground)] truncate">{user?.displayName || 'User'}</p>
              <p className="text-xs text-[var(--foreground)]/60 truncate">{user?.email}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className={cn(
        "flex-1 flex flex-col bg-[var(--background)]",
        !showMobileSidebar ? "flex" : "hidden md:flex"
      )}>
        {selectedContact ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b border-[var(--foreground)]/10 flex items-center gap-3">
              <button
                onClick={() => setShowMobileSidebar(true)}
                className="md:hidden w-10 h-10 rounded-full bg-[var(--color-beige)] flex items-center justify-center"
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
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                  autoSpeak ? "bg-[#FF6D1F]/10 text-[#FF6D1F]" : "bg-[var(--color-beige)] text-[var(--foreground)]/60"
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
                    <div className="w-10 h-10 rounded-full bg-[var(--color-beige)] flex items-center justify-center flex-shrink-0">
                      <span className="text-sm">{user?.displayName?.[0] || '?'}</span>
                    </div>
                  ) : (
                    <Avatar src={selectedContact.avatarImage} fallback={selectedContact.avatarEmoji} size="sm" className="flex-shrink-0" />
                  )}
                  <div className="flex flex-col gap-1 max-w-[75%]">
                    <div
                      className={cn(
                        "rounded-2xl px-4 py-3",
                        message.role === 'user'
                          ? "bg-[#FF6D1F] text-white rounded-br-md"
                          : "bg-[var(--color-beige)] text-[var(--foreground)] rounded-bl-md"
                      )}
                    >
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                    </div>
                    {/* Replay button for assistant messages */}
                    {message.role === 'assistant' && (
                      <button
                        onClick={() => handleReplayAudio(message)}
                        disabled={isSpeaking && playingMessageId !== message.id}
                        className={cn(
                          "self-start flex items-center gap-1.5 px-2 py-1 rounded-full text-xs transition-all",
                          playingMessageId === message.id
                            ? "bg-[#FF6D1F] text-white"
                            : "opacity-0 group-hover:opacity-100 bg-[var(--color-beige)] text-[var(--foreground)]/60 hover:text-[#FF6D1F]",
                          message.audioUrl && "border border-[#FF6D1F]/30"
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
                            <RotateCcw className="w-3 h-3" />
                            {message.audioUrl ? "Replay" : "Play"}
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex items-center gap-3">
                  <Avatar src={selectedContact.avatarImage} fallback={selectedContact.avatarEmoji} size="sm" />
                  <div className="bg-[var(--color-beige)] rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex items-center gap-1">
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
              isLoading={isLoading}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-24 h-24 bg-[var(--color-beige)] rounded-full flex items-center justify-center mx-auto mb-4">
                <MessageCircle className="w-12 h-12 text-[var(--foreground)]/20" />
              </div>
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-2">Select a conversation</h2>
              <p className="text-[var(--foreground)]/60">Choose a contact to start chatting</p>
            </div>
          </div>
        )}
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
    <div className="p-4 border-t border-[var(--foreground)]/10" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <form onSubmit={handleSubmit} className="flex items-center gap-3">
        <button
          ref={micButtonRef}
          type="button"
          disabled={isLoading}
          className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center transition-all select-none",
            isRecording
              ? "bg-[var(--foreground)] text-[var(--background)] animate-pulse"
              : "bg-[var(--color-beige)] text-[var(--foreground)] hover:opacity-80"
          )}
          style={{ touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
        >
          {isRecording ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>

        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={isRecording ? 'Listening...' : 'Type a message...'}
          disabled={isLoading || isRecording}
          className="flex-1 px-4 py-3 bg-[var(--color-beige)] border border-[var(--foreground)]/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FF6D1F] text-[var(--foreground)] placeholder-[var(--foreground)]/40 transition-colors"
        />

        <button
          type="submit"
          disabled={!message.trim() || isLoading}
          className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center transition-all",
            message.trim() && !isLoading
              ? "bg-[#FF6D1F] text-white hover:bg-[#e5621b]"
              : "bg-[var(--color-beige)] text-[var(--foreground)]/40"
          )}
        >
          {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-5 h-5" />}
        </button>
      </form>
    </div>
  );
}
