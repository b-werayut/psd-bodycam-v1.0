import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FormField, FormRequirementNote } from './form-field';
import { SearchSelect } from './search-select';

describe('FormField', () => {
  it('exposes the form-wide requirement guidance once as an accessible note', () => {
    render(
      <FormRequirementNote>
        All fields are required unless marked optional.
      </FormRequirementNote>,
    );

    expect(screen.getByRole('note')).toHaveTextContent(
      'All fields are required unless marked optional.',
    );
  });

  it('links corrective validation to the affected control', () => {
    render(
      <FormField id="employee-code" label="Employee code" error="Enter an employee code">
        <input id="employee-code" />
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Employee code' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'employee-code-error');
    expect(screen.getByRole('alert')).toHaveAttribute('id', 'employee-code-error');
  });

  it('links persistent help text without marking the control invalid', () => {
    render(
      <FormField id="employee-note" label="Note" hint="Optional">
        <input id="employee-note" />
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Note' });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).toHaveAttribute('aria-describedby', 'employee-note-description');
    expect(screen.getByText('Optional')).toHaveAttribute('id', 'employee-note-description');
  });

  it('marks optional fields in the persistent label without replacing help text', () => {
    render(
      <FormField
        id="employee-phone"
        label="Phone"
        optionalText="Optional"
        hint="Include the country code"
      >
        <input id="employee-phone" />
      </FormField>,
    );

    expect(screen.getByRole('textbox', { name: 'Phone (Optional)' })).toBeInTheDocument();
    expect(screen.getByText('(Optional)')).toHaveClass('font-normal', 'text-muted-foreground');
    expect(screen.getByText('Include the country code')).toBeInTheDocument();
  });

  it('forwards validation semantics through composite controls', () => {
    render(
      <FormField id="department" label="Department" error="Choose a department">
        <SearchSelect
          id="department"
          value=""
          onChange={() => undefined}
          options={[]}
          emptyText="No departments"
          clearLabel="Clear"
        />
      </FormField>,
    );

    const combobox = screen.getByRole('combobox', { name: 'Department' });
    expect(combobox).toHaveAttribute('aria-invalid', 'true');
    expect(combobox).toHaveAttribute('aria-describedby', 'department-error');
  });
});
