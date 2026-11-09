export type AuthUserLike = {
  id: bigint;
  username: string;
  roleId: bigint;
  roleCode: string;
  departmentId: bigint | null;
};
