import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// StrictMode double-mounts effects in dev and forces WebGL context loss/restore cycles.
createRoot(document.getElementById('root')!).render(<App />);
