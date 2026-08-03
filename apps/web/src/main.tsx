import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.tsx';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401 means "sign in", not "try harder".
      retry: (count, error) =>
        count < 2 && !(error instanceof Error && error.name === 'ApiError' && 'status' in error && (error as { status: number }).status === 401),
      refetchOnWindowFocus: false,
      staleTime: 2000,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
