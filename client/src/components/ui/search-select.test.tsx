import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from './dialog';
import { SearchSelect } from './search-select';

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="pick">บริษัทที่จะผูก</label>
      <SearchSelect
        id="pick"
        value={value}
        onChange={setValue}
        options={[
          { value: '1', label: 'บริษัทบัญชี (ACC)' },
          { value: '2', label: 'บริษัทสร้างบ้าน (HOUSE)' },
          { value: '3', label: 'ปิดไว้', disabled: true },
        ]}
        emptyText="ไม่พบรายการ"
        clearLabel="ล้างค่า"
      />
      <button type="button">ปุ่มข้างนอก</button>
      <output data-testid="picked">{value}</output>
    </>
  );
}

describe('SearchSelect', () => {
  it('ให้ปุ่มล้างค่าและตัวเลือกมีพื้นที่แตะอย่างน้อย 44px บนอุปกรณ์สัมผัส', async () => {
    render(<Harness initial="1" />);

    expect(screen.getByRole('button', { name: 'ล้างค่า' })).toHaveClass(
      'size-11',
      '[@media(pointer:fine)]:size-8',
    );

    await userEvent.click(screen.getByLabelText('บริษัทที่จะผูก'));

    for (const option of screen.getAllByRole('option')) {
      expect(option).toHaveClass('min-h-11', '[@media(pointer:fine)]:min-h-9');
    }
  });

  it('คลิกเลือกแล้วปิดรายการและโชว์ป้ายทันที ไม่ต้องไปคลิกที่อื่นก่อน', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByLabelText('บริษัทที่จะผูก'));
    await userEvent.click(await screen.findByRole('option', { name: /บริษัทบัญชี/ }));

    expect(screen.getByTestId('picked')).toHaveTextContent('1');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('บริษัทที่จะผูก')).toHaveValue('บริษัทบัญชี (ACC)');
  });

  it('เลือกด้วยลูกศรขึ้น/ลงและ Enter แล้วปิดรายการ', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByLabelText('บริษัทที่จะผูก'));
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Enter}');

    expect(screen.getByTestId('picked')).toHaveTextContent('1');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('วางคำค้นแล้วกรองรายการ และ Escape ปิดโดยไม่เปลี่ยนค่า', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const combobox = screen.getByLabelText('บริษัทที่จะผูก');
    await user.click(combobox);
    await user.paste('สร้างบ้าน');

    expect(screen.getByRole('option', { name: /บริษัทสร้างบ้าน/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /บริษัทบัญชี/ })).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('picked')).toHaveTextContent('');
  });

  it('ล้างค่าที่เลือกแล้วคืนโฟกัสให้ combobox', async () => {
    render(<Harness initial="1" />);

    await userEvent.click(screen.getByRole('button', { name: 'ล้างค่า' }));

    expect(screen.getByTestId('picked')).toHaveTextContent('');
    expect(screen.getByLabelText('บริษัทที่จะผูก')).toHaveFocus();
  });

  it('คลิก option ที่ปิดไว้ไม่เปลี่ยนค่าและรายการยังเปิดอยู่', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByLabelText('บริษัทที่จะผูก'));
    await userEvent.click(await screen.findByRole('option', { name: 'ปิดไว้' }));

    expect(screen.getByTestId('picked')).toHaveTextContent('');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('คลิกที่อื่นปิดรายการโดยไม่เปลี่ยนค่า', async () => {
    render(<Harness initial="1" />);

    await userEvent.click(screen.getByLabelText('บริษัทที่จะผูก'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ปุ่มข้างนอก' }));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('picked')).toHaveTextContent('1');
  });
});

describe('SearchSelect — รายการหนีกรอบที่ overflow-hidden', () => {
  it('รายการ portal ไปที่ document.body ไม่อยู่ในกล่องที่ครอบช่อง', async () => {
    render(
      <div data-testid="clipping-card" style={{ overflow: 'hidden' }}>
        <Harness />
      </div>,
    );

    await userEvent.click(screen.getByLabelText('บริษัทที่จะผูก'));
    const list = screen.getByRole('listbox');
    const options = screen.getAllByRole('option');

    expect(list.parentElement).toBe(document.body);
    expect(screen.getByTestId('clipping-card')).not.toContainElement(list);
    expect(list).toHaveClass('fixed', 'overflow-y-auto');
    expect(screen.getByLabelText('บริษัทที่จะผูก')).toHaveClass(
      'text-control',
      '[@media(pointer:coarse)]:text-field',
    );
    for (const option of options) {
      expect(option).toHaveClass('text-control');
      expect(option).not.toHaveClass('text-sm');
    }
  });

  it('ปลด pointer-events ของตัวเองไว้ (ใช้ในกล่อง dialog ได้)', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByLabelText('บริษัทที่จะผูก'));

    expect(screen.getByRole('listbox')).toHaveStyle({ pointerEvents: 'auto' });
  });
});

describe('SearchSelect — ใช้ใน Dialog', () => {
  it('ไม่ยกเลิก wheel ของรายการที่ portal ออกนอก Dialog', async () => {
    render(
      <Dialog open>
        <DialogContent closeLabel="ปิด">
          <DialogTitle>แก้ไขพนักงาน</DialogTitle>
          <Harness />
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole('button', { name: 'ปิด' })).toHaveClass('size-11');

    await userEvent.click(screen.getByLabelText('บริษัทที่จะผูก'));
    const list = screen.getByRole('listbox');
    const wheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 120,
    });

    fireEvent(list, wheel);

    expect(wheel.defaultPrevented).toBe(false);
  });
});
