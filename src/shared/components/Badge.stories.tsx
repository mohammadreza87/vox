import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './Badge';

const meta: Meta<typeof Badge> = {
  title: 'Components/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'primary', 'success', 'warning', 'error', 'info', 'outline'],
      description: 'Badge style variant',
    },
    dot: {
      control: 'boolean',
      description: 'Show status dot',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

// Variants
export const Default: Story = {
  args: {
    children: 'Default',
    variant: 'default',
  },
};

export const Primary: Story = {
  args: {
    children: 'Primary',
    variant: 'primary',
  },
};

export const Success: Story = {
  args: {
    children: 'Success',
    variant: 'success',
  },
};

export const Warning: Story = {
  args: {
    children: 'Warning',
    variant: 'warning',
  },
};

export const Error: Story = {
  args: {
    children: 'Error',
    variant: 'error',
  },
};

export const Info: Story = {
  args: {
    children: 'Info',
    variant: 'info',
  },
};

export const Outline: Story = {
  args: {
    children: 'Outline',
    variant: 'outline',
  },
};

// With dot
export const WithDot: Story = {
  args: {
    children: 'Online',
    variant: 'success',
    dot: true,
  },
};

// All variants showcase
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Badge variant="default">Default</Badge>
      <Badge variant="primary">Primary</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="error">Error</Badge>
      <Badge variant="info">Info</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  ),
};

// Status badges
export const StatusBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Badge variant="success" dot>Online</Badge>
      <Badge variant="warning" dot>Away</Badge>
      <Badge variant="error" dot>Busy</Badge>
      <Badge variant="default" dot>Offline</Badge>
    </div>
  ),
};

// Use cases
export const UseCases: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm">Subscription:</span>
        <Badge variant="primary">Pro</Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm">Status:</span>
        <Badge variant="success" dot>Active</Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm">Messages:</span>
        <Badge variant="info">12 new</Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm">Quota:</span>
        <Badge variant="warning">80% used</Badge>
      </div>
    </div>
  ),
};
