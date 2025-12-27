import type { Meta, StoryObj } from '@storybook/react';
import { Select } from './Select';
import { Globe, Mic, Settings } from 'lucide-react';

const meta: Meta<typeof Select> = {
  title: 'Components/Select',
  component: Select,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'liquid', 'glass'],
      description: 'Select style variant',
    },
    selectSize: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'Select size',
    },
    label: {
      control: 'text',
      description: 'Select label',
    },
    error: {
      control: 'text',
      description: 'Error message',
    },
    disabled: {
      control: 'boolean',
      description: 'Disable select',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Select>;

const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
];

const voiceOptions = [
  { value: 'alloy', label: 'Alloy' },
  { value: 'echo', label: 'Echo' },
  { value: 'fable', label: 'Fable' },
  { value: 'onyx', label: 'Onyx' },
  { value: 'nova', label: 'Nova' },
  { value: 'shimmer', label: 'Shimmer' },
];

// Basic
export const Default: Story = {
  args: {
    options: languageOptions,
    placeholder: 'Select a language',
  },
};

export const WithLabel: Story = {
  args: {
    label: 'Language',
    options: languageOptions,
    placeholder: 'Select a language',
  },
};

// Variants
export const Liquid: Story = {
  args: {
    variant: 'liquid',
    label: 'Preferred Language',
    options: languageOptions,
    placeholder: 'Choose...',
  },
};

export const Glass: Story = {
  args: {
    variant: 'glass',
    label: 'Preferred Language',
    options: languageOptions,
    placeholder: 'Choose...',
  },
};

// Sizes
export const Small: Story = {
  args: {
    selectSize: 'sm',
    options: languageOptions,
    placeholder: 'Small select',
  },
};

export const Medium: Story = {
  args: {
    selectSize: 'md',
    options: languageOptions,
    placeholder: 'Medium select',
  },
};

export const Large: Story = {
  args: {
    selectSize: 'lg',
    options: languageOptions,
    placeholder: 'Large select',
  },
};

// With icon
export const WithIcon: Story = {
  args: {
    label: 'Language',
    options: languageOptions,
    placeholder: 'Select language',
    leftIcon: <Globe className="w-5 h-5" />,
  },
};

// States
export const WithError: Story = {
  args: {
    label: 'Language',
    options: languageOptions,
    placeholder: 'Select a language',
    error: 'Please select a language',
  },
};

export const Disabled: Story = {
  args: {
    options: languageOptions,
    placeholder: 'Disabled select',
    disabled: true,
  },
};

export const WithDisabledOption: Story = {
  args: {
    label: 'Voice',
    options: [
      { value: 'alloy', label: 'Alloy' },
      { value: 'echo', label: 'Echo' },
      { value: 'premium', label: 'Premium Voice (Pro only)', disabled: true },
    ],
    placeholder: 'Choose a voice',
  },
};

// Form example
export const FormExample: Story = {
  render: () => (
    <div className="space-y-4 w-80">
      <Select
        label="Language"
        options={languageOptions}
        placeholder="Select language"
        leftIcon={<Globe className="w-5 h-5" />}
      />
      <Select
        label="Voice"
        options={voiceOptions}
        placeholder="Select voice"
        leftIcon={<Mic className="w-5 h-5" />}
        variant="glass"
      />
      <Select
        label="Quality"
        options={[
          { value: 'standard', label: 'Standard' },
          { value: 'high', label: 'High Quality' },
          { value: 'ultra', label: 'Ultra HD (Pro)', disabled: true },
        ]}
        placeholder="Select quality"
        leftIcon={<Settings className="w-5 h-5" />}
      />
    </div>
  ),
};
