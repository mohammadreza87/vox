/**
 * Datadog LLM Observability Module
 *
 * Comprehensive observability solution for LLM applications including:
 * - LLM operation tracing and metrics
 * - Security threat detection
 * - Performance monitoring
 * - Cost tracking
 * - Real-time alerting
 * - Dashboard visualization
 *
 * @example
 * ```typescript
 * import { createLLMSpan, scanInput, getDatadogClient } from '@/lib/datadog';
 *
 * // Create a span for LLM operation
 * const span = createLLMSpan('chat', 'gemini', 'gemini-2.0-flash-001');
 * span.setUser(userId);
 * span.setInput(prompt, systemPrompt);
 *
 * // Scan for security threats
 * const scanResult = await scanInput(prompt, { userId });
 * if (!scanResult.safe) {
 *   span.recordError('Security threat detected');
 *   await span.finish();
 *   throw new Error('Request blocked due to security concerns');
 * }
 *
 * // Perform LLM operation...
 *
 * span.setOutput(response);
 * await span.finish();
 * ```
 */

// Configuration
export {
  getDatadogConfig,
  updateDatadogConfig,
  isDatadogConfigured,
  isLLMObservabilityEnabled,
  getModelPricing,
  LLM_PRICING,
  type DatadogConfig,
} from './config';

// Client
export { getDatadogClient } from './client';

// LLM Tracer
export {
  LLMSpan,
  createLLMSpan,
  traceLLMOperation,
  type LLMSpanAttributes,
  type LLMTrace,
} from './llm-tracer';

// Security
export {
  scanInput,
  scanOutput,
  type SecurityThreat,
  type SecurityScanResult,
  type ThreatSeverity,
} from './security';

// Detection Rules
export {
  LLM_DETECTION_RULES,
  ruleToDatadogMonitor,
  evaluateRule,
  getEnabledRules,
  getRulesBySeverity,
  getRulesByTag,
  type DetectionRule,
} from './detection-rules';

// Dashboard
export {
  LLM_OBSERVABILITY_DASHBOARD,
  getDashboardJSON,
  createDashboard,
  type DashboardDefinition,
  type DashboardWidget,
} from './dashboard';

// Pino Transport
export {
  getDatadogPinoTransport,
  createDatadogWritable,
  logToDatadog,
} from './pino-transport';

// Incident Management
export {
  createIncidentFromTemplate,
  createInvestigationCase,
  createAlert,
  llmIncidents,
  INCIDENT_TEMPLATES,
  type IncidentContext,
  type IncidentDetails,
  type CaseDetails,
  type IncidentSeverity,
  type IncidentState,
  type CasePriority,
  type CaseStatus,
} from './incidents';

// Real User Monitoring (Client-side)
export {
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
} from './rum';

/**
 * Initialize Datadog observability
 * Call this at application startup
 */
export async function initializeDatadog(): Promise<void> {
  const { isDatadogConfigured, getDatadogConfig } = await import('./config');

  if (!isDatadogConfigured()) {
    console.warn('[Datadog] Not configured. Set DD_API_KEY and DD_APP_KEY environment variables.');
    return;
  }

  const config = getDatadogConfig();
  console.log(`[Datadog] Initialized for service: ${config.service}, env: ${config.env}`);

  // Start log transport
  const { getDatadogPinoTransport } = await import('./pino-transport');
  getDatadogPinoTransport();
}

/**
 * Shutdown Datadog observability
 * Call this before application shutdown
 */
export async function shutdownDatadog(): Promise<void> {
  const { getDatadogClient } = await import('./client');
  const { getDatadogPinoTransport } = await import('./pino-transport');

  await getDatadogClient().shutdown();
  await getDatadogPinoTransport().shutdown();

  console.log('[Datadog] Shutdown complete');
}
