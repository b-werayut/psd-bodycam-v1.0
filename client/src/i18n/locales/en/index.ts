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
import type { TranslationKey } from '../th';

export const en = {
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
} as const satisfies Record<TranslationKey, string>;
