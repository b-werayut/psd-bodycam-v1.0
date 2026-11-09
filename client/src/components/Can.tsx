import type { ReactNode } from 'react';

import { usePermission } from '@/lib/usePermission';

type CanProps = {
  permission: string | readonly string[];
  mode?: 'all' | 'any';
  fallback?: ReactNode;
  children: ReactNode;
};

export function Can({ permission, mode = 'all', fallback, children }: CanProps) {
  const allowed = usePermission(permission, mode);
  return <>{allowed ? children : (fallback ?? null)}</>;
}
