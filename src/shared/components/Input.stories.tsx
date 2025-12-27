import type { Meta, StoryObj } from '@storybook/react';
import { Input } from './Input';
import { Mail, Lock, Search, Eye, Check } from 'lucide-react';

const meta: Meta<typeof Input> = {
  title: 'Components/Input',
  component: Input,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'glass', 'liquid'],
      description: 'Input style variant',
    },
    label: {
      control: 'text',
      description: 'Input label',
    },
    error: {
      control: 'text',
      description: 'Error message',
    },
    disabled: {
      control: 'boolean',
      description: 'Disable input',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

// Basic
export const Default: Story = {
  args: {
    placeholder: 'Enter text...',
  },
};

export const WithLabel: Story = {
  args: {
    label: 'Email',
    placeholder: 'you@example.com',
    type: 'email',
  },
};

// Variants
export const Glass: Story = {
  args: {
    variant: 'glass',
    placeholder: 'Glass variant',
  },
};

export const Liquid: Story = {
  args: {
    variant: 'liquid',
    placeholder: 'Liquid variant',
  },
};

// With icons
export const WithLeftIcon: Story = {
  args: {
    leftIcon: <Mail className="w-5 h-5" />,
    placeholder: 'Email address',
  },
};

export const WithRightIcon: Story = {
  args: {
    rightIcon: <Check className="w-5 h-5 text-green-500" />,
    placeholder: 'Verified input',
  },
};

export const WithBothIcons: Story = {
  args: {
    leftIcon: <Lock className="w-5 h-5" />,
    rightIcon: <Eye className="w-5 h-5" />,
    type: 'password',
    placeholder: 'Password',
  },
};

// States
export const WithError: Story = {
  args: {
    label: 'Email',
    placeholder: 'you@example.com',
    error: 'Please enter a valid email address',
    leftIcon: <Mail className="w-5 h-5" />,
  },
};

export const Disabled: Story = {
  args: {
    placeholder: 'Disabled input',
    disabled: true,
  },
};

// Form example
export const FormExample: Story = {
  render: () => (
    <div className="space-y-4 w-80">
      <Input
        label="Email"
        type="email"
        placeholder="you@example.com"
        leftIcon={<Mail className="w-5 h-5" />}
      />
      <Input
        label="Password"
        type="password"
        placeholder="Enter password"
        leftIcon={<Lock className="w-5 h-5" />}
      />
      <Input
        label="Search"
        placeholder="Search..."
        leftIcon={<Search className="w-5 h-5" />}
        variant="glass"
      />
    </div>
  ),
};
