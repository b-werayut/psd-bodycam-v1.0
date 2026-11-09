import { useId } from 'react';
import { useRouteError } from 'react-router-dom';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/useLanguage';

/**
 * `nested`: a child-route error. It renders inside AppLayout's `<main>`, so it is a labelled
 * `<section>` and not a second full-height `<main>`. Root-level errors (no shell) keep `<main>`.
 */
export function RouteErrorPage({ nested = false }: { nested?: boolean }) {
  const error = useRouteError();
  const { t } = useLanguage();
  const titleId = useId();
  if (import.meta.env.DEV) console.error(error);

  const Landmark = nested ? 'section' : 'main';

  return (
    <Landmark
      aria-labelledby={nested ? titleId : undefined}
      className={cn(
        'mx-auto flex w-full max-w-xl flex-col gap-4',
        nested ? 'py-8 sm:py-16' : 'min-h-screen justify-center p-6',
      )}
    >
      <Alert variant="destructive">
        <AlertTitle id={titleId}>{t('common.routeError.title')}</AlertTitle>
        <AlertDescription>{t('common.routeError.description')}</AlertDescription>
      </Alert>
      <Button onClick={() => window.location.reload()}>{t('common.routeError.reload')}</Button>
    </Landmark>
  );
}
