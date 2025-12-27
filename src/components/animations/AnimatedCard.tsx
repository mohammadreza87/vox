'use client';

import { useRef, ReactNode, HTMLAttributes } from 'react';
import gsap from 'gsap';
import { easings, durations } from '@/lib/animations';
import { cn } from '@/shared/utils/cn';

interface AnimatedCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  hover?: 'lift' | 'glow' | 'tilt' | 'scale' | 'none';
  clickable?: boolean;
}

export function AnimatedCard({
  children,
  className,
  hover = 'lift',
  clickable = false,
  ...props
}: AnimatedCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    if (!cardRef.current || hover === 'none') return;

    switch (hover) {
      case 'lift':
        gsap.to(cardRef.current, {
          y: -4,
          scale: 1.01,
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.15)',
          duration: durations.fast,
          ease: easings.smooth,
        });
        break;
      case 'scale':
        gsap.to(cardRef.current, {
          scale: 1.02,
          duration: durations.fast,
          ease: easings.smooth,
        });
        break;
      case 'glow':
        if (glowRef.current) {
          gsap.to(glowRef.current, {
            opacity: 1,
            duration: durations.fast,
            ease: easings.smooth,
          });
        }
        break;
    }
  };

  const handleMouseLeave = () => {
    if (!cardRef.current || hover === 'none') return;

    gsap.to(cardRef.current, {
      y: 0,
      scale: 1,
      boxShadow: '0 0 0 rgba(0, 0, 0, 0)',
      rotateX: 0,
      rotateY: 0,
      duration: durations.fast,
      ease: easings.smooth,
    });

    if (glowRef.current) {
      gsap.to(glowRef.current, {
        opacity: 0,
        duration: durations.fast,
        ease: easings.smooth,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!cardRef.current || hover !== 'tilt') return;

    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = (y - centerY) / 20;
    const rotateY = (centerX - x) / 20;

    gsap.to(cardRef.current, {
      rotateX,
      rotateY,
      duration: durations.instant,
      ease: easings.smooth,
      transformPerspective: 1000,
    });
  };

  const handlePointerDown = () => {
    if (!clickable || !cardRef.current) return;
    gsap.to(cardRef.current, {
      scale: 0.98,
      duration: durations.instant,
      ease: easings.snap,
    });
  };

  const handlePointerUp = () => {
    if (!clickable || !cardRef.current) return;
    gsap.to(cardRef.current, {
      scale: hover === 'scale' ? 1.02 : 1.01,
      duration: durations.fast,
      ease: easings.overshoot,
    });
  };

  return (
    <div
      ref={cardRef}
      className={cn(
        'liquid-card rounded-2xl relative overflow-hidden',
        clickable && 'cursor-pointer',
        className
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      style={{ transformStyle: 'preserve-3d' }}
      {...props}
    >
      {/* Glow effect overlay */}
      {hover === 'glow' && (
        <div
          ref={glowRef}
          className="absolute inset-0 opacity-0 pointer-events-none"
          style={{
            background: 'radial-gradient(circle at 50% 50%, rgba(255, 109, 31, 0.15), transparent 70%)',
          }}
        />
      )}
      {children}
    </div>
  );
}
