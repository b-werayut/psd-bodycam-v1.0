import type { Translate } from '@/i18n/LanguageProvider';
import { apiErrorOf } from './apiError';

/**
 * Description for a page's failed-load `AsyncState`. Shows the backend `message` (Thai) as-is.
 * Asks the user to check the connection only when no response arrived. A response without a
 * message gets the generic copy.
 */
export function queryErrorDescription(error: unknown, t: Translate): string {
  const info = apiErrorOf(error, t);
  return info.isNetwork ? t('common.checkConnection') : info.message;
}
