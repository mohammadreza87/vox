import type { Metadata } from 'next';
import Script from 'next/script';
import { Onest, Unbounded } from 'next/font/google';
import './studio.css';

const onest = Onest({ subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600'], variable: '--font-onest' });
const unbounded = Unbounded({ subsets: ['latin', 'cyrillic'], weight: ['500', '600'], variable: '--font-unbounded' });

export const metadata: Metadata = {
  title: 'Vox Studio',
  description: 'Spawn, call and manage your AI colleagues.',
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${onest.variable} ${unbounded.variable}`}>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      {children}
    </div>
  );
}
