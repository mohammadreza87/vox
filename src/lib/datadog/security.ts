/**
 * LLM Security Detection for Datadog
 *
 * Detects and reports security threats including:
 * - Prompt injection attacks
 * - Jailbreak attempts
 * - Data exfiltration patterns
 * - Anomalous usage patterns
 * - PII exposure
 */

import { getDatadogClient } from './client';
import { getDatadogConfig, isDatadogConfigured } from './config';

export type ThreatSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface SecurityThreat {
  type: string;
  severity: ThreatSeverity;
  description: string;
  indicators: string[];
  confidence: number; // 0-1
  metadata?: Record<string, unknown>;
}

export interface SecurityScanResult {
  safe: boolean;
  threats: SecurityThreat[];
  riskScore: number; // 0-100
  scanDurationMs: number;
}

// Prompt injection patterns
const PROMPT_INJECTION_PATTERNS = [
  // Direct instruction overrides
  /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/i,
  /forget\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/i,

  // Role-play manipulation
  /you\s+are\s+now\s+(a|an|the)\s+/i,
  /pretend\s+(you're|you\s+are|to\s+be)\s+/i,
  /act\s+as\s+(if\s+)?(you're|you\s+are|a|an)\s+/i,
  /roleplay\s+as\s+/i,
  /from\s+now\s+on[\s,]+you\s+(are|will)/i,

  // System prompt extraction
  /what\s+(is|are)\s+(your|the)\s+(system\s+)?prompt/i,
  /show\s+(me\s+)?(your|the)\s+(system\s+)?prompt/i,
  /reveal\s+(your|the)\s+(system\s+)?prompt/i,
  /repeat\s+(your|the)\s+(system\s+)?(instructions?|prompt)/i,
  /print\s+(your|the)\s+(system\s+)?prompt/i,

  // Jailbreak patterns
  /DAN\s+mode/i,
  /do\s+anything\s+now/i,
  /enable\s+(developer|god|admin)\s+mode/i,
  /jailbreak/i,
  /bypass\s+(safety|content|ethical)\s+(filters?|restrictions?)/i,

  // Code injection attempts
  /\{\{.*\}\}/,  // Template injection
  /\$\{.*\}/,    // JS template literals
  /<script\b/i,   // Script injection
  /javascript:/i, // URL javascript

  // Delimiter attacks
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /<<SYS>>/i,
  /<\|im_start\|>/i,
  /###\s*(System|Instruction|Assistant)/i,
];

// Data exfiltration patterns
const DATA_EXFILTRATION_PATTERNS = [
  // API key requests
  /give\s+me\s+(the\s+)?(api|secret)\s+key/i,
  /share\s+(your|the)\s+(api|secret)\s+key/i,
  /what\s+is\s+(your|the)\s+(api|secret)\s+key/i,

  // Database/credential access
  /database\s+(password|credentials?)/i,
  /admin\s+(password|credentials?)/i,
  /root\s+(password|credentials?)/i,

  // Internal information
  /internal\s+(documentation|wiki|confluence)/i,
  /show\s+(me\s+)?internal\s+/i,

  // Environment variables
  /process\.env/i,
  /environment\s+variables?/i,
  /\.env\s+file/i,
];

// PII patterns
const PII_PATTERNS = [
  // SSN
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b\d{9}\b/,

  // Credit card
  /\b(?:\d{4}[-\s]?){3}\d{4}\b/,
  /\b\d{16}\b/,

  // Email (for detection purposes)
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,

  // Phone numbers
  /\b\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,

  // IP addresses
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
];

/**
 * Scan text for prompt injection attempts
 */
function scanForPromptInjection(text: string): SecurityThreat[] {
  const threats: SecurityThreat[] = [];
  const normalizedText = text.toLowerCase();

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      threats.push({
        type: 'prompt_injection',
        severity: 'high',
        description: 'Potential prompt injection attempt detected',
        indicators: [match[0]],
        confidence: 0.85,
        metadata: {
          pattern: pattern.toString(),
          matchedText: match[0],
        },
      });
    }
  }

  // Check for excessive special characters (delimiter attacks)
  const specialCharRatio = (text.match(/[<>\[\]{}|`#]/g) || []).length / text.length;
  if (specialCharRatio > 0.1 && text.length > 50) {
    threats.push({
      type: 'prompt_injection',
      severity: 'medium',
      description: 'Unusual concentration of special characters detected',
      indicators: ['High special character ratio'],
      confidence: 0.6,
      metadata: { specialCharRatio },
    });
  }

  return threats;
}

/**
 * Scan text for data exfiltration attempts
 */
function scanForDataExfiltration(text: string): SecurityThreat[] {
  const threats: SecurityThreat[] = [];

  for (const pattern of DATA_EXFILTRATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      threats.push({
        type: 'data_exfiltration',
        severity: 'high',
        description: 'Potential data exfiltration attempt detected',
        indicators: [match[0]],
        confidence: 0.8,
        metadata: {
          pattern: pattern.toString(),
          matchedText: match[0],
        },
      });
    }
  }

  return threats;
}

/**
 * Scan text for PII
 */
function scanForPII(text: string): SecurityThreat[] {
  const threats: SecurityThreat[] = [];
  const piiTypes: string[] = [];

  const piiLabels = ['ssn', 'credit_card', 'email', 'phone', 'ip_address'];

  PII_PATTERNS.forEach((pattern, index) => {
    if (pattern.test(text)) {
      piiTypes.push(piiLabels[index] || 'unknown');
    }
  });

  if (piiTypes.length > 0) {
    threats.push({
      type: 'pii_exposure',
      severity: 'medium',
      description: 'Potential PII detected in content',
      indicators: piiTypes,
      confidence: 0.7,
      metadata: { piiTypes },
    });
  }

  return threats;
}

/**
 * Scan for anomalous patterns
 */
function scanForAnomalies(
  text: string,
  context?: { avgPromptLength?: number; avgResponseTime?: number }
): SecurityThreat[] {
  const threats: SecurityThreat[] = [];

  // Extremely long input (potential DoS)
  if (text.length > 50000) {
    threats.push({
      type: 'anomaly',
      severity: 'medium',
      description: 'Unusually long input detected',
      indicators: [`Input length: ${text.length} characters`],
      confidence: 0.7,
      metadata: { inputLength: text.length },
    });
  }

  // Repeated content (potential token stuffing)
  const words = text.toLowerCase().split(/\s+/);
  const wordFreq = new Map<string, number>();
  for (const word of words) {
    if (word.length > 3) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }
  }

  const maxRepetition = Math.max(...wordFreq.values(), 0);
  if (maxRepetition > 50 && words.length > 100) {
    threats.push({
      type: 'anomaly',
      severity: 'low',
      description: 'High word repetition detected (possible token stuffing)',
      indicators: [`Max word repetition: ${maxRepetition}`],
      confidence: 0.5,
      metadata: { maxRepetition, totalWords: words.length },
    });
  }

  // Base64 encoded content (potential encoded attack)
  const base64Pattern = /[A-Za-z0-9+/]{50,}={0,2}/;
  if (base64Pattern.test(text)) {
    threats.push({
      type: 'anomaly',
      severity: 'low',
      description: 'Base64 encoded content detected',
      indicators: ['Large base64 string found'],
      confidence: 0.4,
    });
  }

  return threats;
}

/**
 * Calculate overall risk score based on threats
 */
function calculateRiskScore(threats: SecurityThreat[]): number {
  if (threats.length === 0) return 0;

  const severityScores: Record<ThreatSeverity, number> = {
    low: 10,
    medium: 30,
    high: 60,
    critical: 100,
  };

  let totalScore = 0;
  for (const threat of threats) {
    totalScore += severityScores[threat.severity] * threat.confidence;
  }

  return Math.min(100, totalScore);
}

/**
 * Perform comprehensive security scan on input text
 */
export async function scanInput(
  text: string,
  options?: {
    userId?: string;
    requestId?: string;
    context?: { avgPromptLength?: number; avgResponseTime?: number };
  }
): Promise<SecurityScanResult> {
  const startTime = Date.now();

  const threats: SecurityThreat[] = [
    ...scanForPromptInjection(text),
    ...scanForDataExfiltration(text),
    ...scanForPII(text),
    ...scanForAnomalies(text, options?.context),
  ];

  const riskScore = calculateRiskScore(threats);
  const scanDurationMs = Date.now() - startTime;

  const result: SecurityScanResult = {
    safe: threats.filter((t) => t.severity === 'high' || t.severity === 'critical').length === 0,
    threats,
    riskScore,
    scanDurationMs,
  };

  // Report to Datadog if threats detected
  if (threats.length > 0 && isDatadogConfigured()) {
    await reportSecurityThreats(threats, options);
  }

  return result;
}

/**
 * Perform security scan on LLM output
 */
export async function scanOutput(
  text: string,
  options?: {
    userId?: string;
    requestId?: string;
  }
): Promise<SecurityScanResult> {
  const startTime = Date.now();

  // Focus on PII and data leakage in outputs
  const threats: SecurityThreat[] = [
    ...scanForPII(text),
  ];

  // Check for potential leaked system prompt
  const systemPromptLeakPatterns = [
    /you\s+are\s+an?\s+AI\s+assistant/i,
    /your\s+instructions\s+are/i,
    /I\s+was\s+instructed\s+to/i,
    /my\s+system\s+prompt\s+(says|is)/i,
  ];

  for (const pattern of systemPromptLeakPatterns) {
    if (pattern.test(text)) {
      threats.push({
        type: 'system_prompt_leak',
        severity: 'high',
        description: 'Potential system prompt leak detected in output',
        indicators: ['Pattern matched in response'],
        confidence: 0.6,
      });
      break;
    }
  }

  const riskScore = calculateRiskScore(threats);
  const scanDurationMs = Date.now() - startTime;

  const result: SecurityScanResult = {
    safe: threats.filter((t) => t.severity === 'high' || t.severity === 'critical').length === 0,
    threats,
    riskScore,
    scanDurationMs,
  };

  if (threats.length > 0 && isDatadogConfigured()) {
    await reportSecurityThreats(threats, options);
  }

  return result;
}

/**
 * Report security threats to Datadog
 */
async function reportSecurityThreats(
  threats: SecurityThreat[],
  context?: { userId?: string; requestId?: string }
): Promise<void> {
  const client = getDatadogClient();
  const config = getDatadogConfig();

  for (const threat of threats) {
    // Submit security metric
    await client.submitMetric(
      `security.threat.${threat.type}`,
      1,
      'count',
      [
        `severity:${threat.severity}`,
        `confidence:${Math.round(threat.confidence * 100)}`,
        ...(context?.userId ? [`user_id:${context.userId}`] : []),
      ]
    );

    // Submit security log
    await client.submitLog(
      `Security threat detected: ${threat.type}`,
      threat.severity === 'critical' || threat.severity === 'high' ? 'error' : 'warn',
      {
        security: {
          threat_type: threat.type,
          severity: threat.severity,
          description: threat.description,
          indicators: threat.indicators,
          confidence: threat.confidence,
          metadata: threat.metadata,
        },
        user_id: context?.userId,
        request_id: context?.requestId,
      }
    );

    // Create incident for critical threats
    if (threat.severity === 'critical') {
      await client.createIncident(
        `Critical Security Threat: ${threat.type}`,
        'SEV-2',
        `A critical security threat was detected.\n\nType: ${threat.type}\nDescription: ${threat.description}\nIndicators: ${threat.indicators.join(', ')}`,
        {
          user_id: context?.userId,
          request_id: context?.requestId,
          threat_details: threat.metadata,
        }
      );
    }

    // Create case for high severity threats
    if (threat.severity === 'high') {
      await client.createCase(
        `Security Investigation: ${threat.type}`,
        `High severity security threat detected.\n\nType: ${threat.type}\nDescription: ${threat.description}\nIndicators: ${threat.indicators.join(', ')}\n\nPlease investigate and take appropriate action.`,
        'P2',
        {
          user_id: context?.userId,
          request_id: context?.requestId,
        }
      );
    }
  }

  // Submit overall security event
  await client.submitEvent({
    title: 'Security Threats Detected',
    text: `${threats.length} security threat(s) detected.\n\nSeverities: ${threats.map((t) => t.severity).join(', ')}\nTypes: ${[...new Set(threats.map((t) => t.type))].join(', ')}`,
    alert_type: threats.some((t) => t.severity === 'critical' || t.severity === 'high') ? 'error' : 'warning',
    priority: 'normal',
    tags: [
      `threat_count:${threats.length}`,
      ...(context?.userId ? [`user_id:${context.userId}`] : []),
    ],
    aggregation_key: 'security_threats',
  });
}

export default {
  scanInput,
  scanOutput,
  calculateRiskScore,
};
