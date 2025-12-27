'use client';

import { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  dot?: boolean;
}

export function Badge({
  variant = 'default',
  size = 'md',
  children,
  dot = false,
  className,
  ...props
}: BadgeProps) {
  const baseStyles =
    'inline-flex items-center justify-center font-medium rounded-[var(--radius-full)] transition-colors';

  const variants = {
    default:
      'bg-[var(--glass-bg)] text-[var(--color-text-primary)] border border-[var(--glass-border)]',
    primary:
      'bg-[var(--color-primary)] text-white shadow-[0_2px_8px_rgba(255,109,31,0.3)]',
    success:
      'bg-[var(--color-success-bg)] text-[var(--color-success)] border border-[var(--color-success)]/20',
    warning:
      'bg-[var(--color-warning-bg)] text-[var(--color-warning)] border border-[var(--color-warning)]/20',
    error:
      'bg-[var(--color-error-bg)] text-[var(--color-error)] border border-[var(--color-error)]/20',
    info:
      'bg-[var(--color-info-bg)] text-[var(--color-info)] border border-[var(--color-info)]/20',
    outline:
      'bg-transparent text-[var(--color-text-primary)] border border-[var(--color-text-tertiary)]',
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-base',
  };

  return (
    <span
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full mr-1.5',
            variant === 'primary' && 'bg-white',
            variant === 'success' && 'bg-[var(--color-success)]',
            variant === 'warning' && 'bg-[var(--color-warning)]',
            variant === 'error' && 'bg-[var(--color-error)]',
            variant === 'info' && 'bg-[var(--color-info)]',
            (variant === 'default' || variant === 'outline') &&
              'bg-[var(--color-text-secondary)]'
          )}
        />
      )}
      {children}
    </span>
  );
}
