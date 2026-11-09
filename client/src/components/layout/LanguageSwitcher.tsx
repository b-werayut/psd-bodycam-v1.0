import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';
import { cn } from '@/lib/utils';

const LANGUAGE_OPTIONS = [
  {
    language: 'th',
    shortLabel: 'TH',
    selectedLabel: 'language.thaiSelected',
    actionLabel: 'language.switchToThai',
  },
  {
    language: 'en',
    shortLabel: 'EN',
    selectedLabel: 'language.englishSelected',
    actionLabel: 'language.switchToEnglish',
  },
] as const;

type LanguageSwitcherProps = {
  surface?: 'default' | 'glass';
};

export function LanguageSwitcher({ surface = 'default' }: LanguageSwitcherProps = {}) {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div
      role="group"
      aria-label={t('language.choose')}
      className="relative isolate flex shrink-0 items-center gap-0 rounded-full border border-border bg-muted p-px"
    >
      <span
        data-slot="language-indicator"
        data-language={language}
        data-surface={surface}
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute left-px top-px z-0 size-9 rounded-full bg-background shadow-[var(--shadow-low)] transition-transform duration-200 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none [@media(pointer:coarse)]:size-11',
          language === 'en'
            ? 'translate-x-9 [@media(pointer:coarse)]:translate-x-11'
            : 'translate-x-0',
        )}
      />
      {LANGUAGE_OPTIONS.map((option) => {
        const selected = language === option.language;
        const label = t(selected ? option.selectedLabel : option.actionLabel);

        return (
          <Button
            key={option.language}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={selected}
            title={label}
            onClick={() => setLanguage(option.language)}
            className={cn(
              'relative z-10 size-9 rounded-full bg-transparent p-0 text-xs shadow-none hover:bg-transparent active:bg-transparent focus-visible:ring-offset-0 [@media(pointer:coarse)]:size-11',
              selected
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.shortLabel}
          </Button>
        );
      })}
    </div>
  );
}
