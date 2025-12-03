'use client';

import { Message } from '@/shared/types';
import { Avatar } from '@/shared/components';
import { cn } from '@/shared/utils/cn';
import { Volume2, User } from 'lucide-react';

interface ChatMessageProps {
  message: Message;
  contactName?: string;
  contactEmoji?: string;
  contactGradient?: string;
  onPlayAudio?: () => void;
}

export function ChatMessage({
  message,
  contactName,
  contactEmoji,
  onPlayAudio,
}: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div
      className={cn(
        'flex gap-3',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      {isUser ? (
        <div className="w-10 h-10 rounded-full bg-[var(--color-beige)] flex items-center justify-center flex-shrink-0 transition-colors">
          <User className="w-5 h-5 text-[var(--foreground)]" />
        </div>
      ) : (
        <Avatar
          fallback={contactEmoji || '?'}
          size="sm"
          className="flex-shrink-0"
        />
      )}

      {/* Message Bubble */}
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-4 py-3 transition-colors',
          isUser
            ? 'bg-[#FF6D1F] text-white rounded-br-md'
            : 'bg-[var(--color-beige)] border border-[var(--foreground)]/10 text-[var(--foreground)] rounded-bl-md shadow-sm'
        )}
      >
        {/* Sender Name (for assistant) */}
        {!isUser && contactName && (
          <p className="text-xs font-medium text-[#FF6D1F] mb-1">{contactName}</p>
        )}

        {/* Message Content */}
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
        </p>

        {/* Audio Button */}
        {!isUser && message.audioUrl && (
          <button
            onClick={onPlayAudio}
            className="mt-2 flex items-center gap-1 text-xs text-[#FF6D1F] hover:text-[#e5621b]"
          >
            <Volume2 className="w-3 h-3" />
            Play audio
          </button>
        )}
      </div>
    </div>
  );
}
