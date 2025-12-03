'use client';

import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/shared/utils/cn';

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  alt?: string;
  fallback?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, src, alt, fallback, size = 'md', ...props }, ref) => {
    const sizes = {
      sm: 'w-10 h-10 text-lg',
      md: 'w-14 h-14 text-2xl',
      lg: 'w-20 h-20 text-4xl',
      xl: 'w-28 h-28 text-5xl',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'rounded-full flex items-center justify-center overflow-hidden bg-[#FF6D1F]',
          sizes[size],
          className
        )}
        {...props}
      >
        {src ? (
          <img
            src={src}
            alt={alt || 'Avatar'}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-white">{fallback || '?'}</span>
        )}
      </div>
    );
  }
);

Avatar.displayName = 'Avatar';

export { Avatar };
