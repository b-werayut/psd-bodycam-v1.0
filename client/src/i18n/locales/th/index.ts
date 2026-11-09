import { common } from './common';
import { departments } from './departments';
import { employees } from './employees';
import { app } from './app';
import { audit } from './audit';
import { auth } from './auth';
import { navigation } from './navigation';
import { permission } from './permission';
import { settings } from './settings';
import { users } from './users';

export const th = {
  ...common,
  ...app,
  ...auth,
  ...navigation,
  ...permission,
  ...departments,
  ...employees,
  ...settings,
  ...audit,
  ...users,
} as const;

export type TranslationKey = keyof typeof th;
