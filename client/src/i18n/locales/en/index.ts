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
import { evidence } from './evidence';
import { users } from './users';
import type { TranslationKey } from '../th';

export const en = {
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
  ...evidence,
} as const satisfies Record<TranslationKey, string>;
