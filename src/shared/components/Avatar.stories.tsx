import type { Meta, StoryObj } from '@storybook/react';
import { Avatar } from './Avatar';

const meta: Meta<typeof Avatar> = {
  title: 'Components/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg', 'xl'],
      description: 'Avatar size',
    },
    src: {
      control: 'text',
      description: 'Image URL',
    },
    fallback: {
      control: 'text',
      description: 'Fallback text when no image',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Avatar>;

// Sizes
export const Small: Story = {
  args: {
    size: 'sm',
    fallback: 'A',
  },
};

export const Medium: Story = {
  args: {
    size: 'md',
    fallback: 'JD',
  },
};

export const Large: Story = {
  args: {
    size: 'lg',
    fallback: 'M',
  },
};

export const ExtraLarge: Story = {
  args: {
    size: 'xl',
    fallback: 'V',
  },
};

// All sizes
export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Avatar size="sm" fallback="S" />
      <Avatar size="md" fallback="M" />
      <Avatar size="lg" fallback="L" />
      <Avatar size="xl" fallback="XL" />
    </div>
  ),
};

// With image
export const WithImage: Story = {
  args: {
    src: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop',
    alt: 'User avatar',
    size: 'lg',
  },
};

// Contact avatars
export const ContactAvatars: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar fallback="AI" size="md" />
        <div>
          <p className="font-medium">AI Assistant</p>
          <p className="text-sm text-[var(--color-text-secondary)]">Your helpful companion</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Avatar fallback="T" size="md" />
        <div>
          <p className="font-medium">Translator</p>
          <p className="text-sm text-[var(--color-text-secondary)]">Multilingual support</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Avatar fallback="C" size="md" />
        <div>
          <p className="font-medium">Custom Contact</p>
          <p className="text-sm text-[var(--color-text-secondary)]">Your personalized AI</p>
        </div>
      </div>
    </div>
  ),
};

// Avatar group
export const AvatarGroup: Story = {
  render: () => (
    <div className="flex -space-x-3">
      <Avatar size="md" fallback="A" className="border-2 border-[var(--color-beige)]" />
      <Avatar size="md" fallback="B" className="border-2 border-[var(--color-beige)]" />
      <Avatar size="md" fallback="C" className="border-2 border-[var(--color-beige)]" />
      <Avatar size="md" fallback="+5" className="border-2 border-[var(--color-beige)] bg-[var(--color-text-tertiary)]" />
    </div>
  ),
};
