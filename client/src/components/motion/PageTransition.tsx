import { m } from 'motion/react';
import type { ReactNode } from 'react';

import { pageVariants } from '@/lib/motion';

export interface PageTransitionProps {
  transitionKey: string;
  disabled?: boolean;
  children: ReactNode;
}

export function PageTransition({ transitionKey, disabled = false, children }: PageTransitionProps) {
  if (disabled) {
    return <>{children}</>;
  }

  return (
    <m.div
      key={transitionKey}
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      className="h-full"
    >
      {children}
    </m.div>
  );
}
