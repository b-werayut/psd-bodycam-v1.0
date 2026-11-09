import { Link } from 'react-router-dom';

import { buttonVariants } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';

export function NotFoundPage() {
  const { t } = useLanguage();
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-display font-bold tracking-[-0.025em]">{t('common.notFound.title')}</h1>
      <p className="text-body text-muted-foreground">{t('common.notFound.description')}</p>
      <Link to="/" className={buttonVariants()}>
        {t('common.notFound.backHome')}
      </Link>
    </section>
  );
}
