import type { TranslationKey } from '@/i18n/locales/th';
import {
  flattenDepartments,
  type CreateDepartmentPayload,
  type DepartmentNode,
  type UpdateDepartmentPayload,
} from './departments.api';

export const CODE_MAX = 20;
export const NAME_MAX = 150;

export type DepartmentFormValues = {
  code: string;
  name: string;
  parentId: string;
  isActive: boolean;
};

export type DepartmentFormErrors = Partial<Record<keyof DepartmentFormValues, TranslationKey>>;

export function emptyDepartmentForm(parentId = ''): DepartmentFormValues {
  return { code: '', name: '', parentId, isActive: true };
}

export function departmentFormFrom(department: DepartmentNode): DepartmentFormValues {
  return {
    code: department.code,
    name: department.name,
    parentId: department.parentId ?? '',
    isActive: department.isActive,
  };
}

function findNode(nodes: DepartmentNode[], id: string): DepartmentNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

function collect(node: DepartmentNode, into: Set<string>): void {
  for (const child of node.children) {
    into.add(child.id);
    collect(child, into);
  }
}

/** Ids of every descendant of `id` (not including `id`). */
export function descendantIds(tree: DepartmentNode[], id: string): Set<string> {
  const result = new Set<string>();
  const node = findNode(tree, id);
  if (node) collect(node, result);
  return result;
}

/** Valid parents for a department: everything except itself and its descendants. */
export function parentOptions(
  tree: DepartmentNode[],
  editingId?: string,
): Array<{ id: string; label: string }> {
  if (!editingId) return flattenDepartments(tree);
  const blocked = descendantIds(tree, editingId);
  blocked.add(editingId);
  const drop = (nodes: DepartmentNode[]): DepartmentNode[] =>
    nodes
      .filter((node) => !blocked.has(node.id))
      .map((node) => ({ ...node, children: drop(node.children) }));
  return flattenDepartments(drop(tree));
}

/** Keeps nodes whose name/code match, plus their ancestors. Empty query returns the tree as is. */
export function filterTree(tree: DepartmentNode[], query: string): DepartmentNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return tree;
  const walk = (nodes: DepartmentNode[]): DepartmentNode[] =>
    nodes.flatMap((node) => {
      const children = walk(node.children);
      const own = `${node.name} ${node.code}`.toLowerCase().includes(needle);
      return own || children.length > 0 ? [{ ...node, children: own ? node.children : children }] : [];
    });
  return walk(tree);
}

export function validateDepartmentForm(values: DepartmentFormValues): DepartmentFormErrors {
  const errors: DepartmentFormErrors = {};
  const code = values.code.trim();
  if (!code) errors.code = 'departments.form.errorCodeRequired';
  else if (code.length > CODE_MAX) errors.code = 'departments.form.errorCodeLong';
  const name = values.name.trim();
  if (!name) errors.name = 'departments.form.errorNameRequired';
  else if (name.length > NAME_MAX) errors.name = 'departments.form.errorNameLong';
  return errors;
}

export function toCreatePayload(values: DepartmentFormValues): CreateDepartmentPayload {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    ...(values.parentId ? { parentId: values.parentId } : {}),
  };
}

export function toUpdatePayload(
  values: DepartmentFormValues,
  original: DepartmentFormValues,
): UpdateDepartmentPayload {
  const payload: UpdateDepartmentPayload = {};
  if (values.code.trim() !== original.code.trim()) payload.code = values.code.trim();
  if (values.name.trim() !== original.name.trim()) payload.name = values.name.trim();
  if (values.parentId !== original.parentId) payload.parentId = values.parentId || null;
  if (values.isActive !== original.isActive) payload.isActive = values.isActive;
  return payload;
}
