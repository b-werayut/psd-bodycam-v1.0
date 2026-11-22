import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { MotionProvider } from '@/components/motion/MotionProvider';
import { Toaster } from '@/components/ui/sonner';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { queryClient } from '@/lib/queryClient';
import { ThemeProvider } from '@/theme/ThemeProvider';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ThemeProvider>
          <MotionProvider>
            {children}
            {/* The one Toaster: it outlives route changes, so a toast raised on the way out
                (e.g. a background logout that could not reach the server) still shows. */}
            <Toaster />
          </MotionProvider>
        </ThemeProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
