/**
 * Input sanitization utilities for security
 * These functions clean user input before processing
 */

/**
 * Sanitize text before sending to AI providers
 * Removes control characters and trims whitespace
 */
export function sanitizeForAI(text: string): string {
  return text
    // Remove null bytes and other control characters (except newlines/tabs)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize unicode
    .normalize('NFC')
    // Trim whitespace
    .trim();
}

/**
 * Sanitize text for storage in database
 * More aggressive cleaning for persistent data
 */
export function sanitizeForStorage(text: string): string {
  return text
    // Remove null bytes and control characters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize unicode
    .normalize('NFC')
    // Collapse multiple spaces/newlines
    .replace(/\s+/g, ' ')
    // Trim
    .trim();
}

/**
 * Sanitize a name field (contact name, voice name, etc.)
 * Allows only safe characters
 */
export function sanitizeName(name: string): string {
  return name
    // Remove control characters
    .replace(/[\x00-\x1F\x7F]/g, '')
    // Normalize unicode
    .normalize('NFC')
    // Trim
    .trim()
    // Limit consecutive spaces
    .replace(/\s+/g, ' ');
}

/**
 * Sanitize a language code
 * Ensures it's a valid format (e.g., "en", "en-US", "Spanish")
 */
export function sanitizeLanguageCode(code: string): string {
  return code
    // Remove anything that's not alphanumeric, hyphen, or space
    .replace(/[^a-zA-Z0-9\-\s]/g, '')
    .trim()
    .slice(0, 50);
}

/**
 * Check if a string might contain prompt injection attempts
 * Returns true if suspicious patterns are found
 * Note: This is a heuristic check, not foolproof
 */
export function hasSuspiciousPatterns(text: string): boolean {
  const suspiciousPatterns = [
    // Common prompt injection patterns
    /ignore\s+(previous|above|all)\s+instructions/i,
    /disregard\s+(previous|above|all)\s+(instructions|prompts)/i,
    /you\s+are\s+now\s+a/i,
    /new\s+instructions?:/i,
    /system\s*:\s*you\s+are/i,
    /\[system\]/i,
    /\[admin\]/i,
    /\[developer\]/i,
    // Jailbreak attempts
    /dan\s+mode/i,
    /developer\s+mode/i,
    /jailbreak/i,
  ];

  return suspiciousPatterns.some((pattern) => pattern.test(text));
}

/**
 * Truncate text to a maximum length while preserving word boundaries
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.8) {
    return truncated.slice(0, lastSpace) + '...';
  }

  return truncated + '...';
}

/**
 * Validate and sanitize a URL
 * Returns null if the URL is invalid or uses a disallowed protocol
 */
export function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);

    // Only allow http and https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    // Return the normalized URL
    return parsed.href;
  } catch {
    return null;
  }
}
