# P0 Client Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `client/` — Vite + React app with the reference design system, i18n, auth (password + Entra), permission-aware routing and navigation, app shell, realtime provider, and the P0 admin pages (users & roles, departments, employees, settings, audit log) against the P0 server API.

**Architecture:** Feature-based React 18 SPA ported from the reference `C:\Git\Internal-BodyCam\client` (design tokens, `components/ui`, `components/command-center`, shell, `lib/apiClient`), with company/vehicle/dashcam concepts removed, a typed permission hook, a real 404/error route, and locale files split per feature. Server state via TanStack Query; auth state in Zustand.

**Tech Stack:** React ^18.3.1, Vite ^6.4.1, TypeScript ^5.5.3 (strict), Tailwind ^3.4.19 + tailwindcss-animate ^1.0.7, Radix (avatar, checkbox, dialog, dropdown-menu, label, popover, separator, slot, tabs — versions as reference), react-router-dom ^7.18.3, @tanstack/react-query ^5.51.0, zustand ^4.5.0, axios ^1.7.0, socket.io-client ^4.7.5, @azure/msal-browser ^5.18.0, sonner ^2.0.8, motion ^12.43.0, lucide-react ^1.24.0, @fontsource-variable/noto-sans-thai ^5.3.0, date-fns ^4.4.0, react-day-picker ^10.0.2, class-variance-authority ^0.7.1, clsx ^2.1.1, tailwind-merge ^3.6.0; Vitest ^5.0.0 + jsdom ^24.1.3 + Testing Library (react ^16.3.2, user-event ^14.6.1, jest-dom ^6.9.1); eslint ^9.14.0 + typescript-eslint ^8.13.0 + eslint-plugin-react-hooks ^5.0.0.

**Spec:** `docs/blueprint/06-frontend-architecture.md` (§6.1–§6.6, §6.8, §6.9), `docs/blueprint/05-api-design.md` (§5.1, §5.2 Auth/Users/Org, §5.5, §5.7), `docs/blueprint/08-implementation-roadmap.md` (P0). Server contract: `docs/superpowers/plans/2026-11-04-p0-server-foundation.md` (Tasks 8, 9, 11, 12, 13).

## Global Constraints

- Reference `C:\Git\Internal-BodyCam` is **read-only** — copy code out, never write there.
- All code under `client/`; run commands from `client/`.
- Keep the reference design system exactly: OKLCH tokens in `src/styles/tailwind.css`, `tailwind.config.cjs`, `client/DESIGN.md` rules (one primary action per view, color always paired with text/icon, border before shadow, radius 6–8px, targets ≥ 44px, row tools 3+ actions ⇒ `•••` `RowActionsMenu`, disabled controls show their reason, empty ≠ filtered-empty, success = toast, failure = toast + persistent `Alert`).
- Copy `client/DESIGN.md` from the reference into `client/DESIGN.md` unchanged (it is the design rulebook).
- UI text Thai by default (`th`), English second (`en`); never hard-code UI strings — use `t('…')`.
- One toast system: **sonner** (`components/ui/sonner.tsx`, `action-toast.tsx`). Do not port the Radix `toast.tsx`.
- API base `VITE_API_BASE ?? '/api'`; all request/response JSON camelCase; ids are strings; backend error body `{ statusCode, code, message, details?, correlationId }` — show `message` (Thai) as-is.
- Permissions are checked only through `usePermission` / `<Can>` / `canEnter` — no `permissions.includes(...)` in components.
- `npm run build` = `tsc --noEmit && vite build`; `npm run lint` must pass.
- The user has been committing manually — **ask before each commit**, or batch at the end of a task if told to.

## Review Focus

1. **Several API calls get 401 at the same time** (token expired while a page loads 3 queries) → exactly one `/auth/refresh`, all three retried. (Task 5: test.)
2. **Refresh fails because the session was revoked** → store cleared, user sent to `/login` with the Thai notice, no request loop. (Task 5 + Task 7: tests.)
3. **Deep link to a page the user lacks permission for** (`/settings` as OPERATOR, before login) → after login lands on `/` and sees the "no access" notice instead of a broken page. (Task 6: test.)
4. **Phone-width viewport** → sidebar becomes a drawer opened from the header; every interactive control ≥ 44px on coarse pointers. (Task 8: test.)
5. **Network down or server returns an error without a Thai message** → user sees a Thai fallback (`common.error.network` / `common.error.generic`) with retry, never raw "Network Error" / English stack. (Task 5: test.)

---

### Task 1: Client scaffold, test setup, lint

**Files:**
- Create: `client/package.json`, `client/vite.config.ts`, `client/tsconfig.json`, `client/tsconfig.node.json`, `client/postcss.config.cjs`, `client/components.json`, `client/index.html`, `client/eslint.config.mjs`, `client/.env.example`, `client/.gitignore`, `client/src/vite-env.d.ts`, `client/src/main.tsx`, `client/src/App.tsx` (temporary), `client/src/test/setup.ts`, `client/src/test/deferred.ts`, `client/DESIGN.md`
- Test: `client/src/test/setup.test.ts`

**Interfaces:**
- Produces: alias `@/*` → `src/*`; `deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void }`; test setup that blocks real XHR (`[test setup] real network request blocked: METHOD URL`), clears storage after each test, stubs `ResizeObserver`, pointer capture, `matchMedia`, `HTMLCanvasElement.getContext`.

- [ ] **Step 1: Create config.** `package.json` (`"type": "module"`, scripts `dev`, `build` = `tsc --noEmit && vite build`, `typecheck`, `lint` = `eslint src`, `test` = `vitest run`, `preview`; dependencies = Tech Stack only — no echarts, hls.js, leaflet, react-leaflet, @boxicons/react, @fontsource/kanit, @fontsource/ibm-plex-sans in P0). `vite.config.ts` = reference minus the `/api/talk/ws` proxy (keep the ws-proxy-noise logger, `/api` and `/socket.io` proxies to `http://localhost:3000`, vitest `environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`, `css: true`). `tsconfig*.json`, `postcss.config.cjs`, `components.json` = reference verbatim. `index.html` = reference with title `PSD — Body Worn Camera`, `lang="th"`, the inline theme script (storage key `bodycam.theme`). `src/vite-env.d.ts` declares `ImportMetaEnv { readonly VITE_API_BASE?: string }`. ESLint flat config: typescript-eslint recommended + react-hooks, plus `no-restricted-syntax` banning `MemberExpression[property.name='includes'][object.property.name='permissions']` with message `use usePermission()`.
- [ ] **Step 2: Write the failing test**

```ts
// src/test/setup.test.ts
it('blocks real network requests', () => {
  const xhr = new XMLHttpRequest(); xhr.open('GET', '/api/x');
  expect(() => xhr.send()).toThrow('[test setup] real network request blocked: GET /api/x');
});
it('clears localStorage between tests (part 1)', () => { localStorage.setItem('k', 'v'); });
it('clears localStorage between tests (part 2)', () => { expect(localStorage.getItem('k')).toBeNull(); });
```

- [ ] **Step 3: Run** `npx vitest run src/test/setup.test.ts` — Expected: FAIL (no setup). **Step 4: Port** `src/test/setup.ts` from reference (drop the WorkOrdersPage comment) and `deferred` from `talkFakes.ts`. **Step 5: Run** test, `npm run lint`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 6: Commit** `chore(client): scaffold Vite React app with test setup and lint`

### Task 2: Design tokens, base styles, design guard tests

**Files:**
- Create: `client/tailwind.config.cjs`, `client/src/styles/tailwind.css`, `client/src/styles/global.css`, `client/src/lib/utils.ts`
- Create (assets): `client/src/assets/logo/*`, `client/src/assets/auth/*` (copy the reference files used by `BrandMark`, `ThemeLogo`, favicon, login background)
- Test: `client/src/styles/design-foundation.test.ts`, `client/src/styles/design-system-source-rules.test.ts`, `client/src/styles/tailwind.test.ts`, `client/src/styles/theme-tokens.test.ts`, `client/src/favicon.test.ts`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` (tailwind-merge extended with the 7 semantic font sizes `text-caption|control|body|field|subheading|heading|display`); all CSS custom properties of the reference `:root` / `.dark` blocks; global generic classes `.nwl-mono`, `.scrollbar-none`, `.nwl-skeleton-shimmer`, `.branched-nav*`.

- [ ] **Step 1: Port the guard tests** with path changes: `design-foundation.test.ts` (generic rule only: no `text-[(10|11|13|15|17|19)px]` in `src/**/*.tsx`; drop the reports-specific asserts), `design-system-source-rules.test.ts` (generic `components/ui` asserts only; drop devices/users dialog asserts), `tailwind.test.ts` (reduced-motion rule), and move reference `features/dashboard/operations-theme.test.ts` to `src/styles/theme-tokens.test.ts` (contrast of the 16 role tokens light/dark, shadcn→role mappings, Noto Sans Thai dependency + import, fontSize entries). `favicon.test.ts` verbatim.
- [ ] **Step 2: Run** `npx vitest run src/styles src/favicon.test.ts` — Expected: FAIL (files missing).
- [ ] **Step 3: Copy** `tailwind.config.cjs` and `src/styles/tailwind.css` from reference **verbatim** (keep `.auth-*` — the login page is ported in Task 7). `global.css` = reference lines for element styles, scrollbar, `::selection`, `.nwl-mono`, `.scrollbar-none`, `.nwl-skeleton-shimmer` + keyframes, reduced-motion, `.branched-nav*`; **omit** `.work-order-id`, `.stream-stage*`, `.tracking-*`, `.route-*`, `.wo-location-*`, `.leaflet-container`, `.voice-pill*` (their features port them later). `lib/utils.ts` verbatim. `main.tsx` imports `./styles/tailwind.css`, `@fontsource-variable/noto-sans-thai`, `./styles/global.css` in that order.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(client): design tokens, base styles and design guard tests`

### Task 3: i18n, theme and motion providers

**Files:**
- Create: `client/src/i18n/types.ts`, `translate.ts`, `LanguageProvider.tsx`, `useLanguage.ts`, `client/src/i18n/locales/th/index.ts` + `th/common.ts`, `th/app.ts`, `th/auth.ts`, `th/navigation.ts`, `th/permission.ts`; same files under `locales/en/`
- Create: `client/src/theme/types.ts`, `theme-storage.ts`, `ThemeProvider.tsx`, `useTheme.ts`; `client/src/components/motion/MotionProvider.tsx`, `PageTransition.tsx`, `Stagger.tsx`; `client/src/lib/motion.ts`
- Test: `client/src/i18n/translate.test.ts`, `client/src/i18n/LanguageProvider.test.tsx`, `client/src/i18n/locales/parity.test.ts`, `client/src/theme/ThemeProvider.test.tsx`

**Interfaces:**
- Produces:
  - `SUPPORTED_LANGUAGES = ['th', 'en'] as const`; `type Language`; `type TranslationParams = Record<string, string | number>`.
  - `export const th = { ...common, ...app, ...auth, ...navigation, ...permission } as const` in `locales/th/index.ts`; `export type TranslationKey = keyof typeof th`; `export const en = {...} as const satisfies Record<TranslationKey, string>`. Each later feature adds `th/<feature>.ts` + `en/<feature>.ts` and spreads them into the index.
  - `translate(language, key, params?)` — `{name}` interpolation, falls back to the key.
  - `LanguageProvider`, `useLanguage(): { language; setLanguage(l); toggleLanguage(); t: Translate }` — storage key `bodycam.language`, default `th`, sets `document.documentElement.lang`, syncs via `storage` event.
  - `THEME_STORAGE_KEY = 'bodycam.theme'`; `ThemeProvider`, `useTheme(): { theme; setTheme(t); toggleTheme() }`.
  - Key prefixes in P0 locales: `app.`, `navigation.`, `breadcrumb.`, `header.`, `language.`, `theme.`, `auth.`, `permission.`, `common.` (incl. `common.pagination.*`, `common.loading`, `common.retry`, `common.error.network` = `ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบเครือข่าย`, `common.error.generic` = `เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง`, `common.notFound.title` = `ไม่พบหน้าที่ต้องการ`).

- [ ] **Step 1: Write failing tests** — `translate('th', 'common.loading')` returns the Thai string; interpolation `translate('en', 'common.pagination.pageOf', { page: 2, total: 5 })` contains `2` and `5`; unknown key returns the key; parity test: `Object.keys(en).sort()` equals `Object.keys(th).sort()` and no value is empty; LanguageProvider: `setLanguage('en')` writes `bodycam.language` and sets `<html lang="en">`; a `storage` event with `th` switches back; ThemeProvider: stored `dark` wins over system light and toggles `.dark` on `<html>`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Port** reference `src/i18n`, `src/theme`, motion files; copy only the P0 key prefixes from reference `th.ts`/`en.ts` into the split files; remove company keys (e.g. `header.allCompanies`). **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(client): i18n with per-feature locales, theme and motion providers`

### Task 4: UI primitives and command-center components

**Files:**
- Create: `client/src/components/ui/{button,alert,badge,avatar,card,checkbox,dialog,confirm-dialog,dropdown-menu,empty,field,form-field,input,textarea,select,label,popover,separator,skeleton,sonner,action-toast,table,tabs,search-select,searchSelectOptions,calendar,calendar-range-select,horizontal-scroll-region}.tsx|.ts`
- Create: `client/src/components/command-center/{AsyncState,DataPagination,DataPanel,DataTableFrame,DataToolbar,EntitySummary,LoadingSkeleton,MetricSummary,PageHeader,RowActionsMenu,StatusBadge,StatusStrip,ToolButton,index}.tsx|.ts`
- Test: `client/src/components/ui/design-system-controls.test.tsx`, `client/src/components/command-center/command-center-patterns.test.tsx`, `client/src/components/ui/search-select.test.tsx`

**Interfaces:**
- Produces: the reference exports with identical names and props (see reference files), except: no `toast.tsx`; no `DeviceIdentity` (device features add their own in P1). `StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'destructive'`; `RowActionItem { icon; label; reason?; tone?: 'neutral' | 'danger'; disabled?; onSelect }`; `useConfirm(): { ask(req: ConfirmRequest): void; dialog: ReactNode }`.

- [ ] **Step 1: Port the reference tests** `design-system-controls.test.tsx` and `command-center-patterns.test.tsx` (remove cases for `DeviceIdentity` and Radix toast) and the `search-select` tests.
- [ ] **Step 2: Run** — FAIL. **Step 3: Copy** the component files verbatim (replace any company/device wording in examples). **Step 4: Run** all tests + `npm run lint` — PASS; the Task 2 guard tests still pass with the new `.tsx` files.
- [ ] **Step 5: Commit** `feat(client): port UI primitives and command-center components`

### Task 5: API client, error messages, auth store, permissions

**Files:**
- Create: `client/src/lib/apiClient.ts`, `apiError.ts`, `authEndpoints.ts`, `queryClient.ts`, `paged.ts`, `usePermission.ts`, `client/src/components/Can.tsx`, `client/src/stores/authStore.ts`
- Test: `client/src/lib/apiClient.test.ts`, `client/src/lib/apiError.test.ts`, `client/src/lib/usePermission.test.tsx`

**Interfaces:**
- Consumes (server Task 8/9): `POST /api/auth/refresh` → `{ accessToken, user: AuthUserView }`; error body `{ statusCode, code, message, details?, correlationId }`.
- Produces:
  - `type AuthUser = { id: string; username: string; fullName: string; email: string | null; roleCode: 'ADMIN' | 'OPERATOR' | 'VIEWER'; roleName: string; departmentId: string | null; departmentName: string | null; permissions: string[] }`.
  - `useAuthStore` state `{ accessToken: string | null; user: AuthUser | null; epoch: number; notice: AuthNotice | null }`, actions `setAuth(token, user)`, `clear(notice?)`, `setNotice(n)`, `consumeNotice()` — reference semantics (epoch +1 on setAuth/clear).
  - `api` (axios, `withCredentials: true`), `refreshToken(): Promise<string | null>` (single-flight + epoch guard), `resetRefreshState()` — reference semantics.
  - `type ApiErrorInfo = { status: number | null; code: string | null; message: string; correlationId: string | null; isNetwork: boolean }`; `apiErrorOf(error: unknown, t: Translate): ApiErrorInfo` — message = backend `message` if present, else `t('common.error.network')` for network errors, else `t('common.error.generic')`.
  - `type Paged<T> = { data: T[]; page: number; pageSize: number; total: number }`.
  - `usePermission(codes: string | readonly string[], mode: 'all' | 'any' = 'all'): boolean` (ADMIN ⇒ true); `<Can permission={...} mode? fallback?>`.
  - `queryClient`, `resetQueryCache()`; `isAuthEndpoint(url)` for `/auth/login|refresh|azure|config|logout`.

- [ ] **Step 1: Write failing tests** (axios mocked with a custom adapter)

```ts
it('refreshes once for three concurrent 401s and retries all', async () => {
  // adapter: first call to each of /a,/b,/c → 401; /auth/refresh → 200 {accessToken:'new', user}; retries → 200
  const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
  expect(results.map(r => r.status)).toEqual([200, 200, 200]);
  expect(refreshCalls).toBe(1);
  expect(useAuthStore.getState().accessToken).toBe('new');
});
it('clears the session with a notice when refresh fails', async () => {
  // /auth/refresh → 401
  await expect(api.get('/a')).rejects.toBeTruthy();
  expect(useAuthStore.getState().user).toBeNull();
  expect(refreshCalls).toBe(1); // no loop
});
it('ignores a refresh result when the user logged out meanwhile (epoch changed)', async () => { /* setAuth during pending refresh → result discarded */ });
// apiError.test.ts
expect(apiErrorOf(axiosError(409, { statusCode: 409, code: 'USERNAME_TAKEN', message: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว', correlationId: 'c1' }), t))
  .toEqual({ status: 409, code: 'USERNAME_TAKEN', message: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว', correlationId: 'c1', isNetwork: false });
expect(apiErrorOf(networkError(), t).message).toBe(th['common.error.network']);
expect(apiErrorOf(axiosError(500, '<html>'), t).message).toBe(th['common.error.generic']);
// usePermission.test.tsx
// VIEWER with ['org:read'] → usePermission('org:manage') false; usePermission(['org:read','users:read'],'any') true; ADMIN with [] → true
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Port** `apiClient`, `authEndpoints`, `queryClient`, `authStore` (new `AuthUser` shape), write `apiError`, `paged`, `usePermission`, `Can`. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(client): api client with single-flight refresh, error messages, permissions`

### Task 6: Routing, access map, navigation model, 404 and error route

**Files:**
- Create: `client/src/app/router.tsx`, `client/src/app/routeAccess.ts`, `client/src/app/nav.ts`, `client/src/app/providers.tsx`, `client/src/app/NotFoundPage.tsx`, `client/src/app/RouteErrorPage.tsx`, `client/src/features/auth/RequireAuth.tsx`, `RequirePermission.tsx`, `HomeRoute.tsx`, `loginDestination.ts`
- Modify: `client/src/main.tsx` (render `<AppProviders><RouterProvider router={router} /></AppProviders>`), delete temporary `App.tsx`
- Test: `client/src/app/routeAccess.test.ts`, `client/src/app/nav.test.ts`, `client/src/features/auth/loginDestination.test.ts`, `RequireAuth.test.tsx`, `RequirePermission.test.tsx`, `client/src/app/router.test.tsx`

**Interfaces:**
- Produces:
  - `type RouteAccess = { anyOf: readonly string[]; allOf?: readonly string[] }`; `ROUTE_ACCESS` keyed by path without leading slash — exactly: `''` dashboard:view · `tracking` tracking:view · `tracking/history` tracking:history · `live-wall` anyOf streaming:live-wall, allOf streaming:view-live · `sessions` sessions:read · `work-orders` work-orders:read · `work-orders/review` work-orders:link · `work-orders/:id` work-orders:read · `booking-jobs` and `booking-jobs/:id` booking:read · `recordings` playback:view · `devices` and `devices/:id` devices:read · `teams` and `teams/:id` teams:read · `depots` devices:read · `employees` org:read · `departments` org:read · `users` users:read · `integration` integration:view · `notifications` anyOf notifications:read, alerts:view · `audit-logs` audit:view · `settings` settings:manage.
  - `accessForPath(pathname: string): RouteAccess | undefined` (most-literal-segments match, `:param` wildcard); `canEnter(access, permissions, roleCode): boolean` (ADMIN ⇒ true).
  - `type NavGroupId = 'overview' | 'operations' | 'assets' | 'system'`; `NavItem = { labelKey: TranslationKey; icon: LucideIcon; group: NavGroupId; to?: string; permissions: string[]; allPermissions?: string[]; end?: boolean }`; `NAV_GROUPS` (labels `ภาพรวม`, `ปฏิบัติงาน`, `อุปกรณ์และทีม`, `ระบบ`); `NAV_ITEMS` in Part 6 §6.3 order — overview: Dashboard, แผนที่ติดตาม, ประวัติเส้นทาง, Live wall · operations: Tracking sessions, ใบงาน, คิวตรวจสอบ, งานจาก Booking, บันทึกวิดีโอ · assets: Bodycam, ทีม, พนักงาน, แผนก, ฐาน/จุดชาร์จ · system: สถานะการเชื่อมต่อ, การแจ้งเตือน, Audit, ผู้ใช้และสิทธิ์, ตั้งค่า. **In P0 only Dashboard (`/`), พนักงาน, แผนก, ผู้ใช้และสิทธิ์, Audit, ตั้งค่า have `to`**; the rest have no `to` and render disabled until their phase adds the route.
  - `canSee(item, permissions, roleCode)`, `visibleNavItems(permissions, roleCode)`, `isNavItemActive(item, pathname)`.
  - `resolveLoginDestination(raw, permissions, roleCode): { to: string; blocked: boolean; blockedFrom?: string }`.
  - Router: `/login` (lazy `LoginPage`), `/` (lazy `RequireAuth` + `AppLayout`) children: index `HomeRoute`, `employees`, `departments`, `users`, `audit-logs`, `settings` (each wrapped in `RequirePermission` from `ROUTE_ACCESS`), `*` → `NotFoundPage`; every route has `errorElement: <RouteErrorPage />` and `HydrateFallback` = `LoadingSkeleton`.
  - `HomeRoute`: with `dashboard:view` renders a P0 welcome `PageHeader` (`app.home.title`, user full name); otherwise navigates to the first visible nav item with `to`.

- [ ] **Step 1: Port/adapt tests** from reference `routeAccess`, `nav`, `loginDestination`, `RequireAuth`, `RequirePermission` tests (drop `requiresEmployee` / `requiresOrgLevel` / company cases), and add:

```ts
expect(accessForPath('/work-orders/123')).toEqual(ROUTE_ACCESS['work-orders/:id']);
expect(accessForPath('/work-orders/review')).toEqual(ROUTE_ACCESS['work-orders/review']);
expect(canEnter(ROUTE_ACCESS['settings'], ['org:read'], 'OPERATOR')).toBe(false);
expect(canEnter(ROUTE_ACCESS['settings'], [], 'ADMIN')).toBe(true);
expect(resolveLoginDestination('/settings', ['org:read', 'dashboard:view'], 'OPERATOR')).toEqual({ to: '/', blocked: true, blockedFrom: '/settings' });
expect(visibleNavItems(ROLE_OPERATOR_PERMS, 'OPERATOR').some(i => i.labelKey === 'navigation.settings')).toBe(false);
// router.test.tsx: unknown path '/nope' (authenticated) renders t('common.notFound.title')
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (port + new maps). **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(client): route access map, navigation model, guards, 404 and error route`

### Task 7: Login (password + Entra) and session revocation

**Files:**
- Create: `client/src/features/auth/LoginPage.tsx`, `MicrosoftMark.tsx`, `auth.api.ts`, `msalClient.ts`, `loginOptions.ts`, `sessionRevoked.ts`
- Test: `LoginPage.test.tsx`, `loginOptions.test.ts`, `sessionRevoked.test.ts`

**Interfaces:**
- Consumes (server Tasks 8–9): `GET /api/auth/config` → `{ sso: { enabled: false } | { enabled: true; clientId; tenantId; authority }; passwordLogin: { enabled } }`; `POST /api/auth/login { username, password }`; `POST /api/auth/azure { idToken }`; `POST /api/auth/logout`; `GET /api/auth/me`; error codes `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED_TEMPORARY` (`details.retryAfterMinutes`), `ACCOUNT_DISABLED`, `SSO_ACCOUNT_NOT_FOUND`.
- Produces: `authApi.{ config, login(username, password), loginWithAzure(idToken), me, logout }`; `getMsal`, `startAzureSignIn`, `completeAzureSignIn`, `clearAzureSession` (reference semantics, `cacheLocation: 'sessionStorage'`, scopes `openid profile email`); `shouldSignOutWeb(payload): boolean` (true when `payload.scope === 'account'`).

- [ ] **Step 1: Port reference tests** for `LoginPage`, `loginOptions`, `sessionRevoked`, updating request bodies to camelCase and adding:

```ts
it('shows minutes for a temporary lock', async () => {
  // POST /auth/login → 401 { code:'ACCOUNT_LOCKED_TEMPORARY', message:'บัญชีถูกล็อกชั่วคราว', details:{ retryAfterMinutes: 12 } }
  expect(await screen.findByRole('alert')).toHaveTextContent('บัญชีถูกล็อกชั่วคราว');
});
it('hides the password form when passwordLogin is disabled', async () => { /* config sso enabled, password disabled → only Microsoft button */ });
it('after login with a blocked deep link lands on / and shows the no-access notice', async () => { /* state.from='/settings' as OPERATOR */ });
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Port** the auth feature files (branding unchanged; `finishSignIn` uses `resolveLoginDestination(raw, user.permissions, user.roleCode)`). **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(client): password and Microsoft Entra login`

### Task 8: App shell and realtime provider

**Files:**
- Create: `client/src/components/AppLayout.tsx`, `client/src/components/layout/{AppHeader,AppSidebar,BranchedNav,branchedNavRules,Breadcrumb,LanguageSwitcher,ThemeToggle}.tsx|.ts`, `client/src/components/BrandMark.tsx`, `client/src/components/ThemeLogo.tsx`, `client/src/lib/useAppNavigate.ts`, `client/src/lib/socket.ts`, `client/src/lib/realtimeUrl.ts`, `client/src/providers/RealtimeProvider.tsx`
- Test: `branchedNavRules.test.ts`, `realtimeUrl.test.ts`, `RealtimeProvider.test.tsx`, `AppLayout.test.tsx`

**Interfaces:**
- Consumes: server Task 13 Socket.IO namespace `/realtime`, `handshake.auth.token`, events `session:revoked { scope, reason, at }`; `connect_error` message `unauthorized`.
- Produces: `AppLayout` (= `<RealtimeProvider><AppLayoutContent /></RealtimeProvider>`; `FULL_BLEED_ROUTES = new Set<string>()` in P0 — P1 adds tracking routes); `AppHeader({ collapsed, onToggleSidebar })` with breadcrumb, clock, language switcher, theme toggle, user menu (full name, role name, department name, logout) — **no notification bell in P0**; `AppSidebar({ collapsed, variant?: 'desktop' | 'drawer', onNavigate? })`; `BranchedNav` + `FOLDED_GROUPS_STORAGE_KEY = 'bodycam.nav.folded'`; `useRealtime(): { connected: boolean; subscribe: RealtimeSubscribe }`; `connectRealtime(getToken)`; `realtimeTarget(apiBase)`.

- [ ] **Step 1: Port reference tests** (`branchedNavRules`, `realtimeUrl`, RealtimeProvider `session:revoked` handling) and add `AppLayout.test.tsx`:

```ts
it('uses a drawer on narrow viewports', async () => {
  setViewport(375); render(<AppLayoutHarness />);
  expect(screen.queryByRole('navigation', { name: t('navigation.label') })).not.toBeVisible();
  await user.click(screen.getByRole('button', { name: t('header.openMenu') }));
  expect(screen.getByRole('dialog')).toBeVisible();
});
it('renders disabled nav items without links', () => { /* 'แผนที่ติดตาม' has aria-disabled="true" and no href */ });
it('on session:revoked (account) clears auth and goes to /login with notice', async () => { /* emit from fake socket */ });
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Port** shell files; remove company line, notification bell, `AlertToaster`. **Step 4: Run** — PASS, plus Task 2 guard tests.
- [ ] **Step 5: Commit** `feat(client): app shell, navigation and realtime provider`

### Task 9: Users and roles page

**Files:**
- Create: `client/src/features/users/UsersPage.tsx`, `users.api.ts`, `userForm.ts`, `components/UserFormDialog.tsx`, `components/RolePermissionsPanel.tsx`, `client/src/i18n/locales/{th,en}/users.ts`
- Test: `userForm.test.ts`, `UsersPage.test.tsx`, `RolePermissionsPanel.test.tsx`

**Interfaces:**
- Consumes (server Task 12): `GET /api/users?page&pageSize&q` → `Paged<UserRow>` (`{ id, username, fullName, email, roleId, roleCode, roleName, departmentId, departmentName, status, lastLoginAt, azureLinked }`); `POST /api/users`; `PATCH /api/users/:id`; `PATCH /api/users/:id/access { enabled }`; `DELETE /api/users/:id`; `GET /api/roles`; `GET /api/roles/:id/permissions`; `PUT /api/roles/:id/permissions { permissions }`; `GET /api/departments/tree`.
- Produces: query keys `['users', 'list', { page, q }]`, `['roles']`, `['roles', id, 'permissions']`; `validateUserForm(values): Partial<Record<keyof UserFormValues, TranslationKey>>` (username required ≤ 50; non-ADMIN role requires department; email format when given); `toCreatePayload(values)` (trims + lowercases username, omits empty password).
- Page: tabs `ผู้ใช้` and `บทบาทและสิทธิ์` (second tab only with `roles:manage`); row tools: edit (`users:manage`), `•••` with suspend/restore + delete (`users:manage`), suspend uses `useConfirm` with tone `destructive`; own row's suspend/delete disabled with reason text; role matrix: checkboxes per permission grouped by resource, ADMIN column read-only with reason `บทบาทผู้ดูแลระบบมีสิทธิ์ทั้งหมด`.

- [ ] **Step 1: Write failing tests** — form validation cases; list renders envelope rows and pagination; VIEWER (`users:read` only) sees no edit/suspend tools; suspend → confirm → `PATCH /api/users/7/access {enabled:false}` → success toast; 409 `USERNAME_TAKEN` shows backend message under the field; matrix save sends the checked codes and ADMIN checkboxes are disabled.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (port reference `features/users` table/dialog patterns without company field, Entra sync, or device list). **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(client): users and roles administration`

### Task 10: Departments and employees pages

**Files:**
- Create: `client/src/features/departments/DepartmentsPage.tsx`, `departments.api.ts`, `departmentForm.ts`, `components/DepartmentTree.tsx`, `components/DepartmentFormDialog.tsx`; `client/src/features/employees/EmployeesPage.tsx`, `employees.api.ts`, `employeeForm.ts`, `components/EmployeeFormDialog.tsx`; locales `departments.ts`, `employees.ts`
- Test: `departmentForm.test.ts`, `DepartmentsPage.test.tsx`, `employeeForm.test.ts`, `EmployeesPage.test.tsx`

**Interfaces:**
- Consumes (server Task 12): `GET /api/departments/tree`, `POST/PATCH/DELETE /api/departments/:id` (409 `DEPARTMENT_IN_USE` with `details.children`, `details.employees`; 400 `DEPARTMENT_CYCLE`); `GET /api/employees?page&pageSize&q&departmentId&status` → `Paged<EmployeeRow>` (`{ id, employeeCode, firstName, lastName, phone, departmentId, departmentName, userId, bookingEmployeeRef, status }`), `POST/PATCH/DELETE /api/employees/:id` (409 `EMPLOYEE_CODE_TAKEN`, `USER_ALREADY_LINKED`).
- Produces: query keys `['departments', 'tree']`, `['employees', 'list', filters]`; department parent picker excludes the department itself and its descendants (`descendantIds(tree, id): Set<string>`).

- [ ] **Step 1: Write failing tests** — `descendantIds` on a 3-level tree; delete blocked: server 409 `DEPARTMENT_IN_USE` → persistent `Alert` naming counts (`มีแผนกย่อย 1 แผนก และพนักงาน 3 คน`) plus error toast; employees filter by department updates the query key; empty vs filtered-empty states differ; write tools hidden without `org:manage`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (port reference patterns, no company field). **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(client): departments and employees administration`

### Task 11: Settings and audit log pages

**Files:**
- Create: `client/src/features/settings/SettingsPage.tsx`, `settings.api.ts`, `settingForm.ts`; `client/src/features/audit/AuditLogsPage.tsx`, `audit.api.ts`; locales `settings.ts`, `audit.ts`
- Test: `settingForm.test.ts`, `SettingsPage.test.tsx`, `AuditLogsPage.test.tsx`

**Interfaces:**
- Consumes (server Task 11): `GET /api/settings` → `{ groups: [{ category, items: [{ key, value, valueType, description, min?, max? }] }], total }`; `PATCH /api/settings/:key { value }` (400 `SETTING_OUT_OF_RANGE`); `GET /api/audit-logs?…` → `Paged<AuditRow>` (`{ id, occurredAt, userId, actorUsername, actorRole, action, resourceType, resourceId, result, httpMethod, requestPath, ip, correlationId }`), `GET /api/audit-logs/actions` → `{ data: string[], total }`.
- Produces: `CATEGORY_LABEL_KEY: Record<string, TranslationKey>` with `auth` → `settings.category.auth`; unknown categories render the raw code (later phases add `session`, `matching`, `workorder`, `booking`); `validateSettingInput(item, raw): TranslationKey | null` (int within min/max client-side, server remains authority).

- [ ] **Step 1: Write failing tests** — out-of-range input shows inline error and disables save with a reason; server 400 message shown; audit filters (action, result, date range via `DateRangePicker`) map to query params; result `2` rows show a `StatusBadge` tone `destructive` with text `ไม่สำเร็จ`; correlation id visible and copyable.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(client): settings and audit log pages`

### Task 12: Web Docker image and CI job

**Files:**
- Create: `client/Dockerfile`, `client/nginx.conf`, `client/.dockerignore`
- Modify: `.github/workflows/ci.yml` (add job `client`)

**Interfaces:**
- Produces: image serving `dist/` with nginx — SPA fallback `try_files $uri /index.html`; `/api` and `/socket.io` are **not** proxied by this image (ingress routes them, Part 2 §2.3). CI job `client`: Node 22, `npm ci` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run build`.

- [ ] **Step 1: Write** Dockerfile (stage `build` node:22-slim `npm ci && npm run build`; stage `web` nginx:1.27-alpine copying `dist/` and `nginx.conf`).
- [ ] **Step 2: Verify** `npm run build` locally — Expected: success, `dist/index.html` exists; `docker build client` if Docker is available (otherwise note it in the hand-off).
- [ ] **Step 3: Add the CI job**; push a branch or run `act` if available — Expected: job green.
- [ ] **Step 4: Commit** `chore(client): web Dockerfile and CI job`

---

## Done when

- `npm run lint && npm run typecheck && npm test && npm run build` pass in `client/`.
- With the P0 server running: log in as `admin` / `operator1` / `viewer1` (dev seed), see nav filtered by permissions, manage users/departments/employees/settings as ADMIN, see audit rows, get signed out instantly when an admin suspends the account.
