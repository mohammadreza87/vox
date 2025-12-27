import type { Meta, StoryObj } from '@storybook/react';
import { Card } from './Card';
import { Button } from './Button';
import { Badge } from './Badge';

const meta: Meta<typeof Card> = {
  title: 'Components/Card',
  component: Card,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'interactive', 'elevated'],
      description: 'Card style variant',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Card>;

// Variants
export const Default: Story = {
  args: {
    children: (
      <div>
        <h3 className="font-semibold text-lg mb-2">Default Card</h3>
        <p className="text-[var(--color-text-secondary)]">
          This is a default card with standard styling.
        </p>
      </div>
    ),
  },
};

export const Interactive: Story = {
  args: {
    variant: 'interactive',
    children: (
      <div>
        <h3 className="font-semibold text-lg mb-2">Interactive Card</h3>
        <p className="text-[var(--color-text-secondary)]">
          Hover over me to see the interaction effect.
        </p>
      </div>
    ),
  },
};

export const Elevated: Story = {
  args: {
    variant: 'elevated',
    children: (
      <div>
        <h3 className="font-semibold text-lg mb-2">Elevated Card</h3>
        <p className="text-[var(--color-text-secondary)]">
          This card has a more prominent shadow.
        </p>
      </div>
    ),
  },
};

// All variants
export const AllVariants: Story = {
  render: () => (
    <div className="space-y-4">
      <Card>
        <h3 className="font-semibold">Default</h3>
        <p className="text-sm text-[var(--color-text-secondary)]">Standard card styling</p>
      </Card>
      <Card variant="interactive">
        <h3 className="font-semibold">Interactive</h3>
        <p className="text-sm text-[var(--color-text-secondary)]">Hover for effect</p>
      </Card>
      <Card variant="elevated">
        <h3 className="font-semibold">Elevated</h3>
        <p className="text-sm text-[var(--color-text-secondary)]">Prominent shadow</p>
      </Card>
    </div>
  ),
};

// Contact card example
export const ContactCard: Story = {
  render: () => (
    <Card variant="interactive" className="w-80">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white text-2xl">
          A
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">AI Assistant</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">Your helpful companion</p>
        </div>
        <Badge variant="success" dot>Online</Badge>
      </div>
    </Card>
  ),
};

// Pricing card example
export const PricingCard: Story = {
  render: () => (
    <Card variant="elevated" className="w-80 text-center">
      <Badge variant="primary" className="mb-4">Pro</Badge>
      <h2 className="text-3xl font-bold mb-2">$9.99</h2>
      <p className="text-[var(--color-text-secondary)] mb-6">per month</p>
      <ul className="space-y-2 text-sm text-left mb-6">
        <li className="flex items-center gap-2">
          <span className="text-[var(--color-success)]">✓</span>
          Unlimited messages
        </li>
        <li className="flex items-center gap-2">
          <span className="text-[var(--color-success)]">✓</span>
          Voice cloning
        </li>
        <li className="flex items-center gap-2">
          <span className="text-[var(--color-success)]">✓</span>
          Priority support
        </li>
      </ul>
      <Button className="w-full">Get Started</Button>
    </Card>
  ),
};
