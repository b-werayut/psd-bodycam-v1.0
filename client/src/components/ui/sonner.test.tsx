import { act, render, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';

import { Toaster } from './sonner';

describe('Toaster', () => {
  it('วาง toast ชิดล่างกึ่งกลางบนหน้าจอมือถือเพื่อให้เอื้อมถึงง่าย', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );

    const { container } = render(<Toaster />);
    act(() => {
      toast('ทดสอบตำแหน่ง', { id: 'mobile-position', duration: Infinity });
    });

    await waitFor(() =>
      expect(container.querySelector('[data-sonner-toaster]')).toBeInTheDocument(),
    );
    const viewport = container.querySelector('[data-sonner-toaster]')!;

    expect(viewport).toHaveAttribute('data-y-position', 'bottom');
    expect(viewport).toHaveAttribute('data-x-position', 'center');

    act(() => {
      toast.dismiss('mobile-position');
    });
  });

  it('จอกว้างวาง toast ขวาบนแต่เว้นใต้ header (ไม่บังกระดิ่ง/เมนูผู้ใช้ และไม่บังปุ่มบันทึกด้านล่าง)', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );

    const { container } = render(<Toaster />);
    act(() => {
      toast('ทดสอบตำแหน่ง', { id: 'desktop-position', duration: Infinity });
    });

    await waitFor(() =>
      expect(container.querySelector('[data-sonner-toaster]')).toBeInTheDocument(),
    );
    const viewport = container.querySelector('[data-sonner-toaster]')!;

    expect(viewport).toHaveAttribute('data-y-position', 'top');
    expect(viewport).toHaveAttribute('data-x-position', 'right');
    // header ของ AppLayout สูง min-h-14 (3.5rem) และ sticky — toast ต้องเริ่มใต้มัน
    const style = (viewport as HTMLElement).style;
    expect(style.getPropertyValue('--offset-top')).toBe('calc(3.5rem + 12px)');
    expect(style.getPropertyValue('--offset-right')).toBe('16px');

    act(() => {
      toast.dismiss('desktop-position');
    });
  });
});
