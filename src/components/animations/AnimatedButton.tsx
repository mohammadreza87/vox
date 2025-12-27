'use client';

import { useRef, ReactNode, ButtonHTMLAttributes } from 'react';
import gsap from 'gsap';
import { easings, durations } from '@/lib/animations';
import { cn } from '@/shared/utils/cn';

interface AnimatedButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  magnetic?: boolean;
  magneticIntensity?: number;
}

export function AnimatedButton({
  children,
  className,
  variant = 'primary',
  size = 'md',
  magnetic = false,
  magneticIntensity = 0.3,
  disabled,
  ...props
}: AnimatedButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);

  const handlePointerDown = () => {
    if (disabled || !buttonRef.current) return;
    gsap.to(buttonRef.current, {
      scale: 0.95,
      duration: durations.instant,
      ease: easings.snap,
    });
  };

  const handlePointerUp = () => {
    if (disabled || !buttonRef.current) return;
    gsap.to(buttonRef.current, {
      scale: 1,
      duration: durations.fast,
      ease: easings.overshoot,
    });
  };

  const handleMouseEnter = () => {
    if (disabled || !buttonRef.current) return;
    gsap.to(buttonRef.current, {
      scale: 1.02,
      duration: durations.fast,
      ease: easings.smooth,
    });
  };

  const handleMouseLeave = () => {
    if (disabled || !buttonRef.current) return;
    gsap.to(buttonRef.current, {
      scale: 1,
      x: 0,
      y: 0,
      duration: durations.fast,
      ease: easings.smooth,
    });
    if (contentRef.current) {
      gsap.to(contentRef.current, {
        x: 0,
        y: 0,
        duration: durations.fast,
        ease: easings.smooth,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!magnetic || disabled || !buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const x = (e.clientX - centerX) * magneticIntensity;
    const y = (e.clientY - centerY) * magneticIntensity;

    gsap.to(buttonRef.current, {
      x,
      y,
      duration: durations.fast,
      ease: easings.smooth,
    });

    if (contentRef.current) {
      gsap.to(contentRef.current, {
        x: x * 0.5,
        y: y * 0.5,
        duration: durations.fast,
        ease: easings.smooth,
      });
    }
  };

  const variantClasses = {
    primary: 'liquid-button',
    secondary: 'liquid-card hover:bg-white/20',
    ghost: 'hover:bg-white/10',
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg',
  };

  return (
    <button
      ref={buttonRef}
      className={cn(
        'relative rounded-xl font-medium transition-colors',
        variantClasses[variant],
        sizeClasses[size],
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handleMouseLeave}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      {...props}
    >
      <span ref={contentRef} className="relative z-10 flex items-center justify-center gap-2">
        {children}
      </span>
    </button>
  );
}
