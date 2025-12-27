import type { Meta, StoryObj } from '@storybook/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs';
import { Bell, Settings, User, MessageSquare } from 'lucide-react';

const meta: Meta<typeof Tabs> = {
  title: 'Components/Tabs',
  component: Tabs,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Tabs>;

// Basic tabs
export const Default: Story = {
  render: () => (
    <Tabs defaultValue="tab1" className="w-96">
      <TabsList>
        <TabsTrigger value="tab1">Overview</TabsTrigger>
        <TabsTrigger value="tab2">Settings</TabsTrigger>
        <TabsTrigger value="tab3">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">
        <div className="liquid-card p-4">
          <h3 className="font-semibold mb-2">Overview</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">
            This is the overview tab content.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="tab2">
        <div className="liquid-card p-4">
          <h3 className="font-semibold mb-2">Settings</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Configure your preferences here.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="tab3">
        <div className="liquid-card p-4">
          <h3 className="font-semibold mb-2">Activity</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Recent activity will appear here.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  ),
};

// With icons
export const WithIcons: Story = {
  render: () => (
    <Tabs defaultValue="notifications" className="w-96">
      <TabsList>
        <TabsTrigger value="notifications">
          <Bell className="w-4 h-4" />
          Notifications
        </TabsTrigger>
        <TabsTrigger value="messages">
          <MessageSquare className="w-4 h-4" />
          Messages
        </TabsTrigger>
        <TabsTrigger value="profile">
          <User className="w-4 h-4" />
          Profile
        </TabsTrigger>
      </TabsList>
      <TabsContent value="notifications">
        <div className="liquid-card p-4">
          <p className="text-sm text-[var(--color-text-secondary)]">
            No new notifications
          </p>
        </div>
      </TabsContent>
      <TabsContent value="messages">
        <div className="liquid-card p-4">
          <p className="text-sm text-[var(--color-text-secondary)]">
            3 unread messages
          </p>
        </div>
      </TabsContent>
      <TabsContent value="profile">
        <div className="liquid-card p-4">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Manage your profile settings
          </p>
        </div>
      </TabsContent>
    </Tabs>
  ),
};

// Full width tabs
export const FullWidth: Story = {
  render: () => (
    <div className="w-full max-w-md">
      <Tabs defaultValue="all">
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1">All</TabsTrigger>
          <TabsTrigger value="active" className="flex-1">Active</TabsTrigger>
          <TabsTrigger value="archived" className="flex-1">Archived</TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          <div className="p-4 text-center text-[var(--color-text-secondary)]">
            All items shown
          </div>
        </TabsContent>
        <TabsContent value="active">
          <div className="p-4 text-center text-[var(--color-text-secondary)]">
            Active items only
          </div>
        </TabsContent>
        <TabsContent value="archived">
          <div className="p-4 text-center text-[var(--color-text-secondary)]">
            Archived items
          </div>
        </TabsContent>
      </Tabs>
    </div>
  ),
};
