import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Vox - Your AI Voice Contacts",
  description: "Voice-first AI messenger where your contacts are specialized AI assistants. Talk to interview coaches, language tutors, mentors, and more.",
  keywords: ["AI", "voice assistant", "chatbot", "interview coach", "language learning", "ElevenLabs", "Gemini"],
  authors: [{ name: "Vox Team" }],
  openGraph: {
    title: "Vox - Your AI Voice Contacts",
    description: "Conversations that matter, whenever you need them.",
    type: "website",
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

// Inline script to prevent dark mode flash - runs before React hydrates
// This MUST set the class before any CSS loads to prevent flash
const themeScript = `
  (function() {
    function getTheme() {
      try {
        var stored = localStorage.getItem('theme');
        if (stored === 'dark' || stored === 'light') return stored;
      } catch (e) {}
      // Default to system preference
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function updateThemeColor(theme) {
      var color = theme === 'dark' ? '#0a0a0a' : '#f5f5f7';
      var metaThemeColor = document.querySelector('meta[name="theme-color"]');
      if (metaThemeColor) {
        metaThemeColor.setAttribute('content', color);
      }
    }

    var theme = getTheme();
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    updateThemeColor(theme);

    // Store in localStorage if not already set
    try {
      if (!localStorage.getItem('theme')) {
        localStorage.setItem('theme', theme);
      }
    } catch (e) {}
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Telegram WebApp SDK - must load before app for Mini App detection */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
        {/* Theme color for browser UI - will be updated by themeScript */}
        <meta name="theme-color" content="#f5f5f7" />
        {/* PWA meta tags */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ErrorBoundary>
          <Providers>
            {children}
          </Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}
