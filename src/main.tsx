import { createRoot } from 'react-dom/client';
import App from './App';
import { AppErrorBoundary } from '@/app/AppErrorBoundary';
import { installCrashHandlers } from '@/app/crashRecovery';
import { applyWorkspaceTheme, readStoredTheme } from '@/app/theme/themeTokens';
import './index.css';

applyWorkspaceTheme(readStoredTheme());
installCrashHandlers();

// StrictMode double-mounts effects in dev and forces WebGL context loss/restore cycles.
createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
