import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './fonts.css';

export const metadata: Metadata = { title: 'Vox' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: 'cover' };

/**
 * The root layout of every Mini App surface under /studio (its own <html>, so none of the legacy app's
 * CSS or providers load here): the Telegram bridge and the bundled fonts only. The Studio adds its CSS
 * and providers in `(studio)/layout.tsx`; the pet page loads only its own `pet.css`.
 */
export default function StudioRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <div className="vx-fonts">{children}</div>
      </body>
    </html>
  );
}
