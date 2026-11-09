import type { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ToolButton } from './ToolButton';

/**
 * เมนู "•••" ท้ายแถวตาราง — ใช้เมื่อคอลัมน์เครื่องมือมีตั้งแต่ 3 ปุ่มขึ้นไป
 * ปุ่มที่ใช้บ่อยที่สุดของหน้านั้นอยู่นอกเมนู ที่เหลือยุบเข้ามา
 *
 * ⚠️ 2 ปุ่มไม่ต้องยุบ — ไม่ได้ลดความรก แต่เพิ่มคลิกไปถึงทุกอย่าง (ผู้ใช้ตัดสิน 2026-09-23)
 * ⚠️ ห้าม render เมนูเปล่า — ถ้าทุกรายการถูกซ่อนตามสิทธิ์/สถานะ ให้ผู้เรียกไม่ render ตัวเมนูเลย
 */
export function RowActionsMenu({
  label,
  children,
}: {
  /** ชื่อปุ่มที่ screen reader อ่าน — ต้องระบุว่าเป็นแถวไหน เช่น "การทำงานอื่นของ field1" */
  label: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <ToolButton type="button" aria-label={label} title={label}>
          <MoreHorizontal aria-hidden="true" />
        </ToolButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>{children}</DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RowActionItem({
  icon,
  label,
  reason,
  tone = 'neutral',
  disabled = false,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  /**
   * เหตุผลที่กดไม่ได้ — แสดงเป็น**ข้อความในเมนู** ไม่ใช่แค่ `title`
   * ⚠️ Radix ตั้ง `pointer-events-none` ให้รายการที่ disabled ดังนั้น tooltip ไม่ขึ้นเลย
   * และมือถือไม่มี hover อยู่แล้ว · ไม่มีบรรทัดนี้ = กฎ "disable พร้อมบอกเหตุผล" หายไปเงียบ ๆ
   */
  reason?: string;
  tone?: 'neutral' | 'danger';
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      data-slot="row-action"
      disabled={disabled}
      className={cn(
        'items-start',
        tone === 'danger' && !disabled
          ? 'text-destructive focus:bg-destructive/10 focus:text-destructive'
          : undefined,
      )}
      onSelect={() => onSelect()}
    >
      <span className="mt-0.5 flex shrink-0">{icon}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>{label}</span>
        {reason ? (
          <span data-slot="row-action-reason" className="text-xs text-muted-foreground">
            {reason}
          </span>
        ) : null}
      </span>
    </DropdownMenuItem>
  );
}
