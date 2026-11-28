import type { ReactNode } from 'react';

export interface PageTransitionProps {
  transitionKey: string;
  disabled?: boolean;
  children: ReactNode;
}

export function PageTransition({ transitionKey, disabled = false, children }: PageTransitionProps) {
  if (disabled) {
    return <>{children}</>;
  }

  // Frequent operational navigation should reveal usable content immediately.
  // Keep the same wrapper (and full-bleed opt-out) without moving the workspace.
  return <div key={transitionKey} className="h-full">{children}</div>;
}
