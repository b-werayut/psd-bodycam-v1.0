/** Username/password login is on unless AUTH_PASSWORD_LOGIN_ENABLED=false. */
export function isPasswordLoginEnabled(env: NodeJS.ProcessEnv): boolean {
  return (env.AUTH_PASSWORD_LOGIN_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}
