'use client';

import { ReactNode, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { usePlatformStore } from '@/stores/platformStore';
import { setupTelegramBackButton } from '@/lib/platform';

interface PlatformHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  showBack?: boolean;
  rightContent?: ReactNode;
  className?: string;
  transparent?: boolean;
}

/**
 * Platform-aware header component
 * Adapts to web and Telegram Mini App environments
 */
export function PlatformHeader({
  title,
  subtitle,
  onBack,
  showBack = false,
  rightContent,
  className,
  transparent = false,
}: PlatformHeaderProps) {
  const { info, goBack } = usePlatformStore();

  // Setup Telegram back button
  useEffect(() => {
    if (!info.isTelegram || !showBack) return;

    const handleBack = () => {
      if (onBack) {
        onBack();
      } else {
        goBack();
      }
    };

    const cleanup = setupTelegramBackButton(handleBack);
    return cleanup;
  }, [info.isTelegram, showBack, onBack, goBack]);

  const handleBackClick = () => {
    if (onBack) {
      onBack();
    } else {
      goBack();
    }
  };

  return (
    <header
      className={cn(
        'sticky top-0 z-50',
        'pt-[env(safe-area-inset-top)]',
        !transparent && 'bg-[var(--color-beige)]/80 backdrop-blur-xl',
        !transparent && 'border-b border-[var(--glass-border)]',
        className
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 min-h-[56px]">
        {/* Left section - Back button */}
        <div className="flex items-center gap-3 flex-1">
          {showBack && !info.isTelegram && (
            <button
              onClick={handleBackClick}
              className="p-2 -ml-2 rounded-xl hover:bg-[var(--glass-bg)] transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}

          {/* Title */}
          <div className="flex flex-col">
            <h1 className="font-semibold text-lg leading-tight">{title}</h1>
            {subtitle && (
              <span className="text-sm text-[var(--color-text-secondary)]">
                {subtitle}
              </span>
            )}
          </div>
        </div>

        {/* Right section */}
        {rightContent && (
          <div className="flex items-center gap-2">{rightContent}</div>
        )}
      </div>
    </header>
  );
}
