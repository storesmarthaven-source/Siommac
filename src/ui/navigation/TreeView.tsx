import { type TargetedKeyboardEvent, type VNode } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import './treeView.recipe.css';

export interface TreeNode {
  id: string;
  label: string;
  kind?: 'folder' | 'file';
  children?: readonly TreeNode[];
  disabled?: boolean;
}

export interface TreeViewProps {
  nodes: readonly TreeNode[];
  selectedId?: string;
  defaultSelectedId?: string;
  onSelect?: (node: TreeNode) => void;
  expandedIds?: readonly string[];
  defaultExpandedIds?: readonly string[];
  onExpandedChange?: (ids: readonly string[]) => void;
  label?: string;
  class?: string;
}

function collectVisible(nodes: readonly TreeNode[], expanded: ReadonlySet<string>, output: string[] = []): string[] {
  for (const node of nodes) {
    if (!node.disabled) output.push(node.id);
    if (node.children?.length && expanded.has(node.id)) collectVisible(node.children, expanded, output);
  }
  return output;
}

export function TreeView({
  nodes,
  selectedId,
  defaultSelectedId,
  onSelect,
  expandedIds,
  defaultExpandedIds = [],
  onExpandedChange,
  label = 'Tree navigation',
  class: extra,
}: TreeViewProps): VNode {
  const rootRef = useRef<HTMLUListElement>(null);
  const [internalSelected, setInternalSelected] = useState(defaultSelectedId);
  const [internalExpanded, setInternalExpanded] = useState<readonly string[]>(defaultExpandedIds);
  const selected = selectedId ?? internalSelected;
  const expanded = useMemo(
    () => new Set(expandedIds ?? internalExpanded),
    [expandedIds, internalExpanded],
  );
  const visibleIds = collectVisible(nodes, expanded);
  const tabStop = selected && visibleIds.includes(selected) ? selected : visibleIds[0];

  const setExpanded = (next: ReadonlySet<string>): void => {
    const ids = [...next];
    if (expandedIds === undefined) setInternalExpanded(ids);
    onExpandedChange?.(ids);
  };

  const toggle = (node: TreeNode, force?: boolean): void => {
    if (!node.children?.length || node.disabled) return;
    const next = new Set(expanded);
    const open = force ?? !next.has(node.id);
    if (open) next.add(node.id);
    else next.delete(node.id);
    setExpanded(next);
  };

  const select = (node: TreeNode): void => {
    if (node.disabled) return;
    if (selectedId === undefined) setInternalSelected(node.id);
    onSelect?.(node);
  };

  const focusById = (id: string | undefined): void => {
    if (!id) return;
    const item = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-tree-id]') ?? [])]
      .find(candidate => candidate.dataset.treeId === id);
    item?.focus();
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLButtonElement>, node: TreeNode): void => {
    const index = visibleIds.indexOf(node.id);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? visibleIds.length - 1
          : Math.max(0, Math.min(visibleIds.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      focusById(visibleIds[nextIndex]);
      return;
    }
    if (event.key === 'ArrowRight' && node.children?.length) {
      event.preventDefault();
      if (!expanded.has(node.id)) toggle(node, true);
      else focusById(node.children.find(child => !child.disabled)?.id);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (node.children?.length && expanded.has(node.id)) toggle(node, false);
      else {
        const parent = event.currentTarget.closest('.ui-tree__group')
          ?.closest('.ui-tree__item')
          ?.querySelector<HTMLButtonElement>(':scope > .ui-tree__row');
        parent?.focus();
      }
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(node);
      if (node.children?.length) toggle(node);
    }
  };

  const renderNodes = (items: readonly TreeNode[], level: number, ancestorsVisible: boolean): VNode[] => items.map(node => {
    const folder = node.kind === 'folder' || Boolean(node.children?.length);
    const open = folder && expanded.has(node.id);
    const visible = ancestorsVisible;
    return (
      <li class="ui-tree__item" role="none" key={node.id}>
        <button
          type="button"
          class={`ui-tree__row${selected === node.id ? ' is-selected' : ''}`}
          role="treeitem"
          aria-level={level}
          aria-selected={selected === node.id}
          aria-expanded={folder ? open : undefined}
          aria-disabled={node.disabled ?? undefined}
          disabled={node.disabled}
          tabIndex={visible && tabStop === node.id ? 0 : -1}
          data-tree-id={node.id}
          data-tree-visible={visible ? 'true' : 'false'}
          onClick={() => { select(node); if (folder) toggle(node); }}
          onKeyDown={event => onKeyDown(event, node)}
        >
          <LucideIcon name={folder ? (open ? 'FolderOpen' : 'Folder') : 'File'} size={16} strokeWidth={2} />
          <span>{node.label}</span>
        </button>
        {folder && node.children && (
          <div class="ui-tree__branch" data-open={open ? 'true' : 'false'}>
            <ul class="ui-tree__group" role="group" aria-hidden={!open}>
              {renderNodes(node.children, level + 1, visible && open)}
            </ul>
          </div>
        )}
      </li>
    );
  });

  return (
    <ul ref={rootRef} class={`ui-tree${extra ? ` ${extra}` : ''}`} role="tree" aria-label={label}>
      {renderNodes(nodes, 1, true)}
    </ul>
  );
}
