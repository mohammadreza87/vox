'use client';

import { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { usePlatformStore } from '@/stores/platformStore';

interface PlatformSafeAreaProps {
  children: ReactNode;
  className?: string;
  top?: boolean;
  bottom?: boolean;
  left?: boolean;
  right?: boolean;
}

/**
 * Platform-aware safe area component
 * Handles safe area insets for notched devices and Telegram Mini App
 */
export function PlatformSafeArea({
  children,
  className,
  top = true,
  bottom = true,
  left = false,
  right = false,
}: PlatformSafeAreaProps) {
  const { info } = usePlatformStore();

  // Calculate padding classes based on platform and settings
  const paddingClasses = cn(
    top && 'pt-[env(safe-area-inset-top)]',
    bottom && 'pb-[env(safe-area-inset-bottom)]',
    left && 'pl-[env(safe-area-inset-left)]',
    right && 'pr-[env(safe-area-inset-right)]',
    // Extra padding for Telegram on mobile
    info.isTelegram && info.isMobile && top && 'pt-[max(env(safe-area-inset-top),12px)]',
    info.isTelegram && info.isMobile && bottom && 'pb-[max(env(safe-area-inset-bottom),12px)]',
    className
  );

  return <div className={paddingClasses}>{children}</div>;
}

/**
 * Safe area spacer - just the spacing without wrapping content
 */
export function SafeAreaSpacer({
  position,
  className,
}: {
  position: 'top' | 'bottom';
  className?: string;
}) {
  const { info } = usePlatformStore();

  const spacerClasses = cn(
    'w-full',
    position === 'top' && 'h-[env(safe-area-inset-top)]',
    position === 'bottom' && 'h-[env(safe-area-inset-bottom)]',
    // Extra height for Telegram
    info.isTelegram && info.isMobile && position === 'top' && 'h-[max(env(safe-area-inset-top),12px)]',
    info.isTelegram && info.isMobile && position === 'bottom' && 'h-[max(env(safe-area-inset-bottom),12px)]',
    className
  );

  return <div className={spacerClasses} />;
}
