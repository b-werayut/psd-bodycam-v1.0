import * as React from 'react';

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from './field';
import { cn } from '@/lib/utils';

type DescribedControlProps = {
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'false' | 'true';
};

interface FormFieldProps {
  id: string;
  label: React.ReactNode;
  optionalText?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactElement<DescribedControlProps>;
  className?: string;
}

type FormRequirementNoteProps = Omit<
  React.HTMLAttributes<HTMLParagraphElement>,
  'role'
>;

function FormRequirementNote({ className, ...props }: FormRequirementNoteProps) {
  return (
    <p
      role="note"
      className={cn('text-caption text-muted-foreground', className)}
      {...props}
    />
  );
}

function FormField({
  id,
  label,
  optionalText,
  hint,
  error,
  children,
  className,
}: FormFieldProps) {
  const messageId = error
    ? `${id}-error`
    : hint
      ? `${id}-description`
      : undefined;
  const describedBy =
    [...new Set([children.props['aria-describedby'], messageId].filter(Boolean))].join(' ') ||
    undefined;
  const control = React.cloneElement(children, {
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : children.props['aria-invalid'],
  });

  return (
    <Field className={className} data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id} className="inline-flex items-baseline gap-1.5">
        <span>{label}</span>
        {optionalText ? (
          <span className="font-normal text-muted-foreground">({optionalText})</span>
        ) : null}
      </FieldLabel>
      {control}
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : hint ? (
        <FieldDescription id={`${id}-description`}>{hint}</FieldDescription>
      ) : null}
    </Field>
  );
}

export { FormField, FormRequirementNote };
export type { FormFieldProps, FormRequirementNoteProps };
