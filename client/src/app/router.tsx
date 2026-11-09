import type { ComponentType, ReactNode } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';

import { LoadingSkeleton } from '@/components/command-center/LoadingSkeleton';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { RequirePermission } from '@/features/auth/RequirePermission';
import { useLanguage } from '@/i18n/useLanguage';
import { NotFoundPage } from './NotFoundPage';
import { RouteErrorPage } from './RouteErrorPage';
import { ROUTE_ACCESS, type RouteAccess } from './routeAccess';

function RouteHydrationFallback() {
  const { t } = useLanguage();
  return (
    <LoadingSkeleton loadingLabel={t('common.loading')} className="mx-auto w-full max-w-[1600px]" />
  );
}

function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}

function guardedLazy(
  path: keyof typeof ROUTE_ACCESS & string,
  load: () => Promise<ComponentType>,
): RouteObject {
  const access: RouteAccess = ROUTE_ACCESS[path];
  return {
    path,
    HydrateFallback: RouteHydrationFallback,
    errorElement: <RouteErrorPage nested />,
    lazy: async () => {
      const Page = await load();
      return {
        Component: function GuardedPage() {
          return (
            <RequirePermission anyOf={access.anyOf} allOf={access.allOf}>
              <Page />
            </RequirePermission>
          );
        },
      };
    },
  };
}

export const appRoutes: RouteObject[] = [
  {
    path: '/login',
    HydrateFallback: RouteHydrationFallback,
    errorElement: <RouteErrorPage />,
    lazy: async () => {
      const { LoginPage } = await import('@/features/auth/LoginPage');
      return { Component: LoginPage };
    },
  },
  {
    path: '/',
    HydrateFallback: RouteHydrationFallback,
    errorElement: <RouteErrorPage />,
    lazy: async () => {
      const { AppLayout } = await import('@/components/AppLayout');
      return {
        Component: function Layout() {
          return (
            <AuthenticatedLayout>
              <AppLayout />
            </AuthenticatedLayout>
          );
        },
      };
    },
    children: [
      {
        index: true,
        errorElement: <RouteErrorPage nested />,
        lazy: async () => {
          const { HomeRoute } = await import('@/features/auth/HomeRoute');
          return { Component: HomeRoute };
        },
      },
      guardedLazy('employees', async () => {
        const { EmployeesPage } = await import('@/features/employees/EmployeesPage');
        return EmployeesPage;
      }),
      guardedLazy('departments', async () => {
        const { DepartmentsPage } = await import('@/features/departments/DepartmentsPage');
        return DepartmentsPage;
      }),
      guardedLazy('users', async () => {
        const { UsersPage } = await import('@/features/users/UsersPage');
        return UsersPage;
      }),
      guardedLazy('audit-logs', async () => {
        const { AuditLogsPage } = await import('@/features/audit/AuditLogsPage');
        return AuditLogsPage;
      }),
      guardedLazy('settings', async () => {
        const { SettingsPage } = await import('@/features/settings/SettingsPage');
        return SettingsPage;
      }),
      { path: '*', errorElement: <RouteErrorPage nested />, element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);
