import { useEffect, useState } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

const MOBILE_QUERY = '(max-width: 639px)';

/**
 * จอกว้าง: ขวาบน แต่เว้นใต้ header (AppLayout `min-h-14` = 3.5rem, sticky) ไม่ให้บังกระดิ่ง/เมนูผู้ใช้
 * ⚠️ ไม่วางขวาล่าง — บังปุ่มบันทึกท้าย dialog และแถบปุ่ม sticky ที่คนกำลังจะกดซ้ำ (user decision 2026-10-16)
 * เปลี่ยนความสูง header ต้องแก้ค่านี้ด้วย
 */
const DESKTOP_OFFSET = { top: 'calc(3.5rem + 12px)', right: 16, bottom: 16, left: 16 };

export function Toaster({ position, swipeDirections, ...props }: ToasterProps) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(MOBILE_QUERY).matches === true,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const mediaQuery = window.matchMedia(MOBILE_QUERY);
    const updatePosition = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener('change', updatePosition);
    return () => mediaQuery.removeEventListener('change', updatePosition);
  }, []);

  return (
    <Sonner
      className="font-sans [--width:24rem]"
      gap={8}
      mobileOffset={12}
      offset={DESKTOP_OFFSET}
      position={position ?? (isMobile ? 'bottom-center' : 'top-right')}
      swipeDirections={swipeDirections ?? (isMobile ? ['bottom'] : ['right'])}
      visibleToasts={4}
      {...props}
    />
  );
}
