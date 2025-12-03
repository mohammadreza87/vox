'use client';

import { useState, useRef } from 'react';
import { Mic, MicOff, Send, Loader2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  isRecording: boolean;
  isLoading: boolean;
  disabled?: boolean;
}

export function ChatInput({
  onSendMessage,
  onStartRecording,
  onStopRecording,
  isRecording,
  isLoading,
  disabled,
}: ChatInputProps) {
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  const handleMicClick = () => {
    if (isRecording) {
      onStopRecording();
    } else {
      onStartRecording();
    }
  };

  return (
    <div className="border-t border-[var(--foreground)]/10 bg-[var(--background)] p-4 transition-colors">
      <form onSubmit={handleSubmit} className="flex items-center gap-3">
        {/* Microphone Button */}
        <button
          type="button"
          onClick={handleMicClick}
          disabled={disabled || isLoading}
          className={cn(
            'w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200',
            isRecording
              ? 'bg-[var(--foreground)] text-[var(--background)] animate-pulse'
              : 'bg-[var(--color-beige)] text-[var(--foreground)] hover:opacity-80',
            (disabled || isLoading) && 'opacity-50 cursor-not-allowed'
          )}
        >
          {isRecording ? (
            <MicOff className="w-6 h-6" />
          ) : (
            <Mic className="w-6 h-6" />
          )}
        </button>

        {/* Text Input */}
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={isRecording ? 'Listening...' : 'Type a message or tap mic to talk...'}
            disabled={disabled || isLoading || isRecording}
            className={cn(
              'w-full px-4 py-3 bg-[var(--color-beige)] border border-[var(--foreground)]/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#FF6D1F] text-[var(--foreground)] placeholder-[var(--foreground)]/40 transition-colors',
              (disabled || isLoading || isRecording) && 'opacity-50 cursor-not-allowed'
            )}
          />
          {isRecording && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-[#FF6D1F] rounded-full animate-pulse" />
                <span className="text-xs text-[#FF6D1F] font-medium">Recording</span>
              </div>
            </div>
          )}
        </div>

        {/* Send Button */}
        <button
          type="submit"
          disabled={!message.trim() || isLoading || disabled}
          className={cn(
            'w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200',
            message.trim() && !isLoading
              ? 'bg-[#FF6D1F] text-white hover:bg-[#e5621b]'
              : 'bg-[var(--color-beige)] text-[var(--foreground)]/40',
            (isLoading || disabled) && 'opacity-50 cursor-not-allowed'
          )}
        >
          {isLoading ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </button>
      </form>

      {/* Voice Recording Hint */}
      {isRecording && (
        <p className="text-center text-sm text-[var(--foreground)]/60 mt-3">
          Tap the microphone again to stop recording
        </p>
      )}
    </div>
  );
}
