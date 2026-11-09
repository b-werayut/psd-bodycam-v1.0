import { useId, type ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';

import { canEnter } from '@/app/routeAccess';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/i18n/useLanguage';
import { useAuthStore } from '@/stores/authStore';

export function RequirePermission({
  anyOf,
  allOf,
  children,
}: {
  anyOf: readonly string[];
  allOf?: readonly string[];
  children: ReactNode;
}) {
  const user = useAuthStore((s) => s.user);
  const allowed = canEnter({ anyOf, allOf }, user?.permissions, user?.roleCode);
  const { t } = useLanguage();
  const titleId = useId();

  if (allowed) return <>{children}</>;

  // canEnter = (at least one of anyOf) AND (every allOf). A one-item anyOf is simply required,
  // so it joins the all-of list. "or" is only said where there really is a choice.
  const choice = anyOf.length > 1 ? anyOf : [];
  const mustHave = [...(anyOf.length === 1 ? anyOf : []), ...(allOf ?? [])];
  const choiceText = choice.join(` ${t('common.or')} `);
  const parts = [
    choice.length > 0 && mustHave.length > 0 ? `(${choiceText})` : choiceText,
    ...mustHave,
  ].filter(Boolean);
  const groups = [
    { key: 'any', label: t('permission.requiredLabel'), permissions: choice },
    { key: 'all', label: t('permission.requiredAllLabel'), permissions: mustHave },
  ].filter((group) => group.permissions.length > 0);

  return (
    <section
      role="alert"
      aria-labelledby={titleId}
      className="mx-auto w-full max-w-xl py-8 sm:py-16"
    >
      <Card className="border-border shadow-sm">
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center sm:p-10">
          <span className="flex size-12 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <ShieldAlert aria-hidden="true" className="size-6" />
          </span>
          <div className="max-w-md">
            <h1 id={titleId} className="text-xl font-semibold tracking-tight">
              {t('permission.deniedTitle')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t('permission.deniedDescription', {
                permissions: parts.join(` ${t('common.and')} `),
              })}
            </p>
          </div>
          {groups.map((group) => (
            <div
              key={group.key}
              role="group"
              aria-label={group.label}
              className="flex flex-col items-center gap-2"
            >
              <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {group.permissions.map((permission) => (
                  <Badge key={permission} variant="outline" className="nwl-mono bg-muted text-xs">
                    {permission}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
