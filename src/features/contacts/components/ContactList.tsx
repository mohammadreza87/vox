'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ContactCard } from './ContactCard';
import { PRE_MADE_CONTACTS } from '../data/premade-contacts';
import { Contact, PreMadeContactConfig } from '@/shared/types';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/shared/components';

interface ContactListProps {
  userContacts?: Contact[];
}

export function ContactList({ userContacts = [] }: ContactListProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');

  // Combine pre-made and user contacts
  const allContacts = [
    ...PRE_MADE_CONTACTS,
    ...userContacts,
  ];

  // Filter by search
  const filteredContacts = allContacts.filter(contact =>
    contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.purpose.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleContactClick = (contact: Contact | PreMadeContactConfig) => {
    router.push(`/chat/${contact.id}`);
  };

  const handleCreateContact = () => {
    router.push('/create');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--foreground)]">Contacts</h1>
          <p className="text-[var(--foreground)]/60 mt-1">Your AI voice assistants</p>
        </div>
        <Button onClick={handleCreateContact} size="md">
          <Plus className="w-5 h-5 mr-2" />
          New Contact
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--foreground)]/40" />
        <input
          type="text"
          placeholder="Search contacts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-12 pr-4 py-4 bg-[var(--color-beige)] border border-[var(--foreground)]/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#FF6D1F] focus:border-transparent text-[var(--foreground)] placeholder-[var(--foreground)]/40 transition-colors"
        />
      </div>

      {/* Contact Grid */}
      <div className="grid gap-4">
        {filteredContacts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[var(--foreground)]/60">No contacts found</p>
          </div>
        ) : (
          filteredContacts.map((contact) => (
            <ContactCard
              key={contact.id}
              contact={contact}
              onClick={() => handleContactClick(contact)}
            />
          ))
        )}
      </div>

      {/* Create Custom Contact CTA */}
      <div className="bg-[var(--color-beige)] rounded-3xl p-8 text-center border border-[var(--foreground)]/10 transition-colors">
        <h3 className="text-xl font-bold text-[var(--foreground)] mb-2">
          Create Your Own AI Contact
        </h3>
        <p className="text-[var(--foreground)]/70 mb-4">
          Define a custom personality, purpose, and voice for your perfect assistant
        </p>
        <Button onClick={handleCreateContact} variant="secondary">
          <Plus className="w-5 h-5 mr-2" />
          Create Custom Contact
        </Button>
      </div>
    </div>
  );
}
