// Animation Components
export { AnimatedPage, AnimatedList, ScrollAnimation } from './AnimatedPage';
export { AnimatedButton } from './AnimatedButton';
export { AnimatedCard } from './AnimatedCard';
export { AnimatedModal, AnimatedSheet } from './AnimatedModal';

// Re-export hooks
export {
  useEntranceAnimation,
  useStaggerAnimation,
  useHoverAnimation,
  useButtonAnimation,
  useModalAnimation,
  useMagneticEffect,
  useScrollAnimation,
  useShakeAnimation,
  usePulseAnimation,
  useAnimatedPresence,
  useCounterAnimation,
} from '@/hooks/useAnimations';

// Re-export animation utilities
export {
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
  sheetIn,
  sheetOut,
  shake,
  pulse,
  magneticMove,
  magneticReset,
  textReveal,
  animateCounter,
  createTimeline,
  setHidden,
} from '@/lib/animations';
