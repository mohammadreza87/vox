'use client';

import { InputHTMLAttributes, forwardRef, ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'liquid' | 'glass';
  inputSize?: 'sm' | 'md' | 'lg';
  error?: string;
  label?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      variant = 'liquid',
      inputSize = 'md',
      error,
      label,
      leftIcon,
      rightIcon,
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || props.name;

    const baseStyles =
      'w-full transition-all outline-none disabled:opacity-50 disabled:cursor-not-allowed';

    const variants = {
      default:
        'bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-[var(--radius-xl)] focus:border-[var(--color-primary)] focus:shadow-[var(--shadow-input-focus)]',
      liquid:
        'liquid-input bg-[rgba(255,255,255,0.5)] dark:bg-[rgba(50,50,50,0.5)] backdrop-blur-[16px] border border-[rgba(255,255,255,0.4)] dark:border-[var(--glass-border)] rounded-[var(--radius-xl)] focus:bg-[rgba(255,255,255,0.7)] dark:focus:bg-[rgba(60,60,60,0.7)] focus:border-[rgba(255,109,31,0.5)] focus:shadow-[var(--shadow-input-focus)]',
      glass:
        'glass-input bg-[var(--glass-bg)] backdrop-blur-[10px] border border-[var(--glass-border)] rounded-[var(--radius-xl)] focus:bg-[var(--glass-bg-strong)] focus:border-[var(--color-primary)] focus:shadow-[var(--shadow-input-focus)]',
    };

    const sizes = {
      sm: 'px-3 py-2 text-sm',
      md: 'px-4 py-3 text-base',
      lg: 'px-5 py-4 text-lg',
    };

    const errorStyles = error
      ? 'border-[var(--color-error)] focus:border-[var(--color-error)] focus:shadow-[var(--shadow-input-error)]'
      : '';

    const iconPadding = {
      left: leftIcon ? 'pl-10' : '',
      right: rightIcon ? 'pr-10' : '',
    };

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              baseStyles,
              variants[variant],
              sizes[inputSize],
              errorStyles,
              iconPadding.left,
              iconPadding.right,
              'placeholder:text-[var(--color-text-tertiary)]',
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]">
              {rightIcon}
            </div>
          )}
        </div>
        {error && (
          <p className="mt-1.5 text-sm text-[var(--color-error)]">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input };
