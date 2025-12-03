import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
