import {
  Building2,
  ChevronDown,
  LogOut,
  Menu,
  Shield,
  UserRound,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { actionToast } from '@/components/ui/action-toast';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DialogTrigger } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { authApi } from '@/features/auth/auth.api';
import { resetRefreshState, waitForPendingRefresh } from '@/lib/apiClient';
import { resetQueryCache } from '@/lib/queryClient';
import { formatDayMonth, formatTime } from '@/lib/time';
import { useAppNavigate } from '@/lib/useAppNavigate';
import { useAuthStore } from '@/stores/authStore';
import { useLanguage } from '@/i18n/useLanguage';
import { Breadcrumb } from './Breadcrumb';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeToggle } from './ThemeToggle';

export type AppHeaderProps = {
  collapsed: boolean;
  onToggleSidebar: () => void;
};

function HeaderClock() {
  const { language } = useLanguage();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const updateNow = () => setNow(new Date());
    const intervalId = window.setInterval(updateNow, 30_000);
    window.addEventListener('focus', updateNow);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', updateNow);
    };
  }, []);

  const time = formatTime(now, language);
  const date = formatDayMonth(now, language);

  return (
    <time
      role="timer"
      dateTime={now.toISOString()}
      className="hidden h-10 shrink-0 items-center gap-2 rounded-full bg-secondary px-3 md:flex"
    >
      <span className="text-sm font-semibold tabular-nums text-foreground">{time}</span>
      <span className="text-xs text-muted-foreground">{date}</span>
    </time>
  );
}

export function AppHeader({
  collapsed,
  onToggleSidebar,
}: AppHeaderProps) {
  const user = useAuthStore((state) => state.user);
  const clear = useAuthStore((state) => state.clear);
  const navigate = useAppNavigate();
  const { t } = useLanguage();
  const roleName = user?.roleName || user?.roleCode || '';
  const fullName = user?.fullName?.trim() ?? '';
  const displayName = fullName || user?.username || t('header.userFallback');
  const initial = Array.from(displayName)[0]?.toLocaleUpperCase() ?? '?';
  const emailLine = user?.email?.trim() || '-';
  const departmentName = user?.departmentName?.trim() || null;

  const loggingOut = useRef(false);
  const onLogout = async () => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    // A refresh still in flight rotates the cookie. Logging out alongside it would revoke the old
    // cookie and leave the rotated one alive, so wait, then send the token it produced.
    await waitForPendingRefresh();
    const token = useAuthStore.getState().accessToken;
    let serverSignedOut = true;
    try {
      await authApi.logout(token);
    } catch {
      serverSignedOut = false;
    }
    // Always sign out locally. If the server was not told, say so: the toast now, and the notice
    // as a persistent Alert on the login page.
    clear(serverSignedOut ? undefined : { key: 'auth.logoutServerFailed' });
    resetRefreshState();
    resetQueryCache();
    if (!serverSignedOut) {
      actionToast.error(t('header.logoutFailedTitle'), t('auth.logoutServerFailed'));
    }
    navigate('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-header flex min-h-14 items-center gap-3 border-b border-border bg-background px-3 sm:px-5">
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('header.openMenu')}
          className="size-10 lg:hidden [@media(pointer:coarse)]:size-11"
        >
          <Menu data-icon="inline-start" aria-hidden="true" size={18} strokeWidth={1.5} />
        </Button>
      </DialogTrigger>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t(collapsed ? 'header.expandSidebar' : 'header.collapseSidebar')}
        onClick={onToggleSidebar}
        className="hidden size-10 lg:inline-flex [@media(pointer:coarse)]:size-11"
      >
        <Menu data-icon="inline-start" aria-hidden="true" size={18} strokeWidth={1.5} />
      </Button>
      <Breadcrumb />
      <div className="flex-1" />
      <div className="flex shrink-0 items-center gap-1.5">
        <HeaderClock />
        <LanguageSwitcher />
        <ThemeToggle />
        <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-border sm:block" />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('header.userMenu', { username: user?.username ?? '' })}
            className="group flex min-h-10 items-center gap-2.5 rounded-lg py-0.5 pl-1.5 pr-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:ml-1 [@media(pointer:coarse)]:min-h-11"
          >
            <Avatar className="size-8 [@media(pointer:coarse)]:size-9">
              <AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">
                {initial}
              </AvatarFallback>
            </Avatar>
            <span className="hidden min-w-0 max-w-[12rem] text-left leading-tight lg:block">
              <span className="block truncate font-semibold">{displayName}</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {emailLine}
              </span>
            </span>
            <ChevronDown
              aria-hidden="true"
              size={16}
              strokeWidth={1.5}
              className="hidden shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 lg:block"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="operations-theme w-64 max-w-[calc(100vw-1.5rem)] rounded-xl p-1.5"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col gap-2 py-2 font-normal [&_svg]:size-4 [&_svg]:shrink-0">
              <span className="flex min-w-0 items-center gap-2">
                <UserRound aria-hidden="true" size={16} strokeWidth={1.5} />
                <span className="truncate">
                  {displayName}
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <Shield aria-hidden="true" size={16} strokeWidth={1.5} />
                <span className="truncate">{roleName}</span>
              </span>
              {departmentName ? (
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <Building2 aria-hidden="true" size={16} strokeWidth={1.5} />
                  <span className="truncate">{departmentName}</span>
                </span>
              ) : null}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => void onLogout()}
              className="min-h-11 text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <LogOut aria-hidden="true" size={16} strokeWidth={1.5} />
              {t('header.logout')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
