import { allItems, dropInAll, inList, listLabel, listSections, type Todo } from '@/lib/todos';

jest.mock('@/api/client', () => ({ api: {}, ok: jest.fn() }));

const t = (id: string, listId = 'g'): Todo => ({ todoId: id, listId, title: id, noteCount: 0, completedAt: null, createdAt: '2026-11-01T00:00:00Z' });

describe('Todos: All or one list', () => {
  const lists = [{ listId: 'g', name: 'General' }, { listId: 'w', name: 'Work' }, { listId: 'e', name: 'Empty' }];
  const all = [t('a'), t('b', 'w'), t('c')];

  it('names what’s shown: All, or the list', () => {
    expect(listLabel(lists, null)).toBe('All');
    expect(listLabel(lists, 'w')).toBe('Work');
    expect(listLabel(lists, 'gone')).toBe('All');
  });

  it('one list, or everything', () => {
    expect(inList(all, 'w').map((x) => x.todoId)).toEqual(['b']);
    expect(inList(all, null)).toHaveLength(3);
  });

  it('All groups to-dos under their lists, in my order, leaving out empty lists', () => {
    expect(listSections(all, lists).map((s) => [s.title, s.todos.map((x) => x.todoId)])).toEqual([
      ['General', ['a', 'c']],
      ['Work', ['b']],
    ]);
  });
});

describe('Todos: dragging in All', () => {
  const lists = [{ listId: 'g', name: 'General' }, { listId: 'w', name: 'Work' }, { listId: 'e', name: 'Empty' }];
  const items = allItems([t('a'), t('b'), t('c', 'w')], lists);
  const labels = items.map((i) => (i.kind === 'list' ? `[${i.title}]` : i.todo.todoId));

  it('lists every heading, empty ones too, each with its to-dos', () => {
    expect(labels).toEqual(['[General]', 'a', 'b', '[Work]', 'c', '[Empty]']);
  });

  it('within a list: just its new order', () => {
    expect(dropInAll(items, 2, 1)).toEqual({ todoId: 'b', listId: 'g', order: ['b', 'a'] });
  });

  it('under another heading: that list, in the place it was dropped', () => {
    // "a" dropped just after "c": into Work, after c.
    expect(dropInAll(items, 1, 4)).toEqual({ todoId: 'a', listId: 'w', order: ['c', 'a'] });
    // "c" dropped at the very end, under Empty.
    expect(dropInAll(items, 4, 5)).toEqual({ todoId: 'c', listId: 'e', order: ['c'] });
    // "c" dropped above every heading: General's first.
    expect(dropInAll(items, 4, 0)).toEqual({ todoId: 'c', listId: 'g', order: ['c', 'a', 'b'] });
  });

  it('headings themselves don’t move', () => {
    expect(dropInAll(items, 0, 2)).toBeNull();
  });
});
