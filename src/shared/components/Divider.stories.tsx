import type { Meta, StoryObj } from '@storybook/react';
import { Divider } from './Divider';

const meta: Meta<typeof Divider> = {
  title: 'Components/Divider',
  component: Divider,
  tags: ['autodocs'],
  argTypes: {
    orientation: {
      control: 'select',
      options: ['horizontal', 'vertical'],
      description: 'Divider orientation',
    },
    variant: {
      control: 'select',
      options: ['default', 'liquid', 'dashed'],
      description: 'Divider style variant',
    },
    label: {
      control: 'text',
      description: 'Optional center label',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Divider>;

// Variants
export const Default: Story = {
  args: {
    variant: 'default',
  },
};

export const Liquid: Story = {
  args: {
    variant: 'liquid',
  },
};

export const Dashed: Story = {
  args: {
    variant: 'dashed',
  },
};

// All variants
export const AllVariants: Story = {
  render: () => (
    <div className="space-y-8 w-96">
      <div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-2">Default</p>
        <Divider variant="default" />
      </div>
      <div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-2">Liquid</p>
        <Divider variant="liquid" />
      </div>
      <div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-2">Dashed</p>
        <Divider variant="dashed" />
      </div>
    </div>
  ),
};

// With label
export const WithLabel: Story = {
  args: {
    variant: 'liquid',
    label: 'OR',
  },
};

export const WithLongLabel: Story = {
  args: {
    variant: 'default',
    label: 'Continue with',
  },
};

// Vertical
export const Vertical: Story = {
  render: () => (
    <div className="flex items-center gap-4 h-24">
      <span>Left Content</span>
      <Divider orientation="vertical" variant="liquid" />
      <span>Right Content</span>
    </div>
  ),
};

// Use cases
export const LoginDivider: Story = {
  render: () => (
    <div className="space-y-4 w-80">
      <button className="w-full py-3 px-4 border border-[var(--glass-border)] rounded-xl hover:bg-[var(--glass-bg)] transition-colors">
        Continue with Google
      </button>
      <Divider label="or continue with email" />
      <button className="w-full py-3 px-4 bg-[var(--color-primary)] text-white rounded-xl">
        Sign In
      </button>
    </div>
  ),
};

export const ListDividers: Story = {
  render: () => (
    <div className="w-80">
      <div className="p-4">
        <p className="font-medium">First Item</p>
        <p className="text-sm text-[var(--color-text-secondary)]">Description text</p>
      </div>
      <Divider />
      <div className="p-4">
        <p className="font-medium">Second Item</p>
        <p className="text-sm text-[var(--color-text-secondary)]">Description text</p>
      </div>
      <Divider />
      <div className="p-4">
        <p className="font-medium">Third Item</p>
        <p className="text-sm text-[var(--color-text-secondary)]">Description text</p>
      </div>
    </div>
  ),
};

export const InCard: Story = {
  render: () => (
    <div className="w-80 p-6 bg-[var(--color-beige)] rounded-3xl border border-[var(--foreground)]/10">
      <h3 className="font-semibold mb-4">Settings</h3>
      <Divider variant="liquid" className="my-4" />
      <div className="space-y-3">
        <p className="text-sm text-[var(--color-text-secondary)]">Theme: Dark</p>
        <p className="text-sm text-[var(--color-text-secondary)]">Language: English</p>
        <p className="text-sm text-[var(--color-text-secondary)]">Voice: Alloy</p>
      </div>
      <Divider variant="dashed" className="my-4" />
      <p className="text-xs text-[var(--color-text-tertiary)]">Last updated: Today</p>
    </div>
  ),
};
