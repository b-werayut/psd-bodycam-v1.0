import { Navigate } from 'react-router-dom';

import { visibleNavItems } from '@/app/nav';
import { ROUTE_ACCESS, canEnter } from '@/app/routeAccess';
import { PageHeader } from '@/components/command-center';
import { useLanguage } from '@/i18n/useLanguage';
import { useAuthStore } from '@/stores/authStore';
import { RequirePermission } from './RequirePermission';

export function HomeRoute() {
  const user = useAuthStore((s) => s.user);
  const { t } = useLanguage();

  if (canEnter(ROUTE_ACCESS[''], user?.permissions, user?.roleCode)) {
    return <PageHeader title={t('app.home.title')} description={user?.fullName} />;
  }

  const fallback = visibleNavItems(user?.permissions, user?.roleCode).find(
    (item) => item.to && item.to !== '/',
  );
  if (fallback?.to) return <Navigate to={fallback.to} replace />;

  return <RequirePermission anyOf={ROUTE_ACCESS[''].anyOf}>{null}</RequirePermission>;
}
