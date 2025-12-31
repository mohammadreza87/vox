/**
 * Datadog Client for Server-Side Integration
 *
 * Provides metrics submission, log forwarding, and incident management
 * via Datadog HTTP API.
 */

import { getDatadogConfig, isDatadogConfigured } from './config';

interface MetricPoint {
  timestamp: number;
  value: number;
}

interface MetricSeries {
  metric: string;
  type: 'gauge' | 'count' | 'rate';
  points: MetricPoint[];
  tags?: string[];
  host?: string;
  unit?: string;
}

interface LogEntry {
  ddsource: string;
  ddtags: string;
  hostname: string;
  message: string;
  service: string;
  status: 'debug' | 'info' | 'warn' | 'error';
  [key: string]: unknown;
}

interface Event {
  title: string;
  text: string;
  alert_type?: 'error' | 'warning' | 'info' | 'success';
  priority?: 'normal' | 'low';
  tags?: string[];
  aggregation_key?: string;
  source_type_name?: string;
}

/**
 * Datadog API client for server-side operations
 */
class DatadogClient {
  private metricsBuffer: MetricSeries[] = [];
  private logsBuffer: LogEntry[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private readonly BATCH_SIZE = 50;
  private readonly FLUSH_INTERVAL_MS = 10000; // 10 seconds

  constructor() {
    // Start flush interval in production
    if (typeof window === 'undefined' && process.env.NODE_ENV === 'production') {
      this.startFlushInterval();
    }
  }

  private startFlushInterval(): void {
    if (this.flushInterval) return;
    this.flushInterval = setInterval(() => {
      this.flush().catch(console.error);
    }, this.FLUSH_INTERVAL_MS);
  }

  private getBaseUrl(): string {
    const config = getDatadogConfig();
    return `https://api.${config.site}`;
  }

  private getHeaders(): Record<string, string> {
    const config = getDatadogConfig();
    return {
      'Content-Type': 'application/json',
      'DD-API-KEY': config.apiKey,
      'DD-APPLICATION-KEY': config.appKey,
    };
  }

  /**
   * Submit a metric to Datadog
   */
  async submitMetric(
    name: string,
    value: number,
    type: 'gauge' | 'count' | 'rate' = 'gauge',
    tags: string[] = []
  ): Promise<void> {
    if (!isDatadogConfigured()) return;

    const config = getDatadogConfig();
    const series: MetricSeries = {
      metric: `vox.${name}`,
      type,
      points: [{ timestamp: Math.floor(Date.now() / 1000), value }],
      tags: [`env:${config.env}`, `service:${config.service}`, ...tags],
      host: 'vox-server',
    };

    this.metricsBuffer.push(series);

    // Flush if buffer is full
    if (this.metricsBuffer.length >= this.BATCH_SIZE) {
      await this.flushMetrics();
    }
  }

  /**
   * Submit multiple metrics at once
   */
  async submitMetrics(metrics: Array<{ name: string; value: number; type?: 'gauge' | 'count' | 'rate'; tags?: string[] }>): Promise<void> {
    for (const metric of metrics) {
      await this.submitMetric(metric.name, metric.value, metric.type, metric.tags);
    }
  }

  /**
   * Submit a log entry to Datadog
   */
  async submitLog(
    message: string,
    level: 'debug' | 'info' | 'warn' | 'error' = 'info',
    attributes: Record<string, unknown> = {}
  ): Promise<void> {
    if (!isDatadogConfigured()) return;

    const config = getDatadogConfig();
    const entry: LogEntry = {
      ddsource: 'nodejs',
      ddtags: `env:${config.env},service:${config.service},version:${config.version}`,
      hostname: 'vox-server',
      message,
      service: config.service,
      status: level,
      ...attributes,
    };

    this.logsBuffer.push(entry);

    // Flush if buffer is full
    if (this.logsBuffer.length >= this.BATCH_SIZE) {
      await this.flushLogs();
    }
  }

  /**
   * Submit an event to Datadog
   */
  async submitEvent(event: Event): Promise<void> {
    if (!isDatadogConfigured()) return;

    const config = getDatadogConfig();
    const payload = {
      ...event,
      tags: [
        `env:${config.env}`,
        `service:${config.service}`,
        ...(event.tags || []),
      ],
    };

    try {
      await fetch(`${this.getBaseUrl()}/api/v1/events`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error('[Datadog] Failed to submit event:', error);
    }
  }

  /**
   * Create an incident in Datadog
   */
  async createIncident(
    title: string,
    severity: 'SEV-1' | 'SEV-2' | 'SEV-3' | 'SEV-4' | 'SEV-5',
    description: string,
    attributes: Record<string, unknown> = {}
  ): Promise<string | null> {
    if (!isDatadogConfigured()) return null;

    const payload = {
      data: {
        type: 'incidents',
        attributes: {
          title,
          customer_impact_scope: description,
          fields: {
            severity: { type: 'dropdown', value: severity },
            state: { type: 'dropdown', value: 'active' },
            ...attributes,
          },
        },
      },
    };

    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v2/incidents`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        return data.data?.id || null;
      }
    } catch (error) {
      console.error('[Datadog] Failed to create incident:', error);
    }

    return null;
  }

  /**
   * Create a case in Datadog
   */
  async createCase(
    title: string,
    description: string,
    priority: 'P1' | 'P2' | 'P3' | 'P4' | 'P5',
    attributes: Record<string, unknown> = {}
  ): Promise<string | null> {
    if (!isDatadogConfigured()) return null;

    const payload = {
      data: {
        type: 'case',
        attributes: {
          title,
          description,
          priority,
          type: 'STANDARD',
          ...attributes,
        },
      },
    };

    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v2/cases`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        return data.data?.id || null;
      }
    } catch (error) {
      console.error('[Datadog] Failed to create case:', error);
    }

    return null;
  }

  /**
   * Trigger an alert via webhook or monitor
   */
  async triggerAlert(
    monitorId: string,
    message: string,
    tags: string[] = []
  ): Promise<void> {
    if (!isDatadogConfigured()) return;

    await this.submitEvent({
      title: `Alert Triggered: ${monitorId}`,
      text: message,
      alert_type: 'error',
      priority: 'normal',
      tags: [...tags, `monitor_id:${monitorId}`],
      aggregation_key: monitorId,
    });
  }

  private async flushMetrics(): Promise<void> {
    if (this.metricsBuffer.length === 0) return;

    const series = this.metricsBuffer.splice(0, this.metricsBuffer.length);

    try {
      await fetch(`${this.getBaseUrl()}/api/v2/series`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ series }),
      });
    } catch (error) {
      console.error('[Datadog] Failed to flush metrics:', error);
      // Re-add to buffer for retry (up to limit)
      if (this.metricsBuffer.length < 1000) {
        this.metricsBuffer.push(...series);
      }
    }
  }

  private async flushLogs(): Promise<void> {
    if (this.logsBuffer.length === 0) return;

    const logs = this.logsBuffer.splice(0, this.logsBuffer.length);

    try {
      await fetch(`${this.getBaseUrl()}/api/v2/logs`, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(logs),
      });
    } catch (error) {
      console.error('[Datadog] Failed to flush logs:', error);
      // Re-add to buffer for retry (up to limit)
      if (this.logsBuffer.length < 1000) {
        this.logsBuffer.push(...logs);
      }
    }
  }

  /**
   * Flush all buffered data
   */
  async flush(): Promise<void> {
    await Promise.all([this.flushMetrics(), this.flushLogs()]);
  }

  /**
   * Stop the flush interval and flush remaining data
   */
  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush();
  }
}

// Singleton instance
let datadogClient: DatadogClient | null = null;

/**
 * Get the Datadog client instance
 */
export function getDatadogClient(): DatadogClient {
  if (!datadogClient) {
    datadogClient = new DatadogClient();
  }
  return datadogClient;
}

export default getDatadogClient;
