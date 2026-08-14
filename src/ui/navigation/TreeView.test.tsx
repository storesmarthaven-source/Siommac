import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { TreeView, type TreeNode } from './TreeView';

const NODES: readonly TreeNode[] = [{
  id: 'src', label: 'src', children: [
    { id: 'app', label: 'app', children: [{ id: 'page', label: 'page.tsx', kind: 'file' }] },
  ],
}];

describe('TreeView', () => {
  it('expands branches and selects real nodes', () => {
    const onSelect = vi.fn();
    render(<TreeView nodes={NODES} defaultExpandedIds={['src']} onSelect={onSelect} label="Files" />);
    fireEvent.click(screen.getByRole('treeitem', { name: 'app' }));
    expect(screen.getByRole('treeitem', { name: 'page.tsx' })).toBeTruthy();
    fireEvent.click(screen.getByRole('treeitem', { name: 'page.tsx' }));
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'page' }));
  });

  it('supports the expected arrow-key tree navigation', () => {
    render(<TreeView nodes={NODES} defaultExpandedIds={['src', 'app']} defaultSelectedId="src" label="Files" />);
    const src = screen.getByRole('treeitem', { name: 'src' });
    src.focus();
    fireEvent.keyDown(src, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'app' }));
  });

  it('removes collapsed descendants from the accessibility tree', () => {
    render(<TreeView nodes={NODES} label="Files" />);
    expect(screen.queryByRole('treeitem', { name: 'app' })).toBeNull();
    expect(screen.getByRole('treeitem', { name: 'src' }).getAttribute('aria-expanded')).toBe('false');
  });
});
