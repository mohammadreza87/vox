import type { Meta, StoryObj } from '@storybook/react';
import { ToastProvider, useToast, useToastActions } from './Toast';
import { Button } from './Button';

const meta: Meta = {
  title: 'Components/Toast',
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
      </ToastProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj;

// Interactive demo components
const ToastDemo = ({ type }: { type: 'success' | 'error' | 'warning' | 'info' }) => {
  const { addToast } = useToast();

  const messages = {
    success: { title: 'Success!', description: 'Your changes have been saved.' },
    error: { title: 'Error', description: 'Something went wrong. Please try again.' },
    warning: { title: 'Warning', description: 'Your session is about to expire.' },
    info: { title: 'Information', description: 'A new update is available.' },
  };

  return (
    <Button onClick={() => addToast({ type, ...messages[type] })}>
      Show {type} toast
    </Button>
  );
};

const AllToastsDemo = () => {
  const toast = useToastActions();

  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => toast.success('Success!', 'Operation completed successfully.')}>
        Success
      </Button>
      <Button variant="danger" onClick={() => toast.error('Error', 'Failed to process request.')}>
        Error
      </Button>
      <Button variant="secondary" onClick={() => toast.warning('Warning', 'Please check your input.')}>
        Warning
      </Button>
      <Button variant="ghost" onClick={() => toast.info('Info', 'New features available.')}>
        Info
      </Button>
    </div>
  );
};

// Stories
export const Success: Story = {
  render: () => <ToastDemo type="success" />,
};

export const Error: Story = {
  render: () => <ToastDemo type="error" />,
};

export const Warning: Story = {
  render: () => <ToastDemo type="warning" />,
};

export const Info: Story = {
  render: () => <ToastDemo type="info" />,
};

export const AllTypes: Story = {
  render: () => <AllToastsDemo />,
};

// Multiple toasts demo
const MultipleToastsDemo = () => {
  const toast = useToastActions();

  const showMultiple = () => {
    toast.info('Processing', 'Starting upload...');
    setTimeout(() => toast.warning('Please wait', 'Upload in progress...'), 500);
    setTimeout(() => toast.success('Complete', 'File uploaded successfully!'), 2000);
  };

  return (
    <Button onClick={showMultiple}>
      Show multiple toasts
    </Button>
  );
};

export const MultipleToasts: Story = {
  render: () => <MultipleToastsDemo />,
};

// Custom duration demo
const CustomDurationDemo = () => {
  const { addToast } = useToast();

  return (
    <div className="flex gap-3">
      <Button
        variant="ghost"
        onClick={() => addToast({
          type: 'info',
          title: 'Quick toast',
          description: 'This disappears in 2 seconds',
          duration: 2000,
        })}
      >
        Quick (2s)
      </Button>
      <Button
        variant="secondary"
        onClick={() => addToast({
          type: 'info',
          title: 'Default toast',
          description: 'This disappears in 5 seconds',
        })}
      >
        Default (5s)
      </Button>
      <Button
        onClick={() => addToast({
          type: 'warning',
          title: 'Long toast',
          description: 'This stays for 10 seconds',
          duration: 10000,
        })}
      >
        Long (10s)
      </Button>
    </div>
  );
};

export const CustomDurations: Story = {
  render: () => <CustomDurationDemo />,
};

// Real-world use case
const RealWorldDemo = () => {
  const toast = useToastActions();

  const handleSave = () => {
    toast.info('Saving...', 'Please wait');
    setTimeout(() => {
      toast.success('Saved!', 'Your profile has been updated.');
    }, 1500);
  };

  const handleDelete = () => {
    toast.warning('Confirm deletion', 'This action cannot be undone.');
  };

  const handleError = () => {
    toast.error('Connection failed', 'Please check your internet connection.');
  };

  return (
    <div className="space-y-4 w-80">
      <h3 className="font-semibold">Profile Settings</h3>
      <div className="flex gap-3">
        <Button onClick={handleSave}>Save Changes</Button>
        <Button variant="danger" onClick={handleDelete}>Delete</Button>
      </div>
      <Button variant="ghost" onClick={handleError} className="w-full">
        Simulate Error
      </Button>
    </div>
  );
};

export const RealWorldExample: Story = {
  render: () => <RealWorldDemo />,
};
