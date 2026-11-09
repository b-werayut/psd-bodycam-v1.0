const NON_REFRESHABLE = [
  '/auth/login',
  '/auth/refresh',
  '/auth/azure',
  '/auth/config',
  '/auth/logout',
];

export function isAuthEndpoint(url: string | undefined): boolean {
  if (!url) return false;
  return NON_REFRESHABLE.some((path) => url.includes(path));
}
