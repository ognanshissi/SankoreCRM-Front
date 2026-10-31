import { CrmTaskDto, CrmTaskDtoPriorityEnum } from '@sankore/crm-api';
import { byUrgency, dayKey, duplicateTaskIds, postponedDueAt, spreadOverWeek, whatsappUrl } from './my-day-meta';

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

describe('byUrgency', () => {
  const now = new Date(2026, 9, 31, 9, 0).getTime();
  const at = (h: number, m = 0) => new Date(2026, 9, 31, h, m).toISOString();
  const ids = (tasks: CrmTaskDto[], scoreOf?: (t: CrmTaskDto) => number | undefined) =>
    [...tasks].sort(byUrgency(now, scoreOf)).map((t) => t.id);

  it('fait passer le SLA qui va tomber, puis les premiers contacts, puis le reste', () => {
    const tasks: CrmTaskDto[] = [
      { id: 'suivi', type: 'Qualification', dueAt: at(8), createdAt: at(7) },
      { id: 'contact', type: 'FirstContact', dueAt: at(17), createdAt: at(8) },
      { id: 'sla', type: 'Qualification', dueAt: at(17), slaDeadline: at(10), createdAt: at(8) },
    ];

    expect(ids(tasks)).toEqual(['sla', 'contact', 'suivi']);
  });

  it('ne compte pas un SLA lointain comme une urgence', () => {
    const tasks: CrmTaskDto[] = [
      { id: 'loin', type: 'Qualification', dueAt: at(10), slaDeadline: at(15), createdAt: at(7) },
      { id: 'contact', type: 'FirstContact', dueAt: at(17), createdAt: at(8) },
    ];

    expect(ids(tasks)).toEqual(['contact', 'loin']);
  });

  it('range les premiers contacts du lead qui attend depuis le plus longtemps au plus récent', () => {
    const tasks: CrmTaskDto[] = [
      { id: 'recent', type: 'FirstContact', dueAt: at(10), createdAt: at(8, 30) },
      { id: 'ancien', type: 'FirstContact', dueAt: at(12), createdAt: at(7) },
    ];

    expect(ids(tasks)).toEqual(['ancien', 'recent']);
  });

  it('met les premiers contacts chauds devant, puis le plus ancien', () => {
    const intents: Record<string, string> = { L1: 'Cold', L2: 'Hot', L3: 'Warm' };
    const tasks: CrmTaskDto[] = [
      { id: 'froid-ancien', type: 'FirstContact', leadId: 'L1', dueAt: at(10), createdAt: at(6) },
      { id: 'chaud-recent', type: 'FirstContact', leadId: 'L2', dueAt: at(12), createdAt: at(8, 45) },
      { id: 'tiede', type: 'FirstContact', leadId: 'L3', dueAt: at(11), createdAt: at(7) },
      { id: 'inconnu', type: 'FirstContact', dueAt: at(9), createdAt: at(5) },
    ];

    const sorted = [...tasks].sort(byUrgency(now, undefined, (t) => intents[t.leadId ?? ''])).map((t) => t.id);

    expect(sorted).toEqual(['chaud-recent', 'tiede', 'froid-ancien', 'inconnu']);
  });

  it('range le reste par priorité, puis par échéance', () => {
    const tasks: CrmTaskDto[] = [
      { id: 'basse-tot', type: 'Qualification', priority: CrmTaskDtoPriorityEnum.Low, dueAt: at(9) },
      { id: 'haute-tard', type: 'Qualification', priority: CrmTaskDtoPriorityEnum.High, dueAt: at(16) },
      { id: 'moyenne-tot', type: 'Qualification', priority: CrmTaskDtoPriorityEnum.Medium, dueAt: at(10) },
      { id: 'moyenne-tard', type: 'Qualification', priority: CrmTaskDtoPriorityEnum.Medium, dueAt: at(14) },
    ];

    expect(ids(tasks)).toEqual(['haute-tard', 'moyenne-tot', 'moyenne-tard', 'basse-tot']);
  });

  it('départage par le score du lead, puis par ancienneté, puis par id', () => {
    const base = { type: 'Qualification', dueAt: at(10) };
    const tasks: CrmTaskDto[] = [
      { ...base, id: 'b', createdAt: at(8) },
      { ...base, id: 'a', createdAt: at(8) },
      { ...base, id: 'vieux', createdAt: at(6) },
      { ...base, id: 'chaud', createdAt: at(8), leadId: 'L1' },
    ];

    expect(ids(tasks, (t) => (t.leadId === 'L1' ? 80 : undefined))).toEqual(['chaud', 'vieux', 'a', 'b']);
  });
});
