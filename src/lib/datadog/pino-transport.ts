/**
 * Pino Transport for Datadog
 *
 * Forwards Pino logs to Datadog while maintaining local logging.
 * Supports batching, retries, and graceful shutdown.
 */

import { getDatadogConfig, isDatadogConfigured } from './config';

interface PinoLogObject {
  level: number;
  time: number;
  msg?: string;
  message?: string;
  [key: string]: unknown;
}

// Pino log level numbers to names
const PINO_LEVELS: Record<number, 'debug' | 'info' | 'warn' | 'error'> = {
  10: 'debug',  // trace -> debug
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'error',  // fatal -> error
};

interface DatadogLogEntry {
  ddsource: string;
  ddtags: string;
  hostname: string;
  message: string;
  service: string;
  status: 'debug' | 'info' | 'warn' | 'error';
  timestamp: number;
  [key: string]: unknown;
}

/**
 * Datadog Pino Transport
 *
 * Usage with Pino:
 * ```typescript
 * import pino from 'pino';
 * import { createDatadogTransport } from './pino-transport';
 *
 * const logger = pino({
 *   transport: {
 *     targets: [
 *       { target: 'pino-pretty' }, // Local pretty print
 *       { target: './pino-transport', level: 'info' }, // Datadog
 *     ],
 *   },
 * });
 * ```
 */
class DatadogPinoTransport {
  private buffer: DatadogLogEntry[] = [];
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_SIZE = 100;
  private readonly FLUSH_INTERVAL_MS = 5000;
  private isShuttingDown = false;

  constructor() {
    // Set up flush interval
    this.scheduleFlush();

    // Handle process shutdown
    if (typeof process !== 'undefined') {
      process.on('beforeExit', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());
    }
  }

  /**
   * Transform a Pino log object to Datadog format
   */
  private transformLog(log: PinoLogObject): DatadogLogEntry | null {
    if (!isDatadogConfigured()) return null;

    const config = getDatadogConfig();
    const level = PINO_LEVELS[log.level] || 'info';

    // Skip debug logs in production unless explicitly enabled
    if (level === 'debug' && config.env === 'production' && config.logs.logLevel !== 'debug') {
      return null;
    }

    // Extract standard fields
    const { level: _, time, msg, message, pid, hostname, ...attributes } = log;

    // Build tags
    const tags = [
      `env:${config.env}`,
      `service:${config.service}`,
      `version:${config.version}`,
    ];

    // Add module tag if present
    if (attributes.module) {
      tags.push(`module:${attributes.module}`);
    }

    // Add type tag if present
    if (attributes.type) {
      tags.push(`type:${attributes.type}`);
    }

    return {
      ddsource: 'nodejs',
      ddtags: tags.join(','),
      hostname: String(hostname || 'vox-server'),
      message: String(msg || message || 'Log entry'),
      service: config.service,
      status: level,
      timestamp: time || Date.now(),
      ...attributes,
    };
  }

  /**
   * Add a log to the buffer
   */
  async write(log: PinoLogObject): Promise<void> {
    const entry = this.transformLog(log);
    if (!entry) return;

    this.buffer.push(entry);

    // Flush if buffer is full
    if (this.buffer.length >= this.BATCH_SIZE) {
      await this.flush();
    }
  }

  /**
   * Schedule the next flush
   */
  private scheduleFlush(): void {
    if (this.isShuttingDown) return;

    this.flushTimeout = setTimeout(async () => {
      await this.flush();
      this.scheduleFlush();
    }, this.FLUSH_INTERVAL_MS);
  }

  /**
   * Flush buffered logs to Datadog
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    if (!isDatadogConfigured()) {
      this.buffer = [];
      return;
    }

    const logs = this.buffer.splice(0, this.buffer.length);
    const config = getDatadogConfig();

    try {
      const response = await fetch(`https://http-intake.logs.${config.site}/api/v2/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'DD-API-KEY': config.apiKey,
        },
        body: JSON.stringify(logs),
      });

      if (!response.ok) {
        console.error(`[Datadog] Failed to send logs: ${response.status} ${response.statusText}`);
        // Re-add logs to buffer for retry (up to limit)
        if (this.buffer.length < 1000) {
          this.buffer.unshift(...logs);
        }
      }
    } catch (error) {
      console.error('[Datadog] Failed to send logs:', error);
      // Re-add logs to buffer for retry (up to limit)
      if (this.buffer.length < 1000) {
        this.buffer.unshift(...logs);
      }
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    await this.flush();
  }
}

// Singleton instance
let transport: DatadogPinoTransport | null = null;

/**
 * Get the Datadog Pino transport instance
 */
export function getDatadogPinoTransport(): DatadogPinoTransport {
  if (!transport) {
    transport = new DatadogPinoTransport();
  }
  return transport;
}

/**
 * Create a writable stream for Pino transport
 * This is the format expected by Pino for custom transports
 */
export function createDatadogWritable() {
  const ddTransport = getDatadogPinoTransport();

  return {
    write(chunk: string | Buffer): void {
      try {
        const log = JSON.parse(chunk.toString()) as PinoLogObject;
        ddTransport.write(log).catch(console.error);
      } catch {
        // Ignore parse errors
      }
    },
  };
}

/**
 * Log directly to Datadog (bypass Pino)
 */
export async function logToDatadog(
  message: string,
  level: 'debug' | 'info' | 'warn' | 'error' = 'info',
  attributes: Record<string, unknown> = {}
): Promise<void> {
  const transport = getDatadogPinoTransport();
  await transport.write({
    level: level === 'debug' ? 20 : level === 'info' ? 30 : level === 'warn' ? 40 : 50,
    time: Date.now(),
    msg: message,
    ...attributes,
  });
}

export default { getDatadogPinoTransport, createDatadogWritable, logToDatadog };
