import { Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/useTheme';

export function ThemeToggle() {
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const dark = theme === 'dark';
  const label = t(dark ? 'theme.switchToLight' : 'theme.switchToDark');

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label={label}
      title={label}
      onClick={toggleTheme}
      className="size-10 shrink-0 rounded-full [@media(pointer:coarse)]:size-11"
    >
      {dark ? (
        <Moon data-icon="inline-start" aria-hidden="true" size={18} strokeWidth={1.5} />
      ) : (
        <Sun data-icon="inline-start" aria-hidden="true" size={18} strokeWidth={1.5} />
      )}
    </Button>
  );
}
