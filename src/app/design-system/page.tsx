'use client';

import { useState } from 'react';
import { Search, Mail, Lock, Check, AlertCircle, Bell } from 'lucide-react';
import {
  Button,
  Input,
  Select,
  Badge,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Modal,
  Divider,
  Card,
} from '@/shared/components';

export default function DesignSystemPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="min-h-screen p-8 pb-20">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-4xl font-bold text-[var(--color-text-primary)] mb-2">
            Vox Design System
          </h1>
          <p className="text-[var(--color-text-secondary)]">
            Component library with liquid glass aesthetics
          </p>
        </div>

        {/* Buttons */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Buttons</h2>
          <Card className="p-6">
            <div className="flex flex-wrap gap-4">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="primary" isLoading>
                Loading
              </Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
            </div>
            <Divider className="my-6" />
            <div className="flex flex-wrap gap-4">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
            </div>
          </Card>
        </section>

        {/* Inputs */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Inputs</h2>
          <Card className="p-6 space-y-4">
            <Input placeholder="Default input" label="Email" />
            <Input
              placeholder="With icon"
              leftIcon={<Search className="w-5 h-5" />}
            />
            <Input
              placeholder="Password"
              type="password"
              leftIcon={<Lock className="w-5 h-5" />}
              rightIcon={<Check className="w-5 h-5 text-[var(--color-success)]" />}
            />
            <Input
              placeholder="With error"
              error="This field is required"
              leftIcon={<Mail className="w-5 h-5" />}
            />
          </Card>
        </section>

        {/* Select */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Select</h2>
          <Card className="p-6">
            <Select
              label="Choose an option"
              placeholder="Select..."
              options={[
                { value: 'option1', label: 'Option 1' },
                { value: 'option2', label: 'Option 2' },
                { value: 'option3', label: 'Option 3' },
              ]}
            />
          </Card>
        </section>

        {/* Badges */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Badges</h2>
          <Card className="p-6">
            <div className="flex flex-wrap gap-3">
              <Badge variant="default">Default</Badge>
              <Badge variant="primary">Primary</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="error">Error</Badge>
              <Badge variant="info">Info</Badge>
              <Badge variant="outline">Outline</Badge>
            </div>
            <Divider className="my-6" />
            <div className="flex flex-wrap gap-3">
              <Badge variant="success" dot>
                Online
              </Badge>
              <Badge variant="warning" dot>
                Away
              </Badge>
              <Badge variant="error" dot>
                Busy
              </Badge>
            </div>
          </Card>
        </section>

        {/* Spinner */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Spinners</h2>
          <Card className="p-6">
            <div className="flex items-center gap-6">
              <Spinner size="sm" />
              <Spinner size="md" />
              <Spinner size="lg" />
              <Spinner size="xl" />
            </div>
          </Card>
        </section>

        {/* Tabs */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Tabs</h2>
          <Card className="p-6">
            <Tabs defaultValue="tab1">
              <TabsList>
                <TabsTrigger value="tab1">
                  <Bell className="w-4 h-4" />
                  Overview
                </TabsTrigger>
                <TabsTrigger value="tab2">Settings</TabsTrigger>
                <TabsTrigger value="tab3">Activity</TabsTrigger>
              </TabsList>
              <TabsContent value="tab1">
                <div className="liquid-card p-4">
                  <p>This is the overview tab content with liquid glass effect.</p>
                </div>
              </TabsContent>
              <TabsContent value="tab2">
                <div className="liquid-card p-4">
                  <p>Settings content goes here.</p>
                </div>
              </TabsContent>
              <TabsContent value="tab3">
                <div className="liquid-card p-4">
                  <p>Activity log would be displayed here.</p>
                </div>
              </TabsContent>
            </Tabs>
          </Card>
        </section>

        {/* Modal */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Modal</h2>
          <Card className="p-6">
            <Button onClick={() => setIsModalOpen(true)}>Open Modal</Button>
            <Modal
              isOpen={isModalOpen}
              onClose={() => setIsModalOpen(false)}
              title="Modal Title"
              description="This is a description of the modal content."
            >
              <div className="space-y-4">
                <p className="text-[var(--color-text-secondary)]">
                  Modal content with liquid glass effect. The overlay has a blur
                  effect and the modal uses the design system tokens.
                </p>
                <Input placeholder="Enter something..." />
                <div className="flex gap-3 justify-end">
                  <Button variant="ghost" onClick={() => setIsModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={() => setIsModalOpen(false)}>Confirm</Button>
                </div>
              </div>
            </Modal>
          </Card>
        </section>

        {/* Color Tokens */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Color Tokens</h2>
          <Card className="p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <div className="h-16 rounded-xl bg-[var(--color-primary)]" />
                <p className="text-sm text-center">Primary</p>
              </div>
              <div className="space-y-2">
                <div className="h-16 rounded-xl bg-[var(--color-success)]" />
                <p className="text-sm text-center">Success</p>
              </div>
              <div className="space-y-2">
                <div className="h-16 rounded-xl bg-[var(--color-warning)]" />
                <p className="text-sm text-center">Warning</p>
              </div>
              <div className="space-y-2">
                <div className="h-16 rounded-xl bg-[var(--color-error)]" />
                <p className="text-sm text-center">Error</p>
              </div>
              <div className="space-y-2">
                <div className="h-16 rounded-xl bg-[var(--color-info)]" />
                <p className="text-sm text-center">Info</p>
              </div>
              <div className="space-y-2">
                <div className="h-16 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)]" />
                <p className="text-sm text-center">Glass BG</p>
              </div>
              <div className="space-y-2">
                <div className="h-16 rounded-xl bg-[var(--color-cream)]" />
                <p className="text-sm text-center">Cream</p>
              </div>
              <div className="space-y-2">
                <div className="h-16 rounded-xl bg-[var(--color-beige)]" />
                <p className="text-sm text-center">Beige</p>
              </div>
            </div>
          </Card>
        </section>

        {/* Liquid Effects */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Liquid Glass Effects</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="liquid-glass p-6">
              <h3 className="font-semibold mb-2">Liquid Glass</h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Primary container effect with blur and saturation
              </p>
            </div>
            <div className="liquid-card p-6">
              <h3 className="font-semibold mb-2">Liquid Card</h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Card variant with subtle glass effect
              </p>
            </div>
            <div className="glass p-6 rounded-3xl">
              <h3 className="font-semibold mb-2">Glass</h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Standard glassmorphism effect
              </p>
            </div>
            <div className="liquid-button p-6 text-center">
              <h3 className="font-semibold mb-2">Liquid Button</h3>
              <p className="text-sm opacity-80">
                Primary action button style
              </p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="text-center text-sm text-[var(--color-text-tertiary)]">
          <p>Toggle light/dark mode to see theme switching</p>
        </div>
      </div>
    </div>
  );
}
