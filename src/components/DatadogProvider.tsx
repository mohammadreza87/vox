'use client';

/**
 * Datadog Provider Component
 *
 * Wraps the application to provide Datadog RUM initialization
 * and user tracking for LLM observability.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  initializeRUM,
  setRUMUser,
  clearRUMUser,
  addRUMAction,
  llmRUM,
} from '@/lib/datadog/rum';

interface DatadogContextValue {
  isInitialized: boolean;
  trackAction: (name: string, context?: Record<string, unknown>) => void;
  llm: typeof llmRUM;
}

const DatadogContext = createContext<DatadogContextValue | null>(null);

interface DatadogProviderProps {
  children: ReactNode;
  user?: {
    id: string;
    email?: string;
    name?: string;
  } | null;
}

/**
 * DatadogProvider component
 *
 * Initializes Datadog RUM and provides context for tracking user actions.
 *
 * @example
 * ```tsx
 * // In your app layout or root component
 * import { DatadogProvider } from '@/components/DatadogProvider';
 *
 * export default function RootLayout({ children }) {
 *   const user = useAuth(); // Your auth hook
 *
 *   return (
 *     <DatadogProvider user={user}>
 *       {children}
 *     </DatadogProvider>
 *   );
 * }
 * ```
 */
export function DatadogProvider({ children, user }: DatadogProviderProps) {
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize RUM on mount
  useEffect(() => {
    initializeRUM()
      .then((success) => {
        setIsInitialized(success);
        if (success) {
          addRUMAction('app.initialized', { timestamp: Date.now() });
        }
      })
      .catch(console.error);
  }, []);

  // Update user when it changes
  useEffect(() => {
    if (!isInitialized) return;

    if (user) {
      setRUMUser(user);
      addRUMAction('user.identified', { user_id: user.id });
    } else {
      clearRUMUser();
    }
  }, [isInitialized, user?.id, user?.email, user?.name]);

  const value: DatadogContextValue = {
    isInitialized,
    trackAction: addRUMAction,
    llm: llmRUM,
  };

  return (
    <DatadogContext.Provider value={value}>
      {children}
    </DatadogContext.Provider>
  );
}

/**
 * Hook to access Datadog context
 *
 * @example
 * ```tsx
 * function ChatComponent() {
 *   const datadog = useDatadog();
 *
 *   const handleSendMessage = async () => {
 *     const stopTracking = datadog.llm.trackStreamStart('gemini', 'gemini-2.0-flash');
 *     // ... send message
 *     stopTracking(); // Call when stream ends
 *   };
 * }
 * ```
 */
export function useDatadog(): DatadogContextValue {
  const context = useContext(DatadogContext);

  if (!context) {
    // Return a no-op implementation when not wrapped in provider
    return {
      isInitialized: false,
      trackAction: () => {},
      llm: {
        trackMessageSent: () => {},
        trackResponseReceived: () => {},
        trackStreamStart: () => () => {},
        trackFirstToken: () => {},
        trackError: () => {},
        trackModelSwitch: () => {},
        trackVoiceSynthesis: () => {},
      },
    };
  }

  return context;
}

export default DatadogProvider;
