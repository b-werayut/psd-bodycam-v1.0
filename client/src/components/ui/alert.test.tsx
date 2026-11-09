import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Alert, AlertDescription } from './alert';

describe('Alert feedback scope', () => {
  it('ทำให้ form error กระชับและระบุ scope สำหรับใช้งานใกล้ action', () => {
    render(
      <Alert variant="destructive" feedbackScope="form">
        <AlertDescription>บันทึกข้อมูลไม่สำเร็จ</AlertDescription>
      </Alert>,
    );

    expect(screen.getByRole('alert')).toHaveAttribute('data-feedback-scope', 'form');
    expect(screen.getByRole('alert')).toHaveClass('py-3', 'bg-destructive/5');
  });

  it('ระบุ page และ operational scope โดยยังคง semantics ของ alert', () => {
    const { rerender } = render(
      <Alert feedbackScope="page">
        <AlertDescription>โหลดข้อมูลไม่สำเร็จ</AlertDescription>
      </Alert>,
    );

    expect(screen.getByRole('alert')).toHaveAttribute('data-feedback-scope', 'page');

    rerender(
      <Alert feedbackScope="operational">
        <AlertDescription>สตรีมขัดข้อง</AlertDescription>
      </Alert>,
    );
    expect(screen.getByRole('alert')).toHaveAttribute('data-feedback-scope', 'operational');
    expect(screen.getByRole('alert')).toHaveClass('py-3');
  });
});
