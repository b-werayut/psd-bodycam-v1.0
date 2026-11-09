import { FolderPlus, Pencil, Trash2 } from 'lucide-react';

import {
  RowActionItem,
  RowActionsMenu,
  StatusBadge,
  ToolButton,
} from '@/components/command-center';
import { useLanguage } from '@/i18n/useLanguage';
import type { DepartmentNode } from '../departments.api';

type DepartmentTreeProps = {
  nodes: DepartmentNode[];
  canManage: boolean;
  disabled?: boolean;
  onEdit: (node: DepartmentNode) => void;
  onAddChild: (node: DepartmentNode) => void;
  onDelete: (node: DepartmentNode) => void;
  depth?: number;
};

export function DepartmentTree({
  nodes,
  canManage,
  disabled,
  onEdit,
  onAddChild,
  onDelete,
  depth = 0,
}: DepartmentTreeProps) {
  const { t } = useLanguage();
  return (
    <ul className={depth === 0 ? 'flex flex-col' : 'ml-4 flex flex-col border-l border-border pl-3'}>
      {nodes.map((node) => (
        <li key={node.id}>
          <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 py-1.5">
            <span className="font-mono text-xs text-muted-foreground">{node.code}</span>
            <span className="min-w-0 flex-1 font-medium">{node.name}</span>
            <StatusBadge tone={node.isActive ? 'success' : 'neutral'}>
              {t(node.isActive ? 'departments.status.active' : 'departments.status.inactive')}
            </StatusBadge>
            {canManage ? (
              <div className="flex items-center gap-1.5">
                <ToolButton
                  tone="edit"
                  aria-label={t('departments.editDepartment', { name: node.name })}
                  title={t('departments.editDepartment', { name: node.name })}
                  onClick={() => onEdit(node)}
                >
                  <Pencil aria-hidden="true" />
                </ToolButton>
                <RowActionsMenu label={t('departments.moreActions', { name: node.name })}>
                  <RowActionItem
                    icon={<FolderPlus aria-hidden="true" />}
                    label={t('departments.addChild', { name: node.name })}
                    onSelect={() => onAddChild(node)}
                  />
                  <RowActionItem
                    icon={<Trash2 aria-hidden="true" />}
                    label={t('departments.deleteDepartment', { name: node.name })}
                    tone="danger"
                    disabled={disabled}
                    onSelect={() => onDelete(node)}
                  />
                </RowActionsMenu>
              </div>
            ) : null}
          </div>
          {node.children.length > 0 ? (
            <DepartmentTree
              nodes={node.children}
              canManage={canManage}
              disabled={disabled}
              onEdit={onEdit}
              onAddChild={onAddChild}
              onDelete={onDelete}
              depth={depth + 1}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
