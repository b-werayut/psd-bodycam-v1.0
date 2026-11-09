import type { AuthenticationResult, IPublicClientApplication } from '@azure/msal-browser';

import type { AuthConfig } from './auth.api';
import { isInteractionStuck } from './loginOptions';

export const AZURE_SCOPES = ['openid', 'profile', 'email'];

const HANDLE_IN_PLACE = { navigateToLoginRequestUrl: false } as const;

type EnabledSso = Extract<AuthConfig['sso'], { enabled: true }>;

let instance: Promise<IPublicClientApplication> | null = null;

export function getMsal(sso: EnabledSso): Promise<IPublicClientApplication> {
  instance ??= (async () => {
    const { PublicClientApplication } = await import('@azure/msal-browser');
    const app = new PublicClientApplication({
      auth: {
        clientId: sso.clientId,
        authority: sso.authority,
        redirectUri: window.location.origin,
        postLogoutRedirectUri: window.location.origin,
      },
      cache: {
        cacheLocation: 'sessionStorage',
      },
    });
    await app.initialize();
    return app;
  })();
  return instance;
}

export async function startAzureSignIn(sso: EnabledSso, destination: string): Promise<void> {
  const app = await getMsal(sso);
  const request = { scopes: AZURE_SCOPES, state: destination };
  try {
    await app.loginRedirect(request);
  } catch (cause) {
    if (!isInteractionStuck(cause)) throw cause;
    await app.handleRedirectPromise(HANDLE_IN_PLACE).catch(() => undefined);
    await app.loginRedirect(request);
  }
}

export async function completeAzureSignIn(
  sso: EnabledSso,
): Promise<AuthenticationResult | null> {
  const app = await getMsal(sso);
  return app.handleRedirectPromise(HANDLE_IN_PLACE);
}

export async function clearAzureSession(sso: EnabledSso): Promise<void> {
  const app = await getMsal(sso);
  for (const account of app.getAllAccounts()) {
    app.clearCache({ account }).catch(() => undefined);
  }
}
