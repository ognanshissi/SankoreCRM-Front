import { TelephonyStatsDayDto } from '@sankore/crm-api';
import {
  TELEPHONY_NOBODY_KEY,
  answerRate,
  averageTalkSeconds,
  buildTelephonyStatsCsv,
  csvField,
  dayChartColumns,
  dayChartTicks,
  defaultStatsPeriod,
  fillDailySeries,
  formatCount,
  formatDuration,
  formatMinutes,
  formatPercent,
  isPeriodTooLong,
  periodDayCount,
  periodEndIso,
  periodStartIso,
  rankAgents,
  ratio,
  statDay,
  statsFreshness,
  summariseLeadSla,
  sumTelephonyRows,
  uuidFilterValue,
} from './dashboard-presentation';

/**
 * Les aides de présentation du tableau de bord portent quatre règles qui se trompent en
 * silence si personne ne les tient :
 *
 * 1. Un dénominateur nul doit rendre « — » et jamais « 0 % » ni « NaN % » : sur une
 *    période sans appel, « 0 % de décroché » est un reproche, pas une absence de mesure.
 * 2. Les journées sans appel sont ABSENTES de la réponse du serveur. Non remplies, le
 *    graphique saute les dimanches et tasse la semaine.
 * 3. Le plafond de 400 jours est un refus serveur (422), pas une troncature : il se
 *    vérifie avant l'appel.
 * 4. L'export est à point-virgule : un nom contenant « ; » doit sortir entre guillemets,
 *    sinon la ligne se décale d'une colonne dans tout le fichier.
 */

describe('Tableau de bord téléphonie — taux et dénominateur nul', () => {
  it('rend `null` dès que le dénominateur est nul ou négatif, jamais NaN ni 0', () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(12, 0)).toBeNull();
    expect(ratio(12, -3)).toBeNull();
    expect(ratio(3, 4)).toBe(0.75);
  });

  it('ne propage pas un compteur absent en NaN', () => {
    // Tous les champs du DTO sont optionnels : une somme naïve rendrait NaN et
    // contaminerait ensuite chaque taux de l'écran.
    const totals = sumTelephonyRows([{ outboundCount: 4 }, {}]);
    expect(totals.outbound).toBe(4);
    expect(totals.inbound).toBe(0);
    expect(totals.talkSeconds).toBe(0);
  });

  it('ne mesure pas de taux de décroché sur une période sans appel', () => {
    expect(answerRate(sumTelephonyRows([]))).toBeNull();
    expect(formatPercent(answerRate(sumTelephonyRows([])))).toBe('—');
    expect(
      answerRate(sumTelephonyRows([{ inboundCount: 6, outboundCount: 4, answeredCount: 7 }])),
    ).toBe(0.7);
  });

  it('ne moyenne pas une durée de conversation sans appel décroché', () => {
    expect(averageTalkSeconds(sumTelephonyRows([{ talkSeconds: 900, answeredCount: 0 }]))).toBeNull();
    expect(averageTalkSeconds(sumTelephonyRows([{ talkSeconds: 900, answeredCount: 3 }]))).toBe(300);
  });

  it('affiche « — » et non « 0 % » quand le taux n’est pas mesurable', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
    expect(formatPercent(Number.NaN)).toBe('—');
    expect(formatPercent(0)).toBe('0,0 %');
    expect(formatPercent(0.7235)).toBe('72,4 %');
    expect(formatPercent(1)).toBe('100,0 %');
  });
});

describe('Tableau de bord téléphonie — durées', () => {
  it('distingue « rien à moyenner » de « mesuré, et nul »', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
    expect(formatDuration(0)).toBe('0 s');
  });

  it('passe des secondes aux minutes puis aux heures', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(59.6)).toBe('1 min');
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(125)).toBe('2 min 05 s');
    expect(formatDuration(3600)).toBe('1 h');
    // « 1 h 01 min » et non « 1 h 01 » : les trois écrans divergeaient aussi au palier des
    // heures, celui-ci omettant l'unité des minutes. La forme commune la porte, parce que
    // « 1 h 01 » se lit aussi comme un nombre décimal.
    expect(formatDuration(3660)).toBe('1 h 01 min');
    expect(formatDuration(7500)).toBe('2 h 05 min');
  });

  it('lit le délai de premier contact en minutes, comme le contrat le donne', () => {
    expect(formatMinutes(null)).toBe('—');
    expect(formatMinutes(-1)).toBe('—');
    expect(formatMinutes(0)).toBe('0 s');
    expect(formatMinutes(42)).toBe('42 min');
    expect(formatMinutes(90)).toBe('1 h 30 min');
  });

  it('groupe les milliers sans espace sécable', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1240)).toBe('1\u202f240');
    expect(formatCount(1234567)).toBe('1\u202f234\u202f567');
    expect(formatCount(null)).toBe('—');
    expect(formatCount(Number.NaN)).toBe('—');
  });
});

describe('Tableau de bord téléphonie — période', () => {
  it('propose 31 jours bornes incluses, comme le serveur par défaut', () => {
    const period = defaultStatsPeriod(new Date('2026-03-31T09:00:00Z'));
    expect(period).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(periodDayCount(period.from, period.to)).toBe(31);
  });

  it('compte les jours bornes incluses et refuse une période inversée', () => {
    expect(periodDayCount('2026-03-01', '2026-03-01')).toBe(1);
    expect(periodDayCount('2026-03-01', '2026-03-03')).toBe(3);
    expect(periodDayCount('2026-03-03', '2026-03-01')).toBeNull();
    expect(periodDayCount('pas-une-date', '2026-03-01')).toBeNull();
    expect(periodDayCount(null, '2026-03-01')).toBeNull();
  });

  it('détecte le plafond de 400 jours avant l’appel, bornes incluses', () => {
    expect(isPeriodTooLong('2026-01-01', '2026-01-31')).toBe(false);
    // 400 jours exactement : accepté.
    expect(periodDayCount('2025-01-01', '2026-02-04')).toBe(400);
    expect(isPeriodTooLong('2025-01-01', '2026-02-04')).toBe(false);
    expect(isPeriodTooLong('2025-01-01', '2026-02-05')).toBe(true);
  });

  it('construit des bornes date-time EN UTC pour le module Leads', () => {
    expect(periodStartIso('2026-03-01')).toBe('2026-03-01T00:00:00.000Z');
    expect(periodEndIso('2026-03-31')).toBe('2026-03-31T23:59:59.999Z');
    expect(periodStartIso('n’importe quoi')).toBeUndefined();
  });

  it('normalise un statDate sérialisé en date-heure', () => {
    expect(statDay('2026-03-12')).toBe('2026-03-12');
    expect(statDay('2026-03-12T00:00:00Z')).toBe('2026-03-12');
    expect(statDay('12/03/2026')).toBeNull();
    expect(statDay(null)).toBeNull();
  });

  it('ne restaure de l’URL qu’un uuid bien formé', () => {
    expect(uuidFilterValue('6f1b9c7e-8d21-4e6a-9b3c-2a7f0d5e4c11')).toBe(
      '6f1b9c7e-8d21-4e6a-9b3c-2a7f0d5e4c11',
    );
    expect(uuidFilterValue('6f1b9c7e')).toBeNull();
    expect(uuidFilterValue('')).toBeNull();
    expect(uuidFilterValue(null)).toBeNull();
  });
});

describe('Tableau de bord téléphonie — série par jour clairsemée', () => {
  const days: TelephonyStatsDayDto[] = [
    { statDate: '2026-03-01', outboundCount: 3, inboundCount: 1 },
    // 02 et 03 absents : c'est le cas normal, pas une anomalie.
    { statDate: '2026-03-04', outboundCount: 2 },
    { statDate: '2026-03-04', inboundCount: 5 },
  ];

  it('remplit les journées absentes à zéro sur les bornes DEMANDÉES', () => {
    const series = fillDailySeries(days, '2026-02-28', '2026-03-05');
    expect(series.map((point) => point.day)).toEqual([
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
    ]);
    expect(series[0].totals.outbound).toBe(0);
    expect(series[2].totals.outbound).toBe(0);
    expect(series[1].totals.outbound).toBe(3);
  });

  it('additionne les buckets d’une même journée (un par agent et par agence)', () => {
    const series = fillDailySeries(days, '2026-03-04', '2026-03-04');
    expect(series).toHaveLength(1);
    expect(series[0].totals.outbound).toBe(2);
    expect(series[0].totals.inbound).toBe(5);
  });

  it('ignore les lignes hors bornes plutôt que d’étirer l’axe', () => {
    const series = fillDailySeries(days, '2026-03-03', '2026-03-04');
    expect(series.map((point) => point.day)).toEqual(['2026-03-03', '2026-03-04']);
  });

  it('retombe sur l’étendue des données quand une borne est illisible', () => {
    const series = fillDailySeries(days, null, null);
    expect(series.map((point) => point.day)).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
    ]);
  });

  it('ne rend aucun point quand il n’y a ni bornes ni données', () => {
    expect(fillDailySeries([], null, null)).toEqual([]);
    expect(fillDailySeries(null, null, null)).toEqual([]);
  });

  it('plafonne la série au maximum du serveur, qu’une URL trafiquée ne la fasse pas exploser', () => {
    const series = fillDailySeries([], '2020-01-01', '2026-01-01');
    expect(series).toHaveLength(400);
  });
});

describe('Tableau de bord téléphonie — géométrie du graphique', () => {
  it('met les colonnes à l’échelle du jour le plus chargé', () => {
    const series = fillDailySeries(
      [
        { statDate: '2026-03-01', outboundCount: 5, inboundCount: 5 },
        { statDate: '2026-03-02', outboundCount: 5 },
      ],
      '2026-03-01',
      '2026-03-02',
    );
    const columns = dayChartColumns(series);
    expect(columns[0].outboundPercent).toBe(50);
    expect(columns[0].inboundPercent).toBe(50);
    expect(columns[1].outboundPercent).toBe(50);
    expect(columns[1].inboundPercent).toBe(0);
  });

  it('ne divise pas par zéro sur une période sans appel', () => {
    const columns = dayChartColumns(fillDailySeries([], '2026-03-01', '2026-03-02'));
    expect(columns).toHaveLength(2);
    expect(columns.every((column) => column.outboundPercent === 0)).toBe(true);
    expect(columns.every((column) => column.total === 0)).toBe(true);
  });

  it('n’étiquette que quelques jours, premier et dernier compris', () => {
    const series = fillDailySeries([], '2026-03-01', '2026-03-31');
    const ticks = dayChartTicks(series, 5);
    expect(ticks).toHaveLength(5);
    expect(ticks[0]).toBe('1 mars');
    expect(ticks[4]).toBe('31 mars');
    expect(dayChartTicks([], 5)).toEqual([]);
  });
});

describe('Tableau de bord téléphonie — classement par agent', () => {
  it('regroupe les buckets d’un agent présent dans deux agences', () => {
    const rows = rankAgents([
      { crmUserId: 'u1', agencyId: 'a1', outboundCount: 4, answeredCount: 2 },
      { crmUserId: 'u1', agencyId: 'a2', outboundCount: 6, answeredCount: 3 },
      { crmUserId: 'u2', agencyId: 'a1', outboundCount: 3, answeredCount: 3 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].crmUserId).toBe('u1');
    expect(rows[0].calls).toBe(10);
    expect(rows[0].agencyIds).toHaveLength(2);
    expect(rows[0].answerRate).toBe(0.5);
  });

  it('garde le bucket « personne » sur une clé propre, jamais sur un identifiant nul', () => {
    const rows = rankAgents([{ crmUserId: null, agencyId: null, inboundCount: 2 }]);
    expect(rows[0].key).toBe(TELEPHONY_NOBODY_KEY);
    expect(rows[0].crmUserId).toBeNull();
  });

  it('trie sur le volume d’appels', () => {
    const rows = rankAgents([
      { crmUserId: 'petit', outboundCount: 1 },
      { crmUserId: 'gros', outboundCount: 9 },
    ]);
    expect(rows.map((row) => row.crmUserId)).toEqual(['gros', 'petit']);
  });
});

describe('Tableau de bord téléphonie — fraîcheur de la projection', () => {
  const now = Date.parse('2026-03-31T12:00:00Z');

  it('dit qu’une période vide n’a rien à dater, et ne crie pas à la panne', () => {
    const freshness = statsFreshness(null, now);
    expect(freshness.isEmpty).toBe(true);
    expect(freshness.isStale).toBe(false);
    expect(freshness.severity).toBe('neutral');
  });

  it('signale des chiffres récents, datés, puis périmés', () => {
    expect(statsFreshness('2026-03-31T11:30:00Z', now).severity).toBe('success');
    expect(statsFreshness('2026-03-31T06:00:00Z', now).severity).toBe('info');
    expect(statsFreshness('2026-03-29T06:00:00Z', now).severity).toBe('warning');
    expect(statsFreshness('2026-03-29T06:00:00Z', now).isStale).toBe(true);
  });

  it('considère une date illisible comme datée plutôt que comme fraîche', () => {
    expect(statsFreshness('hier', now).isStale).toBe(true);
  });
});

describe('Tableau de bord téléphonie — premier contact et SLA (module Leads)', () => {
  it('pondère la moyenne par le nombre de leads contactés, pas une moyenne de moyennes', () => {
    const summary = summariseLeadSla([
      { totalAssigned: 100, contactedWithinSla: 90, contactedLate: 10, avgFirstContactMinutes: 30 },
      { totalAssigned: 2, contactedWithinSla: 1, contactedLate: 1, avgFirstContactMinutes: 300 },
    ]);
    // Moyenne de moyennes : 165 min. Pondérée : (30×100 + 300×2) / 102 ≈ 35,3 min.
    expect(summary.averageFirstContactMinutes).toBeCloseTo(3600 / 102, 5);
    expect(summary.slaShare).toBeCloseTo(91 / 102, 5);
  });

  it('exclut des deux côtés de la fraction un agent qui n’a contacté personne', () => {
    const summary = summariseLeadSla([
      { totalAssigned: 10, contactedWithinSla: 5, contactedLate: 5, avgFirstContactMinutes: 20 },
      { totalAssigned: 4, notContacted: 4, avgFirstContactMinutes: null },
    ]);
    expect(summary.averageFirstContactMinutes).toBe(20);
    expect(summary.agentsWithoutMeasure).toBe(1);
    // La part dans le SLA, elle, compte bien les leads jamais contactés au dénominateur.
    expect(summary.slaShare).toBeCloseTo(5 / 14, 5);
  });

  it('ne mesure rien sans lead attribué', () => {
    const summary = summariseLeadSla([]);
    expect(summary.slaShare).toBeNull();
    expect(summary.averageFirstContactMinutes).toBeNull();
    expect(summariseLeadSla(null).assigned).toBe(0);
  });
});

describe('Tableau de bord téléphonie — export CSV', () => {
  const resolver = {
    agentName: (id: string | null | undefined) =>
      id === null || id === undefined ? 'Non attribué' : (id === 'u1' ? 'Awa "AK" Koné' : '—'),
    agencyName: (id: string | null | undefined) =>
      id === 'a1' ? 'Ouaga 2000 ; Zone B' : 'Non attribué',
  };

  it('échappe le séparateur, les guillemets et les sauts de ligne', () => {
    expect(csvField('simple')).toBe('simple');
    expect(csvField('Ouaga 2000 ; Zone B')).toBe('"Ouaga 2000 ; Zone B"');
    expect(csvField('Awa "AK" Koné')).toBe('"Awa ""AK"" Koné"');
    expect(csvField('ligne\nsuivante')).toBe('"ligne\nsuivante"');
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });

  it('sort un fichier à point-virgule, trié par jour, en-tête comprise', () => {
    const csv = buildTelephonyStatsCsv(
      [
        { statDate: '2026-03-02', crmUserId: 'u1', agencyId: 'a1', outboundCount: 2 },
        { statDate: '2026-03-01', crmUserId: null, agencyId: null, inboundCount: 1 },
      ],
      resolver,
    );
    const lines = csv.split('\r\n');
    expect(lines[0].startsWith('Jour (UTC);Agent;Agence;Appels;')).toBe(true);
    expect(lines[1].startsWith('2026-03-01;Non attribué;Non attribué;1;1;0;')).toBe(true);
    // Le nom contient un point-virgule : il DOIT ressortir entre guillemets, sinon toute
    // la ligne se décale d'une colonne.
    expect(lines[2]).toContain('"Awa ""AK"" Koné";"Ouaga 2000 ; Zone B"');
  });

  it('ne rend que l’en-tête quand la période est vide', () => {
    expect(buildTelephonyStatsCsv([], resolver).split('\r\n')).toHaveLength(1);
    expect(buildTelephonyStatsCsv(null, resolver).split('\r\n')).toHaveLength(1);
  });
});
