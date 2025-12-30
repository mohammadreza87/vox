'use client';

import Link from 'next/link';
import { Avatar } from '@/shared/components';
import { ArrowLeft, MoreVertical, Phone } from 'lucide-react';
import { PreMadeContactConfig, Contact } from '@/shared/types';

interface ChatHeaderProps {
  contact: PreMadeContactConfig | Contact;
  onCallClick?: () => void;
}

export function ChatHeader({ contact, onCallClick }: ChatHeaderProps) {
  return (
    <header className="sticky top-0 z-50 bg-[var(--background)] border-b border-[var(--foreground)]/10 transition-colors">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Back Button */}
        <Link
          href="/contacts"
          className="w-10 h-10 rounded-full bg-[var(--color-beige)] flex items-center justify-center hover:opacity-80 transition-all"
        >
          <ArrowLeft className="w-5 h-5 text-[var(--foreground)]" />
        </Link>

        {/* Contact Info */}
        <div className="flex items-center gap-3 flex-1">
          <div className="relative">
            <Avatar
              fallback={contact.avatarEmoji}
              size="md"
            />
            {/* Online indicator */}
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-[#FF6D1F] rounded-full border-2 border-[var(--background)]" />
          </div>
          <div>
            <h1 className="font-bold text-[var(--foreground)]">{contact.name}</h1>
            <p className="text-sm text-[#FF6D1F] font-medium">{contact.purpose}</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onCallClick}
            className="w-10 h-10 rounded-full bg-[#FF6D1F]/10 flex items-center justify-center hover:bg-[#FF6D1F]/20 transition-colors"
            title="Start voice call"
          >
            <Phone className="w-5 h-5 text-[#FF6D1F]" />
          </button>
          <button className="w-10 h-10 rounded-full bg-[var(--color-beige)] flex items-center justify-center hover:opacity-80 transition-all">
            <MoreVertical className="w-5 h-5 text-[var(--foreground)]" />
          </button>
        </div>
      </div>
    </header>
  );
}
