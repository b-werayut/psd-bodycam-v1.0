import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import type { TranslationKey } from '@/i18n/locales/th';
import { useLanguage } from '@/i18n/useLanguage';
import { isNavItemActive, type NavGroupId, type NavItem } from '@/app/nav';
import {
  BRANCH_INDENT,
  branchGeometry,
  readFoldedGroups,
  toggleFolded,
  writeFoldedGroups,
} from './branchedNavRules';

export type BranchedNavGroup = { id: NavGroupId; labelKey: TranslationKey; items: NavItem[] };

const MARKER_HEIGHT = 16;

/**
 * เมนูหลักตอน sidebar กางอยู่ — port จาก React Bits "Branched Menu" (reactbits.dev/micro/branched-menu)
 * แต่ละกลุ่มแตกกิ่งจากลำต้น เส้นสีแบรนด์ลากจากบนสุดมาหาหน้าที่เลือก · กดหัวกลุ่มเพื่อพับ/กาง
 *
 * - ตั้งต้นเปิดทุกกลุ่ม (user decision 2026-10-15) · กลุ่มที่พับจำไว้ใน localStorage ของเบราว์เซอร์นั้น
 * - เปลี่ยนไปหน้าที่อยู่ในกลุ่มที่พับไว้ = กางกลุ่มนั้นให้เอง ไม่งั้นมองไม่เห็นว่าอยู่หน้าไหน
 * - sidebar ย่อ 72px ไม่ใช้ component นี้ (กลับเป็นไอคอนแบบเดิมใน AppSidebar)
 * สไตล์อยู่ใน `styles/global.css` (`.branched-nav*`) ใช้ token ของ sidebar
 */
export function BranchedNav({
  groups,
  rowHeight,
  onNavigate,
}: {
  groups: BranchedNavGroup[];
  rowHeight: number;
  onNavigate?: () => void;
}) {
  const { t } = useLanguage();
  const { pathname } = useLocation();
  const baseId = useId();
  const [folded, setFolded] = useState(readFoldedGroups);
  const rootRef = useRef<HTMLDivElement>(null);
  const headRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const markerRef = useRef<HTMLSpanElement>(null);

  const activeIndex = groups.findIndex((group) =>
    group.items.some((item) => isNavItemActive(item, pathname)),
  );
  const activeGroupId = activeIndex >= 0 ? groups[activeIndex].id : null;
  const markerShown = activeGroupId !== null && !folded.has(activeGroupId);

  useEffect(() => {
    if (activeGroupId === null) return;
    setFolded((prev) => (prev.has(activeGroupId) ? toggleFolded(prev, activeGroupId) : prev));
  }, [activeGroupId]);

  useEffect(() => {
    writeFoldedGroups(folded);
  }, [folded]);

  // ขีดสีข้างหัวกลุ่มที่มีหน้าที่เลือก — เลื่อนตามเมื่อเปลี่ยนกลุ่ม แต่ตอนความสูงเปลี่ยน (พับกลุ่มอื่น) วางทันที
  useLayoutEffect(() => {
    const place = (glide: boolean) => {
      const marker = markerRef.current;
      if (!marker) return;
      const head = activeIndex >= 0 ? headRefs.current[activeIndex] : null;
      const on = markerShown && head;
      if (!glide) marker.style.transition = 'none';
      if (on) marker.style.top = `${head.offsetTop + (head.offsetHeight - MARKER_HEIGHT) / 2}px`;
      marker.toggleAttribute('data-on', Boolean(on));
      if (!glide) {
        void marker.offsetHeight;
        marker.style.transition = '';
      }
    };
    place(true);
    if (typeof ResizeObserver === 'undefined' || !rootRef.current) return undefined;
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      place(false);
    });
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [activeIndex, markerShown, groups, rowHeight]);

  return (
    <div
      ref={rootRef}
      className="branched-nav"
      style={{ '--bn-row': `${rowHeight}px`, '--bn-indent': `${BRANCH_INDENT}px` } as CSSProperties}
    >
      <span ref={markerRef} className="branched-nav__marker" aria-hidden="true" />
      {groups.map((group, index) => {
        const open = !folded.has(group.id);
        const geometry = branchGeometry(group.items.length, rowHeight);
        const activeRow = group.items.findIndex((item) => isNavItemActive(item, pathname));
        const bodyId = `${baseId}-${group.id}`;
        return (
          <div key={group.id} className="branched-nav__section" data-open={open ? '' : undefined}>
            <button
              ref={(node) => {
                headRefs.current[index] = node;
              }}
              type="button"
              className="branched-nav__head"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => setFolded((prev) => toggleFolded(prev, group.id))}
            >
              <span className="text-caption font-semibold">{t(group.labelKey)}</span>
            </button>
            <div id={bodyId} className="branched-nav__body" aria-hidden={open ? undefined : true}>
              <div className="branched-nav__fold">
                <div className="branched-nav__tree" style={{ height: geometry.height }}>
                  <svg
                    className="branched-nav__lines"
                    width={BRANCH_INDENT}
                    height={geometry.height}
                    aria-hidden="true"
                  >
                    <path className="branched-nav__base" d={geometry.trunk} />
                    {geometry.branches.map((d, k) => (
                      <path key={`base-${group.items[k].labelKey}`} className="branched-nav__base" d={d} />
                    ))}
                    {geometry.reaches.map((d, k) => (
                      <path
                        key={`reach-${group.items[k].labelKey}`}
                        className="branched-nav__reach"
                        data-active={k === activeRow ? '' : undefined}
                        d={d}
                        style={{
                          strokeDasharray: geometry.lengths[k],
                          strokeDashoffset: k === activeRow ? 0 : geometry.lengths[k],
                        }}
                      />
                    ))}
                  </svg>
                  {group.items.map((item) => (
                    <BranchedNavRow
                      key={item.labelKey}
                      item={item}
                      focusable={open}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BranchedNavRow({
  item,
  focusable,
  onNavigate,
}: {
  item: NavItem;
  focusable: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useLanguage();
  const label = t(item.labelKey);
  const icon = <item.icon aria-hidden="true" size={16} strokeWidth={1.5} />;

  if (!item.to) {
    return (
      <span
        role="link"
        aria-disabled="true"
        aria-label={t('navigation.itemUnavailable', { label })}
        title={t('navigation.unavailable')}
        className="branched-nav__item"
        data-disabled=""
      >
        <span className="branched-nav__icon">{icon}</span>
        <span className="branched-nav__label">{label}</span>
      </span>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      aria-label={label}
      tabIndex={focusable ? undefined : -1}
      onClick={onNavigate}
      className="branched-nav__item"
    >
      <span className="branched-nav__icon">{icon}</span>
      <span className="branched-nav__label">{label}</span>
    </NavLink>
  );
}
