'use client';

import { cn } from '@/shared/utils/cn';

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  variant?: 'default' | 'liquid' | 'dashed';
  label?: string;
  className?: string;
}

export function Divider({
  orientation = 'horizontal',
  variant = 'liquid',
  label,
  className,
}: DividerProps) {
  const isHorizontal = orientation === 'horizontal';

  const baseStyles = {
    horizontal: 'w-full',
    vertical: 'h-full',
  };

  const variants = {
    default: isHorizontal
      ? 'h-px bg-[var(--glass-border)]'
      : 'w-px bg-[var(--glass-border)]',
    liquid: isHorizontal ? 'liquid-divider' : 'w-px liquid-divider-vertical',
    dashed: isHorizontal
      ? 'h-px border-t border-dashed border-[var(--color-text-disabled)]'
      : 'w-px border-l border-dashed border-[var(--color-text-disabled)]',
  };

  if (label && isHorizontal) {
    return (
      <div className={cn('flex items-center gap-4', className)}>
        <div className={cn('flex-1', variants[variant])} />
        <span className="text-sm text-[var(--color-text-tertiary)] px-2">
          {label}
        </span>
        <div className={cn('flex-1', variants[variant])} />
      </div>
    );
  }

  return (
    <div
      className={cn(baseStyles[orientation], variants[variant], className)}
      role="separator"
      aria-orientation={orientation}
    />
  );
}
