import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import RigApp from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RigApp />
  </StrictMode>,
);
