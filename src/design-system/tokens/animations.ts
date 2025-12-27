/**
 * Animation Design Tokens
 * Durations, easings, and animation presets
 */

export const animations = {
  // Durations
  duration: {
    instant: '0ms',
    fastest: '50ms',
    faster: '100ms',
    fast: '150ms',
    normal: '200ms',
    slow: '300ms',
    slower: '400ms',
    slowest: '500ms',
    // Special durations
    pageTransition: '400ms',
    modalEnter: '300ms',
    modalExit: '200ms',
    sheetEnter: '350ms',
    sheetExit: '250ms',
    toast: '200ms',
    ripple: '600ms',
  },

  // Easing Functions
  easing: {
    // Standard easings
    linear: 'linear',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',

    // Custom easings for specific animations
    spring: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
    smooth: 'cubic-bezier(0.25, 0.1, 0.25, 1)',

    // Apple-style easings
    appleStandard: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
    appleDecelerate: 'cubic-bezier(0, 0, 0.2, 1)',
    appleAccelerate: 'cubic-bezier(0.4, 0, 1, 1)',

    // Material Design easings
    emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
    emphasizedDecelerate: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
    emphasizedAccelerate: 'cubic-bezier(0.3, 0, 0.8, 0.15)',

    // Sheet/Modal specific
    sheetEnter: 'cubic-bezier(0.32, 0.72, 0, 1)',
    sheetExit: 'cubic-bezier(0.32, 0.72, 0, 1)',
  },

  // Transition presets (duration + easing combinations)
  transition: {
    fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
    normal: '200ms cubic-bezier(0.4, 0, 0.2, 1)',
    slow: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
    spring: '300ms cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    bounce: '400ms cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  },

  // CSS transition property shortcuts
  transitionProperty: {
    none: 'none',
    all: 'all',
    default: 'color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter',
    colors: 'color, background-color, border-color, text-decoration-color, fill, stroke',
    opacity: 'opacity',
    shadow: 'box-shadow',
    transform: 'transform',
  },

  // Keyframe animation presets (for CSS @keyframes)
  keyframes: {
    fadeIn: {
      from: { opacity: '0' },
      to: { opacity: '1' },
    },
    fadeOut: {
      from: { opacity: '1' },
      to: { opacity: '0' },
    },
    fadeInUp: {
      from: { opacity: '0', transform: 'translateY(20px)' },
      to: { opacity: '1', transform: 'translateY(0)' },
    },
    fadeInDown: {
      from: { opacity: '0', transform: 'translateY(-20px)' },
      to: { opacity: '1', transform: 'translateY(0)' },
    },
    slideInUp: {
      from: { transform: 'translateY(100%)' },
      to: { transform: 'translateY(0)' },
    },
    slideInDown: {
      from: { transform: 'translateY(-100%)' },
      to: { transform: 'translateY(0)' },
    },
    slideInLeft: {
      from: { transform: 'translateX(-100%)' },
      to: { transform: 'translateX(0)' },
    },
    slideInRight: {
      from: { transform: 'translateX(100%)' },
      to: { transform: 'translateX(0)' },
    },
    scaleIn: {
      from: { opacity: '0', transform: 'scale(0.9)' },
      to: { opacity: '1', transform: 'scale(1)' },
    },
    scaleOut: {
      from: { opacity: '1', transform: 'scale(1)' },
      to: { opacity: '0', transform: 'scale(0.9)' },
    },
    pulse: {
      '0%, 100%': { opacity: '1' },
      '50%': { opacity: '0.5' },
    },
    spin: {
      from: { transform: 'rotate(0deg)' },
      to: { transform: 'rotate(360deg)' },
    },
    bounce: {
      '0%, 100%': { transform: 'translateY(-5%)', animationTimingFunction: 'cubic-bezier(0.8, 0, 1, 1)' },
      '50%': { transform: 'translateY(0)', animationTimingFunction: 'cubic-bezier(0, 0, 0.2, 1)' },
    },
    float: {
      '0%, 100%': { transform: 'translateY(0)' },
      '50%': { transform: 'translateY(-10px)' },
    },
    shimmer: {
      '0%': { backgroundPosition: '-200% 0' },
      '100%': { backgroundPosition: '200% 0' },
    },
    recording: {
      '0%, 100%': { transform: 'scale(1)', opacity: '1' },
      '50%': { transform: 'scale(1.1)', opacity: '0.8' },
    },
  },

  // GSAP-compatible values (for animations.ts lib)
  gsap: {
    duration: {
      fast: 0.15,
      normal: 0.3,
      slow: 0.5,
      pageTransition: 0.4,
    },
    ease: {
      default: 'power2.out',
      smooth: 'power3.out',
      bounce: 'back.out(1.7)',
      elastic: 'elastic.out(1, 0.3)',
      spring: 'power4.out',
    },
    stagger: {
      fast: 0.03,
      normal: 0.05,
      slow: 0.08,
    },
  },
} as const;

// Type exports
export type DurationToken = keyof typeof animations.duration;
export type EasingToken = keyof typeof animations.easing;
export type TransitionPreset = keyof typeof animations.transition;
