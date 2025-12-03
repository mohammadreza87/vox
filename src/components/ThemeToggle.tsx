'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="w-10 h-10 rounded-full bg-[var(--color-beige)] dark:bg-[#333333] flex items-center justify-center hover:opacity-80 transition-all"
      title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      {theme === 'light' ? (
        <Moon className="w-5 h-5 text-[var(--color-dark)] dark:text-[#FAF3E1]" />
      ) : (
        <Sun className="w-5 h-5 text-[var(--color-dark)] dark:text-[#FAF3E1]" />
      )}
    </button>
  );
}
