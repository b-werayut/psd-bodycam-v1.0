import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Field, FieldError, FieldGroup, FieldLabel } from './field';

describe('FieldError', () => {
  it('keeps compact readable type alongside the semantic destructive color', () => {
    render(<FieldError>Enter a valid value</FieldError>);

    expect(screen.getByRole('alert')).toHaveClass('text-xs', 'text-destructive');
  });
});

describe('FieldLabel', () => {
  it('uses the compact medium-weight label role', () => {
    render(<FieldLabel>Camera</FieldLabel>);

    const label = screen.getByText('Camera');
    expect(label).toHaveClass('text-control', 'font-medium');
    expect(label).not.toHaveClass('font-semibold');
  });
});

describe('Field', () => {
  it('stacks labels and controls with the shared 8px relationship gap', () => {
    render(<Field data-testid="field">Content</Field>);

    expect(screen.getByTestId('field')).toHaveClass('flex-col', 'gap-2');
    expect(screen.getByTestId('field')).toHaveAttribute('data-orientation', 'vertical');
  });

  it('separates related fields with the shared 24px group gap', () => {
    render(<FieldGroup data-testid="field-group">Content</FieldGroup>);

    expect(screen.getByTestId('field-group')).toHaveClass('gap-6');
  });
});
