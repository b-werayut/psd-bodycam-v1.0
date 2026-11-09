import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DateRangePicker } from './calendar-range-select';

describe('DateRangePicker', () => {
  it('exposes its accessible name with compact tabular date typography', () => {
    render(
      <DateRangePicker
        value={{
          from: new Date(2026, 8, 9),
          to: new Date(2026, 8, 10),
        }}
        onChange={vi.fn()}
        language="th"
        ariaLabel="ช่วงวันที่"
        placeholder="เลือกช่วงวันที่"
        selectEndLabel="เลือกวันสิ้นสุด"
        clearLabel="ล้าง"
      />,
    );

    expect(screen.getByRole('button', { name: 'ช่วงวันที่' })).toHaveClass(
      'text-control',
      '[@media(pointer:coarse)]:text-field',
      'tabular-nums',
    );
  });

  it('keeps compact control typography when showing its placeholder', () => {
    render(
      <DateRangePicker
        onChange={vi.fn()}
        language="en"
        ariaLabel="Date range"
        placeholder="Choose a date range"
        selectEndLabel="Choose an end date"
        clearLabel="Clear"
      />,
    );

    expect(screen.getByRole('button', { name: 'Date range' })).toHaveClass(
      'text-control',
      '[@media(pointer:coarse)]:text-field',
    );
    expect(screen.getByText('Choose a date range')).toHaveClass('text-muted-foreground');
  });
});
