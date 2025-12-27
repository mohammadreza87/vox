'use client';

import { ButtonHTMLAttributes, forwardRef, useEffect } from 'react';
import { cn } from '@/shared/utils/cn';
import { usePlatformStore } from '@/stores/platformStore';
import { setupTelegramMainButton } from '@/lib/platform';
import { Spinner } from './Spinner';

interface PlatformButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  /** If true on Telegram, shows as native MainButton instead of inline */
  useNativeButton?: boolean;
  /** Color for Telegram MainButton */
  telegramColor?: string;
}

/**
 * Platform-aware button component
 * Can optionally use Telegram's native MainButton
 */
export const PlatformButton = forwardRef<HTMLButtonElement, PlatformButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled = false,
      useNativeButton = false,
      telegramColor,
      className,
      onClick,
      ...props
    },
    ref
  ) => {
    const { info, hapticFeedback } = usePlatformStore();

    // Setup Telegram MainButton if requested
    useEffect(() => {
      if (!info.isTelegram || !useNativeButton || typeof children !== 'string') {
        return;
      }

      const handleClick = () => {
        if (disabled || loading) return;
        hapticFeedback('medium');
        onClick?.(new MouseEvent('click') as unknown as React.MouseEvent<HTMLButtonElement>);
      };

      const cleanup = setupTelegramMainButton(children, handleClick, {
        color: telegramColor || (variant === 'primary' ? '#FF6D1F' : undefined),
        isActive: !disabled && !loading,
      });

      return cleanup;
    }, [info.isTelegram, useNativeButton, children, disabled, loading, onClick, variant, telegramColor, hapticFeedback]);

    // Don't render inline button if using Telegram native button
    if (info.isTelegram && useNativeButton) {
      return null;
    }

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled || loading) return;
      // Haptic feedback on button press
      hapticFeedback('light');
      onClick?.(e);
    };

    const baseStyles = 'inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

    const variants = {
      primary: 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)] focus:ring-[var(--color-primary)]/50',
      secondary: 'bg-[var(--glass-bg)] text-[var(--color-text-primary)] border border-[var(--glass-border)] hover:bg-[var(--glass-bg-strong)] focus:ring-[var(--glass-border)]',
      ghost: 'text-[var(--color-text-primary)] hover:bg-[var(--glass-bg)] focus:ring-[var(--glass-border)]',
      danger: 'bg-[var(--color-error)] text-white hover:bg-red-600 active:bg-red-700 focus:ring-[var(--color-error)]/50',
    };

    const sizes = {
      sm: 'px-3 py-1.5 text-sm rounded-lg gap-1.5',
      md: 'px-4 py-2.5 text-base rounded-xl gap-2',
      lg: 'px-6 py-3 text-lg rounded-xl gap-2.5',
    };

    return (
      <button
        ref={ref}
        onClick={handleClick}
        disabled={disabled || loading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {loading ? (
          <>
            <Spinner size="sm" />
            <span>Loading...</span>
          </>
        ) : (
          children
        )}
      </button>
    );
  }
);

PlatformButton.displayName = 'PlatformButton';
