import {
  dayLabel,
  noDateTodos,
  fullDate,
  monthTitle,
  monthWeeks,
  nextWeek,
  shiftMonth,
  todayIso,
  todayTodos,
  upcomingGroups,
  inList,
  listLabel,
  listSections,
  type Todo,
} from '@/lib/todos';

jest.mock('@/api/client', () => ({ api: {}, ok: jest.fn() }));

// Friday 27 November 2026.
const TODAY = '2026-11-27';

describe('Picking a day', () => {
  it('next week is the coming Monday', () => {
    expect(nextWeek(TODAY)).toBe('2026-11-30');
    expect(nextWeek('2026-11-30')).toBe('2026-12-07');
  });

  it('a month as weeks, Monday first, with blanks around it', () => {
    const weeks = monthWeeks('2026-11');
    expect(weeks).toHaveLength(6);
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks[5]).toEqual(['2026-11-30', null, null, null, null, null, null]);
    expect(monthWeeks('2027-02').flat().filter(Boolean)).toHaveLength(28);
  });

  it('moves a month at a time and names it', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthTitle('2026-12', TODAY)).toBe('December');
    expect(monthTitle('2027-01', TODAY)).toBe('January 2027');
    expect(fullDate('2026-12-05')).toBe('Saturday 5 December 2026');
  });
});

describe('Dates in words', () => {
  it('near days by name, others by date', () => {
    expect(dayLabel('2026-11-27', TODAY)).toBe('Today');
    expect(dayLabel('2026-11-28', TODAY)).toBe('Tomorrow');
    expect(dayLabel('2026-11-26', TODAY)).toBe('Yesterday');
    expect(dayLabel('2026-12-01', TODAY)).toBe('Tuesday');
    expect(dayLabel('2026-12-05', TODAY)).toBe('5 Dec');
    expect(dayLabel('2026-11-20', TODAY)).toBe('20 Nov');
    expect(dayLabel('2027-01-05', TODAY)).toBe('5 Jan 2027');
  });

  it('today is the phone’s calendar date', () => {
    expect(todayIso(new Date(2026, 10, 27, 23, 59))).toBe('2026-11-27');
    expect(todayIso(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });
});

describe('Views', () => {
  const t = (id: string, dueDate: string | null, listId = 'g'): Todo => ({
    todoId: id, listId, title: id, notes: null, dueDate, repeat: null, completedAt: null, createdAt: '2026-11-01T00:00:00Z',
  });
  const all = [t('later', '2027-01-02'), t('today', '2026-11-27'), t('overdue', '2026-11-20'), t('tomorrow', '2026-11-28'), t('none', null),
    t('tue', '2026-12-01'), t('dec', '2026-12-04'), t('today2', '2026-11-27', 'w')];

  it('Today: overdue first, then today’s, in my order', () => {
    expect(todayTodos(all, TODAY).map((x) => x.todoId)).toEqual(['overdue', 'today', 'today2']);
  });

  it('Upcoming: the next six days by name, then by month', () => {
    expect(upcomingGroups(all, TODAY).map((g) => [g.title, g.todos.map((x) => x.todoId)])).toEqual([
      ['Tomorrow', ['tomorrow']],
      ['Tuesday', ['tue']],
      ['December', ['dec']],
      ['January 2027', ['later']],
    ]);
  });

  it('No date, one list or All, and All by list', () => {
    expect(noDateTodos(all).map((x) => x.todoId)).toEqual(['none']);
    const lists = [{ listId: 'g', name: 'General' }, { listId: 'w', name: 'Work' }, { listId: 'e', name: 'Empty' }];
    expect(listLabel(lists, 'w')).toBe('Work');
    expect(listLabel(lists, null)).toBe('All');
    expect(listLabel(lists, 'gone')).toBe('All');
    expect(inList(all, 'w').map((x) => x.todoId)).toEqual(['today2']);
    expect(inList(all, null)).toHaveLength(all.length);
    expect(listSections(all, lists).map((s) => [s.title, s.todos.length])).toEqual([['General', 7], ['Work', 1]]);
  });
});
