import { common } from './common';
import { app } from './app';
import { audit } from './audit';
import { auth } from './auth';
import { navigation } from './navigation';
import { permission } from './permission';
import { settings } from './settings';
import { tracking } from './tracking';
import { users } from './users';

export const th = {
  ...common,
  ...app,
  ...auth,
  ...navigation,
  ...permission,
  ...settings,
  ...audit,
  ...users,
  ...tracking,
} as const;

export type TranslationKey = keyof typeof th;
