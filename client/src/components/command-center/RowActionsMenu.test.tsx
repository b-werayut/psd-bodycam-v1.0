import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RowActionItem, RowActionsMenu } from './index';

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'คำสั่งเพิ่มเติมสำหรับ field1' }));
  return user;
}

describe('RowActionsMenu', () => {
  it('ยุบคำสั่งไว้หลังปุ่มเดียวที่มีชื่อบอกว่าเป็นแถวไหน', async () => {
    render(
      <RowActionsMenu label="คำสั่งเพิ่มเติมสำหรับ field1">
        <RowActionItem icon={<span aria-hidden="true" />} label="ลบผู้ใช้" onSelect={vi.fn()} />
      </RowActionsMenu>,
    );

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();

    await openMenu();

    expect(screen.getByRole('menuitem', { name: 'ลบผู้ใช้' })).toBeInTheDocument();
  });

  it('เลือกรายการแล้วเรียก onSelect', async () => {
    const onSelect = vi.fn();
    render(
      <RowActionsMenu label="คำสั่งเพิ่มเติมสำหรับ field1">
        <RowActionItem icon={<span aria-hidden="true" />} label="ลบผู้ใช้" onSelect={onSelect} />
      </RowActionsMenu>,
    );

    const user = await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'ลบผู้ใช้' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('**เหตุผลที่กดไม่ได้ต้องเป็นข้อความในเมนู ไม่ใช่แค่ title** — มือถือไม่มี hover', async () => {
    render(
      <RowActionsMenu label="คำสั่งเพิ่มเติมสำหรับ field1">
        <RowActionItem
          icon={<span aria-hidden="true" />}
          label="ลบผู้ใช้"
          reason="ลบบัญชีที่กำลังใช้งานอยู่ไม่ได้"
          disabled
          onSelect={vi.fn()}
        />
      </RowActionsMenu>,
    );

    await openMenu();

    const item = await screen.findByRole('menuitem', { name: /^ลบผู้ใช้/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('ลบบัญชีที่กำลังใช้งานอยู่ไม่ได้')).toBeInTheDocument();
  });

  it('รายการที่ปิดอยู่กดแล้วต้องไม่ทำงาน', async () => {
    const onSelect = vi.fn();
    render(
      <RowActionsMenu label="คำสั่งเพิ่มเติมสำหรับ field1">
        <RowActionItem
          icon={<span aria-hidden="true" />}
          label="ลบผู้ใช้"
          reason="ลบบัญชีที่กำลังใช้งานอยู่ไม่ได้"
          disabled
          onSelect={onSelect}
        />
      </RowActionsMenu>,
    );

    const user = await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: /^ลบผู้ใช้/ }));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('รายการอันตรายใช้โทน destructive และไม่ใช้สีนั้นตอนถูกปิด', async () => {
    const { unmount } = render(
      <RowActionsMenu label="คำสั่งเพิ่มเติมสำหรับ field1">
        <RowActionItem
          icon={<span aria-hidden="true" />}
          label="ลบผู้ใช้"
          tone="danger"
          onSelect={vi.fn()}
        />
      </RowActionsMenu>,
    );

    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'ลบผู้ใช้' })).toHaveClass('text-destructive');

    unmount();
    render(
      <RowActionsMenu label="คำสั่งเพิ่มเติมสำหรับ field1">
        <RowActionItem
          icon={<span aria-hidden="true" />}
          label="ลบผู้ใช้"
          tone="danger"
          disabled
          onSelect={vi.fn()}
        />
      </RowActionsMenu>,
    );

    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'ลบผู้ใช้' })).not.toHaveClass(
      'text-destructive',
    );
  });
});
