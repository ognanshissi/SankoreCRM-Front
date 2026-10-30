import { CrmTaskDto } from '@sankore/crm-api';
import { dayKey, duplicateTaskIds, postponedDueAt, spreadOverWeek, whatsappUrl } from './my-day-meta';

function task(id: string, dueAt: Date, type = 'FirstContact', leadId = id): CrmTaskDto {
  return { id, leadId, type, dueAt: dueAt.toISOString() };
}

describe('spreadOverWeek', () => {
  // Samedi 24 octobre 2026, comme sur la maquette.
  const saturday = new Date(2026, 9, 24);
  const at = (h: number) => new Date(2026, 9, 24, h, 0);

  it('étale dix premiers contacts à deux par jour, en sautant le dimanche', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => task(`t${i}`, at(8 + i)));

    const moves = spreadOverWeek(tasks, dayKey(saturday));

    expect(moves).toHaveLength(8);
    const days = moves.map((m) => dayKey(m.dueAt));
    expect(days).toEqual([
      '2026-10-26', '2026-10-26',
      '2026-10-27', '2026-10-27',
      '2026-10-28', '2026-10-28',
      '2026-10-29', '2026-10-29',
    ]);
  });

  it("garde l'heure de chaque tâche", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => task(`t${i}`, at(8 + i)));

    const moved = spreadOverWeek(tasks, dayKey(saturday)).find((m) => m.taskId === 't2')!;

    expect(new Date(moved.dueAt).getHours()).toBe(10);
  });

  it('ne déplace que les premiers contacts', () => {
    const tasks = [
      ...Array.from({ length: 6 }, (_, i) => task(`c${i}`, at(8 + i))),
      task('q', at(9), 'Qualification'),
    ];

    expect(spreadOverWeek(tasks, dayKey(saturday)).map((m) => m.taskId)).not.toContain('q');
  });
});

describe('postponedDueAt', () => {
  const now = new Date(2026, 9, 21, 15, 0).getTime();

  it("reporte une tâche en retard à demain, à son heure", () => {
    const next = postponedDueAt(task('t', new Date(2026, 9, 20, 10, 30)), now);
    expect(dayKey(next)).toBe('2026-10-22');
    expect([next.getHours(), next.getMinutes()]).toEqual([10, 30]);
  });

  it("reporte une tâche à venir au lendemain de son échéance, jamais plus tôt", () => {
    const next = postponedDueAt(task('t', new Date(2026, 9, 24, 9, 0)), now);
    expect(dayKey(next)).toBe('2026-10-25');
  });
});

describe('duplicateTaskIds', () => {
  it('signale la seconde tâche du même type sur le même lead', () => {
    const due = new Date(2026, 9, 22, 9);
    const ids = duplicateTaskIds([
      task('a', due, 'Qualification', 'paul'),
      task('b', due, 'Qualification', 'paul'),
      task('c', due, 'FirstContact', 'paul'),
    ]);
    expect([...ids]).toEqual(['b']);
  });
});

describe('whatsappUrl', () => {
  it('accepte un numéro international', () => {
    expect(whatsappUrl('+225 07 08 09 18 01')).toBe('https://wa.me/2250708091801');
    expect(whatsappUrl('002250708091801')).toBe('https://wa.me/2250708091801');
  });

  it("refuse un numéro local, dont l'indicatif est inconnu", () => {
    expect(whatsappUrl('0708091801')).toBeNull();
  });
});
