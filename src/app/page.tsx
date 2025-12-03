'use client';

import Link from 'next/link';
import { Button } from '@/shared/components';
import { Mic, MessageCircle, Users, Sparkles, ArrowRight, Volume2 } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-full bg-[#FAF3E1] overflow-auto" style={{ minHeight: '100dvh' }}>
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#FAF3E1]/80 backdrop-blur-md border-b border-[#222222]/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-[#FF6D1F] rounded-xl flex items-center justify-center">
              <Volume2 className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-[#222222]">Vox</span>
          </div>
          <nav className="flex items-center gap-4">
            <Link href="/contacts" className="text-[#222222]/70 hover:text-[#222222] font-medium">
              Contacts
            </Link>
            <Link href="/contacts">
              <Button size="sm">Get Started</Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-[#F5E7C6] text-[#222222] px-4 py-2 rounded-full text-sm font-medium mb-8">
            <Sparkles className="w-4 h-4 text-[#FF6D1F]" />
            Powered by ElevenLabs + Google Gemini
          </div>

          {/* Headline */}
          <h1 className="text-5xl md:text-7xl font-bold text-[#222222] leading-tight mb-6">
            Your AI Contacts,{' '}
            <span className="text-[#FF6D1F]">
              Your Voice
            </span>
          </h1>

          {/* Subheadline */}
          <p className="text-xl text-[#222222]/70 max-w-2xl mx-auto mb-10">
            Talk to specialized AI assistants that remember you, help you grow, and respond with natural human voices. Interview coaches, language tutors, mentors, and more.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/contacts">
              <Button size="lg" className="w-full sm:w-auto">
                <Mic className="w-5 h-5 mr-2" />
                Start Talking
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
            <Link href="#demo">
              <Button variant="secondary" size="lg" className="w-full sm:w-auto">
                Watch Demo
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Contact Preview */}
      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="bg-white rounded-3xl shadow-2xl border border-[#222222]/10 p-8 md:p-12">
            {/* Fake Contact List */}
            <div className="space-y-4">
              {[
                { emoji: '👩‍💼', name: 'Alice', role: 'Interview Coach', message: 'Ready to practice for your next interview?' },
                { emoji: '🇪🇸', name: 'Carlos', role: 'Spanish Tutor', message: '¡Hola! ¿Practicamos español hoy?' },
                { emoji: '🚀', name: 'Marcus', role: 'Startup Mentor', message: "Let's review your pitch deck" },
              ].map((contact, index) => (
                <div
                  key={index}
                  className="flex items-center gap-4 p-4 rounded-2xl hover:bg-[#F5E7C6]/50 transition-colors cursor-pointer"
                >
                  <div className="w-14 h-14 rounded-full bg-[#FF6D1F] flex items-center justify-center text-2xl">
                    {contact.emoji}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#222222]">{contact.name}</span>
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[#FF6D1F] text-white">
                        {contact.role}
                      </span>
                    </div>
                    <p className="text-[#222222]/60 text-sm">{contact.message}</p>
                  </div>
                  <div className="w-12 h-12 rounded-full bg-[#F5E7C6] flex items-center justify-center">
                    <MessageCircle className="w-6 h-6 text-[#FF6D1F]" />
                  </div>
                </div>
              ))}
            </div>

            {/* Add Contact Button */}
            <div className="mt-6 pt-6 border-t border-[#222222]/10 text-center">
              <Link href="/create" className="inline-flex items-center gap-2 text-[#FF6D1F] font-medium hover:text-[#e5621b]">
                <Users className="w-5 h-5" />
                Create your own AI contact
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6 bg-[#F5E7C6]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-[#222222] mb-16">
            Why Vox?
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: <Mic className="w-8 h-8" />,
                title: 'Voice-First',
                description: 'Natural conversations powered by ElevenLabs. Talk, listen, and learn - no typing required.',
              },
              {
                icon: <Users className="w-8 h-8" />,
                title: 'Specialized Contacts',
                description: 'Each AI has a unique purpose, personality, and voice. From interview prep to language learning.',
              },
              {
                icon: <Sparkles className="w-8 h-8" />,
                title: 'Memory & Context',
                description: 'Your contacts remember past conversations and build on your progress over time.',
              },
            ].map((feature, index) => (
              <div key={index} className="text-center">
                <div className="w-16 h-16 bg-[#FAF3E1] rounded-2xl flex items-center justify-center text-[#FF6D1F] mx-auto mb-4">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold text-[#222222] mb-2">{feature.title}</h3>
                <p className="text-[#222222]/70">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6 bg-[#FAF3E1]">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-[#222222] mb-6">
            Ready to meet your AI contacts?
          </h2>
          <p className="text-xl text-[#222222]/70 mb-8">
            Start talking to Alice, Carlos, Marcus, and more - or create your own custom AI assistant.
          </p>
          <Link href="/contacts">
            <Button size="lg">
              <Mic className="w-5 h-5 mr-2" />
              Start Your First Conversation
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-[#222222]/10 bg-[#FAF3E1]">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#FF6D1F] rounded-lg flex items-center justify-center">
              <Volume2 className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-[#222222]">Vox</span>
          </div>
          <p className="text-[#222222]/60 text-sm">
            Built with ElevenLabs + Google Cloud for the 2025 Hackathon
          </p>
        </div>
      </footer>
    </div>
  );
}
