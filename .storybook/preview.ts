import type { Preview } from '@storybook/nextjs-vite';
import React from 'react';

// Import global styles
import '../src/app/globals.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#f5f5f7' },
        { name: 'dark', value: '#0a0a0a' },
      ],
    },
    layout: 'centered',
  },
  decorators: [
    (Story, context) => {
      // Apply dark mode class based on background
      const isDark = context.globals.backgrounds?.value === '#0a0a0a';

      React.useEffect(() => {
        if (isDark) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }, [isDark]);

      return React.createElement('div', {
        className: 'font-sans',
        style: { padding: '1rem' }
      }, React.createElement(Story));
    },
  ],
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Global theme for components',
      defaultValue: 'light',
      toolbar: {
        icon: 'circlehollow',
        items: [
          { value: 'light', icon: 'sun', title: 'Light' },
          { value: 'dark', icon: 'moon', title: 'Dark' },
        ],
        showName: true,
        dynamicTitle: true,
      },
    },
  },
};

export default preview;
