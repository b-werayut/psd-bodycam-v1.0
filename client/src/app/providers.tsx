import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { MotionProvider } from '@/components/motion/MotionProvider';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { queryClient } from '@/lib/queryClient';
import { ThemeProvider } from '@/theme/ThemeProvider';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ThemeProvider>
          <MotionProvider>{children}</MotionProvider>
        </ThemeProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
