import { describe, expect, it } from 'vitest';

import type { DepartmentNode } from './departments.api';
import {
  departmentFormFrom,
  descendantIds,
  emptyDepartmentForm,
  filterTree,
  parentOptions,
  toCreatePayload,
  toUpdatePayload,
  validateDepartmentForm,
} from './departmentForm';

const node = (id: string, children: DepartmentNode[] = [], parentId: string | null = null): DepartmentNode => ({
  id,
  code: `C${id}`,
  name: `Dept ${id}`,
  parentId,
  isActive: true,
  children,
});

// 1 -> (2 -> (4, 5), 3) ; 6 root
const TREE: DepartmentNode[] = [
  node('1', [node('2', [node('4', [], '2'), node('5', [], '2')], '1'), node('3', [], '1')]),
  node('6'),
];

describe('descendantIds', () => {
  it('collects all descendants of a node across 3 levels, excluding itself', () => {
    expect(descendantIds(TREE, '1')).toEqual(new Set(['2', '3', '4', '5']));
    expect(descendantIds(TREE, '2')).toEqual(new Set(['4', '5']));
  });
  it('is empty for a leaf or unknown id', () => {
    expect(descendantIds(TREE, '4').size).toBe(0);
    expect(descendantIds(TREE, '99').size).toBe(0);
  });
});

describe('parentOptions', () => {
  it('excludes the department itself and its descendants', () => {
    expect(parentOptions(TREE, '2').map((o) => o.id)).toEqual(['1', '3', '6']);
  });
  it('lists everything when creating', () => {
    expect(parentOptions(TREE).map((o) => o.id)).toEqual(['1', '2', '4', '5', '3', '6']);
  });
});

describe('filterTree', () => {
  it('keeps matching nodes with their ancestors', () => {
    const result = filterTree(TREE, 'dept 4');
    expect(result.map((n) => n.id)).toEqual(['1']);
    expect(result[0].children.map((n) => n.id)).toEqual(['2']);
    expect(result[0].children[0].children.map((n) => n.id)).toEqual(['4']);
  });
  it('returns the tree for an empty query', () => {
    expect(filterTree(TREE, ' ')).toBe(TREE);
  });
});

describe('validateDepartmentForm', () => {
  it('requires code and name', () => {
    expect(validateDepartmentForm(emptyDepartmentForm())).toEqual({
      code: 'departments.form.errorCodeRequired',
      name: 'departments.form.errorNameRequired',
    });
  });
  it('limits lengths', () => {
    const errors = validateDepartmentForm({
      ...emptyDepartmentForm(),
      code: 'x'.repeat(21),
      name: 'y'.repeat(151),
    });
    expect(errors.code).toBe('departments.form.errorCodeLong');
    expect(errors.name).toBe('departments.form.errorNameLong');
  });
});

describe('payloads', () => {
  it('builds create payload, omitting empty parent', () => {
    expect(toCreatePayload({ ...emptyDepartmentForm(), code: ' A1 ', name: ' ฝ่าย ' })).toEqual({
      code: 'A1',
      name: 'ฝ่าย',
    });
    expect(
      toCreatePayload({ ...emptyDepartmentForm(), code: 'A', name: 'B', parentId: '3' }),
    ).toEqual({ code: 'A', name: 'B', parentId: '3' });
  });
  it('builds a diff update payload, null parent moves to root', () => {
    const original = departmentFormFrom(node('4', [], '2'));
    expect(toUpdatePayload({ ...original }, original)).toEqual({});
    expect(toUpdatePayload({ ...original, parentId: '', isActive: false }, original)).toEqual({
      parentId: null,
      isActive: false,
    });
  });
});
