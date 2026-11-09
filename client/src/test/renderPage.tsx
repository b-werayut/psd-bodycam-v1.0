import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import type { ReactElement } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { useAuthStore, type AuthUser } from '@/stores/authStore';

export function signIn(
  permissions: string[],
  overrides: Partial<AuthUser> = {},
): void {
  useAuthStore.setState({
    accessToken: 'token',
    user: {
      id: '1',
      username: 'admin1',
      fullName: 'ผู้ดูแล',
      email: null,
      roleCode: 'OPERATOR',
      roleName: 'OPERATOR',
      departmentId: null,
      departmentName: null,
      permissions,
      ...overrides,
    },
  });
}

export function signOut(): void {
  useAuthStore.setState({ accessToken: null, user: null });
}

export function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        {ui}
        <Toaster />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

export function apiError(status: number, body: Record<string, unknown>): AxiosError {
  return new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    data: body,
  } as AxiosResponse);
}
