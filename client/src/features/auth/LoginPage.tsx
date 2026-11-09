import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

import { ThemeLogo } from '@/components/ThemeLogo';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Toaster } from '@/components/ui/sonner';
import bodycamSecurityReferenceBackground from '@/assets/auth/bodycam-security-reference-background.jpg';
import { useLanguage } from '@/i18n/useLanguage';
import { resetRefreshState } from '@/lib/apiClient';
import { apiErrorOf } from '@/lib/apiError';
import { resetQueryCache } from '@/lib/queryClient';
import { useAppNavigate } from '@/lib/useAppNavigate';
import { useAuthStore } from '@/stores/authStore';
import { authApi, type AuthConfig, type LoginResp } from './auth.api';
import { resolveLoginDestination } from './loginDestination';
import {
  isReturningFromAzure,
  isUserCancelled,
  loginMethodsOf,
  signInErrorOf,
  TIMED_OUT,
  withTimeout,
  type SignInError,
} from './loginOptions';
import { MicrosoftMark } from './MicrosoftMark';
import { clearAzureSession, completeAzureSignIn, startAzureSignIn } from './msalClient';

const FIELD_BASE =
  'auth-glass-field h-[46px] rounded-lg border px-3.5 text-field transition-[background-color,border-color,box-shadow] duration-200 focus:outline-none focus:ring-[3px] focus:ring-ring/65 focus:ring-offset-2';
const FIELD_IDLE = 'border-input';
const FIELD_INVALID =
  'border-destructive/60 bg-destructive/5';

type Phase = 'preparing' | 'idle' | 'redirecting' | 'exchanging' | 'submitting';
type ConfigStatus = 'loading' | 'ready' | 'unavailable';

export function LoginPage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const currentUser = useAuthStore((state) => state.user);
  const setAuth = useAuthStore((state) => state.setAuth);
  const navigate = useAppNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const { t } = useLanguage();

  const [config, setConfig] = useState<AuthConfig | undefined>();
  const [configStatus, setConfigStatus] = useState<ConfigStatus>('loading');
  const [phase, setPhase] = useState<Phase>('preparing');
  const [error, setError] = useState<SignInError | null>(null);
  const [errorSource, setErrorSource] = useState<'sso' | 'password' | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // ระบบเป็นฝ่ายตัด session (ผู้ดูแลระงับบัญชี) -> ข้อความรอดข้าม clear() มาที่นี่
  // ⚠️ initializer ต้อง**อ่านอย่างเดียว** ห้ามเรียก consumeNotice() ตรงนี้ — StrictMode เรียกซ้ำ
  // รอบสองจะได้ null แล้ว React เก็บค่ารอบสองไว้ = ข้อความหายเงียบ ๆ เฉพาะตอนรันจริง (เทสต์ไม่เจอ)
  const [signedOutNotice] = useState(() => useAuthStore.getState().notice);
  useEffect(() => {
    if (signedOutNotice) useAuthStore.getState().consumeNotice();
  }, [signedOutNotice]);

  const destinationRef = useRef(location.state?.from ?? '/');
  const methods = loginMethodsOf(config);
  const noMethodsConfigured = Boolean(config && !methods.sso && !methods.password);
  const busy = phase !== 'idle';
  const showConfigFallback = configStatus !== 'ready' && phase === 'idle' && !config;

  useEffect(() => {
    document.title = 'PSD — Body Worn Camera';
  }, []);

  const finishSignIn = useCallback(
    (response: LoginResp, rawDestination?: string) => {
      const target = resolveLoginDestination(
        rawDestination ?? destinationRef.current,
        response.user.permissions,
        response.user.roleCode,
      );
      destinationRef.current = target.to;

      resetQueryCache();
      resetRefreshState();
      setAuth(response.accessToken, response.user);
      if (target.blocked) {
        useAuthStore.getState().setNotice({
          key: 'auth.destinationBlocked',
          params: { path: target.blockedFrom ?? '' },
        });
      }
      navigate(target.to, { replace: true });
    },
    [navigate, setAuth],
  );

  const bootstrapped = useRef(false);

  const prepareSignIn = useCallback(
    async (options?: { preservePasswordForm?: boolean }) => {
      setConfigStatus('loading');
      if (!options?.preservePasswordForm) setPhase('preparing');

      let loaded: AuthConfig;
      try {
        loaded = await authApi.config();
      } catch {
        setConfig(undefined);
        setConfigStatus('unavailable');
        setPhase('idle');
        return;
      }

      setConfig(loaded);
      setConfigStatus('ready');

      const sso = loaded.sso;
      if (!sso?.enabled || !isReturningFromAzure(window.location)) {
        setPhase('idle');
        return;
      }

      try {
        const result = await withTimeout(completeAzureSignIn(sso), 30_000);
        if (!result || result === TIMED_OUT) {
          setPhase('idle');
          return;
        }
        setPhase('exchanging');
        const response = await authApi.loginWithAzure(result.idToken);
        await clearAzureSession(sso);
        finishSignIn(response, result.state);
      } catch (cause) {
        await clearAzureSession(sso).catch(() => undefined);
        if (!isUserCancelled(cause)) {
          if (import.meta.env.DEV) console.error('[sso] แลก id_token ไม่สำเร็จ', cause);
          setError(signInErrorOf(cause));
          setErrorSource('sso');
        }
        setPhase('idle');
      }
    },
    [finishSignIn],
  );

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void prepareSignIn();
  }, [prepareSignIn]);

  const onAzureSignIn = useCallback(async () => {
    const sso = config?.sso;
    if (!sso?.enabled) return;
    setError(null);
    setErrorSource(null);
    setPhase('redirecting');
    try {
      const started = await withTimeout(startAzureSignIn(sso, destinationRef.current), 15_000);
      if (started === TIMED_OUT) {
        setError({ key: 'auth.ssoErrorMicrosoft' });
        setErrorSource('sso');
        setPhase('idle');
      }
    } catch (cause) {
      if (!isUserCancelled(cause)) {
        setError(signInErrorOf(cause));
        setErrorSource('sso');
      }
      setPhase('idle');
    }
  }, [config]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!username || !password) {
      setError({ key: 'auth.errorRequired' });
      setErrorSource('password');
      (!username ? usernameInputRef : passwordInputRef).current?.focus();
      return;
    }

    setError(null);
    setErrorSource(null);
    setPhase('submitting');

    try {
      const response = await authApi.login(username, password);
      finishSignIn(response);
    } catch (cause) {
      const info = apiErrorOf(cause, t);
      const rejected = info.status === 401 || info.status === 403;
      if (rejected && (info.code === null || info.code === 'INVALID_CREDENTIALS')) {
        setError({ key: 'auth.errorInvalid' });
      } else if (rejected && info.code) {
        // locked / disabled: the backend's own Thai message says what to do next
        setError({ message: info.message });
      } else {
        setError({ key: 'auth.errorUnavailable' });
      }
      setErrorSource('password');
      setPhase('idle');
    }
  };

  const clearCredentialError = () => {
    if (
      errorSource === 'password' &&
      error &&
      'key' in error &&
      error.key === 'auth.errorInvalid'
    ) {
      setError(null);
      setErrorSource(null);
    }
  };

  if (accessToken) {
    const target = resolveLoginDestination(
      destinationRef.current,
      currentUser?.permissions,
      currentUser?.roleCode,
    );
    return <Navigate to={target.to} replace />;
  }

  const errorText: string | null = error
    ? 'message' in error
      ? error.message
      : `${t(error.key)}${error.detail ? ` (${error.detail})` : ''}`
    : null;
  const hasRequiredError = error && 'key' in error && error.key === 'auth.errorRequired';
  const hasCredentialError = Boolean(
    errorSource === 'password' && error && 'key' in error && error.key === 'auth.errorInvalid',
  );
  const usernameRequired = Boolean(hasRequiredError && !username);
  const passwordRequired = Boolean(hasRequiredError && !password);
  const usernameInvalid = Boolean(usernameRequired || hasCredentialError);
  const passwordInvalid = Boolean(passwordRequired || hasCredentialError);
  const usernameFieldTone = usernameInvalid ? FIELD_INVALID : FIELD_IDLE;
  const passwordFieldTone = passwordInvalid ? FIELD_INVALID : FIELD_IDLE;
  const showSsoError = Boolean(errorText && errorSource === 'sso');
  const showPasswordError = Boolean(
    errorText && errorSource === 'password' && !hasRequiredError,
  );

  return (
    <main
      className="auth-login-page operations-theme relative isolate grid min-h-dvh min-w-0 grid-rows-[auto_1fr] overflow-x-hidden overflow-y-auto px-5 text-foreground sm:px-6"
    >
      <img
        data-slot="auth-security-backdrop"
        data-visual="reference-security-blue"
        src={bodycamSecurityReferenceBackground}
        alt=""
        aria-hidden="true"
        className="auth-security-backdrop auth-security-backdrop--theme-responsive"
      />
      <div
        data-slot="auth-security-gradient"
        aria-hidden="true"
        className="auth-security-gradient"
      />

      <div className="relative z-10 flex items-center justify-end">
        <div
          role="group"
          aria-label={t('auth.utilityControls')}
          data-slot="auth-utility-dock"
          className="auth-utility-dock"
        >
          <div className="auth-utility-dock__language">
            <LanguageSwitcher surface="glass" />
          </div>
          <Separator
            orientation="vertical"
            className="auth-utility-dock__separator mx-0.5 h-6"
          />
          <div className="auth-utility-dock__theme">
            <ThemeToggle />
          </div>
        </div>
      </div>

      <div className="auth-login-stage relative z-10 flex min-h-0 min-w-0 items-center justify-center">
        <section
          role="region"
          aria-labelledby="login-title"
          className="auth-glass-panel auth-glass-panel--clear auth-login-card auth-login-card--premium auth-login-card--thin-glass min-w-0 w-full max-w-[430px] overflow-hidden rounded-2xl border backdrop-blur-2xl backdrop-saturate-150"
        >
          <div className="auth-login-card-body px-6 sm:px-8">
            <header className="auth-login-card-header text-center">
              <span className="auth-login-brand mx-auto mb-4 flex h-16 w-40 items-center justify-center p-3 [@media(max-height:780px)]:mb-2 [@media(max-height:780px)]:h-14">
                <ThemeLogo
                  alt="PSD Sentinel"
                  width={932}
                  height={235}
                  className="h-auto w-full object-contain"
                />
              </span>
              <h1
                id="login-title"
                className="auth-login-title text-balance font-semibold"
              >
                Body Worn Camera
              </h1>
              <p className="auth-login-description mx-auto mt-2 text-balance font-medium text-muted-foreground">
                {t('auth.signInDescription')}
              </p>
            </header>

            {signedOutNotice ? (
              <Alert
                data-slot="signed-out-notice"
                variant="destructive"
                feedbackScope="page"
                className="mb-5"
              >
                <AlertCircle className="size-4" aria-hidden="true" />
                <AlertDescription className="text-body">
                  {t(signedOutNotice.key, signedOutNotice.params)}
                </AlertDescription>
              </Alert>
            ) : null}

            {phase === 'preparing' || phase === 'exchanging' ? (
              <div
                role="status"
                className="flex min-h-36 flex-col items-center justify-center gap-3 text-body font-medium text-muted-foreground"
              >
                <Loader2
                  className="size-5 animate-spin text-primary motion-reduce:animate-none"
                  aria-hidden="true"
                />
                {t(phase === 'exchanging' ? 'auth.ssoVerifying' : 'auth.preparing')}
              </div>
            ) : (
              <div className="auth-login-content flex flex-col">
                {showConfigFallback ? (
                  <Alert
                    data-slot="auth-config-fallback"
                    feedbackScope="form"
                    className="auth-config-alert"
                  >
                    <AlertCircle className="size-4" aria-hidden="true" />
                    <AlertDescription className="flex min-w-0 flex-col gap-3 text-body">
                      <span>{t('auth.configUnavailable')}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="self-start"
                        disabled={configStatus === 'loading'}
                        onClick={() => void prepareSignIn({ preservePasswordForm: true })}
                      >
                        <RefreshCw
                          data-icon="inline-start"
                          className={
                            configStatus === 'loading'
                              ? 'animate-spin motion-reduce:animate-none'
                              : undefined
                          }
                          aria-hidden="true"
                        />
                        {t(configStatus === 'loading' ? 'auth.configRetrying' : 'common.retry')}
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : null}

                {noMethodsConfigured ? (
                  <Alert data-slot="auth-no-methods" feedbackScope="form">
                    <AlertCircle className="size-4" aria-hidden="true" />
                    <AlertDescription className="flex min-w-0 flex-col gap-3 text-body">
                      <span>{t('auth.noMethodsAvailable')}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="self-start"
                        disabled={configStatus === 'loading'}
                        onClick={() => void prepareSignIn({ preservePasswordForm: true })}
                      >
                        <RefreshCw
                          data-icon="inline-start"
                          className={
                            configStatus === 'loading'
                              ? 'animate-spin motion-reduce:animate-none'
                              : undefined
                          }
                          aria-hidden="true"
                        />
                        {t(configStatus === 'loading' ? 'auth.configRetrying' : 'common.retry')}
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : null}

                {methods.sso ? (
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      onClick={() => void onAzureSignIn()}
                      disabled={busy}
                      className="auth-glass-secondary-action h-auto min-h-12 w-full whitespace-normal px-4 py-3"
                    >
                      {phase === 'redirecting' ? (
                        <>
                          <Loader2
                            data-icon="inline-start"
                            className="animate-spin motion-reduce:animate-none"
                            aria-hidden="true"
                          />
                          {t('auth.ssoConnecting')}
                        </>
                      ) : (
                        <>
                          <span data-icon="inline-start" aria-hidden="true">
                            <MicrosoftMark className="size-[18px]" />
                          </span>
                          {t('auth.ssoButton')}
                        </>
                      )}
                    </Button>
                    {showSsoError ? (
                      <Alert id="login-error" variant="destructive" feedbackScope="form">
                        <AlertCircle className="size-4" aria-hidden="true" />
                        <AlertDescription className="text-body">{errorText}</AlertDescription>
                      </Alert>
                    ) : null}
                    <p className="text-center text-caption font-medium text-muted-foreground">
                      {t('auth.ssoHint')}
                    </p>
                  </div>
                ) : null}

                {methods.sso && methods.password ? (
                  <div className="flex items-center gap-3" aria-hidden="true">
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-caption font-semibold text-muted-foreground">
                      {t('auth.dividerOr')}
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                ) : null}

                {methods.password ? (
                  <form
                    id="password-form"
                    onSubmit={onSubmit}
                    className="auth-login-password-form flex flex-col"
                    noValidate
                  >
                    {showPasswordError ? (
                      <Alert id="login-error" variant="destructive" feedbackScope="form">
                        <AlertCircle className="size-4" aria-hidden="true" />
                        <AlertDescription className="text-body">{errorText}</AlertDescription>
                      </Alert>
                    ) : null}

                    <FieldGroup>
                      <Field data-invalid={usernameRequired || undefined}>
                        <FieldLabel htmlFor="username">{t('auth.username')}</FieldLabel>
                        <Input
                          ref={usernameInputRef}
                          id="username"
                          name="username"
                          placeholder={t('auth.usernamePlaceholder')}
                          required
                          autoFocus={methods.passwordOnly}
                          autoComplete="username"
                          autoCapitalize="none"
                          spellCheck={false}
                          value={username}
                          onChange={(event) => {
                            setUsername(event.target.value);
                            clearCredentialError();
                          }}
                          disabled={busy}
                          aria-invalid={usernameInvalid}
                          aria-describedby={
                            usernameRequired
                              ? 'username-error'
                              : hasCredentialError
                                ? 'login-error'
                                : undefined
                          }
                          className={`${FIELD_BASE} ${usernameFieldTone}`}
                        />
                        <FieldError id="username-error">
                          {usernameRequired ? t('auth.errorUsernameRequired') : null}
                        </FieldError>
                      </Field>

                      <Field data-invalid={passwordRequired || undefined}>
                        <FieldLabel htmlFor="password">{t('auth.password')}</FieldLabel>
                        <div className="relative">
                          <Input
                            ref={passwordInputRef}
                            id="password"
                            name="password"
                            placeholder={t('auth.passwordPlaceholder')}
                            required
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="current-password"
                            value={password}
                            onChange={(event) => {
                              setPassword(event.target.value);
                              clearCredentialError();
                            }}
                            disabled={busy}
                            aria-invalid={passwordInvalid}
                            aria-describedby={
                              passwordRequired
                                ? 'password-error'
                                : hasCredentialError
                                  ? 'login-error'
                                  : undefined
                            }
                            className={`${FIELD_BASE} ${passwordFieldTone} pr-12`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((visible) => !visible)}
                            aria-label={t(
                              showPassword ? 'auth.hidePassword' : 'auth.showPassword',
                            )}
                            className="absolute right-0.5 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {showPassword ? (
                              <Eye className="size-4" aria-hidden="true" />
                            ) : (
                              <EyeOff className="size-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                        <FieldError id="password-error">
                          {passwordRequired ? t('auth.errorPasswordRequired') : null}
                        </FieldError>
                      </Field>
                    </FieldGroup>

                    <Button
                      type="submit"
                      variant="auth"
                      size="xl"
                      disabled={busy}
                      className="w-full"
                    >
                      {phase === 'submitting' ? (
                        <>
                          <Loader2
                            data-icon="inline-start"
                            className="animate-spin motion-reduce:animate-none"
                            aria-hidden="true"
                          />
                          {t('auth.signingIn')}
                        </>
                      ) : (
                        <>
                          {t('auth.signIn')}
                          <ArrowRight
                            data-icon="inline-end"
                            aria-hidden="true"
                          />
                        </>
                      )}
                    </Button>
                  </form>
                ) : null}
              </div>
            )}
          </div>

          <footer className="auth-login-card-footer flex items-start gap-2 border-t border-white/35 bg-card/20 px-6 sm:px-8">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-caption font-medium leading-5 text-muted-foreground">
              <span>{t('auth.auditScope')}</span>
              <span className="hidden sm:inline" aria-hidden="true">
                {' · '}
              </span>
              <span className="block text-balance sm:inline">
                {t('auth.auditDetail')}
              </span>
            </p>
          </footer>
        </section>
      </div>
      {/* Toasts raised on the way out (e.g. logout that could not reach the server) land here;
          AppLayout's Toaster unmounts with the signed-in shell. */}
      <Toaster />
    </main>
  );
}
