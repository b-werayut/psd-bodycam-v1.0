import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Toaster } from './sonner';
import { actionToast } from './action-toast';

function renderToaster() {
  return render(<Toaster />);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('actionToast', () => {
  it('สำเร็จ = หัวเรื่องโทนเขียว (success) พร้อมแถบสีซ้าย', async () => {
    renderToaster();

    actionToast.success('จำแนกบริษัทแล้ว', 'ผูกกับรถต่อได้เลย');

    const title = (await screen.findAllByText('จำแนกบริษัทแล้ว'))[0];
    expect(title).toHaveClass('text-success');
    const card = title.closest('div')?.parentElement;
    expect(card?.querySelector('.bg-success')).not.toBeNull();
    expect(screen.getAllByText('ผูกกับรถต่อได้เลย').length).toBeGreaterThan(0);
  });

  it('ล้มเหลว = หัวเรื่องโทนแดง (destructive)', async () => {
    renderToaster();

    actionToast.error('ผูกอุปกรณ์ไม่สำเร็จ', 'อุปกรณ์นี้ยังไม่ได้จำแนกบริษัท');

    const title = (await screen.findAllByText('ผูกอุปกรณ์ไม่สำเร็จ'))[0];
    expect(title).toHaveClass('text-destructive');
    const card = title.closest('div')?.parentElement;
    expect(card?.querySelector('.bg-destructive')).not.toBeNull();
  });

  it('ไม่มีคำอธิบาย = แสดงแค่หัวเรื่อง ไม่มีบรรทัดว่าง', async () => {
    renderToaster();

    actionToast.success('ปลดการผูกแล้ว');

    const title = (await screen.findAllByText('ปลดการผูกแล้ว'))[0];
    expect(title.parentElement?.querySelectorAll('p')).toHaveLength(1);
  });
});
