import { describe, expect, it } from 'vitest';
import type { FolderDto } from '@aimarkdown/shared';
import { buildTree } from './Sidebar.js';

const folder = (id: string, parentId: string | null, position: string, name = id): FolderDto => ({
  id,
  name,
  parentId,
  position,
  noteCount: 0,
  createdAt: new Date(0).toISOString(),
});

describe('buildTree', () => {
  it('returns an empty tree for no folders', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('nests children under their parent', () => {
    const tree = buildTree([folder('child', 'root', 'a1'), folder('root', null, 'a0')]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.folder.id).toBe('root');
    expect(tree[0]?.children.map((node) => node.folder.id)).toEqual(['child']);
  });

  it('supports arbitrary nesting depth', () => {
    const tree = buildTree([
      folder('c', 'b', 'a2'),
      folder('b', 'a', 'a1'),
      folder('a', null, 'a0'),
    ]);
    expect(tree[0]?.children[0]?.children[0]?.folder.id).toBe('c');
  });

  it('sorts siblings by fractional position', () => {
    const tree = buildTree([
      folder('third', null, 'a3'),
      folder('first', null, 'a0'),
      folder('second', null, 'a1'),
    ]);
    expect(tree.map((node) => node.folder.id)).toEqual(['first', 'second', 'third']);
  });

  it('promotes a node whose parent no longer exists to the root level', () => {
    // Happens when a folder is deleted on another device before the child's mirror catches up.
    const tree = buildTree([folder('orphan', 'gone', 'a0')]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.folder.id).toBe('orphan');
  });

  it('does not recurse forever on a cycle produced by a CRDT merge', () => {
    const tree = buildTree([folder('a', 'b', 'a0'), folder('b', 'a', 'a1')]);
    // Both nodes appear exactly once, somewhere in the tree.
    const ids: string[] = [];
    const walk = (nodes: ReturnType<typeof buildTree>) => {
      for (const node of nodes) {
        ids.push(node.folder.id);
        walk(node.children);
      }
    };
    walk(tree);
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('does not recurse forever on a self-parenting folder', () => {
    const tree = buildTree([folder('self', 'self', 'a0')]);
    const ids: string[] = [];
    const walk = (nodes: ReturnType<typeof buildTree>) => {
      for (const node of nodes) {
        ids.push(node.folder.id);
        walk(node.children);
      }
    };
    walk(tree);
    expect(ids).toEqual(['self']);
  });
});
