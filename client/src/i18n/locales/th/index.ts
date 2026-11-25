import { common } from './common';
import { app } from './app';
import { audit } from './audit';
import { workOrders } from './workOrders';
import { auth } from './auth';
import { navigation } from './navigation';
import { permission } from './permission';
import { settings } from './settings';
import { tracking } from './tracking';
import { streaming } from './streaming';
import { talk } from './talk';
import { users } from './users';

export const th = {
  ...common,
  ...app,
  ...auth,
  ...navigation,
  ...permission,
  ...settings,
  ...audit,
  ...workOrders,
  ...users,
  ...tracking,
  ...streaming,
  ...talk,
} as const;

export type TranslationKey = keyof typeof th;
