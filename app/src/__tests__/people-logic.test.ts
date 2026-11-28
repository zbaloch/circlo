import {
  comingUp,
  dateLine,
  dueInDays,
  nextOccurrence,
  personKey,
  reminders,
  rhythmLabel,
  rowLine,
  type Contact,
} from '@/lib/people';

// Local dates throughout: birthdays and catch-ups are days on the phone's calendar.
const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);
const TODAY = day(2026, 11, 28); // a Saturday

function person(over: Partial<Contact> = {}): Contact {
  return { contactId: 'c1', name: 'Sam', person: null, dates: [], keepInTouchDays: null, keepSince: null, lastCaughtUp: null, noteCount: 0, ...over };
}

describe('dates to remember', () => {
  it('come round on the next day they fall, today included', () => {
    expect(nextOccurrence({ month: 11, day: 28 }, TODAY)).toEqual(day(2026, 11, 28, 0));
    expect(nextOccurrence({ month: 12, day: 3 }, TODAY)).toEqual(day(2026, 12, 3, 0));
    expect(nextOccurrence({ month: 3, day: 14 }, TODAY)).toEqual(day(2027, 3, 14, 0));
  });

  it('put 29 February on the 28th in other years', () => {
    expect(nextOccurrence({ month: 2, day: 29 }, TODAY)).toEqual(day(2027, 2, 28, 0));
    expect(nextOccurrence({ month: 2, day: 29 }, day(2028, 1, 10))).toEqual(day(2028, 2, 29, 0));
  });

  it('read naturally, with an age when the year is known', () => {
    expect(dateLine({ label: 'Birthday', month: 3, day: 14, year: 1961 }, TODAY)).toBe('14 March · turns 66 in 106 days');
    expect(dateLine({ label: 'Birthday', month: 11, day: 28, year: 1990 }, TODAY)).toBe('28 November · 36 today');
    expect(dateLine({ label: 'Anniversary', month: 11, day: 29, year: 2010 }, TODAY)).toBe('29 November · 16 years tomorrow');
    expect(dateLine({ label: 'Name day', month: 12, day: 2 }, TODAY)).toBe('2 December · Wednesday');
  });
});

describe('keeping in touch', () => {
  it('is due a rhythm after the last catch-up, or after the rhythm started', () => {
    expect(dueInDays(person(), TODAY)).toBeNull();
    expect(dueInDays(person({ keepInTouchDays: 30, keepSince: day(2026, 11, 20).toISOString() }), TODAY)).toBe(22);
    expect(dueInDays(person({ keepInTouchDays: 7, keepSince: day(2026, 1, 1).toISOString(), lastCaughtUp: day(2026, 11, 14).toISOString() }), TODAY)).toBe(-7);
  });

  it('labels each rhythm', () => {
    expect([7, 14, 30, 90, 180, 365].map(rhythmLabel)).toEqual([
      'Every week',
      'Every 2 weeks',
      'Every month',
      'Every 3 months',
      'Every 6 months',
      'Every year',
    ]);
  });
});

describe('Coming up', () => {
  const mum = person({ contactId: 'mum', name: 'Mum', dates: [{ label: 'Birthday', month: 12, day: 1, year: null }] });
  const ali = person({ contactId: 'ali', name: 'Ali', keepInTouchDays: 7, keepSince: day(2026, 11, 1).toISOString() });
  const far = person({ contactId: 'far', name: 'Far', dates: [{ label: 'Birthday', month: 6, day: 1, year: null }] });
  const bea = person({ contactId: null, name: 'Bea', person: { userId: 'u-b', name: 'Bea', username: 'bea' }, keepInTouchDays: null });

  it('lists who is due to catch up first, then dates in the next two weeks', () => {
    expect(comingUp([far, mum, ali, bea], TODAY).map((i) => `${i.entry.name}: ${i.text}`)).toEqual([
      'Ali: Time to catch up (every week)',
      'Mum: Birthday Tuesday',
    ]);
  });

  it('gives each row one quiet line', () => {
    expect(rowLine(mum, TODAY)).toBe('Birthday Tuesday');
    expect(rowLine(ali, TODAY)).toBe('Time to catch up');
    expect(rowLine(person({ keepInTouchDays: 30, keepSince: day(2026, 11, 1).toISOString(), lastCaughtUp: day(2026, 11, 14).toISOString() }), TODAY)).toBe(
      'Caught up 2 weeks ago',
    );
    expect(rowLine(far, TODAY)).toBe('');
  });

  it('keys people by entry, or by account for connections without one', () => {
    expect(personKey(mum)).toBe('mum');
    expect(personKey(bea)).toBe('u-u-b');
  });
});

describe('reminders on the phone', () => {
  it('are at 9 in the morning: dates for the next year, and when someone becomes due', () => {
    const mum = person({ contactId: 'mum', name: 'Mum', dates: [{ label: 'Birthday', month: 12, day: 1, year: null }] });
    const ali = person({ contactId: 'ali', name: 'Ali', keepInTouchDays: 30, keepSince: day(2026, 11, 20).toISOString() });
    const late = person({ contactId: 'late', name: 'Late', keepInTouchDays: 7, keepSince: day(2026, 1, 1).toISOString() });
    const list = reminders([mum, ali, late], TODAY);
    expect(list.map((r) => [r.id, r.date.toString(), r.title, r.body])).toEqual([
      ['kit:mum:date:0', day(2026, 12, 1, 9).toString(), 'Mum’s birthday', 'Today'],
      ['kit:ali:due', day(2026, 12, 20, 9).toString(), 'Catch up with Ali', 'It’s been a month'],
    ]);
    expect(list[0].url).toBe('/people/mum');
  });

  it('skip today’s once 9 o’clock has passed, and keep to the soonest 50', () => {
    const today = person({ contactId: 't', name: 'T', dates: [{ label: 'Birthday', month: 11, day: 28, year: null }] });
    expect(reminders([today], day(2026, 11, 28, 8))).toHaveLength(1);
    expect(reminders([today], day(2026, 11, 28, 10))).toHaveLength(0);
    const many = Array.from({ length: 80 }, (_, i) => person({ contactId: `p${i}`, name: `P${i}`, dates: [{ label: 'Birthday', month: 1 + (i % 12), day: 1 + (i % 28), year: null }] }));
    expect(reminders(many, TODAY)).toHaveLength(50);
  });
});
