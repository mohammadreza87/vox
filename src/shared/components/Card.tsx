'use client';

import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/shared/utils/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'interactive' | 'elevated';
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', children, ...props }, ref) => {
    const variants = {
      default: 'bg-[var(--color-beige)] border border-[var(--foreground)]/10 transition-colors',
      interactive: 'bg-[var(--color-beige)] border border-[var(--foreground)]/10 hover:border-[#FF6D1F]/50 hover:shadow-lg cursor-pointer transition-all duration-200',
      elevated: 'bg-[var(--color-beige)] shadow-xl border border-[var(--foreground)]/5 transition-colors',
    };

    return (
      <div
        ref={ref}
        className={cn('rounded-3xl p-6', variants[variant], className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

export { Card };
