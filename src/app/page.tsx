'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/shared/components';
import { useAuthStore } from '@/stores/authStore';
import { Mic, Brain, Sparkles, ArrowRight, Volume2, Globe, Fingerprint, MessageSquare, Palette, Cpu } from 'lucide-react';

export default function LandingPage() {
  // Auth store
  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.loading);
  const router = useRouter();

  // Redirect to app if user is already logged in
  useEffect(() => {
    if (!loading && user) {
      router.push('/app');
    }
  }, [user, loading, router]);
  return (
    <div className="min-h-full overflow-auto relative" style={{ minHeight: '100dvh' }}>
      {/* Animated gradient background */}
      <div className="glass-background" />

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50">
        <div className="mx-4 mt-4">
          <div className="max-w-6xl mx-auto glass rounded-2xl px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-[#FF6D1F] to-[#ff8a4c] rounded-2xl flex items-center justify-center shadow-xl shadow-[#FF6D1F]/40">
                <Volume2 className="w-7 h-7 text-white" />
              </div>
              <span className="text-3xl font-black text-[var(--foreground)] tracking-tight">Vox</span>
            </div>
            <nav className="flex items-center gap-4">
              <Link href="/login">
                <Button size="sm" className="btn-primary rounded-2xl px-6 font-bold">Get Started</Button>
              </Link>
            </nav>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-36 pb-20 px-6 relative z-10">
        <div className="max-w-5xl mx-auto text-center">
          {/* Badge */}
          <div className="animate-fade-in inline-flex items-center gap-2 glass px-5 py-2.5 rounded-full text-sm font-bold mb-10 text-[var(--foreground)]">
            <Sparkles className="w-5 h-5 text-[#FF6D1F]" />
            All AI Models + Voice Cloning
          </div>

          {/* Headline - Super Extra Bold */}
          <h1 className="animate-fade-in-up text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-black text-[var(--foreground)] leading-[0.9] mb-8 tracking-tight">
            <span className="block">Remember</span>
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-[#FF6D1F] to-[#ff8a4c]">
              By Voice
            </span>
          </h1>

          {/* Subheadline */}
          <p className="animate-fade-in-up animation-delay-200 text-xl md:text-2xl text-[var(--foreground)]/70 max-w-2xl mx-auto mb-12 font-medium">
            Create AI contacts with unique voices. Each contact = one topic.
            <span className="text-[#FF6D1F] font-bold"> One app for all AI.</span>
          </p>

          {/* CTA Buttons */}
          <div className="animate-fade-in-up animation-delay-300 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/login">
              <Button size="lg" className="btn-primary w-full sm:w-auto rounded-2xl px-10 py-6 text-lg font-black hover:scale-105 transition-transform">
                <Mic className="w-6 h-6 mr-3" />
                Start Free
                <ArrowRight className="w-6 h-6 ml-3" />
              </Button>
            </Link>
          </div>

          {/* Trust badges */}
          <div className="animate-fade-in-up animation-delay-400 mt-16 flex flex-wrap items-center justify-center gap-6 text-[var(--foreground)]/40 text-sm font-medium">
            <span>Powered by</span>
            <span className="glass-light px-4 py-2 rounded-xl hover:scale-105 transition-transform">ElevenLabs</span>
            <span className="glass-light px-4 py-2 rounded-xl hover:scale-105 transition-transform">OpenAI</span>
            <span className="glass-light px-4 py-2 rounded-xl hover:scale-105 transition-transform">Anthropic</span>
            <span className="glass-light px-4 py-2 rounded-xl hover:scale-105 transition-transform">Google</span>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 px-6 relative z-10">
        <div className="max-w-4xl mx-auto">
          <div className="glass rounded-3xl p-8 md:p-12">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
              {[
                { value: '4+', label: 'AI Models' },
                { value: '50+', label: 'Voice Options' },
                { value: '∞', label: 'Topics' },
                { value: '0$', label: 'To Start' },
              ].map((stat, i) => (
                <div key={i}>
                  <div className="text-4xl md:text-5xl font-black text-[#FF6D1F] mb-2">{stat.value}</div>
                  <div className="text-[var(--foreground)]/60 font-bold uppercase text-xs tracking-wider">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Problem vs Solution - Bento Grid Style */}
      <section className="py-20 px-6 relative z-10">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-6xl font-black text-[var(--foreground)] mb-4 tracking-tight">
              Think <span className="text-[#FF6D1F]">Contacts</span>,
              <br />
              Not Chats
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Problem Card */}
            <div className="glass rounded-3xl p-8 md:p-10 border-2 border-red-500/20">
              <div className="inline-block px-4 py-1.5 bg-red-500/10 rounded-full text-red-500 text-sm font-black uppercase tracking-wider mb-6">
                The Old Way
              </div>
              <h3 className="text-2xl md:text-3xl font-black text-[var(--foreground)] mb-6">
                AI chats are chaos
              </h3>
              <ul className="space-y-4 text-[var(--foreground)]/70">
                {[
                  'Everything mixed in one chat',
                  'Can\'t find past conversations',
                  'No voice identity',
                  'Switching between apps',
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-lg">
                    <span className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 flex-shrink-0 font-black">✗</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Solution Card */}
            <div className="glass rounded-3xl p-8 md:p-10 border-2 border-[#FF6D1F]/30 bg-gradient-to-br from-[#FF6D1F]/5 to-transparent">
              <div className="inline-block px-4 py-1.5 bg-[#FF6D1F]/10 rounded-full text-[#FF6D1F] text-sm font-black uppercase tracking-wider mb-6">
                The Vox Way
              </div>
              <h3 className="text-2xl md:text-3xl font-black text-[var(--foreground)] mb-6">
                Voice-first contacts
              </h3>
              <ul className="space-y-4 text-[var(--foreground)]/70">
                {[
                  'Maya = Spanish. Alex = Career.',
                  'Hear voice → recall topic',
                  'Clone any voice',
                  'All AI models in one place',
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-lg">
                    <span className="w-8 h-8 rounded-full bg-[#FF6D1F]/20 flex items-center justify-center text-[#FF6D1F] flex-shrink-0 font-black">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Features - Bento Grid */}
      <section className="py-20 px-6 relative z-10">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-6xl font-black text-[var(--foreground)] tracking-tight">
              Everything You Need
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {/* Large Feature Card */}
            <div className="md:col-span-2 md:row-span-2 bg-gradient-to-br from-[#FF6D1F] to-[#ff8a4c] rounded-3xl p-8 md:p-12 text-white relative overflow-hidden hover:scale-[1.02] transition-transform">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
              <div className="relative z-10">
                <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mb-6">
                  <Fingerprint className="w-9 h-9" />
                </div>
                <h3 className="text-3xl md:text-4xl font-black mb-4">Clone Any Voice</h3>
                <p className="text-xl text-white/90 max-w-md">
                  Record 30 seconds. Get an AI that speaks with that voice forever. Your voice, your friend&apos;s voice, any voice.
                </p>
              </div>
            </div>

            {/* Small Feature Cards */}
            {[
              { icon: <Cpu className="w-7 h-7" />, title: 'All AI Models', desc: 'GPT-4, Claude, Gemini, DeepSeek' },
              { icon: <Globe className="w-7 h-7" />, title: 'Real-Time Translation', desc: 'Speak English, hear Spanish' },
              { icon: <Brain className="w-7 h-7" />, title: 'Topic Memory', desc: 'Each contact remembers everything' },
              { icon: <Palette className="w-7 h-7" />, title: 'Custom Personalities', desc: 'Define how each AI behaves' },
              { icon: <MessageSquare className="w-7 h-7" />, title: 'Voice-First', desc: 'Push to talk, no typing needed' },
            ].map((feature, i) => (
              <div key={i} className="glass rounded-3xl p-6 hover:scale-[1.02] transition-transform cursor-default">
                <div className="w-12 h-12 glass-light rounded-xl flex items-center justify-center mb-4 text-[#FF6D1F]">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-black text-[var(--foreground)] mb-2">{feature.title}</h3>
                <p className="text-[var(--foreground)]/60">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-6 relative z-10">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-6xl font-black text-[var(--foreground)] tracking-tight">
              3 Simple Steps
            </h2>
          </div>

          <div className="space-y-6">
            {[
              { step: '01', title: 'Create Contact', desc: 'Name, purpose, personality' },
              { step: '02', title: 'Pick Voice & AI', desc: 'Clone yours or choose from 50+' },
              { step: '03', title: 'Start Talking', desc: 'Push to talk. That\'s it.' },
            ].map((item, i) => (
              <div key={i} className="glass rounded-3xl p-6 md:p-8 flex items-center gap-6 md:gap-8 hover:scale-[1.01] transition-transform">
                <div className="text-5xl md:text-7xl font-black text-[#FF6D1F]/20">{item.step}</div>
                <div>
                  <h3 className="text-2xl md:text-3xl font-black text-[var(--foreground)] mb-1">{item.title}</h3>
                  <p className="text-lg text-[var(--foreground)]/60">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Examples */}
      <section className="py-20 px-6 relative z-10">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl md:text-6xl font-black text-[var(--foreground)] tracking-tight mb-4">
              Your AI <span className="text-[#FF6D1F]">Squad</span>
            </h2>
            <p className="text-xl text-[var(--foreground)]/60">Examples of contacts you can create</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { emoji: '👩‍💼', name: 'Alex', role: 'Interview Coach' },
              { emoji: '🇪🇸', name: 'Carlos', role: 'Spanish Tutor' },
              { emoji: '💼', name: 'Marcus', role: 'Startup Mentor' },
              { emoji: '🧘', name: 'Dr. Sam', role: 'Wellness Coach' },
              { emoji: '💻', name: 'Dev', role: 'Coding Buddy' },
              { emoji: '✍️', name: 'Emma', role: 'Writing Editor' },
              { emoji: '📊', name: 'Ana', role: 'Data Analyst' },
              { emoji: '🎯', name: 'Coach K', role: 'Accountability' },
            ].map((contact, i) => (
              <div key={i} className="glass rounded-2xl p-4 text-center hover:scale-105 transition-transform cursor-default">
                <div className="w-16 h-16 mx-auto mb-3 bg-gradient-to-br from-[#FF6D1F] to-[#ff8a4c] rounded-full flex items-center justify-center text-2xl shadow-xl shadow-[#FF6D1F]/20">
                  {contact.emoji}
                </div>
                <p className="font-black text-[var(--foreground)]">{contact.name}</p>
                <p className="text-sm text-[#FF6D1F] font-bold">{contact.role}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 px-6 relative z-10">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gradient-to-br from-[#FF6D1F] to-[#ff8a4c] rounded-[3rem] p-10 md:p-16 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-white/5 backdrop-blur-3xl" />
            <div className="absolute top-0 left-0 w-96 h-96 bg-white/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
            <div className="absolute bottom-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />

            <div className="relative z-10">
              <h2 className="text-4xl md:text-6xl lg:text-7xl font-black text-white mb-6 tracking-tight">
                Start Talking
                <br />
                <span className="text-white/80">Today</span>
              </h2>
              <p className="text-xl text-white/80 mb-10 max-w-xl mx-auto">
                Create your first AI contact in 60 seconds. Free forever plan available.
              </p>
              <Link href="/login">
                <Button size="lg" className="bg-white text-[#FF6D1F] hover:bg-white/90 hover:scale-105 rounded-2xl px-12 py-6 text-lg font-black shadow-2xl transition-transform">
                  <Mic className="w-6 h-6 mr-3" />
                  Get Started Free
                  <ArrowRight className="w-6 h-6 ml-3" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 relative z-10">
        <div className="max-w-5xl mx-auto">
          <div className="glass rounded-2xl px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-[#FF6D1F] to-[#ff8a4c] rounded-xl flex items-center justify-center shadow-lg shadow-[#FF6D1F]/20">
                <Volume2 className="w-5 h-5 text-white" />
              </div>
              <span className="font-black text-xl text-[var(--foreground)]">Vox</span>
            </div>
            <p className="text-[var(--foreground)]/60 text-sm font-medium">
              Built for the Google Cloud + ElevenLabs Hackathon 2025
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
