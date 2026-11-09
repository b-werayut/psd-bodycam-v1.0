import { Link, useLocation } from 'react-router-dom';

import { useLanguage } from '@/i18n/useLanguage';
import { NAV_ITEMS } from '@/app/nav';

export function Breadcrumb() {
  const { pathname } = useLocation();
  const { t } = useLanguage();

  const home = { label: t('breadcrumb.home'), to: '/' };
  const match = NAV_ITEMS.filter(
    (item) => item.to && item.to !== '/' && pathname.startsWith(item.to),
  ).sort((a, b) => (b.to?.length ?? 0) - (a.to?.length ?? 0))[0];

  const trail = match
    ? [home, { label: t(match.labelKey), to: match.to as string }]
    : [home];

  return (
    <nav aria-label={t('breadcrumb.label')} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        {trail.map((crumb, index) => {
          const isCurrent = index === trail.length - 1;
          return (
            <li key={crumb.to} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <span aria-hidden="true" className="text-muted-foreground/50">
                  ›
                </span>
              ) : null}
              {isCurrent ? (
                <span aria-current="page" className="truncate font-medium text-foreground">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  to={crumb.to}
                  className="truncate rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
