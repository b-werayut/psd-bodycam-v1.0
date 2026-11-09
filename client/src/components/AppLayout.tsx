import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { RealtimeProvider } from '@/providers/RealtimeProvider';
import { useLanguage } from '@/i18n/useLanguage';
import { actionToast } from '@/components/ui/action-toast';
import { Toaster } from '@/components/ui/sonner';
import { useAuthStore } from '@/stores/authStore';
import { AppHeader } from './layout/AppHeader';
import { AppSidebar } from './layout/AppSidebar';
import { PageTransition } from './motion/PageTransition';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

/** หน้าเต็มพื้นที่ (ไม่มี padding ของ main) — P0 ยังไม่มี, P1 เพิ่มหน้าแผนที่ติดตาม */
const FULL_BLEED_ROUTES = new Set<string>();

function AppLayoutContent() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const isFullBleedRoute = FULL_BLEED_ROUTES.has(location.pathname);
  const { t } = useLanguage();

  useEffect(() => {
    setMobileNavigationOpen(false);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  const notice = useAuthStore((state) => state.notice);
  const signedIn = Boolean(useAuthStore((state) => state.accessToken));
  const consumeNotice = useAuthStore((state) => state.consumeNotice);
  useEffect(() => {
    // ⚠️ ไม่มี token แล้ว = ระบบเพิ่งตัด session ทิ้ง ข้อความนั้นเป็นของ "หน้า login"
    // กินตรงนี้ = toast แวบเดียวบนหน้าที่กำลังจะถูกเด้งทิ้ง แล้วหน้า login ไม่เหลืออะไรให้อ่าน
    if (!notice || !signedIn) return;
    const taken = consumeNotice();
    if (taken) actionToast.error(t(taken.key, taken.params));
  }, [notice, signedIn, consumeNotice, t]);

  return (
    <div className="operations-theme flex min-h-dvh flex-col bg-background text-foreground lg:flex-row">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-50 -translate-y-20 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:translate-y-0"
      >
        {t('app.skipToMain')}
      </a>
      <AppSidebar collapsed={collapsed} />
      <Dialog open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader
            collapsed={collapsed}
            onToggleSidebar={() => setCollapsed((value) => !value)}
          />
          <main
            id="main-content"
            ref={mainRef}
            tabIndex={-1}
            className={cn(
              'min-w-0 flex-1 outline-none',
              // หน้าเต็มจอ: main เป็น flex column + ลูกโดยตรงยืดเต็ม — กรอบนอกเป็นแค่ min-h-dvh
              // บนมือถือ (flex-col) ความสูงของ main จึงไม่ "definite" และ h-full ของหน้าตกไปที่ min-h
              // เหลือแถบว่างใต้แผนที่ (desktop รอดเพราะ lg:flex-row ยืด cross-axis ให้)
              isFullBleedRoute
                ? 'flex flex-col overflow-hidden p-0 [&>*]:flex-1'
                : 'p-4 sm:p-5 xl:p-6',
            )}
          >
            <PageTransition transitionKey={location.pathname} disabled={isFullBleedRoute}>
              <Outlet />
            </PageTransition>
          </main>
        </div>
        <DialogContent variant="drawer" closeLabel={t('header.closeNavigation')}>
          <DialogHeader className="sr-only">
            <DialogTitle>{t('navigation.primary')}</DialogTitle>
          </DialogHeader>
          <AppSidebar
            collapsed={false}
            variant="drawer"
            onNavigate={() => setMobileNavigationOpen(false)}
          />
        </DialogContent>
      </Dialog>
      <Toaster />
    </div>
  );
}

export function AppLayout() {
  return (
    <RealtimeProvider>
      <AppLayoutContent />
    </RealtimeProvider>
  );
}
