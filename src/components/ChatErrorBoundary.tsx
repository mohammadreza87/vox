'use client';

import { Component, ReactNode } from 'react';
import { Button } from '@/shared/components';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  onError?: (error: Error) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Smaller error boundary specifically for the chat area.
 * Shows an inline error message without affecting the rest of the app.
 */
export class ChatErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ChatErrorBoundary caught an error:', error, errorInfo);
    this.props.onError?.(error);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center p-6 rounded-2xl bg-[var(--color-foreground)]/5">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-[var(--color-error)]" />

            <h3 className="text-lg font-semibold text-[var(--color-foreground)] mb-2">
              Chat Error
            </h3>

            <p className="text-sm text-[var(--color-foreground)]/60 mb-4">
              Something went wrong loading the chat. Your messages are safe.
            </p>

            <Button onClick={this.handleRetry} size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <p className="mt-4 text-xs font-mono text-[var(--color-error)]">
                {this.state.error.message}
              </p>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
