import { render, screen } from '@testing-library/react';
import { ArrowRight } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { Badge } from './badge';
import { Button } from './button';
import { Card } from './card';
import { Input } from './input';
import { Select } from './select';
import { Tabs, TabsList, TabsTrigger } from './tabs';
import { Textarea } from './textarea';

describe('design-system controls', () => {
  it('keeps the primary control vocabulary comfortably tappable', () => {
    render(
      <>
        <Button>Save</Button>
        <Button size="icon" aria-label="Refresh">
          <ArrowRight data-icon="inline-start" />
        </Button>
        <Input aria-label="Name" />
        <Select aria-label="Company">
          <option>PSD</option>
        </Select>
        <Textarea aria-label="Note" />
      </>,
    );

    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveClass('size-11');
    const input = screen.getByRole('textbox', { name: 'Name' });
    const select = screen.getByRole('combobox', { name: 'Company' });
    const textarea = screen.getByRole('textbox', { name: 'Note' });

    expect(input).toHaveClass('h-11', 'text-control', '[@media(pointer:coarse)]:text-field');
    expect(select).toHaveClass('h-11', 'text-control', '[@media(pointer:coarse)]:text-field');
    expect(textarea).toHaveClass(
      'min-h-20',
      'text-control',
      '[@media(pointer:coarse)]:text-field',
    );
    expect(input).not.toHaveClass('text-body');
    expect(select).not.toHaveClass('text-body');
    expect(textarea).not.toHaveClass('text-body');
  });

  it('adds a shape cue to pressed controls so selection is not color-only', () => {
    render(
      <Button variant="outline" aria-pressed="true">
        Unread only
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Unread only' })).toHaveClass(
      'aria-[pressed=true]:ring-1',
      'aria-[pressed=true]:ring-primary/40',
    );
  });

  it('keeps primary actions stable while exposing active feedback and a shared extra-large size', () => {
    render(
      <Button size="xl">
        Continue
        <ArrowRight data-icon="inline-end" />
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button).toHaveClass('h-12', 'px-6', 'text-base');
    expect(button).toHaveClass('active:bg-primary/80', 'active:shadow-none');
    expect(button).not.toHaveClass('transition-all');
    expect(button).toHaveClass("[&_svg:not([class*='size-'])]:size-4");
  });

  it.each([
    ['input', <Input aria-label="Name" aria-invalid="true" />],
    ['select', <Select aria-label="Company" aria-invalid="true"><option>PSD</option></Select>],
    ['textarea', <Textarea aria-label="Note" aria-invalid="true" />],
  ])('shows an error boundary on an invalid %s', (_name, control) => {
    render(control);

    const field = screen.getByRole(_name === 'select' ? 'combobox' : _name === 'textarea' ? 'textbox' : 'textbox');
    expect(field).toHaveClass(
      'aria-invalid:border-destructive',
      'aria-invalid:ring-destructive/20',
    );
  });

  it('limits tab motion to visual state properties', () => {
    render(
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    const tab = screen.getByRole('tab', { name: 'Overview' });
    expect(tab).toHaveClass('transition-[color,background-color,box-shadow]');
    expect(tab).not.toHaveClass('transition-all');
  });

  it('shows badge focus treatment only for keyboard focus', () => {
    render(<Badge tabIndex={0}>Active</Badge>);

    const badge = screen.getByText('Active');
    expect(badge).toHaveClass('focus-visible:ring-2');
    expect(badge).not.toHaveClass('focus:ring-2');
  });

  it('uses a compact border-led card without resting elevation', () => {
    render(<Card data-testid="card">Operational content</Card>);

    const card = screen.getByTestId('card');
    expect(card).toHaveClass('rounded-lg', 'border', 'border-border', 'bg-card');
    expect(
      ['shadow', 'shadow-sm', 'shadow-md', 'shadow-lg'].some((className) =>
        card.classList.contains(className),
      ),
    ).toBe(false);
  });

  it('keeps destructive actions explicitly named and visually semantic', () => {
    render(<Button variant="destructive">Delete</Button>);

    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass(
      'bg-destructive',
      'text-destructive-foreground',
    );
  });
});
