/**
 * Datadog Incident Management Integration
 *
 * Provides actionable incident creation and management for LLM observability:
 * - Automatic incident creation based on detection rules
 * - Incident updates and resolution
 * - Integration with Datadog Case Management
 * - Runbook linking
 * - On-call integration
 */

import { getDatadogClient } from './client';
import { getDatadogConfig, isDatadogConfigured } from './config';

export type IncidentSeverity = 'SEV-1' | 'SEV-2' | 'SEV-3' | 'SEV-4' | 'SEV-5';
export type IncidentState = 'active' | 'stable' | 'resolved';
export type CasePriority = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
export type CaseStatus = 'OPEN' | 'IN_PROGRESS' | 'CLOSED';

export interface IncidentContext {
  // LLM context
  provider?: string;
  model?: string;
  userId?: string;
  requestId?: string;
  traceId?: string;

  // Metrics context
  latencyMs?: number;
  errorRate?: number;
  tokenUsage?: number;
  costUsd?: number;

  // Security context
  threatType?: string;
  threatSeverity?: string;
  riskScore?: number;

  // Additional context
  [key: string]: unknown;
}

export interface IncidentDetails {
  id: string;
  title: string;
  severity: IncidentSeverity;
  state: IncidentState;
  createdAt: Date;
  updatedAt: Date;
  description: string;
  context: IncidentContext;
  runbookUrl?: string;
  dashboardUrl?: string;
}

export interface CaseDetails {
  id: string;
  title: string;
  priority: CasePriority;
  status: CaseStatus;
  description: string;
  context: IncidentContext;
  assignee?: string;
}

/**
 * Predefined incident templates for common LLM issues
 */
export const INCIDENT_TEMPLATES = {
  LLM_HIGH_LATENCY: {
    title: 'LLM High Latency Detected',
    severity: 'SEV-3' as IncidentSeverity,
    description: 'LLM response times are exceeding acceptable thresholds, impacting user experience.',
    runbookUrl: 'https://wiki.example.com/runbooks/llm-high-latency',
  },
  LLM_ERROR_SPIKE: {
    title: 'LLM Error Rate Spike',
    severity: 'SEV-2' as IncidentSeverity,
    description: 'A significant increase in LLM errors has been detected, potentially affecting service availability.',
    runbookUrl: 'https://wiki.example.com/runbooks/llm-errors',
  },
  LLM_PROVIDER_DOWN: {
    title: 'LLM Provider Unavailable',
    severity: 'SEV-1' as IncidentSeverity,
    description: 'An LLM provider is not responding, causing service degradation.',
    runbookUrl: 'https://wiki.example.com/runbooks/llm-provider-down',
  },
  SECURITY_PROMPT_INJECTION: {
    title: 'Prompt Injection Attack Detected',
    severity: 'SEV-2' as IncidentSeverity,
    description: 'A potential prompt injection attack has been detected. Immediate investigation required.',
    runbookUrl: 'https://wiki.example.com/runbooks/prompt-injection',
  },
  SECURITY_DATA_EXFILTRATION: {
    title: 'Data Exfiltration Attempt',
    severity: 'SEV-1' as IncidentSeverity,
    description: 'A potential data exfiltration attempt has been detected. This is a critical security incident.',
    runbookUrl: 'https://wiki.example.com/runbooks/data-exfiltration',
  },
  COST_OVERRUN: {
    title: 'LLM Cost Budget Exceeded',
    severity: 'SEV-3' as IncidentSeverity,
    description: 'LLM API costs have exceeded the allocated budget for this period.',
    runbookUrl: 'https://wiki.example.com/runbooks/cost-management',
  },
  RATE_LIMIT_EXHAUSTION: {
    title: 'Rate Limit Approaching Exhaustion',
    severity: 'SEV-3' as IncidentSeverity,
    description: 'API rate limits are being approached or exceeded, risking service interruption.',
    runbookUrl: 'https://wiki.example.com/runbooks/rate-limits',
  },
} as const;

/**
 * Create an incident from a template
 */
export async function createIncidentFromTemplate(
  templateKey: keyof typeof INCIDENT_TEMPLATES,
  context: IncidentContext,
  customizations?: Partial<typeof INCIDENT_TEMPLATES[typeof templateKey]>
): Promise<string | null> {
  if (!isDatadogConfigured()) return null;

  const template = INCIDENT_TEMPLATES[templateKey];
  const client = getDatadogClient();
  const config = getDatadogConfig();

  const title = customizations?.title || template.title;
  const severity = customizations?.severity || template.severity;
  const description = buildIncidentDescription(
    customizations?.description || template.description,
    context,
    template.runbookUrl
  );

  return client.createIncident(title, severity, description, {
    template: templateKey,
    environment: config.env,
    service: config.service,
    ...context,
  });
}

/**
 * Build a detailed incident description
 */
function buildIncidentDescription(
  baseDescription: string,
  context: IncidentContext,
  runbookUrl?: string
): string {
  let description = `## Incident Summary\n\n${baseDescription}\n\n`;

  // Add context details
  description += '## Context\n\n';

  if (context.provider) {
    description += `- **LLM Provider:** ${context.provider}\n`;
  }
  if (context.model) {
    description += `- **Model:** ${context.model}\n`;
  }
  if (context.userId) {
    description += `- **Affected User:** ${context.userId}\n`;
  }
  if (context.requestId) {
    description += `- **Request ID:** ${context.requestId}\n`;
  }
  if (context.traceId) {
    description += `- **Trace ID:** ${context.traceId}\n`;
  }

  // Add metrics if available
  if (context.latencyMs || context.errorRate || context.tokenUsage || context.costUsd) {
    description += '\n## Metrics\n\n';
    if (context.latencyMs) {
      description += `- **Latency:** ${context.latencyMs}ms\n`;
    }
    if (context.errorRate) {
      description += `- **Error Rate:** ${(context.errorRate * 100).toFixed(2)}%\n`;
    }
    if (context.tokenUsage) {
      description += `- **Token Usage:** ${context.tokenUsage}\n`;
    }
    if (context.costUsd) {
      description += `- **Cost:** $${context.costUsd.toFixed(4)}\n`;
    }
  }

  // Add security context if available
  if (context.threatType || context.riskScore) {
    description += '\n## Security Details\n\n';
    if (context.threatType) {
      description += `- **Threat Type:** ${context.threatType}\n`;
    }
    if (context.threatSeverity) {
      description += `- **Threat Severity:** ${context.threatSeverity}\n`;
    }
    if (context.riskScore) {
      description += `- **Risk Score:** ${context.riskScore}/100\n`;
    }
  }

  // Add action items
  description += '\n## Required Actions\n\n';
  description += '1. Investigate the root cause using the linked traces and logs\n';
  description += '2. Assess the impact on users and services\n';
  description += '3. Implement mitigation measures\n';
  description += '4. Update this incident with findings\n';

  // Add runbook link
  if (runbookUrl) {
    description += `\n## Runbook\n\n[View Runbook](${runbookUrl})\n`;
  }

  return description;
}

/**
 * Create a case for investigation
 */
export async function createInvestigationCase(
  title: string,
  description: string,
  priority: CasePriority,
  context: IncidentContext
): Promise<string | null> {
  if (!isDatadogConfigured()) return null;

  const client = getDatadogClient();
  const config = getDatadogConfig();

  const fullDescription = `${description}\n\n## Investigation Context\n\n${JSON.stringify(context, null, 2)}`;

  return client.createCase(title, fullDescription, priority, {
    environment: config.env,
    service: config.service,
    ...context,
  });
}

/**
 * Create an alert for immediate attention
 */
export async function createAlert(
  title: string,
  message: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  context: IncidentContext
): Promise<void> {
  if (!isDatadogConfigured()) return;

  const client = getDatadogClient();

  await client.submitEvent({
    title,
    text: `${message}\n\n**Context:**\n${JSON.stringify(context, null, 2)}`,
    alert_type: severity === 'critical' || severity === 'high' ? 'error' : 'warning',
    priority: severity === 'critical' || severity === 'high' ? 'normal' : 'low',
    tags: [
      `severity:${severity}`,
      ...(context.provider ? [`provider:${context.provider}`] : []),
      ...(context.model ? [`model:${context.model}`] : []),
    ],
  });
}

/**
 * LLM-specific incident helpers
 */
export const llmIncidents = {
  /**
   * Report high latency incident
   */
  async reportHighLatency(
    provider: string,
    model: string,
    latencyMs: number,
    threshold: number,
    context?: Partial<IncidentContext>
  ): Promise<string | null> {
    return createIncidentFromTemplate('LLM_HIGH_LATENCY', {
      provider,
      model,
      latencyMs,
      ...context,
    }, {
      description: `LLM response latency (${latencyMs}ms) exceeded threshold (${threshold}ms) for ${provider}/${model}` as const,
    } as any);
  },

  /**
   * Report error spike incident
   */
  async reportErrorSpike(
    provider: string,
    model: string,
    errorRate: number,
    errorCount: number,
    context?: Partial<IncidentContext>
  ): Promise<string | null> {
    const severity: IncidentSeverity = errorRate > 0.5 ? 'SEV-1' : errorRate > 0.2 ? 'SEV-2' : 'SEV-3';

    return createIncidentFromTemplate('LLM_ERROR_SPIKE', {
      provider,
      model,
      errorRate,
      ...context,
    }, {
      severity,
      description: `Error rate for ${provider}/${model} is ${(errorRate * 100).toFixed(1)}% (${errorCount} errors)`,
    } as any);
  },

  /**
   * Report provider down incident
   */
  async reportProviderDown(
    provider: string,
    lastSuccessTime: Date,
    context?: Partial<IncidentContext>
  ): Promise<string | null> {
    const downDuration = Date.now() - lastSuccessTime.getTime();
    const downMinutes = Math.floor(downDuration / 60000);

    return createIncidentFromTemplate('LLM_PROVIDER_DOWN', {
      provider,
      ...context,
    }, {
      description: `${provider} has been unresponsive for ${downMinutes} minutes. Last successful request at ${lastSuccessTime.toISOString()}`,
    } as any);
  },

  /**
   * Report security incident
   */
  async reportSecurityIncident(
    threatType: string,
    threatSeverity: string,
    riskScore: number,
    context?: Partial<IncidentContext>
  ): Promise<string | null> {
    const templateKey = threatType === 'data_exfiltration'
      ? 'SECURITY_DATA_EXFILTRATION'
      : 'SECURITY_PROMPT_INJECTION';

    return createIncidentFromTemplate(templateKey, {
      threatType,
      threatSeverity,
      riskScore,
      ...context,
    });
  },

  /**
   * Report cost overrun
   */
  async reportCostOverrun(
    currentCost: number,
    budget: number,
    period: string,
    context?: Partial<IncidentContext>
  ): Promise<string | null> {
    const overrunPercent = ((currentCost - budget) / budget * 100).toFixed(1);

    return createIncidentFromTemplate('COST_OVERRUN', {
      costUsd: currentCost,
      ...context,
    }, {
      description: `LLM costs ($${currentCost.toFixed(2)}) exceeded budget ($${budget.toFixed(2)}) by ${overrunPercent}% for ${period}`,
    } as any);
  },

  /**
   * Create investigation case for anomaly
   */
  async createAnomalyCase(
    anomalyType: string,
    details: string,
    context: IncidentContext
  ): Promise<string | null> {
    return createInvestigationCase(
      `LLM Anomaly Investigation: ${anomalyType}`,
      `An anomaly has been detected that requires investigation.\n\n**Type:** ${anomalyType}\n\n**Details:** ${details}`,
      'P3',
      context
    );
  },
};

export default {
  createIncidentFromTemplate,
  createInvestigationCase,
  createAlert,
  llmIncidents,
  INCIDENT_TEMPLATES,
};
