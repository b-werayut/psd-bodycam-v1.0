import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AxiosError } from 'axios';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import psdDarkLogo from '@/assets/logo/psd-dark-login.png';
import psdLightLogo from '@/assets/logo/psd-light-login.png';
import { actionToast } from '@/components/ui/action-toast';
import { th } from '@/i18n/locales/th';
import { useAuthStore } from '@/stores/authStore';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { authApi, type AuthConfig } from './auth.api';
import { LoginPage } from './LoginPage';
import { clearAzureSession, completeAzureSignIn, startAzureSignIn } from './msalClient';

vi.mock('./auth.api', () => ({
  authApi: { config: vi.fn(), login: vi.fn(), loginWithAzure: vi.fn() },
}));
vi.mock('./msalClient', () => ({
  startAzureSignIn: vi.fn(),
  completeAzureSignIn: vi.fn(),
  clearAzureSession: vi.fn(),
}));

const SSO_ENABLED: AuthConfig = {
  sso: {
    enabled: true,
    clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    tenantId: '11111111-2222-3333-4444-555555555555',
    authority: 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555',
  },
  passwordLogin: { enabled: true },
};

const SESSION_USER = {
  id: 'u1',
  username: 'operator',
  roleCode: 'ADMIN' as const,
  departmentId: null,
  roleName: 'Admin',
  fullName: 'Operator',
  email: null,
  departmentName: null,
  permissions: ['devices:read'],
};

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
}

function renderLogin(language: 'th' | 'en' = 'th') {
  window.localStorage.setItem('bodycam.language', language);
  return render(
    <LanguageProvider>
      <ThemeProvider>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </ThemeProvider>
    </LanguageProvider>,
  );
}

function apiRejection(status: number, data: Record<string, unknown>) {
  const rejection = new AxiosError('Request failed');
  rejection.response = { status, data } as never;
  return rejection;
}

function asReturningFromAzure() {
  window.location.hash = '#code=abc123&state=%2Ftracking';
}

async function openPasswordForm() {
  await screen.findByLabelText('ชื่อผู้ใช้');
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: createMemoryStorage(),
    });
    useAuthStore.setState({ accessToken: null, user: null, notice: null });
    vi.mocked(authApi.config).mockResolvedValue(SSO_ENABLED);
    vi.mocked(completeAzureSignIn).mockResolvedValue(null);
    vi.mocked(clearAzureSession).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = '';
    useAuthStore.setState({ accessToken: null, user: null, notice: null });
  });

  it('แสดงฟอร์มชื่อผู้ใช้และรหัสผ่านเป็นค่าเริ่มต้นควบคู่กับ SSO', async () => {
    renderLogin();

    const sso = await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ });
    expect(sso).toBeInTheDocument();
    const username = screen.getByLabelText('ชื่อผู้ใช้');
    expect(username).toBeRequired();
    expect(username).toHaveAttribute('name', 'username');
    expect(username).toHaveAttribute('placeholder', 'เช่น somchai.s');
    expect(username).toHaveAttribute('autocapitalize', 'none');
    expect(username).toHaveAttribute('spellcheck', 'false');
    const password = screen.getByLabelText('รหัสผ่าน');
    expect(password).toBeRequired();
    expect(password).toHaveAttribute('name', 'password');
    expect(password).toHaveAttribute('placeholder', 'กรอกรหัสผ่าน');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'เข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่าน' }),
    ).not.toBeInTheDocument();
  });

  it('**ถูกระงับระหว่างใช้งาน -> หน้า login บอกสาเหตุ** ไม่ใช่เด้งมาเฉย ๆ', async () => {
    useAuthStore.setState({ notice: { key: 'auth.sessionRevoked' } });

    renderLogin();

    expect(
      await screen.findByText(/ผู้ดูแลระบบระงับการเข้าระบบของบัญชีนี้/),
    ).toBeInTheDocument();
    // อ่านแล้วต้องล้างทิ้ง ไม่งั้นค้างไปโผล่ซ้ำหลังล็อกอินสำเร็จ
    expect(useAuthStore.getState().notice).toBeNull();
  });

  it('logout ที่แจ้งเซิร์ฟเวอร์ไม่สำเร็จ -> toast ที่ยิงก่อนเด้งมาต้องเห็นบนหน้า login + Alert ค้างไว้', async () => {
    // AppHeader ยิง toast แล้ว navigate -> Toaster ของ AppLayout หายไปพร้อมหน้า
    // หน้า login ต้องมี Toaster เอง ไม่งั้น toast ไม่โผล่ (แล้วไปโผล่ทีหลังตอนล็อกอินรอบถัดไป)
    useAuthStore.setState({ notice: { key: 'auth.logoutServerFailed' } });
    actionToast.error(th['header.logoutFailedTitle'], th['auth.logoutServerFailed']);

    renderLogin();

    expect(await screen.findByText(th['header.logoutFailedTitle'])).toBeInTheDocument();
    const notice = document.querySelector('[data-slot="signed-out-notice"]');
    expect(notice).toHaveTextContent(th['auth.logoutServerFailed']);
  });

  it('**ข้อความต้องรอดใน StrictMode ด้วย** — dev รัน initializer ซ้ำ รอบสองได้ null', async () => {
    useAuthStore.setState({ notice: { key: 'auth.sessionRevoked' } });
    window.localStorage.setItem('bodycam.language', 'th');

    render(
      <StrictMode>
        <LanguageProvider>
          <ThemeProvider>
            <MemoryRouter>
              <LoginPage />
            </MemoryRouter>
          </ThemeProvider>
        </LanguageProvider>
      </StrictMode>,
    );

    expect(
      await screen.findByText(/ผู้ดูแลระบบระงับการเข้าระบบของบัญชีนี้/),
    ).toBeInTheDocument();
  });

  it('ไม่มี notice -> ไม่มีแถบข้อความค้างบนหน้า login', async () => {
    renderLogin();
    await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ });

    expect(document.querySelector('[data-slot="signed-out-notice"]')).toBeNull();
  });

  it('ใช้โลโก้เป็นตัวแทนแบรนด์โดยไม่แสดงชื่อ PSD Sentinel ซ้ำ', async () => {
    renderLogin();
    await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ });

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Body Worn Camera' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('ระบบบริหารกล้องบันทึกภาพภายในองค์กร'),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'PSD Sentinel' })).toBeInTheDocument();
    expect(screen.queryByText('PSD Sentinel')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'เลือกภาษา' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เปลี่ยนเป็นโหมดมืด' })).toBeInTheDocument();
  });

  it('ใช้คำอธิบายภาษาอังกฤษที่สื่อความหมายเดียวกับภาษาไทย', async () => {
    renderLogin('en');

    expect(
      await screen.findByText(
        'Enterprise body-worn camera management',
      ),
    ).toBeInTheDocument();
  });

  it('รวมตัวเลือกภาษาและธีมไว้ใน glass utility dock เดียว', async () => {
    renderLogin();
    await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ });

    const utilityDock = screen.getByRole('group', { name: 'ตัวเลือกภาษาและธีม' });
    expect(utilityDock).toHaveAttribute('data-slot', 'auth-utility-dock');
    expect(within(utilityDock).getByRole('group', { name: 'เลือกภาษา' })).toBeInTheDocument();
    expect(
      within(utilityDock).getByRole('button', { name: 'เปลี่ยนเป็นโหมดมืด' }),
    ).toBeInTheDocument();
    expect(utilityDock.querySelector('[data-orientation="vertical"]')).toBeInTheDocument();
    expect(
      utilityDock.querySelector('[data-slot="language-indicator"]'),
    ).toHaveAttribute('data-surface', 'glass');
  });

  it('ใช้ชื่อผลิตภัณฑ์รองแบบอ่านตามธรรมชาติ ไม่บังคับ uppercase หรือ tracking กว้าง', async () => {
    renderLogin();
    await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ });

    const productDescriptor = screen.getByRole('heading', {
      level: 1,
      name: 'Body Worn Camera',
    });
    expect(productDescriptor).toHaveClass('auth-login-title');
    expect(
      screen.getByText('ระบบบริหารกล้องบันทึกภาพภายในองค์กร'),
    ).toHaveClass('auth-login-description', 'text-balance');
    expect(productDescriptor).not.toHaveClass('uppercase');
    expect(productDescriptor).not.toHaveClass('tracking-[0.14em]');
  });

  it('ใช้ชื่อ Body Worn Camera ในชื่อแท็บเบราว์เซอร์', async () => {
    renderLogin();
    await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ });

    expect(document.title).toBe('PSD — Body Worn Camera');
  });

  it('แสดง wordmark แนวนอนในพื้นที่ที่อ่านโลโก้ได้ชัด', async () => {
    window.localStorage.setItem('bodycam.theme', 'light');
    renderLogin();
    await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ });

    const logo = screen.getByRole('img', { name: 'PSD Sentinel' });
    expect(logo).toHaveAttribute('src', psdLightLogo);
    expect(logo.parentElement).toHaveClass(
      'h-16',
      'w-40',
      'p-3',
    );
    expect(logo.parentElement?.className).not.toMatch(/ring|border|bg-/);
    expect(logo).toHaveAttribute('width', '932');
    expect(logo).toHaveAttribute('height', '235');
    expect(logo).toHaveClass('h-auto', 'w-full', 'object-contain');
  });

  it('เปลี่ยนเป็นโลโก้สำหรับ dark mode เมื่อผู้ใช้สลับธีม', async () => {
    window.localStorage.setItem('bodycam.theme', 'light');
    renderLogin();
    await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ });

    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนเป็นโหมดมืด' }));

    const logo = screen.getByRole('img', { name: 'PSD Sentinel' });
    expect(logo).toHaveAttribute('src', psdDarkLogo);
    expect(logo.parentElement).toHaveClass(
      'h-16',
      'w-40',
      'p-3',
    );
    expect(logo.parentElement?.className).not.toMatch(/ring|border|bg-/);
  });

  it('ใช้ปุ่ม SSO แบบกระจกกึ่งโปร่งโดยไม่แย่งความเด่นจากปุ่มหลัก', async () => {
    renderLogin();

    const sso = await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ });
    expect(sso).toHaveClass('auth-glass-secondary-action', 'border', 'border-input');
    expect(sso).not.toHaveClass('bg-primary');
  });

  it('รวมการเข้าสู่ระบบไว้ในการ์ดเดี่ยว ไม่มีแผงโปรโมตแยกข้าง', async () => {
    renderLogin();
    await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ });

    const loginCard = screen.getByRole('region', { name: 'Body Worn Camera' });
    expect(loginCard).toHaveClass(
      'auth-glass-panel',
      'auth-glass-panel--clear',
      'auth-login-card--premium',
      'max-w-[430px]',
      'rounded-2xl',
      'border',
      'backdrop-blur-2xl',
      'backdrop-saturate-150',
    );
    expect(loginCard).toContainElement(
      screen.getByRole('heading', { level: 1, name: 'Body Worn Camera' }),
    );
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('ใช้สัดส่วนการ์ดและช่องกรอกตรงกับหน้าอ้างอิง', async () => {
    const { container } = renderLogin();
    const sso = await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ });

    const loginCard = screen.getByRole('region', { name: 'Body Worn Camera' });
    const cardBody = container.querySelector('.auth-login-card-body');
    const footer = container.querySelector('.auth-login-card-footer');
    expect(loginCard).toHaveClass('max-w-[430px]');
    expect(loginCard).not.toHaveClass('max-w-[530px]');
    expect(cardBody).toHaveClass('sm:px-8');
    expect(footer).toHaveClass('sm:px-8');
    expect(sso).toHaveClass('min-h-12', 'px-4', 'py-3');
    expect(screen.getByLabelText('ชื่อผู้ใช้')).toHaveClass('h-[46px]', 'rounded-lg', 'px-3.5');
    expect(screen.getByLabelText('รหัสผ่าน')).toHaveClass('h-[46px]', 'rounded-lg', 'px-3.5');
    expect(screen.getByRole('button', { name: 'เข้าสู่ระบบ' })).toHaveClass('h-12');
  });

  it('ใช้ช่องกรอกแบบกระจกกึ่งโปร่งเฉพาะหน้า login', async () => {
    renderLogin();
    await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ });

    expect(screen.getByLabelText('ชื่อผู้ใช้')).toHaveClass('auth-glass-field');
    expect(screen.getByLabelText('รหัสผ่าน')).toHaveClass('auth-glass-field');
  });

  it('ใช้ภาพพื้นหลังอ้างอิงสีน้ำเงินเพียงชั้นเดียวและซ่อนจาก accessibility tree', async () => {
    const { container } = renderLogin();
    await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ });

    const backdrops = container.querySelectorAll('[data-slot="auth-security-backdrop"]');
    expect(backdrops).toHaveLength(1);

    const backdrop = backdrops[0];
    expect(backdrop).toBeInTheDocument();
    expect(backdrop).toHaveAttribute('alt', '');
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    expect(backdrop).toHaveAttribute('data-visual', 'reference-security-blue');
    expect(backdrop).toHaveAttribute(
      'src',
      expect.stringContaining('bodycam-security-reference-background.jpg'),
    );
    expect(backdrop).toHaveClass('auth-security-backdrop');

    const gradient = container.querySelector('[data-slot="auth-security-gradient"]');
    expect(gradient).toBeInTheDocument();
    expect(gradient).toHaveAttribute('aria-hidden', 'true');
    expect(gradient).toHaveClass('auth-security-gradient');
  });

  it('ใช้การ์ดกระจกบางและปรับภาพพื้นหลังเดิมตาม dark mode โดยไม่สลับเป็นภาพชุดที่สอง', async () => {
    window.localStorage.setItem('bodycam.theme', 'light');
    const { container } = renderLogin();
    await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ });

    const loginCard = screen.getByRole('region', { name: 'Body Worn Camera' });
    const backdrop = container.querySelector('[data-slot="auth-security-backdrop"]');
    const lightBackdropSrc = backdrop?.getAttribute('src');

    expect(loginCard).toHaveClass('auth-login-card--thin-glass');
    expect(backdrop).toHaveClass('auth-security-backdrop--theme-responsive');

    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนเป็นโหมดมืด' }));

    expect(document.documentElement).toHaveClass('dark');
    expect(container.querySelectorAll('[data-slot="auth-security-backdrop"]')).toHaveLength(1);
    expect(backdrop).toHaveAttribute('src', lightBackdropSrc);
  });

  it('มีจุดยึด layout สำหรับกระชับการ์ดบนหน้าจอที่มีความสูงจำกัด', async () => {
    const { container } = renderLogin();
    await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ });

    expect(screen.getByRole('main')).toHaveClass(
      'auth-login-page',
      'overflow-x-hidden',
      'overflow-y-auto',
    );
    expect(screen.getByRole('main')).not.toHaveClass('overflow-hidden');
    expect(screen.getByRole('region', { name: 'Body Worn Camera' })).toHaveClass(
      'auth-login-card',
    );
    expect(container.querySelector('.auth-login-stage')).toBeInTheDocument();
    expect(container.querySelector('.auth-login-card-body')).toBeInTheDocument();
    expect(container.querySelector('.auth-login-card-footer')).toBeInTheDocument();
  });

  it('กดปุ่ม SSO แล้วส่งปลายทางที่ขอไว้ไปกับ MSAL', async () => {
    vi.mocked(startAzureSignIn).mockImplementation(() => new Promise(() => {}));

    render(
      <LanguageProvider>
        <ThemeProvider>
          <MemoryRouter
            initialEntries={[{ pathname: '/login', state: { from: '/tracking' } }]}
          >
            <LoginPage />
          </MemoryRouter>
        </ThemeProvider>
      </LanguageProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ }));

    await waitFor(() => {
      expect(startAzureSignIn).toHaveBeenCalledWith(SSO_ENABLED.sso, '/tracking');
    });
    expect(await screen.findByText('กำลังไปที่ Microsoft…')).toBeInTheDocument();
  });

  it('กลับมาจาก Microsoft = แลก id_token แล้วพาไปปลายทางที่ฝากไว้ใน state', async () => {
    vi.mocked(completeAzureSignIn).mockResolvedValue({
      idToken: 'id-token-from-entra',
      state: '/tracking',
    } as never);
    vi.mocked(authApi.loginWithAzure).mockResolvedValue({
      accessToken: 'token',
      user: SESSION_USER,
    });
    asReturningFromAzure();

    render(
      <LanguageProvider>
        <ThemeProvider>
          <MemoryRouter
            initialEntries={['/login']}
          >
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/tracking" element={<p>Tracking destination</p>} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </LanguageProvider>,
    );

    expect(await screen.findByText('Tracking destination')).toBeInTheDocument();
    expect(authApi.loginWithAzure).toHaveBeenCalledWith('id-token-from-entra');
    expect(clearAzureSession).toHaveBeenCalled();
  });

  it('บัญชียังไม่ได้ลงทะเบียน = แสดงข้อความจาก backend ตรง ๆ ไม่กลืนเป็น error ลอย ๆ', async () => {
    const { AxiosError } = await import('axios');
    const rejection = new AxiosError('Request failed');
    rejection.response = {
      status: 401,
      data: { message: 'บัญชี ghost@psd.co.th ยังไม่ได้ลงทะเบียนในระบบ กรุณาติดต่อผู้ดูแลระบบ' },
    } as never;

    vi.mocked(completeAzureSignIn).mockResolvedValue({ idToken: 'id-token' } as never);
    vi.mocked(authApi.loginWithAzure).mockRejectedValue(rejection);
    asReturningFromAzure();

    renderLogin();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'บัญชี ghost@psd.co.th ยังไม่ได้ลงทะเบียนในระบบ',
    );
    expect(screen.getByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ })).toBeEnabled();
  });

  it('เริ่ม SSO ไม่สำเร็จเพราะ flag ค้าง = ต้องขึ้นข้อความ ห้ามเงียบ', async () => {
    vi.mocked(startAzureSignIn).mockRejectedValue({ errorCode: 'interaction_in_progress' });

    renderLogin();
    fireEvent.click(await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('รีเฟรชหน้านี้');
    expect(screen.getByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ })).toBeEnabled();
  });

  it('เริ่ม SSO ล้มด้วยเหตุอื่น = ขึ้นข้อความเช่นกัน', async () => {
    vi.mocked(startAzureSignIn).mockRejectedValue({ errorCode: 'endpoints_resolution_error' });

    renderLogin();
    fireEvent.click(await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'เชื่อมต่อกับ Microsoft ไม่สำเร็จ',
    );
    expect(screen.getByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ }).parentElement)
      .toContainElement(alert);
    expect(screen.getByLabelText('ชื่อผู้ใช้')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByLabelText('รหัสผ่าน')).toHaveAttribute('aria-invalid', 'false');
  });

  it('ผู้ใช้กดยกเลิกที่หน้า Microsoft = ไม่ขึ้นข้อความ error', async () => {
    vi.mocked(completeAzureSignIn).mockRejectedValue({ errorCode: 'user_cancelled' });
    asReturningFromAzure();

    renderLogin();

    await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ปิด SSO ที่ backend = กางฟอร์มรหัสผ่านไว้เลย ไม่มีปุ่ม SSO', async () => {
    vi.mocked(authApi.config).mockResolvedValue({
      sso: { enabled: false },
      passwordLogin: { enabled: true },
    });

    renderLogin();

    expect(await screen.findByLabelText('ชื่อผู้ใช้')).toBeRequired();
    expect(
      screen.queryByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ }),
    ).not.toBeInTheDocument();
    expect(completeAzureSignIn).not.toHaveBeenCalled();
  });

  it('AUTH_PASSWORD_LOGIN_ENABLED=false = ไม่มีช่องรหัสผ่านให้เห็นหรือกางออกมาได้เลย', async () => {
    vi.mocked(authApi.config).mockResolvedValue({
      ...SSO_ENABLED,
      passwordLogin: { enabled: false },
    });

    renderLogin();

    expect(await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('ชื่อผู้ใช้')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('รหัสผ่าน')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'เข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่าน' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('หรือ')).not.toBeInTheDocument();
  });

  it('backend ปิดทุกวิธีเข้าสู่ระบบ = แสดงคำอธิบายและลองตรวจสอบใหม่ได้', async () => {
    vi.mocked(authApi.config)
      .mockResolvedValueOnce({
        sso: { enabled: false },
        passwordLogin: { enabled: false },
      })
      .mockResolvedValueOnce(SSO_ENABLED);

    renderLogin();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('ไม่มีวิธีเข้าสู่ระบบที่พร้อมใช้งาน');
    expect(screen.queryByLabelText('ชื่อผู้ใช้')).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: 'ลองใหม่' }));

    expect(
      await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText('ไม่มีวิธีเข้าสู่ระบบที่พร้อมใช้งาน')).not.toBeInTheDocument();
  });

  it('อ่าน /auth/config ไม่ได้ = บอกว่า SSO อาจไม่ครบและยังเข้าด้วยรหัสผ่านได้', async () => {
    vi.mocked(authApi.config).mockRejectedValue(new Error('offline'));

    renderLogin();

    expect(await screen.findByLabelText('ชื่อผู้ใช้')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'ไม่สามารถตรวจสอบตัวเลือกการเข้าสู่ระบบขององค์กร',
    );
    expect(screen.getByRole('button', { name: 'ลองใหม่' })).toBeEnabled();
  });

  it('ลองโหลด Auth Config ซ้ำได้โดยไม่เสียฟอร์มรหัสผ่าน', async () => {
    vi.mocked(authApi.config)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(SSO_ENABLED);

    renderLogin();

    expect(await screen.findByLabelText('ชื่อผู้ใช้')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));

    expect(
      await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('ชื่อผู้ใช้')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('เปิดหน้าตามปกติ = ไม่เรียก MSAL เลย และไม่มีวงหมุนค้าง', async () => {
    vi.mocked(completeAzureSignIn).mockImplementation(() => new Promise(() => {}));

    renderLogin();

    expect(
      await screen.findByRole('button', { name: /เข้าสู่ระบบด้วยบัญชีองค์กร/ }),
    ).toBeInTheDocument();
    expect(completeAzureSignIn).not.toHaveBeenCalled();
    expect(screen.queryByText('กำลังเตรียมหน้าเข้าสู่ระบบ')).not.toBeInTheDocument();

    await openPasswordForm();
    expect(screen.getByLabelText('ชื่อผู้ใช้')).toBeInTheDocument();
  });

  it('shows the backend message for a temporary lock', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      apiRejection(401, {
        code: 'ACCOUNT_LOCKED_TEMPORARY',
        message: 'บัญชีถูกล็อกชั่วคราว',
        details: { retryAfterMinutes: 12 },
      }),
    );
    renderLogin();
    await openPasswordForm();

    fireEvent.change(screen.getByLabelText('ชื่อผู้ใช้'), { target: { value: 'operator' } });
    fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('บัญชีถูกล็อกชั่วคราว');
    expect(screen.getByLabelText('ชื่อผู้ใช้')).toHaveAttribute('aria-invalid', 'false');
  });

  it('เปิดฟอร์มรหัสผ่านแล้วเข้าสู่ระบบได้ตามเดิม', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ accessToken: 'token', user: SESSION_USER });

    render(
      <LanguageProvider>
        <ThemeProvider>
          <MemoryRouter
            initialEntries={[{ pathname: '/login', state: { from: '/tracking' } }]}
          >
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/tracking" element={<p>Tracking destination</p>} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </LanguageProvider>,
    );

    await openPasswordForm();
    fireEvent.change(screen.getByLabelText('ชื่อผู้ใช้'), { target: { value: 'operator' } });
    fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

    expect(await screen.findByText('Tracking destination')).toBeInTheDocument();
    expect(authApi.login).toHaveBeenCalledWith('operator', 'password');
  });

  it('ใช้สีน้ำเงินกรมท่าจากโลโก้กับปุ่มเข้าสู่ระบบโดยไม่ใช้ลูกศรสีส้ม', async () => {
    renderLogin();
    await openPasswordForm();

    const submit = screen.getByRole('button', { name: 'เข้าสู่ระบบ' });
    expect(submit).toHaveClass(
      'h-12',
      'auth-login-primary-action',
      'text-white',
    );
    expect(submit).not.toHaveClass('bg-[var(--auth-action)]');
    expect(submit).not.toHaveClass('bg-primary');
    expect(submit).not.toHaveClass('shadow-md');
    expect(submit).not.toHaveClass('shadow-lg');
    expect(submit.querySelector('[data-icon="inline-end"]')).not.toHaveClass(
      'text-brand-accent',
    );
  });

  it('ประกาศว่ากรอกไม่ครบและย้าย focus ไปชื่อผู้ใช้โดยไม่เรียก API', async () => {
    renderLogin();
    await openPasswordForm();

    fireEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

    expect(screen.queryByText('กรอกชื่อผู้ใช้และรหัสผ่าน')).not.toBeInTheDocument();
    expect(screen.getByText('กรุณากรอกชื่อผู้ใช้')).toBeInTheDocument();
    expect(screen.getByText('กรุณากรอกรหัสผ่าน')).toBeInTheDocument();
    expect(screen.getByLabelText('ชื่อผู้ใช้')).toHaveFocus();
    for (const [field, errorId] of [
      [screen.getByLabelText('ชื่อผู้ใช้'), 'username-error'],
      [screen.getByLabelText('รหัสผ่าน'), 'password-error'],
    ] as const) {
      expect(field).toBeRequired();
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field).toHaveAttribute('aria-describedby', errorId);
    }
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it('ทำเครื่องหมายเฉพาะช่องที่ขาดและคืนสถานะปกติเมื่อกรอกครบ', async () => {
    renderLogin();
    await openPasswordForm();

    const username = screen.getByLabelText('ชื่อผู้ใช้');
    const password = screen.getByLabelText('รหัสผ่าน');
    fireEvent.change(username, { target: { value: 'operator' } });
    fireEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

    expect(username).toHaveAttribute('aria-invalid', 'false');
    expect(username).not.toHaveClass('border-destructive/60');
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAttribute('aria-describedby', 'password-error');
    expect(password).toHaveFocus();

    fireEvent.change(password, { target: { value: 'password' } });

    expect(password).toHaveAttribute('aria-invalid', 'false');
    expect(password).not.toHaveClass('border-destructive/60');
    expect(screen.queryByText('กรุณากรอกรหัสผ่าน')).not.toBeInTheDocument();
  });

  it('วาง credential error ภายในฟอร์มรหัสผ่าน', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      apiRejection(401, { code: 'INVALID_CREDENTIALS', message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }),
    );
    renderLogin();
    await openPasswordForm();

    fireEvent.change(screen.getByLabelText('ชื่อผู้ใช้'), { target: { value: 'operator' } });
    fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

    const alert = await screen.findByRole('alert');
    expect(document.querySelector('#password-form')).toContainElement(alert);
    expect(screen.getByLabelText('ชื่อผู้ใช้')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('รหัสผ่าน')).toHaveAttribute('aria-invalid', 'true');
  });

  it('วาง network error ภายในฟอร์มโดยไม่กล่าวหาว่าค่าที่กรอกผิด', async () => {
    vi.mocked(authApi.login).mockRejectedValue(apiRejection(500, { code: 'INTERNAL_ERROR' }));
    renderLogin();
    await openPasswordForm();

    fireEvent.change(screen.getByLabelText('ชื่อผู้ใช้'), { target: { value: 'operator' } });
    fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

    const alert = await screen.findByRole('alert');
    expect(document.querySelector('#password-form')).toContainElement(alert);
    expect(screen.getByLabelText('ชื่อผู้ใช้')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByLabelText('รหัสผ่าน')).toHaveAttribute('aria-invalid', 'false');
  });

  it('เก็บค่าที่กรอกไว้และบอกว่ารหัสผ่านไม่ถูกต้อง', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      apiRejection(401, { code: 'INVALID_CREDENTIALS', message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }),
    );
    renderLogin();
    await openPasswordForm();

    fireEvent.change(screen.getByLabelText('ชื่อผู้ใช้'), { target: { value: 'operator' } });
    fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    });
    expect(screen.getByLabelText('ชื่อผู้ใช้')).toHaveValue('operator');
  });

  it('ล้าง credential error เมื่อผู้ใช้เริ่มแก้ข้อมูล', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      apiRejection(401, { code: 'INVALID_CREDENTIALS', message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }),
    );
    renderLogin();
    await openPasswordForm();

    const username = screen.getByLabelText('ชื่อผู้ใช้');
    const password = screen.getByLabelText('รหัสผ่าน');
    fireEvent.change(username, { target: { value: 'operator' } });
    fireEvent.change(password, { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
    );

    fireEvent.change(password, { target: { value: 'corrected-password' } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(username).toHaveAttribute('aria-invalid', 'false');
    expect(password).toHaveAttribute('aria-invalid', 'false');
  });

  it('หยุด spinner เมื่อผู้ใช้เลือก reduced motion', () => {
    vi.mocked(authApi.config).mockImplementation(() => new Promise(() => {}));

    const { container } = renderLogin();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toHaveClass('motion-reduce:animate-none');
  });

  it('ให้ผู้ใช้คีย์บอร์ดเปิด/ปิดการแสดงรหัสผ่านได้', async () => {
    renderLogin();
    await openPasswordForm();

    const password = screen.getByLabelText('รหัสผ่าน');
    const reveal = screen.getByRole('button', { name: 'แสดงรหัสผ่าน' });
    expect(reveal).toHaveClass('size-11');

    expect(reveal).not.toHaveAttribute('tabindex', '-1');
    expect(password).toHaveAttribute('type', 'password');
    expect(reveal.querySelector('.lucide-eye-off')).toBeInTheDocument();
    expect(reveal.querySelector('.lucide-eye')).not.toBeInTheDocument();

    fireEvent.click(reveal);
    expect(password).toHaveAttribute('type', 'text');
    const conceal = screen.getByRole('button', { name: 'ซ่อนรหัสผ่าน' });
    expect(conceal.querySelector('.lucide-eye')).toBeInTheDocument();
    expect(conceal.querySelector('.lucide-eye-off')).not.toBeInTheDocument();
  });

  it('แสดงงานทั้งหมดเป็นภาษาอังกฤษตามค่าที่บันทึกไว้', async () => {
    renderLogin('en');

    expect(
      await screen.findByRole('button', { name: 'Sign in with Microsoft' }),
    ).toBeInTheDocument();

    expect(screen.getByLabelText('Username')).toBeRequired();
    expect(screen.getByLabelText('Username')).toHaveAttribute(
      'placeholder',
      'e.g. somchai.s',
    );
    expect(screen.getByLabelText('Password')).toBeRequired();
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'placeholder',
      'Enter password',
    );
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  describe('ปลายทางหลังเข้าสู่ระบบเมื่อเปลี่ยนบัญชี', () => {
    function renderWithDestination(from: string) {
      window.localStorage.setItem('bodycam.language', 'th');
      return render(
        <LanguageProvider>
          <ThemeProvider>
            <MemoryRouter
              initialEntries={[{ pathname: '/login', state: { from } }]}
            >
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/" element={<p>หน้าแรก</p>} />
                <Route path="/settings" element={<p>หน้าตั้งค่าระบบ</p>} />
              </Routes>
            </MemoryRouter>
          </ThemeProvider>
        </LanguageProvider>,
      );
    }

    async function signInAs(permissions: string[]) {
      vi.mocked(authApi.login).mockResolvedValue({
        accessToken: 'token-new',
        user: { ...SESSION_USER, id: 'u2', username: 'field1', roleCode: 'OPERATOR', permissions },
      });
      await openPasswordForm();
      fireEvent.change(screen.getByLabelText('ชื่อผู้ใช้'), { target: { value: 'field1' } });
      fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'Demo@12345' } });
      fireEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));
    }

    it('บัญชีใหม่ไม่มีสิทธิ์เข้าหน้าเดิม = ไปหน้าแรกพร้อมข้อความแจ้งว่าไม่มีสิทธิ์', async () => {
      renderWithDestination('/settings');
      await signInAs(['job:execute']);

      expect(await screen.findByText('หน้าแรก')).toBeInTheDocument();
      expect(screen.queryByText('หน้าตั้งค่าระบบ')).not.toBeInTheDocument();
      expect(useAuthStore.getState().notice).toEqual({
        key: 'auth.destinationBlocked',
        params: { path: '/settings' },
      });
    });

    it('บัญชีที่มีสิทธิ์ยังกลับไปหน้าเดิมตามปกติ ไม่มีข้อความค้าง', async () => {
      renderWithDestination('/settings');
      await signInAs(['settings:manage']);

      expect(await screen.findByText('หน้าตั้งค่าระบบ')).toBeInTheDocument();
      expect(useAuthStore.getState().notice).toBeNull();
    });
  });
});
