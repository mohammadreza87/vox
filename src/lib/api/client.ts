/**
 * Core API Client
 * Centralized HTTP client with auth, error handling, and retry logic
 */

import { auth } from '@/lib/firebase';
import { ApiError } from './errors';

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  timeout?: number;
  retry?: boolean;
  maxRetries?: number;
  skipAuth?: boolean;
}

interface ApiClientConfig {
  baseUrl: string;
  defaultTimeout: number;
  maxRetries: number;
  retryDelay: number;
  onUnauthorized?: () => void;
  debug?: boolean;
}

const DEFAULT_CONFIG: ApiClientConfig = {
  baseUrl: '',
  defaultTimeout: 30000,
  maxRetries: 3,
  retryDelay: 1000,
  debug: process.env.NODE_ENV === 'development',
};

class ApiClient {
  private config: ApiClientConfig;

  constructor(config: Partial<ApiClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get auth token from Firebase
   */
  private async getAuthToken(): Promise<string | null> {
    try {
      const token = await auth.currentUser?.getIdToken();
      return token || null;
    } catch (error) {
      console.error('Error getting auth token:', error);
      return null;
    }
  }

  /**
   * Build full URL
   */
  private buildUrl(path: string): string {
    if (path.startsWith('http')) return path;
    return `${this.config.baseUrl}${path}`;
  }

  /**
   * Build headers with auth
   */
  private async buildHeaders(
    options: RequestOptions
  ): Promise<Headers> {
    const headers = new Headers(options.headers);

    // Set content type for JSON bodies
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    // Add auth token unless skipped
    if (!options.skipAuth) {
      const token = await this.getAuthToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }

    return headers;
  }

  /**
   * Sleep helper for retry delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Core request method with retry logic
   */
  async request<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const {
      timeout = this.config.defaultTimeout,
      retry = true,
      maxRetries = this.config.maxRetries,
      body,
      ...fetchOptions
    } = options;

    const url = this.buildUrl(path);
    const headers = await this.buildHeaders(options);

    const requestInit: RequestInit = {
      ...fetchOptions,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    };

    // Debug logging
    if (this.config.debug) {
      console.log(`[API] ${requestInit.method || 'GET'} ${path}`);
    }

    let lastError: ApiError | null = null;
    let attempts = 0;

    while (attempts <= (retry ? maxRetries : 0)) {
      attempts++;

      try {
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          ...requestInit,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Parse response
        let responseBody: unknown;
        const contentType = response.headers.get('content-type');

        if (contentType?.includes('application/json')) {
          responseBody = await response.json();
        } else {
          responseBody = await response.text();
        }

        // Handle errors
        if (!response.ok) {
          const error = ApiError.fromResponse(response, responseBody);

          // Handle unauthorized
          if (error.code === 'UNAUTHORIZED' && this.config.onUnauthorized) {
            this.config.onUnauthorized();
          }

          // Retry if retryable
          if (error.retryable && retry && attempts <= maxRetries) {
            lastError = error;
            await this.sleep(this.config.retryDelay * attempts);
            continue;
          }

          throw error;
        }

        // Debug logging
        if (this.config.debug) {
          console.log(`[API] ${response.status} ${path}`);
        }

        return responseBody as T;
      } catch (error) {
        // Handle abort (timeout)
        if (error instanceof Error && error.name === 'AbortError') {
          const timeoutError = ApiError.timeout();
          if (retry && attempts <= maxRetries) {
            lastError = timeoutError;
            await this.sleep(this.config.retryDelay * attempts);
            continue;
          }
          throw timeoutError;
        }

        // Handle network errors
        if (error instanceof TypeError && error.message.includes('fetch')) {
          const networkError = ApiError.networkError();
          if (retry && attempts <= maxRetries) {
            lastError = networkError;
            await this.sleep(this.config.retryDelay * attempts);
            continue;
          }
          throw networkError;
        }

        // Re-throw API errors
        if (error instanceof ApiError) {
          throw error;
        }

        // Unknown error
        throw error;
      }
    }

    // If we exhausted retries, throw the last error
    if (lastError) {
      throw lastError;
    }

    throw new Error('Request failed');
  }

  /**
   * GET request
   */
  async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  /**
   * POST request
   */
  async post<T>(
    path: string,
    body?: unknown,
    options: RequestOptions = {}
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  /**
   * PUT request
   */
  async put<T>(
    path: string,
    body?: unknown,
    options: RequestOptions = {}
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  /**
   * PATCH request
   */
  async patch<T>(
    path: string,
    body?: unknown,
    options: RequestOptions = {}
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  /**
   * DELETE request
   */
  async delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  /**
   * Upload file (multipart form data)
   */
  async upload<T>(
    path: string,
    formData: FormData,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = this.buildUrl(path);
    const headers = new Headers();

    // Add auth token
    if (!options.skipAuth) {
      const token = await this.getAuthToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }

    // Don't set Content-Type - let browser set it with boundary
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    let responseBody: unknown;
    const contentType = response.headers.get('content-type');

    if (contentType?.includes('application/json')) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    if (!response.ok) {
      throw ApiError.fromResponse(response, responseBody);
    }

    return responseBody as T;
  }
}

// Create singleton instance
export const api = new ApiClient();

// Export class for custom instances
export { ApiClient };
