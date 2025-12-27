import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';

const meta: Meta<typeof Modal> = {
  title: 'Components/Modal',
  component: Modal,
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg', 'xl', 'full'],
      description: 'Modal size',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Modal>;

// Interactive story
const ModalDemo = ({ size = 'md', title = 'Modal Title', description = 'Modal description' }: { size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'; title?: string; description?: string }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Open Modal</Button>
      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={title}
        description={description}
        size={size}
      >
        <div className="space-y-4">
          <p className="text-[var(--color-text-secondary)]">
            This is the modal content. You can put any content here.
          </p>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setIsOpen(false)}>
              Confirm
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export const Default: Story = {
  render: () => <ModalDemo />,
};

// Sizes
export const Small: Story = {
  render: () => <ModalDemo size="sm" title="Small Modal" />,
};

export const Medium: Story = {
  render: () => <ModalDemo size="md" title="Medium Modal" />,
};

export const Large: Story = {
  render: () => <ModalDemo size="lg" title="Large Modal" />,
};

export const ExtraLarge: Story = {
  render: () => <ModalDemo size="xl" title="Extra Large Modal" />,
};

// With form
const FormModal = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Create Contact</Button>
      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Create New Contact"
        description="Fill in the details to create a new AI contact."
      >
        <div className="space-y-4">
          <Input label="Name" placeholder="Contact name" />
          <Input label="Purpose" placeholder="What is this contact for?" />
          <div className="flex gap-3 justify-end pt-4">
            <Button variant="ghost" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setIsOpen(false)}>
              Create
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export const WithForm: Story = {
  render: () => <FormModal />,
};

// Confirmation dialog
const ConfirmationModal = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button variant="danger" onClick={() => setIsOpen(true)}>Delete Chat</Button>
      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Delete Chat"
        description="Are you sure you want to delete this chat?"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-[var(--color-text-secondary)]">
            This action cannot be undone. All messages in this chat will be permanently deleted.
          </p>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => setIsOpen(false)}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export const Confirmation: Story = {
  render: () => <ConfirmationModal />,
};
