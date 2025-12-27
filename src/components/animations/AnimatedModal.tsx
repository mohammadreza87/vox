'use client';

import { useRef, useEffect, ReactNode } from 'react';
import gsap from 'gsap';
import { easings, durations } from '@/lib/animations';
import { cn } from '@/shared/utils/cn';

interface AnimatedModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  overlayClassName?: string;
  animation?: 'scale' | 'slideUp' | 'slideDown' | 'blur';
}

export function AnimatedModal({
  isOpen,
  onClose,
  children,
  className,
  overlayClassName,
  animation = 'scale',
}: AnimatedModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isAnimating = useRef(false);

  useEffect(() => {
    if (isAnimating.current) return;

    if (isOpen) {
      isAnimating.current = true;

      // Show elements
      if (overlayRef.current) {
        overlayRef.current.style.display = 'flex';
      }

      const tl = gsap.timeline({
        onComplete: () => {
          isAnimating.current = false;
        },
      });

      // Animate overlay
      tl.fromTo(
        overlayRef.current,
        { opacity: 0 },
        { opacity: 1, duration: durations.fast, ease: easings.smooth }
      );

      // Animate content based on animation type
      const contentAnimations: Record<string, [gsap.TweenVars, gsap.TweenVars]> = {
        scale: [
          { opacity: 0, scale: 0.9, y: 20 },
          { opacity: 1, scale: 1, y: 0 },
        ],
        slideUp: [
          { opacity: 0, y: 100 },
          { opacity: 1, y: 0 },
        ],
        slideDown: [
          { opacity: 0, y: -100 },
          { opacity: 1, y: 0 },
        ],
        blur: [
          { opacity: 0, filter: 'blur(10px)', scale: 1.05 },
          { opacity: 1, filter: 'blur(0px)', scale: 1 },
        ],
      };

      const [from, to] = contentAnimations[animation];

      tl.fromTo(
        contentRef.current,
        from,
        { ...to, duration: durations.normal, ease: easings.apple },
        '-=0.15'
      );
    } else {
      if (!overlayRef.current) return;

      isAnimating.current = true;

      const tl = gsap.timeline({
        onComplete: () => {
          if (overlayRef.current) {
            overlayRef.current.style.display = 'none';
          }
          isAnimating.current = false;
        },
      });

      // Animate out content
      const exitAnimations: Record<string, gsap.TweenVars> = {
        scale: { opacity: 0, scale: 0.95, y: 10 },
        slideUp: { opacity: 0, y: 50 },
        slideDown: { opacity: 0, y: -50 },
        blur: { opacity: 0, filter: 'blur(10px)' },
      };

      tl.to(contentRef.current, {
        ...exitAnimations[animation],
        duration: durations.fast,
        ease: easings.smooth,
      });

      tl.to(
        overlayRef.current,
        { opacity: 0, duration: durations.fast, ease: easings.smooth },
        '-=0.1'
      );
    }
  }, [isOpen, animation]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  return (
    <div
      ref={overlayRef}
      className={cn(
        'fixed inset-0 z-50 hidden items-center justify-center p-4',
        'bg-black/50 backdrop-blur-sm',
        overlayClassName
      )}
      onClick={handleOverlayClick}
    >
      <div
        ref={contentRef}
        className={cn(
          'liquid-glass rounded-2xl max-w-lg w-full max-h-[90vh] overflow-auto',
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

// Bottom sheet variant
interface AnimatedSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export function AnimatedSheet({
  isOpen,
  onClose,
  children,
  className,
}: AnimatedSheetProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const isAnimating = useRef(false);

  useEffect(() => {
    if (isAnimating.current) return;

    if (isOpen) {
      isAnimating.current = true;

      if (overlayRef.current) {
        overlayRef.current.style.display = 'flex';
      }

      const tl = gsap.timeline({
        onComplete: () => {
          isAnimating.current = false;
        },
      });

      tl.fromTo(
        overlayRef.current,
        { opacity: 0 },
        { opacity: 1, duration: durations.fast, ease: easings.smooth }
      );

      tl.fromTo(
        sheetRef.current,
        { y: '100%' },
        { y: 0, duration: durations.normal, ease: easings.apple },
        '-=0.15'
      );
    } else {
      if (!overlayRef.current) return;

      isAnimating.current = true;

      const tl = gsap.timeline({
        onComplete: () => {
          if (overlayRef.current) {
            overlayRef.current.style.display = 'none';
          }
          isAnimating.current = false;
        },
      });

      tl.to(sheetRef.current, {
        y: '100%',
        duration: durations.fast,
        ease: easings.smooth,
      });

      tl.to(
        overlayRef.current,
        { opacity: 0, duration: durations.fast, ease: easings.smooth },
        '-=0.1'
      );
    }
  }, [isOpen]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 hidden items-end justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleOverlayClick}
    >
      <div
        ref={sheetRef}
        className={cn(
          'liquid-glass rounded-t-3xl w-full max-h-[90vh] overflow-auto',
          'pb-[env(safe-area-inset-bottom)]',
          className
        )}
      >
        {/* Drag handle */}
        <div className="flex justify-center py-3">
          <div className="w-10 h-1 rounded-full bg-[var(--foreground)]/20" />
        </div>
        {children}
      </div>
    </div>
  );
}
