/**
 * Datadog Detection Rules for LLM Observability
 *
 * Defines detection rules for:
 * - Performance anomalies
 * - Security threats
 * - Cost overruns
 * - Usage patterns
 * - Availability issues
 *
 * These rules can be imported into Datadog via Terraform or API.
 */

import { getDatadogClient } from './client';
import { isDatadogConfigured } from './config';

export interface DetectionRule {
  id: string;
  name: string;
  description: string;
  type: 'threshold' | 'anomaly' | 'outlier' | 'forecast' | 'composite';
  metric: string;
  condition: {
    operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
    threshold: number;
    timeWindow: string; // e.g., '5m', '15m', '1h'
    aggregation: 'avg' | 'sum' | 'max' | 'min' | 'count' | 'last';
  };
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  action: {
    type: 'incident' | 'case' | 'alert' | 'notification';
    priority: 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
    notifyChannels?: string[]; // e.g., ['slack-alerts', 'pagerduty']
    runbook?: string;
  };
  tags: string[];
  enabled: boolean;
}

/**
 * LLM Observability Detection Rules
 */
export const LLM_DETECTION_RULES: DetectionRule[] = [
  // === Performance Rules ===
  {
    id: 'llm-high-latency',
    name: 'LLM High Latency Alert',
    description: 'LLM response latency exceeds threshold, impacting user experience',
    type: 'threshold',
    metric: 'vox.llm.latency_ms',
    condition: {
      operator: '>',
      threshold: 10000, // 10 seconds
      timeWindow: '5m',
      aggregation: 'avg',
    },
    severity: 'high',
    action: {
      type: 'alert',
      priority: 'P2',
      notifyChannels: ['slack-alerts'],
      runbook: 'https://wiki.example.com/runbooks/llm-high-latency',
    },
    tags: ['llm', 'performance', 'latency'],
    enabled: true,
  },
  {
    id: 'llm-time-to-first-token',
    name: 'Slow Time to First Token',
    description: 'Time to first token exceeds threshold, causing perceived slowness',
    type: 'threshold',
    metric: 'vox.llm.time_to_first_token_ms',
    condition: {
      operator: '>',
      threshold: 3000, // 3 seconds
      timeWindow: '5m',
      aggregation: 'avg',
    },
    severity: 'medium',
    action: {
      type: 'case',
      priority: 'P3',
    },
    tags: ['llm', 'performance', 'streaming'],
    enabled: true,
  },
  {
    id: 'llm-low-throughput',
    name: 'LLM Low Token Throughput',
    description: 'Token generation rate is abnormally low',
    type: 'threshold',
    metric: 'vox.llm.tokens_per_second',
    condition: {
      operator: '<',
      threshold: 10, // 10 tokens/sec
      timeWindow: '10m',
      aggregation: 'avg',
    },
    severity: 'medium',
    action: {
      type: 'case',
      priority: 'P3',
    },
    tags: ['llm', 'performance', 'throughput'],
    enabled: true,
  },

  // === Error Rules ===
  {
    id: 'llm-error-rate-spike',
    name: 'LLM Error Rate Spike',
    description: 'LLM error rate exceeds normal threshold',
    type: 'threshold',
    metric: 'vox.llm.errors',
    condition: {
      operator: '>',
      threshold: 10, // 10 errors
      timeWindow: '5m',
      aggregation: 'sum',
    },
    severity: 'critical',
    action: {
      type: 'incident',
      priority: 'P1',
      notifyChannels: ['slack-incidents', 'pagerduty'],
      runbook: 'https://wiki.example.com/runbooks/llm-errors',
    },
    tags: ['llm', 'errors', 'availability'],
    enabled: true,
  },
  {
    id: 'llm-provider-down',
    name: 'LLM Provider Down',
    description: 'No successful LLM requests in the time window',
    type: 'threshold',
    metric: 'vox.llm.requests',
    condition: {
      operator: '<',
      threshold: 1,
      timeWindow: '5m',
      aggregation: 'sum',
    },
    severity: 'critical',
    action: {
      type: 'incident',
      priority: 'P1',
      notifyChannels: ['slack-incidents', 'pagerduty'],
    },
    tags: ['llm', 'availability'],
    enabled: true,
  },

  // === Cost Rules ===
  {
    id: 'llm-cost-spike',
    name: 'LLM Cost Spike',
    description: 'LLM API costs exceed hourly budget',
    type: 'threshold',
    metric: 'vox.llm.cost_usd',
    condition: {
      operator: '>',
      threshold: 100 * 1000000, // $100 in microcents
      timeWindow: '1h',
      aggregation: 'sum',
    },
    severity: 'high',
    action: {
      type: 'alert',
      priority: 'P2',
      notifyChannels: ['slack-finance'],
    },
    tags: ['llm', 'cost', 'budget'],
    enabled: true,
  },
  {
    id: 'llm-token-abuse',
    name: 'Excessive Token Usage',
    description: 'Single user consuming excessive tokens',
    type: 'threshold',
    metric: 'vox.llm.tokens.total',
    condition: {
      operator: '>',
      threshold: 100000, // 100k tokens
      timeWindow: '1h',
      aggregation: 'sum',
    },
    severity: 'medium',
    action: {
      type: 'case',
      priority: 'P3',
    },
    tags: ['llm', 'abuse', 'tokens'],
    enabled: true,
  },

  // === Security Rules ===
  {
    id: 'security-prompt-injection',
    name: 'Prompt Injection Detected',
    description: 'Potential prompt injection attack detected',
    type: 'threshold',
    metric: 'vox.security.threat.prompt_injection',
    condition: {
      operator: '>',
      threshold: 0,
      timeWindow: '1m',
      aggregation: 'sum',
    },
    severity: 'high',
    action: {
      type: 'incident',
      priority: 'P2',
      notifyChannels: ['slack-security'],
      runbook: 'https://wiki.example.com/runbooks/prompt-injection',
    },
    tags: ['security', 'prompt-injection'],
    enabled: true,
  },
  {
    id: 'security-data-exfiltration',
    name: 'Data Exfiltration Attempt',
    description: 'Potential data exfiltration attempt detected',
    type: 'threshold',
    metric: 'vox.security.threat.data_exfiltration',
    condition: {
      operator: '>',
      threshold: 0,
      timeWindow: '1m',
      aggregation: 'sum',
    },
    severity: 'critical',
    action: {
      type: 'incident',
      priority: 'P1',
      notifyChannels: ['slack-security', 'pagerduty'],
    },
    tags: ['security', 'data-exfiltration'],
    enabled: true,
  },
  {
    id: 'security-pii-exposure',
    name: 'PII Exposure Detected',
    description: 'Potential PII in LLM input/output',
    type: 'threshold',
    metric: 'vox.security.threat.pii_exposure',
    condition: {
      operator: '>',
      threshold: 5,
      timeWindow: '15m',
      aggregation: 'sum',
    },
    severity: 'medium',
    action: {
      type: 'case',
      priority: 'P3',
    },
    tags: ['security', 'pii'],
    enabled: true,
  },

  // === Rate Limiting Rules ===
  {
    id: 'rate-limit-exceeded',
    name: 'Rate Limit Frequently Hit',
    description: 'Users frequently hitting rate limits',
    type: 'threshold',
    metric: 'vox.ratelimit.exceeded',
    condition: {
      operator: '>',
      threshold: 100,
      timeWindow: '15m',
      aggregation: 'sum',
    },
    severity: 'medium',
    action: {
      type: 'case',
      priority: 'P3',
    },
    tags: ['rate-limit', 'capacity'],
    enabled: true,
  },

  // === Model-Specific Rules ===
  {
    id: 'model-gemini-errors',
    name: 'Gemini Model Errors',
    description: 'Gemini-specific errors detected',
    type: 'threshold',
    metric: 'vox.llm.errors{provider:gemini}',
    condition: {
      operator: '>',
      threshold: 5,
      timeWindow: '5m',
      aggregation: 'sum',
    },
    severity: 'high',
    action: {
      type: 'alert',
      priority: 'P2',
    },
    tags: ['llm', 'gemini', 'errors'],
    enabled: true,
  },
  {
    id: 'model-claude-errors',
    name: 'Claude Model Errors',
    description: 'Claude-specific errors detected',
    type: 'threshold',
    metric: 'vox.llm.errors{provider:claude}',
    condition: {
      operator: '>',
      threshold: 5,
      timeWindow: '5m',
      aggregation: 'sum',
    },
    severity: 'high',
    action: {
      type: 'alert',
      priority: 'P2',
    },
    tags: ['llm', 'claude', 'errors'],
    enabled: true,
  },
];

/**
 * Convert detection rule to Datadog Monitor API format
 */
export function ruleToDatadogMonitor(rule: DetectionRule): object {
  const query = buildMonitorQuery(rule);

  return {
    name: `[${rule.severity.toUpperCase()}] ${rule.name}`,
    type: rule.type === 'anomaly' ? 'query alert' : 'query alert',
    query,
    message: buildMonitorMessage(rule),
    tags: rule.tags,
    priority: getPriorityNumber(rule.action.priority),
    options: {
      thresholds: {
        critical: rule.condition.threshold,
      },
      notify_no_data: rule.id.includes('provider-down'),
      no_data_timeframe: 10,
      include_tags: true,
      notify_audit: rule.severity === 'critical',
      renotify_interval: 60,
      escalation_message: rule.severity === 'critical'
        ? `Escalating: ${rule.name} - ${rule.description}`
        : undefined,
    },
  };
}

function buildMonitorQuery(rule: DetectionRule): string {
  const { metric, condition } = rule;
  const { aggregation, timeWindow, operator, threshold } = condition;

  return `${aggregation}(last_${timeWindow}):${metric} ${operator} ${threshold}`;
}

function buildMonitorMessage(rule: DetectionRule): string {
  let message = `## ${rule.name}\n\n`;
  message += `**Severity:** ${rule.severity}\n`;
  message += `**Description:** ${rule.description}\n\n`;

  if (rule.action.runbook) {
    message += `**Runbook:** ${rule.action.runbook}\n\n`;
  }

  message += `### Action Required\n`;

  switch (rule.action.type) {
    case 'incident':
      message += `This alert will create an incident. Immediate investigation required.\n`;
      break;
    case 'case':
      message += `A case will be created for investigation.\n`;
      break;
    case 'alert':
      message += `Review the metrics and take appropriate action.\n`;
      break;
    case 'notification':
      message += `This is an informational notification.\n`;
      break;
  }

  // Add notification targets
  if (rule.action.notifyChannels) {
    message += `\n**Notify:** ${rule.action.notifyChannels.map((c) => `@${c}`).join(' ')}\n`;
  }

  return message;
}

function getPriorityNumber(priority: string): number {
  const priorities: Record<string, number> = {
    P1: 1,
    P2: 2,
    P3: 3,
    P4: 4,
    P5: 5,
  };
  return priorities[priority] || 3;
}

/**
 * Evaluate a detection rule against current metrics
 * Used for real-time rule evaluation
 */
export async function evaluateRule(
  rule: DetectionRule,
  currentValue: number
): Promise<{ triggered: boolean; message: string }> {
  const { condition } = rule;
  let triggered = false;

  switch (condition.operator) {
    case '>':
      triggered = currentValue > condition.threshold;
      break;
    case '<':
      triggered = currentValue < condition.threshold;
      break;
    case '>=':
      triggered = currentValue >= condition.threshold;
      break;
    case '<=':
      triggered = currentValue <= condition.threshold;
      break;
    case '==':
      triggered = currentValue === condition.threshold;
      break;
    case '!=':
      triggered = currentValue !== condition.threshold;
      break;
  }

  if (triggered && isDatadogConfigured()) {
    await executeRuleAction(rule, currentValue);
  }

  return {
    triggered,
    message: triggered
      ? `${rule.name}: Current value ${currentValue} ${condition.operator} threshold ${condition.threshold}`
      : `${rule.name}: OK (current: ${currentValue})`,
  };
}

/**
 * Execute the action defined in a detection rule
 */
async function executeRuleAction(rule: DetectionRule, currentValue: number): Promise<void> {
  const client = getDatadogClient();

  switch (rule.action.type) {
    case 'incident':
      await client.createIncident(
        rule.name,
        rule.action.priority === 'P1' ? 'SEV-1' : rule.action.priority === 'P2' ? 'SEV-2' : 'SEV-3',
        `${rule.description}\n\nCurrent Value: ${currentValue}\nThreshold: ${rule.condition.threshold}`,
        { rule_id: rule.id, current_value: currentValue }
      );
      break;

    case 'case':
      await client.createCase(
        rule.name,
        `${rule.description}\n\nCurrent Value: ${currentValue}\nThreshold: ${rule.condition.threshold}\n\nPlease investigate.`,
        rule.action.priority,
        { rule_id: rule.id, current_value: currentValue }
      );
      break;

    case 'alert':
      await client.triggerAlert(
        rule.id,
        `${rule.name}\n\n${rule.description}\n\nCurrent Value: ${currentValue}`,
        rule.tags
      );
      break;

    case 'notification':
      await client.submitEvent({
        title: rule.name,
        text: `${rule.description}\n\nCurrent Value: ${currentValue}`,
        alert_type: rule.severity === 'critical' || rule.severity === 'high' ? 'error' : 'warning',
        priority: rule.action.priority === 'P1' || rule.action.priority === 'P2' ? 'normal' : 'low',
        tags: rule.tags,
      });
      break;
  }
}

/**
 * Get all enabled detection rules
 */
export function getEnabledRules(): DetectionRule[] {
  return LLM_DETECTION_RULES.filter((rule) => rule.enabled);
}

/**
 * Get rules by severity
 */
export function getRulesBySeverity(severity: DetectionRule['severity']): DetectionRule[] {
  return LLM_DETECTION_RULES.filter((rule) => rule.severity === severity && rule.enabled);
}

/**
 * Get rules by tag
 */
export function getRulesByTag(tag: string): DetectionRule[] {
  return LLM_DETECTION_RULES.filter((rule) => rule.tags.includes(tag) && rule.enabled);
}

export default {
  LLM_DETECTION_RULES,
  ruleToDatadogMonitor,
  evaluateRule,
  getEnabledRules,
  getRulesBySeverity,
  getRulesByTag,
};
