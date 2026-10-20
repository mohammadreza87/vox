'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
const LegacyProviders = dynamic(() => import('./LegacyProviders').then(m => m.LegacyProviders), { ssr: false, loading: () => <p role="status">Loading…</p> });
const privacy = (path: string | null) => path === '/privacy' || !!path?.startsWith('/privacy/');
/** No legacy-store imports, auth initialization or third-party SDK on public privacy. */
export function Providers({ children }: {
    children: ReactNode;
}) {
    const path = usePathname(), initial = useRef<string | null>(path), [ready, setReady] = useState(false), publicPrivacy = privacy(path), crossed = initial.current !== null && privacy(initial.current) !== publicPrivacy;
    if (initial.current === null && path !== null) initial.current = path;
    useEffect(() => { if (path === null) return; if (crossed) {
        window.location.replace(window.location.href);
        return;
    } if (publicPrivacy)
        return; let stopped = false; const existing = (window as Window & {
        Telegram?: {
            WebApp?: unknown;
        };
    }).Telegram?.WebApp; if (existing) {
        setReady(true);
        return;
    } const script = document.createElement('script'); script.src = 'https://telegram.org/js/telegram-web-app.js'; script.async = false; script.dataset.voxTelegramSdk = 'true'; const done = () => { if (!stopped)
        setReady(true); }; script.addEventListener('load', done); script.addEventListener('error', done); const timer = setTimeout(done, 8000); document.head.append(script); return () => { stopped = true; clearTimeout(timer); script.removeEventListener('load', done); script.removeEventListener('error', done); script.remove(); }; }, [path, publicPrivacy, crossed]);
    if (crossed || path === null)
        return <p role="status">Loading…</p>;
    if (publicPrivacy)
        return <>{children}</>;
    if (!ready)
        return <p role="status">Loading…</p>;
    if (path === '/studio' || path?.startsWith('/studio/'))
        return <>{children}</>;
    return <LegacyProviders>{children}</LegacyProviders>;
}
