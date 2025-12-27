import type { Meta, StoryObj } from '@storybook/react';
import { Spinner, LoadingScreen } from './Spinner';

const meta: Meta<typeof Spinner> = {
  title: 'Components/Spinner',
  component: Spinner,
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg', 'xl'],
      description: 'Spinner size',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Spinner>;

// Sizes
export const Small: Story = {
  args: {
    size: 'sm',
  },
};

export const Medium: Story = {
  args: {
    size: 'md',
  },
};

export const Large: Story = {
  args: {
    size: 'lg',
  },
};

export const ExtraLarge: Story = {
  args: {
    size: 'xl',
  },
};

// All sizes
export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <Spinner size="sm" />
      <Spinner size="md" />
      <Spinner size="lg" />
      <Spinner size="xl" />
    </div>
  ),
};

// Loading screen
export const FullScreenLoading: Story = {
  render: () => (
    <div className="relative h-64 w-full border border-[var(--glass-border)] rounded-xl overflow-hidden">
      <LoadingScreen />
    </div>
  ),
};

// Usage example
export const InButton: Story = {
  render: () => (
    <button className="liquid-button px-6 py-3 rounded-xl flex items-center gap-2 text-white">
      <Spinner size="sm" />
      Loading...
    </button>
  ),
};
