import { Component, type ErrorInfo, type ReactNode } from 'react';
import { APP_VERSION } from '@/app/appVersion';
import { flushCrashAutosave } from '@/app/crashRecovery';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    flushCrashAutosave(`UI crash: ${error.message}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error.message || 'Unknown error';
    return (
      <div className="app-crash" role="alert">
        <div className="app-modal">
          <h2>ViperCAD hit a problem</h2>
          <p>
            An autosave was written if the project was open. Reload to continue. Version {APP_VERSION}.
          </p>
          <pre className="app-crash-detail">{message}</pre>
          <div className="app-modal-actions">
            <button type="button" className="tool primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
