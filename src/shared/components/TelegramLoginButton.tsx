'use client';

import { useEffect, useRef, useCallback } from 'react';
import { usePlatformStore } from '@/stores/platformStore';

interface TelegramLoginButtonProps {
  botName?: string;
  buttonSize?: 'large' | 'medium' | 'small';
  cornerRadius?: number;
  showUserPhoto?: boolean;
  requestAccess?: 'write';
  onAuth?: (user: TelegramLoginUser) => void;
  className?: string;
}

export interface TelegramLoginUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

declare global {
  interface Window {
    TelegramLoginWidget?: {
      dataOnauth?: (user: TelegramLoginUser) => void;
    };
  }
}

/**
 * Telegram Login Widget for web authentication
 * https://core.telegram.org/widgets/login
 */
export function TelegramLoginButton({
  botName = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME,
  buttonSize = 'large',
  cornerRadius = 12,
  showUserPhoto = true,
  requestAccess = 'write',
  onAuth,
  className,
}: TelegramLoginButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { hapticFeedback } = usePlatformStore();

  const handleAuth = useCallback(
    (user: TelegramLoginUser) => {
      hapticFeedback('success');
      onAuth?.(user);
    },
    [onAuth, hapticFeedback]
  );

  useEffect(() => {
    if (!containerRef.current || !botName) return;

    // Set up callback
    window.TelegramLoginWidget = {
      dataOnauth: handleAuth,
    };

    // Create script element
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botName);
    script.setAttribute('data-size', buttonSize);
    script.setAttribute('data-radius', cornerRadius.toString());
    script.setAttribute('data-onauth', 'TelegramLoginWidget.dataOnauth(user)');
    script.setAttribute('data-request-access', requestAccess);

    if (showUserPhoto) {
      script.setAttribute('data-userpic', 'true');
    }

    // Clear container and append script
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      delete window.TelegramLoginWidget;
    };
  }, [botName, buttonSize, cornerRadius, showUserPhoto, requestAccess, handleAuth]);

  if (!botName) {
    return null;
  }

  return <div ref={containerRef} className={className} />;
}

/**
 * Custom styled Telegram login button (alternative to widget)
 */
export function TelegramLoginButtonCustom({
  onAuth,
  className,
  children,
}: {
  onAuth?: (user: TelegramLoginUser) => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const botName = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const { hapticFeedback } = usePlatformStore();

  const handleClick = () => {
    if (!botName) return;

    hapticFeedback('light');

    // Open Telegram OAuth in popup
    const width = 550;
    const height = 470;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const authUrl = `https://oauth.telegram.org/auth?bot_id=${botName}&origin=${encodeURIComponent(window.location.origin)}&request_access=write`;

    const popup = window.open(
      authUrl,
      'telegram_auth',
      `width=${width},height=${height},left=${left},top=${top}`
    );

    // Listen for message from popup
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://oauth.telegram.org') return;

      if (event.data?.type === 'telegram_auth' && event.data?.user) {
        hapticFeedback('success');
        onAuth?.(event.data.user);
        popup?.close();
      }

      window.removeEventListener('message', handleMessage);
    };

    window.addEventListener('message', handleMessage);
  };

  if (!botName) {
    return null;
  }

  return (
    <button
      onClick={handleClick}
      className={className}
      type="button"
    >
      {children || (
        <>
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
          </svg>
          Continue with Telegram
        </>
      )}
    </button>
  );
}
