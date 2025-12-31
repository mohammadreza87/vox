'use client';

/**
 * Datadog Real User Monitoring (RUM) for Frontend
 *
 * Provides browser-side monitoring including:
 * - Page load performance
 * - User interactions
 * - JavaScript errors
 * - Resource timing
 * - Long tasks
 * - Custom actions and events
 */

import { useEffect, useCallback } from 'react';

interface RUMConfig {
  applicationId: string;
  clientToken: string;
  site: string;
  service: string;
  env: string;
  version: string;
  sessionSampleRate: number;
  sessionReplaySampleRate: number;
  trackUserInteractions: boolean;
  trackResources: boolean;
  trackLongTasks: boolean;
  defaultPrivacyLevel: 'mask' | 'mask-user-input' | 'allow';
}

interface RUMUser {
  id: string;
  email?: string;
  name?: string;
}

interface RUMAction {
  name: string;
  context?: Record<string, unknown>;
}

interface RUMError {
  message: string;
  source: 'source' | 'network' | 'console' | 'custom';
  context?: Record<string, unknown>;
}

// Global RUM state
let isInitialized = false;
let pendingActions: RUMAction[] = [];
let pendingErrors: RUMError[] = [];

/**
 * Get RUM configuration from environment
 */
function getRUMConfig(): RUMConfig | null {
  const applicationId = process.env.NEXT_PUBLIC_DD_RUM_APPLICATION_ID;
  const clientToken = process.env.NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN;

  if (!applicationId || !clientToken) {
    return null;
  }

  return {
    applicationId,
    clientToken,
    site: process.env.NEXT_PUBLIC_DD_SITE || 'datadoghq.com',
    service: 'vox-frontend',
    env: process.env.NODE_ENV || 'development',
    version: process.env.NEXT_PUBLIC_DD_VERSION || '1.0.0',
    sessionSampleRate: 100,
    sessionReplaySampleRate: 20,
    trackUserInteractions: true,
    trackResources: true,
    trackLongTasks: true,
    defaultPrivacyLevel: 'mask-user-input',
  };
}

/**
 * Load Datadog RUM SDK dynamically
 */
async function loadRUMSDK(): Promise<typeof window.DD_RUM | null> {
  if (typeof window === 'undefined') return null;

  // Check if already loaded
  if (window.DD_RUM) {
    return window.DD_RUM;
  }

  // Dynamically load the RUM SDK
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://www.datadoghq-browser-agent.com/us1/v5/datadog-rum.js';
    script.async = true;
    script.onload = () => {
      resolve(window.DD_RUM || null);
    };
    script.onerror = () => {
      console.warn('[Datadog RUM] Failed to load SDK');
      resolve(null);
    };
    document.head.appendChild(script);
  });
}

/**
 * Initialize Datadog RUM
 */
export async function initializeRUM(): Promise<boolean> {
  if (isInitialized) return true;
  if (typeof window === 'undefined') return false;

  const config = getRUMConfig();
  if (!config) {
    console.log('[Datadog RUM] Not configured - missing applicationId or clientToken');
    return false;
  }

  const DD_RUM = await loadRUMSDK();
  if (!DD_RUM) {
    return false;
  }

  try {
    DD_RUM.init({
      applicationId: config.applicationId,
      clientToken: config.clientToken,
      site: config.site,
      service: config.service,
      env: config.env,
      version: config.version,
      sessionSampleRate: config.sessionSampleRate,
      sessionReplaySampleRate: config.sessionReplaySampleRate,
      trackUserInteractions: config.trackUserInteractions,
      trackResources: config.trackResources,
      trackLongTasks: config.trackLongTasks,
      defaultPrivacyLevel: config.defaultPrivacyLevel,
      // LLM-specific context
      beforeSend: (event) => {
        // Add custom context to all events
        event.context = {
          ...event.context,
          app: 'vox',
          feature: 'llm-chat',
        };
        return true;
      },
    });

    isInitialized = true;
    console.log('[Datadog RUM] Initialized successfully');

    // Process pending actions and errors
    pendingActions.forEach((action) => DD_RUM.addAction(action.name, action.context));
    pendingErrors.forEach((error) => DD_RUM.addError(new Error(error.message), error.context));
    pendingActions = [];
    pendingErrors = [];

    return true;
  } catch (error) {
    console.error('[Datadog RUM] Initialization failed:', error);
    return false;
  }
}

/**
 * Set the current user for RUM
 */
export function setRUMUser(user: RUMUser): void {
  if (typeof window === 'undefined' || !window.DD_RUM) return;

  window.DD_RUM.setUser({
    id: user.id,
    email: user.email,
    name: user.name,
  });
}

/**
 * Clear the current user from RUM
 */
export function clearRUMUser(): void {
  if (typeof window === 'undefined' || !window.DD_RUM) return;
  window.DD_RUM.clearUser();
}

/**
 * Add a custom action to RUM
 */
export function addRUMAction(name: string, context?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;

  if (window.DD_RUM) {
    window.DD_RUM.addAction(name, context);
  } else {
    pendingActions.push({ name, context });
  }
}

/**
 * Add a custom error to RUM
 */
export function addRUMError(
  message: string,
  source: RUMError['source'] = 'custom',
  context?: Record<string, unknown>
): void {
  if (typeof window === 'undefined') return;

  if (window.DD_RUM) {
    window.DD_RUM.addError(new Error(message), { source, ...context });
  } else {
    pendingErrors.push({ message, source, context });
  }
}

/**
 * Start a custom timing measurement
 */
export function startRUMTiming(name: string): () => void {
  const startTime = performance.now();

  return () => {
    const duration = performance.now() - startTime;
    addRUMAction(`timing.${name}`, { duration_ms: duration });
  };
}

/**
 * Track LLM-specific events
 */
export const llmRUM = {
  /**
   * Track when a chat message is sent
   */
  trackMessageSent(provider: string, model: string): void {
    addRUMAction('llm.message_sent', { provider, model });
  },

  /**
   * Track when a response is received
   */
  trackResponseReceived(provider: string, model: string, durationMs: number): void {
    addRUMAction('llm.response_received', { provider, model, duration_ms: durationMs });
  },

  /**
   * Track streaming start
   */
  trackStreamStart(provider: string, model: string): () => void {
    const startTime = performance.now();
    addRUMAction('llm.stream_start', { provider, model });

    return () => {
      const duration = performance.now() - startTime;
      addRUMAction('llm.stream_complete', { provider, model, duration_ms: duration });
    };
  },

  /**
   * Track time to first token
   */
  trackFirstToken(provider: string, model: string, timeMs: number): void {
    addRUMAction('llm.first_token', { provider, model, time_ms: timeMs });
  },

  /**
   * Track LLM errors
   */
  trackError(provider: string, model: string, errorMessage: string): void {
    addRUMError(`LLM Error: ${errorMessage}`, 'custom', { provider, model });
  },

  /**
   * Track model switch
   */
  trackModelSwitch(fromModel: string, toModel: string): void {
    addRUMAction('llm.model_switch', { from_model: fromModel, to_model: toModel });
  },

  /**
   * Track voice synthesis
   */
  trackVoiceSynthesis(voiceId: string, durationMs: number): void {
    addRUMAction('voice.synthesis', { voice_id: voiceId, duration_ms: durationMs });
  },
};

/**
 * React hook for initializing Datadog RUM
 */
export function useDatadogRUM(user?: RUMUser | null): void {
  useEffect(() => {
    initializeRUM().catch(console.error);
  }, []);

  useEffect(() => {
    if (user) {
      setRUMUser(user);
    } else {
      clearRUMUser();
    }
  }, [user?.id, user?.email, user?.name]);
}

/**
 * React hook for tracking page views
 */
export function useRUMPageView(pageName: string, context?: Record<string, unknown>): void {
  useEffect(() => {
    addRUMAction('page_view', { page: pageName, ...context });
  }, [pageName]);
}

/**
 * React hook for tracking LLM chat sessions
 */
export function useRUMChatSession(chatId: string | null, provider: string, model: string) {
  useEffect(() => {
    if (chatId) {
      addRUMAction('chat.session_start', { chat_id: chatId, provider, model });

      return () => {
        addRUMAction('chat.session_end', { chat_id: chatId });
      };
    }
  }, [chatId, provider, model]);

  const trackMessage = useCallback(() => {
    llmRUM.trackMessageSent(provider, model);
    return llmRUM.trackStreamStart(provider, model);
  }, [provider, model]);

  return { trackMessage };
}

// Type declarations for Datadog RUM global
declare global {
  interface Window {
    DD_RUM?: {
      init(config: Record<string, unknown>): void;
      setUser(user: Record<string, unknown>): void;
      clearUser(): void;
      addAction(name: string, context?: Record<string, unknown>): void;
      addError(error: Error, context?: Record<string, unknown>): void;
      addTiming(name: string, time?: number): void;
      setGlobalContext(context: Record<string, unknown>): void;
      getSessionReplayLink(): string | undefined;
    };
  }
}

export default {
  initializeRUM,
  setRUMUser,
  clearRUMUser,
  addRUMAction,
  addRUMError,
  startRUMTiming,
  llmRUM,
  useDatadogRUM,
  useRUMPageView,
  useRUMChatSession,
};
