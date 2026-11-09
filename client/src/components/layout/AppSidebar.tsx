import { NavLink } from 'react-router-dom';

import { BrandMark } from '@/components/BrandMark';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';
import { NAV_GROUPS, visibleNavItems, type NavItem } from '@/app/nav';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { BranchedNav } from './BranchedNav';

/** ความสูงแถวของ branched menu — drawer บนมือถือใช้ 44px ให้ได้เป้ากดขั้นต่ำ */
const BRANCHED_ROW_HEIGHT = { desktop: 40, drawer: 44 } as const;

export interface AppSidebarProps {
  collapsed: boolean;
  variant?: 'desktop' | 'drawer';
  onNavigate?: () => void;
}

const linkClass = (isActive: boolean) =>
  cn(
    'relative flex min-h-11 min-w-11 shrink-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-normal lg:min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-safe:transition-colors motion-safe:duration-150',
    isActive
      ? 'bg-sidebar-active font-medium text-sidebar-active-foreground'
      : 'text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground',
  );

function NavEntry({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useLanguage();
  const itemLabel = t(item.labelKey);
  const label = (
    <span
      className={cn(
        'min-w-0 truncate motion-safe:transition-[max-width,opacity] motion-safe:duration-200',
        collapsed ? 'max-w-0 opacity-0' : 'max-w-[12rem] opacity-100',
      )}
    >
      {itemLabel}
    </span>
  );

  if (!item.to) {
    return (
      <Button
        type="button"
        variant="ghost"
        disabled
        aria-label={t('navigation.itemUnavailable', { label: itemLabel })}
        title={t('navigation.unavailable')}
        className="min-h-11 min-w-11 shrink-0 justify-start rounded-md px-3 text-sidebar-disabled"
      >
        <item.icon
          data-icon="inline-start"
          aria-hidden="true"
          size={18}
          strokeWidth={1.5}
        />
        {label}
      </Button>
    );
  }

  return (
    <NavLink
      aria-label={itemLabel}
      title={collapsed ? itemLabel : undefined}
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) => linkClass(isActive)}
    >
      {({ isActive }) => (
        <>
          <item.icon
            aria-hidden="true"
            size={18}
            strokeWidth={1.5}
            className={cn(
              isActive ? 'text-sidebar-indicator' : 'text-sidebar-icon',
            )}
          />
          {label}
        </>
      )}
    </NavLink>
  );
}

export function AppSidebar({
  collapsed,
  variant = 'desktop',
  onNavigate,
}: AppSidebarProps) {
  const permissions = useAuthStore((state) => state.user?.permissions);
  const roleCode = useAuthStore((state) => state.user?.roleCode);
  const items = visibleNavItems(permissions, roleCode);
  const { t } = useLanguage();
  const isDrawer = variant === 'drawer';
  const showCollapsed = isDrawer ? false : collapsed;
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => item.group === group.id),
  })).filter((group) => group.items.length > 0);

  return (
    <aside
      data-variant={variant}
      className={cn(
        'overflow-hidden border-sidebar-hover bg-sidebar text-sidebar-foreground',
        isDrawer
          ? 'flex h-full w-full flex-col'
          : 'hidden min-h-dvh shrink-0 flex-col border-r lg:sticky lg:top-0 lg:flex lg:h-dvh lg:self-start lg:transition-[width] lg:duration-200 motion-reduce:transition-none',
        !isDrawer && (collapsed ? 'lg:w-[72px]' : 'lg:w-[232px]'),
      )}
    >
      <BrandMark collapsed={showCollapsed} />
      <nav
        aria-label={t('navigation.label')}
        className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2"
      >
        {showCollapsed ? (
          visibleGroups.map((group, groupIndex) => (
            <div
              key={group.id}
              className={cn('flex flex-col gap-1', groupIndex > 0 && 'mt-2')}
            >
              {group.items.map((item) => (
                <NavEntry
                  key={item.labelKey}
                  item={item}
                  collapsed
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          ))
        ) : visibleGroups.length > 0 ? (
          <BranchedNav
            groups={visibleGroups}
            rowHeight={BRANCHED_ROW_HEIGHT[variant]}
            onNavigate={onNavigate}
          />
        ) : null}
      </nav>
    </aside>
  );
}
