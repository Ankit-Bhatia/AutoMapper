import type { ErrorInfo, ReactNode } from 'react';
import React from 'react';
import { reportFrontendError } from '../telemetry/errorReporting';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void reportFrontendError({
      source: 'runtime',
      severity: 'fatal',
      code: 'REACT_RENDER_ERROR',
      message: error.message,
      error,
      metadata: {
        componentStack: info.componentStack,
      },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-shell">
          <main className="main-content" style={{ paddingTop: '48px' }}>
            <div className="validation-box validation-box--error" role="alert">
              <div className="validation-box-title">Application error</div>
              <p style={{ margin: 0, fontSize: '14px' }}>
                The UI hit an unexpected error and has been reported. Please reload the page.
              </p>
            </div>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}
