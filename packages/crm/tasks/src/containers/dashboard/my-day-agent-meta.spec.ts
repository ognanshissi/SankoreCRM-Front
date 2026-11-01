import { CrmTaskDto, CrmTaskDtoStatusEnum } from '@sankore/crm-api';
import { AgendaEntry } from './agenda-meta';
import { agentDayItems, groupByMoment, heroTask, todayProgress, upcomingCount } from './my-day-agent-meta';

// Vendredi 30 octobre 2026, 11 h, comme sur la maquette.
const NOW = new Date(2026, 9, 30, 11, 0).getTime();
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).toISOString();

function task(id: string, dueAt: string, status = CrmTaskDtoStatusEnum.Pending, slaDeadline?: string): CrmTaskDto {
  return { id, leadId: `lead-${id}`, type: 'FirstContact', dueAt, status, slaDeadline };
}

function entry(key: string, kind: AgendaEntry['kind'], whenIso: string, isOverdue = false, durationMinutes: number | null = null): AgendaEntry {
  return {
    key, kind, id: key, leadId: 'lead-x', leadName: 'Awa Konan', at: whenIso, title: 'Rappel', notes: null,
    durationMinutes, isOverdue, type: { label: 'Rendez-vous', icon: 'feather:users', tone: '' },
  };
}

describe('agentDayItems', () => {
  it('garde les tâches en retard et du jour, pas celles de demain, et met les retards en tête', () => {
    const items = agentDayItems([
      task('demain', at(31, 9)),
      task('apres-midi', at(30, 15)),
      task('hier', at(29, 16)),
      task('matin', at(30, 10, 30), CrmTaskDtoStatusEnum.Pending, at(30, 14)),
    ], [], NOW, false);

    expect(items.map((i) => i.key)).toEqual(['t-hier', 't-matin', 't-apres-midi']);
    expect(items[0].late).toBe(true);
  });

  it('montre les tâches du jour terminées et les rendez-vous passés seulement avec « Tout voir »', () => {
    const tasks = [task('faite', at(30, 9), CrmTaskDtoStatusEnum.Completed)];
    const entries = [entry('a-passe', 'appointment', at(30, 9), false, 30), entry('a-futur', 'appointment', at(30, 14))];

    expect(agentDayItems(tasks, entries, NOW, false).map((i) => i.key)).toEqual(['a-futur']);
    expect(agentDayItems(tasks, entries, NOW, true).map((i) => [i.key, i.done])).toEqual([
      ['t-faite', true], ['a-passe', true], ['a-futur', false],
    ]);
  });

  it('prend les rappels du jour et ceux en retard', () => {
    const items = agentDayItems([], [
      entry('r-retard', 'reminder', at(29, 16), true),
      entry('r-jour', 'reminder', at(30, 15)),
      entry('r-demain', 'reminder', at(31, 9)),
    ], NOW, false);

    expect(items.map((i) => i.key)).toEqual(['r-retard', 'r-jour']);
  });
});

describe('groupByMoment', () => {
  it('range en retard, ce matin, cet après-midi et ce soir, sans groupe vide', () => {
    const groups = groupByMoment(agentDayItems([
      task('hier', at(29, 16)),
      task('soir', at(30, 19)),
      task('matin', at(30, 11, 30)),
      task('aprem', at(30, 14)),
    ], [], NOW, false));

    expect(groups.map((g) => [g.label, g.items.map((i) => i.key)])).toEqual([
      ['En retard', ['t-hier']],
      ['Ce matin', ['t-matin']],
      ['Cet après-midi', ['t-aprem']],
      ['Ce soir', ['t-soir']],
    ]);
  });
});

describe('heroTask', () => {
  it('prend la première tâche dans l’ordre d’urgence parmi celles en retard ou du jour', () => {
    const byUrgency = [task('semaine-prochaine', at(6, 9)), task('aujourdhui', at(30, 15)), task('hier', at(29, 9))];
    byUrgency[0].dueAt = new Date(2026, 10, 6, 9).toISOString();

    expect(heroTask(byUrgency, NOW)?.id).toBe('aujourdhui');
  });

  it('ne propose rien quand rien n’est dû', () =>
    expect(heroTask([task('demain', at(31, 9))], NOW)).toBeNull());
});

describe('todayProgress et upcomingCount', () => {
  it('compte les tâches du jour faites sur les tâches du jour, les annulées à part', () => {
    const tasks = [
      task('a', at(30, 9), CrmTaskDtoStatusEnum.Completed),
      task('b', at(30, 15)),
      task('c', at(30, 16), CrmTaskDtoStatusEnum.Cancelled),
      task('d', at(31, 9)),
    ];

    expect(todayProgress(tasks, NOW)).toEqual({ done: 1, total: 2 });
    expect(upcomingCount(tasks, NOW)).toBe(1);
  });
});
