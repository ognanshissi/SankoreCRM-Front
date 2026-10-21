import { CalendarItem, findConflicts, firstFreeSlot, layoutDay, rangeLabel, viewRange } from './calendar-meta';

function at(h: number, m = 0): Date {
  return new Date(2026, 9, 21, h, m);
}

function item(key: string, start: Date, end: Date, kind: CalendarItem['kind'] = 'external', busy = true): CalendarItem {
  return { key, kind, source: 's', title: key, detail: '', start, end, allDay: false, color: '#000000', busy, leadId: null };
}

describe('layoutDay', () => {
  it('shares the width between overlapping events only', () => {
    const placed = layoutDay(
      [item('a', at(9), at(10)), item('b', at(9, 30), at(11)), item('c', at(14), at(15))],
      at(0),
    );
    const byKey = new Map(placed.map((p) => [p.item.key, p]));
    expect(byKey.get('a')).toMatchObject({ column: 0, columns: 2, startMinute: 540, endMinute: 600 });
    expect(byKey.get('b')).toMatchObject({ column: 1, columns: 2 });
    expect(byKey.get('c')).toMatchObject({ column: 0, columns: 1 });
  });

  it('cuts an event running past midnight to the day shown', () => {
    const [placed] = layoutDay([item('late', at(23), new Date(2026, 9, 22, 1))], at(0));
    expect(placed).toMatchObject({ startMinute: 23 * 60, endMinute: 24 * 60 });
  });
});

describe('conflicts', () => {
  const now = at(7);

  it('finds an appointment overlapping a busy external event and proposes the first free slot', () => {
    const appointment = item('rdv', at(14), at(15), 'appointment');
    const items = [appointment, item('comite', at(13, 30), at(15)), item('point', at(8), at(9))];

    const [conflict] = findConflicts(items, now);
    expect(conflict.appointment.key).toBe('rdv');
    expect(conflict.blockers.map((b) => b.key)).toEqual(['comite']);
    expect(conflict.freeSlot).toEqual(at(9));
  });

  it('ignores a free external event', () => {
    const items = [item('rdv', at(14), at(15), 'appointment'), item('libre', at(14), at(15), 'external', false)];
    expect(findConflicts(items, now)).toEqual([]);
  });

  it('never proposes a slot in the past nor past the end of the working day', () => {
    const appointment = item('rdv', at(18), at(19), 'appointment');
    expect(firstFreeSlot(appointment, [appointment, item('x', at(8), at(18, 30))], at(7))).toBeNull();
    expect(firstFreeSlot(appointment, [appointment], at(10, 5))).toEqual(at(10, 15));
  });
});

describe('viewRange', () => {
  it('starts a week on Monday and shows six full weeks for a month', () => {
    const week = viewRange('week', at(12));
    expect(week.from).toEqual(new Date(2026, 9, 19));
    expect(week.days).toHaveLength(7);
    const month = viewRange('month', at(12));
    expect(month.from).toEqual(new Date(2026, 8, 28));
    expect(month.days).toHaveLength(42);
  });

  it('labels a week inside one month compactly', () => {
    expect(rangeLabel('week', at(12))).toBe('19 – 25 octobre 2026');
  });
});
