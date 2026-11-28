import { Link } from 'react-router-dom';

import { buttonVariants } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';

export function NotFoundPage() {
  const { t } = useLanguage();
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-5 py-16 text-center sm:py-24">
      <h1 className="text-heading font-semibold sm:text-display">{t('common.notFound.title')}</h1>
      <p className="text-body text-muted-foreground">{t('common.notFound.description')}</p>
      <Link to="/" className={buttonVariants()}>
        {t('common.notFound.backHome')}
      </Link>
    </section>
  );
}
