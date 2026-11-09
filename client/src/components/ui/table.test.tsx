import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

describe('Table', () => {
  it('keeps operational data readable without giving up compact density', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Device</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>BC-014</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByRole('table')).toHaveClass('text-control');
    expect(screen.getByRole('table')).not.toHaveClass('text-[13px]');
    expect(screen.getByRole('columnheader')).toHaveClass('h-10', 'px-3', 'text-caption');
    expect(screen.getByRole('columnheader')).toHaveAttribute('scope', 'col');
    expect(screen.getByRole('cell')).toHaveClass('h-10', 'px-3', 'py-2');
  });
});
