import { m } from 'motion/react';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

import { itemVariants } from '@/lib/motion';

const StaggerContext = createContext(false);

export interface StaggerGroupProps {
  ready: boolean;
  children?: ReactNode;
  className?: string;
}

export function StaggerGroup({ ready, children, className }: StaggerGroupProps) {
  const animatedRef = useRef(false);
  const shouldAnimate = ready && !animatedRef.current;

  useEffect(() => {
    if (ready) animatedRef.current = true;
  }, [ready]);

  return (
    <StaggerContext.Provider value={shouldAnimate}>
      <div className={className}>{children}</div>
    </StaggerContext.Provider>
  );
}

export interface StaggerItemProps {
  index: number;
  children: ReactNode;
  className?: string;
}

export function StaggerItem({ index, children, className }: StaggerItemProps) {
  const animate = useContext(StaggerContext);

  return (
    <m.div
      custom={index}
      variants={itemVariants}
      initial={animate ? 'hidden' : false}
      animate="visible"
      exit="exit"
      className={className}
    >
      {children}
    </m.div>
  );
}
