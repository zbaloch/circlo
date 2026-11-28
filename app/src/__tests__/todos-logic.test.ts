import { inList, listLabel, listSections, type Todo } from '@/lib/todos';

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
