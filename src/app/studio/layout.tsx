import type { Metadata } from 'next';
import Script from 'next/script';
import './fonts.css';
import './studio.css';

export const metadata: Metadata = {
  title: 'Vox Studio',
  description: 'Spawn, call and manage your AI colleagues.',
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="vx-fonts">
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      {children}
    </div>
  );
}
