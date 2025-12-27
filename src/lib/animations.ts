'use client';

import gsap from 'gsap';

// Register GSAP plugins
if (typeof window !== 'undefined') {
  gsap.registerPlugin();
}

// 2025 Animation Trends: Smooth, organic, and purposeful
// Using custom easing curves for natural feel

// Custom easing functions - 2025 trends favor organic, spring-like motion
export const easings = {
  // Smooth spring-like ease for UI elements
  smooth: 'power2.out',
  // Elastic bounce for playful interactions
  bounce: 'elastic.out(1, 0.5)',
  // Sharp snap for quick feedback
  snap: 'power4.out',
  // Gentle ease for subtle animations
  gentle: 'power1.inOut',
  // Dramatic ease for hero animations
  dramatic: 'expo.out',
  // Back ease for overshooting effect
  overshoot: 'back.out(1.7)',
  // Custom bezier for Apple-like smoothness
  apple: 'power3.out',
};

// Animation durations following 2025 best practices
// Faster micro-interactions, purposeful longer animations
export const durations = {
  instant: 0.15,    // Micro-interactions
  fast: 0.25,       // Quick feedback
  normal: 0.4,      // Standard animations
  slow: 0.6,        // Emphasis animations
  dramatic: 0.8,    // Hero/page transitions
  stagger: 0.08,    // Stagger delay between items
};

// Page transition animations
export const pageTransitions = {
  // Fade up - most common and elegant
  fadeUp: {
    initial: { opacity: 0, y: 30 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
  },
  // Slide from right - for forward navigation
  slideRight: {
    initial: { opacity: 0, x: 100 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -100 },
  },
  // Scale fade - for modals and overlays
  scaleFade: {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
  },
  // Blur fade - premium feel
  blurFade: {
    initial: { opacity: 0, filter: 'blur(10px)' },
    animate: { opacity: 1, filter: 'blur(0px)' },
    exit: { opacity: 0, filter: 'blur(10px)' },
  },
};

// Animate element in
export const animateIn = (
  element: gsap.TweenTarget,
  options: {
    type?: 'fadeUp' | 'fadeIn' | 'scaleUp' | 'slideLeft' | 'slideRight' | 'blur';
    duration?: number;
    delay?: number;
    ease?: string;
    onComplete?: () => void;
  } = {}
) => {
  const {
    type = 'fadeUp',
    duration = durations.normal,
    delay = 0,
    ease = easings.apple,
    onComplete,
  } = options;

  const animations: Record<string, gsap.TweenVars> = {
    fadeUp: { opacity: 1, y: 0, duration, delay, ease, onComplete },
    fadeIn: { opacity: 1, duration, delay, ease, onComplete },
    scaleUp: { opacity: 1, scale: 1, duration, delay, ease: easings.overshoot, onComplete },
    slideLeft: { opacity: 1, x: 0, duration, delay, ease, onComplete },
    slideRight: { opacity: 1, x: 0, duration, delay, ease, onComplete },
    blur: { opacity: 1, filter: 'blur(0px)', duration, delay, ease, onComplete },
  };

  // Set initial state
  const initialStates: Record<string, gsap.TweenVars> = {
    fadeUp: { opacity: 0, y: 30 },
    fadeIn: { opacity: 0 },
    scaleUp: { opacity: 0, scale: 0.9 },
    slideLeft: { opacity: 0, x: 50 },
    slideRight: { opacity: 0, x: -50 },
    blur: { opacity: 0, filter: 'blur(10px)' },
  };

  gsap.set(element, initialStates[type]);
  return gsap.to(element, animations[type]);
};

// Animate element out
export const animateOut = (
  element: gsap.TweenTarget,
  options: {
    type?: 'fadeDown' | 'fadeOut' | 'scaleDown' | 'slideLeft' | 'slideRight' | 'blur';
    duration?: number;
    delay?: number;
    ease?: string;
    onComplete?: () => void;
  } = {}
) => {
  const {
    type = 'fadeDown',
    duration = durations.fast,
    delay = 0,
    ease = easings.smooth,
    onComplete,
  } = options;

  const animations: Record<string, gsap.TweenVars> = {
    fadeDown: { opacity: 0, y: 20, duration, delay, ease, onComplete },
    fadeOut: { opacity: 0, duration, delay, ease, onComplete },
    scaleDown: { opacity: 0, scale: 0.95, duration, delay, ease, onComplete },
    slideLeft: { opacity: 0, x: -50, duration, delay, ease, onComplete },
    slideRight: { opacity: 0, x: 50, duration, delay, ease, onComplete },
    blur: { opacity: 0, filter: 'blur(10px)', duration, delay, ease, onComplete },
  };

  return gsap.to(element, animations[type]);
};

// Stagger animation for lists
export const staggerIn = (
  elements: gsap.TweenTarget,
  options: {
    type?: 'fadeUp' | 'fadeIn' | 'scaleUp' | 'slideLeft' | 'slideRight';
    duration?: number;
    stagger?: number;
    delay?: number;
    ease?: string;
    onComplete?: () => void;
  } = {}
) => {
  const {
    type = 'fadeUp',
    duration = durations.normal,
    stagger = durations.stagger,
    delay = 0,
    ease = easings.apple,
    onComplete,
  } = options;

  const initialStates: Record<string, gsap.TweenVars> = {
    fadeUp: { opacity: 0, y: 30 },
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

  gsap.set(elements, initialStates[type]);
  return gsap.to(elements, {
    ...animateStates[type],
    duration,
    stagger,
    delay,
    ease,
    onComplete,
  });
};

// Hover animations
export const hoverScale = (element: gsap.TweenTarget, scale = 1.02) => {
  return gsap.to(element, {
    scale,
    duration: durations.fast,
    ease: easings.smooth,
  });
};

export const hoverReset = (element: gsap.TweenTarget) => {
  return gsap.to(element, {
    scale: 1,
    duration: durations.fast,
    ease: easings.smooth,
  });
};

// Button press animation
export const buttonPress = (element: gsap.TweenTarget) => {
  return gsap.to(element, {
    scale: 0.95,
    duration: durations.instant,
    ease: easings.snap,
  });
};

export const buttonRelease = (element: gsap.TweenTarget) => {
  return gsap.to(element, {
    scale: 1,
    duration: durations.fast,
    ease: easings.overshoot,
  });
};

// Modal/Sheet animations
export const modalIn = (overlay: gsap.TweenTarget, content: gsap.TweenTarget) => {
  const tl = gsap.timeline();

  tl.fromTo(
    overlay,
    { opacity: 0 },
    { opacity: 1, duration: durations.fast, ease: easings.smooth }
  );

  tl.fromTo(
    content,
    { opacity: 0, scale: 0.95, y: 20 },
    { opacity: 1, scale: 1, y: 0, duration: durations.normal, ease: easings.apple },
    '-=0.15'
  );

  return tl;
};

export const modalOut = (overlay: gsap.TweenTarget, content: gsap.TweenTarget) => {
  const tl = gsap.timeline();

  tl.to(content, {
    opacity: 0,
    scale: 0.95,
    y: 10,
    duration: durations.fast,
    ease: easings.smooth,
  });

  tl.to(
    overlay,
    { opacity: 0, duration: durations.fast, ease: easings.smooth },
    '-=0.1'
  );

  return tl;
};

// Sheet/drawer animations (bottom sheet)
export const sheetIn = (element: gsap.TweenTarget) => {
  gsap.set(element, { y: '100%' });
  return gsap.to(element, {
    y: 0,
    duration: durations.normal,
    ease: easings.apple,
  });
};

export const sheetOut = (element: gsap.TweenTarget) => {
  return gsap.to(element, {
    y: '100%',
    duration: durations.fast,
    ease: easings.smooth,
  });
};

// Card flip animation
export const cardFlip = (element: gsap.TweenTarget, direction: 'left' | 'right' = 'right') => {
  const rotateY = direction === 'right' ? 180 : -180;
  return gsap.to(element, {
    rotateY,
    duration: durations.slow,
    ease: easings.smooth,
  });
};

// Shake animation for errors
export const shake = (element: gsap.TweenTarget) => {
  return gsap.to(element, {
    keyframes: [
      { x: -10 },
      { x: 10 },
      { x: -8 },
      { x: 8 },
      { x: -5 },
      { x: 5 },
      { x: 0 },
    ],
    duration: durations.normal,
    ease: easings.snap,
  });
};

// Pulse animation
export const pulse = (element: gsap.TweenTarget, scale = 1.05) => {
  return gsap.to(element, {
    scale,
    duration: durations.fast,
    ease: easings.smooth,
    yoyo: true,
    repeat: 1,
  });
};

// Magnetic cursor effect (for buttons)
export const magneticMove = (
  element: gsap.TweenTarget,
  x: number,
  y: number,
  intensity = 0.3
) => {
  return gsap.to(element, {
    x: x * intensity,
    y: y * intensity,
    duration: durations.fast,
    ease: easings.smooth,
  });
};

export const magneticReset = (element: gsap.TweenTarget) => {
  return gsap.to(element, {
    x: 0,
    y: 0,
    duration: durations.normal,
    ease: easings.smooth,
  });
};

// Text reveal animation
export const textReveal = (element: gsap.TweenTarget) => {
  gsap.set(element, {
    clipPath: 'inset(0 100% 0 0)',
    opacity: 1
  });

  return gsap.to(element, {
    clipPath: 'inset(0 0% 0 0)',
    duration: durations.slow,
    ease: easings.apple,
  });
};

// Counter animation
export const animateCounter = (
  element: HTMLElement,
  endValue: number,
  options: {
    duration?: number;
    prefix?: string;
    suffix?: string;
    decimals?: number;
  } = {}
) => {
  const {
    duration = durations.dramatic,
    prefix = '',
    suffix = '',
    decimals = 0,
  } = options;

  const obj = { value: 0 };

  return gsap.to(obj, {
    value: endValue,
    duration,
    ease: easings.smooth,
    onUpdate: () => {
      element.textContent = `${prefix}${obj.value.toFixed(decimals)}${suffix}`;
    },
  });
};

// Parallax scroll effect
export const createParallax = (
  element: gsap.TweenTarget,
  speed = 0.5,
  direction: 'vertical' | 'horizontal' = 'vertical'
) => {
  const prop = direction === 'vertical' ? 'y' : 'x';

  return gsap.to(element, {
    [prop]: () => window.scrollY * speed,
    ease: 'none',
    scrollTrigger: {
      trigger: element as Element,
      start: 'top bottom',
      end: 'bottom top',
      scrub: true,
    },
  });
};

// Create a timeline with common settings
export const createTimeline = (options: gsap.TimelineVars = {}) => {
  return gsap.timeline({
    defaults: {
      ease: easings.apple,
      duration: durations.normal,
    },
    ...options,
  });
};

// Quick set for initial hidden state
export const setHidden = (element: gsap.TweenTarget, type: 'fadeUp' | 'fadeIn' | 'scale' = 'fadeUp') => {
  const states = {
    fadeUp: { opacity: 0, y: 30 },
    fadeIn: { opacity: 0 },
    scale: { opacity: 0, scale: 0.95 },
  };
  gsap.set(element, states[type]);
};
