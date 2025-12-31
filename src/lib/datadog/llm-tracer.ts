/**
 * LLM Observability Tracer for Datadog
 *
 * Provides comprehensive tracing for LLM operations including:
 * - Request/response tracking
 * - Token usage measurement
 * - Latency tracking
 * - Error capture
 * - Cost estimation
 */

import { getDatadogClient } from './client';
import { getDatadogConfig, getModelPricing, isLLMObservabilityEnabled } from './config';
import { randomUUID } from 'crypto';

const uuidv4 = randomUUID;

export interface LLMSpanAttributes {
  // Request metadata
  requestId: string;
  userId?: string;
  sessionId?: string;

  // Model info
  provider: 'gemini' | 'claude' | 'openai' | 'deepseek';
  model: string;

  // Input/Output
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;

  // Performance
  latencyMs?: number;
  timeToFirstToken?: number;
  tokensPerSecond?: number;

  // Cost
  estimatedCostUsd?: number;

  // Status
  status: 'started' | 'streaming' | 'completed' | 'error';
  errorType?: string;
  errorMessage?: string;

  // Security
  promptLength?: number;
  responseLength?: number;
  containsSensitiveData?: boolean;

  // Additional context
  conversationTurn?: number;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMTrace {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  startTime: number;
  endTime?: number;
  attributes: LLMSpanAttributes;
  events: Array<{
    name: string;
    timestamp: number;
    attributes?: Record<string, unknown>;
  }>;
}

/**
 * Generate a unique ID (UUID v4 compatible)
 */
function generateId(): string {
  // Use crypto.randomUUID if available, otherwise fallback
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * LLM Span class for tracking individual LLM operations
 */
export class LLMSpan {
  private trace: LLMTrace;
  private client = getDatadogClient();
  private streamedTokens: number = 0;
  private firstTokenTime: number | null = null;

  constructor(
    operationName: string,
    attributes: Partial<LLMSpanAttributes> & {
      provider: LLMSpanAttributes['provider'];
      model: string;
    }
  ) {
    this.trace = {
      traceId: generateId(),
      spanId: generateId(),
      operationName,
      startTime: Date.now(),
      attributes: {
        requestId: generateId(),
        status: 'started',
        ...attributes,
      },
      events: [],
    };

    this.addEvent('span_started', { provider: attributes.provider, model: attributes.model });
  }

  /**
   * Get the trace ID
   */
  getTraceId(): string {
    return this.trace.traceId;
  }

  /**
   * Get the span ID
   */
  getSpanId(): string {
    return this.trace.spanId;
  }

  /**
   * Add an event to the span
   */
  addEvent(name: string, attributes?: Record<string, unknown>): void {
    this.trace.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
  }

  /**
   * Record a streamed token
   */
  recordStreamedToken(tokenCount: number = 1): void {
    if (this.firstTokenTime === null) {
      this.firstTokenTime = Date.now();
      this.trace.attributes.timeToFirstToken = this.firstTokenTime - this.trace.startTime;
      this.addEvent('first_token_received', {
        timeToFirstTokenMs: this.trace.attributes.timeToFirstToken,
      });
    }

    this.streamedTokens += tokenCount;
    this.trace.attributes.status = 'streaming';
  }

  /**
   * Set token usage
   */
  setTokenUsage(promptTokens: number, completionTokens: number): void {
    this.trace.attributes.promptTokens = promptTokens;
    this.trace.attributes.completionTokens = completionTokens;
    this.trace.attributes.totalTokens = promptTokens + completionTokens;

    // Calculate cost
    const pricing = getModelPricing(this.trace.attributes.model);
    this.trace.attributes.estimatedCostUsd =
      (promptTokens / 1_000_000) * pricing.input +
      (completionTokens / 1_000_000) * pricing.output;
  }

  /**
   * Estimate tokens from text (rough approximation: 4 chars per token)
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Set input text and estimate tokens
   */
  setInput(prompt: string, systemPrompt?: string): void {
    const promptLength = prompt.length + (systemPrompt?.length || 0);
    this.trace.attributes.promptLength = promptLength;
    this.trace.attributes.promptTokens = this.estimateTokens(prompt + (systemPrompt || ''));
  }

  /**
   * Set output text and estimate tokens
   */
  setOutput(response: string): void {
    this.trace.attributes.responseLength = response.length;
    this.trace.attributes.completionTokens = this.estimateTokens(response);
    this.trace.attributes.totalTokens =
      (this.trace.attributes.promptTokens || 0) + this.trace.attributes.completionTokens;

    // Calculate cost
    const pricing = getModelPricing(this.trace.attributes.model);
    this.trace.attributes.estimatedCostUsd =
      ((this.trace.attributes.promptTokens || 0) / 1_000_000) * pricing.input +
      (this.trace.attributes.completionTokens / 1_000_000) * pricing.output;
  }

  /**
   * Set user context
   */
  setUser(userId: string, sessionId?: string): void {
    this.trace.attributes.userId = userId;
    if (sessionId) {
      this.trace.attributes.sessionId = sessionId;
    }
  }

  /**
   * Record an error
   */
  recordError(error: Error | string): void {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorType = error instanceof Error ? error.name : 'Error';

    this.trace.attributes.status = 'error';
    this.trace.attributes.errorType = errorType;
    this.trace.attributes.errorMessage = errorMessage;

    this.addEvent('error', {
      type: errorType,
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  /**
   * Finish the span and send to Datadog
   */
  async finish(): Promise<void> {
    if (!isLLMObservabilityEnabled()) return;

    this.trace.endTime = Date.now();
    this.trace.attributes.latencyMs = this.trace.endTime - this.trace.startTime;

    // Calculate tokens per second if we have completion tokens
    if (this.trace.attributes.completionTokens && this.trace.attributes.latencyMs > 0) {
      this.trace.attributes.tokensPerSecond =
        (this.trace.attributes.completionTokens / this.trace.attributes.latencyMs) * 1000;
    }

    if (this.trace.attributes.status === 'streaming' || this.trace.attributes.status === 'started') {
      this.trace.attributes.status = 'completed';
    }

    this.addEvent('span_finished', {
      totalLatencyMs: this.trace.attributes.latencyMs,
      totalTokens: this.trace.attributes.totalTokens,
      status: this.trace.attributes.status,
    });

    // Submit metrics
    await this.submitMetrics();

    // Submit trace as log for analysis
    await this.submitTraceLog();
  }

  private async submitMetrics(): Promise<void> {
    const { provider, model, status, latencyMs, totalTokens, estimatedCostUsd, timeToFirstToken, tokensPerSecond } =
      this.trace.attributes;

    const tags = [
      `provider:${provider}`,
      `model:${model}`,
      `status:${status}`,
    ];

    const metrics: Array<{ name: string; value: number; type?: 'gauge' | 'count' | 'rate'; tags?: string[] }> = [];

    // Request count
    metrics.push({ name: 'llm.requests', value: 1, type: 'count', tags });

    // Latency
    if (latencyMs) {
      metrics.push({ name: 'llm.latency_ms', value: latencyMs, type: 'gauge', tags });
    }

    // Time to first token
    if (timeToFirstToken) {
      metrics.push({ name: 'llm.time_to_first_token_ms', value: timeToFirstToken, type: 'gauge', tags });
    }

    // Token usage
    if (totalTokens) {
      metrics.push({ name: 'llm.tokens.total', value: totalTokens, type: 'count', tags });
    }
    if (this.trace.attributes.promptTokens) {
      metrics.push({ name: 'llm.tokens.prompt', value: this.trace.attributes.promptTokens, type: 'count', tags });
    }
    if (this.trace.attributes.completionTokens) {
      metrics.push({ name: 'llm.tokens.completion', value: this.trace.attributes.completionTokens, type: 'count', tags });
    }

    // Tokens per second (throughput)
    if (tokensPerSecond) {
      metrics.push({ name: 'llm.tokens_per_second', value: tokensPerSecond, type: 'gauge', tags });
    }

    // Cost
    if (estimatedCostUsd) {
      metrics.push({ name: 'llm.cost_usd', value: estimatedCostUsd * 1000000, type: 'count', tags }); // Store as micro-cents for precision
    }

    // Error tracking
    if (status === 'error') {
      metrics.push({ name: 'llm.errors', value: 1, type: 'count', tags: [...tags, `error_type:${this.trace.attributes.errorType}`] });
    }

    await this.client.submitMetrics(metrics);
  }

  private async submitTraceLog(): Promise<void> {
    await this.client.submitLog(
      `LLM ${this.trace.operationName} - ${this.trace.attributes.model}`,
      this.trace.attributes.status === 'error' ? 'error' : 'info',
      {
        trace_id: this.trace.traceId,
        span_id: this.trace.spanId,
        operation: this.trace.operationName,
        llm: {
          provider: this.trace.attributes.provider,
          model: this.trace.attributes.model,
          prompt_tokens: this.trace.attributes.promptTokens,
          completion_tokens: this.trace.attributes.completionTokens,
          total_tokens: this.trace.attributes.totalTokens,
          latency_ms: this.trace.attributes.latencyMs,
          time_to_first_token_ms: this.trace.attributes.timeToFirstToken,
          tokens_per_second: this.trace.attributes.tokensPerSecond,
          estimated_cost_usd: this.trace.attributes.estimatedCostUsd,
        },
        user: {
          id: this.trace.attributes.userId,
          session_id: this.trace.attributes.sessionId,
        },
        error: this.trace.attributes.status === 'error' ? {
          type: this.trace.attributes.errorType,
          message: this.trace.attributes.errorMessage,
        } : undefined,
        events: this.trace.events,
      }
    );
  }
}

/**
 * Create a new LLM span for tracking
 */
export function createLLMSpan(
  operationName: string,
  provider: LLMSpanAttributes['provider'],
  model: string,
  options?: Partial<LLMSpanAttributes>
): LLMSpan {
  return new LLMSpan(operationName, { provider, model, ...options });
}

/**
 * Wrap an async LLM operation with tracing
 */
export async function traceLLMOperation<T>(
  operationName: string,
  provider: LLMSpanAttributes['provider'],
  model: string,
  operation: (span: LLMSpan) => Promise<T>,
  options?: Partial<LLMSpanAttributes>
): Promise<T> {
  const span = createLLMSpan(operationName, provider, model, options);

  try {
    const result = await operation(span);
    await span.finish();
    return result;
  } catch (error) {
    span.recordError(error instanceof Error ? error : new Error(String(error)));
    await span.finish();
    throw error;
  }
}

export default { createLLMSpan, traceLLMOperation, LLMSpan };
