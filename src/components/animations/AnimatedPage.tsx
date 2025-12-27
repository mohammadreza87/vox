'use client';

import { useRef, useEffect, ReactNode } from 'react';
import gsap from 'gsap';
import { easings, durations } from '@/lib/animations';

interface AnimatedPageProps {
  children: ReactNode;
  className?: string;
  animation?: 'fadeUp' | 'fadeIn' | 'slideRight' | 'slideLeft' | 'scale' | 'blur';
  delay?: number;
  duration?: number;
}

export function AnimatedPage({
  children,
  className = '',
  animation = 'fadeUp',
  delay = 0,
  duration = durations.normal,
}: AnimatedPageProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const element = ref.current;

    // Initial state based on animation type
    const initialStates: Record<string, gsap.TweenVars> = {
      fadeUp: { opacity: 0, y: 40 },
      fadeIn: { opacity: 0 },
      slideRight: { opacity: 0, x: 60 },
      slideLeft: { opacity: 0, x: -60 },
      scale: { opacity: 0, scale: 0.95 },
      blur: { opacity: 0, filter: 'blur(10px)' },
    };

    // Animate state based on animation type
    const animateStates: Record<string, gsap.TweenVars> = {
      fadeUp: { opacity: 1, y: 0 },
      fadeIn: { opacity: 1 },
      slideRight: { opacity: 1, x: 0 },
      slideLeft: { opacity: 1, x: 0 },
      scale: { opacity: 1, scale: 1 },
      blur: { opacity: 1, filter: 'blur(0px)' },
    };

    gsap.set(element, initialStates[animation]);
    gsap.to(element, {
      ...animateStates[animation],
      duration,
      delay,
      ease: easings.apple,
    });
  }, [animation, delay, duration]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

// Staggered children animation
interface AnimatedListProps {
  children: ReactNode;
  className?: string;
  animation?: 'fadeUp' | 'fadeIn' | 'scaleUp' | 'slideLeft' | 'slideRight';
  stagger?: number;
  delay?: number;
}

export function AnimatedList({
  children,
  className = '',
  animation = 'fadeUp',
  stagger = durations.stagger,
  delay = 0,
}: AnimatedListProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const children = ref.current.children;
    if (children.length === 0) return;

    const initialStates: Record<string, gsap.TweenVars> = {
      fadeUp: { opacity: 0, y: 30 },
      fadeIn: { opacity: 0 },
      scaleUp: { opacity: 0, scale: 0.9 },
      slideLeft: { opacity: 0, x: 40 },
      slideRight: { opacity: 0, x: -40 },
    };

    const animateStates: Record<string, gsap.TweenVars> = {
      fadeUp: { opacity: 1, y: 0 },
      fadeIn: { opacity: 1 },
      scaleUp: { opacity: 1, scale: 1 },
      slideLeft: { opacity: 1, x: 0 },
      slideRight: { opacity: 1, x: 0 },
    };

    gsap.set(children, initialStates[animation]);
    gsap.to(children, {
      ...animateStates[animation],
      duration: durations.normal,
      stagger,
      delay,
      ease: easings.apple,
    });
  }, [animation, stagger, delay]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

// Scroll-triggered animation
interface ScrollAnimationProps {
  children: ReactNode;
  className?: string;
  animation?: 'fadeUp' | 'fadeIn' | 'scaleUp' | 'slideLeft' | 'slideRight';
  threshold?: number;
  once?: boolean;
}

export function ScrollAnimation({
  children,
  className = '',
  animation = 'fadeUp',
  threshold = 0.2,
  once = true,
}: ScrollAnimationProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const element = ref.current;
    let hasAnimated = false;

    const initialStates: Record<string, gsap.TweenVars> = {
      fadeUp: { opacity: 0, y: 40 },
      fadeIn: { opacity: 0 },
      scaleUp: { opacity: 0, scale: 0.9 },
      slideLeft: { opacity: 0, x: 50 },
      slideRight: { opacity: 0, x: -50 },
    };

    const animateStates: Record<string, gsap.TweenVars> = {
      fadeUp: { opacity: 1, y: 0 },
      fadeIn: { opacity: 1 },
      scaleUp: { opacity: 1, scale: 1 },
      slideLeft: { opacity: 1, x: 0 },
      slideRight: { opacity: 1, x: 0 },
    };

    gsap.set(element, initialStates[animation]);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (once && hasAnimated) return;
            hasAnimated = true;

            gsap.to(entry.target, {
              ...animateStates[animation],
              duration: durations.normal,
              ease: easings.apple,
            });

            if (once) {
              observer.unobserve(entry.target);
            }
          } else if (!once) {
            hasAnimated = false;
            gsap.set(entry.target, initialStates[animation]);
          }
        });
      },
      { threshold }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [animation, threshold, once]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
