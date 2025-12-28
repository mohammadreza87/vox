'use client';

import { Component, ReactNode } from 'react';
import * as Sentry from '@sentry/nextjs';
import { Button } from '@/shared/components';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * React Error Boundary component that catches JavaScript errors anywhere in the child component tree.
 * Displays a fallback UI instead of crashing the entire app.
 *
 * @example
 * <ErrorBoundary>
 *   <MyComponent />
 * </ErrorBoundary>
 *
 * @example
 * <ErrorBoundary fallback={<CustomErrorUI />} onError={(error) => logToService(error)}>
 *   <MyComponent />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Call optional error handler (e.g., for error tracking services)
    this.props.onError?.(error, errorInfo);

    // Send to Sentry for error tracking
    Sentry.captureException(error, {
      extra: {
        componentStack: errorInfo.componentStack,
      },
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  handleRefresh = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--color-background)]">
          <div className="max-w-md w-full text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[var(--color-error)]/10 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-[var(--color-error)]" />
            </div>

            <h2 className="text-xl font-bold text-[var(--color-foreground)] mb-2">
              Something went wrong
            </h2>

            <p className="text-[var(--color-foreground)]/60 mb-6">
              We encountered an unexpected error. Please try again or refresh the page.
            </p>

            <div className="flex gap-3 justify-center">
              <Button onClick={this.handleRetry} variant="primary">
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
              <Button onClick={this.handleRefresh} variant="secondary">
                Refresh Page
              </Button>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="mt-6 p-4 bg-[var(--color-foreground)]/5 rounded-lg text-left">
                <p className="text-sm font-mono text-[var(--color-error)] mb-2">
                  {this.state.error.message}
                </p>
                <pre className="text-xs font-mono text-[var(--color-foreground)]/60 overflow-auto max-h-40">
                  {this.state.error.stack}
                </pre>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
