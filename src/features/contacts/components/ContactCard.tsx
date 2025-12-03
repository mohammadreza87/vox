'use client';

import { Card, Avatar } from '@/shared/components';
import { Contact, PreMadeContactConfig } from '@/shared/types';
import { MessageCircle, Clock } from 'lucide-react';

interface ContactCardProps {
  contact: Contact | PreMadeContactConfig;
  onClick: () => void;
  lastMessage?: string;
}

export function ContactCard({ contact, onClick, lastMessage }: ContactCardProps) {
  // Format last chat time
  const formatLastChat = (date: Date | null | undefined) => {
    if (!date) return null;
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString();
  };

  const lastChatAt = 'lastChatAt' in contact ? contact.lastChatAt : null;

  return (
    <Card
      variant="interactive"
      className="flex items-center gap-4 group"
      onClick={onClick}
    >
      {/* Avatar */}
      <div className="relative">
        <Avatar
          fallback={contact.avatarEmoji}
          size="lg"
          className="group-hover:scale-105 transition-transform duration-200"
        />
        {/* Online indicator */}
        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-[#FF6D1F] rounded-full border-2 border-white" />
      </div>

      {/* Contact Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-[var(--foreground)] text-lg truncate">
            {contact.name}
          </h3>
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[#FF6D1F] text-white">
            {contact.purpose}
          </span>
        </div>

        <p className="text-[var(--foreground)]/60 text-sm truncate mt-1">
          {lastMessage || contact.personality.slice(0, 60) + '...'}
        </p>

        {/* Last chat time */}
        {lastChatAt && (
          <div className="flex items-center gap-1 mt-2 text-xs text-[var(--foreground)]/40">
            <Clock className="w-3 h-3" />
            <span>{formatLastChat(lastChatAt)}</span>
          </div>
        )}
      </div>

      {/* Chat Icon */}
      <div className="flex-shrink-0">
        <div className="w-12 h-12 rounded-full bg-[var(--color-beige)] flex items-center justify-center group-hover:bg-[#FF6D1F]/20 transition-colors">
          <MessageCircle className="w-6 h-6 text-[#FF6D1F]" />
        </div>
      </div>
    </Card>
  );
}
