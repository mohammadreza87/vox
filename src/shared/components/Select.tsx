'use client';

import { SelectHTMLAttributes, forwardRef, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  options: SelectOption[];
  placeholder?: string;
  variant?: 'default' | 'liquid' | 'glass';
  selectSize?: 'sm' | 'md' | 'lg';
  error?: string;
  label?: string;
  leftIcon?: ReactNode;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      options,
      placeholder,
      variant = 'liquid',
      selectSize = 'md',
      error,
      label,
      leftIcon,
      className,
      id,
      ...props
    },
    ref
  ) => {
    const selectId = id || props.name;

    const baseStyles =
      'w-full appearance-none transition-all outline-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

    const variants = {
      default:
        'bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-[var(--radius-xl)] focus:border-[var(--color-primary)] focus:shadow-[var(--shadow-input-focus)]',
      liquid:
        'bg-[rgba(255,255,255,0.5)] dark:bg-[rgba(50,50,50,0.5)] backdrop-blur-[16px] border border-[rgba(255,255,255,0.4)] dark:border-[var(--glass-border)] rounded-[var(--radius-xl)] focus:bg-[rgba(255,255,255,0.7)] dark:focus:bg-[rgba(60,60,60,0.7)] focus:border-[rgba(255,109,31,0.5)] focus:shadow-[var(--shadow-input-focus)]',
      glass:
        'bg-[var(--glass-bg)] backdrop-blur-[10px] border border-[var(--glass-border)] rounded-[var(--radius-xl)] focus:bg-[var(--glass-bg-strong)] focus:border-[var(--color-primary)] focus:shadow-[var(--shadow-input-focus)]',
    };

    const sizes = {
      sm: 'px-3 py-2 text-sm pr-8',
      md: 'px-4 py-3 text-base pr-10',
      lg: 'px-5 py-4 text-lg pr-12',
    };

    const errorStyles = error
      ? 'border-[var(--color-error)] focus:border-[var(--color-error)] focus:shadow-[var(--shadow-input-error)]'
      : '';

    const iconPadding = leftIcon ? 'pl-10' : '';

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={selectId}
            className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none">
              {leftIcon}
            </div>
          )}
          <select
            ref={ref}
            id={selectId}
            className={cn(
              baseStyles,
              variants[variant],
              sizes[selectSize],
              errorStyles,
              iconPadding,
              'text-[var(--color-text-primary)]',
              className
            )}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </option>
            ))}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--color-text-tertiary)]">
            <ChevronDown className="w-5 h-5" />
          </div>
        </div>
        {error && (
          <p className="mt-1.5 text-sm text-[var(--color-error)]">{error}</p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';

export { Select };
