'use client';

import { useRef, useEffect, useCallback } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import {
  easings,
  durations,
  animateIn,
  animateOut,
  staggerIn,
  hoverScale,
  hoverReset,
  buttonPress,
  buttonRelease,
  modalIn,
  modalOut,
  shake,
  pulse,
  magneticMove,
  magneticReset,
} from '@/lib/animations';

// Hook for page/component entrance animation
export const useEntranceAnimation = (
  type: 'fadeUp' | 'fadeIn' | 'scaleUp' | 'slideLeft' | 'slideRight' | 'blur' = 'fadeUp',
  options: {
    delay?: number;
    duration?: number;
    autoPlay?: boolean;
  } = {}
) => {
  const ref = useRef<HTMLDivElement>(null);
  const { delay = 0, duration = durations.normal, autoPlay = true } = options;

  useGSAP(() => {
    if (ref.current && autoPlay) {
      animateIn(ref.current, { type, delay, duration });
    }
  }, { scope: ref, dependencies: [autoPlay] });

  const animate = useCallback(() => {
    if (ref.current) {
      animateIn(ref.current, { type, delay, duration });
    }
  }, [type, delay, duration]);

  return { ref, animate };
};

// Hook for staggered list animation
export const useStaggerAnimation = (
  type: 'fadeUp' | 'fadeIn' | 'scaleUp' | 'slideLeft' | 'slideRight' = 'fadeUp',
  options: {
    stagger?: number;
    delay?: number;
    autoPlay?: boolean;
  } = {}
) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { stagger = durations.stagger, delay = 0, autoPlay = true } = options;

  useGSAP(() => {
    if (containerRef.current && autoPlay) {
      const children = containerRef.current.children;
      if (children.length > 0) {
        staggerIn(children, { type, stagger, delay });
      }
    }
  }, { scope: containerRef, dependencies: [autoPlay] });

  const animate = useCallback(() => {
    if (containerRef.current) {
      const children = containerRef.current.children;
      if (children.length > 0) {
        staggerIn(children, { type, stagger, delay });
      }
    }
  }, [type, stagger, delay]);

  return { containerRef, animate };
};

// Hook for hover animations
export const useHoverAnimation = (scale = 1.02) => {
  const ref = useRef<HTMLElement>(null);

  const onMouseEnter = useCallback(() => {
    if (ref.current) {
      hoverScale(ref.current, scale);
    }
  }, [scale]);

  const onMouseLeave = useCallback(() => {
    if (ref.current) {
      hoverReset(ref.current);
    }
  }, []);

  return { ref, onMouseEnter, onMouseLeave };
};

// Hook for button press animation
export const useButtonAnimation = () => {
  const ref = useRef<HTMLButtonElement>(null);

  const onPointerDown = useCallback(() => {
    if (ref.current) {
      buttonPress(ref.current);
    }
  }, []);

  const onPointerUp = useCallback(() => {
    if (ref.current) {
      buttonRelease(ref.current);
    }
  }, []);

  const onPointerLeave = useCallback(() => {
    if (ref.current) {
      buttonRelease(ref.current);
    }
  }, []);

  return { ref, onPointerDown, onPointerUp, onPointerLeave };
};

// Hook for modal/dialog animations
export const useModalAnimation = () => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  const animateOpen = useCallback(() => {
    if (overlayRef.current && contentRef.current) {
      timelineRef.current = modalIn(overlayRef.current, contentRef.current);
      return timelineRef.current;
    }
    return null;
  }, []);

  const animateClose = useCallback(() => {
    if (overlayRef.current && contentRef.current) {
      return modalOut(overlayRef.current, contentRef.current);
    }
    return null;
  }, []);

  return { overlayRef, contentRef, animateOpen, animateClose };
};

// Hook for magnetic button effect
export const useMagneticEffect = (intensity = 0.3) => {
  const ref = useRef<HTMLElement>(null);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return;

    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const x = e.clientX - centerX;
    const y = e.clientY - centerY;

    magneticMove(ref.current, x, y, intensity);
  }, [intensity]);

  const onMouseLeave = useCallback(() => {
    if (ref.current) {
      magneticReset(ref.current);
    }
  }, []);

  return { ref, onMouseMove, onMouseLeave };
};

// Hook for scroll-triggered animations
export const useScrollAnimation = (
  type: 'fadeUp' | 'fadeIn' | 'scaleUp' | 'slideLeft' | 'slideRight' = 'fadeUp',
  options: {
    threshold?: number;
    once?: boolean;
  } = {}
) => {
  const ref = useRef<HTMLDivElement>(null);
  const { threshold = 0.2, once = true } = options;
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!ref.current) return;

    const element = ref.current;

    // Set initial hidden state
    const initialStates: Record<string, gsap.TweenVars> = {
      fadeUp: { opacity: 0, y: 30 },
      fadeIn: { opacity: 0 },
      scaleUp: { opacity: 0, scale: 0.9 },
      slideLeft: { opacity: 0, x: 50 },
      slideRight: { opacity: 0, x: -50 },
    };
    gsap.set(element, initialStates[type]);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (once && hasAnimated.current) return;

            hasAnimated.current = true;
            animateIn(entry.target, { type });

            if (once) {
              observer.unobserve(entry.target);
            }
          } else if (!once) {
            hasAnimated.current = false;
            // Reset to initial state when out of view
            gsap.set(entry.target, initialStates[type]);
          }
        });
      },
      { threshold }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [type, threshold, once]);

  return ref;
};

// Hook for shake animation (errors)
export const useShakeAnimation = () => {
  const ref = useRef<HTMLElement>(null);

  const triggerShake = useCallback(() => {
    if (ref.current) {
      shake(ref.current);
    }
  }, []);

  return { ref, triggerShake };
};

// Hook for pulse animation
export const usePulseAnimation = (scale = 1.05) => {
  const ref = useRef<HTMLElement>(null);

  const triggerPulse = useCallback(() => {
    if (ref.current) {
      pulse(ref.current, scale);
    }
  }, [scale]);

  return { ref, triggerPulse };
};

// Hook for animated presence (mount/unmount)
export const useAnimatedPresence = (
  isVisible: boolean,
  options: {
    enterType?: 'fadeUp' | 'fadeIn' | 'scaleUp' | 'slideLeft' | 'slideRight' | 'blur';
    exitType?: 'fadeDown' | 'fadeOut' | 'scaleDown' | 'slideLeft' | 'slideRight' | 'blur';
    duration?: number;
    onExitComplete?: () => void;
  } = {}
) => {
  const ref = useRef<HTMLDivElement>(null);
  const {
    enterType = 'fadeUp',
    exitType = 'fadeDown',
    duration = durations.normal,
    onExitComplete,
  } = options;

  useEffect(() => {
    if (!ref.current) return;

    if (isVisible) {
      animateIn(ref.current, { type: enterType, duration });
    } else {
      animateOut(ref.current, {
        type: exitType,
        duration: durations.fast,
        onComplete: onExitComplete,
      });
    }
  }, [isVisible, enterType, exitType, duration, onExitComplete]);

  return ref;
};

// Hook for tab content animation (triggers on dependency change)
export const useTabAnimation = (
  activeTab: string,
  options: {
    animation?: 'fadeUp' | 'fadeIn' | 'scaleUp' | 'slideLeft' | 'slideRight';
    duration?: number;
  } = {}
) => {
  const ref = useRef<HTMLDivElement>(null);
  const { animation = 'fadeUp', duration = durations.fast } = options;
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (!ref.current) return;

    // Skip animation on first render (let entrance animation handle it)
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const element = ref.current;

    // Animation states
    const initialStates: Record<string, gsap.TweenVars> = {
      fadeUp: { opacity: 0, y: 20 },
      fadeIn: { opacity: 0 },
      scaleUp: { opacity: 0, scale: 0.95 },
      slideLeft: { opacity: 0, x: 30 },
      slideRight: { opacity: 0, x: -30 },
    };

    const animateStates: Record<string, gsap.TweenVars> = {
      fadeUp: { opacity: 1, y: 0 },
      fadeIn: { opacity: 1 },
      scaleUp: { opacity: 1, scale: 1 },
      slideLeft: { opacity: 1, x: 0 },
      slideRight: { opacity: 1, x: 0 },
    };

    // Set initial state and animate
    gsap.set(element, initialStates[animation]);
    gsap.to(element, {
      ...animateStates[animation],
      duration,
      ease: easings.apple,
    });

    // Also animate children with stagger if they exist
    const children = element.children;
    if (children.length > 0) {
      gsap.set(children, { opacity: 0, y: 15 });
      gsap.to(children, {
        opacity: 1,
        y: 0,
        duration: duration * 0.8,
        stagger: 0.03,
        ease: easings.apple,
        delay: 0.05,
      });
    }
  }, [activeTab, animation, duration]);

  return ref;
};

// Hook for number counter animation
export const useCounterAnimation = (
  endValue: number,
  options: {
    duration?: number;
    prefix?: string;
    suffix?: string;
    decimals?: number;
    autoStart?: boolean;
  } = {}
) => {
  const ref = useRef<HTMLSpanElement>(null);
  const {
    duration = durations.dramatic,
    prefix = '',
    suffix = '',
    decimals = 0,
    autoStart = true,
  } = options;
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!ref.current || !autoStart || hasAnimated.current) return;

    const element = ref.current;
    hasAnimated.current = true;

    const obj = { value: 0 };
    gsap.to(obj, {
      value: endValue,
      duration,
      ease: easings.smooth,
      onUpdate: () => {
        element.textContent = `${prefix}${obj.value.toFixed(decimals)}${suffix}`;
      },
    });
  }, [endValue, duration, prefix, suffix, decimals, autoStart]);

  const restart = useCallback(() => {
    if (!ref.current) return;

    const element = ref.current;
    const obj = { value: 0 };

    gsap.to(obj, {
      value: endValue,
      duration,
      ease: easings.smooth,
      onUpdate: () => {
        element.textContent = `${prefix}${obj.value.toFixed(decimals)}${suffix}`;
      },
    });
  }, [endValue, duration, prefix, suffix, decimals]);

  return { ref, restart };
};
