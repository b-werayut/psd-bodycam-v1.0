import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { rolesApi } from './users.api';

/** Keep assignable role lists separate for each caller and filter privileged options locally. */
export function useAssignableRoles() {
  const actor = useAuthStore((state) => state.user);
  const query = useQuery({
    queryKey: ['roles', 'assignable', actor?.id, actor?.roleCode],
    queryFn: rolesApi.list,
  });
  return {
    roles: (query.data?.roles ?? []).filter(
      (role) => role.code !== 'SUPER_ADMIN' || actor?.roleCode === 'SUPER_ADMIN',
    ),
    isPending: query.isPending,
  };
}
