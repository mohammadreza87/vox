/**
 * Audit Logging Module
 *
 * Provides centralized audit logging for security-relevant actions.
 * Logs are stored in Firestore for queryability and retention.
 */

import { getAdminDb } from '../firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { logger } from '../logger';

// ============================================
// TYPES
// ============================================

/**
 * Audit event types for tracking user actions
 */
export const AuditEventType = {
  // Authentication
  USER_LOGIN: 'USER_LOGIN',
  USER_LOGOUT: 'USER_LOGOUT',
  USER_SIGNUP: 'USER_SIGNUP',
  AUTH_FAILED: 'AUTH_FAILED',

  // Chat operations
  CHAT_CREATED: 'CHAT_CREATED',
  CHAT_DELETED: 'CHAT_DELETED',
  CHAT_RESTORED: 'CHAT_RESTORED',

  // Message operations
  MESSAGE_SENT: 'MESSAGE_SENT',
  MESSAGE_DELETED: 'MESSAGE_DELETED',

  // Contact operations
  CONTACT_CREATED: 'CONTACT_CREATED',
  CONTACT_UPDATED: 'CONTACT_UPDATED',
  CONTACT_DELETED: 'CONTACT_DELETED',

  // Voice operations
  VOICE_CLONED: 'VOICE_CLONED',
  VOICE_DELETED: 'VOICE_DELETED',

  // Subscription operations
  SUBSCRIPTION_CREATED: 'SUBSCRIPTION_CREATED',
  SUBSCRIPTION_UPDATED: 'SUBSCRIPTION_UPDATED',
  SUBSCRIPTION_CANCELLED: 'SUBSCRIPTION_CANCELLED',

  // Payment operations
  PAYMENT_INITIATED: 'PAYMENT_INITIATED',
  PAYMENT_COMPLETED: 'PAYMENT_COMPLETED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',

  // Data operations
  DATA_EXPORTED: 'DATA_EXPORTED',
  DATA_MIGRATED: 'DATA_MIGRATED',

  // Admin operations
  ADMIN_ACTION: 'ADMIN_ACTION',
} as const;

export type AuditEventTypeValue = (typeof AuditEventType)[keyof typeof AuditEventType];

/**
 * Audit log entry structure
 */
export interface AuditLogEntry {
  id?: string;
  event: AuditEventTypeValue;
  userId: string | null;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
}

/**
 * Options for querying audit logs
 */
export interface AuditLogQueryOptions {
  userId?: string;
  eventType?: AuditEventTypeValue | AuditEventTypeValue[];
  startDate?: Date;
  endDate?: Date;
  success?: boolean;
  limit?: number;
  offset?: number;
}

// ============================================
// CONFIGURATION
// ============================================

const AUDIT_COLLECTION = 'audit_logs';
const DEFAULT_RETENTION_DAYS = 90;

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Log an audit event
 *
 * @param event - The type of event
 * @param userId - The user who performed the action (null for anonymous)
 * @param metadata - Additional context about the action
 * @param options - Additional options (IP, user agent, success status)
 *
 * @example
 * ```typescript
 * await logAuditEvent(
 *   AuditEventType.USER_LOGIN,
 *   'user-123',
 *   { method: 'google', provider: 'firebase' },
 *   { ip: request.ip, success: true }
 * );
 * ```
 */
export async function logAuditEvent(
  event: AuditEventTypeValue,
  userId: string | null,
  metadata?: Record<string, unknown>,
  options?: {
    ip?: string;
    userAgent?: string;
    success?: boolean;
    errorMessage?: string;
  }
): Promise<void> {
  const { ip, userAgent, success = true, errorMessage } = options ?? {};

  try {
    const db = await getAdminDb();
    const now = new Date();

    const logEntry: Omit<AuditLogEntry, 'id'> = {
      event,
      userId,
      timestamp: now,
      metadata,
      ip,
      userAgent,
      success,
      errorMessage,
    };

    // Store in Firestore
    await db.collection(AUDIT_COLLECTION).add({
      ...logEntry,
      timestamp: Timestamp.fromDate(now),
    });

    // Also log to structured logger for real-time monitoring
    logger.info({
      event,
      userId,
      success,
      ...metadata,
    }, 'Audit event');
  } catch (error) {
    // Don't throw - audit logging should not break the main flow
    logger.error({ event, userId, error }, 'Failed to log audit event');
  }
}

/**
 * Query audit logs with filtering
 *
 * @param options - Query options for filtering and pagination
 * @returns Array of audit log entries
 */
export async function getAuditLogs(options: AuditLogQueryOptions = {}): Promise<AuditLogEntry[]> {
  const {
    userId,
    eventType,
    startDate,
    endDate,
    success,
    limit = 100,
    offset = 0,
  } = options;

  try {
    const db = await getAdminDb();
    let query: FirebaseFirestore.Query = db.collection(AUDIT_COLLECTION);

    // Apply filters
    if (userId) {
      query = query.where('userId', '==', userId);
    }

    if (eventType) {
      if (Array.isArray(eventType)) {
        query = query.where('event', 'in', eventType);
      } else {
        query = query.where('event', '==', eventType);
      }
    }

    if (startDate) {
      query = query.where('timestamp', '>=', Timestamp.fromDate(startDate));
    }

    if (endDate) {
      query = query.where('timestamp', '<=', Timestamp.fromDate(endDate));
    }

    if (success !== undefined) {
      query = query.where('success', '==', success);
    }

    // Order by timestamp (newest first) and apply pagination
    query = query.orderBy('timestamp', 'desc').offset(offset).limit(limit);

    const snapshot = await query.get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        event: data.event as AuditEventTypeValue,
        userId: data.userId,
        timestamp: data.timestamp.toDate(),
        metadata: data.metadata,
        ip: data.ip,
        userAgent: data.userAgent,
        success: data.success,
        errorMessage: data.errorMessage,
      };
    });
  } catch (error) {
    logger.error({ error, options }, 'Failed to query audit logs');
    throw error;
  }
}

/**
 * Get audit logs for a specific user
 */
export async function getUserAuditLogs(
  userId: string,
  options: Omit<AuditLogQueryOptions, 'userId'> = {}
): Promise<AuditLogEntry[]> {
  return getAuditLogs({ ...options, userId });
}

/**
 * Count audit events matching criteria
 */
export async function countAuditEvents(options: AuditLogQueryOptions = {}): Promise<number> {
  const {
    userId,
    eventType,
    startDate,
    endDate,
    success,
  } = options;

  try {
    const db = await getAdminDb();
    let query: FirebaseFirestore.Query = db.collection(AUDIT_COLLECTION);

    if (userId) {
      query = query.where('userId', '==', userId);
    }

    if (eventType) {
      if (Array.isArray(eventType)) {
        query = query.where('event', 'in', eventType);
      } else {
        query = query.where('event', '==', eventType);
      }
    }

    if (startDate) {
      query = query.where('timestamp', '>=', Timestamp.fromDate(startDate));
    }

    if (endDate) {
      query = query.where('timestamp', '<=', Timestamp.fromDate(endDate));
    }

    if (success !== undefined) {
      query = query.where('success', '==', success);
    }

    const snapshot = await query.count().get();
    return snapshot.data().count;
  } catch (error) {
    logger.error({ error, options }, 'Failed to count audit events');
    throw error;
  }
}

// ============================================
// CLEANUP
// ============================================

/**
 * Delete old audit logs beyond retention period
 *
 * @param retentionDays - Number of days to retain logs (default: 90)
 * @returns Number of logs deleted
 */
export async function cleanupOldAuditLogs(retentionDays: number = DEFAULT_RETENTION_DAYS): Promise<number> {
  try {
    const db = await getAdminDb();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const snapshot = await db
      .collection(AUDIT_COLLECTION)
      .where('timestamp', '<', Timestamp.fromDate(cutoffDate))
      .limit(500) // Process in batches
      .get();

    if (snapshot.empty) {
      return 0;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    const deletedCount = snapshot.docs.length;
    logger.info({ deletedCount, retentionDays }, 'Cleaned up old audit logs');

    // If we hit the limit, there might be more to delete
    if (deletedCount === 500) {
      const additionalDeleted = await cleanupOldAuditLogs(retentionDays);
      return deletedCount + additionalDeleted;
    }

    return deletedCount;
  } catch (error) {
    logger.error({ error, retentionDays }, 'Failed to cleanup old audit logs');
    throw error;
  }
}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

/**
 * Log a successful login
 */
export async function logLogin(
  userId: string,
  metadata: { method: string; provider?: string },
  options?: { ip?: string; userAgent?: string }
): Promise<void> {
  await logAuditEvent(AuditEventType.USER_LOGIN, userId, metadata, { ...options, success: true });
}

/**
 * Log a failed login attempt
 */
export async function logFailedLogin(
  identifier: string,
  metadata: { method: string; reason: string },
  options?: { ip?: string; userAgent?: string }
): Promise<void> {
  await logAuditEvent(
    AuditEventType.AUTH_FAILED,
    null,
    { identifier, ...metadata },
    { ...options, success: false, errorMessage: metadata.reason }
  );
}

/**
 * Log a logout
 */
export async function logLogout(userId: string): Promise<void> {
  await logAuditEvent(AuditEventType.USER_LOGOUT, userId, undefined, { success: true });
}

/**
 * Log chat creation
 */
export async function logChatCreated(
  userId: string,
  chatId: string,
  contactId: string
): Promise<void> {
  await logAuditEvent(AuditEventType.CHAT_CREATED, userId, { chatId, contactId });
}

/**
 * Log chat deletion
 */
export async function logChatDeleted(
  userId: string,
  chatId: string,
  softDelete: boolean = true
): Promise<void> {
  await logAuditEvent(AuditEventType.CHAT_DELETED, userId, { chatId, softDelete });
}

/**
 * Log message sent
 */
export async function logMessageSent(
  userId: string,
  chatId: string,
  messageId: string,
  role: 'user' | 'assistant'
): Promise<void> {
  await logAuditEvent(AuditEventType.MESSAGE_SENT, userId, { chatId, messageId, role });
}

/**
 * Log voice cloning
 */
export async function logVoiceCloned(
  userId: string,
  voiceId: string,
  voiceName: string
): Promise<void> {
  await logAuditEvent(AuditEventType.VOICE_CLONED, userId, { voiceId, voiceName });
}

/**
 * Log subscription change
 */
export async function logSubscriptionChange(
  userId: string,
  event: 'created' | 'updated' | 'cancelled',
  metadata: { tier?: string; provider?: string; amount?: number }
): Promise<void> {
  const eventType =
    event === 'created'
      ? AuditEventType.SUBSCRIPTION_CREATED
      : event === 'cancelled'
        ? AuditEventType.SUBSCRIPTION_CANCELLED
        : AuditEventType.SUBSCRIPTION_UPDATED;

  await logAuditEvent(eventType, userId, metadata);
}

/**
 * Log payment event
 */
export async function logPayment(
  userId: string,
  success: boolean,
  metadata: { provider: string; amount?: number; currency?: string; reason?: string }
): Promise<void> {
  const eventType = success ? AuditEventType.PAYMENT_COMPLETED : AuditEventType.PAYMENT_FAILED;

  await logAuditEvent(eventType, userId, metadata, {
    success,
    errorMessage: success ? undefined : metadata.reason,
  });
}
