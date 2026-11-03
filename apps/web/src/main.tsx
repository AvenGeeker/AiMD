import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.js';
import { installNativeActions } from './lib/nativeActions.js';
import { installShareReceiver } from './lib/shareInbox.js';
import './styles/index.css';
import './styles/preview.css';
import 'katex/dist/katex.min.css';

installNativeActions();
installShareReceiver();

/**
 * Entry point.
 *
 * One bundle serves three surfaces: the browser tab, the Electron main window and the Electron
 * quick-capture window. `App` inspects the desktop bridge to decide which one it is.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Offline editing is the norm here, so retries must be quick and quiet rather than
      // hammering a server the user may legitimately be disconnected from.
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('missing #root container');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
