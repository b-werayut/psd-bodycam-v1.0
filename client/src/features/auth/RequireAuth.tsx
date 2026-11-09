import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';
import { refreshSession } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import { isReturningFromAzure } from './loginOptions';

/**
 * - `checking`: the boot refresh is running.
 * - `done`: the token decides the outcome (content, or `/login` when there is none).
 * - `unreachable`: the server could not answer, so we cannot know whether a session exists.
 *   Show retry instead of sending a possibly signed-in user to `/login`.
 */
type BootState = 'checking' | 'done' | 'unreachable';

export function RequireAuth({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [boot, setBoot] = useState<BootState>(accessToken ? 'done' : 'checking');
  const alive = useRef(true);
  const loc = useLocation();
  const { t } = useLanguage();

  // The Azure redirect response must reach the login page untouched; refreshing here would race it.
  const returningFromAzure = isReturningFromAzure(loc);

  const restore = useCallback(() => {
    setBoot('checking');
    void refreshSession()
      .then(
        (outcome): BootState => (outcome.kind === 'unreachable' ? 'unreachable' : 'done'),
        (): BootState => 'unreachable',
      )
      .then((next) => {
        if (alive.current) setBoot(next);
      });
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!accessToken && !returningFromAzure) restore();
    return () => {
      alive.current = false;
    };
    // Restore the session once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!accessToken && !returningFromAzure && boot === 'checking') {
    return (
      <div
        role="status"
        aria-label={t('auth.loadingSession')}
        className="flex min-h-screen items-center justify-center"
      >
        <Loader2 aria-hidden="true" className="size-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!accessToken && !returningFromAzure && boot === 'unreachable') {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center p-6">
        <Alert variant="destructive" feedbackScope="page">
          <AlertCircle aria-hidden="true" />
          <div>
            <AlertTitle>{t('auth.bootUnreachable.title')}</AlertTitle>
            <AlertDescription>{t('auth.bootUnreachable.description')}</AlertDescription>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 min-h-11"
              onClick={restore}
            >
              {t('common.retry')}
            </Button>
          </div>
        </Alert>
      </main>
    );
  }
  if (!accessToken) {
    return (
      <Navigate
        to={
          returningFromAzure
            ? { pathname: '/login', hash: loc.hash, search: loc.search }
            : { pathname: '/login' }
        }
        replace
        state={{
          from: returningFromAzure ? loc.pathname : `${loc.pathname}${loc.search}${loc.hash}`,
        }}
      />
    );
  }
  return <>{children}</>;
}
