import { ChevronRight } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';

import { NAV_GROUPS, visibleNavItems } from '@/app/nav';
import { ROUTE_ACCESS, canEnter } from '@/app/routeAccess';
import { PageHeader } from '@/components/command-center';
import { useLanguage } from '@/i18n/useLanguage';
import { useAuthStore } from '@/stores/authStore';
import { RequirePermission } from './RequirePermission';

export function HomeRoute() {
  const user = useAuthStore((s) => s.user);
  const { t } = useLanguage();

  if (canEnter(ROUTE_ACCESS[''], user?.permissions, user?.roleCode)) {
    const destinations = visibleNavItems(user?.permissions, user?.roleCode).filter(
      (item) => item.to && item.to !== '/',
    );
    const groups = NAV_GROUPS.filter((group) => destinations.some((item) => item.group === group.id));

    return (
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8">
        <PageHeader
          title={t('app.home.title')}
          description={user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : undefined}
        />
        {groups.length > 0 ? (
          <nav aria-label={t('app.home.workspaces')} className="grid gap-8 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => (
              <section key={group.id} aria-labelledby={`home-${group.id}`} className="min-w-0">
                <h2 id={`home-${group.id}`} className="mb-3 text-subheading font-semibold">
                  {t(group.labelKey)}
                </h2>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {destinations.filter((item) => item.group === group.id).map((item) => (
                    <li key={item.to}>
                      <Link to={item.to!} className="group flex min-h-16 items-center gap-3 px-4 py-4 text-control font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                        <item.icon aria-hidden="true" className="size-5 shrink-0 text-link" strokeWidth={1.5} />
                        <span className="min-w-0 flex-1">{t(item.labelKey)}</span>
                        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>
        ) : null}
      </div>
    );
  }

  const fallback = visibleNavItems(user?.permissions, user?.roleCode).find(
    (item) => item.to && item.to !== '/',
  );
  if (fallback?.to) return <Navigate to={fallback.to} replace />;

  return <RequirePermission anyOf={ROUTE_ACCESS[''].anyOf}>{null}</RequirePermission>;
}
