import { backendMessage } from '@/lib/apiError';
import type { TranslationKey } from '@/i18n/locales/th';
import type { AuthConfig } from './auth.api';

export type LoginMethods = {
  sso: boolean;
  password: boolean;
  passwordOnly: boolean;
};

export function loginMethodsOf(config: AuthConfig | undefined): LoginMethods {
  const sso = config?.sso.enabled === true;
  const password = config ? config.passwordLogin.enabled : true;
  return { sso, password, passwordOnly: password && !sso };
}

export function isReturningFromAzure(location: { hash: string; search: string }): boolean {
  return /[#?&](code|error|id_token)=/.test(`${location.hash}${location.search}`);
}

export const TIMED_OUT = Symbol('timed-out');

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

export function isUserCancelled(error: unknown): boolean {
  const code = errorCodeOf(error);
  return code === 'user_cancelled' || code === 'access_denied';
}

export function errorCodeOf(error: unknown): string | null {
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  return typeof code === 'string' && code ? code : null;
}

export function isInteractionStuck(error: unknown): boolean {
  return errorCodeOf(error) === 'interaction_in_progress';
}

export type SignInError =
  | { message: string }
  | { key: TranslationKey; detail?: string };

export function aadstsCodeOf(error: unknown): string | null {
  const source = error as { errorMessage?: unknown; message?: unknown } | null;
  for (const text of [source?.errorMessage, source?.message]) {
    if (typeof text !== 'string') continue;
    const found = /AADSTS\d+/.exec(text);
    if (found) return found[0];
  }
  return null;
}

export function signInErrorOf(error: unknown): SignInError {
  const fromBackend = backendMessage(error);
  if (fromBackend) return { message: fromBackend };

  if (isInteractionStuck(error)) return { key: 'auth.ssoErrorStuck' };

  const code = errorCodeOf(error);
  if (code) {
    return {
      key: 'auth.ssoErrorMicrosoft',
      detail: aadstsCodeOf(error) ?? code,
    };
  }
  return { key: 'auth.errorUnavailable' };
}
