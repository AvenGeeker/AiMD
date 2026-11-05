import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Last line of defence against a white screen.
 *
 * On devices we cannot test here (old Android WebViews, HarmonyOS ArkWeb), a render crash or a
 * failed lazy chunk used to leave the user with a blank page and us with no clue. The boundary
 * renders the error message on screen instead, with a reload and a retry action, so the next
 * report carries the actual failure.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced in chrome://inspect / logcat for device-side diagnosis.
    console.error('[aimd] render crashed:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash-shell" role="alert" data-testid="crash-boundary">
        <div className="crash-card">
          <div className="crash-title">界面渲染出错</div>
          <div className="crash-hint">把下面这段信息发回给开发者即可定位：</div>
          <pre className="crash-message" data-testid="crash-message">
            {error.message || String(error)}
          </pre>
          <div className="crash-actions">
            <button
              type="button"
              className="button-primary"
              onClick={() => window.location.reload()}
              data-testid="crash-reload"
            >
              重新加载
            </button>
            <button
              type="button"
              className="button-ghost"
              onClick={() => this.setState({ error: null })}
              data-testid="crash-retry"
            >
              重试渲染
            </button>
          </div>
        </div>
      </div>
    );
  }
}
