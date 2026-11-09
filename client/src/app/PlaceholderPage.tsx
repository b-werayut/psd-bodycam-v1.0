import { PageHeader } from '@/components/command-center';
import type { TranslationKey } from '@/i18n/locales/th';
import { useLanguage } from '@/i18n/useLanguage';

// Stub for routes whose feature page is built in a later phase.
export function PlaceholderPage({ titleKey }: { titleKey: TranslationKey }) {
  const { t } = useLanguage();
  return <PageHeader title={t(titleKey)} />;
}
