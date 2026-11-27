import {
  dayLabel,
  noDateTodos,
  parseQuickAdd,
  quickAddLabel,
  todayIso,
  todayTodos,
  upcomingGroups,
  viewLabel,
  type Todo,
} from '@/lib/todos';

jest.mock('@/api/client', () => ({ api: {}, ok: jest.fn() }));

// Friday 27 November 2026.
const TODAY = '2026-11-27';

const q = (text: string, ignore?: string) => {
  const r = parseQuickAdd(text, TODAY, ignore);
  return [r.title, r.dueDate, r.repeat];
};

describe('Quick add reads dates and repeats from words', () => {
  it('relative days', () => {
    expect(q('Call mum tomorrow')).toEqual(['Call mum', '2026-11-28', null]);
    expect(q('Call mum tmrw')).toEqual(['Call mum', '2026-11-28', null]);
    expect(q('Send invoice today')).toEqual(['Send invoice', '2026-11-27', null]);
    expect(q('Taxes in 2 weeks')).toEqual(['Taxes', '2026-12-11', null]);
    expect(q('Check back in three days')).toEqual(['Check back', '2026-11-30', null]);
    expect(q('Renew passport in 6 months')).toEqual(['Renew passport', '2027-05-27', null]);
    expect(q('Plan trip next week')).toEqual(['Plan trip', '2026-11-30', null]);
    expect(q('Budget next month')).toEqual(['Budget', '2026-12-01', null]);
    expect(q('Clean garage this weekend')).toEqual(['Clean garage', '2026-11-28', null]);
  });

  it('weekdays: the next one, today included; "next" skips today', () => {
    expect(q('Dentist Fri')).toEqual(['Dentist', '2026-11-27', null]);
    expect(q('Dentist next Fri')).toEqual(['Dentist', '2026-12-04', null]);
    expect(q('Submit report by Tuesday')).toEqual(['Submit report', '2026-12-01', null]);
    expect(q('Lunch with Sara on mon')).toEqual(['Lunch with Sara', '2026-11-30', null]);
  });

  it('calendar dates, either way round, next year once passed', () => {
    expect(q('Party Dec 5')).toEqual(['Party', '2026-12-05', null]);
    expect(q('Party 5 December')).toEqual(['Party', '2026-12-05', null]);
    expect(q('Party on Dec 5th')).toEqual(['Party', '2026-12-05', null]);
    expect(q('Trip Feb 3')).toEqual(['Trip', '2027-02-03', null]);
    expect(q('Call Bob on Dec 5, 2027')).toEqual(['Call Bob', '2027-12-05', null]);
    expect(q('Feb 30 thing')).toEqual(['Feb 30 thing', null, null]);
  });

  it('repeats, from the next such day or today', () => {
    expect(q('Pay rent every month')).toEqual(['Pay rent', '2026-11-27', 'monthly']);
    expect(q('Water plants every Monday')).toEqual(['Water plants', '2026-11-30', 'weekly']);
    expect(q('Gym daily')).toEqual(['Gym', '2026-11-27', 'daily']);
    expect(q('Call grandma weekly')).toEqual(['Call grandma', '2026-11-27', 'weekly']);
    expect(q('Pay rent every month Dec 1')).toEqual(['Pay rent', '2026-12-01', 'monthly']);
  });

  it('keeps the words when nothing else would be left, or when I tap the chip away', () => {
    expect(q('Buy milk')).toEqual(['Buy milk', null, null]);
    expect(q('tomorrow')).toEqual(['tomorrow', null, null]);
    expect(q('Read Monday notes')).toEqual(['Read notes', '2026-11-30', null]);
    expect(q('Read Monday notes', 'Monday')).toEqual(['Read Monday notes', null, null]);
    expect(q('Mayday drill')).toEqual(['Mayday drill', null, null]);
    expect(q('Tidy, tomorrow')).toEqual(['Tidy', '2026-11-28', null]);
  });

  it('says what it will set', () => {
    expect(parseQuickAdd('Dentist next Fri', TODAY).phrase).toBe('next Fri');
    expect(quickAddLabel(parseQuickAdd('Water plants every Monday', TODAY), TODAY)).toBe('Monday · Every week');
    expect(quickAddLabel(parseQuickAdd('Call mum tomorrow', TODAY), TODAY)).toBe('Tomorrow');
    expect(quickAddLabel(parseQuickAdd('Buy milk', TODAY), TODAY)).toBeNull();
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

  it('No date, and view names', () => {
    expect(noDateTodos(all).map((x) => x.todoId)).toEqual(['none']);
    const lists = [{ listId: 'g', name: 'General' }];
    expect(viewLabel({ kind: 'list', listId: 'g' }, lists)).toBe('General');
    expect(viewLabel({ kind: 'nodate' }, lists)).toBe('No date');
  });
});
