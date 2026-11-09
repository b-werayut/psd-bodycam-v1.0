import * as React from 'react';

import { cn } from '@/lib/utils';

type ScrollState = {
  overflow: boolean;
  start: boolean;
  end: boolean;
};

const INITIAL_SCROLL_STATE: ScrollState = {
  overflow: false,
  start: true,
  end: true,
};

interface HorizontalScrollRegionProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  viewportClassName?: string;
}

export function HorizontalScrollRegion({
  label,
  className,
  viewportClassName,
  children,
  onScroll,
  tabIndex,
  ...props
}: HorizontalScrollRegionProps) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = React.useState(INITIAL_SCROLL_STATE);

  const updateScrollState = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const overflow = viewport.scrollWidth > viewport.clientWidth + 1;
    const nextState = {
      overflow,
      start: !overflow || viewport.scrollLeft <= 1,
      end:
        !overflow ||
        viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 1,
    };

    setScrollState((current) =>
      current.overflow === nextState.overflow &&
      current.start === nextState.start &&
      current.end === nextState.end
        ? current
        : nextState,
    );
  }, []);

  React.useLayoutEffect(() => {
    updateScrollState();
  });

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    updateScrollState();
    window.addEventListener('resize', updateScrollState);

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScrollState);
    observer?.observe(viewport);
    if (viewport.firstElementChild) observer?.observe(viewport.firstElementChild);

    return () => {
      window.removeEventListener('resize', updateScrollState);
      observer?.disconnect();
    };
  }, [updateScrollState]);

  return (
    <div className={cn('relative min-w-0', className)} {...props}>
      <div
        ref={viewportRef}
        data-slot="horizontal-scroll-viewport"
        data-overflow={scrollState.overflow ? 'true' : 'false'}
        aria-label={label}
        tabIndex={scrollState.overflow ? (tabIndex ?? 0) : tabIndex}
        className={cn(
          'overflow-x-auto overscroll-x-contain [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          viewportClassName,
        )}
        onScroll={(event) => {
          updateScrollState();
          onScroll?.(event);
        }}
      >
        {children}
      </div>
      {scrollState.overflow && !scrollState.start ? (
        <span
          data-slot="scroll-fade-start"
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-card/90 to-transparent"
        />
      ) : null}
      {scrollState.overflow && !scrollState.end ? (
        <span
          data-slot="scroll-fade-end"
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-card/90 to-transparent"
        />
      ) : null}
    </div>
  );
}
