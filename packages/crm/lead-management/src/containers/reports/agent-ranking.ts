import { LeadReportAgent } from '@sankore/crm-api';

export type RankingCriterion = 'score' | 'converted' | 'conversionRate' | 'sla' | 'firstContact';

/**
 * Sous ce volume, un taux ne classe personne : un agent qui a reçu 2 leads et en a converti 2
 * afficherait 100 % et passerait devant celui qui en a converti 40 sur 100. Les agents concernés
 * restent visibles, « hors classement », avec leurs chiffres.
 */
export const MIN_ASSIGNED_FOR_RANKING = 5;

/**
 * Poids du score global. Écrits ici et affichés tels quels à l'écran : un classement dont on ne
 * peut pas expliquer la formule n'est pas un classement qu'une équipe accepte.
 */
export const SCORE_WEIGHTS = {
  conversionRate: 0.4,
  sla: 0.3,
  firstContact: 0.2,
  volume: 0.1,
} as const;

export interface RankedAgent {
  agent: LeadReportAgent;
  /** Rang « olympique » : deux ex æquo partagent le rang 2, le suivant est 4. Null hors classement. */
  rank: number | null;
  /** Valeur du critère, pour l'affichage et la barre. */
  value: number | null;
  /** Détail du score global, chaque composante sur 100 avant pondération. */
  breakdown: { conversionRate: number; sla: number; firstContact: number; volume: number } | null;
}

export interface Ranking {
  ranked: RankedAgent[];
  /** Agents sans assez d'affectations, ou sans valeur pour le critère choisi. */
  unranked: RankedAgent[];
}

/**
 * Classe les agents d'un rapport sur un critère.
 *
 * Le score global (0–100) pondère quatre composantes :
 * - le taux de conversion et le délai respecté, déjà sur 100 ;
 * - la rapidité du premier contact, ramenée sur 100 entre l'agent le plus lent (0) et le plus rapide (100) ;
 * - le volume traité, rapporté à l'agent qui a reçu le plus d'affectations.
 *
 * Les deux dernières sont RELATIVES à l'équipe classée : sans référence absolue d'un « bon »
 * délai, comparer aux collègues est la seule mesure qui ne soit pas arbitraire. Un agent sans
 * aucun premier contact obtient 0 sur la rapidité.
 */
export function rankAgents(agents: readonly LeadReportAgent[], criterion: RankingCriterion): Ranking {
  const eligible = agents.filter((a) => (a.assigned ?? 0) >= MIN_ASSIGNED_FOR_RANKING);
  const tooFew = agents.filter((a) => (a.assigned ?? 0) < MIN_ASSIGNED_FOR_RANKING);

  const contactTimes = eligible.map((a) => a.avgFirstContactMinutes).filter((m): m is number => m != null);
  const fastest = Math.min(...contactTimes);
  const slowest = Math.max(...contactTimes);
  const maxAssigned = Math.max(1, ...eligible.map((a) => a.assigned ?? 0));

  const speed = (m: number | null | undefined) => {
    if (m == null || contactTimes.length === 0) return 0;
    return slowest === fastest ? 100 : ((slowest - m) / (slowest - fastest)) * 100;
  };

  const scored = eligible.map((agent) => {
    const breakdown = {
      conversionRate: agent.conversionRate ?? 0,
      sla: agent.slaComplianceRate ?? 0,
      firstContact: speed(agent.avgFirstContactMinutes),
      volume: ((agent.assigned ?? 0) / maxAssigned) * 100,
    };
    const score =
      breakdown.conversionRate * SCORE_WEIGHTS.conversionRate +
      breakdown.sla * SCORE_WEIGHTS.sla +
      breakdown.firstContact * SCORE_WEIGHTS.firstContact +
      breakdown.volume * SCORE_WEIGHTS.volume;

    const value: number | null = (() => {
      switch (criterion) {
        case 'score': return Math.round(score * 10) / 10;
        case 'converted': return agent.converted ?? 0;
        case 'conversionRate': return agent.conversionRate ?? 0;
        case 'sla': return agent.slaComplianceRate ?? null;
        case 'firstContact': return agent.avgFirstContactMinutes ?? null;
      }
    })();
    return { agent, value, breakdown: criterion === 'score' ? breakdown : null };
  });

  // Le délai de premier contact se classe à l'envers : plus court, mieux.
  const lowerIsBetter = criterion === 'firstContact';
  const withValue = scored.filter((s) => s.value != null);
  const withoutValue = scored.filter((s) => s.value == null);

  withValue.sort((x, y) => {
    const d = lowerIsBetter ? x.value! - y.value! : y.value! - x.value!;
    // Départage stable et lisible : à valeur égale, le plus de conversions puis le nom.
    return d !== 0 ? d : (y.agent.converted ?? 0) - (x.agent.converted ?? 0) || (x.agent.name ?? '').localeCompare(y.agent.name ?? '');
  });

  const ranked: RankedAgent[] = [];
  withValue.forEach((s, i) => {
    const previous = ranked[i - 1];
    const rank = previous && previous.value === s.value ? previous.rank : i + 1;
    ranked.push({ ...s, rank });
  });

  return {
    ranked,
    unranked: [
      ...withoutValue.map((s) => ({ ...s, rank: null })),
      ...tooFew.map((agent) => ({ agent, rank: null, value: null, breakdown: null })),
    ],
  };
}
