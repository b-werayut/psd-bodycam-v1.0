export const permission = {
  'permission.deniedTitle': 'You do not have access to this page',
  'permission.deniedDescription': 'Your account does not have {permissions} permission — contact an administrator if you need access.',
  'permission.requiredLabel': 'At least one required permission',
  'permission.requiredAllLabel': 'All of these permissions are required',
} as const satisfies Record<string, string>;
