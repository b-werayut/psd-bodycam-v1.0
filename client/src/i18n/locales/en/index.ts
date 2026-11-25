import { common } from './common';
import { app } from './app';
import { audit } from './audit';
import { auth } from './auth';
import { navigation } from './navigation';
import { permission } from './permission';
import { settings } from './settings';
import { tracking } from './tracking';
import { streaming } from './streaming';
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
  ...users,
  ...tracking,
  ...streaming,
} as const satisfies Record<TranslationKey, string>;
