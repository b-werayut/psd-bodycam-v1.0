import type { ComponentPropsWithoutRef } from 'react';

import psdDarkLogo from '@/assets/logo/psd-dark-login.png';
import psdLightLogo from '@/assets/logo/psd-light-login.png';
import { useTheme } from '@/theme/useTheme';

type ThemeLogoProps = Omit<ComponentPropsWithoutRef<'img'>, 'src'>;

export function ThemeLogo(props: ThemeLogoProps) {
  const { theme } = useTheme();

  return <img {...props} src={theme === 'dark' ? psdDarkLogo : psdLightLogo} />;
}
